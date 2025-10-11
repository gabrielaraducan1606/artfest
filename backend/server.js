// server.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";

// rutele tale existente
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

/* ---------- Securitate & performanță ---------- */

// face app-ul accesibil în spatele proxy-ului Render/NGINX
app.set("trust proxy", 1);

// Protecții HTTP de bază
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // lasă imaginile publice
  })
);

// (opțional) CSP strict – relaxează dacă ai scripturi externe
// app.use(
//   helmet.contentSecurityPolicy({
//     useDefaults: true,
//     directives: {
//       "script-src": ["'self'"],
//       "img-src": ["'self'", "data:", "https:"],
//       "connect-src": ["'self'"].concat((process.env.CORS_ORIGIN || "").split(",").map(s => s.trim())),
//     },
//   })
// );

// CORS strict – mai multe origini separate prin virgulă în CORS_ORIGIN
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // permite curl/healthchecks
      return allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// limitare request-uri (anti-abuz/brute force)
app.use(
  "/api/",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600, // ajustează la nevoie
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// compresie răspuns
app.use(compression());

// parsere – limite mărite (uploadul de imagini folosește Multer, deci nu intră pe json/urlencoded)
app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* ---------- Healthchecks ---------- */
app.get("/healthz", (_req, res) => res.send("ok"));
app.get("/api/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

/* ---------- Rute API existente ---------- */
app.get("/api/legal", getLegalMeta);
app.get("/legal/:type.html", getLegalHtml);

app.use("/api", vendorLegalRoutes);
app.use("/api", checkoutRoutes);
app.use("/api", samedayRoutes); // TODO: de scos dacă e doar testing

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

// redirect scurt către pagina publică a magazinului
app.get("/@:slug", (req, res) => res.redirect(301, `/magazin/${encodeURIComponent(req.params.slug)}`));

/* ---------- Handler global de erori ---------- */
app.use((err, _req, res, _next) => {
  console.error("UNCAUGHT:", err);
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "payload_too_large", message: "Body prea mare (max 10MB)." });
  }
  res.status(500).json({ error: "server_error" });
});

/* ---------- Start & shutdown grațios ---------- */
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`API up on port ${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
