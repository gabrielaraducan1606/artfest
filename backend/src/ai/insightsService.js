// backend/src/ai/insightsService.js

/*
 * PROACTIVE COPILOT - sistem GENERAL de insight-uri, nu if-uri
 * hardcodate în frontend. STRICT read-only - nicio funcție de-aici
 * scrie vreodată în DB; un insight doar SEMNALEAZĂ o situație,
 * rezolvarea (dacă există un suggestedAction) trece prin
 * action registry + pendingAction, exact ca orice altă acțiune
 * conversațională (vezi copilotRouter.js/actionRegistry.js).
 *
 * Fiecare insight e calculat DETERMINIST din date reale, deja
 * existente (costProfitService.js pentru costing, interogări
 * directe Prisma pentru rest) - niciun câmp nu e inventat sau
 * dedus din date care nu există (ex. NU există un insight "produs
 * dezactivat recent", pentru că nu există istoric de schimbare a
 * lui isActive/isHidden în schema - ar fi o presupunere, nu un
 * fapt verificabil).
 */

import { prisma } from "../db.js";
import { getProductProfitability } from "../services/costProfitService.js";
import { ronText } from "../services/vendorAssistantCommandService.js";

export const INSIGHT_SEVERITIES = ["INFO", "WARNING", "IMPORTANT"];

const SEVERITY_RANK = { IMPORTANT: 3, WARNING: 2, INFO: 1 };

/*
 * Câte produse/comenzi concrete aducem ca preview în mesaj/
 * actionParams - insight-urile sunt rezumate, nu liste complete
 * (acelea rămân în paginile dedicate).
 */
const SAMPLE_LIMIT = 3;

function pluralize(count, one, many) {
  return count === 1 ? one : many;
}

/* ======================================================
   COSTS & PROFIT (reutilizează filtrele deja existente și
   testate din costProfitService.js - niciun query nou pentru
   no_costing / below_min_price / needs_recalculation)
====================================================== */
async function buildCostingInsights(vendorId) {
  const [noCosting, belowMin, needsRecalc] = await Promise.all([
    getProductProfitability({
      vendorId,
      filter: "no_costing",
      pageSize: 500,
    }),
    getProductProfitability({
      vendorId,
      filter: "below_min_price",
      pageSize: 500,
    }),
    getProductProfitability({
      vendorId,
      filter: "needs_recalculation",
      pageSize: 500,
    }),
  ]);

  const insights = [];

  if (noCosting.total > 0) {
    insights.push({
      id: "product-no-costing",
      type: "PRODUCT_NO_COSTING",
      severity: "INFO",
      domain: "costs-profit",

      title: "Produse fără costing",

      message: `${noCosting.total} ${pluralize(
        noCosting.total,
        "produs nu are",
        "produse nu au"
      )} încă un calcul de cost salvat - nu știi cât te costă real sau dacă prețul actual acoperă costurile.`,

      entityType:
        noCosting.total === 1 ? "PRODUCT_COSTING" : null,

      entityId:
        noCosting.total === 1
          ? noCosting.items[0].productId
          : null,

      suggestedAction: null,
      actionParams: null,
    });
  }

  if (belowMin.total > 0) {
    const single = belowMin.total === 1;
    const first = belowMin.items[0];

    const canApplyRecommended =
      single && first.recommendedPriceCents > 0;

    insights.push({
      id: "product-below-min-price",
      type: "PRODUCT_BELOW_MIN_PRICE",
      severity: "WARNING",
      domain: "costs-profit",

      title: "Produse vândute sub costul minim",

      message: single
        ? `„${first.title}” se vinde cu ${ronText(
            first.priceCents
          )}, sub costul minim calculat (${ronText(
            first.minPriceCents
          )}) - pierzi bani la fiecare vânzare.`
        : `${belowMin.total} produse se vând sub costul minim calculat - pierzi bani la fiecare vânzare a lor.`,

      entityType: single ? "PRODUCT" : null,
      entityId: single ? first.productId : null,

      suggestedAction: canApplyRecommended
        ? "APPLY_RECOMMENDED_PRICE"
        : null,

      actionParams: canApplyRecommended
        ? { productId: first.productId }
        : null,
    });
  }

  if (needsRecalc.total > 0) {
    insights.push({
      id: "product-needs-recalculation",
      type: "PRODUCT_NEEDS_RECALCULATION",
      severity: "WARNING",
      domain: "costs-profit",

      title: "Costing neactualizat",

      message: `${needsRecalc.total} ${pluralize(
        needsRecalc.total,
        "produs are",
        "produse au"
      )} costingul neactualizat - un material din biblioteca ta și-a schimbat prețul de la ultima recalculare, iar costul real afișat nu mai e corect.`,

      entityType: null,
      entityId: null,

      /*
       * RECALCULATE_PRODUCTS (RECALCULATE_BATCH) fără
       * recalculateTarget = exact filtrul "needs_recalculation"
       * global - același target ca acest insight, deci confirmarea
       * rezolvă ÎNTREG insight-ul, nu doar o parte din el.
       */
      suggestedAction: "RECALCULATE_PRODUCTS",
      actionParams: {},
    });
  }

  return insights;
}

/* ======================================================
   PRODUSE FĂRĂ STOC (availability = SOLD_OUT, declarat explicit
   de vendor - fără nicio deducere din readyQty, care poate fi
   folosit inconsistent de unii vendori)
====================================================== */
async function buildStockInsight(vendorId) {
  const items = await prisma.product.findMany({
    where: {
      service: { vendorId },
      availability: "SOLD_OUT",
      isActive: true,
      isHidden: false,
    },

    select: { id: true, title: true },
    take: 50,
  });

  if (!items.length) return null;

  const single = items.length === 1;

  return {
    id: "product-out-of-stock",
    type: "PRODUCT_OUT_OF_STOCK",
    severity: "WARNING",
    domain: "products",

    title: "Produse fără stoc",

    message: single
      ? `„${items[0].title}” este activ, vizibil pentru clienți, dar marcat ca stoc epuizat.`
      : `${items.length} produse active și vizibile sunt marcate ca stoc epuizat.`,

    entityType: single ? "PRODUCT" : null,
    entityId: single ? items[0].id : null,

    /*
     * Nu există o valoare "corectă" evidentă de setat (disponibil?
     * la comandă? câte bucăți?) - vendorul trebuie să spună el
     * noua stare, nu presupunem noi.
     */
    suggestedAction: null,
    actionParams: null,
  };
}

/* ======================================================
   COMENZI CARE NECESITĂ ACȚIUNE (status PENDING = vendorul nu a
   început încă procesarea - același enum/etichete verificate la
   etapa PAGE-AWARE COPILOT, vezi vendorAssistantCommandService.js)
====================================================== */
async function buildOrdersInsight(vendorId) {
  const shipments = await prisma.shipment.findMany({
    where: { vendorId, status: "PENDING" },

    select: {
      orderId: true,
      order: { select: { orderNumber: true } },
    },

    orderBy: { createdAt: "asc" },
    take: 50,
  });

  if (!shipments.length) return null;

  const single = shipments.length === 1;

  return {
    id: "orders-need-action",
    type: "ORDER_NEEDS_ACTION",
    severity: "IMPORTANT",
    domain: "orders",

    title: "Comenzi noi, neprocesate",

    message: single
      ? `Comanda „${shipments[0].order.orderNumber}” e nouă și așteaptă să începi procesarea.`
      : `${shipments.length} comenzi sunt noi și așteaptă să începi procesarea.`,

    entityType: single ? "ORDER" : null,
    entityId: single ? shipments[0].orderId : null,

    /*
     * Ce status urmează (în pregătire? direct expediată?) e o
     * decizie operațională a vendorului, nu ceva ce putem
     * presupune noi ca fiind "singura variantă corectă".
     */
    suggestedAction: null,
    actionParams: null,
  };
}

/* ======================================================
   CERERI DE OFERTĂ FĂRĂ RĂSPUNS - două sisteme distincte, reale,
   confirmate din schema (vezi manifestul "quotes" - QuoteRequest e
   cerere directă către UN vendor; CustomerRequest e un anunț
   deschis pe piață, la care oricare vendor poate răspunde cu o
   ofertă proprie).
====================================================== */
async function buildQuoteInsights(vendorId) {
  const insights = [];

  const directQuotes = await prisma.quoteRequest.findMany({
    where: { vendorId, status: "SUBMITTED" },
    select: { id: true },
    take: 50,
  });

  if (directQuotes.length) {
    const single = directQuotes.length === 1;

    insights.push({
      id: "quote-requests-unanswered",
      type: "QUOTE_REQUEST_UNANSWERED",
      severity: "IMPORTANT",
      domain: "quotes",

      title: "Cereri de ofertă fără răspuns",

      message: single
        ? "Ai o cerere de ofertă directă, netrimisă încă clientului."
        : `Ai ${directQuotes.length} cereri de ofertă directe, netrimise încă clienților.`,

      entityType: single ? "QUOTE" : null,
      entityId: single ? directQuotes[0].id : null,

      suggestedAction: null,
      actionParams: null,
    });
  }

  const openMarketRequests = await prisma.customerRequest.findMany({
    where: {
      status: "OPEN",
      offers: { none: { vendorId } },
    },

    select: { id: true },
    take: 50,
  });

  if (openMarketRequests.length) {
    const single = openMarketRequests.length === 1;

    insights.push({
      id: "customer-requests-open",
      type: "CUSTOMER_REQUEST_UNANSWERED",
      severity: "INFO",
      domain: "quotes",

      title: "Cereri deschise pe piață",

      message: single
        ? "Este o cerere deschisă pe piață la care încă nu ai trimis o ofertă."
        : `Sunt ${openMarketRequests.length} cereri deschise pe piață la care încă nu ai trimis o ofertă.`,

      entityType: single ? "QUOTE" : null,
      entityId: single ? openMarketRequests[0].id : null,

      suggestedAction: null,
      actionParams: null,
    });
  }

  return insights;
}

/* ======================================================
   PROMOVĂRI HOMEPAGE CARE AȘTEAPTĂ RĂSPUNS (vezi manifestul
   homepage-features - vendorDiscountStatus PENDING înseamnă că
   nu ai răspuns încă la selecția pentru Produsul zilei / Artizanul
   săptămânii)
====================================================== */
async function buildHomepageFeatureInsight(vendorId) {
  const now = new Date();

  const features = await prisma.homepageFeature.findMany({
    where: {
      vendorId,
      vendorDiscountStatus: "PENDING",
      endsAt: { gte: now },
    },

    select: { id: true, type: true },
    take: 50,
  });

  if (!features.length) return null;

  const single = features.length === 1;

  return {
    id: "homepage-feature-pending-response",
    type: "HOMEPAGE_FEATURE_PENDING_RESPONSE",
    severity: "INFO",
    domain: "homepage-features",

    title: "Promovare homepage fără răspuns",

    message: single
      ? "Ai o promovare activă (Produsul zilei / Artizanul săptămânii) la care nu ai răspuns încă dacă vrei reducere suplimentară."
      : `Ai ${features.length} promovări active la care nu ai răspuns încă dacă vrei reducere suplimentară.`,

    /*
     * BUGFIX (audit): entityType era setat la "PRODUCT" chiar
     * pentru un singur item, dar entityId rămânea mereu null (nu
     * selectăm productId mai sus - o promovare homepage poate fi
     * și de tip "artizanul săptămânii", nu doar produs). Un
     * consumator care ar avea încredere că entityType==="PRODUCT"
     * implică un entityId valid ar eșua silențios. Nu inventăm un
     * id - lăsăm ambele null, consistent.
     */
    entityType: null,
    entityId: null,

    suggestedAction: null,
    actionParams: null,
  };
}

/* ======================================================
   BATCH B (audit regression Vendor Assistant, 2026-09-07) -
   "sănătatea" listării de produs. Reutilizează EXACT câmpurile reale
   din Product (Prisma) - isActive/isHidden (implicit true/false,
   deci o schimbare deliberată a vendorului, nu o stare tranzitorie),
   description, images, category. NU introducem un scor compus -
   fiecare condiție e simplă, verificabilă direct, documentată aici.

   DELIBERAT NU am creat un insight pentru leadTimeDays/availability
   generic - un `leadTimeDays` null nu are o interpretare de "problemă"
   clară în schema (poate însemna pur și simplu "gata de livrare
   imediată", nu "lipsă informație") - ar fi o presupunere, nu un
   fapt verificabil, exact ce evită acest fișier prin design (vezi
   comentariul din header).
====================================================== */
async function buildProductHiddenOrInactiveInsight(vendorId) {
  const items = await prisma.product.findMany({
    where: {
      service: { vendorId },
      OR: [{ isActive: false }, { isHidden: true }],
    },

    select: { id: true, title: true },
    take: 50,
  });

  if (!items.length) return null;

  const single = items.length === 1;

  return {
    id: "product-hidden-or-inactive",
    type: "PRODUCT_HIDDEN_OR_INACTIVE",
    severity: "INFO",
    domain: "products",

    title: "Produse ascunse sau dezactivate",

    message: single
      ? `„${items[0].title}” este ascuns sau dezactivat - nu apare în magazin pentru clienți.`
      : `${items.length} produse sunt ascunse sau dezactivate - nu apar în magazin pentru clienți.`,

    entityType: single ? "PRODUCT" : null,
    entityId: single ? items[0].id : null,

    /*
     * Nu presupunem că vendorul vrea să le reactiveze - poate fi
     * intenționat (produs sezonier, scos temporar).
     */
    suggestedAction: null,
    actionParams: null,
  };
}

/*
 * "Listare incompletă" - praguri simple, documentate explicit (nu
 * un scor ascuns): fără descriere sau descriere sub 20 caractere
 * (prea scurtă ca să fie utilă cuiva), sub 2 imagini, sau fără
 * categorie. Verificăm DOAR produsele active și vizibile - un produs
 * deja ascuns nu mai are nevoie și de acest semnal (e deja acoperit
 * de PRODUCT_HIDDEN_OR_INACTIVE).
 */
const MIN_DESCRIPTION_LENGTH = 20;
const MIN_IMAGES_COUNT = 2;

function describeIncompleteReasons(p) {
  const reasons = [];

  if (!p.description || p.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    reasons.push("fără descriere sau descriere prea scurtă");
  }
  if (!Array.isArray(p.images) || p.images.length < MIN_IMAGES_COUNT) {
    reasons.push("mai puțin de 2 imagini");
  }
  if (!p.category) {
    reasons.push("fără categorie");
  }

  return reasons;
}

async function buildProductIncompleteListingInsight(vendorId) {
  const candidates = await prisma.product.findMany({
    where: {
      service: { vendorId },
      isActive: true,
      isHidden: false,
    },

    select: {
      id: true,
      title: true,
      description: true,
      images: true,
      category: true,
    },

    take: 500,
  });

  const items = candidates
    .map((p) => ({ ...p, reasons: describeIncompleteReasons(p) }))
    .filter((p) => p.reasons.length > 0);

  if (!items.length) return null;

  const single = items.length === 1;

  return {
    id: "product-incomplete-listing",
    type: "PRODUCT_INCOMPLETE_LISTING",
    severity: "INFO",
    domain: "products",

    title: "Produse cu listare incompletă",

    message: single
      ? `„${items[0].title}” are o listare incompletă (${items[0].reasons.join(", ")}) - o listare completă atrage mai mulți clienți.`
      : `${items.length} produse au listarea incompletă (fără descriere suficientă, prea puține imagini sau fără categorie) - o listare completă atrage mai mulți clienți.`,

    entityType: single ? "PRODUCT" : null,
    entityId: single ? items[0].id : null,

    suggestedAction: null,
    actionParams: null,
  };
}

/* ======================================================
   VIDEO LIPSĂ (produse active/vizibile fără videoUrl) - extindere
   audit "recomandări magazin" (vezi VendorAssistant, întrebări
   de tip "ce aș putea îmbunătăți?"/"ce îmi recomanzi?").
====================================================== */
async function buildProductVideoInsight(vendorId) {
  const items = await prisma.product.findMany({
    where: {
      service: { vendorId },
      isActive: true,
      isHidden: false,
      videoUrl: null,
    },

    select: { id: true, title: true },
    take: 500,
  });

  if (!items.length) return null;

  const single = items.length === 1;

  return {
    id: "product-no-video",
    type: "PRODUCT_NO_VIDEO",
    severity: "INFO",
    domain: "products",

    title: "Produse fără video",

    message: single
      ? `„${items[0].title}” nu are video - un scurt video crește șansele să atragă atenția, mai ales la produsele personalizate.`
      : `${items.length} ${pluralize(
          items.length,
          "produs activ nu are",
          "produse active nu au"
        )} video - un scurt video crește șansele să atragă atenția, mai ales la produsele personalizate.`,

    entityType: single ? "PRODUCT" : null,
    entityId: single ? items[0].id : null,

    suggestedAction: null,
    actionParams: null,

    actionPhrase: single
      ? `adaugă un video la „${items[0].title}”`
      : "adaugă video la produsele care nu au",
  };
}

/* ======================================================
   CATALOG CU PUȚINE PRODUSE ACTIVE - prag documentat explicit,
   NU un scor ascuns. Sub acest prag e doar o sugestie de
   creștere, nu o "problemă" (severitate INFO, WARNING doar
   quando magazinul e complet gol).
====================================================== */
const MIN_ACTIVE_PRODUCTS_SUGGESTED = 10;

async function buildLowCatalogSizeInsight(vendorId) {
  const activeCount = await prisma.product.count({
    where: {
      service: { vendorId },
      isActive: true,
      isHidden: false,
    },
  });

  if (activeCount >= MIN_ACTIVE_PRODUCTS_SUGGESTED) return null;

  return {
    id: "catalog-low-size",
    type: "CATALOG_LOW_SIZE",
    severity: activeCount === 0 ? "WARNING" : "INFO",
    domain: "products",

    title: "Catalog cu puține produse active",

    message:
      activeCount === 0
        ? "Nu ai niciun produs activ momentan - un magazin fără produse vizibile nu poate primi comenzi."
        : `Ai ${activeCount} ${pluralize(
            activeCount,
            "produs activ",
            "produse active"
          )} - un catalog mai variat (măcar ${MIN_ACTIVE_PRODUCTS_SUGGESTED}-15) dă cumpărătorilor mai multe motive să răsfoiască și să cumpere.`,

    entityType: null,
    entityId: null,

    suggestedAction: null,
    actionParams: null,

    actionPhrase:
      activeCount === 0
        ? "adaugă primul tău produs"
        : "adaugă 2-3 produse noi în catalog",
  };
}

/* ======================================================
   PROFIL DE MAGAZIN INCOMPLET (ServiceProfile - logo, copertă,
   descriere, rețele sociale). Praguri documentate explicit, la
   fel ca describeIncompleteReasons pentru produs.
====================================================== */
const MIN_STORE_ABOUT_LENGTH = 40;

function describeStoreProfileReasons(profile) {
  const reasons = [];

  if (!profile?.logoUrl) {
    reasons.push("fără logo");
  }

  if (!profile?.coverUrl) {
    reasons.push("fără copertă/banner");
  }

  const about = String(
    profile?.about || profile?.shortDescription || ""
  ).trim();

  if (!about || about.length < MIN_STORE_ABOUT_LENGTH) {
    reasons.push("descriere foarte scurtă sau lipsă");
  }

  const socials =
    profile?.socials && typeof profile.socials === "object"
      ? profile.socials
      : null;

  const hasSocial =
    socials &&
    Object.values(socials).some((value) => String(value || "").trim());

  if (!hasSocial) {
    reasons.push("fără rețele sociale");
  }

  return reasons;
}

async function buildStoreProfileInsight(vendorId) {
  const service = await prisma.vendorService.findFirst({
    where: { vendorId },
    orderBy: { createdAt: "asc" },

    select: {
      profile: {
        select: {
          logoUrl: true,
          coverUrl: true,
          about: true,
          shortDescription: true,
          socials: true,
        },
      },
    },
  });

  const reasons = describeStoreProfileReasons(service?.profile);

  if (!reasons.length) return null;

  return {
    id: "store-profile-incomplete",
    type: "STORE_PROFILE_INCOMPLETE",
    severity: reasons.length >= 3 ? "WARNING" : "INFO",
    domain: "store-profile",

    title: "Profil de magazin incomplet",

    message: `Profilul magazinului tău este incomplet (${reasons.join(
      ", "
    )}) - un profil complet inspiră mai multă încredere cumpărătorilor. Îl editezi din Setări → Profil magazin.`,

    entityType: null,
    entityId: null,

    suggestedAction: null,
    actionParams: null,

    actionPhrase:
      "completează profilul magazinului (logo, copertă, descriere)",
  };
}

/* ======================================================
   PROMOVARE - lipsă colecții / coduri de reducere active.
   Doar semnal informativ (nu orice magazin are nevoie de
   ele), STRICT INFO.
====================================================== */
async function buildPromotionSetupInsights(vendorId) {
  const insights = [];

  const activeCollections = await prisma.vendorCollection.count({
    where: { vendorId, isActive: true },
  });

  if (activeCollections === 0) {
    insights.push({
      id: "no-active-collections",
      type: "NO_ACTIVE_COLLECTIONS",
      severity: "INFO",
      domain: "promotion",

      title: "Nicio colecție activă",

      message:
        "Nu ai nicio colecție de produse activă - o colecție tematică (5-8 produse) e utilă pentru distribuit pe social media sau într-o campanie.",

      entityType: null,
      entityId: null,

      suggestedAction: null,
      actionParams: null,

      actionPhrase: "creează o colecție cu 5-8 produse",
    });
  }

  const activeCodes = await prisma.discountCode.count({
    where: { vendorId, isActive: true, status: "ACTIVE" },
  });

  if (activeCodes === 0) {
    insights.push({
      id: "no-active-discount-codes",
      type: "NO_ACTIVE_DISCOUNT_CODES",
      severity: "INFO",
      domain: "promotion",

      title: "Niciun cod de reducere activ",

      message:
        "Nu ai niciun cod de reducere activ - un cod poate ajuta la o primă comandă sau la promovarea unei colecții. Îl creezi din Catalog → Coduri de reducere.",

      entityType: null,
      entityId: null,

      suggestedAction: null,
      actionParams: null,

      actionPhrase: "creează un cod de reducere",
    });
  }

  return insights;
}

/*
 * Detaliul din spatele unui insight (secțiunea "arată-mi produsele"
 * din cerință) - reutilizează EXACT aceleași filtre/interogări ca
 * builder-ele de mai sus, doar că întoarce lista de item-uri, nu
 * rezumatul. Folosit STRICT ca urmare a unei conversații deja
 * ancorate de un insight anume (conversationContext.activeInsight,
 * vezi copilotRouter.js) - niciodată ca punct de intrare direct.
 */
export async function getInsightItemsList(vendorId, type) {
  switch (type) {
    case "PRODUCT_NO_COSTING": {
      const r = await getProductProfitability({
        vendorId,
        filter: "no_costing",
        pageSize: 15,
      });

      return r.items.map((p) => ({ id: p.productId, title: p.title }));
    }

    case "PRODUCT_BELOW_MIN_PRICE": {
      const r = await getProductProfitability({
        vendorId,
        filter: "below_min_price",
        pageSize: 15,
      });

      return r.items.map((p) => ({ id: p.productId, title: p.title }));
    }

    case "PRODUCT_NEEDS_RECALCULATION": {
      const r = await getProductProfitability({
        vendorId,
        filter: "needs_recalculation",
        pageSize: 15,
      });

      return r.items.map((p) => ({ id: p.productId, title: p.title }));
    }

    case "PRODUCT_OUT_OF_STOCK": {
      const items = await prisma.product.findMany({
        where: {
          service: { vendorId },
          availability: "SOLD_OUT",
          isActive: true,
          isHidden: false,
        },

        select: { id: true, title: true },
        take: 15,
      });

      return items.map((p) => ({ id: p.id, title: p.title }));
    }

    case "PRODUCT_HIDDEN_OR_INACTIVE": {
      const items = await prisma.product.findMany({
        where: {
          service: { vendorId },
          OR: [{ isActive: false }, { isHidden: true }],
        },
        select: { id: true, title: true },
        take: 15,
      });

      return items.map((p) => ({ id: p.id, title: p.title }));
    }

    case "PRODUCT_NO_VIDEO": {
      const items = await prisma.product.findMany({
        where: {
          service: { vendorId },
          isActive: true,
          isHidden: false,
          videoUrl: null,
        },
        select: { id: true, title: true },
        take: 15,
      });

      return items.map((p) => ({ id: p.id, title: p.title }));
    }

    case "PRODUCT_INCOMPLETE_LISTING": {
      const candidates = await prisma.product.findMany({
        where: { service: { vendorId }, isActive: true, isHidden: false },
        select: { id: true, title: true, description: true, images: true, category: true },
        take: 500,
      });

      return candidates
        .filter((p) => describeIncompleteReasons(p).length > 0)
        .slice(0, 15)
        .map((p) => ({ id: p.id, title: p.title }));
    }

    case "ORDER_NEEDS_ACTION": {
      const shipments = await prisma.shipment.findMany({
        where: { vendorId, status: "PENDING" },

        select: {
          orderId: true,
          order: { select: { orderNumber: true } },
        },

        orderBy: { createdAt: "asc" },
        take: 15,
      });

      return shipments.map((s) => ({
        id: s.orderId,
        title: s.order.orderNumber,
      }));
    }

    case "QUOTE_REQUEST_UNANSWERED": {
      const items = await prisma.quoteRequest.findMany({
        where: { vendorId, status: "SUBMITTED" },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 15,
      });

      return items.map((q) => ({
        id: q.id,
        title: `Cerere din ${q.createdAt.toLocaleDateString("ro-RO")}`,
      }));
    }

    case "CUSTOMER_REQUEST_UNANSWERED": {
      const items = await prisma.customerRequest.findMany({
        where: {
          status: "OPEN",
          offers: { none: { vendorId } },
        },

        select: { id: true, title: true },
        take: 15,
      });

      return items.map((r) => ({ id: r.id, title: r.title }));
    }

    case "HOMEPAGE_FEATURE_PENDING_RESPONSE": {
      const items = await prisma.homepageFeature.findMany({
        where: {
          vendorId,
          vendorDiscountStatus: "PENDING",
          endsAt: { gte: new Date() },
        },

        select: { id: true, type: true },
        take: 15,
      });

      return items.map((f) => ({
        id: f.id,

        title:
          f.type === "PRODUCT_OF_DAY"
            ? "Produsul zilei"
            : "Artizanul săptămânii",
      }));
    }

    default:
      return [];
  }
}

/* ======================================================
   NAVIGARE SIGURĂ (ACTIONABLE RECOMMENDATIONS) - STRICT navigațional
   sau reluarea fluxului "arată-mi produsele" deja existent
   (getInsightItemsList mai sus, folosit deja de SHOW_DETAIL_RE din
   copilotRouter.js) - NICIO acțiune de-aici modifică vreun produs.
   Doar rute REALE (verificate în frontend/src/components/AIAssistant/
   assistantActionRegistry.js și în VendorAssistant.jsx) intră aici.

   Colecțiile NU au încă o pagină/flow real de CREARE pentru vendor
   (doar un dropdown de SELECTAT o colecție deja existentă, în tab-ul
   de coduri de reducere) - NO_ACTIVE_COLLECTIONS rămâne DELIBERAT
   fără navAction, ca să nu trimitem vendorul spre un buton
   inexistent (cerință explicită: "dacă o recomandare nu are
   destinație sigură, păstrează doar textul").
====================================================== */
const NAV_ACTION_BY_INSIGHT_TYPE = {
  PRODUCT_NO_VIDEO: {
    kind: "items",
    label: "Arată-mi produsele fără video",
  },

  PRODUCT_INCOMPLETE_LISTING: {
    kind: "items",
    label: "Arată-mi produsele de îmbunătățit",
  },

  PRODUCT_OUT_OF_STOCK: {
    kind: "items",
    label: "Arată-mi produsele cu probleme de stoc",
  },

  PRODUCT_HIDDEN_OR_INACTIVE: {
    kind: "items",
    label: "Arată-mi produsele ascunse",
  },

  /*
   * Deschide wizardul de adăugare produs DEJA existent în chat
   * (openAddProductWizard, VendorAssistant.jsx) - vendorul completează
   * el însuși totul, nicio generare/publicare automată.
   */
  CATALOG_LOW_SIZE: {
    kind: "add-product",
    label: "Adaugă un produs",
  },

  /*
   * Rută reală, verificată: frontend/src/components/AIAssistant/
   * assistantActionRegistry.js -> STORE_PROFILE ("/setari?tab=profile",
   * "profilul magazinului tău (nume, descriere, logo, adresă)").
   */
  STORE_PROFILE_INCOMPLETE: {
    kind: "route",
    route: "/setari?tab=profile",
    label: "Completează profilul",
  },

  /*
   * Rută reală, verificată: CatalogProduse.jsx randează
   * VendorDiscountCodesTab la tab==="codes" - formularul de creare
   * cod există deja acolo.
   */
  NO_ACTIVE_DISCOUNT_CODES: {
    kind: "route",
    route: "/vendor/catalog?tab=codes",
    label: "Creează un cod",
  },
};

function attachNavAction(insight) {
  if (!insight) return insight;

  return {
    ...insight,
    navAction: NAV_ACTION_BY_INSIGHT_TYPE[insight.type] || null,
  };
}

/**
 * Punctul de intrare - toate insight-urile relevante pentru un
 * vendor, calculate live, sortate după severitate (IMPORTANT ->
 * WARNING -> INFO). NU garantează niciun rezultat - un vendor fără
 * probleme primește un array gol, nu insight-uri inventate.
 */
export async function getVendorInsights(vendorId) {
  const [
    costingInsights,
    stockInsight,
    hiddenOrInactiveInsight,
    incompleteListingInsight,
    ordersInsight,
    quoteInsights,
    homepageFeatureInsight,
    videoInsight,
    lowCatalogSizeInsight,
    storeProfileInsight,
    promotionSetupInsights,
  ] = await Promise.all([
    buildCostingInsights(vendorId),
    buildStockInsight(vendorId),
    buildProductHiddenOrInactiveInsight(vendorId),
    buildProductIncompleteListingInsight(vendorId),
    buildOrdersInsight(vendorId),
    buildQuoteInsights(vendorId),
    buildHomepageFeatureInsight(vendorId),
    buildProductVideoInsight(vendorId),
    buildLowCatalogSizeInsight(vendorId),
    buildStoreProfileInsight(vendorId),
    buildPromotionSetupInsights(vendorId),
  ]);

  const all = [
    ...costingInsights,
    stockInsight,
    hiddenOrInactiveInsight,
    incompleteListingInsight,
    ordersInsight,
    ...quoteInsights,
    homepageFeatureInsight,
    videoInsight,
    lowCatalogSizeInsight,
    storeProfileInsight,
    ...promotionSetupInsights,
  ].filter(Boolean);

  return all
    .sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    )
    .map(attachNavAction);
}
