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
    category: null,
    colors: [],
    materialMain: null,
    confidence: null,
    imageGroups: [],
  };
}