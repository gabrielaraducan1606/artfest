// controllers/sellerOnboardingController.js
import Seller from "../models/Seller.js";
import User from "../models/user.js";

// Pas 0: Devino vânzător (creează un draft)
export const becomeSeller = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Utilizator inexistent" });

    // dacă deja are Seller, returnăm acel document
    let seller = await Seller.findOne({ userId });
    if (seller) return res.json({ seller });

    seller = await Seller.create({
      shopName: "Numele magazinului tău",
      username: `seller-${userId.toString().slice(-5)}`,
      email: user.email,
      phone: "",
      category: "",
      city: "",
      country: "",
      entityType: "pfa",
      companyName: "",
      cui: "",
      registrationNumber: "",
      iban: "",
      userId,
    });

    // schimbăm rolul
    user.role = "seller";
    await user.save();

    res.json({ seller });
  } catch (err) {
    console.error("Eroare becomeSeller:", err);
    res.status(500).json({ msg: "Eroare la inițierea profilului" });
  }
};

// Pas 1
export const updateStep1 = async (req, res) => {
  try {
    const { shopName, username, category, city, country, phone, publicPhone } = req.body;

    const seller = await Seller.findOne({ userId: req.user.id });
    if (!seller) return res.status(404).json({ msg: "Profil seller inexistent" });

    // verificăm dacă username e unic
    if (username && username !== seller.username) {
      const existing = await Seller.findOne({ username });
      if (existing) return res.status(400).json({ msg: "Username deja folosit" });
      seller.username = username;
    }

    seller.shopName = shopName || seller.shopName;
    seller.category = category || seller.category;
    seller.city = city || seller.city;
    seller.country = country || seller.country;
    seller.phone = phone || seller.phone;
    seller.publicPhone = publicPhone ?? seller.publicPhone;

    await seller.save();
    res.json({ msg: "Pas 1 salvat", seller });
  } catch (err) {
    console.error("Eroare step1:", err);
    res.status(500).json({ msg: "Eroare la salvarea pasului 1" });
  }
};

// Pas 2
export const updateStep2 = async (req, res) => {
  try {
    const { profileImageUrl, coverImageUrl, shortDescription, about, brandStory, tags } = req.body;

    const seller = await Seller.findOne({ userId: req.user.id });
    if (!seller) return res.status(404).json({ msg: "Profil seller inexistent" });

    seller.profileImageUrl = profileImageUrl || seller.profileImageUrl;
    seller.coverImageUrl = coverImageUrl || seller.coverImageUrl;
    seller.shortDescription = shortDescription || seller.shortDescription;
    seller.about = about || seller.about;
    seller.brandStory = brandStory || seller.brandStory;
    seller.tags = Array.isArray(tags) ? tags : seller.tags;

    await seller.save();
    res.json({ msg: "Pas 2 salvat", seller });
  } catch (err) {
    console.error("Eroare step2:", err);
    res.status(500).json({ msg: "Eroare la salvarea pasului 2" });
  }
};

// Pas 3
export const updateStep3 = async (req, res) => {
  try {
    const { entityType, companyName, cui, registrationNumber, iban, deliveryNotes, returnNotes } = req.body;

    const seller = await Seller.findOne({ userId: req.user.id });
    if (!seller) return res.status(404).json({ msg: "Profil seller inexistent" });

    seller.entityType = entityType || seller.entityType;
    seller.companyName = companyName || seller.companyName;
    seller.cui = cui || seller.cui;
    seller.registrationNumber = registrationNumber || seller.registrationNumber;
    seller.iban = iban || seller.iban;
    seller.deliveryNotes = deliveryNotes || seller.deliveryNotes;
    seller.returnNotes = returnNotes || seller.returnNotes;

    await seller.save();
    res.json({ msg: "Pas 3 salvat", seller });
  } catch (err) {
    console.error("Eroare step3:", err);
    res.status(500).json({ msg: "Eroare la salvarea pasului 3" });
  }
};
