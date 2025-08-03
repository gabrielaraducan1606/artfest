import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    images: [{ type: String }],
    description: { type: String, trim: true },
    category: { type: String, trim: true }, // bijuterii, pictură, etc.
    stock: { type: Number, default: 0, min: 0 }, // stoc disponibil
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export default mongoose.model('Product', productSchema);
