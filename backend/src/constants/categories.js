// Minimal categories list for products.
// Adjust/extend as you like — keys are stored in DB in Product.category.

export const CATEGORIES = [
  "invitatii",
  "decor",
  "album",
  "flori",
  "tort",
  "meniuri",
  "marturii",
  "lumini",
  "sonorizare",
  "foto",
  "video",
  "alte"
];

// Helpful Set for fast validation lookups.
export const CATEGORY_SET = new Set(CATEGORIES);
