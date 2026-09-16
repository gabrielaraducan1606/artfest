// backend/src/services/vendorAssistantProducts.js
//
// BATCH 2 (FINAL GAP PASS, 2026-09-07) - serviciu SUBȚIRE, read-only,
// pentru "Câte produse am? / Ce produse am?" puse de un vendor
// autentificat (audit inițial: MISSING_LIVE_TOOL - niciun tool din
// Batch 2-E anteriors, nici serviciul original
// (vendorAssistantCommandService.js, STRICT READ_PROFITABILITY/
// READ_PRODUCT_COST/READ_LIBRARY, confirmat prin grep), nu acoperea un
// simplu numărat/listat de produse).
//
// NU duplică logica de business din vendorCatalogProductsRoutes.js -
// reutilizează ACELAȘI model Prisma (Product, via service.vendorId) și
// ACEEAȘI relație deja folosită de GET /api/vendor/catalog/products.
//
// Scop STRICT: numărare/listare simplă - statusurile (ascunse/inactive/
// probleme) rămân STRICT pe VENDOR_INSIGHTS (insightsService.js), deja
// funcțional - gate-ul de mai jos exclude explicit acele formulări, ca
// să nu fure întrebări care au deja un răspuns mai bun.

import { prisma } from "../db.js";

function stripDiacritics(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ă/g, "a")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/ș|ş/g, "s")
    .replace(/ț|ţ/g, "t");
}

/*
 * Poartă STRICTĂ: doar "câte produse am"/"ce produse am", fără alt
 * cuvânt de status/problemă - acelea au deja un răspuns LIVE mai bun
 * prin VENDOR_INSIGHTS (ascunse/inactive/stoc/incomplete) sau prin
 * vendorAssistantSales.js (vândute/nevândute, Batch 2).
 */
const OTHER_DOMAIN_HINT_RE =
  /vandut|stoc|ascun|inactiv|problem|incomplet|imagini|actualiz|public|cost|profit/;

export function detectProductLiveTopic(message) {
  const t = stripDiacritics(message);

  const isPlainCountOrList = /\b(ce|cate)\s+produse\s+am\b/.test(t);
  if (!isPlainCountOrList) return null;

  if (OTHER_DOMAIN_HINT_RE.test(t)) return null;

  return "TOTAL";
}

/*
 * Punct de intrare unic pentru copilotRouter.js. Întoarce `null` dacă
 * mesajul NU e o întrebare simplă de numărare/listare a produselor.
 */
export async function answerVendorProductQuestion({ vendorId, message }) {
  const topic = detectProductLiveTopic(message);
  if (!topic) return null;

  const total = await prisma.product.count({
    where: { service: { vendorId } },
  });

  if (!total) {
    return { message: "Nu ai niciun produs momentan.", topic };
  }

  const recent = await prisma.product.findMany({
    where: { service: { vendorId } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { title: true },
  });

  const lines = recent.map((p, i) => `${i + 1}. ${p.title}`);
  const countPhrase = total === 1 ? "1 produs" : `${total} produse`;

  return {
    message: `Ai ${countPhrase} în total.\n\nCele mai recente:\n\n${lines.join("\n")}`,
    topic,
  };
}
