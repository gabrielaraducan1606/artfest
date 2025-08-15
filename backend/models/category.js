// TREBUIE MODIFICAT!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
import mongoose from "mongoose";

const CategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    slug: { type: String, index: true },
  },
  { timestamps: true }
);

CategorySchema.index({ name: 1 });

export default mongoose.model("Category", CategorySchema);
