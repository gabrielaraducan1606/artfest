// backend/models/cart.js
import mongoose from "mongoose";

const cartSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    qty: { type: Number, default: 1, min: [1, "Cantitatea minimă este 1"] }
  },
  { timestamps: true }
);

// Previne duplicatele în coș pentru același user și același produs
cartSchema.index({ userId: 1, productId: 1 }, { unique: true });

export default mongoose.model("Cart", cartSchema);
