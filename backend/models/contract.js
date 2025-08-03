import mongoose from 'mongoose';

const contractSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Seller', required: true, index: true },
    version: { type: String, required: true },
    dataSnapshot: { type: Object, required: true },
    pdfUrl: { type: String },     // poate rămâne null când servim din disc
    pdfPath: { type: String },    // calea locală pe disc pentru download
    status: { type: String, enum: ['draft', 'sent', 'signed'], default: 'draft' },

    signedAt: { type: Date },
    signerName: { type: String },
    signerEmail: { type: String },
    audit: {
      ip: String,
      userAgent: String,
      hash: String, // SHA-256 al PDF-ului final
    },
  },
  { timestamps: true }
);

contractSchema.virtual('downloadUrl').get(function () {
  return `/api/contracts/${this._id}/download`;
});
contractSchema.set('toJSON', { virtuals: true });
contractSchema.set('toObject', { virtuals: true });

export default mongoose.model('Contract', contractSchema);
