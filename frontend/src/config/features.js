// src/config/features.js

/*
 * Feature flags frontend (constante de build, fără logică de runtime).
 * Variabilele Vite se aplică la BUILD (frontend/.env local, Vercel ->
 * Environment Variables), nu la runtime. Activare DOAR explicită
 * ("1" / "true"); nesetată sau orice altă valoare -> OPRIT, inclusiv în
 * `vite dev` (nu se mai pornește nimic doar pentru că e mediu de dezvoltare).
 *
 * VENDOR_COURIERS_ENABLED (VITE_VENDOR_COURIERS_ENABLED) - secțiunile de
 * curierat ale vendorului (meniul „Curieri”, Setări → Livrare și retururi,
 * panoul „Livrare” din comandă). Oprit -> secțiunile rămân vizibile, dar
 * acțiunile automate sunt dezactivate.
 *
 * COURIER_AUTO_INTEGRATION_AVAILABLE (VITE_COURIER_AUTO_INTEGRATION_AVAILABLE) -
 * acțiunile AUTOMATE (conectare / testare cont, adrese de ridicare,
 * „Generează AWB”, anulare AWB). Oprit -> butoanele sunt vizibile, dar
 * dezactivate (greyed out), fără niciun request.
 *
 * Acțiunile automate cer AMBELE flag-uri. Backend-ul are în plus
 * COURIER_INTEGRATION_ENABLED (backend/src/couriers/http.js): dacă e oprit,
 * API-ul răspunde 503 courier_integration_disabled, iar UI-ul afișează
 * secțiunile cu acțiunile dezactivate. Fluxul manual („Trimite fără
 * integrare”) rămâne activ mereu, indiferent de flag-uri.
 *
 * Unde e folosit:
 *   - config/vendorNavigation.js           itemul „Curieri” din meniul vendor
 *   - components/Navbar/Navbar.jsx         linkul „Curieri” din dropdown-ul avatarului
 *   - Settings/couriers/CourierSettings    secțiunea din Setări
 *   - Orders/components/CourierConnectCta  CTA „Conectează un curier” (Comenzi)
 *   - Orders/components/AwbPanel           secțiunea „Livrare” din detaliul comenzii
 */
function isExplicitlyOn(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function resolveVendorCouriersEnabled(env = {}) {
  return isExplicitlyOn(env?.VITE_VENDOR_COURIERS_ENABLED);
}

export function resolveCourierAutoIntegrationAvailable(env = {}) {
  return isExplicitlyOn(env?.VITE_COURIER_AUTO_INTEGRATION_AVAILABLE);
}

const BUILD_ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};

export const VENDOR_COURIERS_ENABLED = resolveVendorCouriersEnabled(BUILD_ENV);
export const COURIER_AUTO_INTEGRATION_AVAILABLE = resolveCourierAutoIntegrationAvailable(BUILD_ENV);
/*
 * COURIER_ACTIONS_HARD_DISABLED - oprire TEMPORARĂ, fixă în cod, a TUTUROR
 * acțiunilor automate de curier (Programează curier, Generează AWB, Anulează
 * AWB, Conectează curier, Testează și conectează, adrese de ridicare),
 * INDIFERENT de variabilele VITE_* sau de mediu (dev / prod). Butoanele rămân
 * vizibile, greyed out, disabled + aria-disabled, fără onClick / request.
 * Se schimbă în false DOAR la decizia explicită de activare a curierilor.
 * Rămân active: „Trimite fără integrare”, tracking, „Predată curierului”.
 */
export const COURIER_ACTIONS_HARD_DISABLED = true;

export const COURIER_AUTOMATION_ENABLED =
  !COURIER_ACTIONS_HARD_DISABLED && VENDOR_COURIERS_ENABLED && COURIER_AUTO_INTEGRATION_AVAILABLE;
export const COURIER_AUTOMATION_SOON_MESSAGE = "Integrarea automată cu curierii va fi disponibilă în curând.";
// text scurt pentru tooltip-ul butoanelor dezactivate
export const COURIER_SOON_SHORT = "În curând - funcție în curs de activare";
export const COURIER_MANUAL_SHIPPING_MESSAGE = "Momentan poți expedia comanda fără integrare.";

/*
 * ATTRIBUTION_REQUIRES_CONSENT - atribuirea de referral request-based
 * (INFLUENCER + VENDOR REFERRAL: ?ref= / colecție -> memoria aplicației ->
 * coduri trimise la checkout -> validare server-side), FĂRĂ stocare pe
 * terminal (fără localStorage / cookie), fără click tracking și fără
 * identificatori (sessionId / ipHash / userAgent).
 *
 * false = varianta privacy-minimal: referral-ul e folosit fără a depinde de
 *         consimțământul „Atribuire” (nu se stochează nimic pe dispozitiv).
 * true  = referral-ul e folosit doar cu consimțământ „Atribuire”.
 *
 * Singurul punct de verificare: utils/referralMemory.js
 * (createReferralMemory). Nu se citește în alte componente.
 * Campaniile vendorului NU folosesc acest flag: model request-based separat,
 * fără consimțământ (utils/campaignAttribution.js, ?camp=).
 */
export const ATTRIBUTION_REQUIRES_CONSENT = false;
