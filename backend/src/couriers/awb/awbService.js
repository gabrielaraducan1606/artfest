// backend/src/couriers/awb/awbService.js

import crypto from "node:crypto";
import { prisma as defaultDb } from "../../db.js";
import { getCourierProvider } from "../registry.js";
import { openCredentials } from "../credentials/store.js";
import {
  CourierAuthError,
  CourierError,
  CourierTimeoutError,
  CourierValidationError,
  isCourierError,
} from "../errors.js";
import { computeVendorOrderPaymentState } from "../../services/vendorOrderPaymentState.js";
import { computeShipmentCodAmount } from "./codAmount.js";
import { buildRecipient, buildPickupParty } from "./addresses.js";
import { resolveParcels } from "./parcels.js";
import {
  PLATFORM_SETUP_MESSAGES,
  findPlatformCourierAccount,
  platformConfig,
  platformSetupIssue,
} from "../platformAccount.js";

/*
 * Generare AWB pentru UN Shipment (sub-comanda unui vendor).
 *
 * CURIERAT CENTRALIZAT: contul de curier e al Artfest (CourierAccount
 * PLATFORM, vezi couriers/platformAccount.js). Vendorul e verificat ca
 * proprietar al Shipment-ului; credentialele / contractul NU sunt ale lui.
 * Coletul e ridicat de la adresa de ridicare a vendorului (din DB) -
 * Sameday thirdPartyPickup = 1. Fără cont PLATFORM configurat (credentiale,
 * pickupPoint contractual) curierul NU e contactat și generarea e blocată
 * cu mesajul configurării lipsă - niciodată un AWB simulat.
 *
 * Livrare: doar la adresă (serviciul 24H). Lockere / PUDO / Locker2Locker nu
 * sunt implementate - expedierile LOCKER sunt blocate cu mesaj clar.
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
 *  clientInternalReference STABIL: ARTFEST-SHIPMENT-<shipmentId> (cu sufix
 *  -R<n> doar după n AWB-uri anulate - un AWB anulat păstrează referința).
 *  Timeout / răspuns pierdut la POST /api/awb -> ÎNAINTE de orice altă
 *  încercare întrebăm Sameday (GET /api/client/awb/{referință}): găsit ->
 *  CREATED cu numărul real; negăsit -> UNKNOWN, eliberat doar de
 *  recoverUnknownAwb după RECOVERY_MIN_AGE_MS (tot după o verificare).
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

/*
 * Referința trimisă curierului (clientInternalReference): stabilă și unică
 * per expediere. Un AWB anulat păstrează referința lui la Sameday, deci
 * după n anulări referința primește sufixul -R<n>.
 */
export function clientReferenceFor(shipmentId, cancelledCount = 0) {
  const base = `ARTFEST-SHIPMENT-${shipmentId}`;
  return (cancelledCount > 0 ? `${base}-R${cancelledCount}` : base).slice(0, 160);
}

// un UNKNOWN fără AWB la Sameday se eliberează doar după acest interval
export const RECOVERY_MIN_AGE_MS = 2 * 60 * 1000;

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

/*
 * Contul cu care a fost generat un AWB (etichetă / anulare): contul Artfest
 * (PLATFORM) sau - pentru AWB-urile vechi - contul propriu al vendorului.
 * Proprietatea asupra Shipment-ului e verificată înainte de apel.
 */
function findAwbAccount(db, row, vendorId) {
  if (!row?.courierAccountId) return null;
  return db.courierAccount.findFirst({
    where: {
      id: row.courierAccountId,
      OR: [{ vendorId }, { ownerType: "PLATFORM", vendorId: null }],
    },
  });
}

// serviciul 24H (livrare la adresă) - ID 7 în doc v3.6, „Services”
export const HOME_DELIVERY_SERVICE_ID = "7";

/*
 * Serviciul de livrare la adresă, ales DOAR dintre serviciile active ale
 * contului (GET /api/client/services): cel configurat (publicConfig.serviceId)
 * sau, implicit, 24H (ID 7 conform documentației). Fără „primul serviciu” /
 * „implicitul contului” - ar putea fi locker / retur.
 */
function pickHomeDeliveryService(services, configuredId) {
  const wanted = configuredId || HOME_DELIVERY_SERVICE_ID;
  return services.find((s) => String(s.id) === String(wanted)) || null;
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

// datele de ridicare ale vendorului - EXCLUSIV din DB (adresa implicită)
async function loadPickupParty(db, vendorId) {
  const [vendor, billing, pickup] = await Promise.all([
    db.vendor.findUnique({ where: { id: vendorId }, select: { id: true, displayName: true } }),
    db.vendorBilling.findUnique({
      where: { vendorId },
      select: { legalType: true, companyName: true, cui: true, regCom: true },
    }),
    db.vendorPickupAddress.findFirst({
      where: { vendorId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
  ]);
  return buildPickupParty({ vendor, billing, pickup });
}

function paymentSummary(paymentMethod, codAmount) {
  return paymentMethod === "COD"
    ? { type: "COD", label: "Ramburs", codAmount }
    : { type: "PAID", label: "Achitat online", codAmount: 0 };
}

/**
 * Construiește previzualizarea + contextul intern pentru creare.
 * NU creează nimic. Apelează curierul doar pentru citiri (servicii,
 * puncte de ridicare).
 */
export async function buildAwbPlan({ vendorId, shipmentId, input = {}, liveMode = "always" }, db = defaultDb) {
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

  // doar livrare la adresă în această etapă (fără easybox / PUDO)
  const method = shipment.method === "LOCKER" ? "LOCKER" : "COURIER";
  if (method === "LOCKER") {
    blockers.push(
      blocker(
        "locker_not_supported",
        "Livrarea la easybox nu este încă disponibilă pentru AWB generat din Artfest. Poți trimite comanda fără integrare."
      )
    );
  }

  /* ----- COD (server-side) ----- */
  const cod = computeShipmentCodAmount(order, shipment);
  if (cod.productsTotal <= 0) {
    blockers.push(blocker("shipment_empty", "Expedierea nu conține produse valide."));
  }

  /* ----- ridicare (vendor, din DB) / destinatar (comandă) / colete ----- */
  const { party: pickupParty, blockers: pickupBlockers } = await loadPickupParty(db, vendorId);
  blockers.push(...pickupBlockers);

  const { recipient, blockers: recipientBlockers } = buildRecipient(order);
  blockers.push(...recipientBlockers);

  const parcels = resolveParcels(shipment, input);
  blockers.push(...parcels.blockers);

  /* ----- contul Artfest (PLATFORM) -----
   * Configurare lipsă (cont / credentiale / pickupPoint contractual) ->
   * mesaj clar, fără niciun apel la curier. */
  const account = await findPlatformCourierAccount(db);
  const config = platformConfig(account);
  let def = null;
  let ctx = null;

  const setupIssue = platformSetupIssue(account);
  if (setupIssue) {
    blockers.push(setupIssue);
  } else {
    try {
      def = getCourierProvider(account.provider);
      ctx = {
        accountId: account.id,
        credentials: openCredentials(account),
        publicConfig: { ...(account.publicConfig || {}), environment: config.environment },
      };
    } catch (e) {
      console.error("[awb] contul PLATFORM nu poate fi folosit:", account.id, isCourierError(e) ? e.code : e?.name || "Error");
      def = null;
      ctx = null;
      blockers.push(blocker("platform_account_missing", PLATFORM_SETUP_MESSAGES.platform_account_missing));
    }
  }

  const courierReady = !!(def && ctx);

  /* ----- date live de la curier (doar citiri, cache-uite în provider) -----
   * liveMode "ifNoBlockers" (la creare): cu blockere locale (adresă,
   * greutate, plată...) curierul NU e contactat deloc. */
  let service = null;
  let pickupPoint = null;
  let contactPersonId = null;

  const contactCourier = courierReady && (liveMode === "always" || blockers.length === 0);

  if (contactCourier) {
    try {
      const [services, pickupPoints] = await Promise.all([def.listServices(ctx), def.listPickupPoints(ctx)]);

      service = pickHomeDeliveryService(services, config.serviceId);
      if (!service) {
        blockers.push(
          blocker(
            "service_unavailable",
            "Serviciul Sameday de livrare la adresă nu este activ pe contul Artfest. AWB-ul nu poate fi generat momentan."
          )
        );
      }

      // punctul CONTRACTUAL configurat - verificat în contul Sameday, niciodată ghicit
      pickupPoint = pickupPoints.find((p) => String(p.id) === String(config.pickupPointId)) || null;
      if (!pickupPoint) {
        blockers.push(blocker("platform_pickup_point_invalid", PLATFORM_SETUP_MESSAGES.platform_pickup_point_invalid));
      } else if (config.contactPersonId) {
        if ((pickupPoint.contactPersonIds || []).some((id) => String(id) === String(config.contactPersonId))) {
          contactPersonId = config.contactPersonId;
        } else {
          blockers.push(
            blocker("platform_contact_person_invalid", PLATFORM_SETUP_MESSAGES.platform_contact_person_invalid)
          );
        }
      }
    } catch (e) {
      if (e instanceof CourierAuthError) {
        console.error("[awb] autentificarea contului PLATFORM a eșuat:", account.id);
        blockers.push(blocker("platform_credentials_invalid", PLATFORM_SETUP_MESSAGES.platform_credentials_invalid));
      } else {
        blockers.push(
          blocker(
            e instanceof CourierTimeoutError ? "courier_timeout" : "courier_unreachable",
            isCourierError(e) ? e.message : "Nu am putut contacta curierul. Încearcă din nou."
          )
        );
      }
    }
  }

  const cancelledCount = await db.courierAwb.count({ where: { shipmentId: shipment.id, status: "CANCELLED" } });
  const clientReference = clientReferenceFor(shipment.id, cancelledCount);
  const observation = String(order.shippingAddress?.notes || "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const packageInfo = def?.describePackage ? def.describePackage(parcels.list) : null;
  const setupBlocker = blockers.find((b) => PLATFORM_SETUP_MESSAGES[b.code]) || null;

  const preview = {
    shipmentId: shipment.id,
    orderId: order.id,
    orderNumber: order.orderNumber,
    method,
    lockerId: shipment.lockerId || null,
    currency,
    paymentMethod: payment.paymentMethod,
    payment: paymentSummary(payment.paymentMethod, cod.codAmount),
    // contractul Artfest; fără detalii de cont pentru vendor
    courier: courierReady ? { provider: account.provider } : null,
    courierSetup: {
      ready: courierReady && !setupBlocker,
      message: setupBlocker ? setupBlocker.message : null,
    },
    // RIDICARE: de la vendor (thirdPartyPickup), din adresa lui de ridicare
    pickup: pickupParty
      ? {
          storeName: pickupParty.storeName,
          contactName: pickupParty.name || null,
          phone: pickupParty.phone || null,
          email: pickupParty.email,
          address: pickupParty.address || null,
          city: pickupParty.city || null,
          county: pickupParty.county || null,
          postalCode: pickupParty.postalCode,
          fullAddress: [pickupParty.address, pickupParty.city, pickupParty.county, pickupParty.postalCode]
            .filter(Boolean)
            .join(", "),
          complete: pickupBlockers.length === 0,
          addressId: pickupParty.addressId,
          form: pickupParty.form,
        }
      : null,
    recipient,
    deliveryAddress: [recipient.address, recipient.city, recipient.county, recipient.postalCode]
      .filter(Boolean)
      .join(", "),
    services: service ? [service] : [],
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? null,
    pickupPoint: pickupPoint ? { id: pickupPoint.id, alias: pickupPoint.alias } : null,
    parcels: parcels.parcels,
    weightKg: parcels.weightKg,
    lengthCm: parcels.lengthCm,
    widthCm: parcels.widthCm,
    heightCm: parcels.heightCm,
    packageType: packageInfo,
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
      contactPersonId,
      pickupParty,
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
  const { preview, internal } = await buildAwbPlan({ vendorId, shipmentId, input, liveMode: "ifNoBlockers" }, db);
  if (preview.blockers.length) throw new AwbBlockedError(preview.blockers, preview);

  const {
    shipment,
    account,
    def,
    ctx,
    service,
    pickupPoint,
    contactPersonId,
    pickupParty,
    parcels,
    cod,
    recipient,
    clientReference,
    observation,
  } = internal;
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

  // ID-urile Sameday de județ / localitate (doar potrivire exactă; altfel numele)
  const [recipientPlace, pickupPlace] = await Promise.all([
    def.resolvePlace ? def.resolvePlace(ctx, recipient) : null,
    def.resolvePlace ? def.resolvePlace(ctx, pickupParty) : null,
  ]);

  // 3) apelul către curier - în afara oricărei tranzacții
  let result;
  let recovered = false;
  try {
    result = await def.createShipment(ctx, {
      clientReference,
      serviceId: service.id,
      pickupPointId: pickupPoint.id,
      contactPersonId,
      parcels: parcels.list,
      codAmount: cod.codAmount,
      declaredValue: 0,
      recipient: { ...recipient, ...(recipientPlace || {}) },
      thirdParty: { ...pickupParty, ...(pickupPlace || {}) },
      observation,
    });
  } catch (e) {
    if (isDefiniteFailure(e)) {
      await recordFailure(db, reservation, account, e);
      throw e;
    }
    // rezultat NECUNOSCUT (timeout / conexiune / 5xx): întâi întrebăm Sameday
    // dacă AWB-ul există deja pentru referință - niciodată un al doilea POST
    const lookup = await lookupByReference(def, ctx, clientReference);
    if (!lookup.result) {
      await recordFailure(db, reservation, account, e, { recoveryCheck: lookup.status });
      throw e; // nu se ajunge aici: recordFailure aruncă awb_status_unknown
    }
    result = lookup.result;
    recovered = true;
  }

  // 4) succes -> CREATED + Shipment (fără statusuri / nimic financiar)
  const awbRow = await saveCreatedAwb(db, {
    row: reservation,
    shipmentId: shipment.id,
    provider: account.provider,
    def,
    serviceLabel,
    parcels,
    result,
    audit: recovered ? { action: "recovered_by_reference", actor: "system" } : null,
  });
  return { replayed: false, ...(recovered ? { recovered: true } : {}), awb: toPublicAwb(awbRow) };
}

// eșec SIGUR: Sameday a refuzat cererea (nimic creat) -> se poate reîncerca
function isDefiniteFailure(e) {
  return e instanceof CourierAuthError || e instanceof CourierValidationError;
}

/*
 * GET /api/client/awb/{clientInternalReference} prin provider.
 * @returns {Promise<{status:"found"|"not_found"|"error"|"unsupported", result?:Object}>}
 */
async function lookupByReference(def, ctx, clientReference) {
  if (typeof def?.findShipmentByReference !== "function" || !clientReference) return { status: "unsupported" };
  try {
    const result = await def.findShipmentByReference(ctx, clientReference);
    return result ? { status: "found", result } : { status: "not_found" };
  } catch (e) {
    console.error("[awb] verificarea după clientInternalReference a eșuat:", isCourierError(e) ? e.code : e?.name || "Error");
    return { status: "error" };
  }
}

/*
 * AWB confirmat de curier -> CourierAwb CREATED + Shipment (awb, etichetă,
 * tracking, colete). Dacă salvarea eșuează, AWB-ul EXISTĂ la curier:
 * rândul rămâne UNKNOWN cu numărul salvat (fără al doilea AWB).
 */
async function saveCreatedAwb(db, { row, shipmentId, provider, def, serviceLabel, parcels, result, audit = null }) {
  const providerMeta = {
    ...(audit ? withAudit(row.providerMeta, audit) : {}),
    parcelNumbers: result.parcelNumbers || [],
    cost: result.cost ?? null,
  };
  const trackingUrl = def?.trackingUrl?.(result.awbNumber) || null;
  try {
    const [awbRow] = await db.$transaction([
      db.courierAwb.update({
        where: { id: row.id },
        data: { status: "CREATED", awbNumber: result.awbNumber, providerMeta, errorMessage: null },
      }),
      db.shipment.update({
        where: { id: shipmentId },
        data: {
          courierProvider: provider,
          courierService: serviceLabel,
          awb: result.awbNumber,
          labelUrl: labelPath(shipmentId),
          trackingUrl,
          parcels: parcels.parcels,
          weightKg: parcels.weightKg,
          lengthCm: parcels.lengthCm,
          widthCm: parcels.widthCm,
          heightCm: parcels.heightCm,
        },
      }),
    ]);
    return awbRow;
  } catch (e) {
    console.error("[awb] AWB creat la curier, dar salvarea a eșuat:", row.id, e?.code || e?.name || "Error");
    await db.courierAwb
      .update({
        where: { id: row.id },
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

async function recordFailure(db, reservation, account, e, { recoveryCheck = null } = {}) {
  const definite = isDefiniteFailure(e);
  const message = isCourierError(e) ? e.message : "Eroare neașteptată la generarea AWB.";
  const providerMeta = {
    errorCode: isCourierError(e) ? e.code : "unexpected_error",
    ...(e?.providerStatus ? { providerStatus: e.providerStatus } : {}),
    ...(Array.isArray(e?.fields) && e.fields.length ? { fields: e.fields } : {}),
    ...(recoveryCheck ? { recoveryCheck, recoveryCheckedAt: new Date().toISOString() } : {}),
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
      e instanceof CourierTimeoutError
        ? "Sameday nu a răspuns la timp, iar AWB-ul nu apare încă la Sameday. Nu genera din nou: verifică din nou peste un minut."
        : "Curierul nu a confirmat generarea AWB (eroare temporară), iar AWB-ul nu apare încă la Sameday. Nu genera din nou: verifică din nou peste un minut.",
      { httpStatus: 504 }
    );
    throw unknown;
  }
}

/**
 * „Verifică din nou la Sameday” (vendor) pentru un AWB UNKNOWN al
 * expedierii lui: întreabă curierul după clientInternalReference.
 *   - AWB găsit (sau număr deja primit, dar nesalvat) -> CREATED + Shipment;
 *   - negăsit și încercarea e mai veche de RECOVERY_MIN_AGE_MS -> FAILED,
 *     expedierea e eliberată (se poate genera din nou, cu aceeași referință);
 *   - negăsit, dar prea recent / Sameday indisponibil -> rămâne UNKNOWN.
 * Nu creează niciodată un AWB.
 * @returns {Promise<{outcome:"created"|"released", awb:Object}>}
 */
export async function recoverUnknownAwb({ vendorId, userId = null, shipmentId }, db = defaultDb) {
  const shipment = await db.shipment.findFirst({
    where: { id: String(shipmentId || ""), vendorId },
    select: { id: true, awb: true },
  });
  if (!shipment) throw new AwbNotFoundError();

  const row = await findActiveCourierAwb(db, shipment.id);
  if (!row || row.status !== "UNKNOWN") {
    throw new AwbConflictError("awb_not_unknown", "Nu există o generare de AWB care să aștepte verificarea.");
  }

  const account = await findAwbAccount(db, row, vendorId);
  let def = null;
  try {
    def = getCourierProvider(row.provider);
  } catch {
    def = null;
  }
  const parcels = {
    parcels: Array.isArray(row.parcels) ? row.parcels.length : null,
    weightKg: row.weightKg != null ? Number(row.weightKg) : null,
    lengthCm: row.parcels?.[0]?.lengthCm ?? null,
    widthCm: row.parcels?.[0]?.widthCm ?? null,
    heightCm: row.parcels?.[0]?.heightCm ?? null,
  };
  const save = (result, action) =>
    saveCreatedAwb(db, {
      row,
      shipmentId: shipment.id,
      provider: row.provider,
      def,
      serviceLabel: row.courierService || null,
      parcels,
      result,
      audit: { action, actor: "vendor", userId },
    });

  // numărul a venit deja de la curier (salvare eșuată) - nu mai întrebăm
  if (row.awbNumber) {
    const awb = await save({ awbNumber: row.awbNumber, parcelNumbers: row.providerMeta?.parcelNumbers || [], cost: row.providerMeta?.cost ?? null }, "recovered_saved_number");
    return { outcome: "created", awb: toPublicAwb(awb) };
  }

  if (!account || account.disabledAt || !def) {
    throw new CourierError(
      "courier_account_unavailable",
      "Contul de curier cu care a fost generat AWB-ul nu mai este disponibil. Contactează suportul Artfest.",
      { httpStatus: 409 }
    );
  }

  const ctx = { accountId: account.id, credentials: openCredentials(account), publicConfig: account.publicConfig || {} };
  const lookup = await lookupByReference(def, ctx, row.clientReference);

  if (lookup.status === "found") {
    const awb = await save(lookup.result, "recovered_by_reference");
    return { outcome: "created", awb: toPublicAwb(awb) };
  }

  if (lookup.status === "not_found" && Date.now() - new Date(row.createdAt).getTime() >= RECOVERY_MIN_AGE_MS) {
    const res = await db.courierAwb.updateMany({
      where: { id: row.id, status: "UNKNOWN" },
      data: {
        status: "FAILED",
        activeShipmentId: null,
        errorMessage: "Sameday nu are niciun AWB pentru această încercare. Poți genera AWB-ul din nou.",
        providerMeta: withAudit(row.providerMeta, { action: "recovered_not_found", actor: "vendor", userId }),
      },
    });
    if (!res.count) throw new AwbConflictError("awb_changed", "AWB-ul a fost modificat între timp. Reîncarcă pagina.");
    return { outcome: "released", awb: toPublicAwb(await db.courierAwb.findUnique({ where: { id: row.id } })) };
  }

  throw new AwbConflictError(
    "awb_status_unknown",
    lookup.status === "not_found"
      ? "AWB-ul nu apare încă la Sameday. Verifică din nou peste un minut - nu genera alt AWB până atunci."
      : "Nu am putut verifica la Sameday acum. Încearcă din nou peste câteva minute."
  );
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
    ? await findAwbAccount(db, row, vendorId)
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
    ? await findAwbAccount(db, row, vendorId)
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
