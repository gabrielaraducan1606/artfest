// shared/ui/slugUtils.js
// Utilitare mici pentru a afișa mai “uman” slug-urile din backend.

/**
 * Transforma un slug de forma "decor_aranjamente-florale-naturale"
 * în "Decor Aranjamente Florale Naturale".
 *
 * @param {string} slug
 * @param {Object} options
 * @param {boolean} options.dropPrefix - dacă e true, taie tot până la primul "_"
 *                                       ex: decor_aranjamente... -> aranjamente...
 */
export function humanizeSlug(slug = "", { dropPrefix = false } = {}) {
  if (!slug || typeof slug !== "string") return "";

  let s = slug;

  if (dropPrefix) {
    s = s.replace(/^[^_]+_/, ""); // taie prima parte înainte de "_"
  }

  return s
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
