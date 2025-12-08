// server/lib/cities.js
export function normalizeCitySlug(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // 1) lowercase
  s = s.toLowerCase();

  // 2) scoatem diacritice
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // 3) înlocuim orice nu e literă/cifră cu spațiu
  s = s.replace(/[^a-z0-9]+/g, " ");

  // 4) spații multiple -> un singur spațiu
  s = s.replace(/\s+/g, " ").trim();

  if (!s) return null;

  // 5) spațiile -> - pentru slug
  s = s.replace(/\s+/g, "-");

  return s; // ex: "Bacău" → "bacau", "CLUJ napoca" → "cluj-napoca"
}
