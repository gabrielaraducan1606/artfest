// backend/src/couriers/awb/awbService.js

import crypto from "node:crypto";
import { awbEnvironmentIssue, explicitEnvironment, samedayEnvironmentIssue, SamedayEnvironmentError } from "../samedayEnvironment.js";
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
import { homeRecipientFromDelivery, oohRecipientFromDelivery } from "./deliverySnapshot.js";
import { classifySamedayServices } from "../providers/sameday/catalog.js";
import {
  PLATFORM_SETUP_MESSAGES,
  findPlatformCourierAccount,
  platformConfig,
  platformSetupIssue,
} from "../platformAccount.js";
import { assertCourierAwbLiveEnabled } from "../awbLive.js";
import { AWB_PRE_HANDOVER_STATUSES, awbCancelStateOf } from "./activeAwbGuard.js";
import { AWB_NOT_FOUND_AT_COURIER_MESSAGE } from "../providers/sameday/index.js";
import {
  RETURN_AWB_SHIPMENT_STATUSES,
  SAMEDAY_RETURN_SERVICE_IDS,
  SAMEDAY_STANDARD_RETURN_SERVICE_ID,
  classifyReturnRecipient,
  returnPayloadFingerprint,
  returnPickupFromDelivery,
  returnRecipientFromPickup,
  returnRequestBlockers,
} from "./returnAwb.js";
import { onReturnAwbCancelled, onReturnAwbConfirmed } from "../../services/returnShipmentService.js";
import { isReturnCourierPickupFlagOn } from "../../services/shipping/logisticsFlags.js";

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
 * Livrare: la adresă (HOME), easybox (LOCKER) și Sameday Point (PUDO), toate
 * din snapshot-ul ShipmentDelivery salvat la checkout. Easybox / PUDO:
 * oohLastMile = ShipmentDelivery.oohId, serviciul activ al contului pentru
 * metoda respectivă, locația revalidată live (fără cache) înainte de AWB.
 * Doar comenzile vechi, fără snapshot, folosesc adresa comenzii (doar HOME;
 * easybox legacy rămâne blocat). Locker2Locker nu e implementat.
 *
 * RETUR STANDARD (Shipment RETURN, service 10 - buildReturnAwbPlan + returnAwb.js):
 * același flux de creare / recuperare / anulare / etichetă, cu thirdParty =
 * clientul (ShipmentDelivery al returului) și awbRecipient = vendorul
 * (VendorPickupAddress); referința ARTFEST-RETURN-<shipmentId>[-R<n>].
 * Easybox Return (24) nu e implementat.
 *
 * Costul AWB (awbCost) se păstrează în CourierAwb.providerMeta.cost; NU se
 * scrie în ShipmentDelivery la creare (shippingCost / pricingSource /
 * fallbackReason / carrierCost rămân neatinse). Completarea carrierCost +
 * vendorShippingCost se face prin shippingBilling.recordCarrierCost.
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
 *  O nouă încercare cu ACEEAȘI referință (după FAILED) întreabă din nou
 *  Sameday înainte de POST: găsit -> adoptat; verificare eșuată -> fără POST.
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
 *  Rezervare condiționată (providerMeta.cancelState = IN_PROGRESS) înainte
 *  de DELETE -> un singur apel la curier; rezultat incert (timeout / 5xx)
 *  -> cancelState = UNKNOWN, AWB-ul rămâne blocant, fără reîncercare oarbă.
 *
 * NU se schimbă statusurile comenzii / Shipment-ului și nimic financiar.
 */

const ELIGIBLE_SHIPMENT_STATUSES = AWB_PRE_HANDOVER_STATUSES;

const ACTIVE_AWB_STATUSES = new Set(["REQUESTED", "CREATED", "UNKNOWN"]);

// cel mai lung apel posibil la curier e ~40s (autentificare + creare, cu o
// reautentificare la 401, câte 10s fiecare) - 2 minute înseamnă sigur abandon
export const STALE_REQUESTED_MS = 2 * 60 * 1000;

const STALE_REQUESTED_MESSAGE =
  "Generarea nu s-a finalizat (întreruptă). Verificăm la curier dacă AWB-ul a fost creat înainte de a permite o nouă încercare.";

/*
 * AWB-ul se poate anula doar cât coletul NU a fost predat curierului.
 * O livrare anulată (REFUSED) ÎNAINTE de predare - comandă anulată sau motiv
 * de anulare - poate avea încă AWB-ul activ la curier (date vechi / căi
 * automate): anularea AWB-ului trebuie să rămână posibilă. Curierul decide final.
 */
function isAwbCancellableShipment(shipment, orderStatus = null) {
  if (!shipment || shipment.handedOverAt || shipment.deliveredAt || shipment.returnedAt) return false;
  const status = String(shipment.status || "");
  // RETURN: doar cât coletul de retur nu a fost predat (comanda e deja livrată,
  // deci regula „comandă anulată / REFUSED” de la outbound nu se aplică)
  if (shipment.direction === "RETURN") return RETURN_AWB_SHIPMENT_STATUSES.has(status);
  if (AWB_PRE_HANDOVER_STATUSES.has(status)) return true;
  return status === "REFUSED" && (String(orderStatus || "") === "CANCELLED" || !!shipment.cancelReason);
}

const AWB_CANCEL_SHIPMENT_SELECT = {
  id: true,
  vendorId: true,
  direction: true,
  status: true,
  awb: true,
  handedOverAt: true,
  deliveredAt: true,
  returnedAt: true,
  cancelReason: true,
  order: { select: { status: true } },
};

/*
 * Starea anulării AWB-ului (fără coloane noi), în CourierAwb.providerMeta:
 *   cancelState        "IN_PROGRESS" (DELETE trimis, răspuns în așteptare) |
 *                      "UNKNOWN" (rezultat incert - necesită verificare)
 *   cancelAttemptId    id-ul încercării care a rezervat anularea
 *   cancelAttemptedAt  momentul rezervării (ISO)
 *   cancelErrorCode    codul erorii care a făcut rezultatul incert
 *   cancelNeedsReview  true când e nevoie de verificare (Admin / status-sync)
 * Status-ul rândului rămâne CREATED (activeShipmentId păstrat) -> AWB-ul
 * rămâne blocant: fără AWB nou, fără anulare din nou de către vendor.
 */
export const CANCEL_IN_PROGRESS_STALE_MS = 2 * 60 * 1000;
const CANCEL_META_KEYS = ["cancelState", "cancelAttemptId", "cancelAttemptedAt", "cancelErrorCode", "cancelNeedsReview"];

export const AWB_CANCEL_UNKNOWN_MESSAGE =
  "Nu putem confirma încă dacă Sameday a anulat AWB-ul. Verifică din nou mai târziu sau contactează suportul.";
export const AWB_CANCEL_IN_PROGRESS_MESSAGE =
  "Anularea AWB-ului este deja în curs. Așteaptă câteva momente și reîncarcă pagina.";

function metaOf(row) {
  const meta = row?.providerMeta;
  return meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {};
}

function withoutCancelState(meta) {
  const out = { ...(meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {}) };
  for (const key of CANCEL_META_KEYS) delete out[key];
  return out;
}

function cancelUnknownMeta(meta, { errorCode, attemptId, attemptedAt }) {
  return {
    ...withoutCancelState(meta),
    cancelState: "UNKNOWN",
    cancelAttemptId: attemptId || null,
    cancelAttemptedAt: attemptedAt || new Date().toISOString(),
    cancelErrorCode: errorCode || "unknown",
    cancelNeedsReview: true,
  };
}

// rezumatul public al anulării (UI vendor / admin) - fără date de autentificare
function publicCancel(row) {
  const state = awbCancelStateOf(row);
  if (!state) return null;
  const meta = metaOf(row);
  return {
    state,
    attemptedAt: meta.cancelAttemptedAt || null,
    errorCode: state === "UNKNOWN" ? meta.cancelErrorCode || "cancel_interrupted" : null,
    needsReview: state === "UNKNOWN",
    message: state === "UNKNOWN" ? AWB_CANCEL_UNKNOWN_MESSAGE : AWB_CANCEL_IN_PROGRESS_MESSAGE,
  };
}

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

/*
 * Mediul Sameday al unui AWB (providerMeta.environment), salvat la rezervare.
 * Operațiile care contactează Sameday pentru un AWB EXISTENT (reverificare /
 * recuperare, etichetă, anulare) cer: mediul AWB-ului explicit, egal cu al
 * contului și permis pe acest server. AWB vechi fără mediu -> blocat
 * (awb_environment_unknown), NU presupus production. Fără niciun apel extern.
 */
function keepEnvironment(meta) {
  const environment = explicitEnvironment(meta?.environment);
  return environment ? { environment } : {};
}

export function assertAwbEnvironment(row, account, env = process.env) {
  if (String(row?.provider || account?.provider || "") !== "SAMEDAY") return;
  const accountEnvironment = explicitEnvironment(account?.publicConfig?.environment);
  const reason = awbEnvironmentIssue(row, accountEnvironment) || samedayEnvironmentIssue(accountEnvironment, env);
  if (reason) throw new SamedayEnvironmentError(reason);
}

function labelPath(shipmentId) {
  return `/api/vendor/shipments/${encodeURIComponent(shipmentId)}/label`;
}

/*
 * Referința trimisă curierului (clientInternalReference): stabilă și unică
 * per expediere. Un AWB anulat păstrează referința lui la Sameday, deci
 * după n anulări referința primește sufixul -R<n>.
 */
export function clientReferenceFor(shipmentId, cancelledCount = 0, direction = "OUTBOUND") {
  // returul are prefixul lui: referințe distincte de outbound, deterministe per Shipment RETURN
  const base = `${direction === "RETURN" ? "ARTFEST-RETURN" : "ARTFEST-SHIPMENT"}-${shipmentId}`;
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
      // snapshot-ul livrării validat la plasarea comenzii (null la comenzile vechi);
      // pe un Shipment RETURN: datele clientului care predă coletul (vezi returnAwb.js)
      delivery: true,
      // cererea de retur (doar Shipment RETURN)
      returnRequest: { select: { id: true, vendorId: true, status: true, returnMethod: true, orderId: true, costBearer: true } },
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

/*
 * Serviciul de livrare la adresă: DOAR cel configurat explicit în contul
 * PLATFORM (publicConfig.serviceId) și DOAR dacă e activ pe cont
 * (GET /api/client/services). Fără ID implicit în cod, fără „primul serviciu”
 * / „serviciul implicit al contului” (ar putea fi 3H / locker / retur).
 */
function pickConfiguredService(services, configuredId) {
  if (!configuredId) return null;
  return services.find((s) => String(s.id) === String(configuredId)) || null;
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

/*
 * Contul Artfest (PLATFORM) + contextul providerului. Configurare lipsă ->
 * blocker, fără niciun apel la curier. Comun pentru outbound și retur.
 */
async function platformCourierContext(db, blockers) {
  const account = await findPlatformCourierAccount(db);
  const config = platformConfig(account);
  const setupIssue = platformSetupIssue(account);
  if (setupIssue) {
    blockers.push(setupIssue);
    return { account, config, def: null, ctx: null };
  }
  try {
    const def = getCourierProvider(account.provider);
    const ctx = {
      accountId: account.id,
      credentials: openCredentials(account),
      publicConfig: { ...(account.publicConfig || {}), environment: config.environment },
    };
    return { account, config, def, ctx };
  } catch (e) {
    console.error("[awb] contul PLATFORM nu poate fi folosit:", account.id, isCourierError(e) ? e.code : e?.name || "Error");
    blockers.push(blocker("platform_account_missing", PLATFORM_SETUP_MESSAGES.platform_account_missing));
    return { account, config, def: null, ctx: null };
  }
}

/*
 * Punctul CONTRACTUAL configurat - verificat în contul Sameday (și activ),
 * niciodată ghicit - plus persoana de contact. Comun pentru outbound și retur.
 */
function pickContractPickupPoint(pickupPoints, config, blockers) {
  const pickupPoint =
    pickupPoints.find((p) => String(p.id) === String(config.pickupPointId) && p.active !== false) || null;
  let contactPersonId = null;
  if (!pickupPoint) {
    blockers.push(blocker("platform_pickup_point_invalid", PLATFORM_SETUP_MESSAGES.platform_pickup_point_invalid));
  } else if (config.contactPersonId) {
    if ((pickupPoint.contactPersonIds || []).some((id) => String(id) === String(config.contactPersonId))) {
      contactPersonId = config.contactPersonId;
    } else {
      blockers.push(blocker("platform_contact_person_invalid", PLATFORM_SETUP_MESSAGES.platform_contact_person_invalid));
    }
  } else {
    // fără persoană configurată: cea implicită a punctului, dacă există; altfel
    // câmpul lipsește și Sameday alege (PDF: implicită sau oricare)
    contactPersonId = pickupPoint.defaultContactPersonId ?? null;
  }
  return { pickupPoint, contactPersonId };
}

function courierReadBlocker(e, account) {
  if (e instanceof CourierAuthError) {
    console.error("[awb] autentificarea contului PLATFORM a eșuat:", account?.id);
    return blocker("platform_credentials_invalid", PLATFORM_SETUP_MESSAGES.platform_credentials_invalid);
  }
  return blocker(
    e instanceof CourierTimeoutError ? "courier_timeout" : "courier_unreachable",
    isCourierError(e) ? e.message : "Nu am putut contacta curierul. Încearcă din nou."
  );
}

/**
 * Plan pentru AWB-ul de RETUR STANDARD (Sameday service 10) al unui Shipment
 * RETURN. Aceeași formă { preview, internal } ca planul outbound, astfel încât
 * createAwbForShipment (rezervare, idempotență, UNKNOWN, recuperare după
 * clientInternalReference) e REFOLOSIT neschimbat:
 *   internal.pickupParty / pickupPlace -> thirdParty = CLIENTUL (din
 *     ShipmentDelivery RETURN, cu ID-urile Sameday salvate);
 *   internal.recipient / recipientPlace -> awbRecipient = VENDORUL (din
 *     VendorPickupAddress, validată în nomenclator);
 *   pickupPoint = punctul contractual Artfest; ramburs 0; asigurare 0.
 * Orice condiție neîndeplinită -> blocker cu cod stabil, fără POST la curier.
 * NU modifică costurile din ShipmentDelivery.
 */
async function buildReturnAwbPlan({ shipment, liveMode = "always", actor = "vendor" }, db) {
  const order = shipment.order;
  const returnRequest = shipment.returnRequest || null;
  const blockers = [...returnRequestBlockers({ shipment, returnRequest })];
  // ridicarea de retur dezactivată (RETURN_COURIER_PICKUP_ENABLED): fără AWB de retur
  if (!isReturnCourierPickupFlagOn(process.env)) {
    blockers.push(blocker("return_pickup_disabled", "Ridicarea returului prin curier nu este activată."));
  }
  // etapa 1: AWB-ul de retur pe contractul Artfest îl generează DOAR Admin;
  // vendorul vede previzualizarea, fără citiri live la curier
  if (actor !== "admin") {
    blockers.push(blocker("return_awb_admin_only", "AWB-ul de retur este generat de echipa Artfest."));
    liveMode = "ifNoBlockers";
  }

  const active = await findActiveCourierAwb(db, shipment.id);
  const activeBlocker = describeActiveAwb(active, shipment);
  if (activeBlocker) blockers.push(activeBlocker);

  const currency = String(order.currency || "RON").toUpperCase();
  if (currency !== "RON") {
    blockers.push(blocker("currency_unsupported", "Momentan AWB-ul se poate genera doar pentru comenzi în RON."));
  }

  // EXPEDITOR: clientul (ShipmentDelivery RETURN; câmpurile recipient* = clientul)
  const { party: clientParty, place: clientPlace, blockers: pickupBlockers } = returnPickupFromDelivery(shipment.delivery);
  blockers.push(...pickupBlockers);

  // DESTINATAR: vendorul (VendorPickupAddress) - vendorul SHIPMENT-ului, nu altul
  const vendorPickup = await loadPickupParty(db, shipment.vendorId);
  // persoană fizică / juridică pentru Sameday: regula unică din returnAwb.js
  // (PFA / II / IF blocate până la confirmarea Sameday; datele fiscale rămân în Artfest)
  const recipientBilling = await db.vendorBilling.findUnique({
    where: { vendorId: shipment.vendorId },
    select: { sellerType: true, legalType: true, companyName: true, cui: true, regCom: true },
  });
  const { recipient: vendorRecipient, blockers: addressBlockers } = returnRecipientFromPickup(
    vendorPickup,
    classifyReturnRecipient(recipientBilling)
  );
  const vendorParty = addressBlockers.length ? null : vendorPickup.party;
  blockers.push(...addressBlockers);

  // colete: DOAR datele logistice ale Shipment-ului RETURN, fără valori implicite
  const parcels = resolveParcels(shipment, {});
  if (shipment.parcels == null) {
    blockers.push(blocker("parcels_required", "Completează numărul de colete al returului.", "parcels"));
  }
  blockers.push(...parcels.blockers);

  const { account, config, def, ctx } = await platformCourierContext(db, blockers);
  const courierReady = !!(def && ctx);

  let service = null;
  let pickupPoint = null;
  let contactPersonId = null;
  let vendorPlace = null;
  if (courierReady && (liveMode === "always" || blockers.length === 0)) {
    try {
      const [services, pickupPoints] = await Promise.all([def.listServices(ctx), def.listPickupPoints(ctx)]);
      // Retur standard = service 10 (PDF v3.6), doar dacă e activ pe contul Artfest
      service = services.find((s) => String(s.id) === SAMEDAY_STANDARD_RETURN_SERVICE_ID) || null;
      if (!service) {
        blockers.push(
          blocker("return_service_unavailable", "Serviciul Sameday „Retur standard” nu este activ pe contul Artfest. AWB-ul de retur nu poate fi generat momentan.")
        );
      }
      ({ pickupPoint, contactPersonId } = pickContractPickupPoint(pickupPoints, config, blockers));
      // adresa vendorului (destinatarul) validată în nomenclator; fără fallback la Artfest
      if (vendorParty) {
        const checked = await resolvePickupPlace(def, ctx, vendorParty);
        vendorPlace = checked.place;
        if (checked.blocker) {
          blockers.push(blocker("return_address_invalid", "Adresa de retur a magazinului nu a putut fi validată în nomenclatorul Sameday.", "pickupAddress"));
          blockers.push(checked.blocker);
        }
      }
    } catch (e) {
      blockers.push(courierReadBlocker(e, account));
    }
  }

  const cancelledCount = await db.courierAwb.count({ where: { shipmentId: shipment.id, status: "CANCELLED" } });
  const clientReference = clientReferenceFor(shipment.id, cancelledCount, "RETURN");
  const observation = `Retur comanda ${order.orderNumber}`.slice(0, 200);
  const packageInfo = def?.describePackage ? def.describePackage(parcels.list) : null;
  const setupBlocker = blockers.find((b) => PLATFORM_SETUP_MESSAGES[b.code]) || null;
  const cod = { codAmount: 0, productsTotal: 0 };

  const preview = {
    kind: "RETURN",
    shipmentId: shipment.id,
    returnRequestId: returnRequest?.id || null,
    orderId: order.id,
    orderNumber: order.orderNumber,
    method: "COURIER",
    deliveryMethod: "HOME",
    currency,
    payment: { type: "NONE", label: "Fără ramburs", codAmount: 0 },
    courier: courierReady ? { provider: account.provider } : null,
    courierSetup: { ready: courierReady && !setupBlocker, message: setupBlocker ? setupBlocker.message : null },
    // RIDICARE: de la client (thirdParty)
    pickup: clientParty
      ? {
          contactName: clientParty.name,
          phone: clientParty.phone,
          address: clientParty.address,
          city: clientParty.city,
          county: clientParty.county,
          postalCode: clientParty.postalCode,
          fullAddress: [clientParty.address, clientParty.city, clientParty.county, clientParty.postalCode].filter(Boolean).join(", "),
          complete: pickupBlockers.length === 0,
        }
      : null,
    // DESTINATAR: vendorul (adresa de retur = adresa lui de ridicare)
    recipient: vendorRecipient,
    recipientSource: "vendor_pickup_address",
    deliveryAddress: vendorRecipient
      ? [vendorRecipient.address, vendorRecipient.city, vendorRecipient.county, vendorRecipient.postalCode].filter(Boolean).join(", ")
      : "",
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
    declaredValue: 0,
    codAmount: 0,
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
      // thirdParty = clientul (thirdPartyWithPlace adaugă ID-urile salvate)
      pickupParty: clientParty,
      pickupPlace: clientPlace,
      parcels,
      cod,
      // awbRecipient = vendorul, cu ID-urile validate (nu se mai caută după nume)
      recipient: vendorRecipient,
      recipientPlace: vendorPlace,
      recipientSource: "vendor_pickup_address",
      oohLastMile: null,
      deliveryMethod: "HOME",
      clientReference,
      observation,
      method: "COURIER",
      // verificată ATOMIC la rezervare (cererea blocată): adresa / metoda schimbate
      // între verificare și rezervare -> fără AWB (vezi createAwbInternal)
      returnGuard: returnRequest
        ? { returnRequestId: returnRequest.id, fingerprint: returnPayloadFingerprint(shipment.delivery, returnRequest) }
        : null,
    },
  };
}

/**
 * Construiește previzualizarea + contextul intern pentru creare.
 * NU creează nimic. Apelează curierul doar pentru citiri (servicii,
 * puncte de ridicare).
 */
export async function buildAwbPlan({ vendorId, shipmentId, input = {}, liveMode = "always", actor = "vendor" }, db = defaultDb) {
  const shipment = await loadShipment(db, vendorId, shipmentId);
  // Shipment RETURN: plan separat (Retur standard Sameday), aceleași garanții la creare
  if (shipment.direction === "RETURN") return buildReturnAwbPlan({ shipment, liveMode, actor }, db);

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

  /*
   * Metoda de livrare: din snapshot-ul ShipmentDelivery (HOME / LOCKER / PUDO).
   * Comandă veche cu easybox, fără snapshot -> blocat (locația nu e salvată
   * sigur). Snapshot HOME pe un shipment LOCKER -> date contradictorii, blocat.
   */
  const delivery = shipment.delivery || null;
  const deliveryMethod = delivery ? delivery.method : shipment.method === "LOCKER" ? "LOCKER" : "HOME";
  const isOoh = deliveryMethod === "LOCKER" || deliveryMethod === "PUDO";
  const method = isOoh ? "LOCKER" : "COURIER";
  if (!delivery && shipment.method === "LOCKER") {
    blockers.push(
      blocker(
        "locker_not_supported",
        "Comanda nu are salvat punctul easybox ales la plasare. AWB-ul nu poate fi generat din Artfest; poți trimite comanda fără integrare."
      )
    );
  } else if (delivery && delivery.method === "HOME" && shipment.method === "LOCKER") {
    blockers.push(
      blocker("delivery_method_mismatch", "Metoda de livrare a comenzii nu corespunde datelor salvate la plasare. Contactează suportul Artfest.")
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

  /*
   * DESTINATAR: snapshot-ul ShipmentDelivery (salvat și validat la checkout) are
   * prioritate; snapshot HOME incomplet -> blocat, FĂRĂ completare din comandă.
   * Doar comenzile vechi, fără snapshot, folosesc adresa comenzii (legacy).
   */
  let recipient;
  let recipientBlockers;
  let recipientPlace = null;
  let recipientSource;
  // easybox / Sameday Point: oohLastMile = ShipmentDelivery.oohId (după revalidare)
  let oohLastMile = null;
  let oohSnapshot = null;
  let expectedOohType = null;
  if (delivery) {
    recipientSource = "delivery_snapshot";
    if (delivery.method === "HOME") {
      ({ recipient, place: recipientPlace, blockers: recipientBlockers } = homeRecipientFromDelivery(delivery));
    } else {
      ({ recipient, oohLastMile, expectedOohType, ooh: oohSnapshot, blockers: recipientBlockers } = oohRecipientFromDelivery(delivery));
    }
  } else {
    recipientSource = "order_legacy";
    ({ recipient, blockers: recipientBlockers } = buildRecipient(order));
  }
  blockers.push(...recipientBlockers);

  const parcels = resolveParcels(shipment, input);
  blockers.push(...parcels.blockers);

  /* ----- contul Artfest (PLATFORM) -----
   * Configurare lipsă (cont / credentiale / pickupPoint contractual) ->
   * mesaj clar, fără niciun apel la curier. */
  const { account, config, def, ctx } = await platformCourierContext(db, blockers);

  const courierReady = !!(def && ctx);

  /* ----- date live de la curier (doar citiri, cache-uite în provider) -----
   * liveMode "ifNoBlockers" (la creare): cu blockere locale (adresă,
   * greutate, plată...) curierul NU e contactat deloc. */
  let service = null;
  let pickupPoint = null;
  let contactPersonId = null;
  // ID-urile Sameday ale adresei de ridicare a VENDORULUI (thirdParty) - confirmate în nomenclator
  let pickupPlace = null;

  const contactCourier = courierReady && (liveMode === "always" || blockers.length === 0);

  if (contactCourier) {
    try {
      const [services, pickupPoints] = await Promise.all([def.listServices(ctx), def.listPickupPoints(ctx)]);

      if (isOoh) {
        // easybox / Sameday Point: serviciul ACTIV al contului pentru metodă (ID configurat
        // explicit - lockerServiceId / pudoServiceId - doar dacă e activ; altfel denumirea documentată)
        const pick = classifySamedayServices(services, {
          serviceId: config.serviceId,
          lockerServiceId: account.publicConfig?.lockerServiceId,
          pudoServiceId: account.publicConfig?.pudoServiceId,
        })[deliveryMethod];
        service = pick ? services.find((s) => String(s.id) === pick.id) || null : null;
        if (!service) {
          blockers.push(
            blocker(
              "service_unavailable",
              deliveryMethod === "LOCKER"
                ? "Serviciul Sameday easybox nu este activ pe contul Artfest. AWB-ul nu poate fi generat momentan."
                : "Serviciul Sameday Point nu este activ pe contul Artfest. AWB-ul nu poate fi generat momentan."
            )
          );
        }
      } else {
        service = pickConfiguredService(services, config.serviceId);
        if (!service) {
          blockers.push(
            blocker(
              "service_unavailable",
              "Serviciul Sameday de livrare la adresă nu este activ pe contul Artfest. AWB-ul nu poate fi generat momentan."
            )
          );
        }
      }
      // serviciile de RETUR (10 / 24) nu se folosesc niciodată pe un Shipment OUTBOUND
      if (service && SAMEDAY_RETURN_SERVICE_IDS.has(String(service.id))) {
        blockers.push(
          blocker("return_service_on_outbound", "Serviciul configurat este un serviciu de retur Sameday; nu se folosește pentru livrarea către client.")
        );
        service = null;
      }

      ({ pickupPoint, contactPersonId } = pickContractPickupPoint(pickupPoints, config, blockers));

      /*
       * Adresa de ridicare a vendorului (thirdPartyPickup = 1) trebuie să aibă
       * județ + localitate VALIDATE în nomenclatorul Sameday (ID-urile din
       * providerRefs, altfel rezolvate după nume). Altfel AWB-ul rămâne blocat:
       * nu există fallback la adresa / punctul Artfest.
       */
      if (pickupParty) {
        const checked = await resolvePickupPlace(def, ctx, pickupParty);
        pickupPlace = checked.place;
        if (checked.blocker) blockers.push(checked.blocker);
      }

      // locația easybox / Sameday Point: revalidată live, fără cache (altfel blocat)
      if (isOoh && oohLastMile != null) {
        const checked = await revalidateOohLocation(def, ctx, oohLastMile, expectedOohType);
        if (checked) blockers.push(checked);
      }
    } catch (e) {
      blockers.push(courierReadBlocker(e, account));
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
    deliveryMethod,
    lockerId: shipment.lockerId || null,
    // easybox / Sameday Point din snapshot (null la livrarea la adresă)
    ooh: isOoh ? oohSnapshot : null,
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
    recipientSource,
    deliveryAddress: (isOoh
      ? [oohSnapshot?.name ? `${deliveryMethod === "LOCKER" ? "easybox" : "Sameday Point"} ${oohSnapshot.name}` : null, recipient.address, recipient.city, recipient.county]
      : [recipient.address, recipient.city, recipient.county, recipient.postalCode]
    )
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
      pickupPlace,
      parcels,
      cod,
      recipient,
      recipientPlace,
      recipientSource,
      oohLastMile,
      deliveryMethod,
      clientReference,
      observation,
      method,
    },
  };
}

const OOH_MESSAGES = {
  not_found: "Punctul easybox / Sameday Point ales de client nu mai există la Sameday. AWB-ul nu poate fi generat; contactează clientul sau trimite fără integrare.",
  hidden: "Punctul easybox / Sameday Point ales de client nu mai este disponibil. AWB-ul nu poate fi generat; contactează clientul sau trimite fără integrare.",
  type: "Punctul ales de client nu mai corespunde metodei de livrare (easybox / Sameday Point). AWB-ul nu poate fi generat; contactează suportul Artfest.",
  unverified: "Nu am putut verifica acum la Sameday punctul de livrare ales de client. AWB-ul nu se generează către o locație neverificată; încearcă din nou peste câteva minute.",
};

/**
 * Locația easybox / Sameday Point verificată punctual la Sameday (fără cache):
 * trebuie să existe, să fie vizibilă clientului (clientVisible = 1) și să aibă
 * tipul metodei (0 easybox, 1 PUDO). Sameday indisponibil -> blocat (nu se
 * trimite AWB către o locație neverificată și nu se trece pe livrare la adresă).
 * @returns {Promise<Object|null>} blocker sau null dacă locația e validă
 */
export async function revalidateOohLocation(def, ctx, oohId, expectedOohType) {
  if (typeof def?.findOohLocation !== "function") return blocker("ooh_location_unverified", OOH_MESSAGES.unverified);
  let loc;
  try {
    loc = await def.findOohLocation(ctx, oohId);
  } catch (e) {
    console.error("[awb] revalidarea locației OOH a eșuat:", isCourierError(e) ? e.code : e?.name || "Error");
    return blocker("ooh_location_unverified", OOH_MESSAGES.unverified);
  }
  if (!loc) return blocker("ooh_location_not_found", OOH_MESSAGES.not_found);
  if (!loc.clientVisible) return blocker("ooh_location_unavailable", OOH_MESSAGES.hidden);
  if (Number(loc.oohType) !== Number(expectedOohType)) return blocker("ooh_location_type_mismatch", OOH_MESSAGES.type);
  return null;
}

const PICKUP_PLACE_MESSAGES = {
  unverified: "Nu am putut verifica acum adresa de ridicare în nomenclatorul Sameday. Încearcă din nou peste câteva minute.",
  unresolved: "Județul sau localitatea din adresa de ridicare nu au fost găsite în nomenclatorul Sameday. Verifică adresa de ridicare.",
};

/**
 * Județul + localitatea adresei de ridicare a VENDORULUI, validate în nomenclator
 * (ID-urile din providerRefs, altfel după nume). Fără ID-uri sigure -> blocker;
 * NU există fallback la adresa / punctul Artfest.
 * @returns {Promise<{ place: {countyId, cityId}|null, blocker: Object|null }>}
 */
export async function resolvePickupPlace(def, ctx, pickupParty) {
  if (typeof def?.resolvePlace !== "function") return { place: null, blocker: null };
  const place = await def.resolvePlace(ctx, {
    county: pickupParty?.county,
    city: pickupParty?.city,
    countyId: pickupParty?.samedayCountyId ?? null,
    cityId: pickupParty?.samedayCityId ?? null,
  });
  if (place?.countyId && place?.cityId) return { place: { countyId: place.countyId, cityId: place.cityId }, blocker: null };
  return {
    place: null,
    blocker:
      place?.status === "unavailable"
        ? blocker("pickup_address_unverified", PICKUP_PLACE_MESSAGES.unverified, "pickupAddress")
        : blocker("pickup_address_unresolved", PICKUP_PLACE_MESSAGES.unresolved, "pickupAddress"),
  };
}

/* thirdParty pentru Sameday: datele vendorului + DOAR ID-urile confirmate (nume păstrate ca countyString / cityString) */
export function thirdPartyWithPlace(pickupParty, pickupPlace) {
  const { samedayCountyId: _c, samedayCityId: _ci, ...party } = pickupParty || {};
  return pickupPlace?.countyId && pickupPlace?.cityId ? { ...party, countyId: pickupPlace.countyId, cityId: pickupPlace.cityId } : party;
}

/* destinatarul: ID-urile doar dacă s-au rezolvat; altfel numele (Sameday mapează / verificare manuală - PDF v3.6) */
function placeIds(place) {
  return place?.countyId && place?.cityId ? { countyId: place.countyId, cityId: place.cityId } : {};
}

export async function previewAwb(args, db = defaultDb) {
  // vendor: actor fix (nu din argumente) - returul rămâne „doar Admin”
  const { preview } = await buildAwbPlan({ ...args, actor: "vendor" }, db);
  return preview;
}

/** ADMIN: previzualizarea AWB-ului de RETUR (aceleași blockere ca la creare). */
export async function previewReturnAwbForAdmin({ shipmentId }, db = defaultDb) {
  const shipment = await db.shipment.findUnique({
    where: { id: String(shipmentId || "") },
    select: { id: true, vendorId: true, direction: true },
  });
  if (!shipment || shipment.direction !== "RETURN") throw new AwbNotFoundError();
  const { preview } = await buildAwbPlan({ vendorId: shipment.vendorId, shipmentId: shipment.id, actor: "admin" }, db);
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
  // vendor: Shipment RETURN -> blocat în plan (return_awb_admin_only), fără POST
  return createAwbInternal({ vendorId, userId, shipmentId, input, idempotencyKey, actor: "vendor" }, db);
}

/**
 * ADMIN: AWB-ul de RETUR standard (service 10) pe contractul Artfest, pentru
 * un Shipment RETURN. Aceleași garanții ca la vendor (rezervare atomică,
 * idempotență, UNKNOWN + recuperare). După AWB CONFIRMAT: cererea trece în
 * PICKUP_REQUESTED + notificări deduplicate (onReturnAwbConfirmed).
 * Pe un Shipment OUTBOUND -> 404 (fluxul outbound rămâne al vendorului).
 */
export async function createReturnAwbForAdmin({ shipmentId, adminUserId = null, idempotencyKey }, db = defaultDb) {
  assertCourierAwbLiveEnabled();
  const shipment = await db.shipment.findUnique({
    where: { id: String(shipmentId || "") },
    select: { id: true, vendorId: true, direction: true },
  });
  if (!shipment || shipment.direction !== "RETURN") throw new AwbNotFoundError();
  const result = await createAwbInternal(
    { vendorId: shipment.vendorId, userId: adminUserId, shipmentId: shipment.id, input: {}, idempotencyKey, actor: "admin" },
    db
  );
  if (result?.awb?.status === "CREATED") {
    await onReturnAwbConfirmed({ db, shipmentId: shipment.id, awbId: result.awb.id, awbNumber: result.awb.awbNumber });
  }
  return result;
}

async function createAwbInternal({ vendorId, userId = null, shipmentId, input = {}, idempotencyKey, actor }, db) {
  // AWB real oprit (COURIER_AWB_LIVE_ENABLED): fără citiri la curier, fără rezervare
  assertCourierAwbLiveEnabled();
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
  const { preview, internal } = await buildAwbPlan({ vendorId, shipmentId, input, liveMode: "ifNoBlockers", actor }, db);
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
    pickupPlace,
    parcels,
    cod,
    recipient,
    recipientPlace: snapshotPlace,
    oohLastMile,
    clientReference,
    observation,
    returnGuard = null,
  } = internal;
  const serviceLabel = [service.name, service.code ? `(${service.code})` : ""].filter(Boolean).join(" ").slice(0, 120);

  if (def.resolvePlace && (!pickupPlace?.countyId || !pickupPlace?.cityId)) {
    // apărare: fără ID-uri validate pentru adresa de ridicare nu se creează AWB
    // (înainte de rezervare - altfel ar rămâne un REQUESTED fără niciun apel)
    throw new AwbBlockedError(
      [blocker("pickup_address_unresolved", PICKUP_PLACE_MESSAGES.unresolved, "pickupAddress")],
      preview
    );
  }

  // 2) rezervare atomică: maxim un AWB activ per Shipment
  let reservation;
  try {
    reservation = await db.$transaction(async (tx) => {
      if (returnGuard) await assertReturnPayloadUnchanged(tx, shipment.id, returnGuard);
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
          // mediul Sameday în care se creează AWB-ul (verificat la orice operație ulterioară)
          providerMeta: keepEnvironment(ctx?.publicConfig),
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

  // ID-urile Sameday de județ / localitate ale destinatarului: din snapshot-ul de la
  // checkout; altfel după nume (doar potrivire exactă; altfel numele). Adresa
  // vendorului e deja validată în plan (pickupPlace).
  // easybox / Sameday Point: destinația e oohLastMile (fără adresa / ID-urile clientului)
  const recipientPlace =
    oohLastMile != null ? null : snapshotPlace || (def.resolvePlace ? await def.resolvePlace(ctx, recipient) : null);

  /*
   * 2b) RETRY cu aceeași referință (încercare anterioară eliberată după
   * „negăsit” la Sameday, respinsă sau rezolvată de admin): întâi întrebăm
   * din nou Sameday - un POST anterior procesat cu întârziere ar fi creat
   * totuși AWB-ul. Găsit -> îl adoptăm, fără POST. Verificare imposibilă ->
   * nimic trimis, rezervarea se eliberează și se poate reîncerca.
   */
  const earlierAttempts = await db.courierAwb.count({
    where: { shipmentId: shipment.id, clientReference, id: { not: reservation.id } },
  });
  let result;
  let recovered = null;
  if (earlierAttempts > 0) {
    const precheck = await lookupByReference(def, ctx, clientReference);
    if (precheck.status === "found") {
      result = precheck.result;
      recovered = "recovered_before_retry";
    } else if (precheck.status === "error") {
      await db.courierAwb
        .update({
          where: { id: reservation.id },
          data: {
            status: "FAILED",
            activeShipmentId: null,
            errorMessage: "Verificarea la Sameday înainte de reîncercare a eșuat; nu s-a trimis nicio cerere de AWB.",
            providerMeta: { ...keepEnvironment(reservation.providerMeta), errorCode: "awb_recheck_failed", recoveryCheck: "error", recoveryCheckedAt: new Date().toISOString() },
          },
        })
        .catch((dbErr) => console.error("[awb] nu am putut elibera rezervarea:", reservation.id, dbErr?.code || dbErr?.name || "Error"));
      throw new CourierError(
        "awb_recheck_failed",
        "Nu am putut verifica la Sameday dacă încercarea anterioară a creat AWB-ul. Nu s-a generat nimic; încearcă din nou peste câteva minute.",
        { httpStatus: 503 }
      );
    }
  }

  // 3) apelul către curier - în afara oricărei tranzacții
  if (!result) {
    try {
      result = await def.createShipment(ctx, {
        clientReference,
        serviceId: service.id,
        pickupPointId: pickupPoint.id,
        contactPersonId,
        parcels: parcels.list,
        codAmount: cod.codAmount,
        declaredValue: 0,
        recipient: { ...recipient, ...placeIds(recipientPlace) },
        thirdParty: thirdPartyWithPlace(pickupParty, pickupPlace),
        oohLastMile,
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
      recovered = "recovered_by_reference";
    }
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
    audit: recovered ? { action: recovered, actor: "system" } : null,
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
    ...keepEnvironment(row.providerMeta),
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
    ...keepEnvironment(reservation.providerMeta),
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
  return recoverUnknownAwbInternal({ vendorId, userId, shipmentId, actor: "vendor" }, db);
}

/**
 * ADMIN: „Verifică din nou la Sameday” pentru AWB-ul de RETUR neconfirmat
 * (UNKNOWN). Nu creează niciodată un AWB; AWB găsit -> CREATED + tranziția
 * cererii (onReturnAwbConfirmed).
 */
export async function adminRecoverReturnAwb({ shipmentId, adminUserId = null }, db = defaultDb) {
  const shipment = await db.shipment.findUnique({
    where: { id: String(shipmentId || "") },
    select: { id: true, vendorId: true, direction: true },
  });
  if (!shipment || shipment.direction !== "RETURN") throw new AwbNotFoundError();
  const out = await recoverUnknownAwbInternal(
    { vendorId: shipment.vendorId, userId: adminUserId, shipmentId: shipment.id, actor: "admin" },
    db
  );
  if (out.outcome === "created") {
    await onReturnAwbConfirmed({ db, shipmentId: shipment.id, awbId: out.awb?.id, awbNumber: out.awb?.awbNumber });
  }
  return out;
}

async function recoverUnknownAwbInternal({ vendorId, userId = null, shipmentId, actor }, db) {
  const shipment = await db.shipment.findFirst({
    where: { id: String(shipmentId || ""), vendorId },
    select: { id: true, awb: true, direction: true },
  });
  if (!shipment) throw new AwbNotFoundError();
  if (shipment.direction === "RETURN" && actor !== "admin") throw returnAwbAdminOnlyError();

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
      audit: { action, actor, userId },
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

  // mediul AWB-ului = mediul contului, permis acum (altfel nicio căutare la Sameday)
  assertAwbEnvironment(row, account);
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
        providerMeta: withAudit(row.providerMeta, { action: "recovered_not_found", actor, userId }),
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

/**
 * Estimarea costului transportului pentru expediere (POST /api/awb/estimate-cost),
 * cu aceleași date ca la creare (contul Artfest, ridicare de la vendor).
 * INTERN: pentru previzualizare / admin - nu e expus vendorului și nu e
 * folosit în checkout (costul e al contractului Artfest). Nu creează nimic.
 * @returns {Promise<{amount:number, currency:string|null, time:number|null}>}
 */
export async function estimateAwbCost({ vendorId, shipmentId, input = {} }, db = defaultDb) {
  const { preview, internal } = await buildAwbPlan({ vendorId, shipmentId, input, liveMode: "ifNoBlockers" }, db);
  // existența unui AWB nu împiedică estimarea; celelalte blockere da
  const blockers = preview.blockers.filter((b) => !["awb_exists", "awb_in_progress", "awb_status_unknown"].includes(b.code));
  if (blockers.length) throw new AwbBlockedError(blockers, preview);

  const { def, ctx, service, pickupPoint, contactPersonId, pickupParty, pickupPlace, parcels, cod, recipient, recipientPlace: snapshotPlace, oohLastMile, observation } = internal;
  if (typeof def?.estimateCost !== "function") {
    throw new CourierError("estimate_not_supported", "Estimarea costului nu este disponibilă pentru acest curier.", {
      httpStatus: 409,
    });
  }
  // adresa vendorului e deja validată în plan (blocker dacă nu); destinatarul se rezolvă acum
  const recipientPlace = snapshotPlace || (def.resolvePlace ? await def.resolvePlace(ctx, recipient) : null);
  return def.estimateCost(ctx, {
    serviceId: service.id,
    pickupPointId: pickupPoint.id,
    contactPersonId,
    parcels: parcels.list,
    codAmount: cod.codAmount,
    declaredValue: 0,
    recipient: { ...recipient, ...placeIds(recipientPlace) },
    thirdParty: thirdPartyWithPlace(pickupParty, pickupPlace),
    oohLastMile,
    observation,
  });
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
      direction: true,
      handedOverAt: true,
      deliveredAt: true,
      returnedAt: true,
      cancelReason: true,
      order: { select: { status: true } },
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
      // pentru „ce urmează” în panoul vendorului (preluat / livrat) - doar starea
      // locală, actualizată de căile existente (manual / status-sync)
      status: shipment.status || null,
      handedOverAt: shipment.handedOverAt || null,
      deliveredAt: shipment.deliveredAt || null,
    },
    latest: toPublicAwb(latest),
    active,
    // anulare în curs / neconfirmată: butonul normal nu mai trimite DELETE
    cancel: artfestAwb ? publicCancel(latest) : null,
    // aceleași condiții locale ca în cancelAwbForShipment (curierul decide
    // final); rămâne valabil și pentru o comandă deja anulată cu AWB activ
    canCancel:
      artfestAwb &&
      !awbCancelStateOf(latest) &&
      isAwbCancellableShipment(shipment, shipment.order?.status),
  };
}

// ruta internă a etichetei (Shipment.labelUrl pentru AWB-urile generate de Artfest)
export function isArtfestLabelUrl(shipmentId, labelUrl) {
  return !!labelUrl && labelUrl === labelPath(shipmentId);
}

// erorile curierului la descărcarea etichetei -> mesaje pentru vendor (fără răspunsul brut)
function labelError(e) {
  if (e?.providerStatus === 404) {
    return new CourierError(
      "awb_label_not_found",
      "Sameday nu are eticheta pentru acest AWB (poate a fost anulat). Verifică AWB-ul sau contactează suportul Artfest.",
      { httpStatus: 404 }
    );
  }
  if (e instanceof CourierAuthError) {
    return new CourierError(
      "courier_auth_failed",
      "Nu am putut descărca eticheta: autentificarea la Sameday a eșuat. Echipa Artfest trebuie să verifice contul.",
      { httpStatus: 502 }
    );
  }
  if (e instanceof CourierTimeoutError) {
    return new CourierError("courier_timeout", "Sameday nu a răspuns la timp. Încearcă din nou peste câteva momente.", { httpStatus: 504 });
  }
  if (isCourierError(e)) {
    return new CourierError("courier_unavailable", "Eticheta nu poate fi descărcată acum de la Sameday. Încearcă din nou mai târziu.", { httpStatus: 502 });
  }
  return e;
}

/**
 * Eticheta PDF pentru AWB-ul CREATED al Shipment-ului vendorului, descărcată
 * de la curier cu contul care l-a creat (fără stocare la noi). AWB în curs /
 * neconfirmat (REQUESTED / UNKNOWN) -> 409, fără apel la curier; eticheta
 * devine disponibilă automat după ce recuperarea salvează numărul (CREATED).
 * @returns {Promise<{buffer:Buffer, contentType:string, awbNumber:string}|null>}
 *          null = nu există AWB generat de Artfest (fallback pe labelUrl manual)
 */
export async function getAwbLabel({ vendorId, shipmentId, format }, db = defaultDb) {
  const shipment = await db.shipment.findFirst({
    where: { id: String(shipmentId || ""), vendorId },
    select: { id: true, vendorId: true, awb: true },
  });
  if (!shipment) throw new AwbNotFoundError();
  return labelForShipment(db, shipment, format);
}

/**
 * Eticheta AWB-ului de RETUR pentru CLIENTUL care a cerut returul (ex. o
 * imprimă pentru curier). Doar cererile lui (userId); doar un AWB confirmat
 * al unui Shipment RETURN al cererii. Altfel 404 - fără a dezvălui altceva.
 */
export async function getReturnAwbLabelForClient({ userId = null, guestOrderId = null, returnRequestId, format }, db = defaultDb) {
  // cont: cererile lui; guest: cererile comenzii guest deja verificate prin token (fără user)
  const owner = userId
    ? { userId: String(userId) }
    : guestOrderId
      ? { orderId: String(guestOrderId), userId: null }
      : null;
  if (!owner) throw new CourierError("return_label_unavailable", "Eticheta de retur nu este disponibilă.", { httpStatus: 404 });
  const rr = await db.returnRequest.findFirst({
    where: { id: String(returnRequestId || ""), ...owner },
    select: { id: true, returnShipments: { where: { direction: "RETURN" }, select: { id: true } } },
  });
  const shipmentIds = (rr?.returnShipments || []).map((s) => s.id);
  if (!shipmentIds.length) throw new CourierError("return_label_unavailable", "Eticheta de retur nu este disponibilă.", { httpStatus: 404 });

  const row = await db.courierAwb.findFirst({
    where: { activeShipmentId: { in: shipmentIds }, status: "CREATED" },
    select: { shipmentId: true },
  });
  if (!row) throw new CourierError("return_label_unavailable", "Eticheta de retur nu este disponibilă.", { httpStatus: 404 });

  const shipment = await db.shipment.findUnique({ where: { id: row.shipmentId }, select: { id: true, vendorId: true, awb: true } });
  const label = await labelForShipment(db, shipment, format);
  if (!label) throw new CourierError("return_label_unavailable", "Eticheta de retur nu este disponibilă.", { httpStatus: 404 });
  return label;
}

/** Eticheta oricărui AWB generat de Artfest (ADMIN). null = fără AWB Artfest. */
export async function getAwbLabelForAdmin({ shipmentId, format }, db = defaultDb) {
  const shipment = await db.shipment.findUnique({
    where: { id: String(shipmentId || "") },
    select: { id: true, vendorId: true, awb: true },
  });
  if (!shipment) throw new AwbNotFoundError();
  return labelForShipment(db, shipment, format);
}

// eticheta PDF a AWB-ului CREATED al unui Shipment (outbound sau retur); accesul e verificat de apelant
async function labelForShipment(db, shipment, format) {
  const vendorId = shipment.vendorId;
  const active = await findActiveCourierAwb(db, shipment.id);
  if (active && active.status !== "CREATED") {
    throw new AwbConflictError(
      "awb_not_confirmed",
      "AWB-ul nu este încă confirmat de Sameday. Eticheta va fi disponibilă după confirmare."
    );
  }

  const row = await db.courierAwb.findFirst({
    where: { shipmentId: shipment.id, status: "CREATED" },
    orderBy: { createdAt: "desc" },
  });
  if (!row || !row.awbNumber) return null;

  // anulare în curs / neconfirmată: AWB-ul poate fi deja anulat la curier -
  // fără etichetă (coletul nu trebuie predat cu un AWB posibil anulat)
  const cancelState = awbCancelStateOf(row);
  if (cancelState) {
    throw new AwbConflictError(
      cancelState === "IN_PROGRESS" ? "awb_cancel_in_progress" : "awb_cancel_unknown",
      cancelState === "IN_PROGRESS" ? AWB_CANCEL_IN_PROGRESS_MESSAGE : AWB_CANCEL_UNKNOWN_MESSAGE
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

  assertAwbEnvironment(row, account);
  const def = getCourierProvider(account.provider);
  const ctx = { accountId: account.id, credentials: openCredentials(account), publicConfig: account.publicConfig || {} };
  let label;
  try {
    label = await def.getLabel(ctx, row.awbNumber, { format });
  } catch (e) {
    throw labelError(e);
  }
  return { ...label, awbNumber: row.awbNumber };
}

/* ----- anulare AWB (vendor + admin) ----- */

/*
 * Ordinea (aceeași pentru vendor și admin):
 *   1. verificări locale (AWB CREATED, colet nepredat, fără anulare în curs
 *      / neconfirmată), contul de curier și credentialele;
 *   2. REZERVARE condiționată: cancelState = IN_PROGRESS doar dacă rândul e
 *      încă CREATED și neschimbat (updatedAt) -> o a doua cerere simultană
 *      primește 409 awb_cancel_in_progress, curierul primește UN singur DELETE;
 *   3. DELETE la curier (fără reîncercare automată);
 *   4. abia după confirmare (204): CANCELLED + eliberare + golirea câmpurilor
 *      Shipment care aparțin ACESTUI AWB - actualizare condiționată.
 * Rezultatul curierului:
 *   refuz definitiv (400 / 405) -> awb_not_cancellable, starea revine (CREATED);
 *   404                         -> awb_not_found_at_courier, starea revine;
 *   credentiale respinse        -> cererea nu a fost procesată, starea revine;
 *   timeout / conexiune / 5xx   -> rezultat INCERT: cancelState = UNKNOWN,
 *                                  AWB-ul rămâne blocant, verificare Admin.
 * După o încercare incertă, un 404 / 405 NU dovedește că AWB-ul e activ (poate
 * l-a anulat chiar încercarea anterioară) -> starea rămâne UNKNOWN.
 * Order.status / Shipment.status NU se schimbă la anularea AWB-ului.
 */

const AWB_CHANGED_MESSAGE = "AWB-ul a fost modificat între timp. Reîncarcă pagina.";

function cancelInProgressError() {
  return new AwbConflictError("awb_cancel_in_progress", AWB_CANCEL_IN_PROGRESS_MESSAGE);
}

function cancelUnknownError(message = AWB_CANCEL_UNKNOWN_MESSAGE) {
  return new AwbConflictError("awb_cancel_unknown", message);
}

// rezultatul unui DELETE eșuat: "refused" | "not_found" | "auth" | "uncertain"
function classifyCancelFailure(e) {
  if (e?.code === "awb_not_cancellable") {
    return e.message === AWB_NOT_FOUND_AT_COURIER_MESSAGE ? "not_found" : "refused";
  }
  // credentiale respinse (401 după reautentificare / 403): cererea nu a fost procesată
  if (e instanceof CourierAuthError) return "auth";
  // timeout, conexiune întreruptă, 5xx, răspuns neașteptat
  return "uncertain";
}

async function cancelProviderContext(db, row, vendorId) {
  const account = row.courierAccountId ? await findAwbAccount(db, row, vendorId) : null;
  if (!account || account.disabledAt) {
    throw new CourierError(
      "courier_account_unavailable",
      "Contul de curier cu care a fost generat AWB-ul nu mai este conectat.",
      { httpStatus: 409 }
    );
  }
  // înainte de rezervarea anulării: mediu greșit / necunoscut -> nimic schimbat, niciun apel
  assertAwbEnvironment(row, account);
  const def = getCourierProvider(account.provider);
  if (!def.capabilities?.cancelShipment || typeof def.cancelShipment !== "function") {
    throw new CourierError("cancel_not_supported", "Anularea AWB nu este disponibilă pentru acest curier.", {
      httpStatus: 409,
    });
  }
  const ctx = { accountId: account.id, credentials: openCredentials(account), publicConfig: account.publicConfig || {} };
  return { def, ctx };
}

/*
 * „În curs” rămas după o repornire (mai vechi decât pragul) devine persistent
 * UNKNOWN - condiționat, deci sigur la concurență. Întoarce rândul actual.
 */
async function persistInterruptedCancel(db, row) {
  const meta = metaOf(row);
  if (meta.cancelState !== "IN_PROGRESS" || awbCancelStateOf(row) !== "UNKNOWN") return row;
  await db.courierAwb.updateMany({
    where: { id: row.id, status: "CREATED", updatedAt: row.updatedAt },
    data: {
      providerMeta: withAudit(
        cancelUnknownMeta(meta, {
          errorCode: "cancel_interrupted",
          attemptId: meta.cancelAttemptId,
          attemptedAt: meta.cancelAttemptedAt,
        }),
        { action: "cancel_interrupted_to_unknown", actor: "system" }
      ),
    },
  });
  return db.courierAwb.findUnique({ where: { id: row.id } });
}

async function reserveCancel(db, row, { actor, userId, note }) {
  const attemptId = crypto.randomUUID();
  const res = await db.courierAwb.updateMany({
    where: { id: row.id, status: "CREATED", updatedAt: row.updatedAt },
    data: {
      providerMeta: withAudit(
        {
          ...withoutCancelState(row.providerMeta),
          cancelState: "IN_PROGRESS",
          cancelAttemptId: attemptId,
          cancelAttemptedAt: new Date().toISOString(),
        },
        { action: "cancel_requested", actor, userId: userId || null, ...(note ? { note } : {}) }
      ),
    },
  });
  if (!res.count) {
    const state = awbCancelStateOf(await db.courierAwb.findUnique({ where: { id: row.id } }));
    if (state === "IN_PROGRESS") throw cancelInProgressError();
    if (state === "UNKNOWN") throw cancelUnknownError();
    throw new AwbConflictError("awb_changed", AWB_CHANGED_MESSAGE);
  }
  const reserved = await db.courierAwb.findUnique({ where: { id: row.id } });
  if (!reserved || metaOf(reserved).cancelAttemptId !== attemptId) {
    throw new AwbConflictError("awb_changed", AWB_CHANGED_MESSAGE);
  }
  return reserved;
}

// rezultat incert (sau neconcludent după o încercare incertă): UNKNOWN, blocant
async function markCancelUnknown(db, reserved, { errorCode, actor, userId, action = "cancel_unknown" }) {
  const meta = metaOf(reserved);
  try {
    const res = await db.courierAwb.updateMany({
      where: { id: reserved.id, status: "CREATED", updatedAt: reserved.updatedAt },
      data: {
        providerMeta: withAudit(
          cancelUnknownMeta(meta, { errorCode, attemptId: meta.cancelAttemptId, attemptedAt: meta.cancelAttemptedAt }),
          { action, actor, userId: userId || null, errorCode }
        ),
      },
    });
    // rândul modificat între timp: „în curs” rămas devine oricum UNKNOWN după prag
    if (!res.count) console.error("[awb] anulare incertă nesalvată (rând modificat):", reserved.id);
  } catch (e) {
    console.error("[awb] anulare incertă nesalvată:", reserved.id, e?.code || e?.name || "Error");
  }
}

// refuz SIGUR al curierului la o primă încercare: starea revine la CREATED
async function releaseCancel(db, reserved, { reason, actor, userId }) {
  try {
    const res = await db.courierAwb.updateMany({
      where: { id: reserved.id, status: "CREATED", updatedAt: reserved.updatedAt },
      data: {
        providerMeta: withAudit(withoutCancelState(reserved.providerMeta), {
          action: "cancel_refused",
          actor,
          userId: userId || null,
          reason,
        }),
      },
    });
    if (!res.count) console.error("[awb] eliberarea anulării nesalvată (rând modificat):", reserved.id);
  } catch (e) {
    console.error("[awb] eliberarea anulării nesalvată:", reserved.id, e?.code || e?.name || "Error");
  }
}

/*
 * CANCELLED + eliberare + golirea câmpurilor Shipment ale ACESTUI AWB, totul
 * condiționat pe rândul rezervat (status + updatedAt). courierProvider /
 * serviciu / colete rămân (precompletare pentru un AWB nou), ca înainte.
 */
async function saveCancelledAwb(db, reserved, { shipmentId, audit }) {
  return db.$transaction(async (tx) => {
    const res = await tx.courierAwb.updateMany({
      where: { id: reserved.id, status: "CREATED", updatedAt: reserved.updatedAt },
      data: {
        status: "CANCELLED",
        activeShipmentId: null,
        errorMessage: null,
        providerMeta: withAudit(withoutCancelState(reserved.providerMeta), audit),
      },
    });
    if (!res.count) throw new AwbConflictError("awb_changed", AWB_CHANGED_MESSAGE);
    // doar dacă Shipment-ul încă indică ACEST AWB
    await tx.shipment.updateMany({
      where: { id: shipmentId, awb: reserved.awbNumber },
      data: { awb: null, labelUrl: null, trackingUrl: null },
    });
    return tx.courierAwb.findUnique({ where: { id: reserved.id } });
  });
}

async function runAwbCancel(db, { row, shipment, vendorId, actor, userId = null, note = null, previouslyUncertain = false }) {
  const { def, ctx } = await cancelProviderContext(db, row, vendorId);
  const reserved = await reserveCancel(db, row, { actor, userId, note });

  try {
    await def.cancelShipment(ctx, row.awbNumber);
  } catch (e) {
    const outcome = classifyCancelFailure(e);

    if (outcome === "uncertain") {
      await markCancelUnknown(db, reserved, { errorCode: e?.code || e?.name || "unknown", actor, userId });
      console.error("[awb] anulare cu rezultat incert:", row.id, e?.code || e?.name || "Error");
      throw cancelUnknownError();
    }

    if (previouslyUncertain && outcome !== "auth") {
      // 404 / 405 după o încercare incertă: poate chiar acea încercare l-a anulat
      await markCancelUnknown(db, reserved, {
        errorCode: outcome === "not_found" ? "retry_not_found" : "retry_not_cancellable",
        actor,
        userId,
        action: "cancel_retry_inconclusive",
      });
      throw cancelUnknownError(
        "Sameday a respins o nouă anulare, dar după încercarea anterioară incertă asta nu confirmă dacă AWB-ul mai este activ. Verifică AWB-ul în contul Sameday și rezolvă manual."
      );
    }

    if (previouslyUncertain) {
      // credentiale respinse: nimic nou aflat - rămâne UNKNOWN
      await markCancelUnknown(db, reserved, { errorCode: e.code, actor, userId, action: "cancel_retry_failed" });
      throw e;
    }

    await releaseCancel(db, reserved, { reason: outcome, actor, userId });
    if (outcome === "not_found") {
      throw new CourierError("awb_not_found_at_courier", AWB_NOT_FOUND_AT_COURIER_MESSAGE, { httpStatus: 409 });
    }
    if (outcome === "refused") {
      throw new CourierError("awb_not_cancellable", e.message, { httpStatus: 409 });
    }
    throw e;
  }

  try {
    const awbRow = await saveCancelledAwb(db, reserved, {
      shipmentId: shipment.id,
      audit: { action: "cancelled", actor, userId: userId || null, ...(note ? { note } : {}) },
    });
    console.info("[awb] AWB anulat:", row.id, "actor:", actor);
    return { awb: actor === "admin" ? toAdminAwb(awbRow) : toPublicAwb(awbRow) };
  } catch (e) {
    // anulat la curier (204), dar nesalvat la noi: rămâne blocant, cu verificare
    console.error("[awb] AWB anulat la curier, dar salvarea a eșuat:", row.id, e?.code || e?.name || "Error");
    await markCancelUnknown(db, reserved, {
      errorCode: "cancel_confirmed_save_failed",
      actor,
      userId,
      action: "cancel_saved_partially",
    });
    throw new CourierError(
      "awb_cancel_saved_partially",
      "AWB-ul a fost anulat la curier, dar nu s-a salvat complet în Artfest. Contactează suportul.",
      { httpStatus: 500 }
    );
  }
}

/**
 * Anulează AWB-ul CREATED al expedierii vendorului, DOAR înainte de
 * predarea coletului (și pentru o comandă deja anulată, cât AWB-ul e activ).
 * O anulare în curs / neconfirmată NU mai trimite DELETE (fără retry orb).
 */
export async function cancelAwbForShipment({ vendorId, userId = null, shipmentId }, db = defaultDb) {
  const shipment = await db.shipment.findFirst({
    where: { id: String(shipmentId || ""), vendorId },
    select: AWB_CANCEL_SHIPMENT_SELECT,
  });
  if (!shipment) throw new AwbNotFoundError();
  // AWB-ul de retur e al Artfest: anularea e din Admin (adminCancelAwb)
  if (shipment.direction === "RETURN") throw returnAwbAdminOnlyError();

  let row = await findActiveCourierAwb(db, shipment.id);
  if (!row || row.status !== "CREATED" || !row.awbNumber) {
    throw new AwbConflictError("awb_not_cancellable_state", "Nu există un AWB generat care să poată fi anulat.");
  }

  row = await persistInterruptedCancel(db, row);
  const cancelState = awbCancelStateOf(row);
  if (cancelState === "IN_PROGRESS") throw cancelInProgressError();
  if (cancelState === "UNKNOWN") throw cancelUnknownError();

  if (!isAwbCancellableShipment(shipment, shipment.order?.status)) {
    throw new AwbConflictError(
      "awb_already_handed_over",
      "Coletul a fost deja predat curierului; AWB-ul nu mai poate fi anulat din Artfest."
    );
  }

  return runAwbCancel(db, { row, shipment, vendorId, actor: "vendor", userId });
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
    // anulare în curs / neconfirmată (UNKNOWN -> rezolvare din Admin)
    cancel: row.status === "CREATED" ? publicCancel(row) : null,
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
  // Shipment RETURN: AWB confirmat manual -> aceeași tranziție ca la generare (no-op pe OUTBOUND)
  await onReturnAwbConfirmed({ db, shipmentId: row.shipmentId, awbId: row.id, awbNumber: number });
  const [updated, freshShipment] = await Promise.all([
    db.courierAwb.findUnique({ where: { id: row.id } }),
    db.shipment.findUnique({ where: { id: row.shipmentId }, select: { awb: true, trackingUrl: true } }),
  ]);
  return { awb: toAdminAwb(updated, freshShipment) };
}

/* ----- admin: anularea AWB și rezolvarea anulărilor neconfirmate ----- */

async function loadAdminCancelRow(db, { shipmentId, awbId }) {
  const row = await db.courierAwb.findFirst({
    where: { id: String(awbId || ""), shipmentId: String(shipmentId || "") },
  });
  if (!row) throw new AwbAdminNotFoundError();
  return row;
}

/**
 * Anulare din Admin (acțiune manuală, o singură încercare - fără retry
 * automat). Pe un AWB cu anulare neconfirmată (UNKNOWN) e „Reîncearcă
 * anularea”: doar 204 confirmă; 404 / 405 / timeout lasă starea UNKNOWN.
 */
export async function adminCancelAwb({ shipmentId, awbId, note, adminUserId }, db = defaultDb) {
  let row = await loadAdminCancelRow(db, { shipmentId, awbId });
  if (row.status !== "CREATED" || !row.awbNumber || row.activeShipmentId !== row.shipmentId) {
    throw new AwbConflictError("awb_not_cancellable_state", "Nu există un AWB generat care să poată fi anulat.");
  }

  row = await persistInterruptedCancel(db, row);
  const cancelState = awbCancelStateOf(row);
  if (cancelState === "IN_PROGRESS") throw cancelInProgressError();

  const shipment = await db.shipment.findUnique({
    where: { id: row.shipmentId },
    select: AWB_CANCEL_SHIPMENT_SELECT,
  });
  if (!shipment) throw new AwbAdminNotFoundError();
  if (!isAwbCancellableShipment(shipment, shipment.order?.status)) {
    throw new AwbConflictError(
      "awb_already_handed_over",
      "Coletul a fost deja predat curierului; AWB-ul nu mai poate fi anulat din Artfest."
    );
  }

  const cleanNote = String(note || "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const out = await runAwbCancel(db, {
    row,
    shipment,
    vendorId: shipment.vendorId,
    actor: "admin",
    userId: adminUserId || null,
    note: cleanNote,
    previouslyUncertain: cancelState === "UNKNOWN",
  });
  // RETUR: anulare CONFIRMATĂ -> cererea poate reveni în APPROVED + clientul e anunțat
  if (shipment.direction === "RETURN") await onReturnAwbCancelled({ db, awbId: row.id });
  return out;
}

/**
 * Rezolvare manuală (ADMIN) a unei anulări neconfirmate (cancelState UNKNOWN),
 * după verificarea AWB-ului în contul curierului:
 *   outcome "CANCELLED" -> anulat la curier: CANCELLED + eliberare + Shipment golit;
 *   outcome "ACTIVE"    -> AWB-ul e încă activ: starea de anulare se șterge (CREATED).
 * Condiționat pe rândul citit; auditat în providerMeta.audit.
 */
export async function resolveAwbCancel({ shipmentId, awbId, outcome, note, adminUserId }, db = defaultDb) {
  const row = await loadAdminCancelRow(db, { shipmentId, awbId });
  if (row.status !== "CREATED" || awbCancelStateOf(row) !== "UNKNOWN") {
    throw new AwbConflictError(
      "awb_cancel_not_unknown",
      "Doar un AWB cu anulare neconfirmată poate fi rezolvat manual."
    );
  }
  const cleanNote = String(note || "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const audit = { actor: "admin", userId: adminUserId || null, note: cleanNote };

  if (outcome === "CANCELLED") {
    const awbRow = await saveCancelledAwb(db, row, {
      shipmentId: row.shipmentId,
      audit: { ...audit, action: "cancel_resolved_cancelled" },
    });
    console.info("[awb] admin resolve cancel CANCELLED:", row.id, "admin:", adminUserId || "-");
    // RETUR (no-op pe OUTBOUND): aceeași urmare ca la o anulare confirmată direct
    await onReturnAwbCancelled({ db, awbId: row.id });
    return { awb: toAdminAwb(awbRow) };
  }

  if (outcome !== "ACTIVE") {
    throw new CourierValidationError("Alege rezultatul verificării: AWB anulat sau AWB încă activ.", ["outcome"]);
  }

  const res = await db.courierAwb.updateMany({
    where: { id: row.id, status: "CREATED", updatedAt: row.updatedAt },
    data: { providerMeta: withAudit(withoutCancelState(row.providerMeta), { ...audit, action: "cancel_resolved_active" }) },
  });
  if (!res.count) throw new AwbConflictError("awb_changed", AWB_CHANGED_MESSAGE);
  console.info("[awb] admin resolve cancel ACTIVE:", row.id, "admin:", adminUserId || "-");
  const [updated, shipment] = await Promise.all([
    db.courierAwb.findUnique({ where: { id: row.id } }),
    db.shipment.findUnique({ where: { id: row.shipmentId }, select: { awb: true, trackingUrl: true } }),
  ]);
  return { awb: toAdminAwb(updated, shipment) };
}

function returnAwbAdminOnlyError() {
  return new AwbConflictError("return_awb_admin_only", "AWB-ul de retur este gestionat de echipa Artfest.");
}

/*
 * În tranzacția de rezervare a unui AWB de RETUR: cererea blocată (FOR UPDATE -
 * aceeași blocare ca la schimbarea metodei / adresei de către client), apoi
 * amprenta datelor recalculată din DB. Diferită de cea din verificare -> oprire
 * înainte de rezervare și de orice apel la Sameday.
 */
async function assertReturnPayloadUnchanged(tx, shipmentId, guard) {
  await tx.$queryRaw`SELECT "id" FROM "ReturnRequest" WHERE "id" = ${String(guard.returnRequestId)} FOR UPDATE`;
  const [rr, delivery] = await Promise.all([
    tx.returnRequest.findUnique({
      where: { id: String(guard.returnRequestId) },
      select: { returnMethod: true, status: true, costBearer: true, vendorId: true },
    }),
    tx.shipmentDelivery.findUnique({ where: { shipmentId } }),
  ]);
  if (returnPayloadFingerprint(delivery, rr) !== guard.fingerprint) {
    throw new AwbConflictError(
      "return_pickup_changed",
      "Metoda sau adresa de ridicare a returului s-a schimbat în timpul verificării. Verifică din nou AWB-ul înainte de generare."
    );
  }
}
