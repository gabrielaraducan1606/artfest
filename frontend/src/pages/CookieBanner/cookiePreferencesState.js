// Logică PURĂ (fără React) pentru starea vizuală a bannerului de cookie-uri.
//
// Reguli:
//  - fără decizie: se afișează bannerul inițial;
//  - „Preferințe” (buton, footer sau evenimentul global) deschide panoul de
//    preferințe ORICÂND, indiferent dacă utilizatorul a acceptat/refuzat deja;
//  - închiderea panoului fără salvare revine la banner dacă încă nu există
//    decizie, altfel îl închide complet;
//  - pe pagina /preferinte-cookie bannerul nu se afișează (ar acoperi pagina).
//
// Rulare teste: node --test src/pages/CookieBanner/cookiePreferencesState.test.js

export const PREFERENCES_PATH = "/preferinte-cookie";

export function initialView({ hasDecision }) {
  return hasDecision ? "closed" : "banner";
}

export function reduceView(view, action, { hasDecision }) {
  switch (action) {
    case "open-preferences":
      return "preferences";
    case "close-preferences":
      return hasDecision ? "closed" : "banner";
    case "decided":
    case "saved":
      return "closed";
    default:
      return view;
  }
}

export function isBannerHiddenOnPath(pathname) {
  return String(pathname || "").replace(/\/+$/, "") === PREFERENCES_PATH;
}
