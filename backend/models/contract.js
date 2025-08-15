// models/Contract.js
import mongoose from 'mongoose';

const contractSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', index: true },

    version: { type: String, default: 'v1.0' },

    status: {
      type: String,
      enum: ['draft', 'signed'],
      default: 'draft',
      index: true,
    },

    // PDF-uri (cale internă + url public expus de /uploads)
    pdfPath: { type: String },        // ex: storage/contracts/xxx.pdf
    pdfUrl: { type: String },         // ex: /uploads/contracts/xxx.pdf
    pdfSignedPath: { type: String },
    pdfSignedUrl: { type: String },

    signerName: { type: String },
    signerEmail: { type: String },
    signedAt: { type: Date },

    // cache de date relevante la generare
    snapshot: {
      shopName: String,
      username: String,
      companyName: String,
      cui: String,
      iban: String,
      city: String,
      country: String,
      generatedAt: Date,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Contract', contractSchema);
