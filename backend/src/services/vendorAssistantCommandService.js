// backend/src/services/vendorAssistantCommandService.js

/*
 * Logica de clasificare + extragere + construire de răspunsuri
 * pentru Vendor Assistant (comenzi conversaționale despre
 * Costuri & Profit / editare produs). Extras din fostul
 * vendorAssistantCommandsRoutes.js (era un singur fișier de
 * ~2900 linii, rută + logică amestecate) - separarea urmează
 * exact tiparul deja folosit de costProfitService.js: nimic din
 * stratul de rută (req/res) nu ajunge aici, doar funcții pure
 * (vendorId, params) -> rezultat. Stratul de rută rămâne în
 * vendorAssistantCommandsRoutes.js, acum doar validare de
 * request + apel către funcțiile de mai jos.
 */

import { prisma } from "../db.js";
import { getActivePlanForVendor } from "../payments/marketplaceCalc.js";
import { findBestMatch, findMatchingItems } from "../lib/textMatch.js";
import { scoreTextMatch } from "../lib/textRelevance.js";

import {
  formatCosting,
  costingToCostDraft,
  findProductsUsingCostItem,
  listVendorProductProfitability,
  getProductProfitability,
  isReadyToCalculate,
  computePriceRecommendation,
  detectReusableCostItemMention,
  buildUpdateCostItemPendingActionFromMatch,
  computeUnitCostCentsFromExtraction,
  formatCostItem,
} from "./costProfitService.js";

/*
 * HARDENING/UX POLISH: coborât de la 10 la 5 - un picker cu 10
 * rezultate într-un widget de chat îngust e greu de scanat; 5 e
 * consistent cu pragul deja folosit de resolveProductByName pentru
 * dezambiguizare (vezi .slice(0, 5) mai jos în acest fișier).
 */
export const MAX_RESULTS_SHOWN = 5;

/* ======================================================
   Helpers generale
====================================================== */

export function safeJsonParse(text) {
  let raw = String(text || "").trim();

  raw = raw
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    // Încercăm să extragem primul obiect JSON.
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

export function cleanHistory(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const role =
        entry?.role === "assistant"
          ? "assistant"
          : "user";

      const text = String(
        entry?.text || entry?.content || ""
      )
        .trim()
        .slice(0, 1500);

      if (!text) return null;

      return { role, text };
    })
    .filter(Boolean)
    .slice(-10);
}

export function centsToRon(cents) {
  const numeric = Number(cents);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric) / 100;
}

export function ronText(cents) {
  return `${centsToRon(cents).toLocaleString(
    "ro-RO",
    { maximumFractionDigits: 2 }
  )} lei`;
}

/* ======================================================
   Rezolvare produs după nume (vendor-safe)
====================================================== */

/*
 * normalizeSearchText/tokenizeSearchText/scoreTextMatch etc. sunt
 * extrase în backend/src/lib/textRelevance.js (generic, reutilizat
 * și de knowledgeRetrieval.js) - nicio schimbare de comportament,
 * doar relocare + redenumire (fostele nume aveau "Product" în ele
 * deși logica era deja complet generică).
 */
export const PRODUCT_SEARCH_MIN_RELEVANCE_SCORE = 1.8;

/*
 * ENTITY-AWARE (prioritate B din cerință): dacă mesajul NU numește
 * explicit un produs (query gol) DAR pagina curentă are un produs
 * deschis (currentEntity.type PRODUCT/PRODUCT_COSTING), rezolvăm
 * DIRECT către acela - fără fuzzy search, fără ambiguitate posibilă.
 *
 * currentEntity vine din frontend (vezi assistantCopilotRoutes.js) -
 * NU e de încredere pentru autorizare: interogarea de mai jos verifică
 * din nou ownership-ul (service.vendorId), exact ca la orice altă
 * rezolvare de produs. Dacă produsul nu aparține vendorului curent
 * (currentEntity manipulat/stale), pur și simplu nu se găsește nimic
 * și se cade pe fluxul normal de "not_found".
 */
async function resolveProductFromCurrentEntity(
  vendorId,
  currentEntity
) {
  if (
    !currentEntity?.id ||
    (currentEntity.type !== "PRODUCT" &&
      currentEntity.type !== "PRODUCT_COSTING")
  ) {
    return null;
  }

  const product = await prisma.product.findFirst({
    where: {
      id: String(currentEntity.id),
      service: { vendorId },
    },

    select: {
      id: true,
      title: true,
      images: true,
      priceCents: true,

      costing: {
        select: { status: true },
      },
    },
  });

  if (!product) return null;

  return {
    productId: product.id,
    title: product.title,

    image:
      Array.isArray(product.images) && product.images.length
        ? product.images[0]
        : null,

    priceCents: product.priceCents,
    hasCosting: Boolean(product.costing),
    costingStatus: product.costing?.status || null,
  };
}

export async function resolveProductByName(
  vendorId,
  name,
  currentEntity = null
) {
  const query = String(name || "").trim();

  if (!query) {
    const fromPage = await resolveProductFromCurrentEntity(
      vendorId,
      currentEntity
    );

    if (fromPage) {
      return { status: "found", product: fromPage };
    }

    return { status: "not_found" };
  }

  /*
   * Diacriticele fac "contains" la nivel de DB nesigur (Postgres
   * "insensitive" nu ignoră diacriticele fără extensia unaccent,
   * pe care n-o putem adăuga fără migrare) - aducem TOT catalogul
   * vendorului (același tipar ca listVendorProductProfitability)
   * și facem scoring normalizat/token-based în JS.
   */
  const candidates = await prisma.product.findMany(
    {
      where: {
        service: { vendorId },
      },

      select: {
        id: true,
        title: true,
        images: true,
        priceCents: true,

        costing: {
          select: { status: true },
        },
      },
    }
  );

  const ranked = candidates
    .map((p) => ({
      product: p,

      score: scoreTextMatch(
        p.title,
        query
      ),
    }))
    .filter(
      (entry) =>
        entry.score >=
        PRODUCT_SEARCH_MIN_RELEVANCE_SCORE
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.product.title.localeCompare(
          b.product.title,
          "ro"
        )
    )
    .slice(0, 5)
    .map((entry) => entry.product);

  const formatted = ranked.map((p) => ({
    productId: p.id,
    title: p.title,

    image:
      Array.isArray(p.images) && p.images.length
        ? p.images[0]
        : null,

    priceCents: p.priceCents,
    hasCosting: Boolean(p.costing),
    costingStatus: p.costing?.status || null,
  }));

  if (!formatted.length) {
    return { status: "not_found" };
  }

  if (formatted.length === 1) {
    return { status: "found", product: formatted[0] };
  }

  return { status: "ambiguous", products: formatted };
}

/* ======================================================
   1. READ_PROFITABILITY - analiză, strict read-only
====================================================== */

export function getMetricValue(item, metric) {
  switch (metric) {
    case "marginPercent":
      return item.profitMarginPercent;
    case "profit":
      return item.estimatedProfitCents;
    case "totalRealCost":
      return item.totalRealCostCents;
    case "recommendedPrice":
      return item.recommendedPriceCents;
    default:
      return null;
  }
}

export const STANDARD_FILTERS = new Set([
  "no_costing",
  "draft",
  "confirmed",
  "needs_recalculation",
  "below_min_price",
]);

export async function handleReadProfitability(
  vendorId,
  query
) {
  const {
    metric,
    operator,
    value,
    filter,
  } = query || {};

  let items;
  let total;

  if (filter && STANDARD_FILTERS.has(filter) && !metric) {
    const result = await getProductProfitability({
      vendorId,
      filter,
      sortBy: "name",
      sortDir: "asc",
      page: 1,
      pageSize: 200,
    });

    items = result.items;
    total = result.total;
  } else {
    items = await listVendorProductProfitability(
      vendorId
    );

    if (filter && STANDARD_FILTERS.has(filter)) {
      items = items.filter((item) => {
        if (filter === "no_costing")
          return !item.hasCosting;
        if (filter === "draft")
          return item.costingStatus === "DRAFT";
        if (filter === "confirmed")
          return (
            item.costingStatus === "CONFIRMED"
          );
        if (filter === "needs_recalculation")
          return item.needsRecalculation === true;
        if (filter === "below_min_price")
          return (
            item.hasCosting &&
            item.minPriceCents > 0 &&
            item.priceCents < item.minPriceCents
          );
        return true;
      });
    }

    if (
      metric &&
      operator &&
      ["lt", "lte", "gt", "gte"].includes(operator) &&
      Number.isFinite(Number(value))
    ) {
      const numericValue = Number(value);

      items = items.filter((item) => {
        const metricValue = getMetricValue(
          item,
          metric
        );

        if (metricValue === null) return false;

        if (operator === "lt")
          return metricValue < numericValue;
        if (operator === "lte")
          return metricValue <= numericValue;
        if (operator === "gt")
          return metricValue > numericValue;
        return metricValue >= numericValue;
      });
    }

    if (
      metric &&
      (operator === "top" || operator === "bottom")
    ) {
      items = [...items].sort((a, b) => {
        const av =
          getMetricValue(a, metric) ?? -Infinity;
        const bv =
          getMetricValue(b, metric) ?? -Infinity;

        return operator === "top"
          ? bv - av
          : av - bv;
      });
    }

    total = items.length;
  }

  const limit =
    operator === "top" || operator === "bottom"
      ? 1
      : MAX_RESULTS_SHOWN;

  const shown = items.slice(0, limit);

  if (!shown.length) {
    return {
      message:
        "Nu am găsit produse care să corespundă acestei căutări.",

      resultType: "answer",
    };
  }

  const summaryLines = shown
    .slice(0, MAX_RESULTS_SHOWN)
    .map((item) => {
      const marginText =
        item.profitMarginPercent != null
          ? `${item.profitMarginPercent}% marjă`
          : "fără costing";

      return `„${item.title}” — preț ${ronText(
        item.priceCents
      )}, ${marginText}`;
    })
    .join("\n");

  return {
    message: `Am găsit ${total} produs${
      total === 1 ? "" : "e"
    }${
      total > shown.length
        ? `, arăt primele ${shown.length}`
        : ""
    }:\n\n${summaryLines}`,

    resultType: "results_list",
    results: shown.slice(0, MAX_RESULTS_SHOWN),
    totalResults: total,
  };
}

/* ======================================================
   2. READ_PRODUCT_COST - strict read-only
====================================================== */

export async function handleReadProductCost(
  vendorId,
  productName,
  currentEntity = null
) {
  const resolved = await resolveProductByName(
    vendorId,
    productName,
    currentEntity
  );

  if (resolved.status === "not_found") {
    return {
      message: productName
        ? `Nu am găsit niciun produs cu numele „${productName}”.`
        : "Spune-mi numele produsului despre care vrei informații.",

      resultType: "answer",
    };
  }

  if (resolved.status === "ambiguous") {
    return {
      message: `Am găsit mai multe produse pentru „${productName}”. Care anume?`,
      resultType: "disambiguation",

      disambiguation: {
        commandType: "READ_PRODUCT_COST",
        products: resolved.products,
        params: {},
      },
    };
  }

  return buildProductCostAnswer(
    resolved.product
  );
}

export async function buildProductCostAnswer(product) {
  const costing =
    await prisma.productCosting.findUnique({
      where: { productId: product.productId },
      include: { items: true },
    });

  const formatted = formatCosting(costing);

  if (!formatted || !formatted.pricing) {
    return {
      message: `„${product.title}” nu are încă un costing calculat.`,
      resultType: "answer",
    };
  }

  const p = formatted.pricing;

  return {
    message:
      `„${product.title}”:\n` +
      `Cost total real: ${ronText(
        p.totalRealCost * 100
      )}\n` +
      `Preț minim: ${ronText(
        p.minPrice * 100
      )}\n` +
      `Preț recomandat: ${ronText(
        p.recommendedPrice * 100
      )}\n` +
      `Profit estimat: ${ronText(
        p.estimatedProfit * 100
      )}\n` +
      `Îți rămâne (după comision): ${ronText(
        p.vendorNetAfterCommission * 100
      )}\n` +
      `Status costing: ${
        formatted.status === "CONFIRMED"
          ? "confirmat"
          : "ciornă"
      }${
        formatted.needsRecalculation
          ? " (necesită recalculare)"
          : ""
      }`,

    resultType: "answer",
  };
}

/* ======================================================
   3. READ_LIBRARY - strict read-only
====================================================== */

export async function handleReadLibrary(vendorId) {
  const items = await prisma.vendorCostItem.findMany({
    where: {
      vendorId,
      isActive: true,
    },

    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  if (!items.length) {
    return {
      message:
        "Nu ai încă niciun cost salvat în bibliotecă.",

      resultType: "answer",
    };
  }

  const formatted = items.map(formatCostItem);
  const shown = formatted.slice(0, MAX_RESULTS_SHOWN);

  const lines = shown
    .map(
      (item) =>
        `${item.name} — ${item.unitCost} lei${
          item.unit ? `/${item.unit}` : ""
        }`
    )
    .join("\n");

  return {
    message: `Ai ${formatted.length} costuri salvate${
      formatted.length > shown.length
        ? `, arăt primele ${shown.length}`
        : ""
    }:\n\n${lines}`,

    resultType: "library_list",
    results: shown,
    totalResults: formatted.length,
  };
}

/* ======================================================
   4. UPDATE_COST_ITEM - propune, NU scrie în DB
====================================================== */

/*
 * costItem (când vine din Prisma direct, ex. în /resolve) e
 * întotdeauna rândul BRUT (unitCostCents, Int, cenți) - NU are
 * un câmp "unitCost" în lei. before/after folosesc peste tot
 * unitCostCents + unit; conversia cents -> lei pentru mesaj se
 * face în costProfitService.js, o singură dată - UI-ul
 * (PendingActionCard) face aceeași conversie separat, din
 * unitCostCents, niciodată dintr-un câmp "unitCost" deja în lei.
 */
export async function handleUpdateCostItem(
  vendorId,
  params
) {
  const { costItemName, newUnitCostLei, newUnit } =
    params || {};

  if (
    !costItemName ||
    !Number.isFinite(Number(newUnitCostLei)) ||
    Number(newUnitCostLei) < 0
  ) {
    return {
      message:
        "Spune-mi numele costului din bibliotecă și noul preț, în lei.",

      resultType: "answer",
    };
  }

  const costItems = await prisma.vendorCostItem.findMany(
    {
      where: { vendorId, isActive: true },
    }
  );

  const matches = findMatchingItems(
    costItemName,
    costItems,
    { nameField: "name" }
  );

  if (!matches.length) {
    /*
     * Nu există încă în bibliotecă - în loc de un răspuns fără
     * ieșire, propunem crearea lui (detectare automată a
     * elementelor reutilizabile noi, cerută explicit de vendor).
     */
    return detectReusableCostItemMention({
      vendorId,
      name: costItemName,
      type: "MATERIAL",
      unit: newUnit,
      unitCostLei: newUnitCostLei,
    });
  }

  if (
    matches.length > 1 &&
    matches[0].score - matches[1].score < 0.1
  ) {
    return {
      message: `Am găsit mai multe costuri asemănătoare cu „${costItemName}”. Care anume?`,
      resultType: "disambiguation",

      disambiguation: {
        commandType: "UPDATE_COST_ITEM",

        costItems: matches
          .slice(0, 5)
          .map(({ item }) =>
            formatCostItem(item)
          ),

        /*
         * Formă unificată de params, folosită la fel de
         * /resolve pentru ORICE dezambiguizare UPDATE_COST_ITEM -
         * fie din comanda explicită "schimbă X" (aici), fie din
         * detectarea automată a unei achiziții (2kg cu 100 lei) -
         * vezi detectReusableCostItemMention. /resolve recalculează
         * mereu costul unitar cu computeUnitCostCentsFromExtraction,
         * normalizat la unitatea item-ului ales abia după alegere -
         * nu putem normaliza corect înainte, când nu știm încă ce
         * unitate are item-ul din bibliotecă.
         */
        params: {
          unitCostLei: newUnitCostLei,
          unit: newUnit || null,
        },
      },
    };
  }

  return buildUpdateCostItemPendingActionFromMatch(
    matches[0].item,
    Math.round(Number(newUnitCostLei) * 100),
    newUnit,
    vendorId
  );
}

/* ======================================================
   4b. CREATE_COST_ITEM - detectare automată a elementelor
   reutilizabile menționate liber (materiale/ambalaje/tarife),
   care nu există încă în bibliotecă sau au un cost diferit.

   LLM-ul doar extrage (nume, tip, unitate, cost pe unitate SAU
   cantitate+cost total la achiziție) - toată logica de
   potrivire/calcul e în costProfitService.js.
====================================================== */

export async function handleCreateCostItem(
  vendorId,
  detection
) {
  const name = String(
    detection?.name || ""
  ).trim();

  if (!name) {
    return {
      message:
        "Ce material, ambalaj sau tarif vrei să adaug în bibliotecă?",

      resultType: "answer",
    };
  }

  const result = await detectReusableCostItemMention({
    vendorId,
    name,
    type: detection?.type,
    unit: detection?.unit,
    unitCostLei: detection?.unitCostLei,
    purchaseQuantity: detection?.purchaseQuantity,
    purchaseUnit: detection?.purchaseUnit,
    purchaseTotalCostLei:
      detection?.purchaseTotalCostLei,
  });

  if (!result) {
    return {
      message: `„${name}” e deja în bibliotecă, la același cost - nu am nimic de schimbat.`,
      resultType: "answer",
    };
  }

  return result;
}

/* ======================================================
   5. RECALCULATE_BATCH - propune, NU recalculează încă
====================================================== */

export async function handleRecalculateBatch(
  vendorId,
  params,
  currentEntity = null
) {
  const {
    recalculateTarget,
    costItemNameForRecalc,
  } = params || {};

  let affected = [];
  let targetDescription = "cu costuri neactualizate";

  if (
    recalculateTarget === "current_product"
  ) {
    /*
     * ENTITY-AWARE (pronume: "recalculează-l") - UN SINGUR produs,
     * cel din pagina curentă. Ownership verificat din nou aici
     * (service.vendorId), currentEntity fiind doar hint.
     */
    const fromPage = await resolveProductFromCurrentEntity(
      vendorId,
      currentEntity
    );

    if (!fromPage) {
      return {
        message:
          "Nu știu la ce produs te referi - deschide produsul dorit sau spune-mi numele lui.",

        resultType: "answer",
      };
    }

    affected = [
      { productId: fromPage.productId, title: fromPage.title },
    ];

    targetDescription = `„${fromPage.title}”`;
  } else if (
    recalculateTarget === "cost_item" &&
    costItemNameForRecalc
  ) {
    const costItems =
      await prisma.vendorCostItem.findMany({
        where: { vendorId, isActive: true },
      });

    const match = findBestMatch(
      costItemNameForRecalc,
      costItems,
      { nameField: "name" }
    );

    if (!match) {
      return {
        message: `Nu am găsit niciun cost cu numele „${costItemNameForRecalc}” în bibliotecă.`,
        resultType: "answer",
      };
    }

    affected = await findProductsUsingCostItem(
      match.id,
      vendorId
    );

    targetDescription = `care folosesc „${match.name}”`;
  } else {
    const result = await getProductProfitability({
      vendorId,
      filter: "needs_recalculation",
      sortBy: "name",
      sortDir: "asc",
      page: 1,
      pageSize: 200,
    });

    affected = result.items.map((item) => ({
      productId: item.productId,
      title: item.title,
    }));
  }

  if (!affected.length) {
    return {
      message: `Nu am găsit produse ${targetDescription}.`,
      resultType: "answer",
    };
  }

  return {
    message: `Am găsit ${affected.length} produs${
      affected.length === 1 ? "" : "e"
    } ${targetDescription}. Confirmă și le recalculez determinist.`,

    resultType: "pending_action",

    pendingAction: {
      kind: "RECALCULATE_BATCH",

      summary: `Recalculează ${affected.length} produs${
        affected.length === 1 ? "" : "e"
      } ${targetDescription}`,

      productIds: affected.map(
        (item) => item.productId
      ),

      affectedCount: affected.length,
      affectedProducts: affected.slice(0, 10),
    },
  };
}

/* ======================================================
   6. UPDATE_PRODUCT_COSTING - propune, NU salvează

   Reutilizează costingToCostDraft/computePriceRecommendation
   din costProfitService.js - nicio formulă nouă.
====================================================== */

export function applyCostingChangesToDraft(
  costDraft,
  changes
) {
  const draft = {
    ...costDraft,
    materials: [...costDraft.materials],
    otherCosts: [...costDraft.otherCosts],
  };

  const notes = [];

  if (changes?.addMaterial?.name) {
    draft.materials.push({
      name: changes.addMaterial.name,

      quantity:
        Number(changes.addMaterial.quantity) ||
        1,

      unit: changes.addMaterial.unit || "",

      unitCost:
        Number(
          changes.addMaterial.unitCostLei
        ) || 0,

      costItemId: null,
    });

    notes.push(
      `+ material „${changes.addMaterial.name}”`
    );
  }

  if (changes?.removeMaterialByName) {
    const match = findBestMatch(
      changes.removeMaterialByName,
      draft.materials,
      { nameField: "name" }
    );

    if (match) {
      draft.materials = draft.materials.filter(
        (m) => m !== match
      );

      notes.push(
        `- material „${match.name}”`
      );
    }
  }

  if (changes?.setLaborHours != null) {
    notes.push(
      `ore de lucru: ${draft.laborHours ?? "—"} → ${changes.setLaborHours}`
    );

    draft.laborHours = Number(
      changes.setLaborHours
    );
  }

  if (changes?.setHourlyRateLei != null) {
    notes.push(
      `valoare oră: ${draft.hourlyRate ?? "—"} → ${changes.setHourlyRateLei} lei`
    );

    draft.hourlyRate = Number(
      changes.setHourlyRateLei
    );
  }

  if (changes?.setDesiredProfitPercent != null) {
    draft.desiredProfit = {
      type: "percent",
      value: Number(
        changes.setDesiredProfitPercent
      ),
    };

    notes.push(
      `profit dorit: ${changes.setDesiredProfitPercent}%`
    );
  } else if (
    changes?.setDesiredProfitAmountLei != null
  ) {
    draft.desiredProfit = {
      type: "amount",
      value: Number(
        changes.setDesiredProfitAmountLei
      ),
    };

    notes.push(
      `profit dorit: ${changes.setDesiredProfitAmountLei} lei`
    );
  }

  if (changes?.addOtherCost?.label) {
    draft.otherCosts.push({
      label: changes.addOtherCost.label,

      amount:
        Number(
          changes.addOtherCost.amountLei
        ) || 0,

      costItemId: null,
    });

    notes.push(
      `+ cost „${changes.addOtherCost.label}”`
    );
  }

  if (changes?.removeOtherCostByLabel) {
    const match = findBestMatch(
      changes.removeOtherCostByLabel,
      draft.otherCosts,
      { nameField: "label" }
    );

    if (match) {
      draft.otherCosts = draft.otherCosts.filter(
        (o) => o !== match
      );

      notes.push(
        `- cost „${match.label}”`
      );
    }
  }

  if (changes?.setPackagingCostLei != null) {
    notes.push(
      `ambalaj: ${draft.packagingCost ?? 0} → ${changes.setPackagingCostLei} lei`
    );

    draft.packagingCost = Number(
      changes.setPackagingCostLei
    );
  }

  if (changes?.removePackaging) {
    draft.packagingCost = 0;
    draft.packagingCostItemId = null;
    notes.push("- ambalaj");
  }

  return { draft, notes };
}

export async function buildUpdateCostingPendingAction(
  product,
  changes,
  vendorId
) {
  const existingCosting =
    await prisma.productCosting.findUnique({
      where: { productId: product.productId },
      include: { items: true },
    });

  /*
   * Fără costing salvat, nu are sens să propunem un diff
   * "înainte/după" pornind de la un draft gol - cerem
   * explicit acordul de a porni calculatorul conversațional
   * pentru acest produs (vezi kind: START_CALCULATOR_FOR_PRODUCT,
   * tratat de frontend fără niciun apel de scriere - doar
   * deschide VendorPriceCalculator după confirmare).
   */
  if (!existingCosting) {
    return {
      message: `„${product.title}” nu are încă un costing salvat. Vrei să îl calculăm acum?`,

      resultType: "pending_action",

      pendingAction: {
        kind: "START_CALCULATOR_FOR_PRODUCT",
        productId: product.productId,
        productTitle: product.title,

        summary: `Pornește calculatorul pentru „${product.title}”`,
      },
    };
  }

  const currentDraft = costingToCostDraft(
    existingCosting
  );

  const { draft: newDraft, notes } =
    applyCostingChangesToDraft(
      currentDraft,
      changes
    );

  if (!notes.length) {
    return {
      message:
        "Nu am înțeles clar ce vrei să schimb la costing. Poți reformula?",

      resultType: "answer",
    };
  }

  const plan = await getActivePlanForVendor(
    vendorId
  );

  const commissionBps = Number.isFinite(
    Number(plan?.commissionBps)
  )
    ? Number(plan.commissionBps)
    : 0;

  const beforeReady =
    isReadyToCalculate(currentDraft);

  const afterReady = isReadyToCalculate(newDraft);

  const beforeCalc = beforeReady
    ? computePriceRecommendation({
        costDraft: currentDraft,
        commissionBps,
      })
    : null;

  const afterCalc = afterReady
    ? computePriceRecommendation({
        costDraft: newDraft,
        commissionBps,
      })
    : null;

  return {
    message: `La „${product.title}”: ${notes.join(
      ", "
    )}.${
      afterCalc
        ? ` Preț recomandat nou: ${ronText(
            afterCalc.recommendedPriceCents
          )}.`
        : ""
    } Confirmi?`,

    resultType: "pending_action",

    pendingAction: {
      kind: "UPDATE_PRODUCT_COSTING",
      productId: product.productId,
      productTitle: product.title,

      summary: notes.join(", "),
      costDraft: newDraft,

      before: beforeCalc
        ? {
            totalRealCost: centsToRon(
              beforeCalc.totalRealCostCents
            ),
            recommendedPrice: centsToRon(
              beforeCalc.recommendedPriceCents
            ),
            estimatedProfit: centsToRon(
              beforeCalc.estimatedProfitCents
            ),
          }
        : null,

      after: afterCalc
        ? {
            totalRealCost: centsToRon(
              afterCalc.totalRealCostCents
            ),
            recommendedPrice: centsToRon(
              afterCalc.recommendedPriceCents
            ),
            estimatedProfit: centsToRon(
              afterCalc.estimatedProfitCents
            ),
          }
        : null,
    },
  };
}

export async function handleUpdateProductCosting(
  vendorId,
  productName,
  changes,
  currentEntity = null
) {
  const resolved = await resolveProductByName(
    vendorId,
    productName,
    currentEntity
  );

  if (resolved.status === "not_found") {
    return {
      message: productName
        ? `Nu am găsit niciun produs cu numele „${productName}”.`
        : "Pentru ce produs vrei să modific costingul?",

      resultType: "answer",
    };
  }

  if (resolved.status === "ambiguous") {
    return {
      message: `Am găsit mai multe produse pentru „${productName}”. Care anume?`,
      resultType: "disambiguation",

      disambiguation: {
        commandType: "UPDATE_PRODUCT_COSTING",
        products: resolved.products,
        params: { costingChanges: changes },
      },
    };
  }

  return buildUpdateCostingPendingAction(
    resolved.product,
    changes,
    vendorId
  );
}

/* ======================================================
   7. APPLY_RECOMMENDED_PRICE - propune, NU scrie încă
====================================================== */

export async function buildApplyPricePendingAction(
  product
) {
  const costing =
    await prisma.productCosting.findUnique({
      where: { productId: product.productId },
    });

  if (!costing || !costing.lastCalculatedAt) {
    return {
      message: `„${product.title}” nu are încă un preț recomandat calculat.`,
      resultType: "answer",
    };
  }

  const diffCents =
    costing.recommendedPriceCents -
    product.priceCents;

  const diffPercent =
    product.priceCents > 0
      ? Math.round(
          (diffCents / product.priceCents) * 1000
        ) / 10
      : null;

  const isStale =
    costing.status !== "CONFIRMED" ||
    costing.needsRecalculation === true;

  return {
    message:
      `„${product.title}” — preț actual ${ronText(
        product.priceCents
      )}, preț recomandat ${ronText(
        costing.recommendedPriceCents
      )} (diferență ${
        diffCents >= 0 ? "+" : ""
      }${ronText(diffCents)}${
        diffPercent != null
          ? `, ${diffPercent}%`
          : ""
      }).${
        isStale
          ? " Atenție: costing-ul nu este confirmat sau are costuri neactualizate - va trebui să confirmi explicit că vrei să aplici oricum."
          : ""
      } Confirmi aplicarea prețului recomandat?`,

    resultType: "pending_action",

    pendingAction: {
      kind: "APPLY_RECOMMENDED_PRICE",
      productId: product.productId,
      productTitle: product.title,

      currentPriceCents: product.priceCents,

      recommendedPriceCents:
        costing.recommendedPriceCents,

      diffCents,
      diffPercent,

      estimatedProfit: centsToRon(
        costing.estimatedProfitCents
      ),

      vendorNetAfterCommission: centsToRon(
        costing.vendorNetCents
      ),

      costingStatus: costing.status,
      needsRecalculation:
        costing.needsRecalculation,
      isStale,
    },
  };
}

export async function handleApplyRecommendedPrice(
  vendorId,
  productName,
  currentEntity = null
) {
  const resolved = await resolveProductByName(
    vendorId,
    productName,
    currentEntity
  );

  if (resolved.status === "not_found") {
    return {
      message: productName
        ? `Nu am găsit niciun produs cu numele „${productName}”.`
        : "Pentru ce produs vrei să aplic prețul recomandat?",

      resultType: "answer",
    };
  }

  if (resolved.status === "ambiguous") {
    return {
      message: `Am găsit mai multe produse pentru „${productName}”. Care anume?`,
      resultType: "disambiguation",

      disambiguation: {
        commandType: "APPLY_RECOMMENDED_PRICE",
        products: resolved.products,
        params: {},
      },
    };
  }

  return buildApplyPricePendingAction(
    resolved.product
  );
}

/* ======================================================
   8. CALCULATE_PRICE_GENERIC - deschide calculatorul
   conversațional existent (VendorPriceCalculator), nu
   scrie nimic aici. Dacă e menționat un produs, îl rezolvăm
   determinist (search vendor-safe deja existent) în loc să
   lăsăm frontend-ul să reextragă numele din text - LLM-ul
   e mai bun la asta decât regexuri client-side.
====================================================== */

export async function handleCalculatePriceGeneric(
  vendorId,
  productName,
  currentEntity = null
) {
  if (!productName) {
    /*
     * ENTITY-AWARE: fără nume explicit în mesaj, dacă pagina
     * curentă are un produs deschis, deschidem calculatorul DIRECT
     * pentru acela, nu pe cel generic.
     */
    const fromPage = await resolveProductFromCurrentEntity(
      vendorId,
      currentEntity
    );

    if (fromPage) {
      return {
        resultType: "open_calculator",
        productId: fromPage.productId,

        message: `Hai să calculăm. Deschid calculatorul de preț pentru „${fromPage.title}”.`,
      };
    }

    return {
      resultType: "open_calculator",
      productId: null,

      message:
        "Hai să calculăm. Deschid calculatorul de preț.",
    };
  }

  const resolved = await resolveProductByName(
    vendorId,
    productName,
    currentEntity
  );

  if (resolved.status === "not_found") {
    return {
      message: `Nu am găsit niciun produs cu numele „${productName}”. Deschid calculatorul general - poți continua conversația acolo.`,

      resultType: "open_calculator",
      productId: null,
    };
  }

  if (resolved.status === "ambiguous") {
    return {
      message: `Am găsit mai multe produse pentru „${productName}”. Care anume?`,
      resultType: "disambiguation",

      disambiguation: {
        commandType: "CALCULATE_PRICE_GENERIC",
        products: resolved.products,
        params: {},
      },
    };
  }

  return {
    message: `Deschid calculatorul pentru „${resolved.product.title}”.`,

    resultType: "open_calculator",
    productId: resolved.product.productId,
  };
}

/* ======================================================
   9. UPDATE_PRODUCT - modificare directă a câmpurilor
   PUBLICE ale unui produs (titlu, preț de vânzare, stoc,
   disponibilitate, vizibilitate, descriere, categorie,
   material etc.), NU a draftului de cost (acela e
   UPDATE_PRODUCT_COSTING).

   Whitelist strictă - LLM-ul poate completa DOAR aceste
   câmpuri; orice altceva din productUpdate e ignorat aici,
   determinist, indiferent ce a "inventat" modelul. Scriere
   propriu-zisă NICIODATĂ aici - doar se construiește
   pendingAction; confirmarea (din frontend) reutilizează
   STRICT endpoint-ul existent PUT /api/vendor/products/:id
   (updateProduct din vendorProductRoutes.js), cu ACELAȘI
   shape de body ca formularul normal de editare - nicio
   logică de business/validare nu e duplicată aici.

   Explicit EXCLUSE (nu apar în whitelist, deci nu pot fi
   scrise prin acest flow, indiferent ce ar încerca AI-ul):
   id, vendorId/serviceId, ownership, commission/payment,
   images, moderationStatus și restul câmpurilor de
   moderare/admin, orderMode + schema-urile de comandă
   (optionsSchema/customSchema/repeatedGroups/quoteSchema -
   prea complexe/structurate pentru text liber), currency.
====================================================== */

export const PRODUCT_UPDATE_ALLOWED_FIELDS = new Set([
  "title",
  "description",
  "price",
  "category",
  "materialMain",
  "technique",
  "color",
  "dimensions",
  "styleTags",
  "occasionTags",
  "careInstructions",
  "specialNotes",
  "availability",
  "readyQty",
  "leadTimeDays",
  "nextShipDate",
  "isHidden",
]);

export const PRODUCT_UPDATE_NUMERIC_FIELDS = new Set([
  "price",
  "readyQty",
  "leadTimeDays",
]);

/*
 * Câmpuri text LIBERE, fără validare de tip/enum pe server -
 * pentru acestea, răspunsul brut al vânzătorului la întrebarea de
 * clarificare POATE fi folosit direct ca valoare (plasă de
 * siguranță determinist, vezi handleUpdateProduct). Exclus
 * DELIBERAT: category/color (validate contra un set fix pe
 * server - nu orice text e o valoare validă), availability/
 * isHidden (enum/boolean, nu text liber) și nextShipDate
 * (necesită parsare de dată) - acelea rămân strict în seama
 * extragerii LLM.
 */
export const PRODUCT_UPDATE_FREE_TEXT_FIELDS = new Set([
  "title",
  "description",
  "materialMain",
  "technique",
  "dimensions",
  "styleTags",
  "occasionTags",
  "careInstructions",
  "specialNotes",
]);

export const PRODUCT_FIELD_LABELS = {
  title: "Titlu",
  description: "Descriere",
  price: "Preț",
  category: "Categorie",
  materialMain: "Material principal",
  technique: "Tehnică",
  color: "Culoare",
  dimensions: "Dimensiuni",
  styleTags: "Stil",
  occasionTags: "Ocazie",
  careInstructions: "Instrucțiuni de îngrijire",
  specialNotes: "Note speciale",
  availability: "Disponibilitate",
  readyQty: "Stoc disponibil",
  leadTimeDays: "Timp de realizare (zile)",
  nextShipDate: "Dată de expediere",
  isHidden: "Vizibilitate",
};

/*
 * Formă articulată corectă gramatical ("prețul", nu "preț"), DOAR
 * pentru fraza "Pentru ce produs vrei să modific ___?" - un simplu
 * .toLowerCase() pe PRODUCT_FIELD_LABELS ar suna greșit ("modific
 * preț?" în loc de "modific prețul?").
 */
export const PRODUCT_FIELD_LABELS_ARTICULATED = {
  title: "titlul",
  description: "descrierea",
  price: "prețul",
  category: "categoria",
  materialMain: "materialul principal",
  technique: "tehnica",
  color: "culoarea",
  dimensions: "dimensiunile",
  styleTags: "stilul",
  occasionTags: "ocazia",
  careInstructions:
    "instrucțiunile de îngrijire",
  specialNotes: "nota specială",
  availability: "disponibilitatea",
  readyQty: "stocul",
  leadTimeDays: "timpul de realizare",
  nextShipDate: "data de expediere",
  isHidden: "vizibilitatea",
};

export const PRODUCT_FIELD_QUESTIONS = {
  title: "Care e noul titlu?",
  description: "Care e noua descriere?",
  price: "Care este noul preț, în lei?",
  category: "Care este noua categorie?",
  materialMain: "Care este materialul principal?",
  technique: "Care este tehnica folosită?",
  color: "Ce culoare vrei să setez?",
  dimensions: "Care sunt dimensiunile?",
  styleTags: "Ce stil vrei să adaugi?",
  occasionTags: "Pentru ce ocazie e potrivit?",
  careInstructions:
    "Ce instrucțiuni de îngrijire vrei să adaugi?",
  specialNotes: "Ce notă specială vrei să adaugi?",
  availability:
    "Care e noua disponibilitate - pregătit de livrare, la comandă, precomandă sau stoc epuizat?",
  readyQty: "Câte bucăți vrei să pui în stoc?",
  leadTimeDays:
    "În câte zile poți realiza produsul?",
  nextShipDate: "Care e noua dată de expediere?",
  isHidden:
    "Vrei să ascund produsul sau să-l arăt din nou?",
};

export const AVAILABILITY_LABELS = {
  READY: "Pregătit de livrare",
  MADE_TO_ORDER: "La comandă",
  PREORDER: "Precomandă",
  SOLD_OUT: "Stoc epuizat",
};

export function buildProductFieldQuestion(
  field,
  productTitle
) {
  const base =
    PRODUCT_FIELD_QUESTIONS[field] ||
    "Ce valoare vrei să setez?";

  return productTitle
    ? `${base} (${productTitle})`
    : base;
}

export function buildProductPreview(product) {
  if (!product) return null;

  return {
    title: product.title,

    image:
      Array.isArray(product.images) &&
      product.images.length
        ? product.images[0]
        : null,

    priceCents: product.priceCents,
  };
}

export function formatProductFieldValue(field, value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return field === "isHidden"
      ? "vizibil"
      : "—";
  }

  if (field === "price") {
    return ronText(
      Math.round(Number(value) * 100)
    );
  }

  if (field === "isHidden") {
    return value ? "ascuns" : "vizibil";
  }

  if (field === "availability") {
    return (
      AVAILABILITY_LABELS[value] ||
      String(value)
    );
  }

  if (field === "nextShipDate") {
    try {
      return new Date(
        value
      ).toLocaleDateString("ro-RO");
    } catch {
      return String(value);
    }
  }

  if (Array.isArray(value)) {
    return value.length
      ? value.join(", ")
      : "—";
  }

  return String(value);
}

export function extractFirstNumber(text) {
  const match = String(text || "").match(
    /-?\d+([.,]\d+)?/
  );

  if (!match) return null;

  const numeric = Number(
    match[0].replace(",", ".")
  );

  return Number.isFinite(numeric)
    ? numeric
    : null;
}

/*
 * Whitelist STRICTĂ, aplicată determinist - orice cheie din
 * productUpdate care NU e în PRODUCT_UPDATE_ALLOWED_FIELDS e
 * ignorată silențios aici, indiferent ce a extras LLM-ul.
 */
export function buildWhitelistedProductPatch(
  productUpdate
) {
  const patch = {};

  const source =
    productUpdate &&
    typeof productUpdate === "object"
      ? productUpdate
      : {};

  for (const field of PRODUCT_UPDATE_ALLOWED_FIELDS) {
    const value = source[field];

    if (value === null || value === undefined) {
      continue;
    }

    if (
      typeof value === "string" &&
      !value.trim()
    ) {
      continue;
    }

    patch[field] = value;
  }

  return patch;
}

export async function loadOwnedProductForUpdate(
  vendorId,
  productId
) {
  if (!productId) return null;

  const product = await prisma.product.findUnique(
    {
      where: { id: String(productId) },

      select: {
        id: true,
        title: true,
        description: true,
        priceCents: true,
        images: true,
        category: true,
        color: true,
        materialMain: true,
        technique: true,
        styleTags: true,
        occasionTags: true,
        dimensions: true,
        careInstructions: true,
        specialNotes: true,
        availability: true,
        readyQty: true,
        leadTimeDays: true,
        nextShipDate: true,
        isHidden: true,

        service: {
          select: { vendorId: true },
        },
      },
    }
  );

  if (
    !product ||
    product.service?.vendorId !== vendorId
  ) {
    return null;
  }

  return product;
}

export function getProductFieldBeforeValue(
  product,
  field
) {
  if (field === "price") {
    return centsToRon(product.priceCents);
  }

  return product[field];
}

/*
 * Notă informativă (NU blocantă) - dacă vânzătorul schimbă
 * readyQty/leadTimeDays/nextShipDate fără să schimbe și
 * disponibilitatea, iar produsul e momentan pe alt tip de
 * disponibilitate, endpoint-ul real de update ar putea ignora
 * schimbarea (readyQty contează doar pentru READY etc.) -
 * atenționăm vendorul înainte de confirmare, în loc să eșueze
 * tăcut.
 */
export function buildAvailabilityMismatchWarning(
  product,
  patch
) {
  const requiredByField = {
    readyQty: "READY",
    leadTimeDays: "MADE_TO_ORDER",
    nextShipDate: "PREORDER",
  };

  for (const [
    field,
    required,
  ] of Object.entries(requiredByField)) {
    if (
      patch[field] !== undefined &&
      patch.availability === undefined &&
      product.availability !== required
    ) {
      return `Atenție: produsul e setat pe „${
        AVAILABILITY_LABELS[
          product.availability
        ] || product.availability
      }”, nu pe „${
        AVAILABILITY_LABELS[required]
      }” - schimbarea s-ar putea să nu aibă efect vizibil decât dacă schimbi și disponibilitatea.`;
    }
  }

  return null;
}

export async function buildUpdateProductPendingAction(
  product,
  patch
) {
  const changes = Object.keys(patch).map(
    (field) => ({
      field,
      label:
        PRODUCT_FIELD_LABELS[field] || field,

      before: formatProductFieldValue(
        field,
        getProductFieldBeforeValue(
          product,
          field
        )
      ),

      after: formatProductFieldValue(
        field,
        patch[field]
      ),
    })
  );

  const summary = changes
    .map(
      (change) =>
        `${change.label}: ${change.before} → ${change.after}`
    )
    .join("; ");

  const warning =
    buildAvailabilityMismatchWarning(
      product,
      patch
    );

  return {
    message: `Vrei să actualizez „${
      product.title
    }” - ${summary}?${
      warning ? ` ${warning}` : ""
    }`,

    resultType: "pending_action",

    pendingAction: {
      kind: "UPDATE_PRODUCT",
      productId: product.id,
      productTitle: product.title,
      productPreview: buildProductPreview(product),
      summary,
      changes,
      patch,
    },
  };
}

export async function handleUpdateProduct(
  vendorId,
  params
) {
  const {
    productName,
    productUpdate,
    missingUpdateField,
    knownProductId,
    rawMessage,
    currentEntity,
  } = params || {};

  let product = knownProductId
    ? await loadOwnedProductForUpdate(
        vendorId,
        knownProductId
      )
    : null;

  if (!product) {
    const resolved = await resolveProductByName(
      vendorId,
      productName,
      currentEntity
    );

    if (resolved.status === "not_found") {
      /*
       * "needs_product" (NU "answer") - păstrăm în răspuns
       * missingUpdateField/productUpdate ca frontend-ul să le
       * atașeze în conversationContext (awaitingField: "product")
       * și mesajul URMĂTOR (numele produsului) să fie trimis
       * DIRECT către resolveProductByName, fără să mai treacă
       * prin LLM ca mesaj independent (asta cauza bug-ul cu
       * liste de produse nerelevante).
       */
      const fieldLabel = missingUpdateField
        ? PRODUCT_FIELD_LABELS_ARTICULATED[
            missingUpdateField
          ] || null
        : null;

      return {
        message: productName
          ? `Nu am găsit un produs care să semene cu „${productName}”. Vrei să încerci alt nume?`
          : fieldLabel
            ? `Pentru ce produs vrei să modific ${fieldLabel}?`
            : "Pentru ce produs vrei să modific ceva?",

        resultType: "needs_product",
        missingUpdateField: missingUpdateField || null,
        productUpdate: productUpdate || null,
      };
    }

    if (resolved.status === "ambiguous") {
      return {
        message: `Am găsit mai multe produse pentru „${productName}”. Care anume?`,
        resultType: "disambiguation",

        disambiguation: {
          commandType: "UPDATE_PRODUCT",
          products: resolved.products,

          params: {
            productUpdate,
            missingUpdateField,
          },
        },
      };
    }

    product = await loadOwnedProductForUpdate(
      vendorId,
      resolved.product.productId
    );

    if (!product) {
      return {
        message:
          "Nu am putut încărca produsul.",

        resultType: "answer",
      };
    }
  }

  const patch = buildWhitelistedProductPatch(
    productUpdate
  );

  /*
   * Plasele de siguranță deterministe de mai jos se aplică STRICT
   * doar când suntem într-un răspuns de clarificare (knownProductId
   * era deja cunoscut, deci mesajul curent e chiar răspunsul
   * vânzătorului la "care e noul preț?"/"care e noua descriere?"),
   * NICIODATĂ pe un mesaj de comandă proaspăt - altfel, pe mesajul
   * INIȚIAL "Schimbă descrierea produsului X" (fără valoare încă),
   * am seta descrierea la chiar propoziția-comandă.
   */
  const isClarificationReply = Boolean(
    knownProductId
  );

  /*
   * BUGFIX (audit): plasa de siguranță de mai jos ia rawMessage ca
   * valoare literală pentru câmpuri text libere (titlu/descriere/
   * etc.) când LLM-ul n-a extras nimic. Fără acest guard, dacă
   * vânzătorul renunța ("anulează", "las-o", "stop") în loc să dea
   * o valoare, textul renunțării ajungea scris ca valoare reală a
   * câmpului - o scriere confirmată, dar complet greșită.
   */
  const isCancelReply = Boolean(
    isClarificationReply &&
      rawMessage &&
      /^(anuleaz|renunt|stop|las|opri|gata)\w*\b/i.test(
        String(rawMessage).trim()
      )
  );

  if (isCancelReply) {
    return {
      message: "Am înțeles, nu modific nimic acum.",
      resultType: "answer",
    };
  }

  if (
    Object.keys(patch).length === 0 &&
    missingUpdateField &&
    isClarificationReply &&
    rawMessage
  ) {
    if (
      PRODUCT_UPDATE_NUMERIC_FIELDS.has(
        missingUpdateField
      )
    ) {
      /*
       * Câmp NUMERIC ("80 lei", "5 bucăți") și LLM-ul n-a extras
       * nimic - luăm primul număr din mesaj.
       */
      const numeric =
        extractFirstNumber(rawMessage);

      if (numeric !== null) {
        patch[missingUpdateField] = numeric;
      }
    } else if (
      PRODUCT_UPDATE_FREE_TEXT_FIELDS.has(
        missingUpdateField
      )
    ) {
      /*
       * Câmp text LIBER (titlu/descriere/material/tehnică/etc.) -
       * dacă LLM-ul n-a completat productUpdate din vreun motiv,
       * răspunsul brut ESTE chiar valoarea dorită (nu mai e nimic
       * de "extras" - vânzătorul a răspuns direct la întrebare).
       * Exclus determinist pentru category/color (validate contra
       * un set fix pe server), availability/isHidden (enum/bool)
       * și nextShipDate (necesită parsare de dată) - acelea rămân
       * strict în seama extragerii LLM, fără plasă de siguranță.
       */
      const trimmed = String(
        rawMessage
      ).trim();

      if (trimmed) {
        patch[missingUpdateField] = trimmed;
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    const field =
      missingUpdateField &&
      PRODUCT_UPDATE_ALLOWED_FIELDS.has(
        missingUpdateField
      )
        ? missingUpdateField
        : null;

    if (field) {
      return {
        message: buildProductFieldQuestion(
          field,
          product.title
        ),

        resultType: "needs_field",
        productId: product.id,
        productTitle: product.title,
        productPreview: buildProductPreview(product),
        field,
      };
    }

    return {
      message: `Ce anume vrei să modific la „${product.title}”?`,
      resultType: "answer",
    };
  }

  return buildUpdateProductPendingAction(
    product,
    patch
  );
}

/* ======================================================
   10. UPDATE_STORE_PROFILE - modificare directă a
   profilului public al magazinului (ServiceProfile),
   NU a datelor de plată/comision/status cont.

   Whitelist strictă, la fel ca la UPDATE_PRODUCT. Scriere
   propriu-zisă NICIODATĂ aici - doar se construiește
   pendingAction; confirmarea (din frontend) reutilizează
   STRICT endpoint-ul existent PUT /api/vendors/store/:slug
   (vendorStoreRoutes.js), cu ACELAȘI shape de body ca
   formularul normal de editare a magazinului.

   Explicit EXCLUSE din whitelist: slug (schimbă URL-ul
   public al magazinului), coverUrl/logoUrl (upload de
   imagine, nu text liber), delivery (structură complexă),
   activare/dezactivare magazin (acțiune cu impact prea mare
   pentru un flow conversațional fără pas dedicat de
   confirmare vizuală).
====================================================== */

export const STORE_UPDATE_ALLOWED_FIELDS = new Set([
  "displayName",
  "tagline",
  "about",
  "city",
  "address",
  "phone",
  "email",
  "website",
  "shortDescription",
]);

const STORE_FIELD_LABELS = {
  displayName: "Nume magazin",
  tagline: "Slogan",
  about: "Despre magazin",
  city: "Oraș",
  address: "Adresă",
  phone: "Telefon",
  email: "Email",
  website: "Website",
  shortDescription: "Descriere scurtă",
};

function buildWhitelistedStorePatch(storeUpdate) {
  const patch = {};

  if (!storeUpdate) return patch;

  for (const field of STORE_UPDATE_ALLOWED_FIELDS) {
    const value = storeUpdate[field];

    if (value === undefined || value === null) continue;

    patch[field] =
      typeof value === "string" ? value.trim() : value;
  }

  return patch;
}

function formatStoreFieldValue(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "(gol)";
}

export async function handleUpdateStoreProfile(
  vendorId,
  storeUpdate
) {
  const profile = await prisma.serviceProfile.findFirst({
    where: {
      service: {
        vendorId,
        type: { code: "products" },
      },
    },
  });

  if (!profile) {
    return {
      message:
        "Nu am găsit un magazin asociat contului tău.",

      resultType: "answer",
    };
  }

  const patch = buildWhitelistedStorePatch(storeUpdate);

  if (Object.keys(patch).length === 0) {
    return {
      message:
        "Ce anume vrei să modific la profilul magazinului? (nume, slogan, despre, oraș, adresă, telefon, email, website, descriere scurtă)",

      resultType: "answer",
    };
  }

  const changes = Object.keys(patch).map((field) => ({
    field,
    label: STORE_FIELD_LABELS[field] || field,
    before: formatStoreFieldValue(profile[field]),
    after: formatStoreFieldValue(patch[field]),
  }));

  const summary = changes
    .map(
      (change) =>
        `${change.label}: ${change.before} → ${change.after}`
    )
    .join("; ");

  return {
    message: `Vrei să actualizez profilul magazinului „${
      profile.displayName || profile.slug
    }” - ${summary}?`,

    resultType: "pending_action",

    pendingAction: {
      kind: "UPDATE_STORE_PROFILE",
      storeSlug: profile.slug,
      storeName: profile.displayName || profile.slug,
      summary,
      changes,
      patch,
    },
  };
}

/* ======================================================
   11. UPDATE_ORDER_STATUS - schimbarea statusului unei
   expedieri (Shipment) a vendorului, DOAR pentru
   tranzițiile deja permise vendorului în UI.

   Whitelist STRICT redusă față de endpoint-ul real
   (PATCH /api/vendor/orders/:id/status din
   vendorOrdersRoutes.js, care mai acceptă și "new"/PENDING
   și "cancelled"/REFUSED): aici expunem conversațional
   DOAR "preparing", "confirmed", "shipped", "fulfilled" -
   tranziții normale, înainte, cu impact reversibil.

   "new" (revenire la PENDING) și "cancelled" (anulare,
   necesită cancelReason/cancelReasonNote structurate) NU
   sunt expuse prin acest flow - vezi raportul de acțiuni
   refuzate. Validarea REALĂ (inclusiv blocarea pe plată
   card neconfirmată) rămâne STRICT în endpoint-ul existent,
   rulată din nou la confirmare - acest handler doar
   pregătește un pendingAction, nu scrie nimic.
====================================================== */

/*
 * Etichete IDENTICE, cuvânt cu cuvânt, cu STATUS_OPTIONS din
 * frontend/src/pages/Vendor/Orders/Orders.jsx - verificat din nou
 * la această etapă (PAGE-AWARE COPILOT, punctul 7 din cerință),
 * ca mesajul de confirmare al asistentului să folosească EXACT
 * termenii pe care vânzătorul îi vede deja în pagina Comenzi, nu o
 * parafrazare separată care ar putea deruta.
 */
const ORDER_STATUS_UI_LABELS = {
  new: "Nouă",
  preparing: "În pregătire",
  confirmed: "Confirmată (gata de predare)",
  shipped: "Predată curierului",
  fulfilled: "Finalizată",
  cancelled: "Anulată",
};

/*
 * Eticheta curentă a expedierii (shipment.status, enumul real din
 * schema) - DISTINCT de ORDER_STATUS_UI_LABELS de mai sus, care
 * sunt cheile "new/preparing/..." trimise de UI către endpoint,
 * NU valorile enumului stocat. Etichetele care au un corespondent
 * direct în STATUS_OPTIONS folosesc ACEEAȘI formulare ca mai sus;
 * AWB/RETURNED/PICKUP_SCHEDULED nu apar în STATUS_OPTIONS (nu sunt
 * ținte alese de vânzător din acel dropdown), rămân etichete proprii.
 */
const SHIPMENT_STATUS_LABELS = {
  PENDING: "Nouă",
  PREPARING: "În pregătire",
  READY_FOR_PICKUP: "Confirmată (gata de predare)",
  AWB: "AWB generat",
  IN_TRANSIT: "Predată curierului",
  DELIVERED: "Finalizată",
  REFUSED: "Anulată",
  RETURNED: "Returnată",
  PICKUP_SCHEDULED: "Ridicare programată",
};

const ORDER_STATUS_ALLOWED_TARGETS = new Set([
  "preparing",
  "confirmed",
  "shipped",
  "fulfilled",
]);

export async function handleUpdateOrderStatus(
  vendorId,
  { orderRef, orderStatusTarget, currentEntity }
) {
  /*
   * ENTITY-AWARE (prioritate B): fără număr de comandă explicit în
   * mesaj ("marcheaz-o ca expediată"), dacă pagina curentă e chiar
   * pagina unei comenzi (currentEntity.type ORDER), folosim id-ul
   * de-acolo - ownership-ul tot se verifică mai jos, în interogare
   * (vendorId), currentEntity e doar hint de rezolvare.
   */
  const explicitRef = String(orderRef || "").trim();

  const ref =
    explicitRef ||
    (currentEntity?.type === "ORDER" && currentEntity?.id
      ? String(currentEntity.id).trim()
      : "");

  if (!ref) {
    return {
      message:
        "Pentru ce comandă vrei să schimb statusul? (dă-mi numărul comenzii)",

      resultType: "answer",
    };
  }

  const shipment = await prisma.shipment.findFirst({
    where: {
      vendorId,

      order: {
        OR: [
          { id: ref },
          { orderNumber: ref },
        ],
      },
    },

    include: { order: true },
  });

  if (!shipment) {
    return {
      message: explicitRef
        ? `Nu am găsit nicio comandă de-a ta cu numărul „${explicitRef}”.`
        : "Nu am găsit comanda din pagina curentă.",

      resultType: "answer",
    };
  }

  const target = String(
    orderStatusTarget || ""
  ).trim();

  if (!ORDER_STATUS_ALLOWED_TARGETS.has(target)) {
    return {
      message:
        "Prin asistent pot schimba statusul doar către: în pregătire, gata de ridicare, expediată sau livrată. Pentru anulare, folosește pagina Comenzi.",

      resultType: "answer",
    };
  }

  return {
    message: `Vrei să marchez comanda „${
      shipment.order.orderNumber
    }” ca „${ORDER_STATUS_UI_LABELS[target]}”?`,

    resultType: "pending_action",

    pendingAction: {
      kind: "UPDATE_ORDER_STATUS",
      orderId: shipment.orderId,
      orderNumber: shipment.order.orderNumber,

      before:
        SHIPMENT_STATUS_LABELS[shipment.status] ||
        shipment.status,

      after: ORDER_STATUS_UI_LABELS[target],
      statusTarget: target,

      summary: `Status: ${
        SHIPMENT_STATUS_LABELS[shipment.status] ||
        shipment.status
      } → ${ORDER_STATUS_UI_LABELS[target]}`,
    },
  };
}

/* ======================================================
   Prompt LLM - STRICT clasificare + extragere, NICIODATĂ
   calcul. Modelat pe structura promptului deja folosit în
   price-calculator/turn.
====================================================== */

export function buildPrompt({
  message,
  history,
  pendingContext,
}) {
  return `
Ești asistentul ArtFest pentru administrarea conversațională a modulului "Costuri & Profit" al unui vânzător.

Rolul tău este STRICT să clasifici cererea și să extragi datele menționate explicit în text. NU calculezi NICIODATĂ prețuri, marje, profituri sau sume - acelea sunt calculate separat, determinist, de server.

Tipuri de comandă posibile (commandType):

- READ_PROFITABILITY: ÎNTREBĂRI (nu comenzi) despre profitabilitatea MAI MULTOR produse ("ce produse au profit sub 20%", "ce produse vând sub cost", "cel mai mare profit", "ce produse trebuie recalculate" - ÎNTREBARE despre care anume, NU o comandă de recalculare). Dacă mesajul e o COMANDĂ imperativă ("recalculează...", nu o întrebare cu "ce"/"care"), NU e READ_PROFITABILITY - vezi RECALCULATE_BATCH.
- READ_PRODUCT_COST: întrebarea DOAR despre cifrele deja calculate ale UNUI produs anume, când vânzătorul pare să știe deja că produsul are un costing salvat ("cât mă costă produsul X", "ce profit am la X").
- READ_LIBRARY: întrebări despre biblioteca de costuri ("ce materiale am salvate").
- UPDATE_COST_ITEM: schimbarea prețului unui cost care sună ca fiind DEJA în bibliotecă - un material/ambalaj/alt cost REUTILIZABIL, NU un produs anume, formulat ca o schimbare/actualizare explicită ("schimbă ceara la 0,06 lei pe gram", "cutia cadou costă acum 7 lei"). Indiciu: numele menționat e un material/consumabil generic, nu un produs finit, iar formularea sună ca "actualizează ce știai deja".
- CREATE_COST_ITEM: vânzătorul DESCRIE folosirea sau achiziția unui material/ambalaj/consumabil reutilizabil și îi menționează costul, FĂRĂ să spună explicit că schimbă/actualizează ceva și FĂRĂ să fie legat de un produs anume ("folosesc panglică satin, 1,20 lei pe metru", "cutia asta mă costă 5 lei bucata", "am cumpărat 2 kg de ceară cu 100 lei", "folosesc nasturi de lemn" - fără preț, caz în care costItemDetection.name se completează oricum, restul rămâne null). Diferența față de UPDATE_COST_ITEM: aici vânzătorul doar POVESTEȘTE ce folosește/a cumpărat, nu cere explicit o schimbare a unei valori deja cunoscute - serverul decide determinist (comparând cu biblioteca) dacă propune creare sau, dacă din întâmplare există deja, actualizare. Completează OBLIGATORIU costItemDetection.name de fiecare dată când clasifici CREATE_COST_ITEM.
- RECALCULATE_BATCH: comandă IMPERATIVĂ, EXPLICITĂ de recalculare, cu verbul "recalculează"/"recalculare" - pentru mai multe produse, fără criteriu ("recalculează produsele mele", "recalculează tot") sau cu criteriu ("recalculează produsele care folosesc ceara", "recalculează toate produsele cu costuri neactualizate"), SAU pentru UN SINGUR produs referit prin pronume/implicit, fără nume, dar TOT cu verbul "recalculează" explicit în text ("recalculează-l", "recalculează produsul ăsta", "recalculează costingul") - în acest ultim caz, completează recalculateTarget cu "current_product" (serverul rezolvă la ce produs se referă din pagina curentă). NU alege asta doar pentru că mesajul e scurt/vag și există un produs în context - trebuie ca verbul "recalculează"/"recalculare" să apară EXPLICIT în text. Un verb generic nespecific ("schimbă-l", "modifică-l", "fă ceva la el") FĂRĂ să spună CE anume vrea schimbat NU e RECALCULATE_BATCH - e UNKNOWN (cere clarificare, nu presupune recalculare).
- UPDATE_PRODUCT_COSTING: modificarea DRAFTULUI DE CALCUL AL COSTULUI unui produs anume, deja identificat - materiale/manoperă/profit dorit ("adaugă 5 lei ambalaj la produsul X", "la produsul X lucrez 1,5 ore", "vreau 40% profit la produsul X", "scoate transportul din costurile produsului X"), sau un tarif orar personal fără produs asociat ("tariful meu pe oră e 35 lei" - tratează ca UPDATE_PRODUCT_COSTING cu setHourlyRateLei completat și productName gol, serverul va cere numele produsului). NU e despre prețul public de vânzare afișat clienților - acela e UPDATE_PRODUCT.
- APPLY_RECOMMENDED_PRICE: aplicarea prețului RECOMANDAT, CALCULAT de sistem, ca preț public ("aplică prețul recomandat la produsul X") - NU o sumă spusă direct de vânzător.
- CALCULATE_PRICE_GENERIC: vânzătorul vrea să CALCULEZE/STABILEASCĂ un preț, mai ales dacă nu e clar dacă produsul are deja un costing, sau cere explicit "calculează"/"ajută-mă să calculez"/"nu știu cu cât să vând" ("calculează-mi prețul pentru X", "ajută-mă să calculez un preț", "nu știu cu cât să vând produsul Y"). Diferența față de READ_PRODUCT_COST: aici vânzătorul vrea să PORNEASCĂ sau CONTINUE un calcul interactiv, nu doar să afle un număr deja existent.
- UPDATE_PRODUCT: vânzătorul vrea să schimbe direct un câmp AL PRODUSULUI PUBLICAT - titlu, preț de vânzare, stoc, disponibilitate, vizibilitate (ascuns/vizibil), descriere, categorie, material principal, tehnică, culoare, dimensiuni, stil, ocazie, instrucțiuni de îngrijire, note speciale. Exemple: "schimbă prețul produsului X la 79 lei", "pune stoc 5 bucăți la produsul Y", "ascunde produsul Z", "arată din nou produsul Z", "schimbă descrierea produsului X", "setează timpul de realizare la 5 zile pentru produsul X", "schimbă categoria/materialul/disponibilitatea produsului X". Diferă STRICT de UPDATE_PRODUCT_COSTING (acolo se schimbă doar draftul intern de calcul al costului, nu prețul public) și de APPLY_RECOMMENDED_PRICE (acolo se aplică prețul CALCULAT de sistem, nu o sumă spusă direct - "la 79 lei"/"cu 79 lei" spus explicit de vânzător e ÎNTOTDEAUNA UPDATE_PRODUCT).
- UPDATE_STORE_PROFILE: vânzătorul vrea să schimbe date despre MAGAZINUL lui (nu un produs) - nume, slogan, descriere, oraș, adresă, telefon, email, website. Exemple: "schimbă numele magazinului în X", "pune orașul Cluj la magazin", "actualizează telefonul magazinului".
- UPDATE_ORDER_STATUS: vânzătorul vrea să schimbe statusul unei COMENZI anume, deja identificate printr-un număr ("marchează comanda 12345 ca expediată", "comanda ABC e gata de ridicare", "pune comanda X în pregătire"). Necesită un identificator de comandă explicit în text sau în context - dacă lipsește, completează orderRef cu ce a fost menționat (poate fi gol dacă nu a fost spus deloc).
- UNKNOWN: dacă mesajul nu se potrivește clar cu niciunul (inclusiv mesaje complet nelegate de costuri/prețuri/produse).

Reguli:

- Extrage DOAR ce e menționat explicit în text. Nu inventa nume de produse/costuri/valori.
- "Schimbă-l"/"modifică-l"/"fă ceva la el" (verb generic, FĂRĂ să spună ce anume vrea schimbat sau la ce valoare) = UNKNOWN, NICIODATĂ RECALCULATE_BATCH sau alt commandType concret - nu presupune ce vrea vânzătorul doar pentru că există un produs în context.
- "Recalculează produsele mele"/"recalculează tot" (COMANDĂ, verbul "recalculează" explicit, fără criteriu) = RECALCULATE_BATCH cu recalculateTarget null, NU READ_PROFITABILITY - diferă de o ÎNTREBARE ca "ce produse trebuie recalculate?" (aceea E READ_PROFITABILITY, cu filter "needs_recalculation").
- Sumele în lei sunt transcrise ca atare din text (ex: "0,06 lei" -> 0.06), NU calculate. Funcționează indiferent cum sunt formulate ("0,06 lei/gram", "0,06 lei pe gram", "6 bani pe gram" etc. - extrage sensul, nu doar tiparul exact).
- Când ești nesigur între UPDATE_COST_ITEM și UPDATE_PRODUCT_COSTING, gândește-te dacă numele menționat sună ca un MATERIAL/consumabil (UPDATE_COST_ITEM) sau ca un PRODUS FINIT vândut (UPDATE_PRODUCT_COSTING).
- Pentru costItemDetection (folosit la CREATE_COST_ITEM, dar completează-l ORICÂND textul menționează clar un material/ambalaj reutilizabil cu cost, indiferent de commandType-ul ales):
  - costItemDetection.type: "PACKAGING" pentru cutie/ambalaj/folie/etichetă/pungă, "MATERIAL" pentru orice alt material/consumabil fizic, "OTHER" pentru altceva reutilizabil care nu e nici material nici ambalaj.
  - Dacă vânzătorul dă direct un cost PE UNITATE ("1,20 lei pe metru", "5 lei bucata"), completează costItemDetection.unitCostLei și costItemDetection.unit - NU completa purchaseQuantity/purchaseUnit/purchaseTotalCostLei.
  - Dacă vânzătorul descrie o ACHIZIȚIE cu cantitate + cost total ("2 kg de ceară cu 100 lei"), completează DOAR costItemDetection.purchaseQuantity, purchaseUnit și purchaseTotalCostLei - NU calcula tu costul pe unitate, NU completa unitCostLei în acest caz. Costul pe unitate se calculează determinist pe server.
  - Dacă numele e menționat dar NU e spus niciun cost (nici pe unitate, nici achiziție), completează doar costItemDetection.name și type, lasă restul null - serverul va întreba costul.
- Pentru UPDATE_PRODUCT, completează productUpdate DOAR cu câmpurile menționate EXPLICIT, cu valoarea lor exactă din text - nu completa alte câmpuri "din oficiu".
  - Dacă vânzătorul numește un câmp fără să dea o valoare (ex. "schimbă prețul produsului X" fără sumă), lasă productUpdate complet gol (toate null) și completează missingUpdateField cu numele exact al câmpului: una din "title", "description", "price", "category", "materialMain", "technique", "color", "dimensions", "styleTags", "occasionTags", "careInstructions", "specialNotes", "availability", "readyQty", "leadTimeDays", "nextShipDate", "isHidden".
  - productUpdate.availability acceptă STRICT una din: "READY", "MADE_TO_ORDER", "PREORDER", "SOLD_OUT" - dedu din text (ex. "disponibil imediat"/"pregătit"->READY, "la comandă"/"personalizat"->MADE_TO_ORDER, "precomandă"->PREORDER, "stoc epuizat"/"nu mai am"/"epuizat"->SOLD_OUT).
  - productUpdate.isHidden e boolean: true dacă vânzătorul cere să ascundă/dezactiveze produsul, false dacă cere să-l arate/publice/reactiveze.
  - Poți completa MAI MULTE câmpuri deodată dacă vânzătorul le menționează pe toate în același mesaj (ex. "schimbă prețul la 80 lei și stocul la 4" -> productUpdate.price = 80, productUpdate.readyQty = 4).
- Pentru UPDATE_STORE_PROFILE, completează storeUpdate DOAR cu câmpurile menționate EXPLICIT: "displayName", "tagline", "about", "city", "address", "phone", "email", "website", "shortDescription".
- Pentru UPDATE_ORDER_STATUS, completează orderRef cu numărul/identificatorul comenzii menționat în text (transcris EXACT, nu inventat) și orderStatusTarget cu STRICT una din: "preparing" (în pregătire), "confirmed" (gata de ridicare), "shipped" (expediată), "fulfilled" (livrată). NU folosi "new" sau "cancelled" - dacă vânzătorul cere anularea unei comenzi, clasifică UNKNOWN (anularea nu se face prin acest flow).${
    pendingContext?.commandType ===
    "UPDATE_PRODUCT"
      ? `
  - CONTEXT IMPORTANT: vânzătorul tocmai a fost întrebat "${
      pendingContext.question || ""
    }" despre un produs deja identificat (productId cunoscut de server, NU mai cere alt nume de produs). Dacă mesajul curent pare să răspundă la asta, clasifică commandType ca UPDATE_PRODUCT și completează productUpdate.${
      pendingContext.missingField || ""
    } cu valoarea din răspuns.`
      : ""
  }
- Returnează EXCLUSIV JSON valid, fără markdown.

Istoric conversație:

${JSON.stringify(history, null, 2)}

Mesaj curent:

${message}

Schema exactă a răspunsului:

{
  "commandType": "READ_PROFITABILITY",

  "profitabilityQuery": {
    "metric": null,
    "operator": null,
    "value": null,
    "filter": null
  },

  "productName": null,

  "costItemName": null,
  "newUnitCostLei": null,
  "newUnit": null,

  "recalculateTarget": null,
  "costItemNameForRecalc": null,

  "costingChanges": {
    "addMaterial": null,
    "removeMaterialByName": null,
    "setLaborHours": null,
    "setHourlyRateLei": null,
    "setDesiredProfitPercent": null,
    "setDesiredProfitAmountLei": null,
    "addOtherCost": null,
    "removeOtherCostByLabel": null,
    "setPackagingCostLei": null,
    "removePackaging": false
  },

  "costItemDetection": {
    "name": null,
    "type": null,
    "unit": null,
    "unitCostLei": null,
    "purchaseQuantity": null,
    "purchaseUnit": null,
    "purchaseTotalCostLei": null
  },

  "productUpdate": {
    "title": null,
    "description": null,
    "price": null,
    "category": null,
    "materialMain": null,
    "technique": null,
    "color": null,
    "dimensions": null,
    "styleTags": null,
    "occasionTags": null,
    "careInstructions": null,
    "specialNotes": null,
    "availability": null,
    "readyQty": null,
    "leadTimeDays": null,
    "nextShipDate": null,
    "isHidden": null
  },

  "missingUpdateField": null,

  "storeUpdate": {
    "displayName": null,
    "tagline": null,
    "about": null,
    "city": null,
    "address": null,
    "phone": null,
    "email": null,
    "website": null,
    "shortDescription": null
  },

  "orderRef": null,
  "orderStatusTarget": null
}

Pentru profitabilityQuery.metric folosește una din: "marginPercent", "profit", "totalRealCost", "recommendedPrice".
Pentru operator folosește una din: "lt", "lte", "gt", "gte", "top", "bottom".
Pentru profitabilityQuery.filter folosește una din: "below_min_price", "needs_recalculation", "no_costing", "draft", "confirmed".
Pentru recalculateTarget folosește una din: "cost_item" (recalculare legată de un material/cost anume), "current_product" (UN SINGUR produs, referit prin pronume/implicit, fără nume propriu în text), sau lasă null pentru recalculare pe toate produsele care se potrivesc (fără produs anume menționat).
`;
}

/* ======================================================
   POST /api/ai/assistant/command
====================================================== */

export async function dispatchCommand(
  vendorId,
  parsed,
  context = {}
) {
  const pendingProductUpdate =
    context.pendingContext?.commandType ===
    "UPDATE_PRODUCT"
      ? context.pendingContext
      : null;

  /*
   * Dacă vânzătorul tocmai a fost întrebat "care e noul preț?"
   * (pendingContext activ) și răspunde terse ("80 lei"), LLM-ul
   * poate să nu urmeze instrucțiunea din prompt și să întoarcă
   * UNKNOWN - nu lăsăm clarificarea să eșueze silențios: în
   * acest caz tratăm determinist mesajul ca UPDATE_PRODUCT.
   * Dacă LLM-ul a clasificat clar mesajul ca altă comandă
   * (ex. UPDATE_COST_ITEM, RECALCULATE_BATCH), respectăm acea
   * clasificare - o comandă globală clară poate întrerupe.
   *
   * BUGFIX (audit): condiția de mai sus proteja doar cazul în care
   * LLM-ul întoarce UNKNOWN - dacă LLM-ul MISCLASIFICĂ un răspuns
   * scurt/numeric ("80") ca alt commandType (posibil, deși rar, pe
   * mesaje ambigue), clarificarea activă se pierdea silențios,
   * încălcând "contextul activ are prioritate față de
   * reclasificare". Adăugăm un al doilea semnal determinist,
   * independent de ce a răspuns LLM-ul: dacă mesajul e un răspuns
   * scurt care conține o valoare simplă (număr sau text scurt, fără
   * markeri clari de altă comandă), tot forțăm UPDATE_PRODUCT.
   * Restrâns intenționat la răspunsuri scurte care conțin o
   * valoare NUMERICĂ (cel mai comun caz - preț, stoc, zile de
   * livrare) - nu la orice mesaj scurt, ca să nu forțăm greșit
   * UPDATE_PRODUCT peste o comutare clară către altă comandă
   * scurtă ("arată comenzile", "las-o" - acesta din urmă e oricum
   * tratat separat, vezi isCancelReply în handleUpdateProduct).
   */
  const isBareClarificationReply =
    pendingProductUpdate &&
    (() => {
      const raw = String(context.message || "").trim();

      if (!raw) return false;

      const wordCount = raw.split(/\s+/).length;
      const hasNumber = extractFirstNumber(raw) !== null;

      return wordCount <= 4 && hasNumber;
    })();

  const effectiveCommandType =
    pendingProductUpdate &&
    (!parsed.commandType ||
      parsed.commandType === "UNKNOWN" ||
      isBareClarificationReply)
      ? "UPDATE_PRODUCT"
      : parsed.commandType;

  switch (effectiveCommandType) {
    case "READ_PROFITABILITY":
      return handleReadProfitability(
        vendorId,
        parsed.profitabilityQuery
      );

    case "READ_PRODUCT_COST":
      return handleReadProductCost(
        vendorId,
        parsed.productName,
        context.currentEntity
      );

    case "READ_LIBRARY":
      return handleReadLibrary(vendorId);

    case "UPDATE_COST_ITEM":
      return handleUpdateCostItem(vendorId, {
        costItemName: parsed.costItemName,
        newUnitCostLei: parsed.newUnitCostLei,
        newUnit: parsed.newUnit,
      });

    case "RECALCULATE_BATCH":
      return handleRecalculateBatch(
        vendorId,
        {
          recalculateTarget:
            parsed.recalculateTarget,
          costItemNameForRecalc:
            parsed.costItemNameForRecalc,
        },
        context.currentEntity
      );

    case "UPDATE_PRODUCT_COSTING":
      return handleUpdateProductCosting(
        vendorId,
        parsed.productName,
        parsed.costingChanges,
        context.currentEntity
      );

    case "APPLY_RECOMMENDED_PRICE":
      return handleApplyRecommendedPrice(
        vendorId,
        parsed.productName,
        context.currentEntity
      );

    case "CALCULATE_PRICE_GENERIC":
      return handleCalculatePriceGeneric(
        vendorId,
        parsed.productName,
        context.currentEntity
      );

    case "CREATE_COST_ITEM":
      return handleCreateCostItem(
        vendorId,
        parsed.costItemDetection
      );

    case "UPDATE_PRODUCT":
      return handleUpdateProduct(vendorId, {
        productName: parsed.productName,
        productUpdate: parsed.productUpdate,

        missingUpdateField:
          parsed.missingUpdateField ||
          pendingProductUpdate?.missingField ||
          null,

        knownProductId:
          pendingProductUpdate?.productId ||
          null,

        rawMessage: context.message,
        currentEntity: context.currentEntity,
      });

    case "UPDATE_STORE_PROFILE":
      return handleUpdateStoreProfile(
        vendorId,
        parsed.storeUpdate
      );

    case "UPDATE_ORDER_STATUS":
      return handleUpdateOrderStatus(vendorId, {
        orderRef: parsed.orderRef,
        orderStatusTarget: parsed.orderStatusTarget,
        currentEntity: context.currentEntity,
      });

    default: {
      /*
       * Plasă de siguranță: dacă LLM-ul n-a clasificat clar
       * mesajul (UNKNOWN), dar tot a reușit să extragă un
       * element reutilizabil cu cost (costItemDetection.name),
       * încercăm oricum detectarea automată în loc de un
       * răspuns fără nicio ieșire.
       */
      if (parsed.costItemDetection?.name) {
        const detected = await handleCreateCostItem(
          vendorId,
          parsed.costItemDetection
        );

        if (detected) {
          return detected;
        }
      }

      return {
        message:
          "Nu sunt sigur ce vrei să fac. Poți reformula? Pot să răspund la întrebări despre profitabilitate, să modific costuri din bibliotecă, să recalculez produse sau să modific costingul unui produs.",

        resultType: "answer",
      };
    }
  }
}
