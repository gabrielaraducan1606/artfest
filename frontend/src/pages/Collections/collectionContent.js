// src/pages/Collections/collectionContent.js
//
// Ce text vede utilizatorul (și Google) pe pagina unei colecții, fără
// duplicări. Logică PURĂ (testabilă în Node).
//
//  - lead   : subtitle, o singură linie sub H1 (ca până acum);
//  - detail : un paragraf scurt imediat sub titlu:
//               * description, dacă e scurtă (<= MAX_SHORT caractere) -
//                 atunci NU se mai afișează și jos;
//               * altfel seoDescription;
//             omis dacă repetă lead-ul;
//  - bodyHtml: description-ul LUNG (HTML, de sanitizat la randare), jos,
//             doar dacă nu a fost deja afișat și nu repetă textul de sus.

import { htmlToText } from "../../utils/sanitizeHtml.js";

export const MAX_SHORT_DESCRIPTION = 320;

function norm(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// aceeași informație (egal sau unul conținut în celălalt)
function sameText(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * @param {{subtitle?: string, seoDescription?: string, description?: string}} c
 * @returns {{ lead: string, detail: string, bodyHtml: string }}
 */
export function buildCollectionIntro(c = {}) {
  const lead = htmlToText(c.subtitle);
  const seo = htmlToText(c.seoDescription);
  const descText = htmlToText(c.description);

  const descIsShort =
    descText.length > 0 && descText.length <= MAX_SHORT_DESCRIPTION;

  const detailSource = descIsShort ? descText : seo;
  const detail =
    detailSource && !sameText(detailSource, lead) ? detailSource : "";

  let bodyHtml = "";

  if (descText && !descIsShort) {
    const repeatsTop = sameText(descText, detail) || sameText(descText, lead);
    if (!repeatsTop) bodyHtml = String(c.description);
  }

  return { lead, detail, bodyHtml };
}
