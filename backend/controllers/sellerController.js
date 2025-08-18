// controllers/sellerController.js
import User from "../models/user.js";
import Seller from "../models/Seller.js";

/* ——— Helpers ——— */

function ensureDraftDefaults(user, data = {}) {
  return {
    // Step 1
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

    // Step 2
    entityType: data.entityType || "pfa",
    companyName: data.companyName || "",
    cui: data.cui || "",
    address: data.address || "",
    iban: data.iban || "",
    emailFinance: data.emailFinance || "",
    subscriptionPlan: data.subscriptionPlan || "start",
    kycDocUrl: data.kycDocUrl || "",
    addressProofUrl: data.addressProofUrl || "",

    // Media (pot fi completate ulterior de routerul cu uploads)
    profileImageUrl: data.profileImageUrl || "",
    coverImageUrl: data.coverImageUrl || "",

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

/* ——— Controller actions ——— */

/** POST /become-seller — creează (sau returnează) draft Seller pentru user */
export const becomeSeller = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ msg: "Neautorizat" });

  let seller = await Seller.findOne({ userId: user._id });
  if (!seller) {
    seller = new Seller({ ...ensureDraftDefaults(user, {}), userId: user._id });
    await seller.save();
  }

  res.json({ ok: true, seller });
};

/** PUT /step-1 — salvează pasul 1 (poate fi FormData sau JSON) */
export const updateStep1 = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ msg: "Neautorizat" });

  const data = req.body || {};
  let seller = await Seller.findOne({ userId: user._id });
  if (!seller) {
    seller = new Seller({ ...ensureDraftDefaults(user, data), userId: user._id });
  }

  // unicitate username
  if (data?.username && data.username !== seller.username) {
    const clash = await Seller.findOne({
      username: String(data.username).toLowerCase().trim(),
    }).select("_id");
    if (clash) return res.status(400).json({ msg: "Username deja folosit" });
  }

  applyStepUpdate(seller, 1, data);

  // uploads (setate de router prin req.files[x][0]._uploadedPath)
  const pImg = req?.files?.profileImage?.[0]?._uploadedPath;
  const cImg = req?.files?.coverImage?.[0]?._uploadedPath;
  if (pImg) seller.profileImageUrl = pImg;
  if (cImg) seller.coverImageUrl = cImg;

  seller.onboardingStep = Math.max(seller.onboardingStep || 1, 2);
  await seller.save();
  res.json({ ok: true, nextStep: seller.onboardingStep, seller });
};

/** PUT /step-2 — salvează pasul 2 (KYC + billing) */
export const updateStep2 = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ msg: "Neautorizat" });

  const data = req.body || {};
  let seller = await Seller.findOne({ userId: user._id });
  if (!seller) {
    seller = new Seller({ ...ensureDraftDefaults(user, data), userId: user._id });
  }

  applyStepUpdate(seller, 2, data);

  const kyc = req?.files?.kycDoc?.[0]?._uploadedPath;
  const adr = req?.files?.addressProof?.[0]?._uploadedPath;
  if (kyc) seller.kycDocUrl = kyc;
  if (adr) seller.addressProofUrl = adr;

  seller.onboardingStep = Math.max(seller.onboardingStep || 1, 3);
  await seller.save();
  res.json({ ok: true, nextStep: seller.onboardingStep, seller });
};

/** PUT /step-3 — salvează pasul 3 (politici), eventual finalizează/publică */
export const updateStep3 = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(401).json({ msg: "Neautorizat" });

  const data = req.body || {};
  let seller = await Seller.findOne({ userId: user._id });
  if (!seller) {
    seller = new Seller({ ...ensureDraftDefaults(user, data), userId: user._id });
  }

  applyStepUpdate(seller, 3, data);

  // validări minime pentru publicare (opțional: publicare aici sau pe alt endpoint)
  const canPublish = seller.shopName && seller.username && seller.category;
  if (data.publish === "true" || data.publish === true) {
    if (!canPublish) {
      return res
        .status(400)
        .json({ msg: "Completați numele magazinului, username-ul și categoria" });
    }
    seller.status = "active";
    seller.publishedAt = new Date();
  }

  seller.onboardingStep = 3;
  await seller.save();

  res.json({ ok: true, published: seller.status === "active", slug: seller.username, seller });
};
