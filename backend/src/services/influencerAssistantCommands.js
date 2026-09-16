// backend/src/services/influencerAssistantCommands.js

/*
 * Funcții DETERMINISTE pentru asistentul AI, rol INFLUENCER (FAZA 2).
 *
 * Fiecare funcție e un wrapper SUBȚIRE peste servicii/query-uri deja
 * existente (vezi importurile) - nicio duplicare de logică, niciun
 * calcul de comision/atribuire reinventat aici. LLM-ul NU calculează
 * nimic - primește doar rezultatul acestor funcții și îl formulează.
 *
 * ACTION PAYLOAD (FAZA 2, punctul 7 din cerință):
 * Fiecare recomandare/răspuns care are sens de navigare vine cu un
 * câmp `target`, în vocabularul DEJA DECLARAT în
 * frontend/src/components/AIAssistant/assistantActionRegistry.js
 * (ASSISTANT_ACTION_TYPES: NAVIGATE, APPLY_FILTER, OPEN_PRODUCT, ...) -
 * verificat explicit înainte de a scrie acest fișier (vezi raportul
 * FAZA 2): acel registru e static (target -> route fix), fără niciun
 * mecanism de a transporta un URL/id dinamic prin `target` singur.
 * OPEN_PRODUCT/OPEN_STORE există deja DECLARATE în enum, dar NU sunt
 * încă folosite de nicio intrare din registru și NU sunt încă
 * interpretate de AiAssistant.jsx (verificat - doar OPEN_MODAL are
 * handler azi) - sunt vocabular pregătit, neimplementat.
 *
 * Design ales (minim, reutilizează tot ce există):
 * - Pentru navigare STATICĂ (tab-uri dashboard, resurse cu filtre):
 *   type: "NAVIGATE" (deja existent) + navigateTarget: un target
 *   semantic NOU ("INFLUENCER_DASHBOARD"/"INFLUENCER_RESOURCES"/
 *   "INFLUENCER_ORDERS"/"INFLUENCER_PROMOTION"/"INFLUENCER_COLLECTIONS"),
 *   pe care FAZA 3 îl adaugă în ASSISTANT_ACTION_REGISTRY - simplă
 *   adăugare de intrări, fără schimbare de mecanism.
 * - Pentru filtre pe resurse: params: { category, activity } - se
 *   mapează 1:1 pe CATEGORIES/SEGMENTS deja existente în
 *   InfluencerResourcesSection.jsx (id-uri IDENTICE, nu inventate:
 *   ARTFEST_FEATURE/PRODUCT_OF_DAY/ARTISAN_OF_WEEK/CAMPAIGN/
 *   new_products/new_vendors/all, respectiv toPost/toRepost/posted/all).
 * - Pentru deschiderea unui produs public: type: "OPEN_PRODUCT"
 *   (deja declarat, reutilizat ca atare) + params: { productId }.
 * - Pentru deschiderea unei colecții publice a influencerului: type:
 *   "OPEN_COLLECTION" - SINGURUL tip nou propus (nu există niciun
 *   echivalent declarat) - mirror EXACT al lui OPEN_STORE (aceeași
 *   idee: entitate publică, deschisă după slug), pentru că
 *   /selectii/:slug e o rută diferită de /magazin/:slug (OPEN_STORE
 *   ar rezolva greșit dacă am reutilizat acel tip). FAZA 3 decide
 *   definitiv dacă îl adaugă în ASSISTANT_ACTION_TYPES.
 */

import { prisma } from "../db.js";

import { getInfluencerResourcesBundle } from "../routes/influencerRoutes.js";
import { listInfluencerCollectionsSummary } from "../routes/influencerCollectionRoutes.js";
import { listInfluencerDiscountCodesSummary } from "../routes/influencerDiscountCodesRoutes.js";

import {
  getInfluencerConfirmedTotals,
  getInfluencerEstimatedEarnings,
  listInfluencerAttributedOrders,
} from "./influencerEarnings.js";

import { mapSafeOrder } from "./influencerAssistantContext.js";

/*
 * Interval FIX de "de repostat" - ACELAȘI prag ca în
 * InfluencerResourcesSection.jsx (frontend) și
 * adminInfluencerResourcesRoutes.js (backend admin) - duplicat
 * intenționat ca o constantă simplă, NU citit dintr-un câmp Prisma
 * (decizie explicită anterioară a userului, păstrată aici la fel).
 */
const REPOST_THRESHOLD_DAYS = 14;

const ORDERS_DEFAULT_LIMIT = 10;

/* =========================================================
   HELPERS TIMP / STATUS RESURSE

   Oglindă exactă a getResourceStatus()/daysBetween() din
   InfluencerResourcesSection.jsx, ca "de repostat" să însemne
   EXACT același lucru pentru asistent și pentru dashboard.
========================================================= */

function daysSince(value, now = new Date()) {
  if (!value) return null;

  const past = new Date(value);
  if (Number.isNaN(past.getTime())) return null;

  const startOfPast = new Date(
    past.getFullYear(),
    past.getMonth(),
    past.getDate()
  );

  const startOfNow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  return Math.round((startOfNow - startOfPast) / 86400000);
}

function getResourceGroup(activity) {
  if (!activity?.lastPostedAt) return "toPost";

  const days = daysSince(activity.lastPostedAt);
  if (days === null) return "toPost";

  return days >= REPOST_THRESHOLD_DAYS ? "toRepost" : "posted";
}

/* =========================================================
   ACTION TARGET BUILDERS (vezi comentariul din capul fișierului)
========================================================= */

function buildResourcesTarget({
  category = "all",
  activity = "all",
} = {}) {
  return {
    type: "NAVIGATE",
    navigateTarget: "INFLUENCER_RESOURCES",
    params: { category, activity },
    label: "resursele tale",
  };
}

function buildDashboardTarget() {
  return {
    type: "NAVIGATE",
    navigateTarget: "INFLUENCER_DASHBOARD",
    params: {},
    label: "panoul tău de influencer",
  };
}

function buildOrdersTarget() {
  return {
    type: "NAVIGATE",
    navigateTarget: "INFLUENCER_ORDERS",
    params: {},
    label: "comenzile tale",
  };
}

function buildPromotionTarget() {
  return {
    type: "NAVIGATE",
    navigateTarget: "INFLUENCER_PROMOTION",
    params: {},
    label: "promovarea ta",
  };
}

function buildCollectionsTarget() {
  return {
    type: "NAVIGATE",
    navigateTarget: "INFLUENCER_COLLECTIONS",
    params: {},
    label: "colecțiile tale",
  };
}

/*
 * FAZA 3b - OPEN_PRODUCT poate fi construit fie dintr-un productId
 * real (Artfest), fie dintr-un `url` deja rezolvat (ex. targetUrl-ul
 * unei resurse PRODUCT_OF_DAY/ARTISAN_OF_WEEK, setat liber de admin -
 * InfluencerResource NU are un câmp productId, doar targetUrl, vezi
 * schema.prisma). Frontend-ul (assistantActionRegistry.js +
 * AiAssistant.jsx, FAZA 3) știe deja să interpreteze ambele forme.
 * Nu construim NICIODATĂ un URL - doar transmitem targetUrl exact
 * cum e salvat.
 */
function buildOpenProductTarget({ productId, url } = {}) {
  return {
    type: "OPEN_PRODUCT",
    params: productId ? { productId } : { url },
    label: "produsul",
  };
}

function buildOpenCollectionTarget(slug) {
  return {
    type: "OPEN_COLLECTION",
    params: { slug, publicUrl: `/selectii/${slug}` },
    label: "colecția ta",
  };
}

/* =========================================================
   1. getInfluencerSummary
========================================================= */

export async function getInfluencerSummary({ influencerId }) {
  const [
    profile,
    bundle,
    confirmedTotals,
    estimatedEarningsAmount,
    collections,
    discountCodes,
  ] = await Promise.all([
    prisma.influencerProfile.findUnique({
      where: { id: influencerId },

      select: {
        id: true,
        displayName: true,
        referralCode: true,
        commissionBps: true,
        status: true,
      },
    }),

    getInfluencerResourcesBundle(influencerId),
    getInfluencerConfirmedTotals(influencerId),
    getInfluencerEstimatedEarnings(influencerId),
    listInfluencerCollectionsSummary(influencerId),
    listInfluencerDiscountCodesSummary(influencerId),
  ]);

  const resourceCounts = { toPost: 0, toRepost: 0, posted: 0 };

  for (const item of bundle.items) {
    resourceCounts[getResourceGroup(item.activity)] += 1;
  }

  return {
    profile,

    resources: {
      total: bundle.items.length,
      ...resourceCounts,
    },

    newProductsTodayCount: bundle.generatedContent.newProductsToday.length,
    newVendorsTodayCount: bundle.generatedContent.newVendorsToday.length,

    collectionsCount: collections.length,
    discountCodesCount: discountCodes.length,

    earnings: {
      ordersCount: confirmedTotals.ordersCount,
      salesAmount: confirmedTotals.salesAmount,
      confirmedEarningsAmount: confirmedTotals.confirmedEarningsAmount,
      estimatedEarningsAmount,
      currency: "RON",
    },

    target: buildDashboardTarget(),
  };
}

/* =========================================================
   2. getInfluencerResources
========================================================= */

export async function getInfluencerResources({
  influencerId,
  category = "all",
  activity = "all",
}) {
  const bundle = await getInfluencerResourcesBundle(influencerId);

  if (category === "new_products") {
    return {
      focus: "new_products",
      items: [],
      newProductsToday: bundle.generatedContent.newProductsToday,
      target: buildResourcesTarget({ category: "new_products" }),
    };
  }

  if (category === "new_vendors") {
    return {
      focus: "new_vendors",
      items: [],
      newVendorsToday: bundle.generatedContent.newVendorsToday,
      target: buildResourcesTarget({ category: "new_vendors" }),
    };
  }

  const items = bundle.items
    .filter((item) => category === "all" || item.type === category)
    .filter(
      (item) =>
        activity === "all" || getResourceGroup(item.activity) === activity
    )
    .map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      mediaUrl: item.mediaUrl,
      mediaType: item.mediaType,
      targetUrl: item.targetUrl,
      group: getResourceGroup(item.activity),
      daysSincePosted: daysSince(item.activity?.lastPostedAt),
      postedCount: item.activity?.postedCount || 0,
    }));

  /*
   * FAZA 3b - "Deschide produsul zilei"/"Deschide artizanul
   * săptămânii" trebuie să deschidă REALMENTE resursa, nu doar
   * tab-ul filtrat, dacă ea are un link (targetUrl - singurul câmp
   * disponibil, InfluencerResource nu are productId). Scoped STRICT
   * la aceste două categorii - pentru orice alt filtru (all/
   * ARTFEST_FEATURE/CAMPAIGN), target-ul rămâne cel generic de mai
   * jos (deschide lista filtrată, nu o resursă anume - are sens doar
   * când există UNA singură, canonică, per zi/săptămână).
   *
   * Fallback determinist, NU inventat: dacă nu există nicio resursă
   * publicată din acea categorie SAU resursa nu are targetUrl, rămâne
   * target-ul generic (INFLUENCER_RESOURCES, filtrat) - exact cerința
   * "nu inventa URL".
   */
  const isSingleResourceCategory =
    category === "PRODUCT_OF_DAY" ||
    category === "ARTISAN_OF_WEEK";

  const target =
    isSingleResourceCategory &&
    items.length &&
    items[0].targetUrl
      ? buildOpenProductTarget({ url: items[0].targetUrl })
      : buildResourcesTarget({ category, activity });

  return {
    focus: "resources",
    items,
    target,
  };
}

/* =========================================================
   3. getInfluencerOrders
========================================================= */

export async function getInfluencerOrders({
  influencerId,
  take = ORDERS_DEFAULT_LIMIT,
  skip = 0,
}) {
  const page = await listInfluencerAttributedOrders({
    influencerId,
    take,
    skip,
  });

  const items = page.items.map(mapSafeOrder);

  /*
   * FAZA 3b - empty state util: dacă influencerul nu a adus încă
   * nicio comandă, "Vezi comenzile" (o listă goală) nu ajută la
   * nimic - target-ul devine INFLUENCER_PROMOTION, ca să-l ducem
   * spre pasul următor (link/cod/colecții), nu doar să închidem
   * conversația.
   */
  return {
    items,
    total: page.total,
    target: items.length
      ? buildOrdersTarget()
      : buildPromotionTarget(),
  };
}

/* =========================================================
   4. getInfluencerEarnings
========================================================= */

export async function getInfluencerEarnings({ influencerId }) {
  const [confirmedTotals, estimatedEarningsAmount] = await Promise.all([
    getInfluencerConfirmedTotals(influencerId),
    getInfluencerEstimatedEarnings(influencerId),
  ]);

  return {
    ordersCount: confirmedTotals.ordersCount,
    salesAmount: confirmedTotals.salesAmount,
    confirmedEarningsAmount: confirmedTotals.confirmedEarningsAmount,
    estimatedEarningsAmount,

    /*
     * Nu există azi un agregat separat de "total reversat" expus de
     * niciun serviciu existent (getInfluencerConfirmedTotals întoarce
     * deja suma NETĂ, după reversări) - NU inventăm unul aici. Dacă e
     * nevoie explicit ca număr separat, e un query nou, în afara
     * scopului FAZEI 2.
     */
    reversedEarningsAmount: null,

    currency: "RON",
    target: buildOrdersTarget(),
  };
}

/* =========================================================
   5. getInfluencerCollections
========================================================= */

export async function getInfluencerCollections({ influencerId }) {
  const collections = await listInfluencerCollectionsSummary(influencerId);

  return {
    items: collections.map((collection) => ({
      id: collection.id,
      title: collection.title,
      slug: collection.slug,
      publicUrl: `/selectii/${collection.slug}`,
      productsCount: collection.productsCount,
      isActive: collection.isActive,
    })),

    target: collections.length
      ? buildOpenCollectionTarget(collections[0].slug)
      : buildPromotionTarget(),
  };
}

/* =========================================================
   6. getInfluencerDiscountCodes
========================================================= */

export async function getInfluencerDiscountCodes({ influencerId }) {
  const discountCodes = await listInfluencerDiscountCodesSummary(
    influencerId
  );

  return {
    items: discountCodes.map((code) => ({
      id: code.id,
      code: code.code,
      name: code.name,
      status: code.status,
      isActive: code.isActive,
      discountPercent: code.discountPercent,
      scope: code.scope,
      collection: code.collection,
    })),

    target: buildPromotionTarget(),
  };
}

/* =========================================================
   7. getInfluencerTodayRecommendations

   100% determinist - NICIO frază conversațională de tip "Astăzi ai
   X lucruri utile" NU se construiește aici (asta ține de stratul
   care formulează răspunsul, vezi composeInfluencerAnswer în
   copilotRouter.js) - doar date, în ordinea de prioritate cerută.
   Maximum 5 recomandări, câte UNA per categorie (nu una per resursă),
   ca să nu inunde răspunsul cu mai multe intrări din aceeași grupă.
========================================================= */

function findUnpostedByType(items, type) {
  return (
    items.find(
      (item) => item.type === type && !item.activity?.lastPostedAt
    ) || null
  );
}

function findMostOverdueRepost(items) {
  let best = null;
  let bestDays = -1;

  for (const item of items) {
    if (!item.activity?.lastPostedAt) continue;

    const days = daysSince(item.activity.lastPostedAt);

    if (
      days !== null &&
      days >= REPOST_THRESHOLD_DAYS &&
      days > bestDays
    ) {
      best = item;
      bestDays = days;
    }
  }

  return best ? { item: best, days: bestDays } : null;
}

function findActiveCampaign(items) {
  const unposted = items.filter(
    (item) => item.type === "CAMPAIGN" && !item.activity?.lastPostedAt
  );

  if (unposted.length) return unposted[0];

  return items.find((item) => item.type === "CAMPAIGN") || null;
}

export async function getInfluencerTodayRecommendations({
  influencerId,
}) {
  const bundle = await getInfluencerResourcesBundle(influencerId);
  const items = bundle.items;

  const recommendations = [];

  const productOfDay = findUnpostedByType(items, "PRODUCT_OF_DAY");

  if (productOfDay) {
    recommendations.push({
      type: "PRODUCT_OF_DAY",
      priority: 1,
      title: "Postează Produsul zilei",
      reason: "Nu ai postat încă despre produsul zilei de azi.",
      target: buildResourcesTarget({
        category: "PRODUCT_OF_DAY",
        activity: "toPost",
      }),

      metadata: {
        resourceId: productOfDay.id,
        title: productOfDay.title,
        mediaUrl: productOfDay.mediaUrl || null,
      },
    });
  }

  const artisanOfWeek = findUnpostedByType(items, "ARTISAN_OF_WEEK");

  if (artisanOfWeek) {
    recommendations.push({
      type: "ARTISAN_OF_WEEK",
      priority: 2,
      title: "Postează Artizanul săptămânii",
      reason: "Nu ai postat încă despre artizanul săptămânii.",
      target: buildResourcesTarget({
        category: "ARTISAN_OF_WEEK",
        activity: "toPost",
      }),

      metadata: {
        resourceId: artisanOfWeek.id,
        title: artisanOfWeek.title,
        mediaUrl: artisanOfWeek.mediaUrl || null,
      },
    });
  }

  const overdueRepost = findMostOverdueRepost(items);

  if (overdueRepost) {
    recommendations.push({
      type: "REPOST",
      priority: 3,
      title: `Repostează: ${overdueRepost.item.title}`,

      reason: `Ultima dată ai marcat-o acum ${overdueRepost.days} zile.`,

      target: buildResourcesTarget({
        category: "all",
        activity: "toRepost",
      }),

      metadata: {
        resourceId: overdueRepost.item.id,
        resourceType: overdueRepost.item.type,
        daysSincePosted: overdueRepost.days,
      },
    });
  }

  const feature = findUnpostedByType(items, "ARTFEST_FEATURE");

  if (feature) {
    recommendations.push({
      type: "ARTFEST_FEATURE",
      priority: 4,
      title: `Postează: ${feature.title}`,

      reason:
        "Este o funcționalitate Artfest pe care nu ai promovat-o încă.",

      target: buildResourcesTarget({
        category: "ARTFEST_FEATURE",
        activity: "toPost",
      }),

      metadata: {
        resourceId: feature.id,
        title: feature.title,
      },
    });
  }

  const campaign = findActiveCampaign(items);

  if (campaign) {
    recommendations.push({
      type: "CAMPAIGN",
      priority: 5,
      title: `Promovează campania: ${campaign.title}`,

      reason: campaign.activity?.lastPostedAt
        ? "Campanie activă - poți reaminti comunității tale despre ea."
        : "Campanie activă, încă nepromovată.",

      target: buildResourcesTarget({
        category: "CAMPAIGN",
        activity: "all",
      }),

      metadata: {
        resourceId: campaign.id,
        title: campaign.title,
      },
    });
  }

  const newProductsToday = bundle.generatedContent.newProductsToday;

  if (newProductsToday.length) {
    recommendations.push({
      type: "NEW_PRODUCTS",
      priority: 6,
      title: `${newProductsToday.length} produse noi azi`,

      reason:
        "Produse publicate azi de vânzători Artfest, eligibile pentru promovare.",

      target: buildResourcesTarget({ category: "new_products" }),

      metadata: { count: newProductsToday.length },
    });
  }

  const newVendorsToday = bundle.generatedContent.newVendorsToday;

  if (newVendorsToday.length) {
    recommendations.push({
      type: "NEW_VENDORS",
      priority: 7,
      title: `${newVendorsToday.length} vânzători noi azi`,

      reason: "Magazine noi pe Artfest, publicate azi.",

      target: buildResourcesTarget({ category: "new_vendors" }),

      metadata: { count: newVendorsToday.length },
    });
  }

  return recommendations.slice(0, 5);
}

/* =========================================================
   DETECTARE SCOP (mesaj -> ce comandă apelăm)

   Oglindă a detectInsightScope() din copilotRouter.js (VENDOR) -
   determinist, pe cuvinte-cheie normalizate (fără diacritice), NU
   LLM. copilotRouter.js apelează asta DUPĂ ce clasificatorul general
   a decis deja categoria (VENDOR_INSIGHTS reutilizat și pentru
   INFLUENCER, sau ORDER_HELP pentru comenzi) - vezi FAZA 2, punctul 6.
========================================================= */

/*
 * Scris fără literal de regex pentru intervalul de diacritice
 * combinate (0x0300-0x036F) - EXACT ca stripDiacritics() din
 * influencerRoutes.js, ca să evităm orice ambiguitate de encoding
 * a caracterelor combinate direct într-un regex.
 */
function normalizeForScopeDetection(text) {
  let result = "";

  for (const ch of String(text || "").normalize("NFD")) {
    const code = ch.codePointAt(0);

    if (code >= 0x0300 && code <= 0x036f) {
      continue;
    }

    result += ch;
  }

  return result.toLowerCase();
}

const INFLUENCER_SCOPE_PATTERNS = [
  [
    "TODAY",
    /\bce (sa |s-)?fac\w* azi\b|\bce am de facut azi\b|\bce (sa )?postez\b|\bce trebuie sa fac\b|\bce ar trebui sa (postez|fac)\b/,
  ],
  [
    "REPOST",
    /\bde repostat\b|\bce am de repostat\b|\bn-?am mai promovat\b|\bnu am mai promovat\b|\bce nu am mai postat\b/,
  ],
  ["PRODUCT_OF_DAY", /\bprodusul zilei\b/],
  ["ARTISAN_OF_WEEK", /\bartizanul saptaman\w*\b/],
  ["NEW_PRODUCTS", /\bproduse noi\b/],
  ["NEW_VENDORS", /\bvanzatori noi\b|\bvinzatori noi\b/],
  [
    "DISCOUNT_CODES",
    /\bcodul meu\b|\bcod(uri)? de reducere\b|\blinkul meu\b|\blink(ul)? personal\b/,
  ],
  ["EARNINGS", /\bcat am castigat\b|\bcastigurile mele\b|\bcastigul meu\b/],
  /*
   * FAZA 4 (fix) - "mele"/"ce ... am" NU mai e obligatoriu ("Arată-mi
   * colecțiile.", "Deschide colecțiile." trebuie să intre aici la
   * fel ca "Colecțiile mele."/"Ce colecții am?") - rădăcina
   * "colecti" (după normalizare, fără diacritice) rămâne suficient
   * de specifică în română, nu apare accidental în alte cuvinte.
   */
  ["COLLECTIONS", /\bcolecti\w*\b/],
  [
    "RESOURCES",
    /\bmateriale\b|\bresurse\b|\bunde gasesc materialele\b|\bcum descarc\b/,
  ],
];

export function detectInfluencerQueryScope(message) {
  const text = normalizeForScopeDetection(message);

  for (const [scope, pattern] of INFLUENCER_SCOPE_PATTERNS) {
    if (pattern.test(text)) {
      return scope;
    }
  }

  return "SUMMARY";
}

/* =========================================================
   COMPUNERE RĂSPUNS (determinist, fără LLM)

   Aceeași disciplină ca și composeInsightsAnswer (VENDOR) - textul
   afișat vine STRICT din datele calculate mai sus, niciodată dintr-o
   invenție a modelului.
========================================================= */

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("ro-RO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} lei`;
}

export function composeInfluencerAnswer(scope, data) {
  if (scope === "TODAY") {
    const recommendations = data;

    if (!recommendations.length) {
      return "Nu am nimic nou de recomandat chiar acum - ești la zi cu tot ce ai putea posta.";
    }

    const lines = recommendations.map(
      (item, index) => `${index + 1}. ${item.title} - ${item.reason}`
    );

    const intro =
      recommendations.length === 1
        ? "Astăzi ai un singur lucru util:"
        : `Astăzi ai ${recommendations.length} lucruri utile:`;

    return `${intro}\n\n${lines.join("\n")}`;
  }

  if (
    scope === "REPOST" ||
    scope === "RESOURCES" ||
    scope === "NEW_PRODUCTS" ||
    scope === "NEW_VENDORS"
  ) {
    const { items, focus } = data;

    if (focus === "new_products") {
      return data.newProductsToday.length
        ? `Azi au apărut ${data.newProductsToday.length} produse noi eligibile pentru promovare.`
        : "Nu au apărut produse noi azi.";
    }

    if (focus === "new_vendors") {
      return data.newVendorsToday.length
        ? `Azi s-au alăturat ${data.newVendorsToday.length} vânzători noi.`
        : "Nu s-au alăturat vânzători noi azi.";
    }

    if (!items.length) {
      return scope === "REPOST"
        ? "Nu ai nimic de repostat momentan - toate resursele sunt fie postate recent, fie deja acoperite."
        : "Nu există resurse disponibile pentru acest filtru.";
    }

    const lines = items
      .slice(0, 5)
      .map(
        (item, index) =>
          `${index + 1}. ${item.title}${
            item.daysSincePosted !== null
              ? ` - ultima postare acum ${item.daysSincePosted} zile`
              : " - nu ai postat încă"
          }`
      );

    return `${
      scope === "REPOST"
        ? "De repostat"
        : "Resurse disponibile"
    }:\n\n${lines.join("\n")}`;
  }

  if (scope === "PRODUCT_OF_DAY" || scope === "ARTISAN_OF_WEEK") {
    const { items } = data;

    if (!items.length) {
      return scope === "PRODUCT_OF_DAY"
        ? "Nu există un Produs al zilei publicat momentan."
        : "Nu există un Artizan al săptămânii publicat momentan.";
    }

    const [item] = items;

    return `${item.title}${
      item.description ? ` - ${item.description}` : ""
    }${
      item.daysSincePosted !== null
        ? `\n\nAi postat despre el acum ${item.daysSincePosted} zile.`
        : "\n\nNu ai postat încă despre el."
    }`;
  }

  if (scope === "DISCOUNT_CODES") {
    const { items } = data;

    if (!items.length) {
      return "Nu ai încă niciun cod de reducere. Pot să te duc la Promovare ca să creezi unul.";
    }

    const lines = items
      .slice(0, 5)
      .map(
        (code) =>
          `${code.code} - ${code.discountPercent}%${
            code.isActive ? "" : " (inactiv)"
          }`
      );

    return `Codurile tale de reducere:\n\n${lines.join("\n")}`;
  }

  if (scope === "EARNINGS") {
    return (
      `Câștig confirmat: ${formatMoney(
        data.confirmedEarningsAmount
      )}\n` +
      `Câștig estimat: ${formatMoney(data.estimatedEarningsAmount)}\n` +
      `Comenzi confirmate: ${data.ordersCount}`
    );
  }

  if (scope === "COLLECTIONS") {
    const { items } = data;

    if (!items.length) {
      return "Nu ai încă nicio colecție. Pot să te duc la Promovare ca să creezi una.";
    }

    const lines = items
      .slice(0, 5)
      .map(
        (collection) =>
          `${collection.title} - ${collection.productsCount} produse (${collection.publicUrl})`
      );

    return `Colecțiile tale:\n\n${lines.join("\n")}`;
  }

  if (scope === "SUMMARY") {
    const lines = [
      `Resurse: ${data.resources.toPost} de postat, ${data.resources.toRepost} de repostat, ${data.resources.posted} postate recent.`,
      `Produse noi azi: ${data.newProductsTodayCount}. Vânzători noi azi: ${data.newVendorsTodayCount}.`,
      `Colecții: ${data.collectionsCount}. Coduri de reducere: ${data.discountCodesCount}.`,
      `Câștig confirmat: ${formatMoney(
        data.earnings.confirmedEarningsAmount
      )}. Câștig estimat: ${formatMoney(
        data.earnings.estimatedEarningsAmount
      )}.`,
    ];

    return lines.join("\n");
  }

  return "Nu am găsit informații pentru această întrebare.";
}
