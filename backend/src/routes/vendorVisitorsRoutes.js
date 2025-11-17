// ./src/routes/vendorVisitorsRoutes.js
import { Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { authRequired, requireRole } from "../api/auth.js"; // ajustează calea dacă diferă

const prisma = new PrismaClient();
const router = Router();

/* ------------ middleware: atașează vendorId pe baza user-ului logat ------------ */
async function attachVendor(req, res, next) {
  try {
    // authRequired ți-a pus deja req.user.sub (id user din JWT)
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "unauthenticated" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, vendor: { select: { id: true } } },
    });

    if (!user || user.role !== "VENDOR") {
      return res.status(403).json({ error: "forbidden" });
    }
    if (!user.vendor?.id) {
      return res.status(403).json({ error: "no_vendor" });
    }

    req.vendorId = user.vendor.id;
    next();
  } catch (e) {
    console.error("attachVendor error", e);
    return res.status(500).json({ error: "internal_error" });
  }
}

/* ------------ Router protejat ------------ */
// întâi JWT, apoi rol, apoi vendor
router.use(authRequired, requireRole("VENDOR"), attachVendor);

/* helper range */
const dayKey = (d) => d.toISOString().slice(0, 10);

function parseRange(req) {
  const schema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });
  const q = schema.safeParse(req.query);
  const today = new Date();
  const toDate =
    q.success && q.data.to
      ? new Date(`${q.data.to}T23:59:59.999Z`)
      : new Date(today.toISOString().slice(0, 10) + "T23:59:59.999Z");
  const fromDate =
    q.success && q.data.from
      ? new Date(`${q.data.from}T00:00:00.000Z`)
      : new Date(new Date(toDate).setDate(toDate.getDate() - 29)); // 30 zile
  return { from: fromDate, to: toDate };
}

/** GET /api/vendors/me/visitors/series */
router.get("/series", async (req, res) => {
  const vendorId = req.vendorId;
  const { from, to } = parseRange(req);

  const rows = await prisma.event.findMany({
    where: { vendorId, createdAt: { gte: from, lte: to } },
    select: { type: true, createdAt: true, sessionId: true },
  });

  const buckets = new Map();
  for (const r of rows) {
    const k = dayKey(r.createdAt);
    if (!buckets.has(k))
      buckets.set(k, { date: k, views: 0, cta: 0, messages: 0, sessions: new Set() });
    const b = buckets.get(k);
    if (r.type === "PAGEVIEW") {
      b.views += 1;
      if (r.sessionId) b.sessions.add(r.sessionId);
    }
    if (r.type === "CTA_CLICK") b.cta += 1;
    if (r.type === "MESSAGE") b.messages += 1;
  }

  const out = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const k = dayKey(cursor);
    const b = buckets.get(k);
    out.push({
      date: k,
      visitors: b ? b.sessions.size : 0,
      views: b ? b.views : 0,
      cta: b ? b.cta : 0,
      messages: b ? b.messages : 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  res.json({ items: out });
});

/** GET /api/vendors/me/visitors/kpi */
router.get("/kpi", async (req, res) => {
  const vendorId = req.vendorId;
  const { from, to } = parseRange(req);

  const grouped = await prisma.event.groupBy({
    by: ["type"],
    where: { vendorId, createdAt: { gte: from, lte: to } },
    _count: { _all: true },
  });

  const get = (t) => grouped.find((g) => g.type === t)?._count._all || 0;

  const sessions = await prisma.event.findMany({
    where: { vendorId, createdAt: { gte: from, lte: to }, type: "PAGEVIEW" },
    select: { sessionId: true },
  });
  const visitors = new Set(sessions.map((s) => s.sessionId || "")).size;

  res.json({
    data: {
      visitors,
      views: get("PAGEVIEW"),
      cta: get("CTA_CLICK"),
      messages: get("MESSAGE"),
      convRate: get("CTA_CLICK") ? get("MESSAGE") / get("CTA_CLICK") : 0,
    },
  });
});

/** GET /api/vendors/me/visitors/top-pages */
router.get("/top-pages", async (req, res) => {
  const vendorId = req.vendorId;
  const { from, to } = parseRange(req);

  const rows = await prisma.event.groupBy({
    by: ["pageUrl"],
    where: {
      vendorId,
      createdAt: { gte: from, lte: to },
      type: "PAGEVIEW",
      pageUrl: { not: null },
    },
    _count: { _all: true },              // ✅ agregat corect
    orderBy: { _count: { pageUrl: "desc" } }, // ✅ sortăm după count(pageUrl)
    take: 10,
  });

  const items = rows.map((r) => {
    const url = r.pageUrl || "/";
    let title = url;
    if (/^\/magazin\//.test(url)) title = "Profil magazin";
    if (/^\/produs\//.test(url)) title = "Pagină produs";
    return {
      url,
      title,
      views: r._count._all,   // ✅ numărul de vizualizări
      avgTime: 0,             // deocamdată 0 până implementăm time-on-page
    };
  });

  res.json({ items });
});


/** GET /api/vendors/me/visitors/referrers */
router.get("/referrers", async (req, res) => {
  const vendorId = req.vendorId;
  const { from, to } = parseRange(req);

  const rows = await prisma.event.findMany({
    where: { vendorId, createdAt: { gte: from, lte: to }, type: "PAGEVIEW" },
    select: { referrer: true },
  });

  const hostToSource = (h) => {
    if (!h) return "Direct";
    try {
      const u = new URL(h);
      const host = (u.hostname || "").replace(/^www\./, "");
      if (/(google\.[a-z.]+)$/.test(host)) return "Google";
      if (/(facebook\.com|fb\.com|m\.facebook\.com)$/.test(host)) return "Facebook";
      if (/(instagram\.com)$/.test(host)) return "Instagram";
      if (/(t\.co|twitter\.com|x\.com)$/.test(host)) return "Twitter/X";
      if (/(youtube\.com|youtu\.be)$/.test(host)) return "YouTube";
      return host || "Direct";
    } catch {
      return "Direct";
    }
  };

  const counter = new Map();
  for (const r of rows) {
    const src = hostToSource(r.referrer || "");
    counter.set(src, (counter.get(src) || 0) + 1);
  }

  const total = [...counter.values()].reduce((a, b) => a + b, 0) || 1;
  const items = [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, sessions]) => ({
      source,
      sessions,
      share: Math.round((sessions * 100) / total),
    }));

  res.json({ items });
});

/** GET /api/vendors/me/visitors/searches */
router.get("/searches", async (req, res) => {
  const vendorId = req.vendorId;
  const { from, to } = parseRange(req);

  const rows = await prisma.search.groupBy({
    by: ["query"],
    where: { vendorId, createdAt: { gte: from, lte: to } },
    _sum: { hits: true },
    orderBy: { _sum: { hits: "desc" } },
    take: 10,
  });

  res.json({ items: rows.map((r) => ({ query: r.query, hits: r._sum.hits || 0 })) });
});

/** GET /api/vendors/me/visitors/cta-performance */
router.get("/cta-performance", async (req, res) => {
  const vendorId = req.vendorId;
  const { from, to } = parseRange(req);

  const clicks = await prisma.event.groupBy({
    by: ["ctaLabel"],
    where: {
      vendorId,
      createdAt: { gte: from, lte: to },
      type: "CTA_CLICK",
      ctaLabel: { not: null },
    },
    _count: { _all: true },
  });

  const conv = await prisma.event.groupBy({
    by: ["ctaLabel"],
    where: {
      vendorId,
      createdAt: { gte: from, lte: to },
      type: "MESSAGE",
      ctaLabel: { not: null },
    },
    _count: { _all: true },
  });

  const convMap = new Map(conv.map((r) => [r.ctaLabel || "", r._count._all]));
  const items = clicks
    .map((r) => ({
      cta: r.ctaLabel || "—",
      clicks: r._count._all,
      conv: convMap.get(r.ctaLabel || "") || 0,
    }))
    .sort((a, b) => b.clicks - a.clicks);

  res.json({ items });
});

/** GET /api/vendors/me/visitors/realtime */
router.get("/realtime", async (req, res) => {
  const vendorId = req.vendorId;
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await prisma.event.findMany({
    where: { vendorId, createdAt: { gte: since }, type: "PAGEVIEW" },
    select: { sessionId: true },
  });
  res.json({ active: new Set(rows.map((r) => r.sessionId || "")).size });
});

/** GET /api/vendors/me/visitors/meta – info minimă pentru analytics */
router.get("/meta", async (req, res) => {
  const vendorId = req.user.vendorId;

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { createdAt: true },
  });

  res.json({
    createdAt: vendor?.createdAt || null,
  });
});

export default router;
