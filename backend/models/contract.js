// src/models/Contract.js
import mongoose from 'mongoose';

const contractSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    version: { type: String, required: true },          // versiunea șablonului
    dataSnapshot: { type: Object, required: true },     // snapshot cu datele afișate în contract
    pdfUrl: { type: String },                           // URL către PDF (draft sau final)
    status: { type: String, enum: ['draft', 'sent', 'signed'], default: 'draft' },

    // Semnare
    signedAt: { type: Date },
    signerName: { type: String },
    signerEmail: { type: String },
    audit: {
      ip: String,
      userAgent: String,
      hash: String,                                     // SHA-256 al PDF-ului final
    },
  },
  { timestamps: true }
);

export default mongoose.model('Contract', contractSchema);
