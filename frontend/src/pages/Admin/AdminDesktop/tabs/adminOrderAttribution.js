// src/pages/Admin/AdminDesktop/tabs/adminOrderAttribution.js
//
// Etichete de AFIȘARE pentru Order Details din admin - derivate STRICT din
// câmpurile deja salvate pe Shipment / ShipmentItem la checkout (snapshot-uri)
// și din grupurile de comision din ledger. Nu calculează nimic financiar.
//
// Câmpuri folosite (backend: GET /api/admin/orders/:id și GET /api/admin/orders):
//  Shipment: influencerId, referrerVendorId, referrerVendorReferralCodeSnapshot
//            ("COLLECTION:<slug>" = colecție), vendorReferralCommissionOverrideBps
//            (own-sale 5%), campaignId (campanie legacy)
//  ShipmentItem: vendorCollectionSlugSnapshot / vendorCollectionIdSnapshot,
//            discountCodeId / discountCodeText

const COLLECTION_MARKER = "COLLECTION:";

const hasDiscountCode = (shipment) => (shipment?.items || []).some((item) => item?.discountCodeId);
const hasCollectionItem = (shipment) => (shipment?.items || []).some((item) => item?.vendorCollectionSlugSnapshot || item?.vendorCollectionIdSnapshot);
const isCollectionMarker = (shipment) =>
  typeof shipment?.referrerVendorReferralCodeSnapshot === "string" &&
  shipment.referrerVendorReferralCodeSnapshot.startsWith(COLLECTION_MARKER);

export const SHIPMENT_SOURCE_LABELS = Object.freeze({
  DIRECT: "Direct",
  OWN_SALE: "Own sale 5%",
  VENDOR_REFERRAL: "Vendor referral",
  VENDOR_COLLECTION_OWN_SALE: "VendorCollection (own sale 5%)",
  VENDOR_COLLECTION_REFERRAL: "VendorCollection (referral)",
  INFLUENCER: "Influencer",
  INFLUENCER_CODE: "Influencer (cod de reducere)",
  DISCOUNT_CODE: "Cod de reducere",
  CAMPAIGN: "Campanie (legacy)",
});

/**
 * Sursele unui shipment, în ordinea relevanței. Un shipment poate avea
 * două axe în același timp (ex. referral de la alt vendor + own-sale pe
 * colecția proprie a sellerului) - le întoarcem pe amândouă.
 * @returns {string[]} chei din SHIPMENT_SOURCE_LABELS
 */
export function getShipmentSourceKeys(shipment) {
  if (!shipment) return ["DIRECT"];

  const keys = [];
  const collectionReferral = Boolean(shipment.referrerVendorId) && isCollectionMarker(shipment);
  const hasOwnSale = shipment.vendorReferralCommissionOverrideBps !== null && shipment.vendorReferralCommissionOverrideBps !== undefined;

  if (shipment.influencerId) {
    keys.push(hasDiscountCode(shipment) ? "INFLUENCER_CODE" : "INFLUENCER");
  }

  if (shipment.referrerVendorId) {
    keys.push(collectionReferral ? "VENDOR_COLLECTION_REFERRAL" : "VENDOR_REFERRAL");
  }

  if (hasOwnSale) {
    // own-sale prin colecție (snapshot pe itemi / marcaj fără referrer) vs link / cod propriu
    const viaCollection = (!shipment.referrerVendorId && isCollectionMarker(shipment)) || (hasCollectionItem(shipment) && !collectionReferral);
    keys.push(viaCollection ? "VENDOR_COLLECTION_OWN_SALE" : "OWN_SALE");
  }

  if (!keys.length && hasDiscountCode(shipment)) keys.push("DISCOUNT_CODE");
  if (shipment.campaignId) keys.push("CAMPAIGN");

  return keys.length ? keys : ["DIRECT"];
}

export function getShipmentSource(shipment) {
  return getShipmentSourceKeys(shipment)
    .map((key) => SHIPMENT_SOURCE_LABELS[key])
    .join(" + ");
}

export function getOrderSourceSummary(order) {
  const shipments = order?.shipments || [];
  if (!shipments.length) return SHIPMENT_SOURCE_LABELS.DIRECT;

  const sources = [...new Set(shipments.map(getShipmentSource))];
  return sources.length === 1 ? sources[0] : "Surse multiple";
}

/* ---------- grupuri de comision (COMMISSION_GROUP_LABELS din backend) ---------- */

const COMMISSION_GROUP_DISPLAY = Object.freeze({
  vendor_collection_own_sale: "Own-sale colecție",
  vendor_referral_own_sale: "Own-sale (link / cod propriu)",
  campaign: "Campanie",
  plan: "Plan standard",
});

export function getCommissionGroupLabel(label) {
  return COMMISSION_GROUP_DISPLAY[label] || "Plan standard";
}

/* ---------- per item ---------- */

/**
 * Sursa atribuirii pentru o linie (afișare). Snapshot-ul de colecție are rolul
 * dedus ca în backend (services/shipmentCommissionGroups.js): același slug ca
 * marcajul referrer-ului = referral colecție, altfel = colecția proprie.
 */
export function getItemAttributionLabel(item, shipment) {
  const slug = item?.vendorCollectionSlugSnapshot || null;

  if (slug || item?.vendorCollectionIdSnapshot) {
    const referralSlug =
      shipment?.referrerVendorId && isCollectionMarker(shipment)
        ? shipment.referrerVendorReferralCodeSnapshot.slice(COLLECTION_MARKER.length)
        : null;
    const name = slug || item.vendorCollectionIdSnapshot;
    return referralSlug && referralSlug === slug ? `Referral colecție „${name}”` : `Own-sale colecție „${name}”`;
  }

  if (item?.discountCodeId) {
    return item.discountCodeText ? `Cod de reducere ${item.discountCodeText}` : "Cod de reducere";
  }

  return null;
}

const ORDER_MODE_LABELS = Object.freeze({
  DIRECT: "Produs simplu",
  OPTIONS: "Cu opțiuni",
  QUOTE_ONLY: "Cerere de ofertă",
});

export function getOrderModeLabel(orderMode) {
  return orderMode ? ORDER_MODE_LABELS[orderMode] || orderMode : null;
}

/**
 * Perechi „cheie: valoare” pentru selectedOptions / customAnswers /
 * repeatedGroupAnswers (obiecte JSON libere). Valorile compuse sunt
 * serializate compact.
 */
export function formatConfigurationEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  return Object.entries(value)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim?.() !== "")
    .map(([key, v]) => `${key}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
}
