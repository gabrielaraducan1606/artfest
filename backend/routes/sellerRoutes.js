import express from "express";
import multer from "multer";
import auth from "../middleware/auth.js";
import User from "../models/user.js";
import Seller from "../models/seller.js";
import { uploadToStorage } from "../utils/storage.js";

const router = express.Router();

/* ================== Upload: in-memory + persist ================== */
const upload = multer({ storage: multer.memoryStorage() });

async function persistUploads(req, _res, next) {
  try {
    if (req.files?.profileImage?.[0]) {
      req.files.profileImage[0]._uploadedPath = await uploadToStorage(
        req.files.profileImage[0],
        `sellers/${req.user?.id || "public"}/profile-${Date.now()}.png`
      );
    }
    if (req.files?.coverImage?.[0]) {
      req.files.coverImage[0]._uploadedPath = await uploadToStorage(
        req.files.coverImage[0],
        `sellers/${req.user?.id || "public"}/cover-${Date.now()}.png`
      );
    }
    if (req.files?.kycDoc?.[0]) {
      req.files.kycDoc[0]._uploadedPath = await uploadToStorage(
        req.files.kycDoc[0],
        `sellers/${req.user?.id || "public"}/kyc-${Date.now()}.pdf`
      );
    }
    if (req.files?.addressProof?.[0]) {
      req.files.addressProof[0]._uploadedPath = await uploadToStorage(
        req.files.addressProof[0],
        `sellers/${req.user?.id || "public"}/address-${Date.now()}.pdf`
      );
    }
    next();
  } catch (e) { next(e); }
}

/* ================== Helpers ================== */
function ensureDraftDefaults(user, data = {}) {
  return {
    shopName: data.shopName || "Magazin",
    username:
      (data.username && String(data.username).toLowerCase().trim()) ||
      `draft-${user._id.toString().slice(-6)}-${Date.now().toString(36)}`,
    email: data.email || user.email,
    passwordHash: data.passwordHash || "placeholder",
    phone: data.phone || "0000000000",
    publicPhone: !!data.publicPhone,

    category: data.category || "altele",
    city: data.city || "-",
    country: data.country || "-",
    address: data.address || "",

    entityType: data.entityType || "pfa",
    companyName: data.companyName || "-",
    cui: data.cui || "-",
    registrationNumber: data.registrationNumber || "-",
    iban: data.iban || "-",

    shortDescription: data.shortDescription || "",
    about: data.about || "",
    brandStory: data.brandStory || "",
    deliveryNotes: data.deliveryNotes || "",
    returnNotes: data.returnNotes || "",
    tags: Array.isArray(data.tags) ? data.tags : [],

    status: "draft",
    onboardingStep: 1,
  };
}

function applyStepUpdate(seller, step, data = {}) {
  if (step === 1) {
    if (data.shopName != null) seller.shopName = data.shopName;
    if (data.username != null) seller.username = String(data.username).toLowerCase().trim();
    if (data.email != null) seller.email = data.email;
    if (data.phone != null) seller.phone = data.phone;
    if (typeof data.publicPhone === "boolean") seller.publicPhone = data.publicPhone;

    if (data.shortDescription != null) seller.shortDescription = data.shortDescription;
    if (data.about != null) seller.about = data.about;
    if (data.brandStory != null) seller.brandStory = data.brandStory;

    if (data.category != null) seller.category = data.category;
    if (data.city != null) seller.city = data.city;
    if (data.country != null) seller.country = data.country;
    if (data.address != null) seller.address = data.address;
    if (Array.isArray(data.tags)) seller.tags = data.tags;
  }

  if (step === 2) {
    if (data.profileImageUrl != null) seller.profileImageUrl = data.profileImageUrl;
    if (data.coverImageUrl != null) seller.coverImageUrl = data.coverImageUrl;
  }

  if (step === 3) {
    if (data.deliveryNotes != null) seller.deliveryNotes = data.deliveryNotes;
    if (data.returnNotes != null) seller.returnNotes = data.returnNotes;

    if (data.entityType != null) seller.entityType = data.entityType;
    if (data.companyName != null) seller.companyName = data.companyName;
    if (data.cui != null) seller.cui = data.cui;
    if (data.registrationNumber != null) seller.registrationNumber = data.registrationNumber;
    if (data.iban != null) seller.iban = data.iban;
  }
}

/* ================== PRIVATE: profil & upsert ================== */

router.get("/me", auth, async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user.id }).lean();
  if (!seller) return res.status(404).json({ msg: "Profil vânzător inexistent" });
  res.json(seller);
});

router.post(
  "/",
  auth,
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
    { name: "kycDoc", maxCount: 1 },
    { name: "addressProof", maxCount: 1 },
  ]),
  persistUploads,
  async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ msg: "Neautorizat" });

    let seller = await Seller.findOne({ userId: user._id });

    if (!seller) {
      const draftData = ensureDraftDefaults(user, req.body || {});
      seller = new Seller({ ...draftData, userId: user._id });
    }

    applyStepUpdate(seller, 1, req.body);
    applyStepUpdate(seller, 2, req.body);
    applyStepUpdate(seller, 3, req.body);

    const pImg = req?.files?.profileImage?.[0]?._uploadedPath;
    const cImg = req?.files?.coverImage?.[0]?._uploadedPath;
    if (pImg) seller.profileImageUrl = pImg;
    if (cImg) seller.coverImageUrl = cImg;

    seller.onboardingStep = Math.max(seller.onboardingStep || 1, 2);

    await seller.save();
    res.json({ ok: true, seller });
  }
);

/* ================== ONBOARDING ================== */

router.get("/onboarding/status", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("role");
  if (!user || user.role !== "seller") return res.status(403).json({ msg: "Nu e vânzător" });

  const seller = await Seller.findOne({ userId: user._id }).select("status onboardingStep").lean();
  if (!seller) return res.json({ step: 1, completed: false });

  res.json({
    step: Math.max(1, Math.min(3, seller.onboardingStep || 1)),
    completed: seller.status === "active",
  });
});

router.post("/onboarding/save", auth, async (req, res) => {
  // ✨ frontul tău trimite de obicei body raw (nu FormData) aici:
  //   { step: <1|2|3>, data: {...} }
  const stepNum = Number(req.body?.step) || 1;
  const data = req.body?.data || req.body || {};

  const user = await User.findById(req.user.id);
  if (!user || user.role !== "seller") return res.status(403).json({ msg: "Nu e vânzător" });

  let seller = await Seller.findOne({ userId: user._id });
  if (!seller) {
    seller = new Seller({ ...ensureDraftDefaults(user, data), userId: user._id });
  }

  // ✅ unicitate username
  if (data?.username) {
    const newU = String(data.username).toLowerCase().trim();
    if (newU !== seller.username) {
      const clash = await Seller.findOne({ username: newU }).select("_id");
      if (clash) return res.status(400).json({ msg: "Username deja folosit" });
    }
  }

  // ✅ unicitate shopName (case-insensitive)
  if (data?.shopName) {
    const name = String(data.shopName).trim();
    if (name && name !== seller.shopName) {
      const exists = await Seller.findOne({
        shopName: { $regex: `^${name}$`, $options: "i" },
      }).select("_id");
      if (exists) return res.status(400).json({ msg: "Numele de magazin este deja folosit" });
    }
  }

  applyStepUpdate(seller, stepNum, data);

  seller.onboardingStep = Math.max(seller.onboardingStep || 1, Math.min(3, stepNum + 1));
  await seller.save();

  res.json({ ok: true, nextStep: seller.onboardingStep, sellerId: seller._id });
});

router.post("/onboarding/complete", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("role");
  if (!user || user.role !== "seller") return res.status(403).json({ msg: "Nu e vânzător" });

  const seller = await Seller.findOne({ userId: user._id });
  if (!seller) return res.status(400).json({ msg: "Nu există draft de magazin" });

  if (!seller.shopName || !seller.username || !seller.category) {
    return res.status(400).json({ msg: "Completați numele magazinului, username-ul și categoria" });
  }

  seller.status = "active";
  seller.publishedAt = new Date();
  seller.onboardingStep = 3;
  await seller.save();

  res.json({ ok: true, slug: seller.username });
});

/* ================== ALIAS PROGRESS ================== */
router.get("/progress", auth, async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user.id }).select("onboardingStep status").lean();
  if (!seller) return res.json({ currentStep: 1, completed: false });

  res.json({
    currentStep: Math.max(1, Math.min(3, seller.onboardingStep || 1)),
    completed: seller.status === "active",
  });
});

router.patch("/progress", auth, async (req, res) => {
  const next = Math.max(1, Math.min(3, Number(req.body?.currentStep) || 1));

  let seller = await Seller.findOne({ userId: req.user.id });
  if (!seller) {
    const user = await User.findById(req.user.id);
    const draft = new Seller({ ...ensureDraftDefaults(user, {}), userId: user._id });
    draft.onboardingStep = next;
    await draft.save();
    return res.json({ ok: true, currentStep: draft.onboardingStep });
  }

  seller.onboardingStep = Math.max(seller.onboardingStep || 1, next);
  await seller.save();
  res.json({ ok: true, currentStep: seller.onboardingStep });
});

/* ================== PUBLIC ================== */
router.get("/public", async (_req, res) => {
  const sellers = await Seller.find({ status: "active" })
    .select("shopName username profileImageUrl coverImageUrl shortDescription city country category")
    .sort({ createdAt: -1 })
    .lean();
  res.json(sellers);
});

router.get("/public/slug/:slug", async (req, res) => {
  const seller = await Seller.findOne({
    username: String(req.params.slug).toLowerCase(),
    status: "active",
  }).lean();
  if (!seller) return res.status(404).json({ msg: "Magazin inexistent" });
  res.json(seller);
});

router.get("/public/resolve/:handle", async (req, res) => {
  const handle = String(req.params.handle).trim().toLowerCase();

  let seller = await Seller.findOne({ username: handle, status: "active" }).lean();
  if (!seller && /^[a-f\d]{24}$/i.test(handle)) {
    seller = await Seller.findOne({ _id: handle, status: "active" }).lean();
  }
  if (!seller) return res.status(404).json({ msg: "Magazin inexistent" });
  res.json(seller);
});

router.get("/public/:id", async (req, res) => {
  const seller = await Seller.findOne({ _id: req.params.id, status: "active" }).lean();
  if (!seller) return res.status(404).json({ msg: "Magazin inexistent" });
  res.json(seller);
});

/* ================== AVAILABILITY CHECKS (NEW) ================== */
// pot fi cu sau fără `auth` — eu le las cu auth ca restul rutei /seller
router.get("/check-username", auth, async (req, res) => {
  const raw = (req.query.u || "").toString().toLowerCase().trim();
  if (!raw) return res.json({ available: false });

  // dacă utilizatorul are deja acest username, îl considerăm disponibil pentru el
  const self = await Seller.findOne({ userId: req.user.id }).select("username").lean();
  if (self && self.username === raw) return res.json({ available: true });

  const exists = await Seller.findOne({ username: raw }).select("_id");
  return res.json({ available: !exists });
});

router.get("/check-shopname", auth, async (req, res) => {
  const name = (req.query.q || "").toString().trim();
  if (!name) return res.json({ available: false });

  // dacă utilizatorul are deja acest shopName, îl considerăm disponibil pentru el
  const self = await Seller.findOne({ userId: req.user.id }).select("shopName").lean();
  if (self && self.shopName && self.shopName.toLowerCase() === name.toLowerCase()) {
    return res.json({ available: true });
  }

  const exists = await Seller.findOne({
    shopName: { $regex: `^${name}$`, $options: "i" },
  }).select("_id");

  return res.json({ available: !exists });
});

export default router;
