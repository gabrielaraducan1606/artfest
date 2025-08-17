// routes/sellerRoutes.js
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
    const uid = req.user?.id || "public";
    const tag = Date.now();

    const up = async (file, path) => (file ? await uploadToStorage(file, path) : null);

    if (req.files?.profileImage?.[0]) {
      req.files.profileImage[0]._uploadedPath = await up(
        req.files.profileImage[0],
        `sellers/${uid}/profile-${tag}.png`
      );
    }
    if (req.files?.coverImage?.[0]) {
      req.files.coverImage[0]._uploadedPath = await up(
        req.files.coverImage[0],
        `sellers/${uid}/cover-${tag}.png`
      );
    }
    if (req.files?.kycDoc?.[0]) {
      req.files.kycDoc[0]._uploadedPath = await up(
        req.files.kycDoc[0],
        `sellers/${uid}/kyc-${tag}.pdf`
      );
    }
    if (req.files?.addressProof?.[0]) {
      req.files.addressProof[0]._uploadedPath = await up(
        req.files.addressProof[0],
        `sellers/${uid}/address-${tag}.pdf`
      );
    }

    next();
  } catch (e) {
    next(e);
  }
}

/* ================== Helpers ================== */

function ensureDraftDefaults(user, data = {}) {
  return {
    // step 1
    shopName: data.shopName || "Magazin",
    username:
      (data.username && String(data.username).toLowerCase().trim()) ||
      `draft-${user._id.toString().slice(-6)}-${Date.now().toString(36)}`,
    email: data.email || user.email,
    passwordHash: data.passwordHash || "placeholder",
    phone: data.phone || "",
    publicPhone: !!data.publicPhone,
    publicEmail: data.publicEmail || "",
    shortDescription: data.shortDescription || "",
    brandStory: data.brandStory || "",
    category: data.category || "",
    city: data.city || "",
    country: data.country || "România",
    deliveryNotes: data.deliveryNotes || "",
    returnNotes: data.returnNotes || "",

    // step 2
    entityType: data.entityType || "pfa",
    companyName: data.companyName || "",
    cui: data.cui || "",
    address: data.address || "",
    iban: data.iban || "",
    emailFinance: data.emailFinance || "",
    subscriptionPlan: data.subscriptionPlan || "start",
    kycDocUrl: data.kycDocUrl || "",
    addressProofUrl: data.addressProofUrl || "",

    // lifecycle
    status: "draft",
    onboardingStep: 1,
  };
}

function applyStepUpdate(seller, step, data = {}) {
  if (step === 1) {
    const f = [
      "shopName",
      "username",
      "phone",
      "publicPhone",
      "publicEmail",
      "shortDescription",
      "brandStory",
      "category",
      "city",
      "country",
      "deliveryNotes",
      "returnNotes",
    ];
    f.forEach((k) => {
      if (data[k] == null) return;
      seller[k] = k === "username" ? String(data[k]).toLowerCase().trim() : data[k];
    });
  }
  if (step === 2) {
    const f = [
      "entityType",
      "companyName",
      "cui",
      "country",
      "city",
      "address",
      "iban",
      "emailFinance",
      "phone",
      "subscriptionPlan",
      "kycDocUrl",
      "addressProofUrl",
    ];
    f.forEach((k) => {
      if (data[k] != null) seller[k] = data[k];
    });
  }
  if (step === 3) {
    const f = ["deliveryNotes", "returnNotes"];
    f.forEach((k) => {
      if (data[k] != null) seller[k] = data[k];
    });
  }
}

/* ================== PRIVATE: profil & upsert ================== */

/** Profilul vânzătorului curent (după userId) */
router.get("/me", auth, async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user.id }).lean();
  if (!seller) return res.status(404).json({ msg: "Profil vânzător inexistent" });
  res.json(seller);
});

/** Creează/actualizează profil + upload imagini (fallback pentru formulare vechi) */
router.post(
  "/",
  auth,
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
  ]),
  persistUploads,
  async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ msg: "Neautorizat" });

    let seller = await Seller.findOne({ userId: user._id });
    if (!seller) {
      seller = new Seller({ ...ensureDraftDefaults(user, req.body || {}), userId: user._id });
    }

    // aplică câmpuri (folosim step 1 + 2 pentru poze)
    applyStepUpdate(seller, 1, req.body);

    const pImg = req?.files?.profileImage?.[0]?._uploadedPath;
    const cImg = req?.files?.coverImage?.[0]?._uploadedPath;
    if (pImg) seller.profileImageUrl = pImg;
    if (cImg) seller.coverImageUrl = cImg;

    seller.onboardingStep = Math.max(seller.onboardingStep || 1, 2);
    await seller.save();
    res.json({ ok: true, seller });
  }
);

/** Setări (subset) */
router.get("/settings", auth, async (req, res) => {
  const s = await Seller.findOne({ userId: req.user.id })
    .select(
      "shopName username shortDescription brandStory category city country publicPhone phone publicEmail profileImageUrl coverImageUrl deliveryNotes returnNotes entityType companyName cui registrationNumber iban emailFinance subscriptionPlan"
    )
    .lean();
  if (!s) return res.status(404).json({ msg: "Profil vânzător inexistent" });
  res.json(s);
});

router.patch(
  "/settings",
  auth,
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
  ]),
  persistUploads,
  async (req, res) => {
    const seller = await Seller.findOne({ userId: req.user.id });
    if (!seller) return res.status(404).json({ msg: "Profil vânzător inexistent" });

    applyStepUpdate(seller, 1, req.body);

    const pImg = req?.files?.profileImage?.[0]?._uploadedPath;
    const cImg = req?.files?.coverImage?.[0]?._uploadedPath;
    if (pImg) seller.profileImageUrl = pImg;
    if (cImg) seller.coverImageUrl = cImg;

    await seller.save();
    res.json({ ok: true });
  }
);

/* ================== LOOKUPS pentru Step 1 ================== */

router.get("/check-username", auth, async (req, res) => {
  const u = String(req.query.u || "").toLowerCase().trim();
  if (!u) return res.json({ available: false });
  const clash = await Seller.findOne({ username: u }).select("_id");
  res.json({ available: !clash });
});

router.get("/check-shopname", auth, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ available: false });
  const clash = await Seller.findOne({ shopName: q }).select("_id");
  res.json({ available: !clash });
});

/* ================== ONBOARDING: status + progress ================== */

router.get("/onboarding/status", auth, async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user.id })
    .select("status onboardingStep")
    .lean();
  if (!seller) return res.json({ step: 1, completed: false });
  res.json({
    step: Math.max(1, Math.min(3, seller.onboardingStep || 1)),
    completed: seller.status === "active",
  });
});

router.get("/progress", auth, async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user.id })
    .select("onboardingStep status")
    .lean();
  if (!seller) return res.json({ currentStep: 1, completed: false });

  res.json({
    currentStep: Math.max(1, Math.min(3, seller.onboardingStep || 1)),
    completed: seller.status === "active",
  });
});

router.patch("/progress", auth, async (req, res) => {
  const { currentStep } = req.body || {};
  const next = Math.max(1, Math.min(3, Number(currentStep) || 1));

  let seller = await Seller.findOne({ userId: req.user.id });
  if (!seller) {
    const user = await User.findById(req.user.id);
    seller = new Seller({ ...ensureDraftDefaults(user, {}), userId: user._id });
  }
  seller.onboardingStep = Math.max(seller.onboardingStep || 1, next);
  await seller.save();
  res.json({ ok: true, currentStep: seller.onboardingStep });
});

/* ================== ONBOARDING: save per pas + finalize ================== */

router.post(
  "/onboarding/save",
  auth,
  upload.fields([
    { name: "profileImage", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
    { name: "kycDoc", maxCount: 1 },
    { name: "addressProof", maxCount: 1 },
  ]),
  persistUploads,
  async (req, res) => {
    const step = Number(req.query.step || req.body.step || 1);
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ msg: "Neautorizat" });

    let seller = await Seller.findOne({ userId: user._id });
    if (!seller) {
      seller = new Seller({ ...ensureDraftDefaults(user, req.body || {}), userId: user._id });
    }

    // unicețe username la step 1
    if (step === 1 && req.body?.username && req.body.username !== seller.username) {
      const clash = await Seller.findOne({
        username: String(req.body.username).toLowerCase().trim(),
      }).select("_id");
      if (clash) return res.status(400).json({ msg: "Username deja folosit" });
    }

    applyStepUpdate(seller, step, req.body || {});

    // uploads map
    const pImg = req?.files?.profileImage?.[0]?._uploadedPath;
    const cImg = req?.files?.coverImage?.[0]?._uploadedPath;
    const kyc = req?.files?.kycDoc?.[0]?._uploadedPath;
    const adr = req?.files?.addressProof?.[0]?._uploadedPath;
    if (pImg) seller.profileImageUrl = pImg;
    if (cImg) seller.coverImageUrl = cImg;
    if (kyc) seller.kycDocUrl = kyc;
    if (adr) seller.addressProofUrl = adr;

    // avansează pasul (nu-l micșora)
    seller.onboardingStep = Math.max(seller.onboardingStep || 1, Math.min(3, step + 1));
    await seller.save();

    res.json({ ok: true, nextStep: seller.onboardingStep, sellerId: seller._id });
  }
);

router.post("/onboarding/complete", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("_id");
  if (!user) return res.status(401).json({ msg: "Neautorizat" });

  const seller = await Seller.findOne({ userId: user._id });
  if (!seller) return res.status(400).json({ msg: "Nu există draft de magazin" });

  // validări minime pentru publicare
  if (!seller.shopName || !seller.username || !seller.category) {
    return res
      .status(400)
      .json({ msg: "Completați numele magazinului, username-ul și categoria" });
  }

  seller.status = "active";
  seller.publishedAt = new Date();
  seller.onboardingStep = 3;
  await seller.save();

  res.json({ ok: true, slug: seller.username });
});

/* ================== PUBLIC ================== */

/** listă publică – doar magazine active */
router.get("/public", async (_req, res) => {
  const sellers = await Seller.find({ status: "active" })
    .select(
      "shopName username profileImageUrl coverImageUrl shortDescription city country category"
    )
    .sort({ createdAt: -1 })
    .lean();

  res.json(sellers);
});

/** by "slug" – la noi slug = username */
router.get("/public/slug/:slug", async (req, res) => {
  const seller = await Seller.findOne({
    username: String(req.params.slug).toLowerCase(),
    status: "active",
  }).lean();

  if (!seller) return res.status(404).json({ msg: "Magazin inexistent" });
  res.json(seller);
});

/** resolver: username | _id | userId */
router.get("/public/resolve/:handle", async (req, res) => {
  const handle = String(req.params.handle).trim().toLowerCase();
  let seller = await Seller.findOne({ username: handle, status: "active" }).lean();
  if (!seller && /^[a-f\d]{24}$/i.test(handle)) {
    seller = await Seller.findOne({ _id: handle, status: "active" }).lean();
  }
  if (!seller) return res.status(404).json({ msg: "Magazin inexistent" });
  res.json(seller);
});

/** by id – doar active */
router.get("/public/:id", async (req, res) => {
  const seller = await Seller.findOne({ _id: req.params.id, status: "active" }).lean();
  if (!seller) return res.status(404).json({ msg: "Magazin inexistent" });
  res.json(seller);
});

export default router;
