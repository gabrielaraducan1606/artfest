
import express from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import dotenv from "dotenv";

// 👇 middleware-ul "oficial" de auth din proiect
import { authRequired } from "./src/api/auth.js";

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

import favoritesRoutes, {
  mountWishlistCountAlias,
} from "./src/routes/favoritesRoutes.js";

import cartRoutes from "./src/routes/cartRoutes.js";
import commentsRoutes from "./src/routes/commentsRoutes.js";
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
// ...
import adminCitiesRouter from "./src/routes/adminCitiesRoutes.js";
import userInvoicesRouter from "./src/routes/userInvoicesRoutes.js";
import accountRoutes from "./src/routes/accountRoutes.js";
import vendorSettingsRoutes from "./src/routes/vendorSettingRoutes.js";


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

const allowedOrigins = rawOrigins.map((s) =>
  s.replace(/\/$/, "").toLowerCase()
);

// (opțional) permite preview-urile Netlify pentru proiectul tău
const allowNetlifyPreviewsFor = "artfest-marketplace";

const isAllowed = (origin) => {
  if (!origin) return true; // healthchecks, curl, curl local etc
  const o = origin.replace(/\/$/, "").toLowerCase();
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
    res.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,PATCH,DELETE,OPTIONS"
    );
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  } else {
    console.warn("CORS blocked:", origin, "allowed:", allowedOrigins);
    return res.status(403).json({ error: "cors_blocked" });
  }
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

/* ---------------- RUTE ADMIN ---------------- */

app.use("/api/admin/maintenance", adminMaintenanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin", adminOrdersRoutes);
app.use("/api/admin/marketing", adminMarketingRoutes);
app.use("/api/admin/support", AdminSupportRoutes);
app.use("/api/admin", userConsentsRoutes);
app.use("/api/admin", adminVendorAcceptancesRoutes);
app.use("/api/admin", adminCitiesRouter);

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

// rutele de marketing user – au authRequired în interiorul routerului
app.use("/api", marketingRoutes);

app.use("/api/public/support", PublicSupportRoutes);

app.use("/api/stores", storeFollowRoutes);

app.use("/api/user-inbox", userMessagesRoutes);

app.use("/api/account", accountSettingsRouter);

/* ---------------- ALTE RUTE ---------------- */

app.use("/api", checkoutNetopiaRoutes);

app.use(legalRoutes); // include /api/legal + /legal/:type.html

app.use("/api/inbox", vendorMessagesRoutes);
app.use("/api/admin", vendorPoliciesRoutes);
/* ---------------- HEALTH ---------------- */

app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

/* ---------------- RATE LIMIT PE /api ---------------- */

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

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
app.use("/api", commentsRoutes);

app.use("/api/vendors/me/visitors", vendorVisitorsRoutes); // PROTEJAT prin auth în router
app.use("/api/visitors", vendorVisitorsPublicRoutes); // public tracking

app.use("/api", agreementsRoutes);

app.use("/api", vendorInboxThreadsRouter);
app.use("/api/vendors", vendorStoreRouter);
app.use("/api", vendorInvoicesRouter);

app.use("/api/vendor/support", VendorSupportRoutes);
app.use("/api/vendor", vendorOrdersRoutes);

app.use("/public", publicContactRoutes);

app.use("/api", vendorSettingsRoutes);
/* ---------------- CHANGE PASSWORD + ACCOUNT ROUTES ---------------- */

// 👇 aici folosim authRequired din ./src/api/auth.js
app.use("/api", accountDeleteRoutes);

/* ---------------- PARTAJARE & ADS ---------------- */

app.use("/share", shareRoutes);

app.get("/api/ads", (req, res) => {
  const placement = String(req.query.placement || "hero_top");
  res.json({ placement, items: [] });
});

app.post("/api/ads/:id/impression", (_req, res) => res.sendStatus(204));
app.post("/api/ads/:id/click", (_req, res) => res.sendStatus(204));

/* ---------------- REDIRECT MAGAZIN ---------------- */

app.get("/@:slug", (req, res) =>
  res.redirect(301, `/magazin/${encodeURIComponent(req.params.slug)}`)
);

/* ---------------- HANDLER GLOBAL DE ERORI ---------------- */

app.use((err, _req, res, _next) => {
  console.error("UNCAUGHT:", err?.message || err);
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "cors_blocked" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: "payload_too_large",
      message: "Body prea mare (max 10MB).",
    });
  }
  res.status(500).json({ error: "server_error" });
});

/* ---------------- START SERVER ---------------- */

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`API up on port ${PORT}`);
  console.log("CORS allowed:", allowedOrigins);

  // 🔔 JOB FOLLOW-UP:
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
// must("DIRECT_URL"); // doar dacă păstrezi directUrl în prisma/schema.prisma

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
