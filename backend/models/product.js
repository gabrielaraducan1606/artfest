// models/product.js
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    images: [{ type: String }],
    description: { type: String, trim: true },
    category: { type: String, trim: true },
    stock: { type: Number, default: 0, min: 0 },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// title + description pentru text search
productSchema.index({ title: "text", description: "text" }, { weights: { title: 5, description: 1 } });
productSchema.index({ category: 1 });
productSchema.index({ price: 1 });
productSchema.index({ createdAt: -1 });

// guard against OverwriteModelError on reload
const Product =
  mongoose.models.Product || mongoose.model('Product', productSchema);

export default Product; // 👈 add this
