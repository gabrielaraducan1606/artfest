// src/models/PaymentProfile.js
import mongoose from 'mongoose';

const paymentProfileSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },

    // Detalii încasare
    iban: { type: String, required: true },
    emailFinance: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String },

    // Abonamente
    subscriptionPlan: { type: String, enum: ['start', 'growth', 'pro'], required: true, default: 'start' },
    status: { type: String, enum: ['active', 'paused', 'canceled'], default: 'active' },
    planActivatedAt: { type: Date, default: Date.now },
    trialEndsAt: { type: Date }, // setat la create: +30 zile

    // KYC (opțional acum; devine obligatoriu dacă integrezi Stripe/PayPal)
    kycDocUrl: { type: String },
    addressProofUrl: { type: String },
  },
  { timestamps: true }
);

export default mongoose.model('PaymentProfile', paymentProfileSchema);
