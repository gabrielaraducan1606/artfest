// src/pages/Home/NewsletterModal/newsletterTrigger.js
//
// Când are voie să apară popup-ul de newsletter pe homepage.
//
// Înainte: la 0,9 s după intrare, peste primul ecran (și, pe mobil,
// peste bannerul de cookie-uri și bula Asistentului) - exact când
// vizitatorul din Google Ads încearcă să înțeleagă pagina.
// Acum: doar după ce vizitatorul a citit/explorat pagina (timp minim ȘI
// scroll), după ce a răspuns la bannerul de cookie-uri și când nu e
// deschis alt dialog. Fără React - testabil separat.

export const NEWSLETTER_MIN_DWELL_MS = 25000;
export const NEWSLETTER_MIN_SCROLL_RATIO = 0.5;

/**
 * Cât din pagină a văzut utilizatorul (0..1), pe baza marginii de jos a
 * ecranului - pe o pagină scurtă (tot conținutul încape) = 1.
 */
export function getScrollRatio({ scrollY = 0, innerHeight = 0, scrollHeight = 0 } = {}) {
  if (!(scrollHeight > 0)) return 0;
  return Math.min(1, Math.max(0, (scrollY + innerHeight) / scrollHeight));
}

/**
 * @param {{
 *   elapsedMs: number,          // timp petrecut pe pagină
 *   scrollRatio: number,        // getScrollRatio(...)
 *   consentDecided: boolean,    // a răspuns la bannerul de cookie-uri
 *   otherDialogOpen: boolean,   // alt modal deschis (login, cerere...)
 * }} state
 */
export function shouldOpenNewsletter({
  elapsedMs = 0,
  scrollRatio = 0,
  consentDecided = false,
  otherDialogOpen = false,
} = {}) {
  return (
    consentDecided === true &&
    otherDialogOpen !== true &&
    elapsedMs >= NEWSLETTER_MIN_DWELL_MS &&
    scrollRatio >= NEWSLETTER_MIN_SCROLL_RATIO
  );
}

/**
 * Există un dialog VIZIBIL (login, formular de cerere, meniu...)?
 * Unele panouri rămân în DOM ascunse (ex. FloatingHub cu `hidden`) -
 * ele nu trebuie să blocheze definitiv popup-ul.
 */
export function isAnyDialogVisible(doc = globalThis.document) {
  if (!doc?.querySelectorAll) return false;

  return Array.from(
    doc.querySelectorAll('[aria-modal="true"], [role="dialog"]')
  ).some(
    (el) =>
      !el.hidden &&
      !el.closest?.("[hidden]") &&
      typeof el.getClientRects === "function" &&
      el.getClientRects().length > 0
  );
}
