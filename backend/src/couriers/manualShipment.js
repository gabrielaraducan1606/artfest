// backend/src/couriers/manualShipment.js

import { findActiveCourierAwb } from "./awb/awbService.js";

/*
 * Expediere FĂRĂ integrare de curier („Trimite fără integrare”).
 *
 * Vendorul trimite coletul pe cont propriu și marchează expedierea ca
 * predată, cu date opționale (curier, AWB / tracking, link tracking) și data
 * expedierii. Folosit de PATCH /api/vendor/orders/:id/status cu
 * { status: "shipped", manualShipping: {...} } - restul efectelor (ledger,
 * notificare client, email) sunt cele ale fluxului existent „shipped”.
 *
 * Strict local:
 *   - NU creează CourierAwb și NU apelează niciun API de curier;
 *   - NU cere CourierAccount (funcționează și cu integrarea oprită);
 *   - NU atinge prețul transportului, totalurile, plata sau rambursul (COD);
 *   - NU suprascrie un AWB existent (al integrării sau setat de admin).
 */

// aceleași etape ca generarea AWB: înainte ca coletul să fie predat
export const MANUAL_SHIP_ELIGIBLE_STATUSES = new Set([
  "PENDING",
  "PREPARING",
  "READY_FOR_PICKUP",
  "PICKUP_SCHEDULED",
]);

export const MANUAL_COURIER_NAME_MAX = 80;
export const MANUAL_TRACKING_URL_MAX = 500;
const MANUAL_AWB_RE = /^[A-Za-z0-9-]{3,60}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
// data expedierii: azi sau în trecut (toleranță pentru fus orar), cel mult 60 de zile în urmă
const FUTURE_TOLERANCE_MS = DAY_MS;
const MAX_PAST_MS = 60 * DAY_MS;

export class ManualShipmentError extends Error {
  constructor(code, message, { httpStatus = 400, fields = null } = {}) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.fields = fields;
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "YYYY-MM-DD" (input type=date) -> prânz UTC, ca ziua să nu alunece la afișare
function parseShippedAt(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00.000Z`) : new Date(s);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/**
 * Validează câmpurile introduse de vendor. Toate opționale, cu excepția
 * datei (implicit: acum). Întoarce DOAR câmpurile permise - orice altceva
 * din body (preț, COD, adrese, status) e ignorat.
 */
export function parseManualShipmentInput(raw, { now = new Date() } = {}) {
  const input = raw && typeof raw === "object" ? raw : {};
  const errors = {};

  const courierName = cleanText(input.courierName);
  if (courierName.length > MANUAL_COURIER_NAME_MAX) {
    errors.courierName = `Numele curierului: maximum ${MANUAL_COURIER_NAME_MAX} de caractere.`;
  }

  const awb = String(input.awb ?? "").replace(/\s+/g, "").trim();
  if (awb && !MANUAL_AWB_RE.test(awb)) {
    errors.awb = "AWB / număr de urmărire: 3-60 caractere (litere, cifre, cratimă).";
  }

  let trackingUrl = String(input.trackingUrl ?? "").trim();
  if (trackingUrl) {
    let url = null;
    try {
      url = new URL(trackingUrl);
    } catch {
      url = null;
    }
    if (!url || !["http:", "https:"].includes(url.protocol) || trackingUrl.length > MANUAL_TRACKING_URL_MAX) {
      errors.trackingUrl = "Linkul de urmărire trebuie să fie o adresă http(s) validă.";
    } else {
      trackingUrl = url.toString();
    }
  }

  let shippedAt = parseShippedAt(input.shippedAt);
  if (shippedAt === undefined) {
    errors.shippedAt = "Data expedierii nu este validă.";
  } else if (shippedAt === null) {
    shippedAt = new Date(now);
  } else if (shippedAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    errors.shippedAt = "Data expedierii nu poate fi în viitor.";
  } else if (shippedAt.getTime() < now.getTime() - MAX_PAST_MS) {
    errors.shippedAt = "Data expedierii este prea veche (maximum 60 de zile în urmă).";
  }

  if (Object.keys(errors).length) {
    throw new ManualShipmentError("manual_shipping_invalid", Object.values(errors)[0], { fields: errors });
  }

  return {
    courierName: courierName || null,
    awb: awb || null,
    trackingUrl: trackingUrl || null,
    shippedAt,
  };
}

/**
 * Expedierea poate fi marcată manual? (fără scrieri, fără apeluri externe)
 * Un AWB al integrării (activ / în curs / neconfirmat) sau unul deja setat
 * blochează - altfel Shipment.awb și CourierAwb ar indica colete diferite.
 */
export async function assertManualShipmentAllowed(db, shipment) {
  if (!shipment) throw new ManualShipmentError("not_found", "Expedierea nu a fost găsită.", { httpStatus: 404 });
  if (shipment.direction && shipment.direction !== "OUTBOUND") {
    throw new ManualShipmentError("return_shipment", "Returul nu se expediază din această secțiune.", { httpStatus: 409 });
  }
  if (String(shipment.order?.status || "") === "CANCELLED") {
    throw new ManualShipmentError("order_cancelled", "Comanda este anulată.", { httpStatus: 409 });
  }
  if (shipment.manualShipment || !MANUAL_SHIP_ELIGIBLE_STATUSES.has(String(shipment.status))) {
    throw new ManualShipmentError(
      "shipment_status",
      "Expedierea a fost deja predată sau nu mai este într-o etapă în care poate fi expediată.",
      { httpStatus: 409 }
    );
  }
  const active = await findActiveCourierAwb(db, shipment.id);
  if (active || shipment.awb) {
    throw new ManualShipmentError(
      "courier_awb_active",
      active && active.status !== "CREATED"
        ? "Există o generare de AWB prin integrarea de curier încă nerezolvată. Nu poți marca expedierea manual."
        : `Expedierea are deja AWB-ul ${active?.awbNumber || shipment.awb}. Folosește „Predată curierului”.`,
      { httpStatus: 409 }
    );
  }
}

/**
 * Câmpurile scrise pe Shipment. DOAR status + datele de livrare introduse
 * de vendor - nimic financiar (price, COD, avans), nicio etichetă.
 */
export function manualShipmentUpdateData(input, { userId = null } = {}) {
  return {
    status: "IN_TRANSIT",
    manualShipment: true,
    handedOverAt: input.shippedAt,
    ...(userId ? { handedOverById: userId } : {}),
    courierProvider: input.courierName,
    courierService: null,
    awb: input.awb,
    trackingUrl: input.trackingUrl,
  };
}

const MANUAL_CONFLICT_MESSAGE = "Expedierea a fost deja predată sau are un AWB în curs. Reîncarcă pagina.";

/**
 * Scrierea (în tranzacția rutei de status): condiționată, o singură dată,
 * doar înainte de predare, fără AWB existent / generare activă a
 * integrării. Nu creează nimic în CourierAwb.
 */
export async function applyManualShipment(tx, shipmentId, input, { userId = null } = {}) {
  const activeAwb = await tx.courierAwb.findUnique({
    where: { activeShipmentId: String(shipmentId) },
    select: { id: true },
  });
  if (activeAwb) throw new ManualShipmentError("manual_shipment_conflict", MANUAL_CONFLICT_MESSAGE, { httpStatus: 409 });

  const updated = await tx.shipment.updateMany({
    where: {
      id: String(shipmentId),
      manualShipment: false,
      awb: null,
      status: { in: [...MANUAL_SHIP_ELIGIBLE_STATUSES] },
    },
    data: manualShipmentUpdateData(input, { userId }),
  });
  if (updated.count !== 1) {
    throw new ManualShipmentError("manual_shipment_conflict", MANUAL_CONFLICT_MESSAGE, { httpStatus: 409 });
  }
}

/* ----- preferința „Continuă fără integrare” (per vendor) ----- */

export async function getCourierPromptPreference(db, vendorId) {
  const vendor = await db.vendor.findUnique({
    where: { id: String(vendorId) },
    select: { courierPromptDismissedAt: true },
  });
  return {
    courierPromptDismissed: !!vendor?.courierPromptDismissedAt,
    courierPromptDismissedAt: vendor?.courierPromptDismissedAt || null,
  };
}

export async function dismissCourierPrompt(db, vendorId, now = new Date()) {
  // idempotent: păstrează prima dată a alegerii
  await db.vendor.updateMany({
    where: { id: String(vendorId), courierPromptDismissedAt: null },
    data: { courierPromptDismissedAt: now },
  });
  return getCourierPromptPreference(db, vendorId);
}
