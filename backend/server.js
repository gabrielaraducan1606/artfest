// server.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
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


// 🔄 Varianta corectă pentru routerul de image search (așa cum ți-am dat-o mai sus)
import imageSearchRouter from "./src/routes/imageSearchRoutes.js";

dotenv.config({ override: true, quiet: true });

const app = express();
const PORT = process.env.PORT || 5000;

/**
 * CORS (configurabil)
 */
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(cookieParser());

/**
 * Parsere — limite mărite (10MB)
 * (upload-ul de imagine pentru căutare folosește Multer — nu intră pe json/urlencoded)
 */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/**
 * Healthcheck
 */
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

/**
 * Rute API
 */
app.get("/api/legal", getLegalMeta);
app.get("/legal/:type.html", getLegalHtml); // /legal/tos.html, /legal/privacy.html
app.use("/api", vendorLegalRoutes);
app.use("/api", checkoutRoutes);

app.use("/api", samedayRoutes);//de sters!!!!!!!!!!!!!(fisier de inlocuit cheile)

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
mountWishlistCountAlias(app); // păstrează /api/wishlist/count pentru Navbar-ul actual

app.use("/api", cartRoutes);
app.use("/api", reviewsRoutes);
app.use("/api", commentsRoutes);
app.use("/api/vendors/me/visitors", vendorVisitorsRoutes);

// 🚀 Ruta de căutare după imagine (expune /api/search/image în interior)
app.use("/api", imageSearchRouter);

/**
 * Redirect scurt către pagina publică a magazinului
 */
app.get("/@:slug", (req, res) => {
  const { slug } = req.params;
  return res.redirect(301, `/magazin/${encodeURIComponent(slug)}`);
});

/**
 * Handler global de erori
 */
app.use((err, _req, res, _next) => {
  console.error("UNCAUGHT:", err);
  if (err?.type === "entity.too.large") {
    return res
      .status(413)
      .json({ error: "payload_too_large", message: "Body prea mare (max 10MB)." });
  }
  res.status(500).json({ error: "server_error" });
});

/**
 * Start server
 */
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));

