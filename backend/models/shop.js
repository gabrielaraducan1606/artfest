// models/shop.js
import mongoose from "mongoose";

const shopSchema = new mongoose.Schema(
  {
    name:  { type: String, required: true, trim: true },
    slug:  { type: String, required: true, unique: true, lowercase: true, trim: true },

    logo:  { type: String, default: null },
    city:  { type: String, trim: true },
    country:{ type: String, trim: true },
    description: { type: String, trim: true },

    rating: { type: Number, default: 0, min: 0, max: 5 },
    productCount: { type: Number, default: 0, min: 0 },

    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // 🔒 control vizibilitate publică
    status: { type: String, enum: ["draft", "active", "archived"], default: "draft" },
    publishedAt: { type: Date, default: null },

    // (opțional, pentru compat cu cod vechi)
    isActive: { type: Boolean, default: true }, // NU mai folosi; folosește `status`
  },
  { timestamps: true }
);

/* Indexuri utile pentru search/sort */
shopSchema.index({ name: "text", description: "text" }, { weights: { name: 5 } });
shopSchema.index({ slug: 1 }, { unique: true });
shopSchema.index({ rating: -1, status: 1 });
shopSchema.index({ createdAt: -1 });

export default mongoose.model("Shop", shopSchema);
