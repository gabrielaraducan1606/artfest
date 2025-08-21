// models/Seller.js
import mongoose from 'mongoose';

const sellerSchema = new mongoose.Schema({
  shopName: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },

  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },

  phone: { type: String, default: "" },
  publicPhone: { type: Boolean, default: false },
  publicEmail: { type: String, default: "" },

  profileImageUrl: { type: String },
  coverImageUrl: { type: String },

  shortDescription: { type: String, maxlength: 160 },
  brandStory: { type: String, maxlength: 3000 },

  category: { type: String, default: "" },
  city: { type: String, default: "" },
  country: { type: String, default: "România" },

  deliveryNotes: { type: String, default: "" },
  returnNotes: { type: String, default: "" },

  // STEP 2
  entityType: { type: String, enum: ['pfa', 'srl'], default: 'pfa' },
  companyName: { type: String, default: "" },
  cui: { type: String, default: "" },
  address: { type: String, default: "" },
  bank: { type: String, default: "" },
  iban: { type: String, default: "" },
  emailFinance: { type: String, default: "" },
  subscriptionPlan: { type: String, enum: ['start','growth','pro'], default: 'start' },
  kycDocUrl: { type: String },
  addressProofUrl: { type: String },

  // user link
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, index: true },

  // lifecycle
  status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
  publishedAt: { type: Date, default: null },
  onboardingStep: { type: Number, default: 1 },
}, { timestamps: true });

sellerSchema.index({ username: 1 }, { unique: true });
sellerSchema.index({ shopName: 'text' }, { weights: { shopName: 5 } });

export default mongoose.models.Seller || mongoose.model('Seller', sellerSchema);
