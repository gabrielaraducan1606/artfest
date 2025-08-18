// backend/models/Contract.js
import mongoose from "mongoose";

const ContractSchema = new mongoose.Schema(
  {
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["draft", "signed"], default: "draft" },

    // unde îl găsim pe disc / url public
    pdfPath: { type: String },
    pdfUrl: { type: String },

    // semnare
    signerName: { type: String },
    signerEmail: { type: String },
    signedAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model("Contract", ContractSchema);
