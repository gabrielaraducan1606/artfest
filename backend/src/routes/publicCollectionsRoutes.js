// backend/src/routes/publicCollectionsRoutes.js
//
// GET /api/public/collections?placement=homepage|menu|all
//
// Lista PUBLICĂ de colecții Artfest (model Collection), pentru linkurile
// interne: secțiunea din Home (showOnHomepage), meniul de navigare
// (showInMenu) și pagina index /colectii (all). Până acum exista doar
// GET /api/public/collections/:slug (o colecție anume,
// publicProductRoutes.js).
//
// - Doar colecții active (isActive: true) - niciodată linkuri către
//   colecții inactive.
// - Doar colecții cu cel puțin un produs public real
//   (collectionsWithPublicProducts): o colecție activă dar goală nu se
//   linkează nicăieri.
// - Doar câmpurile necesare unui card/link (fără rules/promo/ID-uri).
//
// Montat pe /api/public, deci /collections aici nu intră în conflict cu
// /collections/:slug din publicProductRoutes.js (cale diferită).

import { Router } from "express";
import { prisma } from "../db.js";
import { collectionsWithPublicProducts } from "../services/collectionProducts.js";

const router = Router();

const LIMITS = {
  homepage: 12,
  menu: 20,
  any: 20,
  all: 60,
};

const PLACEMENTS = new Set(["homepage", "menu", "all"]);

/**
 * Clauza `where` pentru un placement. Exportată pentru teste.
 * - homepage / menu: flag-ul respectiv.
 * - all: toate colecțiile active (pagina index /colectii).
 * - orice altceva/lipsă: active marcate pentru cel puțin unul dintre cele
 *   două locuri (nu toate colecțiile active).
 */
export function buildPublicCollectionsWhere(placement) {
  if (placement === "homepage") {
    return { isActive: true, showOnHomepage: true };
  }

  if (placement === "menu") {
    return { isActive: true, showInMenu: true };
  }

  if (placement === "all") {
    return { isActive: true };
  }

  return {
    isActive: true,
    OR: [{ showOnHomepage: true }, { showInMenu: true }],
  };
}

router.get("/collections", async (req, res, next) => {
  try {
    const raw = String(req.query.placement || "")
      .trim()
      .toLowerCase();

    const placement = PLACEMENTS.has(raw) ? raw : "any";

    const rows = await prisma.collection.findMany({
      where: buildPublicCollectionsWhere(placement),
      select: {
        slug: true,
        title: true,
        subtitle: true,
        heroImage: true,
        // doar pentru a decide dacă are produse reale; nu ies în răspuns
        rules: true,
        items: {
          select: { productId: true, pinned: true, excluded: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: LIMITS[placement],
    });

    const valid = rows.filter((c) => c.slug && c.title);

    // Un NUMĂR CONSTANT de interogări (max. 2) pentru toate colecțiile din
    // pagina de rezultate, nu câte una per colecție; răspunsul e cache-uit
    // 5 minute.
    const hasProducts = await collectionsWithPublicProducts(prisma, valid);

    res.set("Cache-Control", "public, max-age=60, s-maxage=300");

    return res.json({
      items: valid
        .filter((_, index) => hasProducts[index])
        .map((c) => ({
          slug: c.slug,
          title: c.title,
          subtitle: c.subtitle || "",
          heroImage: c.heroImage || "",
        })),
    });
  } catch (e) {
    console.error("GET /api/public/collections error:", e);
    next(e);
  }
});

export default router;
