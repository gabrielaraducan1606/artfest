// src/routes/shareRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();
const APP_URL = process.env.APP_URL || "https://artfest.ro";

function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]))}

router.get("/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").trim().toLowerCase();
  const profile = await prisma.serviceProfile.findUnique({
    where: { slug },
    include: { service: { include: { vendor: true, type: true } } },
  });
  if (!profile || profile?.service?.type?.code !== "products") {
    return res.status(404).send("Not found");
  }
  const shopName = profile.displayName || profile.service?.vendor?.displayName || "Magazin";
  const about = profile.tagline || profile.about || "";
  const description = about ? (about.length>160 ? about.slice(0,157)+"…" : about) : "Descoperă produse unicat pe Artfest.";
  const image = profile.coverUrl || profile.logoUrl || `${APP_URL}/img/share-fallback.jpg`;
  const publicUrl = `${APP_URL}/magazin/${slug}`;

  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600, stale-while-revalidate=300");
  res.type("html").send(`<!doctype html>
<html lang="ro"><head>
<meta charset="utf-8">
<title>${esc(shopName)} • Artfest</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${publicUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Artfest">
<meta property="og:title" content="${esc(shopName)} • Artfest">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${publicUrl}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(shopName)} • Artfest">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${image}">
<meta http-equiv="refresh" content="0; url=${publicUrl}">
<style>body{font-family:system-ui;padding:24px}</style>
</head><body>
Se încarcă… Dacă nu ești redirecționat, <a href="${publicUrl}">apasă aici</a>.
</body></html>`);
});

export default router;
