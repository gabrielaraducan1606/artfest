// backend/routes/sellerSettings.js
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import Seller from "../models/Seller.js";
import ensureAuth from "../middleware/ensureAuth.js";

const router = Router();

// === storage local pentru imagini (logo & cover) ===
const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads", "sellers");
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safe = String(req.user?._id || "user").slice(-8);
    const name = file.fieldname === "coverImage" ? "cover" : "profile";
    cb(null, `${safe}-${name}-${Date.now()}${ext || ".png"}`);
  },
});
const upload = multer({ storage });

// helper: cale absolută -> url public (expus prin /uploads)
const filePathToUrl = (absPath) => {
  const rel = path.relative(path.join(process.cwd(), "storage"), absPath).replace(/\\/g, "/");
  return `/storage/${rel}`;
};

// GET /seller/settings
router.get("/settings", ensureAuth, async (req, res, next) => {
  try {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(404).json({ msg: "Seller inexistent." });

    return res.json({
      ...seller.toObject(),
      // compat cu UI-ul tău
      profileImageUrl: seller.profileImageUrl || "",
      coverImageUrl: seller.coverImageUrl || "",
    });
  } catch (e) { next(e); }
});

// PATCH /seller/settings  (multipart/form-data)
router.patch(
  "/settings",
  ensureAuth,
  upload.fields([{ name: "profileImage", maxCount: 1 }, { name: "coverImage", maxCount: 1 }]),
  async (req, res, next) => {
    try {
      const seller = await Seller.findOne({ userId: req.user._id });
      if (!seller) return res.status(404).json({ msg: "Seller inexistent." });

      // body poate avea stringuri/JSON pentru arrays
      const body = { ...req.body };

      // parsează JSON pentru array-uri (ex: tags)
      if (typeof body.tags === "string") {
        try { body.tags = JSON.parse(body.tags); } catch { body.tags = []; }
      }

      // câmpuri permise (whitelist simplu)
      const allowed = [
        "shopName","shortDescription","brandStory","about","tags",
        "city","country","address","publicEmail","phone","publicPhone",
        "website","entityType","companyName","cui","registrationNumber","regCom",
        "bank","iban","emailFinance","deliveryNotes","returnNotes","category"
      ];
      for (const k of allowed) {
        if (body[k] !== undefined) {
          // sincronizăm brandStory <-> about dacă a venit "about"
          if (k === "about") {
            seller.brandStory = String(body.about || "");
            continue;
          }
          seller[k] = body[k];
        }
      }

      // fișiere upload
      const prof = req.files?.profileImage?.[0];
      const cover = req.files?.coverImage?.[0];
      if (prof?.path) seller.profileImageUrl = filePathToUrl(prof.path);
      if (cover?.path) seller.coverImageUrl = filePathToUrl(cover.path);

      // marcăm dacă s-au atins câmpuri ce apar în contract
      const contractRelevant = [
        "shopName","companyName","entityType","cui","regCom","registrationNumber",
        "address","city","country","bank","iban","representativeName","emailFinance","phone"
      ].some((k) => body[k] !== undefined || (k === "brandStory" && body.about !== undefined));

      await seller.save();

      return res.json({
        seller,
        contractRelevant,
      });
    } catch (e) { next(e); }
  }
);

// PATCH /seller/password
router.patch("/password", ensureAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ msg: "Lipsește parola curentă sau nouă." });
    }

    // NOTE: aici probabil ai un model User separat
    // Exemplu generic:
    const { default: User } = await import("../models/user.js");
    const user = await User.findById(req.user._id).select("+passwordHash");
    if (!user) return res.status(404).json({ msg: "Utilizator inexistent." });

    const bcrypt = (await import("bcryptjs")).default;
    const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
    if (!ok) return res.status(400).json({ msg: "Parola curentă este greșită." });

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await user.save();
    return res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
