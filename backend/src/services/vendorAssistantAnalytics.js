// backend/src/services/vendorAssistantAnalytics.js
//
// BATCH 2 (audit regression Vendor Assistant, 2026-09-06) - serviciu SUBȚIRE,
// read-only, pentru întrebările de tip "vizitatori/vizualizări/trafic" puse
// Vendor Assistant-ului de un vendor autentificat.
//
// NU duplică logica de business din vendorVisitorsRoutes.js (pagina reală
// /vendor/visitors) - reutilizează ACELEAȘI modele Prisma (Event,
// ServiceFollow) și aceleași reguli de bază (PAGEVIEW/CTA_CLICK/MESSAGE,
// grupare pe zi, sursă de trafic după hostname), dar întoarce direct un
// text de răspuns pentru chat, nu un payload pentru un dashboard.
//
// Domeniu STRICT: trafic/vizite/vizualizări de pagini/surse de trafic.
// NU acoperă comenzi, câștiguri sau stoc - acelea rămân, deliberat,
// neatinse în această etapă (vezi copilotRouter.js, ramura EXISTING_FLOW).
//
// detectVisitorAnalyticsTopic() e un heuristic simplu, pe cuvinte-cheie -
// NU e clasificatorul general (classifyCopilotMessage) și nu îl înlocuiește.
// Rolul lui e STRICT să decidă dacă o întrebare deja clasificată ca
// EXISTING_FLOW + QUERY_LIVE_DATA ține de trafic/vizite (caz în care
// întoarce date reale) sau de alt domeniu (caz în care întoarce `null`,
// iar apelantul cade mai departe pe comportamentul existent, neschimbat).

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
 * Ordinea contează: verificăm întâi "produs/pagină + vizualizări/vazute"
 * (topPages/leastPages), apoi "surse de trafic" (referrers), apoi
 * "câte vizite/vizitatori" (summary) - altfel o întrebare ca "ce produse
 * au cele mai multe vizualizări" ar putea fi confundată cu un summary
 * generic. Orice altă formulare (comenzi, câștiguri, stoc, vânzări)
 * întoarce `null` intenționat - NU e domeniul acestui serviciu.
 */
export function detectVisitorAnalyticsTopic(message) {
  const t = stripDiacritics(message);

  const mentionsProductOrPage = /produs|pagin/.test(t);
  const mentionsViewMetric = /vizualiz|vazut|populare|vizitat/.test(t);

  if (mentionsProductOrPage && mentionsViewMetric) {
    return /put[iî]n/.test(t) ? "leastPages" : "topPages";
  }

  const mentionsTrafficSource = /surs|referrer|de unde vin|trafic/.test(t);
  if (mentionsTrafficSource) return "referrers";

  const mentionsVisitCount =
    /vizit|vizualiz/.test(t) && /\bcat|numar/.test(t);
  const mentionsPeopleSeenStore =
    /oameni.*vazut|vazut.*magazin|vazut.*profil/.test(t);

  if (mentionsVisitCount || mentionsPeopleSeenStore) return "summary";

  return null;
}

/*
 * Interval de timp dintr-o formulare naturală simplă - "azi", "ieri",
 * "săptămâna asta"/"7 zile", altfel implicit ultimele 30 de zile (același
 * default ca /api/vendors/me/visitors/series și /kpi).
 */
export function resolveAnalyticsDateRange(message) {
  const t = stripDiacritics(message);
  const now = new Date();
  const endOfToday = new Date(
    now.toISOString().slice(0, 10) + "T23:59:59.999Z"
  );

  if (/\bieri\b/.test(t)) {
    const to = new Date(endOfToday);
    to.setDate(to.getDate() - 1);
    const from = new Date(to.toISOString().slice(0, 10) + "T00:00:00.000Z");
    return { from, to, label: "ieri" };
  }

  if (/\bazi\b|\bastazi\b/.test(t)) {
    const from = new Date(
      endOfToday.toISOString().slice(0, 10) + "T00:00:00.000Z"
    );
    return { from, to: endOfToday, label: "azi" };
  }

  if (/saptamana|7 zile|ultima saptamana/.test(t)) {
    const from = new Date(endOfToday);
    from.setDate(from.getDate() - 6);
    from.setUTCHours(0, 0, 0, 0);
    return { from, to: endOfToday, label: "în ultimele 7 zile" };
  }

  const from = new Date(endOfToday);
  from.setDate(from.getDate() - 29);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to: endOfToday, label: "în ultimele 30 de zile" };
}

/*
 * Confirmat în vendorVisitorsRoutes.js (GET /kpi): "vizitatori" = sesiuni
 * unice cu cel puțin un PAGEVIEW în interval. Nu recalculăm followers/
 * byService aici - răspunsul de chat cere doar totalul, nu un dashboard.
 */
export async function getVendorVisitorsSummary(vendorId, { from, to }) {
  const rows = await prisma.event.findMany({
    where: { vendorId, createdAt: { gte: from, lte: to } },
    select: { type: true, sessionId: true },
  });

  const visitorSessions = new Set();
  let views = 0;
  let cta = 0;
  let messages = 0;

  for (const r of rows) {
    if (r.type === "PAGEVIEW") {
      views += 1;
      if (r.sessionId) visitorSessions.add(r.sessionId);
    } else if (r.type === "CTA_CLICK") {
      cta += 1;
    } else if (r.type === "MESSAGE") {
      messages += 1;
    }
  }

  return { visitors: visitorSessions.size, views, cta, messages };
}

/*
 * Confirmat în vendorVisitorsRoutes.js (GET /top-pages): grupare pe
 * pageUrl exact (fiecare produs are propriul URL /produs/:id, deci
 * fiecare rând ESTE deja per-produs, nu per-categorie). Filtrăm doar
 * paginile de produs și rezolvăm titlul real din Product, ca răspunsul
 * de chat să fie util ("Produs X", nu un URL brut).
 */
export async function getVendorProductPageViews(
  vendorId,
  { from, to, limit = 5, order = "desc" }
) {
  const rows = await prisma.event.groupBy({
    by: ["pageUrl"],
    where: {
      vendorId,
      createdAt: { gte: from, lte: to },
      type: "PAGEVIEW",
      pageUrl: { startsWith: "/produs/" },
    },
    _count: { pageUrl: true },
    orderBy: { _count: { pageUrl: order === "asc" ? "asc" : "desc" } },
    take: limit,
  });

  const idFromUrl = (url) => (url || "").replace(/^\/produs\//, "").split(/[/?#]/)[0];
  const productIds = rows.map((r) => idFromUrl(r.pageUrl)).filter(Boolean);

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: true },
      })
    : [];

  const titleById = new Map(products.map((p) => [p.id, p.title]));

  return rows.map((r) => {
    const id = idFromUrl(r.pageUrl);
    return {
      productId: id,
      title: titleById.get(id) || "Produs șters/indisponibil",
      views: r._count.pageUrl || 0,
    };
  });
}

/*
 * Confirmat în vendorVisitorsRoutes.js (GET /referrers): sursă = hostname
 * din referrer, mapat pe câteva domenii cunoscute, altfel hostname brut;
 * fără referrer = "Direct".
 */
export async function getVendorTopReferrers(vendorId, { from, to, limit = 5 }) {
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

  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([source, sessions]) => ({
      source,
      sessions,
      share: Math.round((sessions * 100) / total),
    }));
}

function formatSummaryAnswer(summary, range) {
  if (!summary.visitors && !summary.views) {
    return `Nu ai avut vizite ${range.label} (0 vizitatori, 0 vizualizări de pagină).`;
  }

  return (
    `Ai avut ${summary.visitors} vizitatori ${range.label} ` +
    `(${summary.views} vizualizări de pagină, ${summary.messages} mesaje trimise de vizitatori, ` +
    `${summary.cta} click-uri pe butoane de acțiune).`
  );
}

function formatProductPagesAnswer(items, range, order) {
  if (!items.length) {
    return `Nu am înregistrat vizualizări de produse ${range.label}.`;
  }

  const heading =
    order === "asc"
      ? `Cele mai puțin vizualizate produse ${range.label}:`
      : `Cele mai vizualizate produse ${range.label}:`;

  const lines = items.map(
    (it, i) => `${i + 1}. ${it.title} - ${it.views} vizualizări`
  );

  return `${heading}\n\n${lines.join("\n")}`;
}

function formatReferrersAnswer(items, range) {
  if (!items.length) {
    return `Nu am înregistrat vizite cu sursă identificabilă ${range.label}.`;
  }

  const lines = items.map((it) => `${it.source} - ${it.share}%`);
  return `Principalele surse de trafic ${range.label}:\n\n${lines.join("\n")}`;
}

/*
 * Punct de intrare unic pentru copilotRouter.js. Întoarce `null` dacă
 * mesajul NU ține de trafic/vizite (apelantul cade pe comportamentul
 * existent, neschimbat), altfel un răspuns complet, gata de trimis.
 */
export async function answerVendorVisitorAnalyticsQuestion({ vendorId, message }) {
  const topic = detectVisitorAnalyticsTopic(message);
  if (!topic) return null;

  const range = resolveAnalyticsDateRange(message);

  if (topic === "referrers") {
    const items = await getVendorTopReferrers(vendorId, range);
    return { message: formatReferrersAnswer(items, range), topic };
  }

  if (topic === "topPages" || topic === "leastPages") {
    const items = await getVendorProductPageViews(vendorId, {
      ...range,
      order: topic === "leastPages" ? "asc" : "desc",
    });
    return { message: formatProductPagesAnswer(items, range, topic === "leastPages" ? "asc" : "desc"), topic };
  }

  const summary = await getVendorVisitorsSummary(vendorId, range);
  return { message: formatSummaryAnswer(summary, range), topic };
}
