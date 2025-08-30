import mongoose from "mongoose";
const { Schema, Types } = mongoose;

const OrderSchema = new Schema({
  buyer: { type: Types.ObjectId, ref: "User", default: null }, // guest allowed
  items: [{
    product: { type: Types.ObjectId, ref: "Product", required: true },
    seller:  { type: Types.ObjectId, ref: "Seller", required: true },
    qty: Number,
    price: Number
  }],
  shipping: [{
    seller: { type: Types.ObjectId, ref: "Seller", required: true },
    method: { type: String, enum: ["courier","pickup"], default: "courier" },
    cost: { type: Number, default: 0 }
  }],
  coupon: { type: String, default: null },
  note: { type: String, default: "" },
  totals: {
    merchandise: Number,
    discount: Number,
    shipping: Number,
    vat: Number,
    total: Number
  },
  shippingAddress: {
    name: String, email: String, phone: String,
    country: String, county: String, city: String, street: String, zip: String
  },
  payment: {
    method: { type: String, enum: ["card","cod"], default: "card" },
    status: { type: String, enum: ["pending","paid","failed"], default: "pending" }
  }
}, { timestamps: true });

OrderSchema.index({ buyer: 1, createdAt: -1 });

export default mongoose.model("Order", OrderSchema);
