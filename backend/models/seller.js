// src/models/Seller.js
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
    brandStory: { type: String },
    category: { type: String, required: true },
    city: { type: String, required: true },
    country: { type: String, required: true },

    deliveryNotes: { type: String },
    returnNotes: { type: String },

    entityType: { type: String, enum: ['pfa', 'srl'], required: true },
    companyName: { type: String, required: true },
    cui: { type: String, required: true },
    registrationNumber: { type: String, required: true },
    iban: { type: String, required: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  },
  { timestamps: true }
);

export default mongoose.model('Seller', sellerSchema);
