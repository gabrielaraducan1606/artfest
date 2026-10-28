// src/pages/Vendor/Orders/utils/awbPanelLogic.js

/*
 * Logică pură pentru panoul AWB din detaliul comenzii vendorului.
 * Backend-ul (couriers/awb) rămâne sursa de adevăr: COD, eligibilitate,
 * adrese - aici doar decidem ce afișăm și validăm local câmpurile pe care
 * vendorul le poate completa (greutate, colete, dimensiuni, serviciu).
 */

// câmpurile pe care vendorul le poate modifica (NIMIC financiar); contul și
// serviciul de curier sunt ale Artfest (PLATFORM) - vendorul nu le alege
export const AWB_INPUT_FIELDS = ["parcels", "weightKg", "lengthCm", "widthCm", "heightCm"];

// configurarea contului Artfest (backend: couriers/platformAccount.js) -
// vendorul nu o poate rezolva; afișăm mesajul primit de la server
export const COURIER_SETUP_PENDING_CODE = "courier_setup_pending";
export const PLATFORM_SETUP_CODES = new Set([
  COURIER_SETUP_PENDING_CODE,
  "platform_account_missing",
  "platform_credentials_invalid",
  "platform_pickup_point_missing",
  "platform_pickup_point_invalid",
  "platform_contact_person_invalid",
]);

export function isPlatformSetupBlocker(b) {
  return PLATFORM_SETUP_CODES.has(b?.code);
}

export function isCourierSetupPending(preview) {
  return (
    preview?.courierSetup?.ready === false ||
    (preview?.blockers || []).some(isPlatformSetupBlocker)
  );
}

// mesajul concret de configurare (ex. punctul de ridicare Artfest lipsă)
export function courierSetupMessage(preview, fallback) {
  return (
    preview?.courierSetup?.message ||
    (preview?.blockers || []).find(isPlatformSetupBlocker)?.message ||
    fallback
  );
}

// adresa de ridicare a vendorului lipsă / incompletă -> formularul din panou
const PICKUP_BLOCKER_CODES = new Set([
  "pickup_address_missing",
  "pickup_address_incomplete",
  "pickup_phone_invalid",
  "pickup_postal_code_invalid",
]);

export function isPickupBlocker(b) {
  return PICKUP_BLOCKER_CODES.has(b?.code);
}

export const PICKUP_DETAILS_MISSING_MESSAGE = "Completează adresa și datele de contact pentru ridicarea coletului.";

// blockere pe care vendorul le poate rezolva direct în formular
const INPUT_BLOCKER_CODES = new Set([
  "weight_required",
  "weight_invalid",
  "parcels_invalid",
  "dimension_invalid",
]);

export function isInputBlocker(b) {
  return INPUT_BLOCKER_CODES.has(b?.code);
}

/**
 * Ce afișează secțiunea „Curier / Livrare” (o singură stare, deci un singur
 * set de acțiuni - niciun buton activ pentru o acțiune care nu poate rula):
 * Curierat centralizat: contul de curier e al Artfest - vendorul NU
 * conectează curier și NU configurează adresă de ridicare.
 *  - "manual"       : expediată fără integrare (Shipment.manualShipment) ->
 *                     doar datele introduse de vendor; fără AWB retroactiv
 *  - "loading"      : încărcăm statusul AWB
 *  - "disabled"     : integrarea e oprită pe server (503) -> „Integrarea cu
 *                     serviciul de curierat este în curs de configurare.”;
 *                     „Trimite fără integrare” activ
 *  - "error"        : nu am putut încărca datele -> doar „Reîncearcă”
 *  - "created"      : expedierea are AWB -> număr, etichetă, tracking (fără al doilea AWB)
 *  - "requested"    : generare în curs (recentă) -> doar „Reîmprospătează”
 *  - "unknown"      : rezultat neconfirmat de curier -> „Necesită verificare”,
 *                     FĂRĂ generare (rezolvă adminul)
 *  - "hidden"       : comandă anulată, fără AWB
 *  - "ready"        : previzualizarea + „Generează AWB” (eventual cu ultima
 *                     încercare FAILED / CANCELLED afișată deasupra); dacă
 *                     contul Artfest nu e configurat, butonul e dezactivat
 */
export function decideAwbPanelState({ shipment, orderStatus, loading, loadError, awbStatus }) {
  if (shipment?.manualShipment) return "manual";
  if (loadError?.code === "courier_integration_disabled") return "disabled";
  const awb = awbStatus?.shipment?.awb || shipment?.awb;
  if (awb) return "created";
  if (awbStatus?.active === "UNKNOWN") return "unknown";
  if (awbStatus?.active === "REQUESTED") return "requested";
  if (orderStatus === "cancelled") return "hidden";
  if (loading) return "loading";
  if (loadError || !awbStatus) return "error";
  return "ready";
}

// ultima încercare încheiată fără AWB activ (afișată deasupra formularului)
export function lastAttemptNotice(awbStatus) {
  const latest = awbStatus?.latest;
  if (!latest || awbStatus?.active) return null;
  if (latest.status === "FAILED") {
    return {
      tone: "danger",
      title: "Ultima generare a eșuat",
      message: latest.errorMessage || "Curierul a respins cererea.",
      retryLabel: "Încearcă din nou",
    };
  }
  if (latest.status === "CANCELLED") {
    return {
      tone: "muted",
      title: `AWB-ul ${latest.awbNumber || ""} a fost anulat`.replace(/\s+/g, " ").trim(),
      message: "Poți genera un AWB nou pentru această expediere.",
      retryLabel: "Generează AWB nou",
    };
  }
  return null;
}

const AWB_STATUS_BADGE = {
  CREATED: { label: "Creat", tone: "success" },
  REQUESTED: { label: "În curs", tone: "warning" },
  UNKNOWN: { label: "Necesită verificare", tone: "warning" },
  FAILED: { label: "Eșuat", tone: "danger" },
  CANCELLED: { label: "Anulat", tone: "muted" },
};

export function awbStatusBadge(status) {
  return AWB_STATUS_BADGE[status] || { label: "Fără AWB", tone: "muted" };
}

// metoda de livrare afișată în previzualizare
export function deliveryMethodLabel(preview) {
  if (preview?.method === "LOCKER") {
    return preview.lockerId ? `Locker / easybox (${preview.lockerId})` : "Locker / easybox";
  }
  return "Curier la adresă";
}

// eticheta generată de Artfest se descarcă prin ruta protejată (PDF de la curier)
export function isArtfestLabel(shipment) {
  return typeof shipment?.labelUrl === "string" && shipment.labelUrl.startsWith("/api/vendor/shipments/");
}

// „Anulează AWB”: serverul decide (awbStatus.canCancel: AWB Artfest activ,
// coletul nepredat); UI-ul îl mai ascunde după expediere / anularea comenzii
const AWB_NOT_CANCELLABLE_ORDER_STATUSES = new Set(["shipped", "fulfilled", "cancelled"]);
export function canCancelArtfestAwb({ awbStatus, orderStatus }) {
  return awbStatus?.canCancel === true && !AWB_NOT_CANCELLABLE_ORDER_STATUSES.has(String(orderStatus || ""));
}

export function initialAwbForm(preview) {
  return {
    parcels: preview?.parcels != null ? String(preview.parcels) : "1",
    weightKg: preview?.weightKg != null ? String(preview.weightKg) : "",
    lengthCm: preview?.lengthCm != null ? String(preview.lengthCm) : "",
    widthCm: preview?.widthCm != null ? String(preview.widthCm) : "",
    heightCm: preview?.heightCm != null ? String(preview.heightCm) : "",
  };
}

/**
 * Body pentru preview / create: DOAR câmpurile permise. codAmount nu se
 * trimite niciodată (e calculat pe server).
 */
export function buildAwbRequestBody(form) {
  const body = {};
  for (const key of ["parcels", "weightKg", "lengthCm", "widthCm", "heightCm"]) {
    const v = String(form?.[key] ?? "").trim().replace(",", ".");
    if (v !== "") body[key] = Number(v);
  }
  return body;
}

/*
 * Tipul coletului Sameday după greutate (doc v3.6) - aceeași regulă ca
 * backend-ul (providers/sameday/awbMapper.js), pe cel mai greu colet:
 * 1 -> până la 1 kg; 0 -> 1,01-38 kg; 2 -> peste 38 kg.
 */
export function packageTypeLabel(weightKg, parcels = 1) {
  const total = Number(String(weightKg ?? "").trim().replace(",", "."));
  const count = Number(parcels) >= 1 ? Number(parcels) : 1;
  if (!Number.isFinite(total) || total <= 0) return "—";
  const each = Math.round((total / count) * 100) / 100;
  if (each <= 1) return "Colet mic (până la 1 kg)";
  if (each <= 38) return "Colet standard (1-38 kg)";
  return "Colet supradimensionat (peste 38 kg)";
}

// validare locală, aceleași limite ca backend-ul (couriers/awb/parcels.js)
export function validateAwbForm(form) {
  const errors = {};
  const num = (k) => Number(String(form?.[k] ?? "").trim().replace(",", "."));
  const empty = (k) => String(form?.[k] ?? "").trim() === "";

  if (empty("weightKg")) errors.weightKg = "Completează greutatea totală (kg).";
  else if (!Number.isFinite(num("weightKg")) || num("weightKg") < 0.01 || num("weightKg") > 500) {
    errors.weightKg = "Greutatea trebuie să fie între 0,01 și 500 kg.";
  }

  if (!empty("parcels")) {
    const p = num("parcels");
    if (!Number.isInteger(p) || p < 1 || p > 20) errors.parcels = "Numărul de colete: între 1 și 20.";
  }

  for (const k of ["lengthCm", "widthCm", "heightCm"]) {
    if (empty(k)) continue;
    const v = num(k);
    if (!Number.isInteger(v) || v < 1 || v > 300) errors[k] = "Întreg între 1 și 300 cm.";
  }

  return errors;
}

/**
 * Blockerele rămase: cele de tip "input" dispar din listă când vendorul
 * editează câmpurile (validarea lor devine locală, apoi finală pe server).
 */
export function remainingBlockers(blockers, { inputsTouched }) {
  return (blockers || []).filter((b) => !(inputsTouched && isInputBlocker(b)));
}

export function canSubmitAwb({ blockers, inputsTouched, formErrors, submitting }) {
  if (submitting) return false;
  if (Object.keys(formErrors || {}).length) return false;
  return remainingBlockers(blockers, { inputsTouched }).length === 0;
}

// cheie de idempotență per încercare (aceeași cheie la retrimiterea după o eroare de rețea)
export function newIdempotencyKey() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `awb-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * După un răspuns de eroare: păstrăm cheia DOAR dacă nu știm dacă cererea a
 * ajuns la server (eroare de rețea, fără status) - retrimiterea e atunci
 * sigură (același rezultat). Orice răspuns HTTP => încercare nouă = cheie nouă.
 */
export function shouldKeepIdempotencyKey(error) {
  return !error?.status;
}

export function formatMoneyRon(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(n);
}

/* =========================================================
   Expediere FĂRĂ integrare („Trimite fără integrare”)
   Backend: PATCH /api/vendor/orders/:id/status cu
   { status: "shipped", manualShipping } (couriers/manualShipment.js).
   Nu creează CourierAwb, nu apelează curierul, nimic financiar.
========================================================= */

// etapele în care comanda poate fi expediată (înainte de predare)
const MANUAL_SHIP_ORDER_STATUSES = new Set(["new", "preparing", "confirmed"]);
// stările panoului în care un AWB al integrării există / e în curs -> fără flux manual
const NO_MANUAL_PANEL_STATES = new Set(["manual", "created", "requested", "unknown", "hidden"]);

/**
 * „Trimite fără integrare” e disponibil? Fără AWB (manual sau al
 * integrării), fără generare în curs, comanda încă nepredată.
 */
export function canShipManually({ shipment, orderStatus, panelState = null }) {
  if (!shipment?.id || shipment.manualShipment || shipment.awb) return false;
  if (!MANUAL_SHIP_ORDER_STATUSES.has(String(orderStatus || ""))) return false;
  if (panelState && NO_MANUAL_PANEL_STATES.has(panelState)) return false;
  return true;
}

/**
 * Cât de vizibil e „Trimite fără integrare”:
 *  - "primary"  : AWB-ul nu poate fi generat din Artfest (integrare în curs de
 *                 configurare / oprită / eroare) -> acțiune clară
 *  - "discreet" : „Generează AWB” e acțiunea principală
 *  - null       : indisponibil
 */
export function manualShipVisibility({ shipment, orderStatus, panelState, setupPending = false }) {
  if (!canShipManually({ shipment, orderStatus, panelState })) return null;
  if (panelState === "loading") return null;
  return panelState === "ready" && !setupPending ? "discreet" : "primary";
}

export const MANUAL_COURIER_SUGGESTIONS = ["Sameday", "FAN Courier", "Cargus", "DPD", "GLS", "Poșta Română"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

// data locală „YYYY-MM-DD” (valoarea pentru input type=date)
export function localIsoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function initialManualShipForm(now = new Date()) {
  return { courierName: "", awb: "", trackingUrl: "", shippedAt: localIsoDate(now) };
}

// aceleași reguli ca backend-ul (couriers/manualShipment.js)
export function validateManualShipForm(form, now = new Date()) {
  const errors = {};
  const courierName = String(form?.courierName ?? "").trim();
  if (courierName.length > 80) errors.courierName = "Maximum 80 de caractere.";

  const awb = String(form?.awb ?? "").replace(/\s+/g, "");
  if (awb &&!/^[A-Za-z0-9-]{3,60}$/.test(awb)) errors.awb = "3-60 caractere: litere, cifre, cratimă.";

  const url = String(form?.trackingUrl ?? "").trim();
  if (url) {
    let ok = false;
    try {
      ok = ["http:", "https:"].includes(new URL(url).protocol) && url.length <= 500;
    } catch {
      ok = false;
    }
    if (!ok) errors.trackingUrl = "Introdu un link complet (https://…).";
  }

  const date = String(form?.shippedAt ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.shippedAt = "Alege data expedierii.";
  } else {
    const today = localIsoDate(now);
    const min = localIsoDate(new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000));
    if (date > today) errors.shippedAt = "Data nu poate fi în viitor.";
    else if (date < min) errors.shippedAt = "Maximum 60 de zile în urmă.";
  }
  return errors;
}

/*
 * Data expedierii afișată (zz.ll.aaaa) în Europe/Bucharest - aceeași zi ca
 * în email (backend: formatShipmentDateRo), indiferent de fusul browserului.
 * Backend-ul salvează ziua aleasă la 12:00 UTC (= 14:00/15:00 în România).
 */
export function formatShippedDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** Body pentru PATCH status: DOAR câmpurile de livrare (nimic financiar). */
export function buildManualShipBody(form) {
  const manualShipping = { shippedAt: String(form?.shippedAt || "").trim() };
  const courierName = String(form?.courierName ?? "").trim();
  const awb = String(form?.awb ?? "").replace(/\s+/g, "");
  const trackingUrl = String(form?.trackingUrl ?? "").trim();
  if (courierName) manualShipping.courierName = courierName;
  if (awb) manualShipping.awb = awb;
  if (trackingUrl) manualShipping.trackingUrl = trackingUrl;
  return { status: "shipped", manualShipping };
}
