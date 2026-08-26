// backend/src/services/costProfitService.js

/*
 * Serviciu consolidat pentru modulul Costuri & Profit - toată
 * logica determinist (fără AI) de: detectare/normalizare costuri
 * reutilizabile, costing de produs, calcul de preț și
 * profitabilitate, plus construirea propunerilor (pendingAction)
 * specifice acestor fluxuri. Fost în 4 fișiere separate
 * (costItemDetectionService.js, productCostingService.js,
 * productProfitabilityService.js, vendorPriceCalculatorService.js),
 * consolidate ca parte a refactorului de organizare a serviciilor -
 * NICIUN export, contract de request/response sau logică de
 * business nu s-a schimbat.
 *
 * vendorAssistantCommandService.js (clasificare LLM + dispatch +
 * UPDATE_PRODUCT generic pentru produsul PUBLICAT, nu doar
 * costurile lui) rămâne SEPARAT - are responsabilități generale
 * pentru tot Vendor Assistant (inclusiv editare de produs care nu
 * ține de Costuri & Profit), nu doar logică specifică acestui
 * modul; el importă din acest fișier exact ca înainte.
 *
 * Organizare (secțiuni, în această ordine):
 *   1. Normalizare unități / detectare costuri reutilizabile
 *   2. Helpere bibliotecă de costuri
 *   3. Costing de produs
 *   4. Calcul determinist de preț
 *   5. Profitabilitate
 *   6. Helpere pendingAction pentru Costuri & Profit
 */

import { prisma } from "../db.js";
import { findMatchingItems } from "../lib/textMatch.js";
import { getActivePlanForVendor } from "../payments/marketplaceCalc.js";
import { calculateVendorLineFinancials } from "./vendorCommissionService.js";

/* =========================================================
   ============================================================
   1. NORMALIZARE UNITĂȚI / DETECTARE COSTURI REUTILIZABILE
   ============================================================

   Detectare determinist a elementelor reutilizabile (materiale,
   ambalaje, tarife) menționate liber în conversație, care fie
   lipsesc din biblioteca VendorCostItem, fie au deja un cost
   salvat DIFERIT de cel spus acum.

   LLM-ul (în fiecare punct de integrare - orchestrator, calculator,
   flow foto) are STRICT rol de EXTRAGERE semantică (nume, tip,
   unitate, cost pe unitate SAU cantitate + cost total la achiziție).
   Tot ce ține de potrivire cu biblioteca, conversie de unitate și
   calculul costului unitar se face aici, determinist, fără AI.

   Rezultatul e mereu în forma deja folosită de
   vendorAssistantCommandService.js: { message, resultType, ... },
   ca să poată fi consumat identic din orice punct de integrare,
   fie ca rezultat principal, fie atașat ca sugestie secundară.
========================================================= */

const UNIT_ALIASES = {
  g: "g",
  gr: "g",
  gram: "g",
  grame: "g",
  grams: "g",

  kg: "kg",
  kilogram: "kg",
  kilograme: "kg",

  ml: "ml",
  mililitru: "ml",
  mililitri: "ml",

  l: "l",
  litru: "l",
  litri: "l",

  buc: "buc",
  bucata: "buc",
  bucată: "buc",
  bucati: "buc",
  bucăți: "buc",
  bucatã: "buc",

  m: "metru",
  metru: "metru",
  metri: "metru",

  cm: "cm",
  centimetru: "cm",
  centimetri: "cm",

  ora: "oră",
  oră: "oră",
  ore: "oră",

  set: "set",
  seturi: "set",
};

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Normalizează o unitate spusă liber ("kg", "kilograme",
 * "Kg.") la forma canonică folosită intern. Dacă unitatea nu e
 * recunoscută, o păstrăm ca atare (curățată) - nu o aruncăm, ca
 * să nu pierdem informație pe care vendorul chiar a dat-o.
 */
export function normalizeUnitLabel(raw) {
  const cleaned = stripDiacritics(raw).replace(/[.,]/g, "");

  if (!cleaned) return "";

  return (
    UNIT_ALIASES[cleaned] ||
    String(raw || "").trim().slice(0, 40)
  );
}

/*
 * Conversie doar pentru unitățile "mari" -> unitatea granulară
 * echivalentă, cea mai utilă pentru costing pe bucată de produs
 * (kg -> g, l -> ml). Alte unități nu se convertesc automat.
 */
const UNIT_CONVERSIONS = {
  kg: { to: "g", factor: 1000 },
  l: { to: "ml", factor: 1000 },
};

export function convertQuantityToUnit(
  quantity,
  fromUnit,
  toUnit
) {
  if (!Number.isFinite(Number(quantity))) {
    return null;
  }

  if (!fromUnit || !toUnit || fromUnit === toUnit) {
    return { quantity: Number(quantity), unit: fromUnit || toUnit || "" };
  }

  const conversion = UNIT_CONVERSIONS[fromUnit];

  if (conversion && conversion.to === toUnit) {
    return {
      quantity: Number(quantity) * conversion.factor,
      unit: toUnit,
    };
  }

  return null;
}

/* ---------------------------------------------------------
   Formatare bani (lei RO) - folosită de mesajele din
   detectare (secțiunea 1) și din pendingAction (secțiunea 6)
--------------------------------------------------------- */

function centsToRon(cents) {
  const numeric = Number(cents);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric) / 100;
}

function ronText(cents) {
  return `${centsToRon(cents).toLocaleString("ro-RO", {
    maximumFractionDigits: 2,
  })} lei`;
}

/* ======================================================
   Calcul determinist al costului unitar dintr-o extragere LLM

   extraction: {
     unit, unitCostLei,                       // formă "pe unitate"
     purchaseQuantity, purchaseUnit, purchaseTotalCostLei, // formă "achiziție"
   }

   targetUnit: dacă e dat (ex: unitatea unui VendorCostItem deja
   existent), încercăm să convertim spre ea; altfel se aplică
   normalizarea implicită (kg -> g, l -> ml).
====================================================== */

export function computeUnitCostCentsFromExtraction(
  extraction,
  targetUnit = null
) {
  const source = extraction || {};

  const directUnitCostLei = Number(source.unitCostLei);

  if (
    Number.isFinite(directUnitCostLei) &&
    directUnitCostLei >= 0 &&
    (source.unitCostLei !== null &&
      source.unitCostLei !== undefined &&
      source.unitCostLei !== "")
  ) {
    return {
      unit: normalizeUnitLabel(source.unit) || "",
      unitCostCents: Math.round(directUnitCostLei * 100),
    };
  }

  const rawQuantity = Number(source.purchaseQuantity);
  const rawTotal = Number(source.purchaseTotalCostLei);

  if (
    Number.isFinite(rawQuantity) &&
    rawQuantity > 0 &&
    Number.isFinite(rawTotal) &&
    rawTotal >= 0
  ) {
    const rawUnit = normalizeUnitLabel(
      source.purchaseUnit || source.unit
    );

    let quantity = rawQuantity;
    let unit = rawUnit;

    if (targetUnit && targetUnit !== rawUnit) {
      const converted = convertQuantityToUnit(
        rawQuantity,
        rawUnit,
        targetUnit
      );

      if (converted) {
        quantity = converted.quantity;
        unit = converted.unit;
      }
    } else if (!targetUnit && UNIT_CONVERSIONS[rawUnit]) {
      const conversion = UNIT_CONVERSIONS[rawUnit];
      quantity = rawQuantity * conversion.factor;
      unit = conversion.to;
    }

    if (!(quantity > 0)) {
      return null;
    }

    return {
      unit: unit || "",
      unitCostCents: Math.round((rawTotal / quantity) * 100),
    };
  }

  return null;
}

/* ======================================================
   Punctul de intrare central - un singur nume + date de
   cost extrase liber, comparate determinist cu biblioteca.

   Întoarce:
   - null                        -> nimic de propus (deja cunoscut, cost neschimbat)
   - { resultType: "answer" }    -> lipsește costul, trebuie întrebat
   - { resultType: "pending_action", pendingAction: { kind: "CREATE_COST_ITEM" | "UPDATE_COST_ITEM", ... } }
   - { resultType: "disambiguation", disambiguation }
====================================================== */

const VALID_TYPES = new Set(["MATERIAL", "PACKAGING", "OTHER"]);

export async function detectReusableCostItemMention({
  vendorId,
  name,
  type = "MATERIAL",
  unit,
  unitCostLei,
  purchaseQuantity,
  purchaseUnit,
  purchaseTotalCostLei,
}) {
  const cleanName = String(name || "")
    .trim()
    .slice(0, 120);

  if (!cleanName) {
    return null;
  }

  const safeType = VALID_TYPES.has(
    String(type || "").toUpperCase()
  )
    ? String(type).toUpperCase()
    : "MATERIAL";

  const costItems = await prisma.vendorCostItem.findMany({
    where: { vendorId, isActive: true },
  });

  const matches = findMatchingItems(cleanName, costItems, {
    nameField: "name",
  });

  if (
    matches.length > 1 &&
    matches[0].score - matches[1].score < 0.1
  ) {
    return {
      message: `Am găsit mai multe costuri asemănătoare cu „${cleanName}” în bibliotecă. Care anume?`,
      resultType: "disambiguation",

      disambiguation: {
        commandType: "UPDATE_COST_ITEM",

        costItems: matches
          .slice(0, 5)
          .map(({ item }) => formatCostItem(item)),

        /*
         * Câmpuri BRUTE, neconvertite - normalizarea (ex. kg -> g)
         * se face abia în /resolve, DUPĂ ce vendorul alege item-ul
         * din bibliotecă, față de unitatea lui reală. Dacă am
         * normaliza aici, înainte de alegere, un răspuns de tip
         * "2 kg cu 100 lei" ar putea ajunge salvat greșit (ex. de
         * 1000x) dacă item-ul ales folosește altă unitate decât
         * cea presupusă implicit.
         */
        params: {
          unitCostLei: unitCostLei ?? null,
          unit: unit ?? null,
          purchaseQuantity: purchaseQuantity ?? null,
          purchaseUnit: purchaseUnit ?? null,
          purchaseTotalCostLei:
            purchaseTotalCostLei ?? null,
        },
      },
    };
  }

  if (matches.length >= 1) {
    const target = matches[0].item;

    const targetUnit =
      normalizeUnitLabel(target.unit || "") || null;

    const computed = computeUnitCostCentsFromExtraction(
      {
        unit,
        unitCostLei,
        purchaseQuantity,
        purchaseUnit,
        purchaseTotalCostLei,
      },
      targetUnit
    );

    if (!computed) {
      // Nimic nou de propus - item deja cunoscut, fără cost nou spus acum.
      return null;
    }

    if (computed.unitCostCents === target.unitCostCents) {
      // Cost neschimbat - nu deranjăm vendorul cu o propunere goală.
      return null;
    }

    return buildUpdateCostItemPendingActionFromMatch(
      target,
      computed.unitCostCents,
      computed.unit,
      vendorId
    );
  }

  // Nu există în bibliotecă - propunem crearea lui.
  const computed = computeUnitCostCentsFromExtraction(
    {
      unit,
      unitCostLei,
      purchaseQuantity,
      purchaseUnit,
      purchaseTotalCostLei,
    },
    null
  );

  if (!computed) {
    return {
      message: `Nu am „${cleanName}” în bibliotecă. La ce preț l-ai găsit/cumpărat? Spune-mi costul pe unitate (ex. „1,2 lei pe metru”) sau costul total pentru o cantitate (ex. „2 kg cu 100 lei”), ca să-l pot propune pentru bibliotecă.`,
      resultType: "answer",
    };
  }

  return buildCreateCostItemPendingAction({
    name: cleanName,
    type: safeType,
    unitCostCents: computed.unitCostCents,
    unit: computed.unit,
  });
}

/* =========================================================
   ============================================================
   2. HELPERE BIBLIOTECĂ DE COSTURI
   ============================================================
========================================================= */

/*
 * Formatare API a unui VendorCostItem - fost export direct din
 * vendorCostProfitRoutes.js (fișier de rută), mutat aici ca să
 * evităm un import circular rute -> servicii -> rute (rutele au
 * nevoie de restul acestui serviciu, iar acest formator era
 * singurul lucru din direcția opusă). Reutilizează centsToRon
 * din secțiunea 1 - nicio formulă nouă.
 */
export function formatCostItem(item) {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    unit: item.unit || "",

    unitCostCents: item.unitCostCents,
    unitCost: centsToRon(item.unitCostCents),

    currency: item.currency,
    notes: item.notes || "",
    isActive: item.isActive,
    source: item.source,

    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Toate produsele (ale unui vendor) al căror costing salvat
 * folosește un anumit VendorCostItem - folosit pentru
 * "recalculează produsele care folosesc X" și pentru
 * previzualizarea "câte produse sunt afectate" înainte de a
 * modifica prețul unui cost din bibliotecă.
 */
export async function findProductsUsingCostItem(
  costItemId,
  vendorId
) {
  const items =
    await prisma.productCostingItem.findMany({
      where: {
        costItemId,

        costing: {
          product: {
            service: {
              vendorId,
            },
          },
        },
      },

      select: {
        costing: {
          select: {
            productId: true,

            product: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
    });

  const uniqueProducts = new Map();

  for (const item of items) {
    const product = item.costing?.product;

    if (product) {
      uniqueProducts.set(
        product.id,
        product.title
      );
    }
  }

  return Array.from(
    uniqueProducts,
    ([productId, title]) => ({
      productId,
      title,
    })
  );
}

/* =========================================================
   ============================================================
   3. COSTING DE PRODUS
   ============================================================
========================================================= */

/* ---------------------------------------------------------
   Eroare de validare (mapată la 400 în rute)
--------------------------------------------------------- */

export class CostingValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* ---------------------------------------------------------
   Rezolvare proprietate (vendor / produs)
--------------------------------------------------------- */

export async function resolveVendorByUserId(userSub) {
  return prisma.vendor.findUnique({
    where: {
      userId: userSub,
    },

    select: {
      id: true,
    },
  });
}

/**
 * Un produs aparține vendorului DOAR dacă serviciul (magazinul)
 * lui aparține acestui vendor. Nu se acceptă niciodată vendorId
 * din client.
 */
export async function resolveOwnedProduct(
  productId,
  vendorId
) {
  const product = await prisma.product.findUnique({
    where: {
      id: String(productId || ""),
    },

    select: {
      id: true,

      service: {
        select: {
          vendorId: true,
        },
      },
    },
  });

  if (!product || product.service?.vendorId !== vendorId) {
    return null;
  }

  return product;
}

/* ---------------------------------------------------------
   Helpers bani
--------------------------------------------------------- */

function centsToLei(cents) {
  const numeric = Number(cents);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.round(numeric) / 100;
}

function leiToCents(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return Math.round(numeric * 100);
}

/* ---------------------------------------------------------
   Validare + îmbogățire costItemId -> valori din bibliotecă

   Pentru orice linie legată de un VendorCostItem, sursa de
   adevăr pentru cost/nume/unitate este ÎNTOTDEAUNA biblioteca,
   nu ce trimite clientul (sau ce a "înțeles" LLM-ul) - vezi
   "unitCostCentsSnapshot pentru costurile din bibliotecă".
--------------------------------------------------------- */

async function resolveCostItemMap(costItemIds, vendorId) {
  if (!costItemIds.size) {
    return new Map();
  }

  const found = await prisma.vendorCostItem.findMany({
    where: {
      id: {
        in: Array.from(costItemIds),
      },

      vendorId,
    },
  });

  const map = new Map(
    found.map((item) => [item.id, item])
  );

  for (const id of costItemIds) {
    if (!map.has(id)) {
      throw new CostingValidationError(
        "invalid_cost_item_id",

        "Unul dintre costurile selectate din bibliotecă nu există sau nu îți aparține."
      );
    }
  }

  return map;
}

async function enrichCostDraft(costDraft, vendorId) {
  const costItemIds = new Set();

  for (const material of costDraft.materials) {
    if (material.costItemId) {
      costItemIds.add(material.costItemId);
    }
  }

  if (costDraft.packagingCostItemId) {
    costItemIds.add(costDraft.packagingCostItemId);
  }

  for (const other of costDraft.otherCosts) {
    if (other.costItemId) {
      costItemIds.add(other.costItemId);
    }
  }

  const costItemMap = await resolveCostItemMap(
    costItemIds,
    vendorId
  );

  const materials = costDraft.materials.map((material) => {
    if (material.costItemId) {
      const lib = costItemMap.get(material.costItemId);

      return {
        name: lib.name,
        unit: lib.unit || "",
        quantity: material.quantity,
        unitCost: centsToLei(lib.unitCostCents),
        costItemId: lib.id,
      };
    }

    return {
      name: material.name,
      unit: material.unit,
      quantity: material.quantity,
      unitCost: material.unitCost,
      costItemId: null,
    };
  });

  let packagingLabel = "Ambalaj";
  let packagingUnit = null;
  let packagingCost = Number(costDraft.packagingCost) || 0;
  let packagingCostItemId = null;

  if (costDraft.packagingCostItemId) {
    const lib = costItemMap.get(costDraft.packagingCostItemId);

    packagingLabel = lib.name;
    packagingUnit = lib.unit || null;
    packagingCost = centsToLei(lib.unitCostCents);
    packagingCostItemId = lib.id;
  }

  const otherCosts = costDraft.otherCosts.map((other) => {
    if (other.costItemId) {
      const lib = costItemMap.get(other.costItemId);

      return {
        label: lib.name,
        amount: centsToLei(lib.unitCostCents),
        costItemId: lib.id,
      };
    }

    return {
      label: other.label,
      amount: other.amount,
      costItemId: null,
    };
  });

  return {
    costDraft: {
      ...costDraft,
      materials,
      otherCosts,
      packagingCost,
    },

    packagingMeta: {
      label: packagingLabel,
      unit: packagingUnit,
      costItemId: packagingCostItemId,
    },
  };
}

/* ---------------------------------------------------------
   costDraft (lei) <-> rânduri ProductCostingItem (cenți)
--------------------------------------------------------- */

function buildCostingItemsData({
  costDraft,
  packagingMeta,
}) {
  const items = [];

  for (const material of costDraft.materials) {
    items.push({
      kind: "MATERIAL",
      label: material.name,
      quantity: material.quantity,
      unit: material.unit || null,
      unitCostCentsSnapshot: leiToCents(material.unitCost),
      costItemId: material.costItemId || null,
    });
  }

  if (
    costDraft.packagingCost > 0 ||
    packagingMeta.costItemId
  ) {
    items.push({
      kind: "PACKAGING",
      label: packagingMeta.label,
      quantity: 1,
      unit: packagingMeta.unit,
      unitCostCentsSnapshot: leiToCents(
        costDraft.packagingCost
      ),
      costItemId: packagingMeta.costItemId,
    });
  }

  for (const other of costDraft.otherCosts) {
    items.push({
      kind: "OTHER",
      label: other.label,
      quantity: 1,
      unit: null,
      unitCostCentsSnapshot: leiToCents(other.amount),
      costItemId: other.costItemId || null,
    });
  }

  return items;
}

/**
 * Reconstruiește un costDraft (lei) pornind de la rândurile
 * salvate ale unui ProductCosting - folosit pentru:
 * - a preîncărca conversația AI cu un costing existent;
 * - a rula recalcularea determinist fără date noi de la client.
 */
export function costingToCostDraft(costing) {
  const materials = [];
  let packagingCost = 0;
  const otherCosts = [];

  for (const item of costing.items || []) {
    if (item.kind === "MATERIAL") {
      materials.push({
        name: item.label,
        quantity: item.quantity,
        unit: item.unit || "",
        unitCost: centsToLei(item.unitCostCentsSnapshot),
        costItemId: item.costItemId || null,
      });
    } else if (item.kind === "PACKAGING") {
      packagingCost +=
        centsToLei(item.unitCostCentsSnapshot) *
        (item.quantity || 1);
    } else if (item.kind === "OTHER") {
      otherCosts.push({
        label: item.label,

        amount:
          centsToLei(item.unitCostCentsSnapshot) *
          (item.quantity || 1),

        costItemId: item.costItemId || null,
      });
    }
  }

  const desiredProfit =
    costing.desiredProfitPercent != null
      ? {
          type: "percent",
          value: costing.desiredProfitPercent,
        }
      : costing.desiredProfitCents != null
        ? {
            type: "amount",
            value: centsToLei(costing.desiredProfitCents),
          }
        : null;

  return sanitizeCostDraft({
    materials,
    packagingCost,
    otherCosts,
    laborHours: costing.laborHours,

    hourlyRate:
      costing.hourlyRateCents != null
        ? centsToLei(costing.hourlyRateCents)
        : null,

    desiredProfit,
  });
}

/* ---------------------------------------------------------
   Scriere: salvare/actualizare costing
--------------------------------------------------------- */

function buildScalarData({
  enrichedDraft,
  calc,
  commissionBps,
}) {
  const desiredProfitPercent =
    enrichedDraft.desiredProfit?.type === "percent"
      ? enrichedDraft.desiredProfit.value
      : null;

  const desiredProfitCents =
    enrichedDraft.desiredProfit?.type === "amount"
      ? leiToCents(enrichedDraft.desiredProfit.value)
      : null;

  const hourlyRateCents =
    enrichedDraft.hourlyRate != null
      ? leiToCents(enrichedDraft.hourlyRate)
      : null;

  return {
    laborHours:
      enrichedDraft.laborHours != null
        ? Number(enrichedDraft.laborHours)
        : null,

    hourlyRateCents,
    desiredProfitPercent,
    desiredProfitCents,

    materialsCostCents: calc?.materialsCostCents ?? 0,
    laborCostCents: calc?.laborCostCents ?? 0,
    packagingCostCents: calc?.packagingCostCents ?? 0,
    otherCostsCents: calc?.otherCostsCents ?? 0,
    totalRealCostCents: calc?.totalRealCostCents ?? 0,
    minPriceCents: calc?.minPriceCents ?? 0,
    recommendedPriceCents: calc?.recommendedPriceCents ?? 0,
    estimatedProfitCents: calc?.estimatedProfitCents ?? 0,
    vendorNetCents: calc?.vendorNetCents ?? 0,
    commissionBpsUsed: commissionBps,

    needsRecalculation: false,

    /*
     * Orice salvare/recalculare invalidează o confirmare
     * anterioară - "CONFIRMED" trebuie să însemne mereu
     * "vendorul a validat EXACT aceste cifre".
     */
    status: "DRAFT",

    lastCalculatedAt: calc ? new Date() : null,
  };
}

/**
 * Creează sau înlocuiește costing-ul unui produs (upsert +
 * înlocuire completă a liniilor). Rulează calculul determinist
 * din secțiunea 4 (calcul de preț) - nu se reimplementează
 * nicio formulă aici.
 */
export async function saveProductCosting({
  productId,
  vendorId,
  rawCostDraft,
}) {
  const costDraft = sanitizeCostDraft(
    rawCostDraft,
    EMPTY_COST_DRAFT
  );

  const { costDraft: enrichedDraft, packagingMeta } =
    await enrichCostDraft(costDraft, vendorId);

  const ready = isReadyToCalculate(enrichedDraft);

  let calc = null;
  let commissionBps = 0;

  if (ready) {
    const plan = await getActivePlanForVendor(vendorId);

    commissionBps = Number.isFinite(
      Number(plan?.commissionBps)
    )
      ? Number(plan.commissionBps)
      : 0;

    calc = computePriceRecommendation({
      costDraft: enrichedDraft,
      commissionBps,
    });
  }

  const itemsData = buildCostingItemsData({
    costDraft: enrichedDraft,
    packagingMeta,
  });

  const scalarData = buildScalarData({
    enrichedDraft,
    calc,
    commissionBps,
  });

  const costingId = await prisma.$transaction(
    async (tx) => {
      const existing = await tx.productCosting.findUnique({
        where: { productId },
      });

      if (existing) {
        await tx.productCostingItem.deleteMany({
          where: { costingId: existing.id },
        });

        await tx.productCosting.update({
          where: { id: existing.id },

          data: {
            ...scalarData,

            items: {
              create: itemsData,
            },
          },
        });

        return existing.id;
      }

      const created = await tx.productCosting.create({
        data: {
          productId,
          ...scalarData,

          items: {
            create: itemsData,
          },
        },
      });

      return created.id;
    }
  );

  return prisma.productCosting.findUnique({
    where: { id: costingId },
    include: { items: true },
  });
}

/**
 * Recalculează determinist un costing existent, din liniile
 * deja salvate (fără date noi de la client) - de exemplu după
 * o schimbare a comisionului vendorului.
 */
export async function recalculateProductCosting({
  productId,
  vendorId,
}) {
  const existing = await prisma.productCosting.findUnique({
    where: { productId },
    include: { items: true },
  });

  if (!existing) {
    throw new CostingValidationError(
      "no_costing",

      "Nu există încă un costing salvat pentru acest produs."
    );
  }

  const costDraft = costingToCostDraft(existing);
  const ready = isReadyToCalculate(costDraft);

  let calc = null;
  let commissionBps = existing.commissionBpsUsed;

  if (ready) {
    const plan = await getActivePlanForVendor(vendorId);

    commissionBps = Number.isFinite(
      Number(plan?.commissionBps)
    )
      ? Number(plan.commissionBps)
      : 0;

    calc = computePriceRecommendation({
      costDraft,
      commissionBps,
    });
  }

  return prisma.productCosting.update({
    where: { id: existing.id },

    data: {
      materialsCostCents: calc?.materialsCostCents ?? 0,
      laborCostCents: calc?.laborCostCents ?? 0,
      packagingCostCents: calc?.packagingCostCents ?? 0,
      otherCostsCents: calc?.otherCostsCents ?? 0,
      totalRealCostCents: calc?.totalRealCostCents ?? 0,
      minPriceCents: calc?.minPriceCents ?? 0,
      recommendedPriceCents: calc?.recommendedPriceCents ?? 0,
      estimatedProfitCents: calc?.estimatedProfitCents ?? 0,
      vendorNetCents: calc?.vendorNetCents ?? 0,
      commissionBpsUsed: commissionBps,

      needsRecalculation: false,
      status: "DRAFT",

      lastCalculatedAt: calc
        ? new Date()
        : existing.lastCalculatedAt,
    },

    include: { items: true },
  });
}

/**
 * DRAFT -> CONFIRMED. Nu se poate confirma un costing care
 * nu a fost niciodată calculat (lipsesc info obligatorii).
 */
export async function confirmProductCosting({
  productId,
}) {
  const existing = await prisma.productCosting.findUnique({
    where: { productId },
  });

  if (!existing) {
    throw new CostingValidationError(
      "no_costing",

      "Nu există încă un costing salvat pentru acest produs."
    );
  }

  if (!existing.lastCalculatedAt) {
    throw new CostingValidationError(
      "costing_not_calculated",

      "Completează cel puțin timpul de lucru și valoarea orei înainte de confirmare."
    );
  }

  return prisma.productCosting.update({
    where: { id: existing.id },
    data: { status: "CONFIRMED" },
    include: { items: true },
  });
}

/* ---------------------------------------------------------
   Formatare răspuns API
--------------------------------------------------------- */

export function formatCosting(costing) {
  if (!costing) {
    return null;
  }

  return {
    id: costing.id,
    productId: costing.productId,
    status: costing.status,
    needsRecalculation: costing.needsRecalculation,

    laborHours: costing.laborHours,

    hourlyRate:
      costing.hourlyRateCents != null
        ? centsToLei(costing.hourlyRateCents)
        : null,

    desiredProfit:
      costing.desiredProfitPercent != null
        ? {
            type: "percent",
            value: costing.desiredProfitPercent,
          }
        : costing.desiredProfitCents != null
          ? {
              type: "amount",
              value: centsToLei(costing.desiredProfitCents),
            }
          : null,

    pricing: costing.lastCalculatedAt
      ? {
          materialsCost: centsToLei(
            costing.materialsCostCents
          ),

          laborCost: centsToLei(costing.laborCostCents),

          packagingCost: centsToLei(
            costing.packagingCostCents
          ),

          otherCosts: centsToLei(costing.otherCostsCents),

          totalRealCost: centsToLei(
            costing.totalRealCostCents
          ),

          minPrice: centsToLei(costing.minPriceCents),

          recommendedPrice: centsToLei(
            costing.recommendedPriceCents
          ),

          estimatedProfit: centsToLei(
            costing.estimatedProfitCents
          ),

          vendorNetAfterCommission: centsToLei(
            costing.vendorNetCents
          ),

          commissionBps: costing.commissionBpsUsed,

          commissionPercent:
            Math.round(costing.commissionBpsUsed) / 100,
        }
      : null,

    items: (costing.items || []).map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      quantity: item.quantity,
      unit: item.unit || "",
      unitCost: centsToLei(item.unitCostCentsSnapshot),
      unitCostCentsSnapshot: item.unitCostCentsSnapshot,
      costItemId: item.costItemId || null,
    })),

    lastCalculatedAt: costing.lastCalculatedAt,
    createdAt: costing.createdAt,
    updatedAt: costing.updatedAt,
  };
}

/* ---------------------------------------------------------
   Aplicare preț recomandat

   SINGURUL loc din tot modulul "Costuri & Profit" care scrie
   Product.priceCents. Nu se întâmplă niciodată automat -
   apelantul (ruta) confirmă explicit înainte de a chema asta.

   Dacă costing-ul nu e CONFIRMED sau are needsRecalculation,
   cere un al doilea acord explicit (acknowledgeStaleData) -
   altfel respinge, ca să nu se aplice un preț calculat din
   date posibil învechite fără ca vendorul să știe.
--------------------------------------------------------- */

export async function applyRecommendedPrice({
  productId,
  acknowledgeStaleData = false,
}) {
  const [product, costing] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, priceCents: true },
    }),

    prisma.productCosting.findUnique({
      where: { productId },
    }),
  ]);

  if (!product) {
    throw new CostingValidationError(
      "product_not_found",
      "Produsul nu a fost găsit."
    );
  }

  if (!costing) {
    throw new CostingValidationError(
      "no_costing",
      "Nu există încă un costing salvat pentru acest produs."
    );
  }

  if (
    !costing.lastCalculatedAt ||
    costing.recommendedPriceCents <= 0
  ) {
    throw new CostingValidationError(
      "costing_not_calculated",
      "Costing-ul nu a fost încă niciodată calculat."
    );
  }

  const isStale =
    costing.status !== "CONFIRMED" ||
    costing.needsRecalculation === true;

  if (isStale && !acknowledgeStaleData) {
    throw new CostingValidationError(
      "requires_acknowledgement",

      costing.status !== "CONFIRMED"
        ? "Costing-ul nu este confirmat încă. Confirmă explicit dacă vrei să aplici oricum prețul recomandat."
        : "Costing-ul are costuri neactualizate (un cost din bibliotecă s-a schimbat de la ultimul calcul). Confirmă explicit dacă vrei să aplici oricum prețul recomandat."
    );
  }

  const previousPriceCents = product.priceCents;

  const updated = await prisma.product.update({
    where: { id: productId },

    data: {
      priceCents: costing.recommendedPriceCents,
    },

    select: {
      id: true,
      priceCents: true,
    },
  });

  return {
    productId,
    previousPriceCents,
    newPriceCents: updated.priceCents,
    recommendedPriceCents: costing.recommendedPriceCents,
  };
}

/* ---------------------------------------------------------
   Recalculare în masă

   Reutilizează recalculateProductCosting() per produs - nu
   reimplementează nimic, doar iterează o listă de productId
   deja validați ca aparținând vendorului curent.
--------------------------------------------------------- */

export async function recalculateProductsBatch({
  productIds,
  vendorId,
}) {
  const uniqueIds = Array.from(
    new Set(
      Array.isArray(productIds) ? productIds : []
    )
  );

  const results = [];

  for (const productId of uniqueIds) {
    const owned = await resolveOwnedProduct(
      productId,
      vendorId
    );

    if (!owned) {
      results.push({
        productId,
        ok: false,
        error: "not_found_or_forbidden",
      });

      continue;
    }

    try {
      const costing =
        await recalculateProductCosting({
          productId,
          vendorId,
        });

      results.push({
        productId,
        ok: true,
        costing: formatCosting(costing),
      });
    } catch (err) {
      results.push({
        productId,

        ok: false,

        error:
          err instanceof CostingValidationError
            ? err.code
            : "server_error",
      });
    }
  }

  return results;
}

/* =========================================================
   ============================================================
   4. CALCUL DETERMINIST DE PREȚ
   ============================================================
========================================================= */

/* ---------------------------------------------------------
   Draft gol
--------------------------------------------------------- */

export const EMPTY_COST_DRAFT = {
  materials: [],
  packagingCost: 0,
  packagingCostItemId: null,
  otherCosts: [],
  laborHours: null,
  hourlyRate: null,
  desiredProfit: null,
};

/* ---------------------------------------------------------
   Sanitizare draft
--------------------------------------------------------- */

/*
 * costItemId e opțional și pur informativ pentru sanitizare -
 * leagă linia de un VendorCostItem din biblioteca vendorului.
 * Proprietatea reală (că id-ul chiar aparține vendorului) NU se
 * verifică aici, ci în secțiunea 3 (costing de produs), care are
 * acces la Prisma și la vendorId-ul cerut autentificat.
 */
function sanitizeCostItemId(value) {
  const id = String(value || "").trim();
  return id ? id.slice(0, 64) : null;
}

function sanitizeMaterial(item) {
  const name = String(item?.name || "").trim().slice(0, 120);
  const quantity = Number(item?.quantity);
  const unitCost = Number(item?.unitCost);
  const unit = String(item?.unit || "").trim().slice(0, 40);
  const costItemId = sanitizeCostItemId(item?.costItemId);

  if (!name) {
    return null;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  if (!Number.isFinite(unitCost) || unitCost < 0) {
    return null;
  }

  return {
    name,
    quantity,
    unit,
    unitCost,
    costItemId,
  };
}

function sanitizeMaterials(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .map(sanitizeMaterial)
    .filter(Boolean)
    .slice(0, 30);
}

function sanitizeOtherCostItem(item) {
  const label = String(item?.label || "").trim().slice(0, 120);
  const amount = Number(item?.amount);
  const costItemId = sanitizeCostItemId(item?.costItemId);

  if (!label) {
    return null;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return {
    label,
    amount,
    costItemId,
  };
}

function sanitizeOtherCosts(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .map(sanitizeOtherCostItem)
    .filter(Boolean)
    .slice(0, 20);
}

function sanitizeNonNegativeNumber(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }

  return numeric;
}

function sanitizeDesiredProfit(value) {
  if (value === null) {
    return null;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const type =
    value.type === "amount"
      ? "amount"
      : value.type === "percent"
        ? "percent"
        : null;

  const numeric = Number(value.value);

  if (!type || !Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return {
    type,
    value: numeric,
  };
}

/**
 * Normalizează un draft de costuri (parțial sau complet), completând
 * câmpurile lipsă/nevalide cu valorile din `fallback`.
 *
 * Folosită atât pentru draftul primit din client, cât și pentru
 * a aplica peste el patch-ul (nesigur) întors de LLM.
 */
export function sanitizeCostDraft(
  raw,
  fallback = EMPTY_COST_DRAFT
) {
  const source =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw)
      ? raw
      : {};

  const safeFallback =
    fallback && typeof fallback === "object"
      ? fallback
      : EMPTY_COST_DRAFT;

  const materials = sanitizeMaterials(source.materials);
  const otherCosts = sanitizeOtherCosts(source.otherCosts);
  const packagingCost = sanitizeNonNegativeNumber(source.packagingCost);

  const packagingCostItemId =
    source.packagingCostItemId === null
      ? null
      : source.packagingCostItemId !== undefined
        ? sanitizeCostItemId(source.packagingCostItemId)
        : undefined;

  const laborHours = sanitizeNonNegativeNumber(source.laborHours);
  const hourlyRate = sanitizeNonNegativeNumber(source.hourlyRate);
  const desiredProfit = sanitizeDesiredProfit(source.desiredProfit);

  return {
    materials:
      materials ?? safeFallback.materials ?? [],

    otherCosts:
      otherCosts ?? safeFallback.otherCosts ?? [],

    packagingCost:
      packagingCost !== undefined
        ? packagingCost
        : (safeFallback.packagingCost ?? 0),

    packagingCostItemId:
      packagingCostItemId !== undefined
        ? packagingCostItemId
        : (safeFallback.packagingCostItemId ?? null),

    laborHours:
      laborHours !== undefined
        ? laborHours
        : (safeFallback.laborHours ?? null),

    hourlyRate:
      hourlyRate !== undefined
        ? hourlyRate
        : (safeFallback.hourlyRate ?? null),

    desiredProfit:
      desiredProfit !== undefined
        ? desiredProfit
        : (safeFallback.desiredProfit ?? null),
  };
}

/* ---------------------------------------------------------
   Pragul minim de informații necesare calculului
--------------------------------------------------------- */

/**
 * Timpul de lucru și valoarea orei sunt singurele informații
 * cu adevărat obligatorii (sunt cerute explicit ca rezultat -
 * "cost manoperă"). Restul (materiale, ambalaj, alte costuri,
 * profit dorit) sunt opționale și, dacă lipsesc, sunt tratate
 * ca 0 - nu blochează calculul.
 */
export function isReadyToCalculate(costDraft) {
  const laborHours = Number(costDraft?.laborHours);
  const hourlyRate = Number(costDraft?.hourlyRate);

  return (
    Number.isFinite(laborHours) &&
    laborHours > 0 &&
    Number.isFinite(hourlyRate) &&
    hourlyRate > 0
  );
}

/* ---------------------------------------------------------
   Calcul determinist - bani în cents
--------------------------------------------------------- */

function toCents(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return Math.round(numeric * 100);
}

function sumMaterialsCostCents(materials) {
  if (!Array.isArray(materials)) {
    return 0;
  }

  return materials.reduce((total, material) => {
    const quantity = Number(material?.quantity);
    const unitCost = Number(material?.unitCost);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return total;
    }

    if (!Number.isFinite(unitCost) || unitCost < 0) {
      return total;
    }

    return (
      total + Math.round(quantity * unitCost * 100)
    );
  }, 0);
}

function sumOtherCostsCents(otherCosts) {
  if (!Array.isArray(otherCosts)) {
    return 0;
  }

  return otherCosts.reduce((total, item) => {
    return total + toCents(item?.amount);
  }, 0);
}

/**
 * Cost materiale + manoperă + ambalaj + alte costuri.
 * Rezultat determinist, fără nicio implicare a LLM-ului.
 */
export function computeCostBreakdown(costDraft) {
  const materialsCostCents = sumMaterialsCostCents(
    costDraft?.materials
  );

  const laborHours = Math.max(
    0,
    Number(costDraft?.laborHours) || 0
  );

  const hourlyRate = Math.max(
    0,
    Number(costDraft?.hourlyRate) || 0
  );

  const laborCostCents = Math.round(
    laborHours * hourlyRate * 100
  );

  const packagingCostCents = toCents(
    costDraft?.packagingCost
  );

  const otherCostsCents = sumOtherCostsCents(
    costDraft?.otherCosts
  );

  const totalRealCostCents =
    materialsCostCents +
    laborCostCents +
    packagingCostCents +
    otherCostsCents;

  return {
    materialsCostCents,
    laborCostCents,
    packagingCostCents,
    otherCostsCents,
    totalRealCostCents,
  };
}

/**
 * Profitul dorit de vendor, ca markup pe costul total real
 * (dacă e procent) sau ca sumă fixă (dacă e amount).
 */
function computeProfitTargetCents(
  desiredProfit,
  totalRealCostCents
) {
  if (
    !desiredProfit ||
    typeof desiredProfit !== "object"
  ) {
    return 0;
  }

  const value = Number(desiredProfit.value);

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (desiredProfit.type === "amount") {
    return Math.round(value * 100);
  }

  /*
   * Markup pe cost: profit = cost_total_real x procent.
   */
  return Math.round(
    totalRealCostCents * (value / 100)
  );
}

/**
 * Calculul final, determinist, al recomandării de preț.
 *
 * commissionBps vine din planul REAL de abonament al vendorului
 * (nu din client, nu din LLM) - vezi getActivePlanForVendor().
 *
 * Formula cheie: comisionul Artfest se reține din prețul plătit
 * de client, deci prețul minim de vânzare trebuie să fie
 * cost / (1 - rata_comision), nu pur și simplu cost - altfel
 * vendorul iese în pierdere după comision.
 */
export function computePriceRecommendation({
  costDraft,
  commissionBps = 0,
}) {
  const breakdown = computeCostBreakdown(costDraft);

  const profitTargetCents = computeProfitTargetCents(
    costDraft?.desiredProfit,
    breakdown.totalRealCostCents
  );

  const safeCommissionBps = Math.max(
    0,
    Number(commissionBps) || 0
  );

  const commissionRateRaw = safeCommissionBps / 10000;

  /*
   * Gardă defensivă: dacă vreodată comisionul ar fi foarte
   * aproape de 100%, evităm împărțirea la zero / prețuri infinite.
   */
  const commissionRate = Math.min(
    commissionRateRaw,
    0.95
  );

  const minPriceCents =
    breakdown.totalRealCostCents <= 0
      ? 0
      : Math.ceil(
          breakdown.totalRealCostCents /
            (1 - commissionRate)
        );

  const priceBaseWithProfitCents =
    breakdown.totalRealCostCents + profitTargetCents;

  const recommendedPriceCents =
    priceBaseWithProfitCents <= 0
      ? 0
      : Math.ceil(
          priceBaseWithProfitCents /
            (1 - commissionRate)
        );

  /*
   * Reutilizăm calculul de comision deja existent și testat
   * din vendorCommissionService.js, ca să nu reinventăm logica
   * de comision aici.
   */
  const commissionAtRecommended =
    calculateVendorLineFinancials({
      originalUnitPriceCents: recommendedPriceCents,
      finalUnitPriceCents: recommendedPriceCents,
      quantity: 1,
      commissionBps: safeCommissionBps,
    });

  const estimatedProfitCents =
    commissionAtRecommended.vendorNetCents -
    breakdown.totalRealCostCents;

  return {
    ...breakdown,

    profitTargetCents,

    commissionBps: safeCommissionBps,

    minPriceCents,

    recommendedPriceCents,

    finalCommissionCents:
      commissionAtRecommended.finalCommissionCents,

    vendorNetCents:
      commissionAtRecommended.vendorNetCents,

    estimatedProfitCents,
  };
}

/* =========================================================
   ============================================================
   5. PROFITABILITATE
   ============================================================
========================================================= */

export const PROFITABILITY_FILTERS = new Set([
  "no_costing",
  "draft",
  "confirmed",
  "needs_recalculation",
  "below_min_price",
]);

export const PROFITABILITY_SORT_FIELDS = new Set([
  "name",
  "totalRealCost",
  "profit",
  "recommendedPrice",
  "lastRecalculated",
]);

function formatProfitabilityItem(product) {
  const costing = product.costing;

  const recommendedPriceCents =
    costing?.recommendedPriceCents ?? 0;

  const estimatedProfitCents =
    costing?.estimatedProfitCents ?? 0;

  /*
   * Marjă de profit ca procent din prețul recomandat -
   * folosită de întrebări de tip "profit sub 20%". Nu există
   * ca filtru separat pe REST (ar necesita un nou query param
   * doar pentru asta) - se calculează aici, determinist, din
   * câmpurile deja existente, și e disponibilă oricui
   * consumă acest serviciu.
   */
  const profitMarginPercent =
    costing && recommendedPriceCents > 0
      ? Math.round(
          (estimatedProfitCents /
            recommendedPriceCents) *
            1000
        ) / 10
      : null;

  return {
    productId: product.id,
    title: product.title,

    image:
      Array.isArray(product.images) &&
      product.images.length
        ? product.images[0]
        : null,

    priceCents: product.priceCents,

    status: {
      isActive: product.isActive,
      isHidden: product.isHidden,
      moderationStatus: product.moderationStatus,
    },

    hasCosting: Boolean(costing),
    costingStatus: costing?.status || null,

    materialsCostCents:
      costing?.materialsCostCents ?? 0,

    laborCostCents:
      costing?.laborCostCents ?? 0,

    packagingCostCents:
      costing?.packagingCostCents ?? 0,

    otherCostsCents:
      costing?.otherCostsCents ?? 0,

    totalRealCostCents:
      costing?.totalRealCostCents ?? 0,

    minPriceCents:
      costing?.minPriceCents ?? 0,

    recommendedPriceCents,
    estimatedProfitCents,
    profitMarginPercent,

    vendorNetCents:
      costing?.vendorNetCents ?? 0,

    commissionBpsUsed:
      costing?.commissionBpsUsed ?? 0,

    needsRecalculation:
      costing?.needsRecalculation ?? false,

    lastCalculatedAt:
      costing?.lastCalculatedAt ?? null,
  };
}

function matchesFilter(item, filter) {
  switch (filter) {
    case "no_costing":
      return !item.hasCosting;

    case "draft":
      return item.costingStatus === "DRAFT";

    case "confirmed":
      return item.costingStatus === "CONFIRMED";

    case "needs_recalculation":
      return item.needsRecalculation === true;

    case "below_min_price":
      return (
        item.hasCosting &&
        item.minPriceCents > 0 &&
        item.priceCents < item.minPriceCents
      );

    default:
      return true;
  }
}

const SORT_GETTERS = {
  name: (item) =>
    String(item.title || "").toLowerCase(),

  totalRealCost: (item) =>
    item.totalRealCostCents,

  profit: (item) => item.estimatedProfitCents,

  recommendedPrice: (item) =>
    item.recommendedPriceCents,

  lastRecalculated: (item) =>
    item.lastCalculatedAt
      ? new Date(
          item.lastCalculatedAt
        ).getTime()
      : -Infinity,
};

function sortItems(items, sortBy, sortDir) {
  const getter =
    SORT_GETTERS[sortBy] || SORT_GETTERS.name;

  const dir = sortDir === "desc" ? -1 : 1;

  return [...items].sort((a, b) => {
    const valueA = getter(a);
    const valueB = getter(b);

    if (valueA < valueB) return -1 * dir;
    if (valueA > valueB) return 1 * dir;
    return 0;
  });
}

/**
 * Toate produsele vendorului, cu costing-ul lor (dacă există),
 * formatate - fără filtrare/sortare/paginare. Bază comună
 * pentru getProductProfitability() (REST) și pentru comenzile
 * conversaționale, care au nevoie de filtre suplimentare
 * (ex. prag de marjă %) neexprimabile ca query param simplu.
 */
export async function listVendorProductProfitability(
  vendorId
) {
  const products = await prisma.product.findMany({
    where: {
      service: {
        vendorId,
      },
    },

    select: {
      id: true,
      title: true,
      images: true,
      priceCents: true,
      isActive: true,
      isHidden: true,
      moderationStatus: true,

      costing: {
        select: {
          status: true,
          needsRecalculation: true,
          materialsCostCents: true,
          laborCostCents: true,
          packagingCostCents: true,
          otherCostsCents: true,
          totalRealCostCents: true,
          minPriceCents: true,
          recommendedPriceCents: true,
          estimatedProfitCents: true,
          vendorNetCents: true,
          commissionBpsUsed: true,
          lastCalculatedAt: true,
        },
      },
    },
  });

  return products.map(formatProfitabilityItem);
}

/**
 * Interogare completă: filtrare + sortare + paginare, exact
 * ce foloseau ruta REST. `filter`/`sortBy`/`sortDir` deja
 * validate de apelant (vezi FILTERS/SORT_FIELDS de mai sus).
 */
export async function getProductProfitability({
  vendorId,
  filter = "",
  sortBy = "name",
  sortDir = "asc",
  page = 1,
  pageSize = 20,
}) {
  let items = await listVendorProductProfitability(
    vendorId
  );

  if (filter) {
    items = items.filter((item) =>
      matchesFilter(item, filter)
    );
  }

  items = sortItems(items, sortBy, sortDir);

  const total = items.length;

  const totalPages = Math.max(
    1,
    Math.ceil(total / pageSize)
  );

  const start = (page - 1) * pageSize;
  const pageItems = items.slice(
    start,
    start + pageSize
  );

  return {
    items: pageItems,
    page,
    pageSize,
    total,
    totalPages,
  };
}

/* =========================================================
   ============================================================
   6. HELPERE PENDINGACTION PENTRU COSTURI & PROFIT
   ============================================================

   Construire pendingAction - CREATE_COST_ITEM / UPDATE_COST_ITEM.

   Formă coerentă before/after peste tot: { unitCostCents, unit }.
   Niciodată un câmp "unitCost" deja convertit în lei - conversia
   cents -> lei se face o singură dată, la afișare (mesaj/UI).
========================================================= */

export function buildCreateCostItemPendingAction({
  name,
  type,
  unitCostCents,
  unit,
}) {
  const unitSuffix = unit ? `/${unit}` : "";

  return {
    message: `Nu am „${name}” în biblioteca ta de costuri. Vrei să îl adaug la ${ronText(
      unitCostCents
    )}${unitSuffix} pentru calculele viitoare?`,

    resultType: "pending_action",

    pendingAction: {
      kind: "CREATE_COST_ITEM",

      name,
      type,
      unit: unit || null,
      unitCostCents,

      summary: `${name}: ${ronText(
        unitCostCents
      )}${unitSuffix} (nou)`,
    },
  };
}

export async function buildUpdateCostItemPendingActionFromMatch(
  costItem,
  newUnitCostCents,
  newUnit,
  vendorId
) {
  const affected = await findProductsUsingCostItem(
    costItem.id,
    vendorId
  );

  const oldUnitCostCents = Number.isFinite(
    Number(costItem.unitCostCents)
  )
    ? Number(costItem.unitCostCents)
    : null;

  const unit = newUnit || costItem.unit || "";

  const oldCostText =
    oldUnitCostCents != null
      ? `${ronText(oldUnitCostCents)}${
          costItem.unit ? `/${costItem.unit}` : ""
        }`
      : "cost nesetat";

  const newCostText = `${ronText(newUnitCostCents)}${
    unit ? `/${unit}` : ""
  }`;

  return {
    message: `Vrei să schimb „${costItem.name}” de la ${oldCostText} la ${newCostText}${
      affected.length
        ? ` (afectează ${affected.length} produs${
            affected.length === 1 ? "" : "e"
          })`
        : " (niciun produs nu îl folosește încă)"
    }?`,

    resultType: "pending_action",

    pendingAction: {
      kind: "UPDATE_COST_ITEM",
      costItemId: costItem.id,
      costItemName: costItem.name,

      summary: `${costItem.name}: ${oldCostText} → ${newCostText}`,

      before: {
        unitCostCents: oldUnitCostCents,
        unit: costItem.unit || null,
      },

      after: {
        unitCostCents: newUnitCostCents,
        unit: unit || null,
      },

      affectedCount: affected.length,
      affectedProducts: affected.slice(0, 10),
    },
  };
}
