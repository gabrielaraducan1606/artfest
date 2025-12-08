// server/routes/admin.cities.js
import { Router } from "express";
import { prisma } from "../db.js";
import {
  normalizeCityName,
  hasRomanianDiacritics,
} from "../utils/cityUtils.js";
import { authRequired } from "../api/auth.js";
// import { adminRequired } from "../api/auth.js";

const router = Router();

// doar useri autentificați (ideal: adminRequired)
router.use(authRequired);
// router.use(adminRequired);

/**
 * Helper: preferăm varianta cu diacritice dacă există.
 * Dacă ai mai multe variante pentru același slug, alegem label-ul "cel mai frumos".
 */
function pickBetterLabel(existing, candidate) {
  if (!existing) return candidate;
  if (!candidate) return existing;

  if (hasRomanianDiacritics(candidate) && !hasRomanianDiacritics(existing)) {
    return candidate;
  }
  return existing;
}

/**
 * GET /api/admin/cities/variants
 *
 * Returnează toate orașele folosite în Vendor și ServiceProfile,
 * grupate după citySlug (normalizat).
 *
 * Structură:
 * {
 *   groups: [
 *     {
 *       slug: "bacau",
 *       canonicalLabel: "Bacău",   // afișat efectiv (dicționar > variante brute)
 *       adminLabel: "Bacău",       // DOAR ce e în CityDictionary (sau null)
 *       totalCount: 12,
 *       variants: [
 *         { label: "Bacau", count: 5 },
 *         { label: "Bacău", count: 6 },
 *         { label: "bacău", count: 1 }
 *       ]
 *     },
 *     ...
 *   ]
 * }
 */
router.get("/cities/variants", async (_req, res, next) => {
  try {
    // 0) încărcăm dicționarul definit de admin
    const dictRows = await prisma.cityDictionary.findMany();
    const dictMap = new Map(
      dictRows.map((r) => [r.slug, r.canonicalLabel])
    );

    // 1) orașe distincte + count din Vendor
    const vendorCities = await prisma.vendor.groupBy({
      by: ["citySlug", "city"],
      where: {
        OR: [
          { city: { not: null } },
          { citySlug: { not: null } },
        ],
      },
      _count: { _all: true },
    });

    // 2) orașe distincte + count din ServiceProfile (doar servicii active)
    const profileCities = await prisma.serviceProfile.groupBy({
      by: ["citySlug", "city"],
      where: {
        OR: [
          { city: { not: null } },
          { citySlug: { not: null } },
        ],
        service: {
          is: {
            isActive: true,
            status: "ACTIVE",
            vendor: { is: { isActive: true } },
          },
        },
      },
      _count: { _all: true },
    });

    /**
     * allRows = [
     *   { city: "Bacau", citySlug: "bacau", count: 5, source: "vendor" },
     *   { city: "Bacău", citySlug: "bacau", count: 6, source: "profile" },
     *   ...
     * ]
     */
    const allRows = [
      ...vendorCities.map((r) => ({
        city: r.city,
        citySlug: r.citySlug,
        count: r._count._all,
        source: "vendor",
      })),
      ...profileCities.map((r) => ({
        city: r.city,
        citySlug: r.citySlug,
        count: r._count._all,
        source: "profile",
      })),
    ].filter((r) => (r.city || "").trim().length > 0 || (r.citySlug || "").trim().length > 0);

    // 3) grupăm după slug (folosind citySlug dacă există, altfel normalizeCityName(city))
    const slugMap = new Map();
    // slug -> {
    //   slug,
    //   variants: Map<label, count>,
    //   canonicalLabel,
    //   totalCount
    // }

    for (const row of allRows) {
      const rawCity = (row.city || "").trim();
      const existingSlug = (row.citySlug || "").trim();
      const slug = existingSlug || normalizeCityName(rawCity);
      if (!slug) continue;

      if (!slugMap.has(slug)) {
        slugMap.set(slug, {
          slug,
          variants: new Map(),
          canonicalLabel: rawCity || slug,
          totalCount: 0,
        });
      }

      const group = slugMap.get(slug);

      group.totalCount += row.count;

      const label = rawCity || slug;
      const prevCount = group.variants.get(label) || 0;
      group.variants.set(label, prevCount + row.count);

      group.canonicalLabel = pickBetterLabel(group.canonicalLabel, label);
    }

    // 4) suprascriem canonicalLabel dacă avem ceva în dicționar
    for (const [slug, group] of slugMap.entries()) {
      const fromDict = dictMap.get(slug);
      if (fromDict && fromDict.trim()) {
        group.canonicalLabel = fromDict.trim();
        group.adminLabel = fromDict.trim();
      } else {
        group.adminLabel = null;
      }
    }

    // 5) transformăm în array pentru frontend admin
    const groups = Array.from(slugMap.values())
      .map((g) => ({
        slug: g.slug,
        canonicalLabel: g.canonicalLabel,
        adminLabel: g.adminLabel || null,
        totalCount: g.totalCount,
        variants: Array.from(g.variants.entries())
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) =>
        a.canonicalLabel.localeCompare(b.canonicalLabel, "ro-RO", {
          sensitivity: "base",
        })
      );

    res.json({ groups });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/admin/cities/dictionary
 * Listă simplă cu dicționarul curent (pentru UI admin separat, dacă ai nevoie).
 */
router.get("/cities/dictionary", async (req, res, next) => {
  try {
    const q = (req.query.q || "").toString().trim().toLowerCase();

    const items = await prisma.cityDictionary.findMany({
      orderBy: { slug: "asc" },
    });

    const filtered = q
      ? items.filter(
          (c) =>
            c.slug.toLowerCase().includes(q) ||
            (c.canonicalLabel || "").toLowerCase().includes(q)
        )
      : items;

    res.json({ items: filtered });
  } catch (e) {
    next(e);
  }
});

/**
 * PUT /api/admin/cities/:slug/label
 *
 * Creează sau actualizează eticheta canonică pentru un slug.
 * În plus, ACTUALIZEAZĂ automat Vendor.city + Vendor.citySlug
 * și ServiceProfile.city + ServiceProfile.citySlug pentru acel slug,
 * astfel încât profilurile vendorilor să folosească eticheta corectă.
 *
 * Body:
 *  { label: "Bacău" }  sau  { canonicalLabel: "Bacău" }
 */
router.put("/cities/:slug/label", async (req, res, next) => {
  try {
    const rawSlug = (req.params.slug || "").toString().trim();
    const slug = normalizeCityName(rawSlug);
    if (!slug) {
      return res.status(400).json({ error: "invalid_slug" });
    }

    const labelRaw = (
      req.body?.label ||
      req.body?.canonicalLabel ||
      ""
    )
      .toString()
      .trim();

    if (!labelRaw) {
      return res.status(400).json({ error: "invalid_label" });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1) salvăm în CityDictionary
      const dict = await tx.cityDictionary.upsert({
        where: { slug },
        create: {
          slug,
          canonicalLabel: labelRaw,
        },
        update: {
          canonicalLabel: labelRaw,
        },
      });

      // 2) actualizăm Vendor.city și citySlug pentru toți vendorii cu acest slug
      await tx.vendor.updateMany({
        where: {
          OR: [
            { citySlug: slug },
            // fallback: vendor fără citySlug, dar cu city normalizabil la slug
            // (în practică, majoritatea vor avea citySlug; restul îi poți corecta ulterior via script)
            {
              citySlug: null,
              city: { not: null },
            },
          ],
        },
        data: {
          city: labelRaw,
          citySlug: slug,
        },
      });

      // 3) actualizăm ServiceProfile.city și citySlug pentru acest slug
      await tx.serviceProfile.updateMany({
        where: {
          OR: [
            { citySlug: slug },
            {
              citySlug: null,
              city: { not: null },
            },
          ],
        },
        data: {
          city: labelRaw,
          citySlug: slug,
        },
      });

      return dict;
    });

    res.json({ ok: true, item: result });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/admin/cities/:slug/label
 * Șterge eticheta din dicționar (NU modifică Vendor/ServiceProfile).
 * Practic, la afișare, se va reveni la heuristica "alege cea mai frumoasă variantă".
 */
router.delete("/cities/:slug/label", async (req, res, next) => {
  try {
    const rawSlug = (req.params.slug || "").toString().trim();
    const slug = normalizeCityName(rawSlug);
    if (!slug) {
      return res.status(400).json({ error: "invalid_slug" });
    }

    await prisma.cityDictionary
      .delete({ where: { slug } })
      .catch(() => null);

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
