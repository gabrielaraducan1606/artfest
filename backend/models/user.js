import mongoose from "mongoose";

const shippingPolicySchema = new mongoose.Schema({
  baseCost:        { type: Number, default: 19.9 },   // taxa de bază pe comandă (per magazin)
  freeOver:        { type: Number, default: 0 },      // livrare gratuită peste această sumă (0 = dezactivat)
  perItem:         { type: Number, default: 0 },      // cost suplimentar per articol (opțional)
  pickupAvailable: { type: Boolean, default: false }, // permite ridicare personală
  notes:           { type: String, trim: true }
}, { _id: false });

const userSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },

  // 'user' sau 'seller'
  role:     { type: String, enum: ["user", "seller"], default: "user", index: true },

  // profil public / magazin
  name:      { type: String, trim: true },                   // nume persoană (fallback)
  storeName: { type: String, trim: true },                   // numele magazinului (ce afișăm în coș)
  avatarUrl: { type: String, trim: true },

  shippingPolicy: { type: shippingPolicySchema, default: () => ({}) },

  // vechile câmpuri — dacă le mai folosești în alte părți
  cart: [{
    id: String, title: String, price: String, image: String, quantity: Number
  }],
  favorites: [{
    id: String, title: String, price: String, image: String
  }],

  // progres onboarding vânzător
  sellerOnboarding: {
    step:        { type: Number, default: 1 },
    completed:   { type: Boolean, default: false },
    lastUpdated: { type: Date, default: Date.now }
  }
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// nume de afișat (preferă storeName)
userSchema.virtual("displayName").get(function () {
  if (this.storeName && this.storeName.trim()) return this.storeName;
  if (this.name && this.name.trim()) return this.name;
  return this.email?.split("@")[0] || "Artizan";
});

// index util pt căutări de magazin
userSchema.index({ storeName: 1 });

const User = mongoose.models.User || mongoose.model("User", userSchema);
export default User;
