// backend/src/services/campaignAttribution.js

/*
 * Revalidare server-side a atribuirii de campanie (checkout, coș,
 * sumar, prețuri afișate).
 *
 * Model REQUEST-BASED (ca referral-ul influencer / vendor): clientul
 * ține slug-urile campaniilor vizitate (/c/:slug, modalul campaniei)
 * DOAR în memoria aplicației și în URL (?camp=), fără localStorage /
 * cookie / consimțământ, și le trimite ca `campaignSlugs` (cele mai
 * recente întâi). Slug-ul e public, deci NU e dovadă de nimic: fiecare
 * campanie e revalidată fresh din DB (activă, vendor activ, interval
 * startsAt/endsAt, vendor prezent în coș), la fel ca
 * GET /api/public/campaigns/:slug. Per vendor câștigă cea mai recentă
 * campanie VALIDĂ (last-click-wins per vendor, ca la tokenurile vechi).
 *
 * TRANZIȚIE - DE ELIMINAT: `tokensByVendorId` ({ [vendorId]: attributionToken })
 * vine doar din bundle-uri vechi; folosit numai pentru vendorii fără
 * campanie validă din `campaignSlugs`.
 *
 * Fail open: orice atribuire invalidă/expirată/lipsă e
 * ignorată silențios - comanda continuă normal, fără discount
 * și fără comision redus. Nu blocăm niciodată checkout-ul din
 * cauza unei campanii.
 */

import { prisma } from "../db.js";
import { verifyCampaignAttributionToken } from "./campaignAttributionToken.js";
import { campaignToPromotion } from "./productPromotionPrice.js";

const MAX_CAMPAIGN_SLUGS = 10;
const CAMPAIGN_SLUG_MAX_LENGTH = 160; // VendorCampaign.slug VarChar(160)

/*
 * campaignSlugs din body (array) sau din query (string "a,b" / array
 * pentru ?campaignSlugs=a&campaignSlugs=b) -> listă curată, distinctă,
 * în ordinea primită (cele mai recente întâi), cel mult MAX_CAMPAIGN_SLUGS.
 */
export function normalizeCampaignSlugs(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];

  const seen = new Set();
  const out = [];

  for (const item of list) {
    if (typeof item !== "string") continue;
    const slug = item.trim();
    if (!slug || slug.length > CAMPAIGN_SLUG_MAX_LENGTH || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
    if (out.length >= MAX_CAMPAIGN_SLUGS) break;
  }

  return out;
}

const CAMPAIGN_ATTRIBUTION_SELECT = {
  id: true,
  vendorId: true,
  slug: true,
  isActive: true,
  scope: true,
  discountPercent: true,
  platformFundingBps: true,
  vendorFundingBps: true,
  fundingSource: true,
  startsAt: true,
  endsAt: true,

  vendor: {
    select: {
      isActive: true,
    },
  },

  products: {
    select: {
      productId: true,
    },
  },
};

// aceleași reguli ca înainte (activă, vendor activ, interval) -> atribuire sau null
function toValidAttribution(campaign, now) {
  if (!campaign) return null;
  if (campaign.vendor?.isActive === false) return null;
  if (!campaign.isActive) return null;
  if (campaign.startsAt && campaign.startsAt > now) return null;
  if (campaign.endsAt && campaign.endsAt <= now) return null;

  return {
    campaignId: campaign.id,
    slug: campaign.slug || null,
    discountPercent: Number(campaign.discountPercent || 0),
    platformFundingBps: campaign.platformFundingBps,
    vendorFundingBps: campaign.vendorFundingBps,
    fundingSource: campaign.fundingSource,
    scope: campaign.scope,
    selectedProductIds: new Set(
      Array.isArray(campaign.products)
        ? campaign.products.map((p) => p.productId).filter(Boolean)
        : []
    ),
  };
}

/**
 * @param {object} params
 * @param {string[]} params.vendorIds - vendorii prezenți în coșul curent
 * @param {string[]|string} [params.campaignSlugs] - slug-uri din navigarea curentă, cele mai recente întâi
 * @param {Record<string,string>} [params.tokensByVendorId] - TRANZIȚIE: { [vendorId]: attributionToken }
 * @returns {Promise<Map<string, {
 *   campaignId: string,
 *   discountPercent: number,
 *   scope: "ALL_PRODUCTS" | "SELECTED_PRODUCTS",
 *   selectedProductIds: Set<string>,
 * }>>} cheie = vendorId
 */
export async function resolveVendorCampaignAttributions({
  vendorIds = [],
  campaignSlugs = [],
  tokensByVendorId = {},
  db = prisma,
}) {
  const result = new Map();

  const cartVendorIds = new Set(
    (vendorIds || []).map((id) => String(id || "")).filter(Boolean)
  );

  if (!cartVendorIds.size) {
    return result;
  }

  const now = new Date();

  /* ---------- request-based: slug-uri din navigarea curentă ---------- */

  const slugs = normalizeCampaignSlugs(campaignSlugs);

  if (slugs.length) {
    const campaigns = await db.vendorCampaign.findMany({
      where: {
        slug: { in: slugs },
        vendorId: { in: [...cartVendorIds] },
      },
      select: CAMPAIGN_ATTRIBUTION_SELECT,
    });

    const bySlug = new Map(campaigns.map((c) => [c.slug, c]));

    // ordinea clientului = cele mai recente întâi -> prima validă per vendor câștigă
    for (const slug of slugs) {
      const campaign = bySlug.get(slug);
      if (!campaign) continue;

      const vendorId = String(campaign.vendorId);
      if (!cartVendorIds.has(vendorId) || result.has(vendorId)) continue;

      const attribution = toValidAttribution(campaign, now);
      if (attribution) result.set(vendorId, attribution);
    }
  }

  /* ---------- TRANZIȚIE - DE ELIMINAT: tokenuri din bundle-uri vechi ---------- */

  const legacyTokens =
    tokensByVendorId && typeof tokensByVendorId === "object"
      ? tokensByVendorId
      : {};

  for (const vendorId of cartVendorIds) {
    if (result.has(vendorId) || !legacyTokens[vendorId]) continue;

    const payload = verifyCampaignAttributionToken(legacyTokens[vendorId]);

    if (!payload || payload.vendorId !== vendorId) {
      continue;
    }

    const campaign = await db.vendorCampaign.findFirst({
      where: {
        id: payload.campaignId,
        vendorId,
      },
      select: CAMPAIGN_ATTRIBUTION_SELECT,
    });

    const attribution = toValidAttribution(campaign, now);
    if (attribution) result.set(vendorId, attribution);
  }

  /*
   * Consolidare Colecții: o campanie MIGRATĂ (există VendorCollection cu
   * legacyCampaignId = campaign.id) nu se mai aplică drept campanie - sursa de
   * adevăr devine colecția (vendorCollectionPricing.js mapează slug-ul vechi).
   * Comenzile istorice rămân pe Shipment.campaignId, neatinse.
   */
  if (result.size) {
    const campaignIds = [...result.values()].map((a) => a.campaignId);
    const migrated = await db.vendorCollection.findMany({
      where: { legacyCampaignId: { in: campaignIds } },
      select: { legacyCampaignId: true },
    });
    const migratedIds = new Set(migrated.map((m) => String(m.legacyCampaignId)));

    for (const [vendorId, attribution] of [...result]) {
      if (migratedIds.has(String(attribution.campaignId))) result.delete(vendorId);
    }
  }

  return result;
}

/**
 * Verifică dacă un produs anume e eligibil pentru discountul
 * campaniei atribuite vendorului său (ALL_PRODUCTS vs
 * SELECTED_PRODUCTS).
 *
 * SCHIMBARE (audit 2026-09-14, lifecycle VendorCampaign):
 * comisionul redus de campanie ACUM depinde de asta - vezi
 * getCampaignEligibilityInfo / splitItemsByCampaignEligibility mai
 * jos. Funcția rămâne neschimbată ca semnătură/comportament (doar
 * comentariul vechi, care spunea contrariul, era depășit).
 */
export function isProductEligibleForCampaign(productId, attribution) {
  if (!attribution) return false;

  if (attribution.scope === "SELECTED_PRODUCTS") {
    return attribution.selectedProductIds.has(String(productId));
  }

  return true;
}

/**
 * Info de eligibilitate a UNEI campanii deja atribuite unui shipment
 * (shipment.campaignId), pentru calculul comisionului - NU pentru
 * atribuire. Diferă de `resolveVendorCampaignAttributions` prin
 * faptul că nu verifică token/fereastră/isActive/date - la momentul
 * calculului comisionului (checkout, ledger, refund, preview) e
 * INTENȚIONAT să folosim campania așa cum a fost la creare
 * shipment-ului (campaignId e deja un snapshot server-side validat
 * o dată, la checkout), nu să o revalidăm din nou fiecare dată.
 *
 * @returns {Promise<{scope: string, selectedProductIds: Set<string>} | null>}
 */
export async function getCampaignEligibilityInfo(campaignId) {
  if (!campaignId) return null;

  const campaign = await prisma.vendorCampaign.findUnique({
    where: { id: String(campaignId) },
    select: {
      scope: true,
      products: { select: { productId: true } },
    },
  });

  if (!campaign) return null;

  return {
    scope: campaign.scope,
    selectedProductIds: new Set(
      Array.isArray(campaign.products)
        ? campaign.products.map((p) => p.productId).filter(Boolean)
        : []
    ),
  };
}

/**
 * Variantă batch a `getCampaignEligibilityInfo`, pentru CARD
 * (computeOrderSplits), unde o comandă poate avea mai multe
 * shipment-uri/campaignId-uri de interogat o singură dată.
 *
 * @returns {Promise<Map<string, {scope, selectedProductIds}>>}
 */
export async function getCampaignEligibilityInfoMap(campaignIds = []) {
  const ids = Array.from(
    new Set((campaignIds || []).map((id) => String(id || "")).filter(Boolean))
  );

  const map = new Map();
  if (!ids.length) return map;

  const campaigns = await prisma.vendorCampaign.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      scope: true,
      products: { select: { productId: true } },
    },
  });

  for (const campaign of campaigns) {
    map.set(campaign.id, {
      scope: campaign.scope,
      selectedProductIds: new Set(
        Array.isArray(campaign.products)
          ? campaign.products.map((p) => p.productId).filter(Boolean)
          : []
      ),
    });
  }

  return map;
}

/**
 * Împarte itemii unui shipment/vendor în două grupuri, pe baza
 * eligibilității REALE pentru campania atașată:
 * - eligible: beneficiază de comisionul redus de campanie
 * - standard: rămân pe comisionul standard (plan)
 *
 * ATTRIBUTION vs COMMISSION ELIGIBILITY: `eligibilityInfo === null`
 * (fără campanie atașată, sau campanie negăsită) => toate itemii merg
 * în `standard`. Atribuirea (campaignId pe shipment, pentru
 * analytics) poate exista fără ca vreun item să fie eligibil pentru
 * comision - acesta e exact cazul separat de mai jos.
 */
export function splitItemsByCampaignEligibility(items, eligibilityInfo) {
  const eligible = [];
  const standard = [];

  for (const item of items || []) {
    if (
      eligibilityInfo &&
      isProductEligibleForCampaign(item.productId, eligibilityInfo)
    ) {
      eligible.push(item);
    } else {
      standard.push(item);
    }
  }

  return { eligible, standard };
}

/**
 * Construiește Map<productId, promotionCandidate> pentru
 * discountul de campanie, pornind de la atribuirile deja
 * revalidate server-side (una per vendor prezent în coș/comandă).
 *
 * `products` - listă plată de produse, fiecare cu `.id` și
 * `.service.vendorId` (formă comună coș, checkout, summary).
 *
 * Comisionul redus NU depinde de asta - se decide separat,
 * per shipment, la crearea shipment-urilor.
 */
export function buildCampaignPromotionsByProductId(
  products,
  attributionsByVendorId
) {
  const map = new Map();

  if (!attributionsByVendorId || !attributionsByVendorId.size) {
    return map;
  }

  for (const product of products || []) {
    const vendorId = product?.service?.vendorId
      ? String(product.service.vendorId)
      : null;

    if (!vendorId || !product?.id) continue;

    const attribution = attributionsByVendorId.get(vendorId);
    if (!attribution) continue;

    if (!isProductEligibleForCampaign(product.id, attribution)) continue;

    const promotion = campaignToPromotion({
      discountPercent: attribution.discountPercent,
      fundingSource: attribution.fundingSource,
      platformFundingBps: attribution.platformFundingBps,
      vendorFundingBps: attribution.vendorFundingBps,
    });

    if (promotion) {
      map.set(product.id, promotion);
    }
  }

  return map;
}
