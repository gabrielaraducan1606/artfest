// src/components/Returns/returnLogistics.js
//
// Retur Sameday STANDARD (ridicare de la adresă) - logică PURĂ de afișare,
// comună pentru client, guest, vânzător și Admin. Regulile reale (cine poate
// modifica, când se generează AWB-ul, costBearer obligatoriu etc.) sunt pe
// server; aici doar ascundem / dezactivăm ce serverul oricum ar refuza.
// Fără CSS / React - testat cu node --test (returnLogistics.test.js).

export const RETURN_METHOD_LABELS = Object.freeze({
  HOME_PICKUP: "Ridicare de la adresă prin curier",
  CUSTOMER_SELF: "Trimit singur coletul",
  EASYBOX: "Easybox",
});

export const RETURN_METHOD_HINTS = Object.freeze({
  HOME_PICKUP: "Curierul Sameday ridică coletul de la adresa confirmată de tine, după ce returul este acceptat.",
  CUSTOMER_SELF: "Expediezi tu coletul la adresa primită după acceptarea returului.",
});

// metodele pe care clientul le poate alege ACUM (Easybox Return urmează)
export const CLIENT_RETURN_METHODS = Object.freeze(["HOME_PICKUP", "CUSTOMER_SELF"]);

export const COST_BEARER_LABELS = Object.freeze({
  VENDOR: "Vânzătorul",
  CUSTOMER: "Clientul",
  ARTFEST: "Artfest",
  SPLIT: "Împărțit",
});

// statusurile în care clientul își mai poate schimba metoda (ca pe server)
const METHOD_EDITABLE_STATUSES = new Set(["NEW", "IN_REVIEW", "APPROVED", "PICKUP_REQUESTED"]);

/** Clientul (cont / guest cu acces complet) mai poate modifica metoda / adresa? */
export function canEditReturnMethod(rr) {
  if (!rr || !METHOD_EDITABLE_STATUSES.has(rr.status)) return false;
  const state = rr.returnShipment?.awbState || "NONE";
  return state === "NONE";
}

/** Schimbarea metodei e refuzată de server când coletul de retur e deja pregătit. */
export function methodChoicesFor(rr) {
  return rr?.returnShipment ? ["HOME_PICKUP"] : [...CLIENT_RETURN_METHODS];
}

/**
 * Pașii afișați clientului / vânzătorului. Stările reale vin de la server
 * (status cerere, AWB confirmat, predare, livrare); AWB generat NU înseamnă
 * colet preluat.
 * @returns {Array<{key:string,label:string,state:"done"|"current"|"todo"}>}
 */
export function returnProgressSteps(rr) {
  if (!rr) return [];
  const status = rr.status;
  const ship = rr.returnShipment || null;
  const courier = rr.returnMethod === "HOME_PICKUP" || !!ship;

  const accepted = ["APPROVED", "PICKUP_REQUESTED", "CLOSED"].includes(status);
  // cu colet de retur: doar AWB-ul CONFIRMAT contează (un retur vechi în
  // PICKUP_REQUESTED fără AWB, sau o anulare în verificare, NU e „comandat”)
  const awbConfirmed = ship ? ship.awbState === "CONFIRMED" : status === "PICKUP_REQUESTED";
  const handedOver = !!(ship?.handedOverAt || ship?.deliveredAt);
  const delivered = !!ship?.deliveredAt;
  const closed = status === "CLOSED";

  const raw = [
    { key: "requested", label: "Cerere trimisă", done: true },
    { key: "accepted", label: "Retur acceptat", done: accepted || closed },
    ...(courier
      ? [
          { key: "pickup_ordered", label: "Ridicare comandată", done: awbConfirmed || handedOver || closed },
          { key: "handed_over", label: "Predat curierului", done: handedOver || closed },
          { key: "delivered", label: "Livrat vânzătorului", done: delivered || closed },
        ]
      : []),
    { key: "closed", label: "Produs primit de vânzător", done: closed },
  ];

  if (status === "REJECTED") {
    return [
      { key: "requested", label: "Cerere trimisă", state: "done" },
      { key: "rejected", label: "Cerere respinsă", state: "current" },
    ];
  }

  let currentSet = false;
  return raw.map((step) => {
    if (step.done) return { key: step.key, label: step.label, state: "done" };
    if (!currentSet) {
      currentSet = true;
      return { key: step.key, label: step.label, state: "current" };
    }
    return { key: step.key, label: step.label, state: "todo" };
  });
}

/* ---------------- formularul adresei de ridicare ---------------- */

export const EMPTY_PICKUP_FORM = Object.freeze({
  name: "",
  phone: "",
  email: "",
  county: "",
  samedayCountyId: null,
  city: "",
  samedayCityId: null,
  address: "",
  postalCode: "",
});

const str = (v) => (v == null ? "" : String(v)).trim();

/**
 * Formular precompletat: adresa deja confirmată, altfel datele de contact ale
 * comenzii (fără ID-uri de nomenclator - localitatea se alege din listă).
 */
export function formFromPickup(pickupAddress, fallback = null) {
  if (pickupAddress && typeof pickupAddress === "object") {
    return {
      name: str(pickupAddress.name),
      phone: str(pickupAddress.phone),
      email: str(pickupAddress.email),
      county: str(pickupAddress.county),
      samedayCountyId: pickupAddress.countyId ?? null,
      city: str(pickupAddress.city),
      samedayCityId: pickupAddress.cityId ?? null,
      address: str(pickupAddress.address),
      postalCode: str(pickupAddress.postalCode),
    };
  }
  const f = fallback && typeof fallback === "object" ? fallback : {};
  const street = [str(f.street || f.address), str(f.streetNo) ? `nr. ${str(f.streetNo)}` : ""].filter(Boolean).join(" ");
  return {
    ...EMPTY_PICKUP_FORM,
    name: str(f.name || [f.firstName, f.lastName].filter(Boolean).join(" ")),
    phone: str(f.phone),
    email: str(f.email),
    county: str(f.county),
    city: str(f.city),
    address: street,
    postalCode: /^\d{6}$/.test(str(f.postalCode)) ? str(f.postalCode) : "",
  };
}

/** Validare locală (aceleași mesaje ca serverul; serverul validează oricum). */
export function validatePickupForm(form) {
  const errors = {};
  const phone = str(form?.phone).replace(/[^\d+]/g, "");
  if (!str(form?.name)) errors.name = "Completează numele persoanei care predă coletul.";
  if (!phone || !(/^(\+?40|0)\d{9}$/.test(phone) || /^\+\d{9,15}$/.test(phone))) errors.phone = "Telefonul nu este valid.";
  if (str(form?.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(form.email))) errors.email = "Emailul nu este valid.";
  if (!form?.samedayCountyId) errors.county = "Alege județul.";
  if (!form?.samedayCityId) errors.city = "Alege localitatea din listă.";
  if (!str(form?.address)) errors.address = "Completează strada și numărul.";
  if (str(form?.postalCode) && !/^\d{6}$/.test(str(form.postalCode))) errors.postalCode = "Codul poștal trebuie să aibă exact 6 cifre.";
  return errors;
}

/** Corpul trimis la server (PATCH .../method sau la crearea cererii). */
export function pickupPayloadFromForm(form) {
  return {
    name: str(form.name),
    phone: str(form.phone),
    email: str(form.email) || null,
    county: str(form.county),
    city: str(form.city),
    samedayCountyId: form.samedayCountyId ?? null,
    samedayCityId: form.samedayCityId ?? null,
    address: str(form.address),
    postalCode: str(form.postalCode) || null,
  };
}

export function pickupSummary(p) {
  if (!p) return "";
  return [p.address, p.city, p.county, p.postalCode].filter(Boolean).join(", ");
}

/* ---------------- etichetă ---------------- */

export const LABEL_FORMATS = Object.freeze(["A6", "A4"]);

export function clientLabelPath({ returnRequestId, format = "A6", guestOrderId = null, guestAccessQuery = "" }) {
  const f = format === "A4" ? "A4" : "A6";
  if (guestOrderId) {
    return `/api/guest/orders/${encodeURIComponent(guestOrderId)}/returns/${encodeURIComponent(returnRequestId)}/label?${guestAccessQuery}&format=${f}`;
  }
  return `/api/user/returns/${encodeURIComponent(returnRequestId)}/label?format=${f}`;
}

export function adminLabelPath(shipmentId, format = "A6") {
  return `/api/admin/pickups/${encodeURIComponent(shipmentId)}/awb-label?format=${format === "A4" ? "A4" : "A6"}`;
}

/* ---------------- Admin: ce acțiuni de transport sunt disponibile ---------------- */

const SHIPMENT_PRE_HANDOVER = new Set(["PENDING", "PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED"]);

/**
 * Starea panoului „Transport retur” din Admin, din detaliul cererii
 * (GET /api/admin/returns/:id) + previzualizarea AWB (opțională).
 */
export function adminReturnLogisticsState(rr, preview = null) {
  const shipment = (rr?.returnShipments || []).find((s) => s.direction === "RETURN") || null;
  const awbs = shipment?.courierAwbs || [];
  const active = awbs.find((a) => ["REQUESTED", "CREATED", "UNKNOWN"].includes(a.status)) || null;
  const homePickup = rr?.returnMethod === "HOME_PICKUP";
  const approved = rr?.status === "APPROVED";
  const eligibleStatus = ["APPROVED", "PICKUP_REQUESTED"].includes(rr?.status);
  const hasAddress = !!(rr?.pickupAddress?.countyId && rr?.pickupAddress?.cityId);
  const preHandover = !!shipment && SHIPMENT_PRE_HANDOVER.has(shipment.status) && !shipment.handedOverAt && !shipment.deliveredAt;
  // retur VECHI: colet fără livrare (ShipmentDelivery) sau fără colete / greutate
  const missingDelivery = !!shipment && shipment.hasDelivery === false;
  const missingParcels = !!shipment && (shipment.parcels == null || shipment.weightKg == null);
  const costDecided = !!rr?.costBearer;

  return {
    shipment,
    activeAwb: active,
    homePickup,
    hasAddress,
    costDecided,
    // decizia de cost: blocată cât există un AWB activ (ca pe server)
    canSetCost: eligibleStatus || ["NEW", "IN_REVIEW"].includes(rr?.status) ? !active : false,
    canCreateShipment: approved && homePickup && hasAddress && !shipment,
    createShipmentBlocker: !shipment
      ? !approved
        ? "Cererea trebuie acceptată înainte de pregătirea coletului."
        : !homePickup
          ? "Clientul nu a ales ridicarea de la adresă."
          : !hasAddress
            ? "Clientul nu a confirmat încă adresa de ridicare."
            : null
      : null,
    missingDelivery,
    missingParcels,
    canComplete: !!shipment && !active && (missingDelivery || missingParcels),
    canPreview: !!shipment && !active && eligibleStatus && !missingDelivery && !missingParcels,
    // generarea: doar fără AWB activ, cu cost decis și cu previzualizarea fără blockere
    canGenerate:
      !!shipment &&
      !active &&
      eligibleStatus &&
      costDecided &&
      preHandover &&
      !missingDelivery &&
      !missingParcels &&
      !!preview?.canCreate &&
      preview?.awbLiveEnabled !== false,
    canRecover: active?.status === "UNKNOWN",
    awbInProgress: active?.status === "REQUESTED",
    canCancel: active?.status === "CREATED" && !active.cancelState && preHandover,
    cancelState: active?.status === "CREATED" ? active.cancelState || null : null,
    canDownloadLabel: active?.status === "CREATED" && !active.cancelState,
  };
}

/** Cheie de idempotență pentru O încercare de generare (retrimiterea folosește aceeași). */
export function newIdempotencyKey(prefix = "admin-return") {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${rand}`;
}

export const NOTICE_STATE_LABELS = Object.freeze({
  PENDING: "în așteptare",
  SENDING: "se trimite",
  RETRY: "reîncercare programată",
  SENT: "trimis",
  UNCERTAIN: "incert (poate fi trimis)",
  FAILED: "eșuat",
  SKIPPED: "fără destinatar / nenecesar",
  SUPERSEDED: "anulat înainte de trimitere",
});

export const AWB_STATUS_LABELS = Object.freeze({
  REQUESTED: "În curs de generare",
  CREATED: "Confirmat de Sameday",
  UNKNOWN: "Neconfirmat - necesită verificare",
  FAILED: "Eșuat",
  CANCELLED: "Anulat",
});
