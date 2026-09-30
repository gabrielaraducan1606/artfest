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
 * NU se schimbă statusurile comenzii / Shipment-ului și nimic financiar.
 */

const ELIGIBLE_SHIPMENT_STATUSES = new Set([
  "PENDING",
  "PREPARING",
  "READY_FOR_PICKUP",
  "PICKUP_SCHEDULED",
]);

const ACTIVE_AWB_STATUSES = new Set(["REQUESTED", "CREATED", "UNKNOWN"]);

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
  if (!ELIGIBLE_SHIPMENT_STATUSES.has(String(shipment.status))) {
    blockers.push(blocker("shipment_status", "Expedierea nu mai este într-o etapă în care se poate genera AWB."));
  }

  const active = await db.courierAwb.findUnique({ where: { activeShipmentId: shipment.id } });
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
  const previous = await db.courierAwb.findUnique({ where: { idempotencyKey: key } });
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
      const fresh = await tx.shipment.findUnique({ where: { id: shipment.id }, select: { awb: true } });
      if (fresh?.awb) throw new AwbConflictError("awb_exists", `Există deja AWB-ul ${fresh.awb}.`);

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
      const row = await db.courierAwb.findUnique({ where: { activeShipmentId: shipment.id } });
      throw row?.status === "CREATED"
        ? new AwbConflictError("awb_exists", `Există deja AWB-ul ${row.awbNumber}.`)
        : new AwbConflictError("awb_in_progress", "Un AWB este deja în curs de generare pentru această expediere.");
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
    select: { id: true, awb: true, courierProvider: true, courierService: true, labelUrl: true, trackingUrl: true },
  });
  if (!shipment) throw new AwbNotFoundError();

  const latest = await db.courierAwb.findFirst({
    where: { shipmentId: shipment.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    shipment: {
      id: shipment.id,
      awb: shipment.awb || null,
      courierProvider: shipment.courierProvider || null,
      courierService: shipment.courierService || null,
      hasLabel: !!shipment.labelUrl,
      trackingUrl: shipment.trackingUrl || null,
    },
    latest: toPublicAwb(latest),
    active: latest && ACTIVE_AWB_STATUSES.has(latest.status) ? latest.status : null,
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
