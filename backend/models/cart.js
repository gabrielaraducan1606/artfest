import mongoose from "mongoose";

const cartSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  qty: { type: Number, default: 1, min: 1 }
}, { timestamps: true });

// Previne duplicatele în coș
cartSchema.index({ userId: 1, productId: 1 }, { unique: true });

export default mongoose.model("Cart", cartSchema);
