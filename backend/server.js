// backend/server.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import expressPkg from "express";
import dns from "node:dns";

// RUTE
import authRoutes from "./routes/authRoutes.js";
import sellerRoutes from "./routes/sellerRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import contractRoutes from "./routes/contractRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import visitorRoutes from "./routes/visitorRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import wishlistRoutes from "./routes/wishListRoutes.js";
import invitationsRouter, { publicRouter as invitationsPublicRouter } from "./routes/invitationsRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import sellerSettingsRouter from "./routes/sellerSettingsRoutes.js";
import contractsMeRouter from "./routes/contractsMeRoutes.js";

dotenv.config();

// Favorizează IPv4 (evită probleme pe unele rețele Windows+Atlas)
dns.setDefaultResultOrder?.("ipv4first");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname);

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (process.env.CORS_ORIGIN || "http://localhost:5173")
      .split(",")
      .map((s) => s.trim()),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

/* ===================== DEBUG ROUTE PATCH (opțional) ===================== */
if (!app._routeDebugPatched) {
  function findCallerInStack(stack) {
    const lines = String(stack).split("\n");
    const hit =
      lines.find((l) => l.includes("\\backend\\")) ||
      lines.find((l) => l.includes("/backend/")) ||
      lines[1] ||
      lines[0];
    return hit;
  }
  function wrapReg(obj, methodName) {
    const orig = obj[methodName].bind(obj);
    obj[methodName] = (...args) => {
      const first = args[0];
      if (typeof first === "string") {
        const s = first;
        const looksLikeWinPath = /^[A-Za-z]:[\\/]/.test(s);
        const looksLikeURL = /^https?:\/\//i.test(s);
        const hasBadColon = /\/:(?![A-Za-z_])/.test(s);
        if (looksLikeWinPath || looksLikeURL || hasBadColon) {
          const err = new Error(`Route path invalid pentru ${methodName}: "${s}"`);
          const caller = findCallerInStack(err.stack);
          console.error(`[BAD ${methodName}]`, s);
          console.error(" ↳ definit aici:", caller);
          throw err;
        }
      }
      return orig(...args);
    };
  }
  ["use", "get", "post", "put", "patch", "delete", "options", "all"].forEach((m) => wrapReg(app, m));
  const RouterProto = expressPkg.Router && expressPkg.Router().constructor.prototype;
  if (RouterProto) {
    ["use", "get", "post", "put", "patch", "delete", "options", "all"].forEach((m) => {
      if (typeof RouterProto[m] === "function") wrapReg(RouterProto, m);
    });
  }
  app._routeDebugPatched = true;
}
/* =================== /DEBUG ROUTE PATCH ===================== */

/* =================== MIDDLEWARE DE BAZĂ =================== */
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ Static: <repo>/backend/uploads și <repo>/backend/storage
app.use("/uploads", express.static(path.join(BACKEND_ROOT, "uploads")));

// /storage fără cache – să nu rămână în browser PDF-uri vechi
app.use(
  "/storage",
  express.static(path.join(BACKEND_ROOT, "storage"), {
    etag: false,
    lastModified: false,
    cacheControl: false,
    maxAge: 0,
  }),
);

/* ======================== RUTE API ======================== */
app.use("/api/reviews", reviewRoutes);
app.use("/api/visitors", visitorRoutes);
app.use("/api/users", authRoutes);
app.use("/api/seller", sellerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/contracts", contractRoutes); // răspunde cu url-uri /storage/...
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/invitations", invitationsRouter);
app.use("/api/public/invitations", invitationsPublicRouter);
app.use("/api/search", searchRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/seller", sellerSettingsRouter);
app.use("/api/contracts", contractsMeRouter);


// 404 JSON pentru API
app.use((req, res) => res.status(404).json({ msg: "Not Found" }));

// Handler de erori
app.use((err, req, res, next) => {
  console.error(err);
  if (err?.name === "CastError") {
    return res.status(400).json({ msg: `ID invalid pentru ${err?.path || "resursă"}.` });
  }
  res.status(500).json({ msg: "Eroare internă." });
});


/* ===================== SOCKET.IO ===================== */
io.on("connection", (socket) => {
  console.log(`📡 Client conectat: ${socket.id}`);
  socket.on("message", (msg) => {
    console.log("💬 Mesaj primit:", msg);
    io.emit("message", msg);
  });
  socket.on("disconnect", () => {
    console.log(`❌ Client deconectat: ${socket.id}`);
  });
});

/* ===================== DIRECTOARE NECESARE ===================== */
const STORAGE_CONTRACTS_DIR = path.join(BACKEND_ROOT, "storage", "contracts");
if (!fs.existsSync(STORAGE_CONTRACTS_DIR)) {
  fs.mkdirSync(STORAGE_CONTRACTS_DIR, { recursive: true });
  console.log(`📂 Folder creat: ${STORAGE_CONTRACTS_DIR}`);
}

const UPLOADS_DIR = path.join(BACKEND_ROOT, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/* ===================== CONNECT & START ===================== */
const { MONGODB_URI, MONGODB_URI_NOSRV, MONGO_URI, PORT = 5000 } = process.env;
const primaryUri = (MONGODB_URI || MONGO_URI || "").trim();

if (!primaryUri) {
  console.error("❌ Lipsă variabilă de mediu: MONGODB_URI (sau MONGO_URI)");
  process.exit(1);
}

mongoose.set("strictQuery", true);

// log „safe” al țintei (convertim schema ca să nu stricăm URL())
function logTarget(uri) {
  try {
    const u = new URL(uri.replace(/^mongodb\+srv/, "https").replace(/^mongodb/, "http"));
    console.log(`⛓️  Mongo target: ${u.protocol}//${u.hostname}${u.pathname || ""}`);
  } catch {
    // ignore
  }
}

async function connectMongo(uri, label = "primary") {
  logTarget(uri);
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 15000,
      // opționale:
      // maxPoolSize: 10,
      // minPoolSize: 0,
      // heartbeatFrequencyMS: 10000,
    });
    console.log(`✅ Conectat la MongoDB (${label})`);
    return true;
  } catch (err) {
    console.error(`❌ Eroare la conectarea MongoDB (${label}):`, err);
    return false;
  }
}

let connected = await connectMongo(primaryUri, primaryUri.startsWith("mongodb+srv://") ? "SRV" : "direct");

// fallback: dacă SRV eșuează și ai non-SRV în .env
if (!connected && MONGODB_URI_NOSRV) {
  console.warn("⚠️ Conexiunea primară a eșuat. Încerc fallback MONGODB_URI_NOSRV …");
  connected = await connectMongo(MONGODB_URI_NOSRV, "fallback non-SRV");
}

if (!connected) {
  console.error("❌ Nu m-am putut conecta la Mongo. Verifică .env, whitelist Atlas și rețeaua (port 27017).");
  process.exit(1);
}

httpServer.listen(PORT, () => console.log(`🚀 Serverul rulează pe portul ${PORT}`));

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  process.exit(0);
});