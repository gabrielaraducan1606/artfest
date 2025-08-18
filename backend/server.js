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
import invitationsRoutes from "./routes/invitationsRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname);

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: (process.env.CORS_ORIGIN || "http://localhost:5173")
      .split(",")
      .map(s => s.trim()),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  },
});

/* ===================== DEBUG ROUTE PATCH (opțional) ===================== */
if (!app._routeDebugPatched) {
  function findCallerInStack(stack) {
    const lines = String(stack).split("\n");
    const hit =
      lines.find(l => l.includes("\\backend\\")) ||
      lines.find(l => l.includes("/backend/")) ||
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
  ["use","get","post","put","patch","delete","options","all"].forEach(m => wrapReg(app, m));
  const RouterProto = expressPkg.Router && expressPkg.Router().constructor.prototype;
  if (RouterProto) {
    ["use","get","post","put","patch","delete","options","all"].forEach(m => {
      if (typeof RouterProto[m] === "function") wrapReg(RouterProto, m);
    });
  }
  app._routeDebugPatched = true;
}
/* =================== /DEBUG ROUTE PATCH ===================== */

/* =================== MIDDLEWARE DE BAZĂ =================== */
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
  : ["http://localhost:5173"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ Static: <repo>/backend/uploads și <repo>/backend/storage
app.use("/uploads", express.static(path.join(BACKEND_ROOT, "uploads")));
app.use("/storage", express.static(path.join(BACKEND_ROOT, "storage")));

/* ======================== RUTE API ======================== */
app.use("/api/reviews", reviewRoutes);
app.use("/api/visitors", visitorRoutes);
app.use("/api/users", authRoutes);
app.use("/api/seller", sellerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/contracts", contractRoutes); // <- aici răspunde cu url-uri /storage/...
app.use("/api/cart", cartRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/invitations", invitationsRoutes);
app.use("/api/search", searchRoutes);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 404 JSON pentru API
app.use((req, res) => res.status(404).json({ msg: "Not Found" }));

// Handler de erori
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ msg: "Server error" });
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
const { MONGODB_URI, MONGO_URI, PORT = 5000 } = process.env;
const mongoUri = (MONGODB_URI || MONGO_URI || "").trim();

if (!mongoUri) {
  console.error("❌ Lipsă variabilă de mediu: MONGODB_URI (sau MONGO_URI)");
  process.exit(1);
}

mongoose.set("strictQuery", true);

try {
  const u = new URL(mongoUri);
  console.log(`⛓️  Mongo target: ${u.protocol}//${u.hostname}${u.pathname || ""}`);
} catch {
  // ignorăm dacă nu e URL valid
}

mongoose
  .connect(mongoUri, { serverSelectionTimeoutMS: 15000 })
  .then(() => {
    console.log("✅ Conectat la MongoDB");
    httpServer.listen(PORT, () => console.log(`🚀 Serverul rulează pe portul ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ Eroare la conectarea MongoDB:", err);
    process.exit(1);
  });

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  process.exit(0);
});
