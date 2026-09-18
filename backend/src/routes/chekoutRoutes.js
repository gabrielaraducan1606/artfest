import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  sendOrderConfirmationEmail,
  sendVendorNewOrderEmail,
} from "../lib/mailer.js";
import { createPaymentForOrder } from "../payments/orchestrator.js";
import {
  isVendorStripeReady,
  computeCardPaymentAvailability,
  CardPaymentUnavailableError,
  VENDOR_STRIPE_STATUS_SELECT,
} from "../payments/vendorStripeStatus.js";
import {
  createVendorNotification,
  notifyVendorOnProductSoldOut,
  notifyInfluencerPayoutProfileIncomplete,
} from "../services/notifications.js";
import {
  getPromotionPricingForProducts,
} from "../services/productPromotionPrice.js";
import {
  resolveVendorCampaignAttributions,
  buildCampaignPromotionsByProductId,
  isProductEligibleForCampaign,
} from "../services/campaignAttribution.js";
import {
  resolveInfluencerAttribution,
  resolveInfluencerAttributionByInfluencerId,
} from "../services/influencerAttribution.js";
import {
  resolveVendorReferralAttribution,
  resolveVendorReferralAttributionByVendorId,
  resolveVendorCollectionAttribution,
  VENDOR_REFERRAL_OWN_SALE_COMMISSION_BPS,
} from "../services/vendorAttribution.js";
import {
  CAMPAIGN_COMMISSION_BPS,
} from "./vendorCampaignRoutes.js";
import {
  validateDiscountCode,
  buildDiscountCodePromotionsByProductId,
  realizeDiscountCodeAmount,
  redeemDiscountCode,
} from "../services/discountCodeValidation.js";
const router = Router();

/*
 * GET /checkout/summary nu poate trimite un body JSON, așa
 * că atribuirile de campanie vin ca query string (JSON
 * encodat). Parsare defensivă - orice eșec => fără atribuire,
 * niciodată eroare (summary trebuie să se încarce oricum).
 */
function parseCampaignAttributionQuery(raw) {
  if (!raw || typeof raw !== "string") return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const dec = (n) => Number.parseFloat((Number(n || 0)).toFixed(2));

/*
 * Reminder „completează datele de plată” pentru influenceri -
 * trigger: prima comandă atribuită + profil de plată
 * (InfluencerPayoutProfile) incomplet sau inexistent.
 *
 * Apelată DUPĂ ce tranzacția comenzii s-a confirmat (niciodată din
 * interiorul $transaction) - la fel ca notificările de vendor
 * (createVendorNotification/notifyVendorOnProductSoldOut) de mai
 * jos, ca să nu creăm notificări pentru comenzi care ar putea fi
 * anulate prin rollback.
 *
 * O comandă multi-vendor cu ACELAȘI influencer pe mai multe
 * shipment-uri interoghează o singură dată per influencer (Set pe
 * influencerId) - iar dedupeKey-ul STABIL din
 * notifyInfluencerPayoutProfileIncomplete (fără dată) garantează
 * oricum o singură notificare pe toată durata de viață a contului,
 * indiferent de câte comenzi urmează.
 *
 * Nu aruncă niciodată - eșecul acestui reminder nu trebuie să
 * afecteze răspunsul de succes al comenzii deja plasate.
 */
async function notifyInfluencersWithIncompletePayoutProfile(shipments) {
  try {
    const influencerIds = [
      ...new Set(
        (shipments || [])
          .map((s) => s.influencerId)
          .filter(Boolean)
      ),
    ];

    if (!influencerIds.length) return;

    const incompleteInfluencers = await prisma.influencerProfile.findMany({
      where: {
        id: { in: influencerIds },
        OR: [
          { payoutProfile: null },
          { payoutProfile: { isComplete: false } },
        ],
      },

      select: { userId: true },
    });

    await Promise.all(
      incompleteInfluencers.map((influencer) =>
        notifyInfluencerPayoutProfileIncomplete(influencer.userId)
      )
    );
  } catch (err) {
    console.error(
      "Nu am putut trimite reminder-ul de date de plată pentru influenceri:",
      err
    );
  }
}

/*
 * =========================================================
 * ATRIBUIRE PROMOTOR - INFLUENCER vs VENDOR (PER SHIPMENT)
 * =========================================================
 *
 * Regulă unică, cerută explicit:
 * - cod de reducere câștigător PE ACEST SHIPMENT are prioritate
 *   absolută față de ?ref=, indiferent de tipul lui (vendor sau
 *   influencer);
 * - dacă niciun cod nu a câștigat pe acest shipment, cade pe
 *   atribuirea ?ref= validă (influencer SAU vendor);
 * - UN SINGUR promotor economic per shipment - niciodată influencer
 *   ȘI vendor simultan (vezi buildShipmentAttributionFields, care
 *   scrie DOAR câmpurile tipului câștigător, restul rămân null).
 *
 * Tie-break (caz limită, practic imposibil - ar necesita un cod de
 * influencer și un cod de vendor cu literalmente același șir de
 * caractere folosit ca ?ref=): dacă AMBELE ref-uri (influencer și
 * vendor) sunt valide simultan pentru același shipment, influencer
 * câștigă - comportamentul influencer, preexistent, rămâne
 * neschimbat în orice ambiguitate.
 */
export function resolveShipmentPromoter({
  shipmentWonByDiscountCode,
  shipmentEligibleForVendorAttributionByDiscountCode,
  shipmentEligibleForInfluencerByDiscountCode,
  discountCodeInfluencerAttribution,
  discountCodeVendorAttribution,
  refInfluencerAttribution,
  refVendorAttribution,
}) {
  /*
   * INFLUENCER prin cod (audit 2026-09-14, aceeași regulă ca own-sale
   * mai jos) - eligibilitatea codului influencerului NU trebuie să
   * depindă de câștigarea competiției de preț. Un Product of
   * Day/Artisan of Week poate oferi un discount egal/mai mare și
   * câștiga vizual prețul, dar codul influencerului tot a fost
   * validat și se aplică produsului cumpărat - PRICE WINNER !=
   * ATTRIBUTION WINNER. Verificat ÎNAINTE de `shipmentWonByDiscountCode`.
   */
  if (
    shipmentEligibleForInfluencerByDiscountCode &&
    discountCodeInfluencerAttribution
  ) {
    return {
      type: "INFLUENCER",
      influencer: discountCodeInfluencerAttribution,
    };
  }

  if (shipmentWonByDiscountCode && discountCodeInfluencerAttribution) {
    return {
      type: "INFLUENCER",
      influencer: discountCodeInfluencerAttribution,
    };
  }

  /*
   * VENDOR (own-sale SAU referral cross-vendor - audit 2026-09-14,
   * generalizat 2026-09-15): eligibilitatea codului vendorului NU
   * trebuie să depindă de câștigarea competiției de preț - un Product
   * of Day/Artisan of Week poate oferi un discount egal sau mai mare
   * și câștiga vizual prețul (chooseBestPromotion,
   * productPromotionPrice.js), dar codul vendorului tot a fost
   * validat și se aplică produsului cumpărat. La fel, o reducere de
   * colecție finanțată de VENDOR nu se mai aplică la preț pe produsul
   * altui vendor (protecție seller, vezi
   * buildDiscountCodePromotionsByProductId) - fără verificare pe
   * ELIGIBILITATE aici, referral-ul cross-vendor ar dispărea complet
   * în acel caz. Decizia own-sale vs referral extern se ia mai
   * departe, în buildShipmentAttributionFields (compară
   * promoter.vendor.vendorId cu shipmentVendorId) - NU aici.
   * Verificat ÎNAINTE de `shipmentWonByDiscountCode` (fallback rămas
   * pentru orice caz în care eligibilitatea nu a putut fi calculată,
   * dar itemul tot a câștigat prin cod).
   */
  if (
    shipmentEligibleForVendorAttributionByDiscountCode &&
    discountCodeVendorAttribution
  ) {
    return {
      type: "VENDOR",
      vendor: discountCodeVendorAttribution,
    };
  }

  if (shipmentWonByDiscountCode && discountCodeVendorAttribution) {
    return {
      type: "VENDOR",
      vendor: discountCodeVendorAttribution,
    };
  }

  if (refInfluencerAttribution) {
    return {
      type: "INFLUENCER",
      influencer: refInfluencerAttribution,
    };
  }

  if (refVendorAttribution) {
    return {
      type: "VENDOR",
      vendor: refVendorAttribution,
    };
  }

  return { type: null };
}

/*
 * Traduce promotorul câștigător (resolveShipmentPromoter) în
 * câmpurile EXACTE de scris pe Shipment la creare.
 *
 * Regula own-sale: dacă vendorul promotor === vendorul shipment-ului
 * (își promovează propriul produs), NU se scrie referrerVendorId
 * (nu există remunerație de referral separată) - în schimb se
 * scrie vendorReferralCommissionOverrideBps, citit de
 * computeVendorEarningForShipment (vendorOrdersRoutes.js) cu
 * prioritate față de comisionul planului vendorului, exact ca la
 * campaniile proprii (CAMPAIGN_COMMISSION_BPS).
 *
 * Regula referral extern: vendorul promotor !== vendorul
 * shipment-ului -> se scrie referrerVendorId + snapshot, citit mai
 * târziu de ensureVendorReferralSaleLedgerEntry (vendorOrdersRoutes.js)
 * pentru a calcula earningNet din platformNet-ul acelui shipment.
 *
 * MARCAJ VENDOR_COLLECTION (audit 2026-09-15, regula finală de
 * business): own-sale prin cod de scope VENDOR_COLLECTION rămâne
 * 500bps, identic cu own-sale prin cod personal (VENDOR_ALL_PRODUCTS)
 * - dar UI-ul trebuie să distingă sursa ("Comision colecție / Vânzare
 * proprie" vs "Comision promoțional / Vânzare proprie"). Fără câmp
 * nou în Prisma: refolosim `referrerVendorReferralCodeSnapshot`
 * (String, mereu null în own-sale până acum, pentru că e populat doar
 * pe ramura de referral extern - vezi mai jos) ca marcaj simplu
 * "COLLECTION", citit de computeVendorEarningForShipment
 * (vendorOrdersRoutes.js) pentru a alege label-ul corect. Sigur:
 * niciun consumator existent al acestui câmp nu-l citește decât
 * filtrat pe `referrerVendorId` (vezi vendorReferralEarnings.js),
 * care rămâne null în own-sale - zero coliziune.
 */
export function buildShipmentAttributionFields({
  promoter,
  shipmentVendorId,
  discountCodeScope,
  discountCodeCollectionSlug,
}) {
  const fields = {
    influencerId: null,
    influencerReferralCodeSnapshot: null,
    influencerCommissionBpsSnapshot: null,
    influencerAttributedAt: null,

    referrerVendorId: null,
    referrerVendorReferralCodeSnapshot: null,
    referrerVendorCommissionBpsSnapshot: null,
    referrerVendorAttributedAt: null,

    vendorReferralCommissionOverrideBps: null,
    vendorReferralOwnSaleAttributedAt: null,
  };

  if (promoter?.type === "INFLUENCER" && promoter.influencer) {
    fields.influencerId = promoter.influencer.influencerId;
    fields.influencerReferralCodeSnapshot =
      promoter.influencer.referralCodeSnapshot;
    fields.influencerCommissionBpsSnapshot =
      promoter.influencer.commissionBpsSnapshot;
    fields.influencerAttributedAt = new Date();

    return fields;
  }

  if (promoter?.type === "VENDOR" && promoter.vendor) {
    const isOwnSale =
      String(promoter.vendor.vendorId) === String(shipmentVendorId);

    /*
     * Marcaj "COLLECTION:<slug>" (audit 2026-09-15, regula finală de
     * business - persistent attribution) - convenție UNICĂ, valabilă
     * atât pentru own-sale prin cod de colecție (discountCodeScope),
     * cât și pentru referral cross-vendor prin token de vizitare a
     * colecției (promoter.vendor.collectionSlug, vezi
     * resolveVendorCollectionAttribution). UI-ul (Vendor/Admin) NU
     * trebuie să afișeze literal acest string - vezi
     * formatAttributionSourceLabel.
     */
    const collectionSlugForMarker =
      promoter.vendor.collectionSlug ||
      (discountCodeScope === "VENDOR_COLLECTION"
        ? discountCodeCollectionSlug
        : null);

    if (isOwnSale) {
      fields.vendorReferralCommissionOverrideBps =
        VENDOR_REFERRAL_OWN_SALE_COMMISSION_BPS;
      fields.vendorReferralOwnSaleAttributedAt = new Date();

      if (collectionSlugForMarker) {
        fields.referrerVendorReferralCodeSnapshot =
          `COLLECTION:${collectionSlugForMarker}`;
      }
    } else {
      fields.referrerVendorId = promoter.vendor.vendorId;
      fields.referrerVendorReferralCodeSnapshot = collectionSlugForMarker
        ? `COLLECTION:${collectionSlugForMarker}`
        : promoter.vendor.referralCodeSnapshot;
      fields.referrerVendorCommissionBpsSnapshot =
        promoter.vendor.commissionBpsSnapshot;
      fields.referrerVendorAttributedAt = new Date();
    }

    return fields;
  }

  return fields;
}

/*
 * Combină refVendorAttribution (?ref=) cu refCollectionAttribution
 * (vizitare VendorCollection) într-un SINGUR candidat "referral pasiv"
 * PER SHIPMENT (audit 2026-09-15, regula finală de business):
 *
 * 1. Dacă atribuirea de colecție ar produce own-sale PENTRU ACEST
 *    shipment (vendorul colecției === vendorul shipment-ului) ȘI
 *    produsul NU e chiar în colecție (shipmentEligibleByCollectionMembership
 *    fals), o EXCLUDEM - tokenul de colecție NU poate transforma o
 *    vânzare proprie DIN AFARA colecției în own-sale promoțional.
 *    Dacă produsul CHIAR e în colecție, tokenul rămâne valid candidat
 *    și own-sale-ul se acordă chiar și FĂRĂ cod de reducere introdus
 *    (simpla vizitare + cumpărare directă) - vezi
 *    collectionMemberProductIdsForToken mai sus. ?ref= își păstrează
 *    comportamentul existent, neschimbat (nu e cerut să-l atingem).
 * 2. Dacă rămân ambele candidate (ref + colecție), câștigă cel mai
 *    RECENT EMIS (issuedAt/iat al tokenului) - "global last click
 *    wins", exact regula cerută.
 *
 * Prioritatea codului explicit de reducere e deja garantată STRUCTURAL
 * - această funcție alimentează DOAR fallback-ul refVendorAttribution
 * din resolveShipmentPromoter, verificat ULTIMUL, după toate branch-urile
 * bazate pe discountCodeVendorAttribution.
 */
export function resolveEffectiveRefVendorAttribution({
  refVendorAttribution,
  refCollectionAttribution,
  shipmentVendorId,
  shipmentEligibleByCollectionMembership = false,
}) {
  const isOwnVendorCollection =
    refCollectionAttribution &&
    String(refCollectionAttribution.vendorId) === String(shipmentVendorId);

  const collectionCandidate =
    refCollectionAttribution &&
    (!isOwnVendorCollection || shipmentEligibleByCollectionMembership)
      ? refCollectionAttribution
      : null;

  if (refVendorAttribution && collectionCandidate) {
    return (collectionCandidate.issuedAt || 0) >
      (refVendorAttribution.issuedAt || 0)
      ? collectionCandidate
      : refVendorAttribution;
  }

  return refVendorAttribution || collectionCandidate || null;
}

function mapCartItemForCheckout(
  it,
  pricing = null
) {
  const product =
    it?.product || {};

  const originalPriceCents =
    Number(
      pricing?.originalPriceCents ??
        product.priceCents ??
        0
    );

  const finalPriceCents =
    Number(
      pricing?.finalPriceCents ??
        product.priceCents ??
        0
    );

  const hasDiscount =
    Boolean(
      pricing?.hasDiscount &&
        finalPriceCents <
          originalPriceCents
    );

  return {
    productId:
      it.productId,

    title:
      product.title ||
      "Produs",

    qty:
      Number(
        it.qty || 0
      ),

    selectedOptions:
      it.selectedOptions || {},

    customAnswers:
      it.customAnswers || {},

    repeatedGroupAnswers:
      it.repeatedGroupAnswers || {},

    configurationKey:
      it.configurationKey ||
      "default",

    price:
      dec(
        finalPriceCents /
          100
      ),

    priceCents:
      finalPriceCents,

    finalPriceCents,

    discountedPriceCents:
      finalPriceCents,

    originalPrice:
      hasDiscount
        ? dec(
            originalPriceCents /
              100
          )
        : null,

    originalPriceCents:
      hasDiscount
        ? originalPriceCents
        : null,

    hasDiscount,

    discountPercent:
      hasDiscount
        ? Number(
            pricing
              ?.discountPercent ||
              0
          )
        : 0,

    totalDiscountPercent:
      hasDiscount
        ? Number(
            pricing
              ?.totalDiscountPercent ||
              0
          )
        : 0,

    platformDiscountPercent:
      hasDiscount
        ? Number(
            pricing
              ?.platformDiscountPercent ||
              0
          )
        : 0,

    vendorDiscountPercent:
      hasDiscount
        ? Number(
            pricing
              ?.vendorDiscountPercent ||
              0
          )
        : 0,

    hasActiveHomepageDiscount:
      Boolean(
        pricing
          ?.hasActiveHomepageDiscount
      ),

    promoLabel:
      pricing?.promoLabel ||
      pricing?.discount?.label ||
      null,

    promoFundingSource:
      pricing
        ?.promoFundingSource ||
      pricing?.discount
        ?.fundingSource ||
      null,

    promoCollectionId:
      pricing
        ?.promoCollectionId ||
      pricing?.discount
        ?.collectionId ||
      null,

    homepageFeatureId:
      pricing?.discount
        ?.homepageFeatureId ||
      null,

    discountSource:
      pricing?.discount
        ?.source ||
      null,

    discount:
      pricing?.discount || {
        active: false,
        source: null,
        totalDiscountPercent: 0,
      },

    currency:
      product.currency ||
      "RON",

    vendorId:
      product.service
        ?.vendorId ||
      null,

    serviceId:
      product.service?.id ||
      null,

    category:
      product.category ||
      null,
  };
}

const normalizeText = (v = "") => String(v || "").trim();
function normalizeConfigurationKey(value) {
  const raw =
    normalizeText(value);

  if (
    !raw ||
    raw === "default"
  ) {
    return "default";
  }

  if (
    raw.length <= 64
  ) {
    return raw;
  }

  return crypto
    .createHash("sha256")
    .update(raw, "utf8")
    .digest("hex");
}
const normalizeDigits = (v = "") => String(v || "").replace(/\D/g, "");
const normalizeCui = (v = "") =>
  String(v || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();

const isValidPhone = (v = "") => {
  const digits = normalizeDigits(v);
  return /^\d{10}$/.test(digits);
};

const isValidEmail = (v = "") => {
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

const isValidPostalCode = (v = "") => {
  const trimmed = String(v || "").trim();
  return !trimmed || /^\d{6}$/.test(trimmed);
};

const isValidCui = (v = "") => {
  const cui = normalizeCui(v);

  if (!cui) return false;

  if (cui.startsWith("RO")) {
    return /^RO\d{2,10}$/.test(cui);
  }

  return /^\d{2,10}$/.test(cui);
};

function mapPublicBilling(billing) {
  if (!billing) return null;
  return {
    tvaActive: billing.tvaActive,
    vatRate: billing.vatRate,
    vatStatus: billing.vatStatus,
  };
}

function generateOrderNumber() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AF-${t}-${r}`.slice(0, 32);
}

function generateGuestAccessToken() {
  const token = crypto.randomBytes(32).toString("hex");

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  return {
    token,
    tokenHash,
  };
}

function buildFullName(obj = {}) {
  if (normalizeText(obj.name)) return normalizeText(obj.name);
  return `${normalizeText(obj.lastName)} ${normalizeText(obj.firstName)}`.trim();
}

function buildNormalizedShippingAddress(address) {
  return {
    ...address,
    firstName: normalizeText(address?.firstName),
    lastName: normalizeText(address?.lastName),
    name: buildFullName(address),
    phone: normalizeDigits(address?.phone).slice(0, 10),
    email: normalizeText(address?.email),
    county: address?.county || "",
    city: normalizeText(address?.city),
    postalCode: normalizeText(address?.postalCode),
    street: normalizeText(address?.street),
    notes: normalizeText(address?.notes),
  };
}

function buildNormalizedBillingAddress(billingAddress) {
  if (!billingAddress) return null;

  return {
    ...billingAddress,
    companyName: normalizeText(billingAddress.companyName),
    companyCui: normalizeCui(billingAddress.companyCui),
    companyRegCom: normalizeText(billingAddress.companyRegCom),
    county: billingAddress.county || "",
    city: normalizeText(billingAddress.city),
    postalCode: normalizeText(billingAddress.postalCode),
    street: normalizeText(billingAddress.street),
  };
}

function buildNormalizedContactPerson(contactPerson) {
  if (!contactPerson) return null;

  return {
    ...contactPerson,
    firstName: normalizeText(contactPerson.firstName),
    lastName: normalizeText(contactPerson.lastName),
    name: buildFullName(contactPerson),
    email: normalizeText(contactPerson.email),
    phone: normalizeDigits(contactPerson.phone).slice(0, 10),
  };
}

function validateShippingAddress(address) {
  if (!address) {
    return {
      error: "address_required",
      message: "Adresa de livrare este obligatorie.",
    };
  }

  if (!normalizeText(address.firstName)) {
    return {
      error: "shipping_first_name_required",
      message: "Completează prenumele pentru livrare.",
    };
  }

  if (!normalizeText(address.lastName)) {
    return {
      error: "shipping_last_name_required",
      message: "Completează numele pentru livrare.",
    };
  }

  if (!normalizeText(address.phone)) {
    return {
      error: "phone_required",
      message: "Completează numărul de telefon.",
    };
  }

  if (!isValidPhone(address.phone)) {
    return {
      error: "phone_invalid",
      message: "Numărul de telefon trebuie să conțină exact 10 cifre.",
    };
  }

  if (!normalizeText(address.email)) {
    return {
      error: "email_required",
      message: "Completează adresa de email.",
    };
  }

  if (!isValidEmail(address.email)) {
    return {
      error: "email_invalid",
      message: "Adresa de email nu este validă.",
    };
  }

  if (!address.county) {
    return {
      error: "shipping_county_required",
      message: "Selectează județul pentru livrare.",
    };
  }

  if (!normalizeText(address.city)) {
    return {
      error: "shipping_city_required",
      message: "Completează orașul / localitatea pentru livrare.",
    };
  }

  if (!normalizeText(address.street)) {
    return {
      error: "shipping_street_required",
      message: "Completează strada și numărul pentru livrare.",
    };
  }

  if (!isValidPostalCode(address.postalCode)) {
    return {
      error: "shipping_postal_code_invalid",
      message: "Codul poștal pentru livrare trebuie să aibă exact 6 cifre.",
    };
  }

  return null;
}

function validateBillingCompany(billingAddress) {
  if (!billingAddress) {
    return {
      error: "company_required",
      message: "Datele firmei sunt obligatorii pentru persoană juridică.",
    };
  }

  if (!normalizeText(billingAddress.companyName)) {
    return {
      error: "company_name_required",
      message: "Completează denumirea firmei.",
    };
  }

  if (!normalizeText(billingAddress.companyCui)) {
    return {
      error: "company_cui_required",
      message: "Completează CUI-ul firmei.",
    };
  }

  if (!isValidCui(billingAddress.companyCui)) {
    return {
      error: "company_cui_invalid",
      message: "CUI-ul firmei nu are un format valid.",
    };
  }

  if (!billingAddress.county) {
    return {
      error: "company_county_required",
      message: "Selectează județul sediului firmei.",
    };
  }

  if (!normalizeText(billingAddress.city)) {
    return {
      error: "company_city_required",
      message: "Completează orașul sediului firmei.",
    };
  }

  if (!normalizeText(billingAddress.street)) {
    return {
      error: "company_street_required",
      message: "Completează strada și numărul sediului firmei.",
    };
  }

  if (!isValidPostalCode(billingAddress.postalCode)) {
    return {
      error: "company_postal_code_invalid",
      message: "Codul poștal al sediului firmei trebuie să aibă exact 6 cifre.",
    };
  }

  return null;
}

function validateContactPerson(contactPerson) {
  if (!contactPerson) {
    return {
      error: "contact_required",
      message: "Persoana de contact este obligatorie.",
    };
  }

  if (!normalizeText(contactPerson.firstName)) {
    return {
      error: "contact_first_name_required",
      message: "Completează prenumele persoanei de contact.",
    };
  }

  if (!normalizeText(contactPerson.lastName)) {
    return {
      error: "contact_last_name_required",
      message: "Completează numele persoanei de contact.",
    };
  }

  if (!normalizeText(contactPerson.email)) {
    return {
      error: "contact_email_required",
      message: "Completează emailul persoanei de contact.",
    };
  }

  if (!isValidEmail(contactPerson.email)) {
    return {
      error: "contact_email_invalid",
      message: "Emailul persoanei de contact nu este valid.",
    };
  }

  if (!normalizeText(contactPerson.phone)) {
    return {
      error: "contact_phone_required",
      message: "Completează telefonul persoanei de contact.",
    };
  }

  if (!isValidPhone(contactPerson.phone)) {
    return {
      error: "contact_phone_invalid",
      message:
        "Telefonul persoanei de contact trebuie să conțină exact 10 cifre.",
    };
  }

  return null;
}

async function getGuestCart(
  rawItems = []
) {
  if (
    !Array.isArray(
      rawItems
    )
  ) {
    return [];
  }

  const normalizedItems = [];
  const itemsByConfiguration =
    new Map();

  for (
    const rawItem of
    rawItems
  ) {
    const productId =
      normalizeText(
        rawItem?.productId
      );

    if (!productId) {
      continue;
    }

    const qty =
      Math.min(
        99,
        Math.max(
          1,
          Number.parseInt(
            rawItem?.qty,
            10
          ) || 1
        )
      );

    const selectedOptions =
      rawItem?.selectedOptions &&
      typeof rawItem
        .selectedOptions ===
        "object" &&
      !Array.isArray(
        rawItem.selectedOptions
      )
        ? rawItem.selectedOptions
        : {};

    const customAnswers =
      rawItem?.customAnswers &&
      typeof rawItem
        .customAnswers ===
        "object" &&
      !Array.isArray(
        rawItem.customAnswers
      )
        ? rawItem.customAnswers
        : {};

    const repeatedGroupAnswers =
      rawItem
        ?.repeatedGroupAnswers &&
      typeof rawItem
        .repeatedGroupAnswers ===
        "object" &&
      !Array.isArray(
        rawItem
          .repeatedGroupAnswers
      )
        ? rawItem
            .repeatedGroupAnswers
        : {};

   const configurationKey =
  normalizeConfigurationKey(
    rawItem
      ?.configurationKey
  );

    const itemKey =
      `${productId}:${configurationKey}`;

    const existing =
      itemsByConfiguration.get(
        itemKey
      );

    if (existing) {
      existing.qty =
        Math.min(
          99,
          existing.qty +
            qty
        );
    } else {
      const item = {
        productId,
        qty,

        selectedOptions,
        customAnswers,
        repeatedGroupAnswers,

        configurationKey,
      };

      normalizedItems.push(
        item
      );

      itemsByConfiguration.set(
        itemKey,
        item
      );
    }
  }

  const productIds = [
    ...new Set(
      normalizedItems.map(
        (item) =>
          item.productId
      )
    ),
  ];

  if (!productIds.length) {
    return [];
  }

  const products =
    await prisma.product.findMany({
      where: {
        id: {
          in: productIds,
        },
      },

      select: {
        id: true,
        title: true,
        images: true,
        priceCents: true,
        category: true,
        currency: true,
        acceptsCustom: true,

        styleTags: true,
        occasionTags: true,

        availability: true,
        readyQty: true,
        isActive: true,
        isHidden: true,
        moderationStatus: true,

        service: {
          select: {
            id: true,
            title: true,
            vendorId: true,

            estimatedShippingFeeCents:
              true,

            freeShippingThresholdCents:
              true,

            shippingNotes:
              true,

            vendor: {
              select: {
                billing: true,
              },
            },
          },
        },
      },
    });

  const productsById =
    new Map(
      products.map(
        (product) => [
          product.id,
          product,
        ]
      )
    );

  if (
    products.length !==
    productIds.length
  ) {
    throw new Error(
      "product_not_found"
    );
  }

  return normalizedItems.map(
    (item) => ({
      ...item,

      product:
        productsById.get(
          item.productId
        ),
    })
  );
}

/**
 * Construiește grupurile de checkout pe service (magazin)
 */
function buildCheckoutGroups(
  cart,
  pricingByProductId = new Map()
) {
  const map = new Map();

  for (const it of cart) {
    const service = it.product?.service;
    const serviceId = service?.id || null;
    const vendorId = service?.vendorId || null;

    if (!serviceId || !vendorId) continue;

    if (!map.has(serviceId)) {
      map.set(serviceId, {
        serviceId,
        vendorId,
        serviceTitle: service?.title || "",
        estimatedShippingFeeCents:
          service?.estimatedShippingFeeCents != null
            ? Number(service.estimatedShippingFeeCents)
            : null,
        freeShippingThresholdCents:
          service?.freeShippingThresholdCents != null
            ? Number(service.freeShippingThresholdCents)
            : null,
        shippingNotes: service?.shippingNotes || null,
        items: [],
      });
    }

    map.get(serviceId).items.push(
      mapCartItemForCheckout(
  it,
  pricingByProductId.get(
    it.product?.id
  ) || null
)
    );
  }

  return Array.from(map.values());
}

/**
 * Serializare comună a rezultatului de validare, pentru cele două
 * rute de preview de mai jos - nu expune niciodată intern
 * platformFundingBps/vendorFundingBps brute din DB dacă nu sunt
 * relevante pentru client, doar ce are nevoie UI-ul.
 */
function serializeDiscountCodeValidation(validation) {
  if (!validation?.valid) {
    return {
      valid: false,
      error: validation?.error || "discount_code_invalid",
      message:
        validation?.message ||
        "Codul de reducere nu este valabil.",
    };
  }

  /*
   * Codul rămâne VALID chiar dacă nu câștigă best promotion pe niciun
   * produs (sau doar pe unele) - doar mesajul explică situația
   * clientului. Nu transformăm asta într-o eroare.
   */
  const message =
    validation.wonOnAnyItem === false
      ? "Codul este valid, dar pentru acest produs se aplică automat o promoție mai avantajoasă."
      : validation.lostToOtherPromotion
      ? "Codul se aplică parțial - pentru unele produse din coș există deja o promoție mai avantajoasă."
      : null;

  return {
    valid: true,
    error: null,
    message,
    code: validation.discountCode.code,
    discountType: validation.discountCode.discountType,
    effectiveDiscountPercent: validation.effectiveDiscountPercent,
    estimatedDiscountAmountCents: validation.estimatedDiscountAmountCents,
    wonOnAnyItem: validation.wonOnAnyItem !== false,
    eligibleProductIds: [...validation.eligibleProductIds],
  };
}

/**
 * POST /checkout/discount-code/validate
 * Preview pentru utilizator autentificat - folosește coșul din DB.
 */
router.post(
  "/checkout/discount-code/validate",
  authRequired,
  async (req, res) => {
    try {
      const code = String(req.body?.code || "");

      const cart = await prisma.cartItem.findMany({
        where: { userId: req.user.sub },
        include: {
          product: {
            select: {
              id: true,
              priceCents: true,
              currency: true,
              service: { select: { id: true, vendorId: true } },
            },
          },
        },
      });

      if (!cart.length) {
        return res.status(400).json({
          error: "cart_empty",
          message: "Coșul este gol.",
        });
      }

      const currency = cart[0]?.product?.currency || "RON";

      let validation = await validateDiscountCode({
        code,
        cartItems: cart,
        currency,
        userId: req.user.sub,
        customerEmail: null,
      });

      /*
       * Preview complet, identic ca sursă cu /checkout/summary: dacă
       * codul e valid, îl trecem prin ACEEAȘI best-promotion (Collection
       * + Homepage se rezolvă intern; Campanie doar dacă frontendul
       * trimite campaignAttribution, exact ca la summary) - fără asta,
       * preview-ul din Cart ar putea arăta o valoare pe care codul nu
       * o câștigă efectiv.
       */
      if (validation.valid) {
        const validateVendorIds = [
          ...new Set(
            cart
              .map((item) => item.product?.service?.vendorId)
              .filter(Boolean)
              .map(String)
          ),
        ];

        const validateCampaignAttributionsByVendorId =
          await resolveVendorCampaignAttributions({
            vendorIds: validateVendorIds,
            tokensByVendorId: req.body?.campaignAttribution || {},
          });

        const validateProducts = cart
          .map((item) => item.product)
          .filter(Boolean);

        const validateCampaignPromotionsByProductId =
          buildCampaignPromotionsByProductId(
            validateProducts,
            validateCampaignAttributionsByVendorId
          );

        const validateDiscountCodePromotionsByProductId =
          buildDiscountCodePromotionsByProductId(validation, {
            cartItems: cart,
          });

        const validatePricingByProductId =
          await getPromotionPricingForProducts(validateProducts, {
            campaignPromotionsByProductId:
              validateCampaignPromotionsByProductId,
            discountCodePromotionsByProductId:
              validateDiscountCodePromotionsByProductId,
          });

        validation = realizeDiscountCodeAmount({
          validation,
          cartItems: cart,
          pricingByProductId: validatePricingByProductId,
        });
      }

      return res.json(serializeDiscountCodeValidation(validation));
    } catch (err) {
      console.error("POST /checkout/discount-code/validate FAILED:", err);
      return res.status(500).json({
        error: "discount_code_validate_failed",
        message: "Nu am putut valida codul de reducere.",
      });
    }
  }
);

/**
 * POST /checkout/guest/discount-code/validate
 * Preview pentru guest - clientul trimite explicit itemele din coș
 * (identic ca formă cu /checkout/guest/summary).
 */
router.post(
  "/checkout/guest/discount-code/validate",
  async (req, res) => {
    try {
      const code = String(req.body?.code || "");
      const customerEmail = String(req.body?.customerEmail || "") || null;

      const cart = await getGuestCart(req.body?.items || []);

      if (!cart.length) {
        return res.status(400).json({
          error: "cart_empty",
          message: "Coșul este gol.",
        });
      }

      const currency = cart[0]?.product?.currency || "RON";

      let validation = await validateDiscountCode({
        code,
        cartItems: cart,
        currency,
        userId: null,
        customerEmail,
      });

      if (validation.valid) {
        const validateVendorIds = [
          ...new Set(
            cart
              .map((item) => item.product?.service?.vendorId)
              .filter(Boolean)
              .map(String)
          ),
        ];

        const validateCampaignAttributionsByVendorId =
          await resolveVendorCampaignAttributions({
            vendorIds: validateVendorIds,
            tokensByVendorId: req.body?.campaignAttribution || {},
          });

        const validateProducts = cart
          .map((item) => item.product)
          .filter(Boolean);

        const validateCampaignPromotionsByProductId =
          buildCampaignPromotionsByProductId(
            validateProducts,
            validateCampaignAttributionsByVendorId
          );

        const validateDiscountCodePromotionsByProductId =
          buildDiscountCodePromotionsByProductId(validation, {
            cartItems: cart,
          });

        const validatePricingByProductId =
          await getPromotionPricingForProducts(validateProducts, {
            campaignPromotionsByProductId:
              validateCampaignPromotionsByProductId,
            discountCodePromotionsByProductId:
              validateDiscountCodePromotionsByProductId,
          });

        validation = realizeDiscountCodeAmount({
          validation,
          cartItems: cart,
          pricingByProductId: validatePricingByProductId,
        });
      }

      return res.json(serializeDiscountCodeValidation(validation));
    } catch (err) {
      console.error(
        "POST /checkout/guest/discount-code/validate FAILED:",
        err
      );

      if (err?.message === "product_not_found") {
        return res.status(404).json({
          error: "product_not_found",
          message: "Un produs din coș nu mai există.",
        });
      }

      return res.status(500).json({
        error: "discount_code_validate_failed",
        message: "Nu am putut valida codul de reducere.",
      });
    }
  }
);

/**
 * SUMMARY
 */
router.get(
  "/checkout/summary",
  authRequired,
  async (req, res) => {
    try {
      const items =
        await prisma.cartItem.findMany({
          where: {
            userId:
              req.user.sub,
          },

          include: {
            product: {
              select: {
                id: true,
                title: true,
                images: true,

                priceCents:
                  true,

                category: true,
                currency: true,

                acceptsCustom:
                  true,

                styleTags: true,
                occasionTags:
                  true,

                service: {
                  select: {
                    id: true,
                    title: true,
                    vendorId: true,

                    estimatedShippingFeeCents:
                      true,

                    freeShippingThresholdCents:
                      true,

                    shippingNotes:
                      true,

                    vendor: {
                      select: {
                        billing:
                          true,
                      },
                    },
                  },
                },
              },
            },
          },

          orderBy: {
            createdAt:
              "desc",
          },
        });

      if (!items.length) {
        return res.json({
          items: [],
          groups: [],
          currency: "RON",
          subtotal: 0,
          cardPaymentAvailable: true,
          cardPaymentUnavailableReason: null,
        });
      }

      const products =
        items
          .map(
            (item) =>
              item.product
          )
          .filter(Boolean);

      const summaryVendorIds = [
        ...new Set(
          items
            .map((item) => item.product?.service?.vendorId)
            .filter(Boolean)
            .map(String)
        ),
      ];

      /*
       * Info NON-sensibilă pentru frontend: doar un boolean derivat,
       * niciun detaliu intern despre contul Stripe al vendorului.
       */
      const summaryVendorsStripeStatus =
        await prisma.vendor.findMany({
          where: { id: { in: summaryVendorIds } },
          select: VENDOR_STRIPE_STATUS_SELECT,
        });

      const summaryCardPaymentAvailable =
        summaryVendorsStripeStatus.length === summaryVendorIds.length &&
        computeCardPaymentAvailability(summaryVendorsStripeStatus);

      const summaryCampaignAttribution =
        parseCampaignAttributionQuery(
          req.query?.campaignAttribution
        );

      const summaryCampaignAttributionsByVendorId =
        await resolveVendorCampaignAttributions({
          vendorIds: summaryVendorIds,
          tokensByVendorId: summaryCampaignAttribution,
        });

      const summaryCampaignPromotionsByProductId =
        buildCampaignPromotionsByProductId(
          products,
          summaryCampaignAttributionsByVendorId
        );

      const currency =
        items[0]?.product
          ?.currency ||
        "RON";

      let summaryDiscountCodeValidation =
        req.query?.discountCode
          ? await validateDiscountCode({
              code: String(req.query.discountCode),
              cartItems: items,
              currency,
              userId: req.user.sub,
              customerEmail: null,
            })
          : null;

      const summaryDiscountCodePromotionsByProductId =
        buildDiscountCodePromotionsByProductId(
          summaryDiscountCodeValidation,
          { cartItems: items }
        );

      const pricingByProductId =
        await getPromotionPricingForProducts(
          products,
          {
            campaignPromotionsByProductId:
              summaryCampaignPromotionsByProductId,
            discountCodePromotionsByProductId:
              summaryDiscountCodePromotionsByProductId,
          }
        );

      /*
       * Preview-ul codului trebuie să arate DOAR ce câștigă efectiv
       * după best promotion - nu valoarea lui brută. Re-agregăm din
       * pricingByProductId, deja calculat mai sus (aceeași sursă,
       * niciun calculator nou).
       */
      summaryDiscountCodeValidation = realizeDiscountCodeAmount({
        validation: summaryDiscountCodeValidation,
        cartItems: items,
        pricingByProductId,
      });

      const mapped =
        items.map(
          (item) => {
            const product =
              item.product;

            const service =
              product?.service;

            const vendorId =
              service?.vendorId ||
              null;

            const serviceId =
              service?.id ||
              null;

            const vendorBilling =
              service?.vendor
                ?.billing
                ? mapPublicBilling(
                    service
                      .vendor
                      .billing
                  )
                : null;

            const pricing =
              pricingByProductId.get(
                product.id
              ) || null;

            const finalPriceCents =
              Number(
                pricing
                  ?.finalPriceCents ??
                  product
                    .priceCents ??
                  0
              );

            const originalPriceCents =
              Number(
                pricing
                  ?.originalPriceCents ??
                  product
                    .priceCents ??
                  0
              );

            const hasDiscount =
              Boolean(
                pricing
                  ?.hasDiscount &&
                finalPriceCents <
                  originalPriceCents
              );

            return {
              productId:
                item.productId,

              serviceId,
              vendorId,

              title:
                product.title,

              image:
                Array.isArray(
                  product.images
                ) &&
                product.images[0]
                  ? product
                      .images[0]
                  : null,

              qty:
                item.qty,

              selectedOptions:
                item.selectedOptions ||
                {},

              customAnswers:
                item.customAnswers ||
                {},

              repeatedGroupAnswers:
                item
                  .repeatedGroupAnswers ||
                {},

              configurationKey:
                item
                  .configurationKey ||
                "default",

              price:
                dec(
                  finalPriceCents /
                    100
                ),

              priceCents:
                finalPriceCents,

              finalPriceCents,

              discountedPriceCents:
                finalPriceCents,

              originalPrice:
                hasDiscount
                  ? dec(
                      originalPriceCents /
                        100
                    )
                  : null,

              originalPriceCents:
                hasDiscount
                  ? originalPriceCents
                  : null,

              hasDiscount,

              discountPercent:
                hasDiscount
                  ? Number(
                      pricing
                        ?.discountPercent ||
                        0
                    )
                  : 0,

              totalDiscountPercent:
                hasDiscount
                  ? Number(
                      pricing
                        ?.totalDiscountPercent ||
                        0
                    )
                  : 0,

              platformDiscountPercent:
                hasDiscount
                  ? Number(
                      pricing
                        ?.platformDiscountPercent ||
                        0
                    )
                  : 0,

              vendorDiscountPercent:
                hasDiscount
                  ? Number(
                      pricing
                        ?.vendorDiscountPercent ||
                        0
                    )
                  : 0,

              hasActiveHomepageDiscount:
                Boolean(
                  pricing
                    ?.hasActiveHomepageDiscount
                ),

              promoLabel:
                pricing
                  ?.promoLabel ||
                pricing
                  ?.discount
                  ?.label ||
                null,

              promoFundingSource:
                pricing
                  ?.promoFundingSource ||
                pricing
                  ?.discount
                  ?.fundingSource ||
                null,

              promoCollectionId:
                pricing
                  ?.promoCollectionId ||
                pricing
                  ?.discount
                  ?.collectionId ||
                null,

              homepageFeatureId:
                pricing
                  ?.discount
                  ?.homepageFeatureId ||
                null,

              discountSource:
                pricing
                  ?.discount
                  ?.source ||
                null,

              discount:
                pricing
                  ?.discount ||
                null,

              category:
                product.category ||
                null,

              currency:
                product.currency ||
                currency,

              vendorBilling,

              estimatedShippingFee:
                service
                  ?.estimatedShippingFeeCents !=
                null
                  ? dec(
                      Number(
                        service
                          .estimatedShippingFeeCents
                      ) / 100
                    )
                  : null,

              freeShippingThreshold:
                service
                  ?.freeShippingThresholdCents !=
                null
                  ? dec(
                      Number(
                        service
                          .freeShippingThresholdCents
                      ) / 100
                    )
                  : null,

              shippingNotes:
                service
                  ?.shippingNotes ||
                null,
            };
          }
        );

      const groups =
        buildCheckoutGroups(
          items,
          pricingByProductId
        ).map(
          (group) => ({
            serviceId:
              group.serviceId,

            vendorId:
              group.vendorId,

            serviceTitle:
              group.serviceTitle,

            estimatedShippingFee:
              group
                .estimatedShippingFeeCents !=
              null
                ? dec(
                    group
                      .estimatedShippingFeeCents /
                      100
                  )
                : null,

            freeShippingThreshold:
              group
                .freeShippingThresholdCents !=
              null
                ? dec(
                    group
                      .freeShippingThresholdCents /
                      100
                  )
                : null,

            shippingNotes:
              group.shippingNotes ||
              null,

            subtotal:
              dec(
                group.items.reduce(
                  (
                    sum,
                    item
                  ) =>
                    sum +
                    Number(
                      item.price ||
                        0
                    ) *
                      Number(
                        item.qty ||
                          0
                      ),
                  0
                )
              ),

            items:
              group.items,
          })
        );

      const subtotal =
        dec(
          mapped.reduce(
            (
              sum,
              item
            ) =>
              sum +
              Number(
                item.price ||
                  0
              ) *
                Number(
                  item.qty ||
                    0
                ),
            0
          )
        );

      return res.json({
        items: mapped,
        groups,
        currency,
        subtotal,
        discountCode: summaryDiscountCodeValidation
          ? serializeDiscountCodeValidation(
              summaryDiscountCodeValidation
            )
          : null,
        cardPaymentAvailable: summaryCardPaymentAvailable,
        cardPaymentUnavailableReason: summaryCardPaymentAvailable
          ? null
          : "Plata cu cardul nu este disponibilă pentru unul dintre magazinele din comandă.",
      });
    } catch (error) {
      console.error(
        "Eroare la sumarul checkout:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "checkout_summary_failed",

          message:
            "Nu am putut încărca sumarul comenzii.",
        });
    }
  }
);

router.post(
  "/checkout/guest/summary",
  async (req, res) => {
    try {
      const cart =
        await getGuestCart(
          req.body?.items ||
            []
        );

      if (!cart.length) {
        return res.json({
          items: [],
          groups: [],
          currency: "RON",
          subtotal: 0,
          cardPaymentAvailable: true,
          cardPaymentUnavailableReason: null,
        });
      }

      const products =
        cart
          .map(
            (item) =>
              item.product
          )
          .filter(Boolean);

      const guestSummaryVendorIds = [
        ...new Set(
          cart
            .map((item) => item.product?.service?.vendorId)
            .filter(Boolean)
            .map(String)
        ),
      ];

      const guestSummaryVendorsStripeStatus =
        await prisma.vendor.findMany({
          where: { id: { in: guestSummaryVendorIds } },
          select: VENDOR_STRIPE_STATUS_SELECT,
        });

      const guestSummaryCardPaymentAvailable =
        guestSummaryVendorsStripeStatus.length === guestSummaryVendorIds.length &&
        computeCardPaymentAvailability(guestSummaryVendorsStripeStatus);

      const guestSummaryCampaignAttributionsByVendorId =
        await resolveVendorCampaignAttributions({
          vendorIds: guestSummaryVendorIds,
          tokensByVendorId: req.body?.campaignAttribution || {},
        });

      const guestSummaryCampaignPromotionsByProductId =
        buildCampaignPromotionsByProductId(
          products,
          guestSummaryCampaignAttributionsByVendorId
        );

      const currency =
        cart[0]?.product
          ?.currency ||
        "RON";

      let guestSummaryDiscountCodeValidation =
        req.body?.discountCode
          ? await validateDiscountCode({
              code: String(req.body.discountCode),
              cartItems: cart,
              currency,
              userId: null,
              customerEmail: req.body?.customerEmail || null,
            })
          : null;

      const guestSummaryDiscountCodePromotionsByProductId =
        buildDiscountCodePromotionsByProductId(
          guestSummaryDiscountCodeValidation,
          { cartItems: cart }
        );

      const pricingByProductId =
        await getPromotionPricingForProducts(
          products,
          {
            campaignPromotionsByProductId:
              guestSummaryCampaignPromotionsByProductId,
            discountCodePromotionsByProductId:
              guestSummaryDiscountCodePromotionsByProductId,
          }
        );

      guestSummaryDiscountCodeValidation = realizeDiscountCodeAmount({
        validation: guestSummaryDiscountCodeValidation,
        cartItems: cart,
        pricingByProductId,
      });

      const mapped =
        cart.map(
          (item) => {
            const product =
              item.product;

            const service =
              product?.service;

            const pricing =
              pricingByProductId.get(
                product?.id
              ) || null;

            const finalPriceCents =
              Number(
                pricing
                  ?.finalPriceCents ??
                  product
                    ?.priceCents ??
                  0
              );

            const originalPriceCents =
              Number(
                pricing
                  ?.originalPriceCents ??
                  product
                    ?.priceCents ??
                  0
              );

            const hasDiscount =
              Boolean(
                pricing
                  ?.hasDiscount &&
                finalPriceCents <
                  originalPriceCents
              );

            return {
              productId:
                item.productId,

              serviceId:
                service?.id ||
                null,

              vendorId:
                service
                  ?.vendorId ||
                null,

              title:
                product?.title ||
                "Produs",

              image:
                Array.isArray(
                  product?.images
                ) &&
                product.images[0]
                  ? product
                      .images[0]
                  : null,

              qty:
                item.qty,

              selectedOptions:
                item
                  .selectedOptions ||
                {},

              customAnswers:
                item
                  .customAnswers ||
                {},

              repeatedGroupAnswers:
                item
                  .repeatedGroupAnswers ||
                {},

              configurationKey:
                item
                  .configurationKey ||
                "default",

              price:
                dec(
                  finalPriceCents /
                    100
                ),

              priceCents:
                finalPriceCents,

              finalPriceCents,

              discountedPriceCents:
                finalPriceCents,

              originalPrice:
                hasDiscount
                  ? dec(
                      originalPriceCents /
                        100
                    )
                  : null,

              originalPriceCents:
                hasDiscount
                  ? originalPriceCents
                  : null,

              hasDiscount,

              discountPercent:
                hasDiscount
                  ? Number(
                      pricing
                        ?.discountPercent ||
                        0
                    )
                  : 0,

              totalDiscountPercent:
                hasDiscount
                  ? Number(
                      pricing
                        ?.totalDiscountPercent ||
                        0
                    )
                  : 0,

              platformDiscountPercent:
                hasDiscount
                  ? Number(
                      pricing
                        ?.platformDiscountPercent ||
                        0
                    )
                  : 0,

              vendorDiscountPercent:
                hasDiscount
                  ? Number(
                      pricing
                        ?.vendorDiscountPercent ||
                        0
                    )
                  : 0,

              hasActiveHomepageDiscount:
                Boolean(
                  pricing
                    ?.hasActiveHomepageDiscount
                ),

              promoLabel:
                pricing
                  ?.promoLabel ||
                pricing
                  ?.discount
                  ?.label ||
                null,

              promoFundingSource:
                pricing
                  ?.promoFundingSource ||
                pricing
                  ?.discount
                  ?.fundingSource ||
                null,

              promoCollectionId:
                pricing
                  ?.promoCollectionId ||
                pricing
                  ?.discount
                  ?.collectionId ||
                null,

              homepageFeatureId:
                pricing
                  ?.discount
                  ?.homepageFeatureId ||
                null,

              discountSource:
                pricing
                  ?.discount
                  ?.source ||
                null,

              discount:
                pricing
                  ?.discount ||
                null,

              category:
                product
                  ?.category ||
                null,

              currency:
                product
                  ?.currency ||
                currency,

              vendorBilling:
                service?.vendor
                  ?.billing
                  ? mapPublicBilling(
                      service
                        .vendor
                        .billing
                    )
                  : null,

              estimatedShippingFee:
                service
                  ?.estimatedShippingFeeCents !=
                null
                  ? dec(
                      Number(
                        service
                          .estimatedShippingFeeCents
                      ) / 100
                    )
                  : null,

              freeShippingThreshold:
                service
                  ?.freeShippingThresholdCents !=
                null
                  ? dec(
                      Number(
                        service
                          .freeShippingThresholdCents
                      ) / 100
                    )
                  : null,

              shippingNotes:
                service
                  ?.shippingNotes ||
                null,

              availability:
                product
                  ?.availability ||
                null,

              readyQty:
                product
                  ?.readyQty ??
                null,

              isAvailable:
                product
                  ?.isActive ===
                  true &&
                product
                  ?.isHidden !==
                  true &&
                product
                  ?.moderationStatus ===
                  "APPROVED" &&
                product
                  ?.availability !==
                  "SOLD_OUT" &&
                (
                  product
                    ?.readyQty ==
                    null ||
                  Number(
                    product
                      .readyQty
                  ) >=
                    Number(
                      item.qty
                    )
                ),
            };
          }
        );

      const groups =
        buildCheckoutGroups(
          cart,
          pricingByProductId
        ).map(
          (group) => ({
            serviceId:
              group.serviceId,

            vendorId:
              group.vendorId,

            serviceTitle:
              group.serviceTitle,

            estimatedShippingFee:
              group
                .estimatedShippingFeeCents !=
              null
                ? dec(
                    group
                      .estimatedShippingFeeCents /
                      100
                  )
                : null,

            freeShippingThreshold:
              group
                .freeShippingThresholdCents !=
              null
                ? dec(
                    group
                      .freeShippingThresholdCents /
                      100
                  )
                : null,

            shippingNotes:
              group.shippingNotes ||
              null,

            subtotal:
              dec(
                group.items.reduce(
                  (
                    sum,
                    groupItem
                  ) =>
                    sum +
                    Number(
                      groupItem
                        .price ||
                        0
                    ) *
                      Number(
                        groupItem
                          .qty ||
                          0
                      ),
                  0
                )
              ),

            items:
              group.items,
          })
        );

      const subtotal =
        dec(
          mapped.reduce(
            (
              sum,
              mappedItem
            ) =>
              sum +
              Number(
                mappedItem
                  .price ||
                  0
              ) *
                Number(
                  mappedItem
                    .qty ||
                    0
                ),
            0
          )
        );

      return res.json({
        items: mapped,
        groups,
        currency,
        subtotal,
        discountCode: guestSummaryDiscountCodeValidation
          ? serializeDiscountCodeValidation(
              guestSummaryDiscountCodeValidation
            )
          : null,
        cardPaymentAvailable: guestSummaryCardPaymentAvailable,
        cardPaymentUnavailableReason: guestSummaryCardPaymentAvailable
          ? null
          : "Plata cu cardul nu este disponibilă pentru unul dintre magazinele din comandă.",
      });
    } catch (error) {
      console.error(
        "Eroare la sumarul coșului guest:",
        error
      );

      if (
        error?.message ===
        "product_not_found"
      ) {
        return res
          .status(404)
          .json({
            error:
              "product_not_found",

            message:
              "Un produs din coș nu mai există.",
          });
      }

      return res
        .status(500)
        .json({
          error:
            "guest_summary_failed",

          message:
            "Nu am putut încărca sumarul coșului.",
        });
    }
  }
);

/**
 * SHIPPING QUOTE
 */
async function quoteShipping({ groups, selections }) {
  const shipments = groups.map((g) => {
    const key = String(g.serviceId);
    const sel = selections?.[key] || { method: "COURIER" };
    const method = sel.method === "LOCKER" ? "LOCKER" : "COURIER";

    const estimatedShippingFeeCents =
      g.estimatedShippingFeeCents != null
        ? Number(g.estimatedShippingFeeCents)
        : 0;

    const freeShippingThresholdCents =
      g.freeShippingThresholdCents != null
        ? Number(g.freeShippingThresholdCents)
        : null;

    const vendorSubtotalCents = g.items.reduce(
      (sum, it) =>
        sum + Math.round(Number(it.price || 0) * 100) * Number(it.qty || 0),
      0
    );

    const qualifiesFreeShipping =
      freeShippingThresholdCents != null &&
      vendorSubtotalCents >= freeShippingThresholdCents;

    const finalShippingCents = qualifiesFreeShipping
      ? 0
      : estimatedShippingFeeCents;

    return {
      serviceId: g.serviceId,
      vendorId: g.vendorId,
      method,
      lockerId: method === "LOCKER" ? sel.lockerId || null : null,
      price: dec(finalShippingCents / 100),
      estimatedShippingFee: dec(estimatedShippingFeeCents / 100),
      freeShippingThreshold:
        freeShippingThresholdCents != null
          ? dec(freeShippingThresholdCents / 100)
          : null,
      shippingNotes: g.shippingNotes || null,
      qualifiesFreeShipping,
      vendorSubtotal: dec(vendorSubtotalCents / 100),
    };
  });

  const totalShipping = dec(
    shipments.reduce((s, x) => s + Number(x.price || 0), 0)
  );

  return {
    shipments,
    totalShipping,
    currency: "RON",
  };
}

/**
 * QUOTE
 */
router.post("/checkout/quote", authRequired, async (req, res) => {
  const address = buildNormalizedShippingAddress(req.body?.address || {});
  const selections = req.body?.selections || {};

  const shippingError = validateShippingAddress(address);
  if (shippingError) {
    return res.status(400).json(shippingError);
  }

  const cart = await prisma.cartItem.findMany({
    where: { userId: req.user.sub },
    include: {
      product: {
        select: {
          id: true,
          title: true,
          priceCents: true,
          category: true,
          currency: true,
          acceptsCustom: true,
styleTags: true,
occasionTags: true,
          service: {
            select: {
              id: true,
              title: true,
              vendorId: true,
              estimatedShippingFeeCents: true,
              freeShippingThresholdCents: true,
              shippingNotes: true,
            },
          },
        },
      },
    },
  });

  if (!cart.length) {
    return res.status(400).json({
      error: "cart_empty",
      message: "Coșul este gol.",
    });
  }
const pricingByProductId =
  await getPromotionPricingForProducts(
    cart
      .map(
        (item) =>
          item.product
      )
      .filter(Boolean)
  );

const groups =
  buildCheckoutGroups(
    cart,
    pricingByProductId
  );
  const q = await quoteShipping({ groups, selections });

  const quoteId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  res.json({ id: quoteId, ...q });
});

router.post("/checkout/guest/quote", async (req, res) => {
  try {
    const address =
      buildNormalizedShippingAddress(
        req.body?.address || {}
      );

    const selections =
      req.body?.selections || {};

    const shippingError =
      validateShippingAddress(address);

    if (shippingError) {
      return res.status(400).json(
        shippingError
      );
    }

    const cart = await getGuestCart(
      req.body?.items || []
    );

    if (!cart.length) {
      return res.status(400).json({
        error: "cart_empty",
        message: "Coșul este gol.",
      });
    }

   const pricingByProductId =
  await getPromotionPricingForProducts(
    cart
      .map(
        (item) =>
          item.product
      )
      .filter(Boolean)
  );

const groups =
  buildCheckoutGroups(
    cart,
    pricingByProductId
  );

    const quote = await quoteShipping({
      groups,
      selections,
    });

    const quoteId =
      `q_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    return res.json({
      id: quoteId,
      ...quote,
    });
  } catch (err) {
    console.error(
      "Eroare la calcularea livrării guest:",
      err
    );
if (err?.message === "product_not_found") {
  return res.status(404).json({
    error: "product_not_found",
    message: "Un produs din coș nu mai există.",
  });
}
    return res.status(500).json({
      error: "guest_quote_failed",
      message:
        "Nu am putut calcula livrarea.",
    });
  }
});

/**
 * PLACE
 */
router.post("/checkout/place", authRequired, async (req, res) => {
  const soldOutProductIds = [];

  try {
    const {
      address,
      billingAddress,
      contactPerson,
      selections,
      paymentMethod,
      customerType,
      shipToDifferentAddress,
      campaignAttribution,
      influencerAttribution,
      vendorReferralAttribution,
      vendorCollectionAttribution,
      discountCode,
    } = req.body || {};

    const ctRaw = String(customerType || "").toUpperCase();
    const ct = ctRaw === "PJ" ? "PJ" : "PF";

    const pmRaw = String(paymentMethod || "").toUpperCase();
    const pm = pmRaw === "CARD" ? "CARD" : "COD";

    const normalizedAddress = buildNormalizedShippingAddress(address || {});
    const normalizedBillingAddress =
      ct === "PJ" ? buildNormalizedBillingAddress(billingAddress || {}) : null;
    const normalizedContactPerson =
      ct === "PJ" ? buildNormalizedContactPerson(contactPerson || {}) : null;

    const shippingError = validateShippingAddress(normalizedAddress);
    if (shippingError) return res.status(400).json(shippingError);

    if (ct === "PJ") {
      const companyError = validateBillingCompany(normalizedBillingAddress);
      if (companyError) return res.status(400).json(companyError);

      const contactError = validateContactPerson(normalizedContactPerson);
      if (contactError) return res.status(400).json(contactError);
    }

    const cart = await prisma.cartItem.findMany({
      where: { userId: req.user.sub },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            priceCents: true,
            category: true,
            currency: true,
            acceptsCustom: true,
styleTags: true,
occasionTags: true,
            availability: true,
            readyQty: true,
            isActive: true,
            isHidden: true,
            moderationStatus: true,
            service: {
              select: {
                id: true,
                title: true,
                vendorId: true,
                estimatedShippingFeeCents: true,
                freeShippingThresholdCents: true,
                shippingNotes: true,
              },
            },
          },
        },
      },
    });

    if (!cart.length) {
      return res.status(400).json({
        error: "cart_empty",
        message: "Coșul este gol.",
      });
    }

    const currency = cart[0]?.product?.currency || "RON";

const cartVendorIds = [
  ...new Set(
    cart
      .map((item) => item.product?.service?.vendorId)
      .filter(Boolean)
      .map(String)
  ),
];

const campaignAttributionsByVendorId =
  await resolveVendorCampaignAttributions({
    vendorIds: cartVendorIds,
    tokensByVendorId: campaignAttribution || {},
  });

/*
 * Cod de reducere - validat FRESH din DB (fail-CLOSED, spre
 * deosebire de campanie/influencer prin link, care sunt fail-open:
 * un cod introdus explicit de client trebuie confirmat sau respins
 * clar, nu ignorat silențios). Dacă a devenit invalid chiar acum
 * (expirat/dezactivat/limită atinsă între ultimul summary și place),
 * oprim comanda aici, cu eroare clară pentru frontend.
 */
let discountCodeValidationForPlace = null;

if (discountCode) {
  discountCodeValidationForPlace = await validateDiscountCode({
    code: String(discountCode),
    cartItems: cart,
    currency,
    userId: req.user.sub,
    customerEmail: null,
  });

  if (!discountCodeValidationForPlace.valid) {
    return res.status(409).json({
      error: discountCodeValidationForPlace.error,
      message: discountCodeValidationForPlace.message,
      discountCodeInvalid: true,
    });
  }
}

/*
 * Atribuire influencer - GLOBALĂ pentru toată comanda (nu per
 * vendor, spre deosebire de campanii), revalidată fresh din DB.
 * Fail-open: null dacă tokenul lipsește/e invalid/influencerul
 * nu mai e ACTIVE.
 *
 * REGULĂ: dacă există și un cod de reducere valid al unui
 * influencer care chiar a câștigat reducere pe un produs din
 * comandă, codul are prioritate față de ?ref= (decizie explicită -
 * introducerea manuală a codului la checkout e acțiunea cea mai
 * recentă). Dacă influencerul codului nu mai e eligibil pentru
 * remunerație (status/comision), NU pierdem reducerea pentru
 * client - rămânem pe atribuirea ?ref=, dacă există.
 */
const refAttributionResolved =
  await resolveInfluencerAttribution({
    token: influencerAttribution,
  });

/*
 * Atribuire VENDOR prin ?ref= - mirror STRUCTURAL, GLOBALĂ pentru
 * toată comanda, la fel ca la influencer (nu per-vendor ca la
 * campanii). Fail-open: null dacă tokenul lipsește/e invalid/
 * vendorul nu mai e activ sau nu are comision de referral setat.
 */
const refVendorAttributionResolved =
  await resolveVendorReferralAttribution({
    token: vendorReferralAttribution,
  });

/*
 * Atribuire VENDOR prin vizitarea unei VendorCollection (audit
 * 2026-09-15, regula finală de business - persistent attribution).
 * Mirror STRUCTURAL, GLOBALĂ pentru toată comanda, la fel ca ?ref=.
 * Fail-open, revalidat fresh (colecție + vendor-proprietar isActive).
 */
const refCollectionAttributionResolved =
  await resolveVendorCollectionAttribution({
    token: vendorCollectionAttribution,
  });

/*
 * Slug-ul colecției, pentru marcajul "COLLECTION:<slug>" (audit
 * 2026-09-15) - DOAR când codul de reducere aplicat e chiar de scope
 * VENDOR_COLLECTION (own-sale/referral prin ELIGIBILITATE reală, nu
 * prin tokenul de vizitare). O singură interogare, o dată per
 * comandă, nu per shipment.
 */
const discountCodeCollectionSlug =
  discountCodeValidationForPlace?.discountCode?.scope ===
    "VENDOR_COLLECTION" &&
  discountCodeValidationForPlace?.discountCode?.vendorCollectionId
    ? (
        await prisma.vendorCollection.findUnique({
          where: {
            id: discountCodeValidationForPlace.discountCode
              .vendorCollectionId,
          },
          select: { slug: true },
        })
      )?.slug || null
    : null;

/*
 * Membership REAL în VendorCollection pentru tokenul de vizitare
 * (audit 2026-09-15, persistent attribution) - INDEPENDENT de orice
 * cod de reducere introdus. Fără asta, own-sale prin simpla vizitare
 * a colecției (fără cod) nu ar putea fi niciodată acordat, pentru că
 * `shipmentEligibleForVendorAttributionByDiscountCode` cere strict un
 * discountCodeVendorAttribution real. Folosit STRICT pentru a decide
 * dacă own-sale-ul din colecție se acordă (produsul trebuie să fie
 * chiar în colecție) - NU face nimic eligibil la discount de preț.
 */
const collectionMemberProductIdsForToken = refCollectionAttributionResolved
  ? new Set(
      (
        await prisma.vendorCollectionItem.findMany({
          where: {
            collectionId: refCollectionAttributionResolved.collectionId,
            productId: { in: cart.map((item) => item.product?.id).filter(Boolean) },
          },
          select: { productId: true },
        })
      ).map((row) => row.productId)
    )
  : new Set();

const cartProducts = cart
  .map((item) => item.product)
  .filter(Boolean);

const campaignPromotionsByProductId =
  buildCampaignPromotionsByProductId(
    cartProducts,
    campaignAttributionsByVendorId
  );

const discountCodePromotionsByProductId =
  buildDiscountCodePromotionsByProductId(
    discountCodeValidationForPlace,
    { cartItems: cart }
  );

const pricingByProductId =
  await getPromotionPricingForProducts(
    cartProducts,
    {
      campaignPromotionsByProductId,
      discountCodePromotionsByProductId,
    }
  );

const discountCodeWonOnAnyItem =
  discountCodeValidationForPlace?.valid &&
  [...pricingByProductId.values()].some(
    (p) => p?.discount?.source === "DISCOUNT_CODE"
  );

/*
 * Eligibilitate PENTRU ATRIBUIRE PE COD (own-sale vendor ȘI influencer,
 * audit 2026-09-14) - diferă de `discountCodeWonOnAnyItem` de mai sus:
 * nu cere ca discountul codului să fi câștigat vizual competiția de
 * preț (chooseBestPromotion poate alege Product of Day/Artisan of
 * Week în locul codului dacă oferă un discount egal/mai mare), doar
 * ca produsul să fie eligibil pentru cod
 * (discountCodeValidationForPlace.eligibleProductIds, deja intersectat
 * cu coșul în discountCodeValidation.js). PRICE WINNER != ATTRIBUTION
 * WINNER. Cross-vendor prin `?ref=` (fallback-urile refInfluencer/
 * refVendor) rămâne neatins, nu are legătură cu un cod.
 */
const discountCodeEligibleOnAnyItem =
  discountCodeValidationForPlace?.valid &&
  discountCodeValidationForPlace.eligibleProductIds?.size > 0;

const discountCodeInfluencerAttribution =
  discountCodeEligibleOnAnyItem &&
  discountCodeValidationForPlace.discountCode.influencerId
    ? await resolveInfluencerAttributionByInfluencerId({
        influencerId:
          discountCodeValidationForPlace.discountCode.influencerId,
      })
    : null;

/*
 * Mirror pentru cod de reducere de VENDOR - vezi comentariul de
 * mai sus. discountCode.vendorId e populat DOAR pentru coduri cu
 * ownerType VENDOR (vendorDiscountCodesRoutes.js) - niciodată în
 * același timp cu influencerId (vezi discountCodeValidation.js).
 */
const discountCodeVendorAttribution =
  discountCodeEligibleOnAnyItem &&
  discountCodeValidationForPlace.discountCode.vendorId
    ? await resolveVendorReferralAttributionByVendorId({
        vendorId:
          discountCodeValidationForPlace.discountCode.vendorId,
      })
    : null;

/*
 * Rezolvat aici GLOBAL doar ca variabile disponibile pentru decizia
 * PER SHIPMENT de mai jos (vezi bucla de creare shipment-uri) -
 * NU se mai scrie direct, global, pe fiecare shipment.
 */

const items =
  cart.map(
    (item) =>
      mapCartItemForCheckout(
        item,
        pricingByProductId.get(
          item.product?.id
        ) || null
      )
  );

    const subtotal = dec(items.reduce((s, it) => s + it.price * it.qty, 0));
const groups =
  buildCheckoutGroups(
    cart,
    pricingByProductId
  );
    const quote = await quoteShipping({ groups, selections: selections || {} });
    const shippingTotal = dec(quote.totalShipping);
    const total = dec(subtotal + shippingTotal);

    /*
     * Consumare token campanie (audit 2026-09-14, lifecycle
     * VendorCampaign, secțiunea 5/6) - determinăm ÎNAINTE de
     * tranzacție (aceleași date, `groups`/`quote.shipments`, deja
     * disponibile aici) care vendori chiar au avut ≥1 produs
     * eligibil pentru campania lor atribuită în ACEASTĂ comandă.
     * Frontend-ul (după succes) șterge tokenul DOAR pentru acei
     * vendori - un token cu 0 produse eligibile NU se consumă,
     * rămâne valabil până la expirare (poate exista o comandă
     * viitoare cu alte produse, eligibile).
     */
    const eligibleCampaignVendorIds = [];

    for (const s of quote.shipments) {
      if (!s.vendorId) continue;

      const attribution =
        campaignAttributionsByVendorId.get(String(s.vendorId)) || null;

      if (!attribution) continue;

      const shipmentItems =
        groups.find((g) => String(g.serviceId) === String(s.serviceId))
          ?.items || [];

      const hasEligibleItem = shipmentItems.some((item) =>
        isProductEligibleForCampaign(item.productId, attribution)
      );

      if (hasEligibleItem) {
        eligibleCampaignVendorIds.push(String(s.vendorId));
      }
    }

    const vendorIds = [
  ...new Set(
    groups
      .map((g) => String(g.vendorId))
      .filter(Boolean)
  ),
];

const vendors =
  await prisma.vendor.findMany({
    where: {
      id: {
        in: vendorIds,
      },
    },

    select: {
      id: true,
      displayName: true,
      address: true,
      city: true,
      email: true,
      emailOnNewOrder: true,

      /*
       * Necesare pentru a verifica
       * dacă plata online poate fi folosită.
       */
      stripeAccountId: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
      stripeConnectStatus: true,

      user: {
        select: {
          email: true,
        },
      },
    },
  });

/*
 * ==========================================
 * VERIFICARE STRIPE CONNECT PENTRU CARD
 * ==========================================
 *
 * Dacă utilizatorul a ales plata cu cardul,
 * TOȚI vendorii din comandă trebuie să aibă
 * Stripe Connect complet activ.
 *
 * Verificarea se face înainte să:
 * - creăm comanda;
 * - scădem stocul;
 * - inițiem plata.
 */
if (pm === "CARD") {
  /*
   * Protecție suplimentară:
   * trebuie să fi găsit toți vendorii.
   */
  if (
    vendors.length !==
    vendorIds.length
  ) {
    return res.status(400).json({
      error:
        "vendor_not_found",

      message:
        "Plata online nu poate fi inițiată pentru această comandă. Te rugăm să alegi plata ramburs.",
    });
  }

  const unavailableVendor =
    vendors.find(
      (vendor) => !isVendorStripeReady(vendor)
    );

  if (unavailableVendor) {
    return res.status(400).json({
      error:
        "vendor_stripe_not_active",

      message:
        "Plata online nu este disponibilă momentan pentru toate produsele din această comandă. Te rugăm să alegi plata ramburs.",
    });
  }
}

const storeAddresses = {};

for (const v of vendors) {
  storeAddresses[v.id] = {
    name:
      v.displayName ||
      "Magazin",

    street:
      v.address ||
      "",

    city:
      v.city ||
      "",

    county:
      normalizedAddress.county ||
      "",

    postalCode:
      "",

    country:
      "România",
  };
}
    const shippingAddressForOrder =
      ct === "PJ" && !shipToDifferentAddress
        ? {
            firstName: normalizedContactPerson?.firstName || "",
            lastName: normalizedContactPerson?.lastName || "",
            name: buildFullName(normalizedContactPerson || {}),
            email: normalizedContactPerson?.email || "",
            phone: normalizedContactPerson?.phone || "",
            county: normalizedBillingAddress?.county || "",
            city: normalizedBillingAddress?.city || "",
            postalCode: normalizedBillingAddress?.postalCode || "",
            street: normalizedBillingAddress?.street || "",
            notes: normalizedAddress?.notes || "",
            companyName: normalizedBillingAddress?.companyName || "",
          }
        : normalizedAddress;
const quantitiesByProductId = new Map();

for (const item of cart) {
  quantitiesByProductId.set(
    item.productId,
    Number(quantitiesByProductId.get(item.productId) || 0) +
      Number(item.qty || 0)
  );
}
    const created = await prisma.$transaction(async (tx) => {
      for (const [productId, qty] of quantitiesByProductId.entries()) {

        if (!productId || qty <= 0) continue;

        const product = await tx.product.findUnique({
          where: { id: productId },
          select: {
            id: true,
            title: true,
            availability: true,
            readyQty: true,
            isActive: true,
            isHidden: true,
            moderationStatus: true,
          },
        });

        if (!product) throw new Error("product_not_found");

        if (
          product.isActive === false ||
          product.isHidden === true ||
          product.moderationStatus !== "APPROVED"
        ) {
          throw new Error("product_unavailable");
        }

        const availability = String(product.availability || "READY").toUpperCase();

        if (availability === "SOLD_OUT") {
          throw new Error("product_sold_out");
        }

        if (availability === "READY" && product.readyQty !== null) {
          const currentQty = Number(product.readyQty);

          if (!Number.isFinite(currentQty) || currentQty < qty) {
            throw new Error("insufficient_stock");
          }

          const nextQty = currentQty - qty;

          const updatedStock = await tx.product.updateMany({
            where: {
              id: productId,
              readyQty: { gte: qty },
              isActive: true,
              isHidden: false,
              moderationStatus: "APPROVED",
              availability: "READY",
            },
            data: {
              readyQty: { decrement: qty },
              availability: nextQty <= 0 ? "SOLD_OUT" : "READY",
            },
          });

          if (updatedStock.count !== 1) {
            throw new Error("insufficient_stock");
          }

          if (nextQty <= 0) {
            soldOutProductIds.push(productId);
          }
        }
      }

      const order = await tx.order.create({
        data: {
          orderNumber: generateOrderNumber(),
          userId: req.user.sub,
          status: "PENDING",
          paymentMethod: pm,
          currency,
          subtotal,
          shippingTotal,
          total,
          shippingAddress: shippingAddressForOrder,
          billingAddress: ct === "PJ" ? normalizedBillingAddress : null,
          contactPerson: ct === "PJ" ? normalizedContactPerson : null,
          shipToDifferentAddress:
            ct === "PJ" ? Boolean(shipToDifferentAddress) : false,
          customerType: ct,
        },
      });

      let discountCodeTotalAmountCents = 0;

      for (const s of quote.shipments) {
        if (!s.vendorId) continue;

        const shipmentAttribution =
          campaignAttributionsByVendorId.get(String(s.vendorId)) || null;

        const its =
          groups.find((g) => String(g.serviceId) === String(s.serviceId))
            ?.items || [];

        /*
         * Atribuirea prin cod de reducere e PER SHIPMENT, nu globală
         * pe comandă - un cod eligibil doar pentru produsele unui
         * vendor nu trebuie să atribuie și shipment-urile altor
         * vendori din aceeași comandă. Dacă acest shipment nu are
         * niciun item câștigat prin cod, rămâne pe atribuirea ?ref=
         * (dacă există), exact ca înainte de cod.
         */
        const shipmentWonByDiscountCode = its.some(
          (item) => item.discountSource === "DISCOUNT_CODE"
        );

        /*
         * Atribuire vendor pe ELIGIBILITATE, nu pe câștigarea prețului
         * (audit 2026-09-14, extins 2026-09-15) - mirror STRUCTURAL al
         * eligibilității de influencer de mai jos: FĂRĂ verificare de
         * vendorId aici - acoperă atât own-sale (promoter === vendorul
         * shipment-ului) cât și referral cross-vendor (promoter !==
         * vendorul shipment-ului), decizia finală fiind luată în
         * buildShipmentAttributionFields (compară promoter.vendor.vendorId
         * cu shipmentVendorId).
         *
         * De ce contează asta separat de `shipmentWonByDiscountCode`
         * (audit 2026-09-15): o reducere de colecție finanțată de
         * VENDOR nu se mai aplică la PREȚ pe produsul altui vendor
         * (vezi garda din buildDiscountCodePromotionsByProductId,
         * discountCodeValidation.js - protejează net-ul sellerului) -
         * deci acel item NU va avea niciodată discountSource
         * "DISCOUNT_CODE", iar `shipmentWonByDiscountCode` ar rămâne
         * mereu fals. FĂRĂ acest flag pe eligibilitate, referral-ul
         * cross-vendor ar dispărea silențios exact în cazul pe care
         * vrem să-l păstrăm funcțional (produsul e în colecție, dar
         * fără discount la preț pentru el).
         */
        const shipmentEligibleForVendorAttributionByDiscountCode =
          Boolean(discountCodeVendorAttribution) &&
          its.some(
            (item) =>
              item.productId &&
              discountCodeValidationForPlace?.eligibleProductIds?.has(
                item.productId
              )
          );

        /*
         * Influencer pe ELIGIBILITATE (audit 2026-09-14) - mirror al
         * own-sale de mai sus, dar fără verificare de vendorId (codul
         * de influencer nu e legat de un shipmentVendorId anume).
         */
        const shipmentEligibleForInfluencerByDiscountCode =
          Boolean(discountCodeInfluencerAttribution) &&
          its.some(
            (item) =>
              item.productId &&
              discountCodeValidationForPlace?.eligibleProductIds?.has(
                item.productId
              )
          );

        const shipmentEligibleByCollectionMembership = its.some(
          (item) =>
            item.productId &&
            collectionMemberProductIdsForToken.has(item.productId)
        );

        const shipmentPromoter = resolveShipmentPromoter({
          shipmentWonByDiscountCode,
          shipmentEligibleForVendorAttributionByDiscountCode,
          shipmentEligibleForInfluencerByDiscountCode,
          discountCodeInfluencerAttribution,
          discountCodeVendorAttribution,
          refInfluencerAttribution: refAttributionResolved,
          refVendorAttribution: resolveEffectiveRefVendorAttribution({
            refVendorAttribution: refVendorAttributionResolved,
            refCollectionAttribution: refCollectionAttributionResolved,
            shipmentVendorId: s.vendorId,
            shipmentEligibleByCollectionMembership,
          }),
        });

        const shipmentAttributionFields = buildShipmentAttributionFields({
          promoter: shipmentPromoter,
          shipmentVendorId: s.vendorId,
          discountCodeScope:
            discountCodeValidationForPlace?.discountCode?.scope || null,
          discountCodeCollectionSlug,
        });

        const sh = await tx.shipment.create({
          data: {
            orderId: order.id,
            vendorId: String(s.vendorId),
            serviceId: s.serviceId ? String(s.serviceId) : null,
            method: s.method === "LOCKER" ? "LOCKER" : "COURIER",
            lockerId: s.lockerId || null,
            price: dec(s.price),
            status: "PENDING",

            campaignId: shipmentAttribution?.campaignId || null,
            campaignCommissionBps: shipmentAttribution
              ? CAMPAIGN_COMMISSION_BPS
              : null,
            campaignDiscountPercent: shipmentAttribution
              ? shipmentAttribution.discountPercent
              : null,
            campaignAttributedAt: shipmentAttribution ? new Date() : null,

            ...shipmentAttributionFields,
          },
        });

      if (its.length) {
  await tx.shipmentItem.createMany({
    data: its.map((item) => {
      const qty = Math.max(
        1,
        Number(item.qty || 1)
      );

      const finalUnitPrice = Number(
        item.price || 0
      );

      const originalUnitPrice = Number(
        item.originalPrice ??
          item.price ??
          0
      );

      const hasDiscount =
        item.hasDiscount === true &&
        originalUnitPrice >
          finalUnitPrice;

      const platformDiscountPercent =
        hasDiscount
          ? Number(
              item.platformDiscountPercent ||
                0
            )
          : 0;

      const vendorDiscountPercent =
        hasDiscount
          ? Number(
              item.vendorDiscountPercent ||
                0
            )
          : 0;

      const totalDiscountAmount =
        hasDiscount
          ? dec(
              (
                originalUnitPrice -
                finalUnitPrice
              ) * qty
            )
          : 0;

      const platformDiscountAmount =
        hasDiscount
          ? dec(
              (
                originalUnitPrice *
                platformDiscountPercent *
                qty
              ) /
                100
            )
          : 0;

      const vendorDiscountAmount =
        hasDiscount
          ? dec(
              (
                originalUnitPrice *
                vendorDiscountPercent *
                qty
              ) /
                100
            )
          : 0;

      return {
        shipmentId: sh.id,

        productId:
          item.productId,

        title:
          item.title,

        qty,

        price:
          dec(finalUnitPrice),

       selectedOptions:
  item.selectedOptions ||
  {},

customAnswers:
  item.customAnswers ||
  {},

repeatedGroupAnswers:
  item.repeatedGroupAnswers ||
  {},

configurationKey:
  item.configurationKey ||
  "default",

        originalPrice:
          hasDiscount
            ? dec(
                originalUnitPrice
              )
            : null,

        discountAmount:
          totalDiscountAmount,

        platformDiscountPercent,

        vendorDiscountPercent,

        platformDiscountAmount,

        vendorDiscountAmount,

        promoCollectionId:
          item.promoCollectionId ||
          null,

        promoFundingSource:
          item.promoFundingSource ||
          null,

        homepageFeatureId:
          item.homepageFeatureId ||
          null,

        discountSource:
          item.discountSource ||
          null,

        discountCodeId:
          item.discountSource === "DISCOUNT_CODE"
            ? item.discount?.discountCodeId || null
            : null,

        discountCodeText:
          item.discountSource === "DISCOUNT_CODE"
            ? item.discount?.discountCodeText || null
            : null,

        discountCodePercent:
          item.discountSource === "DISCOUNT_CODE"
            ? Number(item.totalDiscountPercent || 0)
            : null,

        discountCodeAmount:
          item.discountSource === "DISCOUNT_CODE"
            ? totalDiscountAmount
            : null,

        discountCodeFundingSource:
          item.discountSource === "DISCOUNT_CODE"
            ? item.discount?.discountCodeFundingSource || null
            : null,
      };
    }),
  });

  if (discountCodeValidationForPlace?.valid) {
    const shipmentDiscountCodeAmount = dec(
      its
        .filter(
          (item) => item.discountSource === "DISCOUNT_CODE"
        )
        .reduce(
          (sum, item) =>
            sum +
            (Number(item.originalPrice ?? item.price ?? 0) -
              Number(item.price || 0)) *
              Math.max(1, Number(item.qty || 1)),
          0
        )
    );

    discountCodeTotalAmountCents += Math.round(
      shipmentDiscountCodeAmount * 100
    );
  }
}
      }

      /*
       * Un cod VALID care nu a câștigat best promotion pe niciun
       * produs nu trebuie considerat "folosit" - nu consumă
       * usedCount/usageLimitPerUser și nu lasă un
       * DiscountCodeRedemption în urmă. discountCodeWonOnAnyItem e
       * deja calculat mai sus, din același pricingByProductId care
       * a decis discountSource pe fiecare ShipmentItem.
       */
      if (discountCodeValidationForPlace?.valid && discountCodeWonOnAnyItem) {
        await redeemDiscountCode({
          db: tx,
          discountCodeId: discountCodeValidationForPlace.discountCode.id,
          usageLimit: discountCodeValidationForPlace.discountCode.usageLimit,
          usageLimitPerUser:
            discountCodeValidationForPlace.discountCode.usageLimitPerUser,
          orderId: order.id,
          userId: req.user.sub,
          customerEmail: null,
          discountAmountCents: discountCodeTotalAmountCents,
        });
      }

      await tx.cartItem.deleteMany({ where: { userId: req.user.sub } });

      return order;
    });

    try {
      await Promise.all(
        [...new Set(soldOutProductIds)].map((productId) =>
          notifyVendorOnProductSoldOut(productId)
        )
      );
    } catch (err) {
      console.error("Nu am putut trimite notificările pentru produse epuizate:", err);
    }

    let shipmentsForNotifications = [];

    try {
      const shipments = await prisma.shipment.findMany({
        where: { orderId: created.id },
      });

      shipmentsForNotifications = shipments;

      const addr = created.shippingAddress || {};
      const customerName =
        addr.name ||
        `${addr.lastName || ""} ${addr.firstName || ""}`.trim() ||
        "Client";

      await Promise.all(
        shipments.map(async (s) => {
          const shortId = s.id.slice(-6).toUpperCase();

          const itemsForVendor = items.filter(
            (it) => String(it.vendorId) === String(s.vendorId)
          );

          const subtotalVendor = dec(
            itemsForVendor.reduce((sum, it) => sum + it.price * it.qty, 0)
          );

          const totalVendor = dec(subtotalVendor + Number(s.price || 0));

          await createVendorNotification(s.vendorId, {
            type: "order",
            title: `Comandă nouă (#${shortId})`,
            body: `${customerName} a plasat o comandă – total ${totalVendor.toFixed(
              2
            )} ${created.currency || "RON"}.`,
            link: `/vendor/orders`,
          });
          const vendor = vendors.find((v) => String(v.id) === String(s.vendorId));
const vendorEmail = vendor?.user?.email || vendor?.email || null;

if (
  vendorEmail &&
  vendor?.emailOnNewOrder !== false
) {
  await sendVendorNewOrderEmail({
    to: vendorEmail,
    vendorName: vendor?.displayName || "vendor",
    order: created,
    items: itemsForVendor,
    customerName,
    total: totalVendor,
    currency: created.currency || "RON",
  });
}

        })
      );
    } catch (err) {
      console.error("Nu am putut crea notificările pentru vendor:", err);
    }

    await notifyInfluencersWithIncompletePayoutProfile(
      shipmentsForNotifications
    );

    try {
      await sendOrderConfirmationEmail({
        to: shippingAddressForOrder.email,
        order: created,
        items,
        storeAddresses,
      });
    } catch (err) {
      console.error("Eroare la trimiterea emailului de confirmare:", err);
    }

   if (pm === "COD") {
  return res.json({
    ok: true,
    orderId: created.id,
    orderNumber: created.orderNumber,
    total: Number(created.total),
    subtotal: Number(created.subtotal),
    shippingTotal: Number(created.shippingTotal),
    currency: created.currency || "RON",
    eligibleCampaignVendorIds,
  });
}

    try {
      const payment = await createPaymentForOrder(created);

      return res.json({
  ok: true,
  orderId: created.id,
  orderNumber: created.orderNumber,
  total: Number(created.total),
  subtotal: Number(created.subtotal),
  shippingTotal: Number(created.shippingTotal),
  currency: created.currency || "RON",
  payment,
  eligibleCampaignVendorIds,
});
    } catch (err) {
      console.error("Eroare la inițierea plății pentru comandă:", err);

      if (err instanceof CardPaymentUnavailableError) {
        return res.status(err.status || 400).json({
          error: err.code,
          message: err.message,
          orderId: created.id,
          orderNumber: created.orderNumber,
        });
      }

      return res.status(500).json({
        error: "payment_init_failed",
        message: "Comanda a fost creată, dar inițierea plății a eșuat.",
        orderId: created.id,
        orderNumber: created.orderNumber,
      });
    }
  } catch (err) {
    console.error("Eroare la plasarea comenzii:", err);

  if (
  err?.message ===
  "insufficient_stock"
) {
  return res.status(409).json({
    error: "insufficient_stock",
    message:
      "Cantitatea solicitată nu mai este disponibilă pentru unul dintre produse. Verifică produsele din coș și actualizează cantitatea.",
  });
}

    if (err?.message === "product_sold_out") {
      return res.status(409).json({
        error: "product_sold_out",
        message: "Un produs din coș este epuizat.",
      });
    }

    if (err?.message === "product_unavailable") {
      return res.status(409).json({
        error: "product_unavailable",
        message: "Un produs din coș nu mai este disponibil.",
      });
    }

    if (err?.message === "product_not_found") {
      return res.status(404).json({
        error: "product_not_found",
        message: "Un produs din coș nu mai există.",
      });
    }

    return res.status(500).json({
      error: "order_place_failed",
      message: "Nu am putut plasa comanda.",
    });
  }
});

router.post("/checkout/guest/place", async (req, res) => {
  const soldOutProductIds = [];

  try {
    const {
      items: rawItems,
      address,
      billingAddress,
      contactPerson,
      selections,
      paymentMethod,
      customerType,
      shipToDifferentAddress,
      consents,
      campaignAttribution,
      influencerAttribution,
      vendorReferralAttribution,
      vendorCollectionAttribution,
      discountCode,
    } = req.body || {};

    const ctRaw = String(customerType || "").toUpperCase();
    const ct = ctRaw === "PJ" ? "PJ" : "PF";

    const pmRaw = String(paymentMethod || "").toUpperCase();
    const pm = pmRaw === "CARD" ? "CARD" : "COD";

    const normalizedAddress = buildNormalizedShippingAddress(address || {});

    const normalizedBillingAddress =
      ct === "PJ"
        ? buildNormalizedBillingAddress(billingAddress || {})
        : null;

    const normalizedContactPerson =
      ct === "PJ"
        ? buildNormalizedContactPerson(contactPerson || {})
        : null;

    const shippingError = validateShippingAddress(normalizedAddress);

    if (shippingError) {
      return res.status(400).json(shippingError);
    }

    if (ct === "PJ") {
      const companyError = validateBillingCompany(
        normalizedBillingAddress
      );

      if (companyError) {
        return res.status(400).json(companyError);
      }

      const contactError = validateContactPerson(
        normalizedContactPerson
      );

      if (contactError) {
        return res.status(400).json(contactError);
      }
    }

    const cart = await getGuestCart(rawItems || []);

    if (!cart.length) {
      return res.status(400).json({
        error: "cart_empty",
        message: "Coșul este gol.",
      });
    }

    const currency = cart[0]?.product?.currency || "RON";

const guestCartVendorIds = [
  ...new Set(
    cart
      .map((item) => item.product?.service?.vendorId)
      .filter(Boolean)
      .map(String)
  ),
];

const campaignAttributionsByVendorId =
  await resolveVendorCampaignAttributions({
    vendorIds: guestCartVendorIds,
    tokensByVendorId: campaignAttribution || {},
  });

/*
 * Cod de reducere - identic fail-CLOSED ca la /checkout/place
 * (autentificat). Email-ul guestului e recalculat aici (identic
 * cu blocul de mai jos care construiește customerEmail pentru
 * comandă) - avem nevoie de el deja aici pentru usageLimitPerUser.
 */
const discountCodeCustomerEmail =
  ct === "PJ"
    ? normalizedContactPerson?.email
    : normalizedAddress?.email;

let discountCodeValidationForPlace = null;

if (discountCode) {
  discountCodeValidationForPlace = await validateDiscountCode({
    code: String(discountCode),
    cartItems: cart,
    currency,
    userId: null,
    customerEmail: discountCodeCustomerEmail || null,
  });

  if (!discountCodeValidationForPlace.valid) {
    return res.status(409).json({
      error: discountCodeValidationForPlace.error,
      message: discountCodeValidationForPlace.message,
      discountCodeInvalid: true,
    });
  }
}

/*
 * Atribuire influencer - identică ca regulă cu /checkout/place:
 * cod de reducere al unui influencer, dacă a câștigat efectiv
 * reducere pe un produs din comandă, are prioritate față de ?ref=.
 */
const refAttributionResolved =
  await resolveInfluencerAttribution({
    token: influencerAttribution,
  });

const refVendorAttributionResolved =
  await resolveVendorReferralAttribution({
    token: vendorReferralAttribution,
  });

/*
 * Atribuire VENDOR prin vizitarea unei VendorCollection (audit
 * 2026-09-15) - mirror identic cu /checkout/place.
 */
const refCollectionAttributionResolved =
  await resolveVendorCollectionAttribution({
    token: vendorCollectionAttribution,
  });

/*
 * Slug-ul colecției (audit 2026-09-15) - mirror identic cu
 * /checkout/place.
 */
const discountCodeCollectionSlug =
  discountCodeValidationForPlace?.discountCode?.scope ===
    "VENDOR_COLLECTION" &&
  discountCodeValidationForPlace?.discountCode?.vendorCollectionId
    ? (
        await prisma.vendorCollection.findUnique({
          where: {
            id: discountCodeValidationForPlace.discountCode
              .vendorCollectionId,
          },
          select: { slug: true },
        })
      )?.slug || null
    : null;

/*
 * Membership REAL în VendorCollection pentru tokenul de vizitare
 * (audit 2026-09-15) - mirror identic cu /checkout/place, vezi
 * comentariul de acolo.
 */
const collectionMemberProductIdsForToken = refCollectionAttributionResolved
  ? new Set(
      (
        await prisma.vendorCollectionItem.findMany({
          where: {
            collectionId: refCollectionAttributionResolved.collectionId,
            productId: { in: cart.map((item) => item.product?.id).filter(Boolean) },
          },
          select: { productId: true },
        })
      ).map((row) => row.productId)
    )
  : new Set();

const guestCartProducts = cart
  .map((item) => item.product)
  .filter(Boolean);

const campaignPromotionsByProductId =
  buildCampaignPromotionsByProductId(
    guestCartProducts,
    campaignAttributionsByVendorId
  );

const discountCodePromotionsByProductId =
  buildDiscountCodePromotionsByProductId(
    discountCodeValidationForPlace,
    { cartItems: cart }
  );

  const pricingByProductId =
  await getPromotionPricingForProducts(
    guestCartProducts,
    {
      campaignPromotionsByProductId,
      discountCodePromotionsByProductId,
    }
  );

const discountCodeWonOnAnyItem =
  discountCodeValidationForPlace?.valid &&
  [...pricingByProductId.values()].some(
    (p) => p?.discount?.source === "DISCOUNT_CODE"
  );

/*
 * Eligibilitate PENTRU ATRIBUIRE PE COD (own-sale vendor ȘI influencer,
 * audit 2026-09-14) - mirror identic cu /checkout/place (vezi
 * comentariul acolo). Nu cere ca discountul codului să fi câștigat
 * vizual competiția de preț, doar ca produsul să fie eligibil pentru
 * cod. PRICE WINNER != ATTRIBUTION WINNER.
 */
const discountCodeEligibleOnAnyItem =
  discountCodeValidationForPlace?.valid &&
  discountCodeValidationForPlace.eligibleProductIds?.size > 0;

const discountCodeInfluencerAttribution =
  discountCodeEligibleOnAnyItem &&
  discountCodeValidationForPlace.discountCode.influencerId
    ? await resolveInfluencerAttributionByInfluencerId({
        influencerId:
          discountCodeValidationForPlace.discountCode.influencerId,
      })
    : null;

const discountCodeVendorAttribution =
  discountCodeEligibleOnAnyItem &&
  discountCodeValidationForPlace.discountCode.vendorId
    ? await resolveVendorReferralAttributionByVendorId({
        vendorId:
          discountCodeValidationForPlace.discountCode.vendorId,
      })
    : null;

/*
 * Rezolvat aici GLOBAL doar ca variabile disponibile pentru decizia
 * PER SHIPMENT de mai jos (vezi bucla de creare shipment-uri) -
 * NU se mai scrie direct, global, pe fiecare shipment.
 */

const checkoutItems =
  cart.map(
    (item) =>
      mapCartItemForCheckout(
        item,
        pricingByProductId.get(
          item.product?.id
        ) || null
      )
  );


    const subtotal = dec(
      checkoutItems.reduce(
        (sum, item) =>
          sum +
          Number(item.price || 0) *
            Number(item.qty || 0),
        0
      )
    );


const groups =
  buildCheckoutGroups(
    cart,
    pricingByProductId
  );

    const quote = await quoteShipping({
      groups,
      selections: selections || {},
    });

    const shippingTotal = dec(quote.totalShipping);
    const total = dec(subtotal + shippingTotal);

    /*
     * Consumare token campanie (audit 2026-09-14, lifecycle
     * VendorCampaign, secțiunea 5/6/9 - identic user/guest) - vezi
     * comentariul din handler-ul autentificat pentru detalii.
     */
    const eligibleCampaignVendorIds = [];

    for (const s of quote.shipments) {
      if (!s.vendorId) continue;

      const attribution =
        campaignAttributionsByVendorId.get(String(s.vendorId)) || null;

      if (!attribution) continue;

      const shipmentItems =
        groups.find((g) => String(g.serviceId) === String(s.serviceId))
          ?.items || [];

      const hasEligibleItem = shipmentItems.some((item) =>
        isProductEligibleForCampaign(item.productId, attribution)
      );

      if (hasEligibleItem) {
        eligibleCampaignVendorIds.push(String(s.vendorId));
      }
    }

    const vendorIds = [
      ...new Set(
        groups
          .map((group) => String(group.vendorId))
          .filter(Boolean)
      ),
    ];

    const vendors = await prisma.vendor.findMany({
  where: {
    id: {
      in: vendorIds,
    },
  },

  select: {
    id: true,
    displayName: true,
    address: true,
    city: true,
    email: true,
    emailOnNewOrder: true,

    /*
     * Necesare pentru plata online.
     */
    stripeAccountId: true,
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
    stripeConnectStatus: true,

    user: {
      select: {
        email: true,
      },
    },
  },
});

/*
 * ==========================================
 * VERIFICARE STRIPE CONNECT PENTRU GUEST CARD
 * ==========================================
 *
 * Dacă guest-ul a ales plata cu cardul,
 * toți vendorii trebuie să aibă Stripe Connect activ.
 */
if (pm === "CARD") {
  /*
   * Trebuie să fi găsit toți vendorii
   * din comandă.
   */
  if (vendors.length !== vendorIds.length) {
    return res.status(400).json({
      error: "vendor_not_found",

      message:
        "Plata online nu poate fi inițiată pentru această comandă. Te rugăm să alegi plata ramburs.",
    });
  }

  const unavailableVendor = vendors.find(
    (vendor) => !isVendorStripeReady(vendor)
  );

  if (unavailableVendor) {
    return res.status(400).json({
      error: "vendor_stripe_not_active",

      message:
        "Plata online nu este disponibilă momentan pentru toate produsele din această comandă. Te rugăm să alegi plata ramburs.",
    });
  }
}

const storeAddresses = {};

    for (const vendor of vendors) {
      storeAddresses[vendor.id] = {
        name: vendor.displayName || "Magazin",
        street: vendor.address || "",
        city: vendor.city || "",
        county: normalizedAddress.county || "",
        postalCode: "",
        country: "România",
      };
    }

    const shippingAddressForOrder =
      ct === "PJ" && !shipToDifferentAddress
        ? {
            firstName:
              normalizedContactPerson?.firstName || "",
            lastName:
              normalizedContactPerson?.lastName || "",
            name: buildFullName(
              normalizedContactPerson || {}
            ),
            email:
              normalizedContactPerson?.email || "",
            phone:
              normalizedContactPerson?.phone || "",
            county:
              normalizedBillingAddress?.county || "",
            city:
              normalizedBillingAddress?.city || "",
            postalCode:
              normalizedBillingAddress?.postalCode || "",
            street:
              normalizedBillingAddress?.street || "",
            notes:
              normalizedAddress?.notes || "",
            companyName:
              normalizedBillingAddress?.companyName || "",
          }
        : normalizedAddress;

    const customerName =
      ct === "PJ"
        ? buildFullName(normalizedContactPerson || {})
        : buildFullName(normalizedAddress || {});

    const customerEmail =
      ct === "PJ"
        ? normalizedContactPerson?.email
        : normalizedAddress?.email;

    const customerPhone =
      ct === "PJ"
        ? normalizedContactPerson?.phone
        : normalizedAddress?.phone;

    const guestAccess = generateGuestAccessToken();

    const guestAccessExpiresAt = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000
    );

    /*
     * Agregăm cantitatea totală per produs.
     * Același produs poate apărea de mai multe ori,
     * cu configurationKey diferit.
     */
    const quantitiesByProductId = new Map();

    for (const item of cart) {
      quantitiesByProductId.set(
        item.productId,
        Number(
          quantitiesByProductId.get(item.productId) || 0
        ) + Number(item.qty || 0)
      );
    }

    const created = await prisma.$transaction(
      async (tx) => {
        /*
         * Verificăm și scădem stocul o singură dată
         * pentru fiecare produs.
         */
        for (const [
          productId,
          qty,
        ] of quantitiesByProductId.entries()) {
          if (!productId || qty <= 0) {
            continue;
          }

          const product = await tx.product.findUnique({
            where: {
              id: productId,
            },
            select: {
              id: true,
              title: true,
              availability: true,
              readyQty: true,
              isActive: true,
              isHidden: true,
              moderationStatus: true,
            },
          });

          if (!product) {
            throw new Error("product_not_found");
          }

          if (
            product.isActive === false ||
            product.isHidden === true ||
            product.moderationStatus !== "APPROVED"
          ) {
            throw new Error("product_unavailable");
          }

          const availability = String(
            product.availability || "READY"
          ).toUpperCase();

          if (availability === "SOLD_OUT") {
            throw new Error("product_sold_out");
          }

          if (
            availability === "READY" &&
            product.readyQty !== null
          ) {
            const currentQty = Number(product.readyQty);

            if (
              !Number.isFinite(currentQty) ||
              currentQty < qty
            ) {
              throw new Error("insufficient_stock");
            }

            const nextQty = currentQty - qty;

            const updatedStock =
              await tx.product.updateMany({
                where: {
                  id: productId,
                  readyQty: {
                    gte: qty,
                  },
                  isActive: true,
                  isHidden: false,
                  moderationStatus: "APPROVED",
                  availability: "READY",
                },
                data: {
                  readyQty: {
                    decrement: qty,
                  },
                  availability:
                    nextQty <= 0
                      ? "SOLD_OUT"
                      : "READY",
                },
              });

            if (updatedStock.count !== 1) {
              throw new Error("insufficient_stock");
            }

            if (nextQty <= 0) {
              soldOutProductIds.push(productId);
            }
          }
        }

        const order = await tx.order.create({
          data: {
            orderNumber: generateOrderNumber(),

            userId: null,
            isGuestOrder: true,

            customerName: customerName || null,
            customerEmail: customerEmail || null,
            customerPhone: customerPhone || null,

            guestAccessTokenHash:
              guestAccess.tokenHash,

            guestAccessExpiresAt,

            checkoutConsents: consents || null,

            checkoutIp: req.ip || null,

            checkoutUserAgent:
              normalizeText(
                req.headers["user-agent"]
              ).slice(0, 500) || null,

            status: "PENDING",
            paymentMethod: pm,
            currency,
            subtotal,
            shippingTotal,
            total,

            shippingAddress:
              shippingAddressForOrder,

            billingAddress:
              ct === "PJ"
                ? normalizedBillingAddress
                : null,

            contactPerson:
              ct === "PJ"
                ? normalizedContactPerson
                : null,

            shipToDifferentAddress:
              ct === "PJ"
                ? Boolean(shipToDifferentAddress)
                : false,

            customerType: ct,
          },
        });

        /*
         * Creăm shipment-urile și itemii,
         * păstrând configurațiile.
         */
        let discountCodeTotalAmountCents = 0;

        for (const shipmentQuote of quote.shipments) {
          if (!shipmentQuote.vendorId) {
            continue;
          }

          const guestShipmentAttribution =
            campaignAttributionsByVendorId.get(
              String(shipmentQuote.vendorId)
            ) || null;

          const shipmentItems =
            groups.find(
              (group) =>
                String(group.serviceId) ===
                String(shipmentQuote.serviceId)
            )?.items || [];

          /*
           * Atribuirea prin cod de reducere e PER SHIPMENT, nu
           * globală pe comandă - identic ca regulă cu /checkout/place
           * (autentificat). Dacă acest shipment nu are niciun item
           * câștigat prin cod, rămâne pe atribuirea ?ref= (dacă
           * există).
           */
          const shipmentWonByDiscountCode = shipmentItems.some(
            (item) => item.discountSource === "DISCOUNT_CODE"
          );

          /*
           * Atribuire vendor pe ELIGIBILITATE (own-sale SAU referral
           * cross-vendor) - mirror identic cu /checkout/place, vezi
           * comentariul de acolo (audit 2026-09-14, generalizat
           * 2026-09-15).
           */
          const shipmentEligibleForVendorAttributionByDiscountCode =
            Boolean(discountCodeVendorAttribution) &&
            shipmentItems.some(
              (item) =>
                item.productId &&
                discountCodeValidationForPlace?.eligibleProductIds?.has(
                  item.productId
                )
            );

          /*
           * Influencer pe ELIGIBILITATE (audit 2026-09-14) - mirror
           * identic cu /checkout/place.
           */
          const shipmentEligibleForInfluencerByDiscountCode =
            Boolean(discountCodeInfluencerAttribution) &&
            shipmentItems.some(
              (item) =>
                item.productId &&
                discountCodeValidationForPlace?.eligibleProductIds?.has(
                  item.productId
                )
            );

          const shipmentEligibleByCollectionMembership = shipmentItems.some(
            (item) =>
              item.productId &&
              collectionMemberProductIdsForToken.has(item.productId)
          );

          const shipmentPromoter = resolveShipmentPromoter({
            shipmentWonByDiscountCode,
            shipmentEligibleForVendorAttributionByDiscountCode,
            shipmentEligibleForInfluencerByDiscountCode,
            discountCodeInfluencerAttribution,
            discountCodeVendorAttribution,
            refInfluencerAttribution: refAttributionResolved,
            refVendorAttribution: resolveEffectiveRefVendorAttribution({
              refVendorAttribution: refVendorAttributionResolved,
              refCollectionAttribution: refCollectionAttributionResolved,
              shipmentVendorId: shipmentQuote.vendorId,
              shipmentEligibleByCollectionMembership,
            }),
          });

          const shipmentAttributionFields = buildShipmentAttributionFields({
            promoter: shipmentPromoter,
            shipmentVendorId: shipmentQuote.vendorId,
            discountCodeScope:
              discountCodeValidationForPlace?.discountCode?.scope || null,
            discountCodeCollectionSlug,
          });

          const shipment = await tx.shipment.create({
            data: {
              orderId: order.id,
              vendorId: String(
                shipmentQuote.vendorId
              ),

              serviceId: shipmentQuote.serviceId
                ? String(shipmentQuote.serviceId)
                : null,

              method:
                shipmentQuote.method === "LOCKER"
                  ? "LOCKER"
                  : "COURIER",

              lockerId:
                shipmentQuote.lockerId || null,

              price: dec(shipmentQuote.price),
              status: "PENDING",

              campaignId:
                guestShipmentAttribution?.campaignId || null,
              campaignCommissionBps: guestShipmentAttribution
                ? CAMPAIGN_COMMISSION_BPS
                : null,
              campaignDiscountPercent: guestShipmentAttribution
                ? guestShipmentAttribution.discountPercent
                : null,
              campaignAttributedAt: guestShipmentAttribution
                ? new Date()
                : null,

              ...shipmentAttributionFields,
            },
          });

          if (shipmentItems.length) {
  await tx.shipmentItem.createMany({
    data: shipmentItems.map((item) => {
      const qty = Math.max(
        1,
        Number(item.qty || 1)
      );

      const finalUnitPrice = Number(
        item.price || 0
      );

      const originalUnitPrice = Number(
        item.originalPrice ??
          item.price ??
          0
      );

      const hasDiscount =
        item.hasDiscount === true &&
        originalUnitPrice >
          finalUnitPrice;

      const platformDiscountPercent =
        hasDiscount
          ? Number(
              item.platformDiscountPercent ||
                0
            )
          : 0;

      const vendorDiscountPercent =
        hasDiscount
          ? Number(
              item.vendorDiscountPercent ||
                0
            )
          : 0;

      const totalDiscountAmount =
        hasDiscount
          ? dec(
              (
                originalUnitPrice -
                finalUnitPrice
              ) * qty
            )
          : 0;

      const platformDiscountAmount =
        hasDiscount
          ? dec(
              (
                originalUnitPrice *
                platformDiscountPercent *
                qty
              ) /
                100
            )
          : 0;

      const vendorDiscountAmount =
        hasDiscount
          ? dec(
              (
                originalUnitPrice *
                vendorDiscountPercent *
                qty
              ) /
                100
            )
          : 0;

      return {
        shipmentId:
          shipment.id,

        productId:
          item.productId,

        title:
          item.title,

        qty,

        price:
          dec(finalUnitPrice),

        selectedOptions:
  item.selectedOptions ||
  {},

customAnswers:
  item.customAnswers ||
  {},

repeatedGroupAnswers:
  item.repeatedGroupAnswers ||
  {},

configurationKey:
  item.configurationKey ||
  "default",

        originalPrice:
          hasDiscount
            ? dec(
                originalUnitPrice
              )
            : null,

        discountAmount:
          totalDiscountAmount,

        platformDiscountPercent,

        vendorDiscountPercent,

        platformDiscountAmount,

        vendorDiscountAmount,

        promoCollectionId:
          item.promoCollectionId ||
          null,

        promoFundingSource:
          item.promoFundingSource ||
          null,

        homepageFeatureId:
          item.homepageFeatureId ||
          null,

        discountSource:
          item.discountSource ||
          null,

        discountCodeId:
          item.discountSource === "DISCOUNT_CODE"
            ? item.discount?.discountCodeId || null
            : null,

        discountCodeText:
          item.discountSource === "DISCOUNT_CODE"
            ? item.discount?.discountCodeText || null
            : null,

        discountCodePercent:
          item.discountSource === "DISCOUNT_CODE"
            ? Number(item.totalDiscountPercent || 0)
            : null,

        discountCodeAmount:
          item.discountSource === "DISCOUNT_CODE"
            ? totalDiscountAmount
            : null,

        discountCodeFundingSource:
          item.discountSource === "DISCOUNT_CODE"
            ? item.discount?.discountCodeFundingSource || null
            : null,
      };
    }),
  });

  if (discountCodeValidationForPlace?.valid) {
    const shipmentDiscountCodeAmount = dec(
      shipmentItems
        .filter(
          (item) => item.discountSource === "DISCOUNT_CODE"
        )
        .reduce(
          (sum, item) =>
            sum +
            (Number(item.originalPrice ?? item.price ?? 0) -
              Number(item.price || 0)) *
              Math.max(1, Number(item.qty || 1)),
          0
        )
    );

    discountCodeTotalAmountCents += Math.round(
      shipmentDiscountCodeAmount * 100
    );
  }
}
        }

        /*
         * Identic ca la /checkout/place: un cod valid care nu a
         * câștigat best promotion pe niciun produs nu consumă
         * usedCount/usageLimitPerUser.
         */
        if (
          discountCodeValidationForPlace?.valid &&
          discountCodeWonOnAnyItem
        ) {
          await redeemDiscountCode({
            db: tx,
            discountCodeId:
              discountCodeValidationForPlace.discountCode.id,
            usageLimit:
              discountCodeValidationForPlace.discountCode.usageLimit,
            usageLimitPerUser:
              discountCodeValidationForPlace.discountCode
                .usageLimitPerUser,
            orderId: order.id,
            userId: null,
            customerEmail: customerEmail || null,
            discountAmountCents: discountCodeTotalAmountCents,
          });
        }

        return order;
      }
    );

    try {
      await Promise.all(
        [...new Set(soldOutProductIds)].map(
          (productId) =>
            notifyVendorOnProductSoldOut(
              productId
            )
        )
      );
    } catch (err) {
      console.error(
        "Nu am putut trimite notificările pentru produsele epuizate:",
        err
      );
    }

    let guestShipmentsForNotifications = [];

    try {
      const shipments =
        await prisma.shipment.findMany({
          where: {
            orderId: created.id,
          },
        });

      guestShipmentsForNotifications = shipments;

      await Promise.all(
        shipments.map(async (shipment) => {
          const shortId = shipment.id
            .slice(-6)
            .toUpperCase();

          const itemsForVendor =
            checkoutItems.filter(
              (item) =>
                String(item.vendorId) ===
                String(shipment.vendorId)
            );

          const subtotalVendor = dec(
            itemsForVendor.reduce(
              (sum, item) =>
                sum +
                Number(item.price || 0) *
                  Number(item.qty || 0),
              0
            )
          );

          const totalVendor = dec(
            subtotalVendor +
              Number(shipment.price || 0)
          );

          await createVendorNotification(
            shipment.vendorId,
            {
              type: "order",
              title: `Comandă nouă (#${shortId})`,
              body:
                `${customerName || "Client"} a plasat o comandă – total ` +
                `${totalVendor.toFixed(2)} ` +
                `${created.currency || "RON"}.`,
              link: "/vendor/orders",
            }
          );

          const vendor = vendors.find(
            (item) =>
              String(item.id) ===
              String(shipment.vendorId)
          );

          const vendorEmail =
            vendor?.user?.email ||
            vendor?.email ||
            null;

          if (
            vendorEmail &&
            vendor?.emailOnNewOrder !== false
          ) {
            await sendVendorNewOrderEmail({
              to: vendorEmail,
              vendorName:
                vendor?.displayName || "vendor",
              order: created,
              items: itemsForVendor,
              customerName:
                customerName || "Client",
              total: totalVendor,
              currency:
                created.currency || "RON",
            });
          }
        })
      );
    } catch (err) {
      console.error(
        "Nu am putut crea notificările guest pentru vendor:",
        err
      );
    }

    await notifyInfluencersWithIncompletePayoutProfile(
      guestShipmentsForNotifications
    );

  try {
  const frontendUrl = (
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5173"
  ).replace(/\/+$/, "");

  const guestOrderUrl =
    `${frontendUrl}/comanda-guest/${encodeURIComponent(
      created.id
    )}` +
    `?token=${encodeURIComponent(
      guestAccess.token
    )}`;

  await sendOrderConfirmationEmail({
    to:
      customerEmail,

    order:
      created,

    items:
      checkoutItems,

    storeAddresses,

    /*
     * Guest-ul nu are userId.
     */
    userId:
      null,

    /*
     * Spunem explicit mailerului
     * că este comandă guest.
     */
    isGuest:
      true,

    /*
     * Link securizat către pagina
     * publică a comenzii.
     */
    actionUrl:
      guestOrderUrl,

    /*
     * =================================================
     * PLATĂ GUEST
     * =================================================
     *
     * Pentru CARD, emailul îi explică
     * faptul că poate reveni în pagină
     * și relua plata.
     */
    paymentMethod:
      pm,

    paymentPending:
      pm === "CARD",
  });
} catch (err) {
  console.error(
    "Eroare la trimiterea emailului guest:",
    err
  );
}

   /*
 * =====================================================
 * RĂSPUNS CHECKOUT GUEST
 * =====================================================
 */

if (pm === "COD") {
  return res.json({
    ok: true,

    orderId:
      created.id,

    orderNumber:
      created.orderNumber,

    guestAccessToken:
      guestAccess.token,

    total:
      Number(
        created.total
      ),

    subtotal:
      Number(
        created.subtotal
      ),

    shippingTotal:
      Number(
        created.shippingTotal
      ),

    currency:
      created.currency ||
      "RON",

    eligibleCampaignVendorIds,
  });
}

/*
 * Plata integrală cu cardul.
 */
try {
 const payment =
  await createPaymentForOrder({
    ...created,

    guestAccessToken:
      guestAccess.token,
  });

  return res.json({
    ok: true,

    orderId:
      created.id,

    orderNumber:
      created.orderNumber,

    guestAccessToken:
      guestAccess.token,

    total:
      Number(
        created.total
      ),

    subtotal:
      Number(
        created.subtotal
      ),

    shippingTotal:
      Number(
        created.shippingTotal
      ),

    currency:
      created.currency ||
      "RON",

    payment,

    eligibleCampaignVendorIds,
  });
} catch (paymentError) {
  console.error(
    "Eroare la inițierea plății guest:",
    paymentError
  );

  if (paymentError instanceof CardPaymentUnavailableError) {
    return res.status(paymentError.status || 400).json({
      error: paymentError.code,
      message: paymentError.message,
      orderId: created.id,
      orderNumber: created.orderNumber,
      guestAccessToken: guestAccess.token,
    });
  }

  return res.status(500).json({
    error:
      "guest_payment_init_failed",

    message:
      "Comanda a fost creată, dar nu am putut iniția plata cu cardul.",

    orderId:
      created.id,

    orderNumber:
      created.orderNumber,

    /*
     * Îl păstrăm pentru ca guest-ul
     * să poată reveni la comandă.
     */
    guestAccessToken:
      guestAccess.token,
  });
}
  } catch (err) {
    console.error(
      "Eroare la plasarea comenzii guest:",
      err
    );

    if (err?.message === "insufficient_stock") {
      return res.status(409).json({
        error: "insufficient_stock",
        message:
          "Cantitatea solicitată nu mai este disponibilă pentru unul dintre produse.",
      });
    }

    if (err?.message === "product_sold_out") {
      return res.status(409).json({
        error: "product_sold_out",
        message:
          "Un produs din coș este epuizat.",
      });
    }

    if (
      err?.message === "product_unavailable"
    ) {
      return res.status(409).json({
        error: "product_unavailable",
        message:
          "Un produs din coș nu mai este disponibil.",
      });
    }

    if (err?.message === "product_not_found") {
      return res.status(404).json({
        error: "product_not_found",
        message:
          "Un produs din coș nu mai există.",
      });
    }

    return res.status(500).json({
      error: "guest_order_place_failed",
      message:
        "Nu am putut plasa comanda.",
    });
  }
});

export default router;