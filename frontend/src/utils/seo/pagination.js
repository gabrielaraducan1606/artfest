// frontend/src/utils/seo/pagination.js
//
// Paginare crawlabilă prin ?page=N pentru /colectii/:slug și
// /categorii/:slug. Modul PUR (fără DOM/fetch/import.meta), folosit de
// funcțiile Vercel (api/, care importă din ../src/utils/seo) ȘI de paginile React, ca URL-urile, canonical-ul
// și titlurile să fie calculate identic în HTML-ul brut și în DOM.
//
// Reguli:
//  - page=1 => URL curat, fără query (canonical curat);
//  - page>1 => canonical propriu cu ?page=N (NU se canonicalizează spre
//    page=1, altfel Google nu poate descoperi produsele suplimentare);
//  - valori invalide (0, negative, NaN, zecimale, "1e3", cu semn, prea mari,
//    liste) => tratate ca pagina 1, cu canonical curat: nu generăm
//    niciodată ?page=0 / ?page=-1 / ?page=NaN.

// Plafon rezonabil: peste el (?page=99999) nu e o pagină reală.
export const MAX_PAGE = 500;

/**
 * @param {unknown} raw  valoarea brută din query (string | string[] | undefined)
 * @returns {{ page: number, valid: boolean }}
 *   `valid=false` doar când a fost furnizată o valoare inutilizabilă;
 *   lipsa parametrului e o pagină 1 validă.
 */
export function parsePage(raw) {
  if (raw === undefined || raw === null || raw === "") {
    return { page: 1, valid: true };
  }

  // ?page=1&page=2 (array) sau alte tipuri => invalid
  if (typeof raw !== "string") return { page: 1, valid: false };

  // doar cifre, fără zero în față, fără semn/zecimale/exponent
  if (!/^[1-9]\d{0,3}$/.test(raw)) return { page: 1, valid: false };

  const page = Number(raw);
  if (page > MAX_PAGE) return { page: 1, valid: false };

  return { page, valid: true };
}

/** basePath (sau URL absolut) + ?page=N doar pentru N > 1. */
export function withPage(base, page) {
  return page > 1 ? `${base}?page=${page}` : base;
}

/** Sufix pentru titlu: "Titlu - Pagina 2" doar pentru pagina > 1. */
export function withPageInTitle(title, page) {
  return page > 1 ? `${title} - Pagina ${page}` : title;
}

/**
 * Linkurile Pagina anterioară / Pagina următoare (căi interne, pentru
 * <Link>). Anterioara către pagina 2 duce la URL-ul curat (page=1).
 *
 * @param {{ basePath: string, page: number, hasNext: boolean }} args
 * @returns {{ prev: {page:number,to:string}|null, next: {page:number,to:string}|null }}
 */
export function paginationLinks({ basePath, page, hasNext }) {
  const current = Number.isInteger(page) && page >= 1 ? page : 1;

  return {
    prev:
      current > 1
        ? { page: current - 1, to: withPage(basePath, current - 1) }
        : null,
    next:
      hasNext && current < MAX_PAGE
        ? { page: current + 1, to: withPage(basePath, current + 1) }
        : null,
  };
}
