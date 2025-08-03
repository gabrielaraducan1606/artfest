import mongoose from "mongoose";

const visitorSchema = new mongoose.Schema({
  sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
  ip: { type: String },
  userAgent: { type: String },
  country: { type: String },
  city: { type: String },
  visitedAt: { type: Date, default: Date.now }
});

export default mongoose.model("Visitor", visitorSchema);
