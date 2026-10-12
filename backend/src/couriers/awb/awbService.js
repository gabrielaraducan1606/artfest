// backend/src/couriers/awb/awbService.js

import crypto from "node:crypto";
import { prisma as defaultDb } from "../../db.js";
import { getCourierProvider } from "../registry.js";
import { openCredentials } from "../credentials/store.js";
import {
  CourierAuthError,
  CourierError,
  CourierValidationError,
  isCourierError,
} from "../errors.js";
import { computeVendorOrderPaymentState } from "../../services/vendorOrderPaymentState.js";
import { computeShipmentCodAmount } from "./codAmount.js";
import { buildRecipient, buildSender } from "./addresses.js";
import { resolveParcels } from "./parcels.js";

/*
 * Generare AWB pentru UN Shipment (sub-comanda unui vendor).
 *
 * IDEMPOTENȚĂ (model CourierAwb):
 *  1. rezervare: se creează CourierAwb { status: REQUESTED,
 *     activeShipmentId: shipmentId } - activeShipmentId e @unique, deci
 *     Postgres garantează MAXIM un AWB activ per Shipment, pe orice
 *     instanță. O a doua cerere (dublu click, alt tab) primește 409.
 *  2. apelul către curier se face în AFARA oricărei tranzacții;
 *  3. succes -> CREATED + Shipment actualizat (o tranzacție scurtă);
 *     eșec SIGUR (credentiale / date respinse) -> FAILED, activeShipmentId
 *     = null => se poate reîncerca;
 *     rezultat NECUNOSCUT (timeout / 5xx după trimitere) -> UNKNOWN,
 *     blocajul rămâne => nu se poate crea automat al doilea AWB.
 *  Header-ul Idempotency-Key (hash cu vendorId) face ca retrimiterea
 *  aceleiași cereri să întoarcă același rezultat, fără alt apel la curier.
 *
 *  REQUESTED mai vechi de STALE_REQUESTED_MS (ex. serverul a repornit în
 *  timpul apelului) devine UNKNOWN - blocajul rămâne, dar adminul îl poate
 *  rezolva după verificarea în contul curierului (resolveUnknownAwb):
 *  „AWB nu există” -> FAILED (eliberează expedierea) sau „AWB există” ->
 *  CREATED cu numărul confirmat. Fiecare tranziție manuală / de sistem e
 *  păstrată în providerMeta.audit (cine, când, ce).
 *
 *  Anulare (cancelAwbForShipment): doar înainte de predarea coletului, doar
 *  după confirmarea curierului; un refuz al curierului NU schimbă starea.
 *
 * NU se schimbă statusurile comenzii / Shipment-ului și nimic financiar.
 */

const ELIGIBLE_SHIPMENT_STATUSES = new Set([
  "PENDING",
  "PREPARING",
  "READY_FOR_PICKUP",
  "PICKUP_SCHEDULED",
]);

const ACTIVE_AWB_STATUSES = new Set(["REQUESTED", "CREATED", "UNKNOWN"]);

// cel mai lung apel posibil la curier e ~40s (autentificare + creare, cu o
// reautentificare la 401, câte 10s fiecare) - 2 minute înseamnă sigur abandon
export const STALE_REQUESTED_MS = 2 * 60 * 1000;

const STALE_REQUESTED_MESSAGE =
  "Generarea nu s-a finalizat (întreruptă). Verificăm la curier dacă AWB-ul a fost creat înainte de a permite o nouă încercare.";

// AWB-ul se poate anula doar cât coletul NU a fost predat curierului
const CANCELLABLE_SHIPMENT_STATUSES = ELIGIBLE_SHIPMENT_STATUSES;

const AWB_NUMBER_INPUT_RE = /^[A-Za-z0-9-]{4,60}$/;

export function isStaleRequested(row, now = Date.now()) {
  return (
    !!row &&
    row.status === "REQUESTED" &&
    now - new Date(row.createdAt).getTime() >= STALE_REQUESTED_MS
  );
}

/*
 * Istoricul acțiunilor (sistem / vendor / admin) pe un CourierAwb, în
 * providerMeta.audit - fără câmpuri noi în schema. Doar id-uri, acțiune,
 * moment și nota adminului; niciodată date de autentificare.
 */
function withAudit(meta, entry) {
  const base = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
  const audit = Array.isArray(base.audit) ? base.audit : [];
  return { ...base, audit: [...audit, { ...entry, at: new Date().toISOString() }].slice(-50) };
}

/**
 * REQUESTED vechi -> UNKNOWN (condiționat, deci sigur la concurență).
 * Întoarce rândul actualizat (sau neschimbat).
 */
export async function expireStaleRequested(db, row) {
  if (!isStaleRequested(row)) return row;

  await db.courierAwb.updateMany({
    where: { id: row.id, status: "REQUESTED" },
    data: {
      status: "UNKNOWN",
      errorMessage: STALE_REQUESTED_MESSAGE,
      providerMeta: withAudit(row.providerMeta, {
        action: "stale_requested_to_unknown",
        actor: "system",
      }),
    },
  });

  return db.courierAwb.findUnique({ where: { id: row.id } });
}

// AWB-ul activ (REQUESTED / CREATED / UNKNOWN) al unei expedieri, sau null
export async function findActiveCourierAwb(db, shipmentId) {
  const row = await db.courierAwb.findUnique({ where: { activeShipmentId: String(shipmentId) } });
  return expireStaleRequested(db, row);
}

/*
 * Setarea MANUALĂ a AWB-ului / curierului de către admin nu are voie să
 * suprascrie un AWB generat prin integrare care e încă activ (altfel
 * Shipment.awb și CourierAwb ar indica AWB-uri diferite, iar eticheta /
 * anularea ar acționa pe alt colet).
 */
export async function assertNoActiveCourierAwb(db, shipmentId) {
  const active = await findActiveCourierAwb(db, shipmentId);
  if (!active) return;
  const err = new CourierError(
    "courier_awb_active",
    active.status === "CREATED"
      ? `Expedierea are AWB-ul ${active.awbNumber} generat prin integrarea de curier. Nu poate fi suprascris manual; anulează-l mai întâi.`
      : "Expedierea are o generare de AWB prin integrarea de curier încă nerezolvată. Rezolv-o înainte de a seta manual un AWB.",
    { httpStatus: 409 }
  );
  err.activeAwb = { id: active.id, status: active.status, awbNumber: active.awbNumber || null };
  throw err;
}

export class AwbNotFoundError extends CourierError {
  constructor() {
    super("shipment_not_found", "Expedierea nu a fost găsită.", { httpStatus: 404 });
  }
}

export class AwbBlockedError extends CourierError {
  constructor(blockers, preview = null) {
    super("awb_blocked", "AWB-ul nu poate fi generat până nu rezolvi problemele indicate.", {
      httpStatus: 422,
    });
    this.blockers = blockers;
    this.preview = preview;
  }
}

class AwbConflictError extends CourierError {
  constructor(code, message) {
    super(code, message, { httpStatus: 409 });
  }
}

function blocker(code, message, field) {
  return { code, message, ...(field ? { field } : {}) };
}

function labelPath(shipmentId) {
  return `/api/vendor/shipments/${encodeURIComponent(shipmentId)}/label`;
}

function clientReferenceFor(order, shipment) {
  return `ART-${order.orderNumber || order.id}-${String(shipment.id).slice(-8)}`.slice(0, 160);
}

// cheie de idempotență namespaced pe vendor (hash - încape în VarChar(100))
export function namespacedIdempotencyKey(vendorId, rawKey) {
  const key = String(rawKey || "").trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) {
    throw new CourierValidationError("Cheia de idempotență lipsește sau este invalidă.", ["Idempotency-Key"]);
  }
  return crypto.createHash("sha256").update(`${vendorId}:${key}`).digest("hex");
}

export function toPublicAwb(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    awbNumber: row.awbNumber || null,
    courierService: row.courierService || null,
    codAmount: row.codAmount != null ? Number(row.codAmount) : 0,
    weightKg: row.weightKg != null ? Number(row.weightKg) : null,
    parcels: Array.isArray(row.parcels) ? row.parcels.length : null,
    errorMessage: row.errorMessage || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadShipment(db, vendorId, shipmentId) {
  const shipment = await db.shipment.findFirst({
    where: { id: String(shipmentId || ""), vendorId },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentMethod: true,
          currency: true,
          userId: true,
          isGuestOrder: true,
          stripeCheckoutSessionId: true,
          stripePaymentIntentId: true,
          paidAt: true,
          shippingAddress: true,
          contactPerson: true,
          customerName: true,
          customerPhone: true,
          customerEmail: true,
        },
      },
      items: { select: { price: true, qty: true } },
    },
  });
  if (!shipment || !shipment.order) throw new AwbNotFoundError();
  return shipment;
}

// conturile vendorului care pot genera AWB (provider cu createShipment)
async function listAwbCapableAccounts(db, vendorId) {
  const rows = await db.courierAccount.findMany({
    where: { vendorId, ownerType: "VENDOR", disabledAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.filter((a) => {
    try {
      return !!getCourierProvider(a.provider).capabilities?.createShipment;
    } catch {
      return false;
    }
  });
}

function pickAccount(accounts, requestedId) {
  if (requestedId) return accounts.find((a) => a.id === String(requestedId)) || null;
  return accounts.find((a) => a.isDefault && a.status === "ACTIVE") ||
    accounts.find((a) => a.status === "ACTIVE") ||
    accounts[0] ||
    null;
}

async function resolvePickupAddress(db, vendorId, account) {
  if (account?.pickupAddressId) {
    const own = await db.vendorPickupAddress.findFirst({
      where: { id: account.pickupAddressId, vendorId },
    });
    if (own) return own;
  }
  return db.vendorPickupAddress.findFirst({
    where: { vendorId, isDefault: true },
  });
}

function pickService(services, requestedId, method) {
  if (requestedId != null && requestedId !== "") {
    return services.find((s) => String(s.id) === String(requestedId)) || null;
  }
  if (method === "LOCKER") {
    const locker = services.find((s) => String(s.code || "").toUpperCase() === "LN");
    if (locker) return locker;
  }
  return (
    services.find((s) => s.isDefault) ||
    services.find((s) => String(s.code || "") === "24") ||
    services[0] ||
    null
  );
}

function pickPickupPoint(points, preferredId) {
  if (preferredId != null && preferredId !== "") {
    return points.find((p) => String(p.id) === String(preferredId)) || null;
  }
  return points.find((p) => p.isDefault) || (points.length === 1 ? points[0] : null);
}

function describeActiveAwb(active, shipment) {
  if (active) {
    if (active.status === "CREATED") {
      return blocker("awb_exists", `Există deja AWB-ul ${active.awbNumber} pentru această expediere.`);
    }
    if (active.status === "REQUESTED") {
      return blocker("awb_in_progress", "Un AWB este deja în curs de generare pentru această expediere.");
    }
    return blocker(
      "awb_status_unknown",
      "Ultima generare nu a primit confirmare de la curier. Verificăm dacă AWB-ul a fost creat înainte de a permite o nouă încercare."
    );
  }
  if (shipment.awb) {
    return blocker("awb_exists", `Există deja AWB-ul ${shipment.awb} pentru această expediere.`);
  }
  return null;
}

/**
 * Construiește previzualizarea + contextul intern pentru creare.
 * NU creează nimic. Apelează curierul doar pentru citiri (servicii,
 * puncte de ridicare).
 */
export async function buildAwbPlan(
  { vendorId, shipmentId, input = {}, liveMode = "always" },
  db = defaultDb
) {
  const shipment = await loadShipment(db, vendorId, shipmentId);
  const order = shipment.order;
  const blockers = [];

  /* ----- eligibilitate ----- */
  if (shipment.direction !== "OUTBOUND") {
    blockers.push(blocker("return_shipment", "AWB-ul de retur nu se generează din această secțiune."));
  }
  if (String(order.status) === "CANCELLED") {
    blockers.push(blocker("order_cancelled", "Comanda este anulată."));
  }
  // expediată fără integrare (couriers/manualShipment.js): fără AWB retroactiv
  if (shipment.manualShipment) {
    blockers.push(
      blocker("manual_shipment", "Expedierea a fost trimisă fără integrare de curier; nu se generează AWB ulterior.")
    );
  }
  if (!ELIGIBLE_SHIPMENT_STATUSES.has(String(shipment.status))) {
    blockers.push(blocker("shipment_status", "Expedierea nu mai este într-o etapă în care se poate genera AWB."));
  }

  const active = await findActiveCourierAwb(db, shipment.id);
  const activeBlocker = describeActiveAwb(active, shipment);
  if (activeBlocker) blockers.push(activeBlocker);

  const payment = computeVendorOrderPaymentState(order);
  if (payment.waitingForCardPayment) {
    blockers.push(
      blocker("card_payment_pending", "Clientul nu a finalizat încă plata cu cardul. AWB-ul poate fi generat după confirmarea plății.")
    );
  }
  if (String(shipment.depositStatus || "") === "PENDING") {
    blockers.push(blocker("deposit_pending", "Clientul nu a plătit încă avansul cerut."));
  }

  const currency = String(order.currency || "RON").toUpperCase();
  if (currency !== "RON") {
    blockers.push(blocker("currency_unsupported", "Momentan AWB-ul se poate genera doar pentru comenzi în RON."));
  }

  const method = shipment.method === "LOCKER" ? "LOCKER" : "COURIER";
  if (method === "LOCKER" && !shipment.lockerId) {
    blockers.push(blocker("locker_missing", "Comanda e cu livrare la locker, dar lockerul nu este specificat."));
  }

  /* ----- COD (server-side) ----- */
  const cod = computeShipmentCodAmount(order, shipment);
  if (cod.productsTotal <= 0) {
    blockers.push(blocker("shipment_empty", "Expedierea nu conține produse valide."));
  }

  /* ----- destinatar / colete ----- */
  const { recipient, blockers: recipientBlockers } = buildRecipient(order);
  blockers.push(...recipientBlockers);

  const parcels = resolveParcels(shipment, input);
  blockers.push(...parcels.blockers);

  /* ----- cont de curier ----- */
  const accounts = await listAwbCapableAccounts(db, vendorId);
  const account = pickAccount(accounts, input.courierAccountId);
  let def = null;
  let ctx = null;

  if (!account) {
    blockers.push(
      blocker(
        input.courierAccountId ? "courier_account_not_found" : "no_courier_account",
        input.courierAccountId
          ? "Contul de curier selectat nu a fost găsit."
          : "Conectează un cont de curier în Setări > Livrare și retururi.",
        "courierAccountId"
      )
    );
  } else if (account.status !== "ACTIVE") {
    blockers.push(
      blocker(
        "courier_account_inactive",
        "Contul de curier nu este activ. Testează conexiunea sau reintrodu credentialele în Setări.",
        "courierAccountId"
      )
    );
  } else {
    def = getCourierProvider(account.provider);
    try {
      ctx = {
        accountId: account.id,
        credentials: openCredentials(account),
        publicConfig: account.publicConfig || {},
      };
    } catch (e) {
      blockers.push(
        blocker(
          isCourierError(e) ? e.code : "courier_credentials_unreadable",
          isCourierError(e) ? e.message : "Datele de conectare ale curierului nu pot fi folosite.",
          "courierAccountId"
        )
      );
    }
  }

  /* ----- expeditor ----- */
  const pickupAddress = account ? await resolvePickupAddress(db, vendorId, account) : null;
  const { sender, blockers: senderBlockers } = buildSender(pickupAddress);
  if (account) blockers.push(...senderBlockers);

  /* ----- date live de la curier (doar citiri) -----
   * liveMode "ifNoBlockers" (la creare): cu blockere locale (adresă,
   * greutate, plată...) curierul NU e contactat deloc. */
  let services = [];
  let service = null;
  let pickupPoints = [];
  let pickupPoint = null;

  const contactCourier = def && ctx && (liveMode === "always" || blockers.length === 0);

  if (contactCourier) {
    try {
      [services, pickupPoints] = await Promise.all([
        def.listServices(ctx),
        def.listPickupPoints(ctx),
      ]);

      service = pickService(services, input.serviceId, method);
      if (!services.length) {
        blockers.push(blocker("service_unavailable", "Contul de curier nu are servicii de livrare disponibile.", "serviceId"));
      } else if (!service) {
        blockers.push(blocker("service_invalid", "Serviciul de livrare selectat nu este disponibil.", "serviceId"));
      }

      const preferredPoint =
        pickupAddress?.providerRefs?.[account.provider]?.pickupPointId ??
        account.publicConfig?.pickupPointId ??
        null;
      pickupPoint = pickPickupPoint(pickupPoints, preferredPoint);
      if (!pickupPoint) {
        blockers.push(
          blocker(
            "pickup_point_missing",
            pickupPoints.length
              ? "Contul de curier are mai multe puncte de ridicare și niciunul nu e implicit. Setează un punct implicit în contul curierului."
              : "Contul de curier nu are niciun punct de ridicare configurat."
          )
        );
      }
    } catch (e) {
      if (e instanceof CourierAuthError) {
        blockers.push(blocker("courier_auth_failed", e.message, "courierAccountId"));
      } else {
        blockers.push(
          blocker(
            "courier_unreachable",
            isCourierError(e) ? e.message : "Nu am putut contacta curierul. Încearcă din nou."
          )
        );
      }
    }
  }

  const clientReference = clientReferenceFor(order, shipment);
  const observation = String(order.shippingAddress?.notes || "").replace(/\s+/g, " ").trim().slice(0, 200) || null;

  const preview = {
    shipmentId: shipment.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    method,
    lockerId: shipment.lockerId || null,
    currency,
    paymentMethod: payment.paymentMethod,
    courier: account
      ? { accountId: account.id, provider: account.provider, label: account.label, status: account.status }
      : null,
    accounts: accounts.map((a) => ({
      id: a.id,
      provider: a.provider,
      label: a.label,
      status: a.status,
      isDefault: !!a.isDefault,
    })),
    sender,
    recipient,
    deliveryAddress: [recipient.address, recipient.city, recipient.county, recipient.postalCode]
      .filter(Boolean)
      .join(", "),
    services,
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? null,
    pickupPoint: pickupPoint ? { id: pickupPoint.id, alias: pickupPoint.alias } : null,
    parcels: parcels.parcels,
    weightKg: parcels.weightKg,
    lengthCm: parcels.lengthCm,
    widthCm: parcels.widthCm,
    heightCm: parcels.heightCm,
    declaredValue: null,
    codAmount: cod.codAmount,
    cod,
    clientReference,
    existingAwb: toPublicAwb(active) || (shipment.awb ? { status: "CREATED", awbNumber: shipment.awb } : null),
    blockers,
    canCreate: blockers.length === 0,
  };

  return {
    preview,
    internal: {
      shipment,
      order,
      account,
      def,
      ctx,
      service,
      pickupPoint,
      parcels,
      cod,
      recipient,
      clientReference,
      observation,
      method,
    },
  };
}

export async function previewAwb(args, db = defaultDb) {
  const { preview } = await buildAwbPlan(args, db);
  return preview;
}

function replayExisting(row) {
  if (row.status === "CREATED") return { replayed: true, awb: toPublicAwb(row) };
  if (row.status === "REQUESTED") {
    throw new AwbConflictError("awb_in_progress", "AWB-ul este în curs de generare.");
  }
  if (row.status === "UNKNOWN") {
    throw new AwbConflictError(
      "awb_status_unknown",
      "Curierul nu a confirmat încă rezultatul. Nu genera din nou până nu verificăm."
    );
  }
  const err = new CourierError("awb_failed", row.errorMessage || "Generarea AWB a eșuat.", { httpStatus: 422 });
  throw err;
}

function isUniqueViolation(e, field) {
  if (e?.code !== "P2002") return false;
  const target = e?.meta?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target || "");
  return text.includes(field);
}

/**
 * Creează AWB-ul. Vezi comentariul de la începutul fișierului pentru
 * garanțiile de idempotență.
 */
export async function createAwbForShipment(
  { vendorId, userId = null, shipmentId, input = {}, idempotencyKey },
  db = defaultDb
) {
  const key = namespacedIdempotencyKey(vendorId, idempotencyKey);

  // 0) retrimiterea aceleiași cereri -> același rezultat
  const previous = await expireStaleRequested(
    db,
    await db.courierAwb.findUnique({ where: { idempotencyKey: key } })
  );
  if (previous) {
    if (previous.shipmentId !== String(shipmentId)) {
      throw new AwbConflictError("idempotency_key_conflict", "Cheia de idempotență a fost folosită pentru altă expediere.");
    }
    return replayExisting(previous);
  }

  // 1) validare completă (inclusiv citiri live de la curier)
  const { preview, internal } = await buildAwbPlan(
    { vendorId, shipmentId, input, liveMode: "ifNoBlockers" },
    db
  );
  if (preview.blockers.length) throw new AwbBlockedError(preview.blockers, preview);

  const { shipment, account, def, ctx, service, pickupPoint, parcels, cod, recipient, clientReference, observation } =
    internal;
  const serviceLabel = [service.name, service.code ? `(${service.code})` : ""].filter(Boolean).join(" ").slice(0, 120);

  // 2) rezervare atomică: maxim un AWB activ per Shipment
  let reservation;
  try {
    reservation = await db.$transaction(async (tx) => {
      const fresh = await tx.shipment.findUnique({
        where: { id: shipment.id },
        select: { awb: true, manualShipment: true },
      });
      if (fresh?.awb) throw new AwbConflictError("awb_exists", `Există deja AWB-ul ${fresh.awb}.`);
      if (fresh?.manualShipment) {
        throw new AwbConflictError("manual_shipment", "Expedierea a fost trimisă fără integrare de curier.");
      }

      return tx.courierAwb.create({
        data: {
          shipmentId: shipment.id,
          courierAccountId: account.id,
          provider: account.provider,
          status: "REQUESTED",
          activeShipmentId: shipment.id,
          idempotencyKey: key,
          clientReference,
          courierService: serviceLabel,
          parcels: parcels.list,
          weightKg: parcels.weightKg,
          codAmount: cod.codAmount,
          createdById: userId,
        },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e, "idempotencyKey")) {
      const row = await db.courierAwb.findUnique({ where: { idempotencyKey: key } });
      if (row) return replayExisting(row);
    }
    if (isUniqueViolation(e, "activeShipmentId")) {
      const row = await findActiveCourierAwb(db, shipment.id);
      if (row?.status === "CREATED") {
        throw new AwbConflictError("awb_exists", `Există deja AWB-ul ${row.awbNumber}.`);
      }
      if (row?.status === "UNKNOWN") {
        throw new AwbConflictError(
          "awb_status_unknown",
          "Curierul nu a confirmat încă rezultatul unei generări anterioare. Nu genera din nou până nu verificăm."
        );
      }
      throw new AwbConflictError("awb_in_progress", "Un AWB este deja în curs de generare pentru această expediere.");
    }
    throw e;
  }

  // 3) apelul către curier - în afara oricărei tranzacții
  let result;
  try {
    result = await def.createShipment(ctx, {
      clientReference,
      serviceId: service.id,
      pickupPointId: pickupPoint.id,
      parcels: parcels.list,
      codAmount: cod.codAmount,
      declaredValue: 0,
      recipient,
      lockerId: internal.method === "LOCKER" ? shipment.lockerId : null,
      observation,
    });
  } catch (e) {
    await recordFailure(db, reservation, account, e);
    throw e;
  }

  // 4) succes -> CREATED + Shipment (fără statusuri / nimic financiar)
  const providerMeta = { parcelNumbers: result.parcelNumbers || [], cost: result.cost ?? null };
  const trackingUrl = def.trackingUrl?.(result.awbNumber) || null;
  try {
    const [awbRow] = await db.$transaction([
      db.courierAwb.update({
        where: { id: reservation.id },
        data: { status: "CREATED", awbNumber: result.awbNumber, providerMeta, errorMessage: null },
      }),
      db.shipment.update({
        where: { id: shipment.id },
        data: {
          courierProvider: account.provider,
          courierService: serviceLabel,
          awb: result.awbNumber,
          labelUrl: labelPath(shipment.id),
          trackingUrl,
          parcels: parcels.parcels,
          weightKg: parcels.weightKg,
          lengthCm: parcels.lengthCm,
          widthCm: parcels.widthCm,
          heightCm: parcels.heightCm,
        },
      }),
    ]);
    return { replayed: false, awb: toPublicAwb(awbRow) };
  } catch (e) {
    // AWB-ul EXISTĂ la curier; blocajul rămâne (UNKNOWN), cu numărul salvat
    console.error("[awb] AWB creat la curier, dar salvarea a eșuat:", reservation.id, e?.code || e?.name || "Error");
    await db.courierAwb
      .update({
        where: { id: reservation.id },
        data: {
          status: "UNKNOWN",
          awbNumber: result.awbNumber,
          providerMeta,
          errorMessage: "AWB creat la curier, dar salvarea în Artfest nu s-a finalizat. Necesită verificare.",
        },
      })
      .catch(() => {});
    throw new CourierError(
      "awb_saved_partially",
      "AWB-ul a fost creat la curier, dar nu s-a salvat complet în Artfest. Nu îl genera din nou; contactează suportul.",
      { httpStatus: 500 }
    );
  }
}

async function recordFailure(db, reservation, account, e) {
  const definite = e instanceof CourierAuthError || e instanceof CourierValidationError;
  const message = isCourierError(e) ? e.message : "Eroare neașteptată la generarea AWB.";
  const providerMeta = {
    errorCode: isCourierError(e) ? e.code : "unexpected_error",
    ...(e?.providerStatus ? { providerStatus: e.providerStatus } : {}),
    ...(Array.isArray(e?.fields) && e.fields.length ? { fields: e.fields } : {}),
  };

  if (!isCourierError(e)) {
    console.error("[awb] eroare neașteptată la createShipment:", reservation.id, e?.name || "Error");
  }

  try {
    await db.courierAwb.update({
      where: { id: reservation.id },
      data: definite
        ? { status: "FAILED", activeShipmentId: null, errorMessage: message, providerMeta }
        : {
            status: "UNKNOWN",
            errorMessage:
              "Curierul nu a confirmat rezultatul (timeout sau eroare temporară). Verificăm înainte de o nouă încercare.",
            providerMeta,
          },
    });

    if (e instanceof CourierAuthError) {
      await db.courierAccount.update({
        where: { id: account.id },
        data: { status: "INVALID_CREDENTIALS", lastTestOk: false, lastTestedAt: new Date(), lastError: message },
      });
    }
  } catch (dbErr) {
    console.error("[awb] nu am putut salva rezultatul eșecului:", reservation.id, dbErr?.code || dbErr?.name || "Error");
  }

  if (!definite) {
    // rezultat necunoscut: nu lăsăm frontend-ul să reîncerce automat
    const unknown = new CourierError(
      "awb_status_unknown",
      "Curierul nu a confirmat generarea AWB (timeout sau eroare temporară). Nu genera din nou până nu verificăm.",
      { httpStatus: 504 }
    );
    throw unknown;
  }
}

/* ----- status AWB curent pentru UI ----- */
export async function getAwbStatus({ vendorId, shipmentId }, db = defaultDb) {
  const shipment = await db.shipment.findFirst({
    where: { id: String(shipmentId || ""), vendorId },
    select: {
      id: true,
      awb: true,
      courierProvider: true,
      courierService: true,
      labelUrl: true,
      trackingUrl: true,
      status: true,
      handedOverAt: true,
    },
  });
  if (!shipment) throw new AwbNotFoundError();

  const latest = await expireStaleRequested(
    db,
    await db.courierAwb.findFirst({
      where: { shipmentId: shipment.id },
      orderBy: { createdAt: "desc" },
    })
  );

  const active = latest && ACTIVE_AWB_STATUSES.has(latest.status) ? latest.status : null;
  // AWB generat din Artfest (eticheta prin ruta protejată), nu unul setat manual
  const artfestAwb =
    active === "CREATED" && !!latest.awbNumber && shipment.awb === latest.awbNumber;

  return {
    shipment: {
      id: shipment.id,
      awb: shipment.awb || null,
      courierProvider: shipment.courierProvider || null,
      courierService: shipment.courierService || null,
      hasLabel: !!shipment.labelUrl,
      artfestLabel: String(shipment.labelUrl || "").startsWith("/api/vendor/shipments/"),
      trackingUrl: shipment.trackingUrl || null,
    },
    latest: toPublicAwb(latest),
    active,
    // aceleași condiții locale ca în cancelAwbForShipment (curierul decide final)
    canCancel:
      artfestAwb && !shipment.handedOverAt && CANCELLABLE_SHIPMENT_STATUSES.has(String(shipment.status)),
  };
}

/**
 * Eticheta PDF pentru AWB-ul CREATED al Shipment-ului vendorului, descărcată
 * de la curier cu contul care l-a creat (fără stocare la noi).
 * @returns {Promise<{buffer:Buffer, contentType:string, awbNumber:string}|null>}
 *          null = nu există AWB generat de Artfest (fallback pe labelUrl manual)
 */
export async function getAwbLabel({ vendorId, shipmentId, format }, db = defaultDb) {
  const shipment = await db.shipment.findFirst({
    where: { id: String(shipmentId || ""), vendorId },
    select: { id: true, awb: true },
  });
  if (!shipment) throw new AwbNotFoundError();

  const row = await db.courierAwb.findFirst({
    where: { shipmentId: shipment.id, status: "CREATED" },
    orderBy: { createdAt: "desc" },
  });
  if (!row || !row.awbNumber) return null;

  const account = row.courierAccountId
    ? await db.courierAccount.findFirst({ where: { id: row.courierAccountId, vendorId } })
    : null;
  if (!account || account.disabledAt) {
    throw new CourierError(
      "courier_account_unavailable",
      "Contul de curier cu care a fost generat AWB-ul nu mai este conectat.",
      { httpStatus: 409 }
    );
  }

  const def = getCourierProvider(account.provider);
  const ctx = { accountId: account.id, credentials: openCredentials(account), publicConfig: account.publicConfig || {} };
  const label = await def.getLabel(ctx, row.awbNumber, { format });
  return { ...label, awbNumber: row.awbNumber };
}

/* ----- anulare AWB (vendor) ----- */

/**
 * Anulează AWB-ul CREATED al expedierii vendorului, DOAR înainte de
 * predarea coletului. Ordinea: verificări locale -> apel curier -> abia
 * după confirmare: CANCELLED + eliberare + golirea câmpurilor Shipment
 * care aparțin ACESTUI AWB. Orice eroare a curierului (refuz, timeout)
 * lasă starea locală neschimbată.
 */
export async function cancelAwbForShipment({ vendorId, userId = null, shipmentId }, db = defaultDb) {
  const shipment = await db.shipment.findFirst({
    where: { id: String(shipmentId || ""), vendorId },
    select: { id: true, status: true, handedOverAt: true, awb: true },
  });
  if (!shipment) throw new AwbNotFoundError();

  const row = await findActiveCourierAwb(db, shipment.id);
  if (!row || row.status !== "CREATED" || !row.awbNumber) {
    throw new AwbConflictError("awb_not_cancellable_state", "Nu există un AWB generat care să poată fi anulat.");
  }

  if (shipment.handedOverAt || !CANCELLABLE_SHIPMENT_STATUSES.has(String(shipment.status))) {
    throw new AwbConflictError(
      "awb_already_handed_over",
      "Coletul a fost deja predat curierului; AWB-ul nu mai poate fi anulat din Artfest."
    );
  }

  const account = row.courierAccountId
    ? await db.courierAccount.findFirst({ where: { id: row.courierAccountId, vendorId } })
    : null;
  if (!account || account.disabledAt) {
    throw new CourierError(
      "courier_account_unavailable",
      "Contul de curier cu care a fost generat AWB-ul nu mai este conectat.",
      { httpStatus: 409 }
    );
  }

  const def = getCourierProvider(account.provider);
  if (!def.capabilities?.cancelShipment || typeof def.cancelShipment !== "function") {
    throw new CourierError("cancel_not_supported", "Anularea AWB nu este disponibilă pentru acest curier.", {
      httpStatus: 409,
    });
  }

  const ctx = { accountId: account.id, credentials: openCredentials(account), publicConfig: account.publicConfig || {} };

  // refuz / timeout / indisponibil -> excepția urcă, nimic local nu se schimbă
  await def.cancelShipment(ctx, row.awbNumber);

  try {
    const awbRow = await db.$transaction(async (tx) => {
      const updated = await tx.courierAwb.update({
        where: { id: row.id },
        data: {
          status: "CANCELLED",
          activeShipmentId: null,
          providerMeta: withAudit(row.providerMeta, { action: "cancelled", actor: "vendor", userId }),
        },
      });
      // doar dacă Shipment-ul încă indică ACEST AWB
      await tx.shipment.updateMany({
        where: { id: shipment.id, awb: row.awbNumber },
        data: { awb: null, labelUrl: null, trackingUrl: null },
      });
      return updated;
    });
    return { awb: toPublicAwb(awbRow) };
  } catch (e) {
    // anulat la curier, dar nesalvat la noi: rămâne blocat (UNKNOWN) pentru verificare
    console.error("[awb] AWB anulat la curier, dar salvarea a eșuat:", row.id, e?.code || e?.name || "Error");
    await db.courierAwb
      .update({
        where: { id: row.id },
        data: {
          status: "UNKNOWN",
          errorMessage: "AWB anulat la curier, dar salvarea în Artfest nu s-a finalizat. Necesită verificare.",
          providerMeta: withAudit(row.providerMeta, { action: "cancel_saved_partially", actor: "vendor", userId }),
        },
      })
      .catch(() => {});
    throw new CourierError(
      "awb_cancel_saved_partially",
      "AWB-ul a fost anulat la curier, dar nu s-a salvat complet în Artfest. Contactează suportul.",
      { httpStatus: 500 }
    );
  }
}

/* ----- admin: vizualizare + rezolvarea AWB-urilor UNKNOWN ----- */

/**
 * Reprezentarea pentru admin (fără date de autentificare). Un REQUESTED
 * vechi apare ca UNKNOWN (stale: true) fără scriere în DB la citire.
 */
export function toAdminAwb(row, shipment = null) {
  if (!row) return null;
  const stale = isStaleRequested(row);
  const meta = row.providerMeta && typeof row.providerMeta === "object" ? row.providerMeta : {};
  const isCurrent = row.status === "CREATED" && !!row.awbNumber && shipment?.awb === row.awbNumber;
  return {
    ...toPublicAwb(row),
    status: stale ? "UNKNOWN" : row.status,
    stale,
    active: ACTIVE_AWB_STATUSES.has(row.status),
    trackingUrl: isCurrent ? shipment?.trackingUrl || null : null,
    cost: meta.cost ?? null,
    errorCode: meta.errorCode || null,
    audit: Array.isArray(meta.audit) ? meta.audit : [],
  };
}

class AwbAdminNotFoundError extends CourierError {
  constructor() {
    super("courier_awb_not_found", "AWB-ul nu a fost găsit pentru această expediere.", { httpStatus: 404 });
  }
}

/**
 * Rezolvare manuală (ADMIN) a unui AWB UNKNOWN, după verificarea în contul
 * curierului:
 *   outcome "FAILED"  -> AWB nu există: FAILED + eliberează expedierea;
 *   outcome "CREATED" -> AWB există: CREATED cu numărul confirmat + Shipment.
 * Auditat în providerMeta.audit (adminUserId, notă).
 */
export async function resolveUnknownAwb(
  { shipmentId, awbId, outcome, awbNumber, note, adminUserId },
  db = defaultDb
) {
  let row = await db.courierAwb.findFirst({
    where: { id: String(awbId || ""), shipmentId: String(shipmentId || "") },
  });
  if (!row) throw new AwbAdminNotFoundError();
  row = await expireStaleRequested(db, row);

  if (row.status !== "UNKNOWN") {
    throw new AwbConflictError("awb_not_unknown", "Doar un AWB cu status necunoscut (UNKNOWN) poate fi rezolvat manual.");
  }

  const cleanNote = String(note || "").replace(/\s+/g, " ").trim().slice(0, 500) || null;

  if (outcome === "FAILED") {
    const res = await db.courierAwb.updateMany({
      where: { id: row.id, status: "UNKNOWN" },
      data: {
        status: "FAILED",
        activeShipmentId: null,
        errorMessage: "Rezolvat de admin: AWB-ul nu există la curier.",
        providerMeta: withAudit(row.providerMeta, {
          action: "resolved_failed",
          actor: "admin",
          userId: adminUserId || null,
          note: cleanNote,
          previousAwbNumber: row.awbNumber || null,
        }),
      },
    });
    if (!res.count) throw new AwbConflictError("awb_changed", "AWB-ul a fost modificat între timp. Reîncarcă pagina.");
    console.info("[awb] admin resolve FAILED:", row.id, "admin:", adminUserId || "-");
    return { awb: toAdminAwb(await db.courierAwb.findUnique({ where: { id: row.id } })) };
  }

  if (outcome !== "CREATED") {
    throw new CourierValidationError("Alege rezultatul verificării: AWB există sau nu există.", ["outcome"]);
  }

  const number = String(awbNumber || "").trim();
  if (!AWB_NUMBER_INPUT_RE.test(number)) {
    throw new CourierValidationError("Numărul AWB nu este valid.", ["awbNumber"]);
  }
  if (row.awbNumber && row.awbNumber !== number) {
    throw new AwbConflictError(
      "awb_number_mismatch",
      `Curierul a raportat deja AWB-ul ${row.awbNumber} pentru această încercare; numărul introdus diferă.`
    );
  }

  const [dupAwb, dupShipment, shipment] = await Promise.all([
    db.courierAwb.findFirst({ where: { provider: row.provider, awbNumber: number, NOT: { id: row.id } }, select: { id: true } }),
    db.shipment.findFirst({ where: { awb: number, NOT: { id: row.shipmentId } }, select: { id: true } }),
    db.shipment.findUnique({ where: { id: row.shipmentId }, select: { id: true, awb: true } }),
  ]);
  if (dupAwb || dupShipment) {
    throw new AwbConflictError("awb_duplicate", "Acest număr AWB este deja asociat altei expedieri.");
  }
  if (!shipment) throw new AwbAdminNotFoundError();
  if (shipment.awb && shipment.awb !== number) {
    throw new AwbConflictError("shipment_has_other_awb", `Expedierea are deja AWB-ul ${shipment.awb}.`);
  }

  let def = null;
  try {
    def = getCourierProvider(row.provider);
  } catch {
    def = null;
  }
  const trackingUrl = def?.trackingUrl?.(number) || null;

  try {
    await db.$transaction(async (tx) => {
      const res = await tx.courierAwb.updateMany({
        where: { id: row.id, status: "UNKNOWN" },
        data: {
          status: "CREATED",
          awbNumber: number,
          errorMessage: null,
          providerMeta: withAudit(row.providerMeta, {
            action: "resolved_created",
            actor: "admin",
            userId: adminUserId || null,
            note: cleanNote,
            awbNumber: number,
          }),
        },
      });
      if (!res.count) throw new AwbConflictError("awb_changed", "AWB-ul a fost modificat între timp. Reîncarcă pagina.");

      await tx.shipment.update({
        where: { id: row.shipmentId },
        data: {
          courierProvider: row.provider,
          courierService: row.courierService || null,
          awb: number,
          labelUrl: labelPath(row.shipmentId),
          trackingUrl,
          ...(Array.isArray(row.parcels) && row.parcels.length ? { parcels: row.parcels.length } : {}),
          ...(row.weightKg != null ? { weightKg: row.weightKg } : {}),
        },
      });
    });
  } catch (e) {
    if (isUniqueViolation(e, "awbNumber")) {
      throw new AwbConflictError("awb_duplicate", "Acest număr AWB este deja asociat altei expedieri.");
    }
    throw e;
  }

  console.info("[awb] admin resolve CREATED:", row.id, "admin:", adminUserId || "-");
  const [updated, freshShipment] = await Promise.all([
    db.courierAwb.findUnique({ where: { id: row.id } }),
    db.shipment.findUnique({ where: { id: row.shipmentId }, select: { awb: true, trackingUrl: true } }),
  ]);
  return { awb: toAdminAwb(updated, freshShipment) };
}
