import express from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import dotenv from "dotenv";
import crypto from "crypto";

// 👇 middleware-ul "oficial" de auth din proiect
import { authRequired } from "./src/api/auth.js";

// 👇 prisma (ajustează dacă ai altă cale)
import { prisma } from "./src/db.js";

// Încarcă .env DOAR în development (pe Render/production nu călcăm env-urile)
if (process.env.NODE_ENV !== "production") {
  dotenv.config(); // fără override!
}

/* ---------------- IMPORT RUTE EXISTENTE ---------------- */

import { getLegalMeta, getLegalHtml } from "./src/api/legal.js";

import authRouter from "./src/routes/authRoutes.js";
import vendorsRouter from "./src/routes/vendorRoutes.js";
import serviceTypesRouter from "./src/routes/serviceTypesRoutes.js";
import uploadRoutes from "./src/routes/uploadRoutes.js";
import billingRoutes from "./src/routes/billingRoutes.js";
import subscriptionRoutes from "./src/routes/subscriptionRoutes.js";
import publicStoreRoutes from "./src/routes/publicStoreRoutes.js";
import vendorProductRoutes from "./src/routes/vendorProductRoutes.js";
import publicProductRoutes from "./src/routes/publicProductRoutes.js";

import favoritesRoutes, { mountWishlistCountAlias } from "./src/routes/favoritesRoutes.js";

import cartRoutes from "./src/routes/cartRoutes.js";
import productCommentsRouter from "./src/routes/commentProductRoutes.js";
import vendorVisitorsRoutes from "./src/routes/vendorVisitorsRoutes.js";
import vendorVisitorsPublicRoutes from "./src/routes/vendorVisitorsPublicRoutes.js";
import checkoutRoutes from "./src/routes/chekoutRoutes.js";
import samedayRoutes from "./src/routes/samedayRoutes.js";
import samedayWebhookRoutes from "./src/routes/samedayWebhookRoutes.js";
import notificationsRoutes from "./src/routes/vendorNotificationsRoutes.js";
import geoRoutes from "./src/routes/geoRoutes.js";
import shareRoutes from "./src/routes/shareRoutes.js";
import agreementsRoutes from "./src/routes/agreementsRoutes.js";
import vendorStoreRouter from "./src/routes/vendorStoreRoutes.js";
import VendorSupportRoutes from "./src/routes/vendorSupportRoutes.js";
import vendorOrdersRoutes from "./src/routes/vendorOrdersRoutes.js";
import vendorMessagesRoutes from "./src/routes/vendorMessageRoutes.js";
import publicContactRoutes from "./src/routes/publicMessagesRoutes.js";

import changePassword from "./src/routes/changePasswordRoutes.js";
import accountDeleteRoutes from "./src/routes/accountDeleteRoutes.js";
import userOrdersRoutes from "./src/routes/userOrdersRoutes.js";

import PublicSupportRoutes from "./src/routes/publicSupportRoutes.js";
import UserSupportRoutes from "./src/routes/userSupportRoutes.js";
import checkoutNetopiaRoutes from "./src/routes/checkoutNetopiaRoutes.js";

import adminRoutes from "./src/routes/adminRoutes.js";
import adminOrdersRoutes from "./src/routes/adminOrdersRoutes.js";
import adminMarketingRoutes from "./src/routes/adminMarketingRoutes.js";
import adminMaintenanceRoutes from "./src/routes/adminMaintenanceRoutes.js";

import storeFollowRoutes from "./src/routes/storeFollowRoutes.js";
import marketingRoutes from "./src/routes/userMarketingRoutes.js";

import accountSettingsRouter from "./src/routes/userSettingsRoutes.js";
import legalRoutes from "./src/routes/legalRoutes.js";
import AdminSupportRoutes from "./src/routes/adminSupportRoutes.js";
import userMessagesRoutes from "./src/routes/userMessagesRoutes.js";
import vendorInvoicesRouter from "./src/routes/vendorInvoices.js";

import vendorInboxThreadsRouter from "./src/routes/vendorInboxThreadsRoutes.js";
import userConsentsRoutes from "./src/routes/adminUserConsentPolicies.js";
import vendorPoliciesRoutes from "./src/routes/vendorPoliciesRoutes.js";
import adminVendorAcceptancesRoutes from "./src/routes/adminVendorPolicies.js";
import productReviewsRouter from "./src/routes/reviewsProductRoutes.js";
import { GuestSupportRoutes } from "./src/routes/guestSupportRoutes.js";

import userRoutes from "./src/routes/userRoutes.js";
import userNotificationsRoutes from "./src/routes/userNotificationsRoutes.js";
import storeReviewsRouter from "./src/routes/reviewsStoreRoutes.js";

import adminCitiesRouter from "./src/routes/adminCitiesRoutes.js";
import userInvoicesRouter from "./src/routes/userInvoicesRoutes.js";
import accountRoutes from "./src/routes/accountRoutes.js";
import vendorSettingsRoutes from "./src/routes/vendorSettingRoutes.js";
import digitalWaitlistRoutes from "./src/routes/digitalWaitListRoutes.js";
import adminDigitalWaitlistRoutes from "./src/routes/adminDigitalWaitListRoutes.js";
import publicAdsRoutes from "./src/routes/publicAdsRoutes.js";
import adminEmailLogsRoutes from "./src/routes/adminEmailLogRoutes.js";
import adminIncidentsRoutes from "./src/routes/adminIncidentsRoutes.js";
import unsubscribeRouter from "./src/routes/unsubscribeRoutes.js";

// 🔔 JOB: follow-up notifications
import { runFollowUpNotificationJob } from "./src/jobs/followupChecker.js";

/* ---------------- APP + CORS ---------------- */

const app = express();
const PORT = process.env.PORT || 5000;

// CORS_ORIGIN în env (Render): ex.
// CORS_ORIGIN=http://localhost:5173,https://artfest-marketplace.netlify.app
const rawOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!rawOrigins.length) {
  console.error("❌ CORS_ORIGIN is missing or empty in env!");
  process.exit(1);
}

const allowedOrigins = rawOrigins.map((s) => s.replace(/\/$/, "").toLowerCase());

// (opțional) permite preview-urile Netlify pentru proiectul tău
const allowNetlifyPreviewsFor = "artfest-marketplace";

const isAllowed = (origin) => {
  if (!origin) return true; // healthchecks, curl, curl local etc
  const o = String(origin).replace(/\/$/, "").toLowerCase();
  if (allowedOrigins.includes(o)) return true;
  if (
    allowNetlifyPreviewsFor &&
    o.endsWith(".netlify.app") &&
    o.includes(allowNetlifyPreviewsFor)
  ) {
    return true;
  }
  return false;
};

app.set("trust proxy", 1);

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowed(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    const reqHeaders = req.headers["access-control-request-headers"];
    if (reqHeaders) res.header("Access-Control-Allow-Headers", reqHeaders);
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  }

  // ✅ ca să NU logăm cors_blocked ca incident (zgomot)
  res.locals.__skipIncidentLog = true;

  console.warn("CORS blocked:", origin, "allowed:", allowedOrigins);
  return res.status(403).json({ error: "cors_blocked" });
});

/* ---------------- SEC & COMMON MIDDLEWARE ---------------- */

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());
app.use(cookieParser());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* ---------------- RATE LIMIT (IMPORTANT: înainte de rutele /api) ---------------- */

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* =========================================================
   HELPERS: incident logging + masking
========================================================= */

const SENSITIVE_KEYS = new Set([
  "password",
  "pass",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "code",
  "otp",
  "secret",
  "email",
  "phone",
]);

function maskQuery(query) {
  if (!query || typeof query !== "object") return query;
  const out = {};
  for (const [k, v] of Object.entries(query)) {
    if (SENSITIVE_KEYS.has(String(k).toLowerCase())) out[k] = "***";
    else out[k] = v;
  }
  return out;
}

function truncate(str, max = 20000) {
  if (!str) return str;
  const s = String(str);
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...truncated(${s.length - max})`;
}

async function logRouteIncidentSafe(data) {
  try {
    const clean = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (v !== undefined) clean[k] = v;
    }

    if (clean.message) clean.message = truncate(clean.message, 4000);
    if (clean.stack) clean.stack = truncate(clean.stack, 20000);
    if (clean.userAgent) clean.userAgent = truncate(clean.userAgent, 400);

    await prisma.routeIncident.create({ data: clean });
  } catch (e) {
    console.error("FAILED_TO_LOG_ROUTE_INCIDENT:", e?.message || e);
  }
}

/* =========================================================
   INCIDENT LOGGING
   - persistă 5xx + 403 + 404(/api, sampling) în DB
========================================================= */

app.use((req, res, next) => {
  req.__startAt = Date.now();
  req.__reqId = crypto.randomUUID?.() || String(Date.now());

  res.on("finish", () => {
    if (res.locals.__skipIncidentLog) return;

    const durationMs = Date.now() - (req.__startAt || Date.now());
    const status = res.statusCode || 0;

    const path = (req.originalUrl || req.url || "").split("?")[0];

    const is5xx = status >= 500;
    const is403 = status === 403;
    const is404 = status === 404;

    // 404: doar pe /api și cu sampling
    const logApi404Only = true;
    const sampleRate404 = Number(process.env.INCIDENT_SAMPLE_404 || "0.2");
    const isApiPath = path.startsWith("/api");

    const shouldLog404 =
      is404 &&
      (!logApi404Only || isApiPath) &&
      Math.random() < Math.max(0, Math.min(1, sampleRate404));

    const shouldLog = is5xx || is403 || shouldLog404;
    if (!shouldLog) return;

    // dacă error handler-ul a logat deja 5xx, nu mai logăm încă o dată
    if (is5xx && res.locals.__incidentLogged) return;

    logRouteIncidentSafe({
      reqId: req.__reqId,
      method: req.method,
      path,
      query: req.query && Object.keys(req.query).length ? maskQuery(req.query) : undefined,
      statusCode: status,
      durationMs,
      message: null,
      stack: null,
      code: null,
      ip: req.ip,
      userId: req.user?.id || null,
      userAgent: req.headers["user-agent"] || null,
    });
  });

  next();
});

/* =========================================================
   ADMIN MONITOR ENDPOINTS (incidente)
========================================================= */

function requireAdminMonitorToken(req, res, next) {
  const expected = process.env.ADMIN_MONITOR_TOKEN;

  if (!expected || !String(expected).trim()) {
    return res.status(500).json({ error: "ADMIN_MONITOR_TOKEN_NOT_CONFIGURED" });
  }

  const auth = req.headers.authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  const bearer = m?.[1];

  const legacy = req.headers["x-admin-token"];
  const token = bearer || legacy;

  if (!token || token !== expected) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  next();
}

// GET /api/admin/monitor/incidents?ack=0&status=500&limit=50
app.get("/api/admin/monitor/incidents", requireAdminMonitorToken, async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const status = parseInt(req.query.status || "", 10);
    const ack = String(req.query.ack || "").trim(); // "0" / "1" / ""

    const where = {};
    if (!Number.isNaN(status)) where.statusCode = status;
    if (ack === "0") where.acknowledgedAt = null;
    if (ack === "1") where.acknowledgedAt = { not: null };

    const items = await prisma.routeIncident.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json({ items });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/monitor/incidents/:id/ack
app.post("/api/admin/monitor/incidents/:id/ack", requireAdminMonitorToken, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const by = (req.body?.by || "admin").toString().slice(0, 120);

    const item = await prisma.routeIncident.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedBy: by },
    });

    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
});

/* ---------------- RUTE ADMIN (existente) ---------------- */

// ✅ PUBLIC – înainte de auth
app.use("/api/public", publicAdsRoutes);

app.use(adminEmailLogsRoutes);
app.use("/api/admin/maintenance", adminMaintenanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminOrdersRoutes);
app.use("/api/admin/marketing", adminMarketingRoutes);
app.use("/api/admin/support", AdminSupportRoutes);
app.use("/api/admin", userConsentsRoutes);
app.use("/api/admin", adminVendorAcceptancesRoutes);
app.use("/api/admin", adminCitiesRouter);

app.use("/api/admin/monitor", adminIncidentsRoutes);


app.use("/api/public", digitalWaitlistRoutes);
app.use("/api/admin", adminDigitalWaitlistRoutes);

/* ---------------- RUTE GUEST ---------------- */
app.use("/api/upload", uploadRoutes);
app.use("/api/guest", GuestSupportRoutes);

/* ---------------- RUTE USER ---------------- */
app.use("/api/support", UserSupportRoutes);
app.post("/api/account/change-password", authRequired, changePassword);
app.use("/api/user/orders", userOrdersRoutes);

app.use("/api/notifications", userNotificationsRoutes);
app.use("/api/user", userRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/public", publicProductRoutes);
app.use("/api", productReviewsRouter);
app.use("/api", storeReviewsRouter);

app.use("/api/public", publicStoreRoutes);
app.use("/api", geoRoutes);
app.use("/api", userInvoicesRouter);


app.use("/api", marketingRoutes);
app.use("/api/public/support", PublicSupportRoutes);
app.use("/api/stores", storeFollowRoutes);
app.use("/api/user-inbox", userMessagesRoutes);
app.use("/api/account", accountSettingsRouter);

app.use("/api", unsubscribeRouter);

app.use("/api/vendors/me/visitors", vendorVisitorsRoutes);
app.use("/api/visitors", vendorVisitorsPublicRoutes);

app.use("/api", productCommentsRouter);

/* ---------------- ALTE RUTE ---------------- */
app.use("/api", checkoutNetopiaRoutes);

app.use(legalRoutes); // include /api/legal + /legal/:type.html

app.use("/api/inbox", vendorMessagesRoutes);
app.use("/api/admin", vendorPoliciesRoutes);

/* ---------------- HEALTH ---------------- */
app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* ---------------- RESTUL DE RUTE /api ---------------- */
app.get("/api/legal", getLegalMeta);
app.get("/legal/:type.html", getLegalHtml);

app.use("/api", checkoutRoutes);
app.use("/api", samedayRoutes);
app.use("/api", samedayWebhookRoutes);

app.use("/api/auth", authRouter);
app.use("/api/vendors", vendorsRouter);
app.use("/api/service-types", serviceTypesRouter);
app.use("/api/upload", uploadRoutes);
app.use("/api/vendors", billingRoutes);
app.use("/api", subscriptionRoutes);
app.use("/api", vendorProductRoutes);
app.use("/api/favorites", favoritesRoutes);
mountWishlistCountAlias(app);
app.use("/api", cartRoutes);
app.use("/api", notificationsRoutes);


app.use("/api", agreementsRoutes);

app.use("/api", vendorInboxThreadsRouter);
app.use("/api/vendors", vendorStoreRouter);
app.use("/api", vendorInvoicesRouter);

app.use("/api/vendor/support", VendorSupportRoutes);
app.use("/api/vendor", vendorOrdersRoutes);

app.use("/public", publicContactRoutes);
app.use("/api", vendorSettingsRoutes);

// 👇 aici folosim authRequired din ./src/api/auth.js
app.use("/api", accountDeleteRoutes);

app.use("/share", shareRoutes);

app.get("/@:slug", (req, res) =>
  res.redirect(301, `/magazin/${encodeURIComponent(req.params.slug)}`)
);

/* ---------------- 404 HANDLER ---------------- */
app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

/* ---------------- HANDLER GLOBAL DE ERORI ---------------- */
app.use(async (err, req, res, _next) => {
  try {
    console.error("UNCAUGHT:", err?.message || err);

    if (err?.message === "Not allowed by CORS") {
      res.locals.__skipIncidentLog = true;
      return res.status(403).json({ error: "cors_blocked" });
    }
    if (err?.type === "entity.too.large") {
      return res.status(413).json({
        error: "payload_too_large",
        message: "Body prea mare (max 10MB).",
      });
    }

    // log în DB (o singură dată)
    res.locals.__incidentLogged = true;

    const durationMs =
      typeof req.__startAt === "number" ? Date.now() - req.__startAt : null;

    await logRouteIncidentSafe({
      reqId: req.__reqId || null,
      method: req.method,
      path: (req.originalUrl || req.url || "").split("?")[0],
      query: req.query && Object.keys(req.query).length ? maskQuery(req.query) : undefined,
      statusCode: 500,
      durationMs,
      message: err?.message ? String(err.message) : "server_error",
      stack: err?.stack ? String(err.stack) : null,
      code: err?.code ? String(err.code) : null,
      ip: req.ip,
      userId: req.user?.id || null,
      userAgent: req.headers["user-agent"] || null,
    });

    return res.status(500).json({ error: "server_error" });
  } catch (e) {
    console.error("ERROR_IN_ERROR_HANDLER:", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ---------------- START SERVER ---------------- */

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`API up on port ${PORT}`);
  console.log("CORS allowed:", allowedOrigins);

  runFollowUpNotificationJob().catch((err) =>
    console.error("followUpNotificationJob (startup) failed:", err)
  );

  const intervalMs = 10 * 60 * 1000;
  setInterval(() => {
    runFollowUpNotificationJob().catch((err) =>
      console.error("followUpNotificationJob (interval) failed:", err)
    );
  }, intervalMs);
});

/* ---------------- ENV REQUIRED ---------------- */

const must = (name) => {
  if (!process.env[name] || !String(process.env[name]).trim()) {
    console.error(`❌ Missing required env: ${name}`);
    process.exit(1);
  }
};

must("DATABASE_URL");
must("CORS_ORIGIN");
must("JWT_SECRET");
must("ADMIN_MONITOR_TOKEN");

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
