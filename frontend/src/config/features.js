// src/config/features.js

/*
 * Feature flags frontend (constante de build, fără logică de runtime).
 *
 * VENDOR_COURIERS_ENABLED - integrarea de curierat pentru vendori
 * (conturi de curier, adrese de ridicare, „Generează AWB”, etichete,
 * anulare AWB). Controlat de variabila de BUILD Vite
 * VITE_VENDOR_COURIERS_ENABLED (frontend/.env sau Vercel -> Environment
 * Variables; se aplică la build, nu la runtime):
 *   "1" / "true"  -> pornit
 *   "0" / "false" -> oprit
 *   nesetată      -> pornit DOAR în `vite dev` (import.meta.env.DEV);
 *                    orice build (`vite build`, deci Vercel producție și
 *                    preview) e OPRIT dacă variabila nu e setată explicit.
 * Backend-ul are un flag separat (COURIER_INTEGRATION_ENABLED, vezi
 * backend/src/couriers/http.js) - API-ul refuză oricum cererile când e
 * oprit acolo.
 *
 * Unde e folosit:
 *   - config/vendorNavigation.js           itemul „Curieri” din meniul vendor
 *   - components/Navbar/Navbar.jsx         linkul „Curieri” din dropdown-ul avatarului
 *   - Settings/couriers/CourierSettings    secțiunea din Setări (altfel: „În curs de activare”)
 *   - Orders/components/CourierConnectCta  CTA „Conectează un curier” (Comenzi + detaliu)
 *   - Orders/components/AwbPanel           secțiunea „Curier / Livrare” din detaliul comenzii
 */
export function resolveVendorCouriersEnabled(env = {}) {
  const raw = String(env?.VITE_VENDOR_COURIERS_ENABLED ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return env?.DEV === true;
}

export const VENDOR_COURIERS_ENABLED = resolveVendorCouriersEnabled(
  (typeof import.meta !== "undefined" && import.meta.env) || {}
);

/*
 * COURIER_AUTO_INTEGRATION_AVAILABLE - integrarea AUTOMATĂ cu curierii
 * (conectare / testare cont, adrese de ridicare, „Generează AWB”, anulare
 * AWB) e momentan INDISPONIBILĂ: secțiunile rămân vizibile, dar acțiunile
 * sunt dezactivate (greyed out) și nu fac niciun request. Fluxul manual
 * („Trimite fără integrare”) rămâne activ mereu.
 *
 * Acțiunile automate cer AMBELE: VENDOR_COURIERS_ENABLED (build) ȘI această
 * constantă. Backend-ul are în plus COURIER_INTEGRATION_ENABLED (oprit în
 * producție) - protecție și dacă UI-ul e schimbat accidental.
 */
export const COURIER_AUTO_INTEGRATION_AVAILABLE = false;
export const COURIER_AUTOMATION_ENABLED = VENDOR_COURIERS_ENABLED && COURIER_AUTO_INTEGRATION_AVAILABLE;
export const COURIER_AUTOMATION_SOON_MESSAGE = "Integrarea automată cu curierii va fi disponibilă în curând.";
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
