// backend/src/couriers/samedayReadiness.js
//
// Poate Artfest oferi „Sameday prin Artfest” (ARTFEST_SAMEDAY)? Sursa unică pentru
// checkout / dashboard / Admin - ÎNCĂ NECONECTATĂ (etapa 1: doar pregătită, inactivă).
//
// „Gata” cere TOATE condițiile; o bifă manuală nu e suficientă:
//   1. comutatorul dedicat SAMEDAY_ARTFEST_DELIVERY_ENABLED=true (implicit OPRIT);
//   2. integrarea de curierat pornită + mediul Sameday activ setat;
//   3. contul Artfest (PLATFORM) găsit, ACTIVE, cu credentiale, punct de ridicare și serviciu;
//   4. AWB real permis (COURIER_AWB_LIVE_ENABLED=true);
//   5. confirmarea Admin (publicConfig.awbVerifiedAt) ȘI dovada reală: cel puțin un AWB
//      creat cu succes pe acest cont, în mediul activ;
//   6. nicio respingere PERMANENTĂ de cont/permisiune mai nouă decât ultimul AWB reușit.
// Erorile TEMPORARE (rețea, timeout, 5xx, rezultat necunoscut) NU blochează contul:
// sunt raportate ca „degraded” (checkout-ul le tratează live, cu rezervă).
// Fără apeluri la Sameday - doar DB + env.

import { prisma as defaultDb } from "../db.js";
import { isCourierAwbLiveEnabled } from "./awbLive.js";
import { isCourierIntegrationEnabled } from "./http.js";
import { findPlatformCourierAccount, platformConfig, platformSetupIssue } from "./platformAccount.js";
import { activeSamedayEnvironment } from "./samedayEnvironment.js";
import { isVendorStripeReady } from "../payments/vendorStripeStatus.js";

export const SAMEDAY_ARTFEST_DELIVERY_FLAG = "SAMEDAY_ARTFEST_DELIVERY_ENABLED";
const RECENT_ATTEMPTS = 50;
const TEMPORARY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isSamedayArtfestDeliveryFlagOn(env = process.env) {
  return String(env[SAMEDAY_ARTFEST_DELIVERY_FLAG] ?? "").trim().toLowerCase() === "true";
}

// categorii din diagnosticul Sameday (providers/sameday/errorParsing.js)
const ACCOUNT_TOPICS = new Set(["third_party_pickup", "account_contract", "pickup_point", "contact_person", "awb_payment", "service"]);
const BLOCKING_SIGNALS = new Set(["permission", "inactive", "account_contract"]);
const DATA_TOPICS = new Set(["recipient", "address", "phone", "email", "weight_dimensions", "package_type", "cash_on_delivery", "insured_value", "locker_ooh"]);
const TEMPORARY_CODES = new Set(["courier_unavailable", "courier_timeout", "awb_recheck_failed", "awb_status_unknown"]);

/**
 * Clasifică o încercare de AWB eșuată (rândul CourierAwb):
 *   "permanent_account"  respingere de cont / permisiune / contract -> blochează oferta;
 *   "permanent_data"     datele acelei expedieri (adresă, telefon, greutate...) -> NU blochează contul;
 *   "temporary"          rețea / timeout / 5xx / rezultat necunoscut -> NU blochează contul;
 *   "unknown_rejection"  respins fără detalii (ex. încercări vechi, dinainte de diagnostic);
 *   null                 nu e o încercare eșuată.
 */
export function classifyAwbFailure(row) {
  if (!row) return null;
  const meta = row.providerMeta && typeof row.providerMeta === "object" ? row.providerMeta : {};
  if (row.status === "UNKNOWN") return "temporary";
  if (row.status !== "FAILED") return null;
  const code = String(meta.errorCode || "");
  const status = Number(meta.providerStatus) || null;
  if (code === "courier_auth_failed" || status === 401 || status === 403) return "permanent_account";
  if (TEMPORARY_CODES.has(code) || (status && status >= 500)) return "temporary";
  if (code === "courier_validation_failed" || status === 400 || status === 422) {
    const cats = new Set(Array.isArray(meta.providerCategories) ? meta.providerCategories : []);
    const fields = Array.isArray(meta.fields) ? meta.fields : [];
    const accountTopic = [...cats].some((c) => ACCOUNT_TOPICS.has(c)) || fields.some((f) => /^(thirdPartyPickup|pickupPoint|contactPerson|service|awbPayment)\b/.test(String(f)));
    const blocking = [...cats].some((c) => BLOCKING_SIGNALS.has(c));
    if (accountTopic && blocking) return "permanent_account";
    if (fields.length || [...cats].some((c) => DATA_TOPICS.has(c))) return "permanent_data";
    return "unknown_rejection";
  }
  return "unknown_rejection";
}

const time = (d) => (d ? new Date(d).getTime() : 0);

/**
 * @returns {Promise<{ ready: boolean, degraded: boolean, reasons: string[], environment: string|null,
 *   lastSuccessAt: string|null, lastPermanentAccountFailureAt: string|null, recentTemporaryFailures: number }>}
 */
export async function platformSamedayReadiness({ db = defaultDb, env = process.env, now = new Date() } = {}) {
  const reasons = [];
  const out = (extra = {}) => ({
    ready: reasons.length === 0,
    degraded: false,
    reasons,
    environment: activeSamedayEnvironment(env),
    lastSuccessAt: null,
    lastPermanentAccountFailureAt: null,
    recentTemporaryFailures: 0,
    ...extra,
  });

  if (!isSamedayArtfestDeliveryFlagOn(env)) reasons.push("feature_flag_off");
  if (!isCourierIntegrationEnabled(env)) reasons.push("courier_integration_disabled");
  if (!isCourierAwbLiveEnabled(env)) reasons.push("awb_live_disabled");
  const environment = activeSamedayEnvironment(env);
  if (!environment) {
    reasons.push("active_environment_missing");
    return out();
  }

  const account = await findPlatformCourierAccount(db, env);
  const setup = platformSetupIssue(account, env);
  if (setup) {
    reasons.push(setup.code);
    return out();
  }
  if (account.status !== "ACTIVE") reasons.push("platform_account_not_active");
  const cfg = account.publicConfig && typeof account.publicConfig === "object" ? account.publicConfig : {};
  if (!cfg.awbVerifiedAt) reasons.push("awb_not_verified_by_admin");
  if (!platformConfig(account).pickupPointId || !platformConfig(account).serviceId) reasons.push("platform_config_incomplete");

  // dovada reală: istoricul AWB al contului, în mediul activ
  const rows = await db.courierAwb.findMany({
    where: { courierAccountId: account.id },
    orderBy: { createdAt: "desc" },
    take: RECENT_ATTEMPTS,
    select: { status: true, awbNumber: true, providerMeta: true, createdAt: true, updatedAt: true },
  });
  const inEnv = rows.filter((r) => String(r.providerMeta?.environment || "") === environment);
  const success = inEnv.find((r) => r.awbNumber && ["CREATED", "CANCELLED"].includes(r.status));
  const lastSuccessAt = success ? success.createdAt : null;
  const permanent = inEnv.find((r) => classifyAwbFailure(r) === "permanent_account");
  const lastPermanentAccountFailureAt = permanent ? permanent.createdAt : null;
  const recentTemporaryFailures = inEnv.filter(
    (r) => classifyAwbFailure(r) === "temporary" && now.getTime() - time(r.createdAt) < TEMPORARY_WINDOW_MS
  ).length;

  if (!success) reasons.push("no_successful_awb_in_environment");
  if (permanent && time(permanent.createdAt) >= time(lastSuccessAt)) reasons.push("permanent_account_rejection");
  // confirmarea Admin trebuie să fie ulterioară ultimei respingeri permanente
  if (cfg.awbVerifiedAt && permanent && time(cfg.awbVerifiedAt) < time(permanent.createdAt)) {
    reasons.push("admin_verification_older_than_rejection");
  }

  return out({
    degraded: recentTemporaryFailures > 0,
    lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
    lastPermanentAccountFailureAt: lastPermanentAccountFailureAt ? new Date(lastPermanentAccountFailureAt).toISOString() : null,
    recentTemporaryFailures,
  });
}

/**
 * Eligibilitatea unui MAGAZIN pentru „Sameday prin Artfest” (pur, fără DB).
 * @param {{ store: object, vendor: object, readiness: object, pickupReady: boolean }} input
 *   store: VendorService (samedayOptInAt, samedayDisabledAt); vendor: câmpurile Stripe;
 *   readiness: rezultatul platformSamedayReadiness; pickupReady: adresa de ridicare completă + confirmată.
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
export function storeSamedayEligibility({ store, vendor, readiness, pickupReady }) {
  const reasons = [];
  if (!readiness?.ready) reasons.push("platform_not_ready");
  if (!store?.samedayOptInAt) reasons.push("store_not_opted_in");
  if (store?.samedayDisabledAt) reasons.push("store_disabled_by_artfest");
  // plata Sameday = exclusiv card integral -> vendorul trebuie să încaseze prin Stripe Connect
  if (!isVendorStripeReady(vendor)) reasons.push("vendor_stripe_not_ready");
  if (!pickupReady) reasons.push("pickup_address_not_ready");
  return { eligible: reasons.length === 0, reasons };
}
