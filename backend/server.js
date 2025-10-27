// server.js
import express from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import dotenv from "dotenv";

// Încarcă .env DOAR în development (pe Render/production nu călcăm env-urile)
if (process.env.NODE_ENV !== "production") {
  dotenv.config(); // fără override!
}

// ---- importă rutele existente din proiect ----
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
import reviewsRoutes from "./src/routes/reviewRoutes.js";
import commentsRoutes from "./src/routes/commentsRoutes.js";
import vendorVisitorsRoutes from "./src/routes/vendorVisitorsRoutes.js";
import vendorLegalRoutes from "./src/routes/vendorLegalRoutes.js";
import checkoutRoutes from "./src/routes/chekoutRoutes.js";
import samedayRoutes from "./src/routes/samedayRoutes.js";
import samedayWebhookRoutes from "./src/routes/samedayWebhookRoutes.js";
import imageSearchRouter from "./src/routes/imageSearchRoutes.js";
import notificationsRoutes from "./src/routes/notificationsRoutes.js";

const app = express();
const PORT = process.env.PORT || 5000;

/* ----------------------- C O R S  robust ----------------------- */
// CORS_ORIGIN în env (Render): ex.
// CORS_ORIGIN=https://artfest-marketplace.netlify.app,https://artfest.onrender.com
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
  if (!origin) return true; // healthchecks, curl
  const o = origin.replace(/\/$/, "").toLowerCase();
  if (allowedOrigins.includes(o)) return true;
  if (allowNetlifyPreviewsFor && o.endsWith(".netlify.app") && o.includes(allowNetlifyPreviewsFor)) {
    return true;
  }
  return false;
};

app.set("trust proxy", 1);

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
  } else {
    console.warn("CORS blocked:", origin, "allowed:", allowedOrigins);
    return res.status(403).json({ error: "cors_blocked" });
  }
});
/* -------------------------------------------------------------- */

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* Health */
app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* Rate limit pe /api */
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* Rute */
app.get("/api/legal", getLegalMeta);
app.get("/legal/:type.html", getLegalHtml);

app.use("/api", vendorLegalRoutes);
app.use("/api", checkoutRoutes);
app.use("/api", samedayRoutes);
app.use("/api", samedayWebhookRoutes);

app.use("/api/auth", authRouter);
app.use("/api/vendors", vendorsRouter);
app.use("/api/service-types", serviceTypesRouter);
app.use("/api/upload", uploadRoutes);
app.use("/api/vendors", billingRoutes);
app.use("/api", subscriptionRoutes);
app.use("/api/public", publicStoreRoutes);
app.use("/api", vendorProductRoutes);
app.use("/api/public", publicProductRoutes);
app.use("/api/favorites", favoritesRoutes);
mountWishlistCountAlias(app);
app.use("/api", cartRoutes);
app.use("/api", notificationsRoutes);
app.use("/api", reviewsRoutes);
app.use("/api", commentsRoutes);
app.use("/api/vendors/me/visitors", vendorVisitorsRoutes);
app.use("/api", imageSearchRouter);

/* -------------------- Ads stub pentru dev -------------------- */
// Listă ads (filtrate opțional după placement)
app.get("/api/ads", (req, res) => {
  const placement = String(req.query.placement || "hero_top");
  // Poți popula `items` cu date demo dacă vrei să vezi caruselul în acțiune.
  // Lăsăm gol -> frontend-ul tău folosește fallback-ul local (imageMain).
  res.json({ placement, items: [] });
});

// Tracking (no-op)
app.post("/api/ads/:id/impression", (_req, res) => res.sendStatus(204));
app.post("/api/ads/:id/click", (_req, res) => res.sendStatus(204));
/* ------------------------------------------------------------ */

/* Redirect scurt către pagina publică a magazinului */
app.get("/@:slug", (req, res) =>
  res.redirect(301, `/magazin/${encodeURIComponent(req.params.slug)}`)
);

/* Handler de erori */
app.use((err, _req, res, _next) => {
  console.error("UNCAUGHT:", err?.message || err);
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "cors_blocked" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "payload_too_large", message: "Body prea mare (max 10MB)." });
  }
  res.status(500).json({ error: "server_error" });
});

/* Start */
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`API up on port ${PORT}`);
  console.log("CORS allowed:", allowedOrigins);
});

const must = (name) => {
  if (!process.env[name] || !String(process.env[name]).trim()) {
    console.error(`❌ Missing required env: ${name}`);
    process.exit(1);
  }
};

must("DATABASE_URL");            // îl ai
must("CORS_ORIGIN");             // ex: http://localhost:5173
must("JWT_SECRET");              // IMPORTANT pentru login cookie
// must("DIRECT_URL"); // doar dacă păstrezi directUrl în prisma/schema.prisma

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
