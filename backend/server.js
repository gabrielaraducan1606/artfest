// server.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";

// ---- rutele tale existente (păstrează-le exact cum sunt în proiect) ----
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
import imageSearchRouter from "./src/routes/imageSearchRoutes.js";

dotenv.config({ override: true, quiet: true });

const app = express();
const PORT = process.env.PORT || 5000;

/* ------------------------------------------------------------------ */
/*                        CORS (din CORS_ORIGIN)                       */
/* ------------------------------------------------------------------ */
// ex. în Render:
// CORS_ORIGIN="https://artfest-marketplace.netlify.app, https://artfest.onrender.com"
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s.replace(/\/$/, "").toLowerCase()); // fără slash final, lowercase

if (!allowedOrigins.length) {
  console.error("❌ CORS_ORIGIN is missing or empty in env!");
  process.exit(1);
}

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // healthchecks, curl, Postman
    const o = origin.replace(/\/$/, "").toLowerCase();
    const ok = allowedOrigins.includes(o);
    if (!ok) console.warn("CORS blocked:", origin, "allowed:", allowedOrigins);
    return ok ? cb(null, true) : cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.set("trust proxy", 1);
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));


/* ------------------------------------------------------------------ */
/*               Securitate, compresie, parsere, cookies               */
/* ------------------------------------------------------------------ */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // imagini publice
  })
);
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* ------------------------------------------------------------------ */
/*                             Healthchecks                            */
/* ------------------------------------------------------------------ */
app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

/* ------------------------------------------------------------------ */
/*                         Limitare pe /api                            */
/* ------------------------------------------------------------------ */
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* ------------------------------------------------------------------ */
/*                                Rute                                 */
/* ------------------------------------------------------------------ */
app.get("/api/legal", getLegalMeta);
app.get("/legal/:type.html", getLegalHtml);

app.use("/api", vendorLegalRoutes);
app.use("/api", checkoutRoutes);
app.use("/api", samedayRoutes); // scoate dacă e doar pentru test

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
app.use("/api", reviewsRoutes);
app.use("/api", commentsRoutes);
app.use("/api/vendors/me/visitors", vendorVisitorsRoutes);
app.use("/api", imageSearchRouter);

// (opțional) evită 404 până implementezi ads în backend:
// app.get("/api/ads", (_req, res) => res.json([]));

/* Short redirect spre pagina publică a magazinului */
app.get("/@:slug", (req, res) =>
  res.redirect(301, `/magazin/${encodeURIComponent(req.params.slug)}`)
);

/* ------------------------------------------------------------------ */
/*                          Handler de erori                           */
/* ------------------------------------------------------------------ */
app.use((err, _req, res, _next) => {
  console.error("UNCAUGHT:", err?.message || err);
  if (err?.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "cors_blocked" });
  }
  if (err?.type === "entity.too.large") {
    return res
      .status(413)
      .json({ error: "payload_too_large", message: "Body prea mare (max 10MB)." });
  }
  res.status(500).json({ error: "server_error" });
});

/* ------------------------------------------------------------------ */
/*                         Pornire & shutdown                          */
/* ------------------------------------------------------------------ */
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`API up on port ${PORT}`);
  console.log("CORS allowed:", allowedOrigins);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
