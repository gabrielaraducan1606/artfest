export async function analyzeProductImagesWithAi({
  images,
  title = "",
  description = "",
  catalog,
}) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error("images_required");
  }

  /*
   * Înlocuiește această parte cu providerul AI
   * pe care îl folosești în proiect.
   *
   * Răspunsul trebuie să aibă această structură:
   */
  return {
    // categoria PRINCIPALĂ propusă (cheie din catalog)
    category: null,
    // max 3 categorii SUPLIMENTARE propuse - doar sugestii pentru vendor
    additionalCategories: [],
    colors: [],
    materialMain: null,
    confidence: null,
    imageGroups: [],
  };
}