// server/utils/cityUtils.js

/**
 * Normalizează un nume de oraș într-un "slug" stabil:
 *  - lowercase
 *  - înlocuiește diacriticele românești
 *  - orice nu e literă/cifră devine spațiu
 *  - spațiile devin "-"
 *
 * Exemple:
 *  "Bacău"        -> "bacau"
 *  "Cluj-Napoca"  -> "cluj-napoca"
 *  " Sector 3 "   -> "sector-3"
 */
export function normalizeCityName(input = "") {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return "";

  // înlocuim diacriticele românești
  const noDiacritics = s
    .replace(/[ăâ]/g, "a")
    .replace(/[șş]/g, "s")
    .replace(/[țţ]/g, "t")
    .replace(/î/g, "i");

  // orice nu e literă/cifră devine spațiu
  const cleaned = noDiacritics.replace(/[^a-z0-9]+/g, " ");

  // spații → "-"
  const slug = cleaned
    .trim()
    .replace(/\s+/g, "-");

  return slug; // ex: "Bacău" -> "bacau", "Cluj-Napoca" -> "cluj-napoca"
}

/**
 * Helper mic folosit prin admin/public pentru a decide
 * ce etichetă e "mai frumoasă" (are diacritice).
 */
export function hasRomanianDiacritics(s = "") {
  return /[ăâîșșţțț]/i.test(s);
}
