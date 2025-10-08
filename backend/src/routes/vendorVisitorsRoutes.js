import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";

const router = Router();

/** Încearcă să extragi vendorId din auth; în dev, acceptă și header-ul x-vendor-id */
function getVendorIdFromReq(req) {
  // adaptează dacă auth-ul tău atașează user-ul altfel
  const fromAuth =
    req.user?.vendor?.id || req.user?.vendorId || req.user?.idVendor || null;
  const fromHeader = req.headers["x-vendor-id"];
  return (fromAuth || fromHeader || "").toString() || null;
}

function parseRange(req) {
  const schema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });
  const q = schema.safeParse(req.query);
  const today = new Date();
  const toDate = q.success && q.data.to
    ? new Date(`${q.data.to}T23:59:59.999Z`)
    : new Date(today.toISOString().slice(0,10) + "T23:59:59.999Z");
  const fromDate = q.success && q.data.from
    ? new Date(`${q.data.from}T00:00:00.000Z`)
    : new Date(new Date(toDate).setDate(toDate.getDate() - 29)); // default 30 zile
  return { from: fromDate, to: toDate };
}

function dayKey(d) { return d.toISOString().slice(0, 10); }

/** ===== GET /series — trafic zilnic (vizitatori unici/zi, afișări, cta, mesaje) */
router.get("/series", async (req, res) => {
  const vendorId = getVendorIdFromReq(req);
  if (!vendorId) return res.status(401).json({ error: "unauthorized" });
  const { from, to } = parseRange(req);

  const rows = await prisma.event.findMany({
    where: { vendorId, createdAt: { gte: from, lte: to } },
    select: { type: true, createdAt: true, sessionId: true },
  });

  const buckets = new Map(); // date -> {views, cta, messages, sessions:Set}
  for (const r of rows) {
    const k = dayKey(r.createdAt);
    if (!buckets.has(k))
      buckets.set(k, { date: k, views: 0, cta: 0, messages: 0, sessions: new Set() });
    const b = buckets.get(k);
    if (r.type === "PAGEVIEW") { b.views += 1; if (r.sessionId) b.sessions.add(r.sessionId); }
    if (r.type === "CTA_CLICK") b.cta += 1;
    if (r.type === "MESSAGE") b.messages += 1;
  }

  // completează golurile din interval
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

/** ===== GET /kpi — totaluri pe interval */
router.get("/kpi", async (req, res) => {
  const vendorId = getVendorIdFromReq(req);
  if (!vendorId) return res.status(401).json({ error: "unauthorized" });
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

  const views = get("PAGEVIEW");
  const cta = get("CTA_CLICK");
  const messages = get("MESSAGE");
  const convRate = cta ? messages / cta : 0;

  res.json({ data: { visitors, views, cta, messages, convRate } });
});

/** ===== GET /top-pages — cele mai vizitate pagini (nu avem timeSpent, punem 0) */
router.get("/top-pages", async (req, res) => {
  const vendorId = getVendorIdFromReq(req);
  if (!vendorId) return res.status(401).json({ error: "unauthorized" });
  const { from, to } = parseRange(req);

  const rows = await prisma.event.groupBy({
    by: ["pageUrl"],
    where: { vendorId, createdAt: { gte: from, lte: to }, type: "PAGEVIEW", pageUrl: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { _all: "desc" } },
    take: 10,
  });

  const items = rows.map((r) => ({
    url: r.pageUrl,
    title: r.pageUrl, // dacă ai o tabelă de pagini poți rezolva titlul aici
    views: r._count._all,
    avgTime: 0,
  }));

  res.json({ items });
});

/** ===== GET /referrers — surse trafic + share% */
router.get("/referrers", async (req, res) => {
  const vendorId = getVendorIdFromReq(req);
  if (!vendorId) return res.status(401).json({ error: "unauthorized" });
  const { from, to } = parseRange(req);

  const rows = await prisma.event.groupBy({
    by: ["referrer"],
    where: { vendorId, createdAt: { gte: from, lte: to }, type: "PAGEVIEW" },
    _count: { _all: true },
    orderBy: { _count: { _all: "desc" } },
  });

  const total = rows.reduce((a, r) => a + r._count._all, 0) || 1;
  const items = rows.map((r) => ({
    source: r.referrer || "Direct",
    sessions: r._count._all,
    share: Math.round((r._count._all * 100) / total),
  }));

  res.json({ items });
});

/** ===== GET /searches — top căutări interne */
router.get("/searches", async (req, res) => {
  const vendorId = getVendorIdFromReq(req);
  if (!vendorId) return res.status(401).json({ error: "unauthorized" });
  const { from, to } = parseRange(req);

  const rows = await prisma.search.groupBy({
    by: ["query"],
    where: { vendorId, createdAt: { gte: from, lte: to } },
    _sum: { hits: true },
    orderBy: { _sum: { hits: "desc" } },
    take: 10,
  });

  res.json({
    items: rows.map((r) => ({ query: r.query, hits: r._sum.hits || 0 })),
  });
});

/** ===== GET /cta-performance — click-uri & mesaje pe eticheta CTA */
router.get("/cta-performance", async (req, res) => {
  const vendorId = getVendorIdFromReq(req);
  if (!vendorId) return res.status(401).json({ error: "unauthorized" });
  const { from, to } = parseRange(req);

  const clicks = await prisma.event.groupBy({
    by: ["ctaLabel"],
    where: { vendorId, createdAt: { gte: from, lte: to }, type: "CTA_CLICK" },
    _count: { _all: true },
  });
  const msgs = await prisma.event.groupBy({
    by: ["ctaLabel"],
    where: { vendorId, createdAt: { gte: from, lte: to }, type: "MESSAGE" },
    _count: { _all: true },
  });
  const msgMap = new Map(msgs.map((m) => [m.ctaLabel || "CTA", m._count._all]));
  const items = clicks.map((c) => ({
    cta: c.ctaLabel || "CTA",
    clicks: c._count._all,
    conv: msgMap.get(c.ctaLabel || "CTA") || 0,
  }));

  res.json({ items });
});

/** ===== GET /realtime — unici în ultimele 5 minute */
router.get("/realtime", async (req, res) => {
  const vendorId = getVendorIdFromReq(req);
  if (!vendorId) return res.status(401).json({ error: "unauthorized" });
  const since = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await prisma.event.findMany({
    where: { vendorId, createdAt: { gte: since }, type: "PAGEVIEW" },
    select: { sessionId: true },
  });
  const active = new Set(rows.map((r) => r.sessionId || "")).size;
  res.json({ active });
});

/** ===== POST /track — public: înregistrează un eveniment (pageview/cta/message) */
router.post("/track", async (req, res) => {
  const schema = z.object({
    vendorId: z.string().min(1),
    type: z.enum(["PAGEVIEW", "CTA_CLICK", "MESSAGE"]),
    pageUrl: z.string().optional(),
    ctaLabel: z.string().optional(),
    referrer: z.string().optional(),
    sessionId: z.string().optional(),
    userAgent: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_payload" });

  const data = parsed.data;
  await prisma.event.create({
    data: {
      vendorId: data.vendorId,
      type: data.type,
      pageUrl: data.pageUrl,
      ctaLabel: data.ctaLabel,
      referrer: data.referrer,
      sessionId: data.sessionId,
      userAgent: data.userAgent || req.headers["user-agent"]?.toString(),
    },
  });
  res.json({ ok: true });
});

/** ===== POST /search — log căutare internă (autentificat ca vendor) */
router.post("/search", async (req, res) => {
  const vendorId = getVendorIdFromReq(req);
  if (!vendorId) return res.status(401).json({ error: "unauthorized" });
  const schema = z.object({ query: z.string().min(1), hits: z.number().int().min(1).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "bad_payload" });

  await prisma.search.create({
    data: { vendorId, query: parsed.data.query, hits: parsed.data.hits || 1 },
  });
  res.json({ ok: true });
});

export default router;
