// src/pages/ProductDetails/detailsUtils.js

// helpers folosiți în mai multe locuri
export const hasText = (v) =>
  typeof v === "string" && v.trim().length > 0;

export const splitTags = (v) =>
  String(v || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

// funcția pe care o folosești în ProductDetails.jsx
export const getHasStructuredDetails = (product, availabilityText) => {
  if (!product) return false;

  return (
    !!availabilityText ||
    product.acceptsCustom ||
    hasText(product.materialMain) ||
    hasText(product.technique) ||
    hasText(product.dimensions) ||
    splitTags(product.styleTags).length > 0 ||
    splitTags(product.occasionTags).length > 0 ||
    splitTags(product.careInstructions).length > 0 ||
    hasText(product.specialNotes) ||
    hasText(product.color)
  );
};
