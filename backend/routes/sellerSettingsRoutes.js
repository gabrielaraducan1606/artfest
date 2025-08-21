// backend/routes/sellerSettingsRoutes.js
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import ensureAuth from "../middleware/ensureAuth.js";
import Seller from "../models/Seller.js";

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const UPLOAD_DIR = path.join(ROOT, "uploads", "sellers");

// asigură-te că există folderul uploads/sellers
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ——— Multer (upload imagini) ———
const sanitize = (s) => String(s || "").replace(/[^\w.-]+/g, "-");
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uid = req.user?._id?.toString?.() || "anon";
    const base = `${uid}-${Date.now()}-${sanitize(file.originalname)}`;
    cb(null, base);
  },
});
const upload = multer({ storage });

// ——— Helpers ———
function toBool(v) {
  if (typeof v === "boolean") return v;
  const s = String(v || "").toLowerCase();
  return s === "true" || s === "1" || s === "on" || s === "yes";
}
function toArrayMaybe(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    // CSV fallback
    return v.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

const CONTRACT_FIELDS = new Set([
  "shopName", "companyName", "entityType", "cui", "regCom", "registrationNumber",
  "address", "city", "country", "bank", "iban", "emailFinance", "representativeName", "category"
]);
function didTouchContractFields(updateObj = {}) {
  return Object.keys(updateObj).some((k) => CONTRACT_FIELDS.has(k));
}

async function findSellerByUser(userId) {
  // în majoritatea proiectelor, Seller are câmpul userId
  let seller = await Seller.findOne({ userId });
  if (!seller) {
    // fallback: poate id-ul e chiar Seller._id
    seller = await Seller.findById(userId);
  }
  return seller;
}

// ——— GET /seller/settings ———
router.get("/settings", ensureAuth, async (req, res) => {
  const seller = await findSellerByUser(req.user._id);
  if (!seller) return res.status(404).json({ msg: "Seller inexistent." });
  return res.json(seller);
});

// ——— PATCH /seller/settings ———
router.patch(
  "/settings",
  ensureAuth,
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
  ]),
  async (req, res) => {
    const seller = await findSellerByUser(req.user._id);
    if (!seller) return res.status(404).json({ msg: "Seller inexistent." });

    const body = req.body || {};
    const update = {};

    // map UI -> DB
    if ("about" in body) update.brandStory = body.about;
    if ("brandStory" in body) update.brandStory = body.brandStory;

    if ("registrationNumber" in body) update.regCom = body.registrationNumber;
    if ("regCom" in body) update.regCom = body.regCom;

    // câmpuri simple permise
    [
      "shopName", "shortDescription", "companyName", "entityType",
      "cui", "address", "city", "country", "publicEmail", "emailFinance",
      "phone", "website", "representativeName", "category", "bank", "iban"
    ].forEach((k) => {
      if (k in body && body[k] !== "") update[k] = body[k];
    });

    // booleans
    if ("publicPhone" in body) update.publicPhone = toBool(body.publicPhone);

    // arrays (tags)
    if ("tags" in body) update.tags = toArrayMaybe(body.tags);

    // fișiere
    const profileFile = req.files?.profileImage?.[0] || null;
    if (profileFile) {
      update.profileImageUrl = `/uploads/sellers/${profileFile.filename}`;
    }
    const coverFile = req.files?.coverImage?.[0] || null;
    if (coverFile) {
      update.coverImageUrl = `/uploads/sellers/${coverFile.filename}`;
    }

    // bump updatedAt (important pentru contracte)
    update.updatedAt = new Date();

    const touchContract = didTouchContractFields({ ...update, registrationNumber: body.registrationNumber });

    const updated = await Seller.findByIdAndUpdate(
      seller._id,
      { $set: update },
      { new: true }
    );

    return res.json({
      seller: updated,
      contractRelevant: touchContract,
    });
  }
);

// ——— POST /seller/profile?step=2 (update bancă/IBAN folosit de anexă IBAN) ———
router.post("/profile", ensureAuth, upload.none(), async (req, res) => {
  const seller = await findSellerByUser(req.user._id);
  if (!seller) return res.status(404).json({ msg: "Seller inexistent." });

  const { step } = req.query;
  if (String(step) !== "2") {
    return res.status(400).json({ msg: "Parametrul step invalid. Folosește step=2 pentru bancă/IBAN." });
  }

  const { bank, iban } = req.body || {};
  if (!bank || !iban) {
    return res.status(400).json({ msg: "Completează banca și IBAN." });
  }

  seller.bank = bank;
  seller.iban = iban;
  seller.updatedAt = new Date(); // bump
  await seller.save();

  return res.json({ ok: true, seller });
});

export default router;
