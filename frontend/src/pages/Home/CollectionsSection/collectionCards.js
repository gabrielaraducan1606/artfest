// src/pages/Home/CollectionsSection/collectionCards.js
//
// Logică PURĂ (fără React/DOM/import.meta) pentru cardurile de colecții
// din Home și linkurile din meniu: transformă răspunsul
// GET /api/public/collections în carduri gata de randat.
// Backend-ul filtrează deja isActive + showOnHomepage/showInMenu; aici
// doar protejăm UI-ul de rânduri invalide și construim URL-ul intern
// (/colectii/:slug, același cu canonical-ul și cu <loc> din sitemap).

export function collectionPath(slug) {
  return `/colectii/${encodeURIComponent(String(slug || ""))}`;
}

/**
 * @param {Array} items  items din GET /api/public/collections
 * @param {{ resolveImage?: (url: string) => string, max?: number }} [opts]
 * @returns {Array<{slug:string,title:string,subtitle:string,image:string,to:string}>}
 */
export function toCollectionCards(items, { resolveImage, max } = {}) {
  if (!Array.isArray(items)) return [];

  const seen = new Set();
  const cards = [];

  for (const item of items) {
    const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
    const title = typeof item?.title === "string" ? item.title.trim() : "";

    // fără slug/titlu nu se poate face un link util; fără duplicate
    if (!slug || !title || seen.has(slug)) continue;
    seen.add(slug);

    const rawImage =
      typeof item.heroImage === "string" ? item.heroImage.trim() : "";

    cards.push({
      slug,
      title,
      subtitle: typeof item.subtitle === "string" ? item.subtitle.trim() : "",
      image: rawImage && resolveImage ? resolveImage(rawImage) : rawImage,
      to: collectionPath(slug),
    });

    if (max && cards.length >= max) break;
  }

  return cards;
}
