// Căutarea în lista de categorii din editorul de produs (ProductModal).
// Potrivire după denumire, fără diferență între litere mari/mici sau
// diacritice („cadouri pentru nasi” găsește „Cadouri pentru nași”).
// Doar filtrează afișarea: selecția din formular nu se schimbă.

/** Text pentru comparare: fără diacritice (ă â î ș ş ț ţ), litere mici, spații normalizate. */
export function normalizeCategorySearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Opțiunile care se potrivesc căutării (ordinea catalogului se păstrează).
 * Categoria deja aleasă (`keepKey`) rămâne mereu în listă, ca `<select>`-ul
 * să o afișeze corect și când căutarea nu o include.
 *
 * @returns {{ options: Array, matches: number }} `matches` = câte opțiuni
 *   se potrivesc efectiv căutării (fără cea păstrată forțat).
 */
export function filterCategoryOptions(options, query, keepKey = "") {
  const list = Array.isArray(options) ? options : [];
  const q = normalizeCategorySearchText(query);
  if (!q) return { options: list, matches: list.length };

  let matches = 0;
  const filtered = list.filter((option) => {
    const hit = normalizeCategorySearchText(option?.label || option?.key).includes(q);
    if (hit) matches += 1;
    return hit || (keepKey && option?.key === keepKey);
  });

  return { options: filtered, matches };
}
