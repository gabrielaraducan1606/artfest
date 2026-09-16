// backend/src/services/vendorAttribution.js

/*
 * Revalidare server-side a atribuirii de referral VENDOR, folosită
 * EXCLUSIV la checkout (mirror STRUCTURAL al influencerAttribution.js).
 *
 * Un vendor poate fi el însuși promotor (link ?ref=<referralCode>
 * sau cod de reducere al lui), la fel ca un influencer - dar
 * remunerația lui depinde de CINE a vândut produsul:
 * - dacă vendorul promovează PROPRIUL produs -> nu există câștig
 *   de referral separat (vezi regula "own-sale" în chekoutRoutes.js,
 *   care setează shipment.vendorReferralCommissionOverrideBps în loc
 *   de referrerVendorId).
 * - dacă vendorul promovează produsul ALTUI vendor -> câștigă un
 *   comision de referral calculat din platformNet-ul acelui
 *   shipment (vezi ensureVendorReferralSaleLedgerEntry în
 *   vendorOrdersRoutes.js).
 *
 * Fail-open: orice atribuire invalidă/expirată/lipsă e ignorată
 * silențios - comanda continuă normal, fără atribuire de vendor
 * referitor. Nu blocăm niciodată checkout-ul din cauza asta.
 *
 * La fel ca la influencer, atribuirea prin ?ref= e GLOBALĂ pentru
 * întreaga comandă (un singur token) - decizia PER SHIPMENT
 * (own-sale vs referral extern vs ignorată, dacă alt promotor a
 * câștigat deja acel shipment) se ia în chekoutRoutes.js.
 */

import { prisma } from "../db.js";
import { verifyVendorReferralAttributionToken } from "./vendorAttributionToken.js";
import { verifyVendorCollectionAttributionToken } from "./vendorCollectionAttributionToken.js";

/*
 * Comisionul Artfest pe shipment-ul unei vânzări "own-sale"
 * (vendorul își promovează propriul produs, prin propriul link/cod)
 * - controlat exclusiv de Artfest, la fel ca CAMPAIGN_COMMISSION_BPS
 * din vendorCampaignRoutes.js. 500 = 5%.
 */
export const VENDOR_REFERRAL_OWN_SALE_COMMISSION_BPS = 500;

/*
 * Remunerație STANDARD pentru vendorii promoteri (cross-vendor
 * referral) - NU configurabilă de vendor, cerință explicită (audit
 * 2026-09-14, regula finală de business). 2000 = 20% din
 * platformNet-ul (comisionul Artfest rămas) al shipmentului extern -
 * vezi ensureVendorReferralSaleLedgerEntry (vendorOrdersRoutes.js),
 * NEATINSĂ, care deja calculează earningNet = platformNet ×
 * commissionBpsSnapshot / 10000.
 *
 * IMPORTANT (schimbare de semantică, FĂRĂ Prisma): admin păstrează
 * controlul prin Vendor.referralCommissionBps (PATCH
 * /vendors/:id/referral-commission, adminRoutes.js), dar `0` nu mai
 * înseamnă "dezactivat" - înseamnă "foloseşte valoarea implicită de
 * platformă". Un admin care vrea un procent DIFERIT de 20% pentru un
 * anumit vendor tot poate seta orice valoare >0 explicit - rămâne
 * singurul loc unde acest procent se schimbă, vendorul nu-l
 * controlează niciodată. Text UI actualizat în adminRoutes.js.
 */
export const DEFAULT_VENDOR_PROMOTER_COMMISSION_BPS = 2000;

/*
 * Regulă comună de eligibilitate PENTRU ATRIBUIRE - extrasă fără
 * nicio schimbare de comportament pe calea ?ref=, reutilizată și
 * de calea prin cod de reducere (vendorId cunoscut direct din
 * DiscountCode.vendorId).
 *
 * IMPORTANT (corectare față de o primă versiune): NU filtrăm aici pe
 * `referralCommissionBps > 0`. Motivul e regula own-sale (cerință
 * explicită): dacă vendorul își promovează PROPRIUL produs,
 * referralCommissionBps NU se folosește deloc - own-sale trebuie să
 * funcționeze indiferent de acest procent (chiar la 0%, valoarea
 * implicită pentru toți vendorii până la configurare de admin).
 * Un gate aici ar fi blocat greșit inclusiv own-sale pentru orice
 * vendor cu referralCommissionBps=0, adică pentru toți vendorii
 * înainte ca admin să seteze un procent.
 *
 * Gate-ul rămâne DOAR acolo unde chiar contează financiar - la
 * plata efectivă a unui referral extern:
 * ensureVendorReferralSaleLedgerEntry (vendorOrdersRoutes.js) NU
 * creează nicio intrare dacă referrerVendorCommissionBpsSnapshot
 * <= 0. Own-sale (vendorReferralCommissionOverrideBps) nu citește
 * deloc commissionBpsSnapshot - vezi buildShipmentAttributionFields
 * din chekoutRoutes.js.
 */
function buildAttributionFromVendor(vendor) {
  if (!vendor) return null;
  if (vendor.isActive === false) return null;

  const configuredBps = Number(vendor.referralCommissionBps || 0);

  /*
   * 0/neconfigurat -> DEFAULT_VENDOR_PROMOTER_COMMISSION_BPS (20%).
   * Un admin poate seta orice valoare explicită >0 pentru un vendor
   * anume - acea valoare are mereu prioritate.
   */
  const commissionBpsSnapshot =
    Number.isInteger(configuredBps) && configuredBps > 0
      ? configuredBps
      : DEFAULT_VENDOR_PROMOTER_COMMISSION_BPS;

  return {
    vendorId: vendor.id,
    referralCodeSnapshot: vendor.referralCode,
    commissionBpsSnapshot,
  };
}

/**
 * @param {object} params
 * @param {string} params.token - vendorReferralAttribution trimis de client
 * @returns {Promise<{
 *   vendorId: string,
 *   referralCodeSnapshot: string,
 *   commissionBpsSnapshot: number,
 * } | null>}
 */
export async function resolveVendorReferralAttribution({
  token,
  db = prisma,
} = {}) {
  const payload = verifyVendorReferralAttributionToken(token);

  if (!payload) {
    return null;
  }

  const vendor = await db.vendor.findFirst({
    where: {
      id: payload.vendorId,
      referralCode: payload.referralCode,
    },

    select: {
      id: true,
      referralCode: true,
      referralCommissionBps: true,
      isActive: true,
    },
  });

  const attribution = buildAttributionFromVendor(vendor);

  if (!attribution) return null;

  /*
   * audit 2026-09-15 - necesar pentru "global last click wins" între
   * acest token și cel de atribuire VendorCollection.
   */
  return { ...attribution, issuedAt: payload.issuedAt };
}

/**
 * Mirror STRUCTURAL al resolveVendorReferralAttribution, dar pentru
 * atribuirea provenită din vizitarea unei VendorCollection (audit
 * 2026-09-15, regula finală de business - persistent attribution).
 *
 * Revalidare FRESH din DB, pe AMBELE: colecția (isActive) ȘI
 * vendorul-proprietar (isActive) - un token vechi rămas valid ca
 * semnătură, dar pentru o colecție dezactivată sau un vendor
 * dezactivat între timp, nu produce nicio atribuire.
 *
 * IMPORTANT: tokenul de colecție NU e folosit NICIODATĂ pentru
 * eligibilitatea de preț/own-sale (asta rămâne strict legată de
 * VendorCollectionItem prin codul de reducere - vezi
 * discountCodeValidation.js, neatins). Acest token alimentează DOAR
 * fallback-ul de tip "referral pasiv" (același nivel de prioritate
 * ca refVendorAttribution din ?ref=) - vezi chekoutRoutes.js.
 *
 * @returns {Promise<{
 *   vendorId: string,
 *   referralCodeSnapshot: string,
 *   commissionBpsSnapshot: number,
 *   collectionId: string,
 *   issuedAt: number|null,
 * } | null>}
 */
export async function resolveVendorCollectionAttribution({
  token,
  db = prisma,
} = {}) {
  const payload = verifyVendorCollectionAttributionToken(token);

  if (!payload) {
    return null;
  }

  const collection = await db.vendorCollection.findFirst({
    where: {
      id: payload.collectionId,
      vendorId: payload.ownerVendorId,
      isActive: true,
    },

    select: {
      id: true,
      vendorId: true,
      slug: true,
    },
  });

  if (!collection) {
    return null;
  }

  const vendor = await db.vendor.findUnique({
    where: { id: collection.vendorId },

    select: {
      id: true,
      referralCode: true,
      referralCommissionBps: true,
      isActive: true,
    },
  });

  const attribution = buildAttributionFromVendor(vendor);

  if (!attribution) return null;

  return {
    ...attribution,
    collectionId: collection.id,
    collectionSlug: collection.slug,
    issuedAt: payload.issuedAt,
  };
}

/**
 * Mirror al resolveVendorReferralAttribution, dar pentru atribuirea
 * provenită dintr-un cod de reducere al unui vendor (nu dintr-un
 * token ?ref=). Cheie: vendorId (deja cunoscut, din
 * DiscountCode.vendorId, validat separat de discountCodeValidation.js),
 * NU un token - re-citește FRESH din DB, exact ca la ?ref=.
 *
 * @param {object} params
 * @param {string} params.vendorId
 * @returns {Promise<{
 *   vendorId: string,
 *   referralCodeSnapshot: string,
 *   commissionBpsSnapshot: number,
 * } | null>}
 */
export async function resolveVendorReferralAttributionByVendorId({
  vendorId,
  db = prisma,
} = {}) {
  if (!vendorId) return null;

  const vendor = await db.vendor.findUnique({
    where: { id: vendorId },

    select: {
      id: true,
      referralCode: true,
      referralCommissionBps: true,
      isActive: true,
    },
  });

  return buildAttributionFromVendor(vendor);
}
