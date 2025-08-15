import mongoose from 'mongoose';

const sellerSchema = new mongoose.Schema(
  {
    shopName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },

    phone: { type: String, required: true },
    publicPhone: { type: Boolean, default: false },

    profileImageUrl: { type: String },
    coverImageUrl: { type: String },

    shortDescription: { type: String, maxlength: 600 },
    about: { type: String, maxlength: 600 },
    brandStory: { type: String },

    category: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },
    address: { type: String, trim: true },

    tags: { type: [String], default: [] },

    deliveryNotes: { type: String },
    returnNotes: { type: String },

    entityType: { type: String, enum: ['pfa', 'srl'], required: true },
    companyName: { type: String, required: true },
    cui: { type: String, required: true },
    registrationNumber: { type: String, required: true },
    iban: { type: String, required: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, index: true },

    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'draft' },
    publishedAt: { type: Date, default: null },
    onboardingStep: { type: Number, default: 1 },
    kycDocUrl: { type: String },
    addressProofUrl: { type: String },
    emailFinance: { type: String },
    subscriptionPlan: { type: String, enum: ['start', 'growth', 'pro'], default: 'start' },
    termsAccepted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

sellerSchema.index({ username: 1 }, { unique: true });

// index pentru căutări după numele magazinului
sellerSchema.index({ shopName: 1 });

// opțional: dacă vrei UNICITATE case-insensitive pe shopName,
// setează o collation pe colecție (ex. en, strength: 2) și apoi:
// sellerSchema.index({ shopName: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

sellerSchema.index({ shopName: 'text' }, { weights: { shopName: 5 } });

// 👇 folosește modelul existent dacă e deja înregistrat
export default mongoose.models.Seller || mongoose.model('Seller', sellerSchema);
