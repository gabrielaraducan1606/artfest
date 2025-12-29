import express from "express";

const router = express.Router();

// GET /api/public/ads?placement=hero_top
router.get("/ads", async (req, res) => {
  const placement = String(req.query.placement || "hero_top");

  // ✅ nu cache-ui lista de ads
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");

  // ⚠️ exemplu: IMPORTANT să schimbi updatedAt când schimbi imaginea
  // Dacă imaginea e aceeași cale, v trebuie să fie diferit.
  const items = [
    {
      id: "hero_top_1",
      title: "Promo ArtFest",
      image: {
        desktop: "https://artfest.ro/banners/hero-desktop.jpg",
        mobile: "https://artfest.ro/banners/hero-mobile.jpg",
      },
      ctaUrl: "https://artfest.ro",
      ctaText: "Vezi →",
      weight: 1,
      startAt: null,
      endAt: null,

      // ✅ AICI e “secretul”: schimbă valoarea asta când schimbi fișierul
      // Ideal: vine din DB (updatedAt real)
      updatedAt: "2025-12-27T10:00:00.000Z",
    },
  ];

  return res.json({ placement, items });
});

// tracking (public)
router.post("/ads/:id/impression", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.sendStatus(204);
});

router.post("/ads/:id/click", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.sendStatus(204);
});

export default router;
