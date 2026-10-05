// backend/src/services/discountCodeValidation.js

/*
 * Service CENTRAL de validare a codurilor de reducere la cart/checkout.
 * Reutilizat identic de:
 * - POST /checkout/discount-code/validate (preview, cont autentificat)
 * - POST /checkout/guest/discount-code/validate (preview, guest)
 * - GET /checkout/summary, POST /checkout/guest/summary (afișare sumar)
 * - POST /checkout/place, POST /checkout/guest/place (revalidare FINALĂ,
 *   în interiorul tranzacției de creare a comenzii - db: tx)
 *
 * Reguli:
 * - Validare FRESH din DB de fiecare dată, niciodată din cache/frontend.
 * - Frontendul NU decide eligibilitatea și NU calculează reducerea.
 * - Accept opțional `db` (implicit `prisma`), exact ca
 *   ensureRefundLedgerEntry/ensureInfluencerRefundLedgerEntry din
 *   vendorOrdersRoutes.js - permite reutilizare identică în afara
 *   sau în interiorul unei tranzacții ($transaction), fără cod duplicat.
 */

import { prisma } from "../db.js";
import { discountCodeToPromotion } from "./productPromotionPrice.js";

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clampPercent(value) {
  const n = Number(value) || 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

export function normalizeDiscountCodeInput(raw = "") {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeEmailForMatch(raw = "") {
  return String(raw || "").trim().toLowerCase();
}

/**
 * Identificatorul de LINIE al unui item din cart - implicit product.id
 * (comportament NESCHIMBAT pentru orice apelant existent, care nu
 * trimite niciodată `lineKey`: checkout normal, guest checkout,
 * cereri de ofertă pe produs real). Un apelant NOU poate trimite
 * explicit `lineKey` pentru o linie FĂRĂ produs de catalog (cerere
 * personalizată, fără productId real) - NU inventăm un productId
 * fals, folosim un identificator de linie distinct (ex. "custom-0"),
 * niciodată confundabil cu un cuid real de Product.
 *
 * audit 2026-09-28 (cod de reducere la cereri custom din
 * customerRequestsRoutes.js): fără asta, un item cu product.id=null
 * era exclus din ORICE calcul de eligibilitate/subtotal, chiar și
 * pentru coduri ALL_PRODUCTS/VENDOR_ALL_PRODUCTS care nu au nevoie
 * de un productId real ca să decidă eligibilitatea.
 */
function lineKeyOf(item) {
  if (item?.lineKey != null) {
    const key = String(item.lineKey).trim();
    return key || null;
  }

  return item?.product?.id ?? null;
}

/**
 * Produsele/liniile eligibile din cart-ul curent, în funcție de scope.
 * `cartItems` - [{ product: { id, service: { vendorId } }, qty, lineKey? }].
 *
 * ALL_PRODUCTS/VENDOR_ALL_PRODUCTS întorc chei de LINIE (lineKeyOf) -
 * nu au nevoie de un productId real, decid strict pe baza cart-ului
 * curent. SELECTED_PRODUCTS/INFLUENCER_COLLECTION/VENDOR_COLLECTION
 * rămân STRICT pe productId real (interogare DB pe FK reale) - un
 * item fără productId real (cerere custom) nu poate fi niciodată
 * eligibil pentru aceste scope-uri, exact cerința "codurile limitate
 * strict la anumite produse NU se aplică unei cereri custom fără
 * produs asociat" - comportament GARANTAT structural, nu printr-un
 * if separat.
 */
async function resolveEligibleProductIds({
  discountCode,
  cartItems,
  db,
}) {
  const cartProductIds = new Set(
    cartItems.map((it) => it.product?.id).filter(Boolean)
  );

  if (discountCode.scope === "ALL_PRODUCTS") {
    return new Set(cartItems.map(lineKeyOf).filter(Boolean));
  }

  if (discountCode.scope === "VENDOR_ALL_PRODUCTS") {
    const eligible = new Set();
    for (const it of cartItems) {
      const vendorId = it.product?.service?.vendorId;
      const key = lineKeyOf(it);
      if (
        key &&
        vendorId &&
        String(vendorId) === String(discountCode.vendorId)
      ) {
        eligible.add(key);
      }
    }
    return eligible;
  }

  if (discountCode.scope === "SELECTED_PRODUCTS") {
    const links = await db.discountCodeProduct.findMany({
      where: {
        discountCodeId: discountCode.id,
        productId: { in: [...cartProductIds] },
      },
      select: { productId: true },
    });
    return new Set(links.map((l) => l.productId));
  }

  if (discountCode.scope === "INFLUENCER_COLLECTION") {
    if (!discountCode.influencerCollectionId) return new Set();

    const links = await db.influencerCollectionItem.findMany({
      where: {
        collectionId: discountCode.influencerCollectionId,
        productId: { in: [...cartProductIds] },
      },
      select: { productId: true },
    });
    return new Set(links.map((l) => l.productId));
  }

  /*
   * Mirror al INFLUENCER_COLLECTION de mai sus - o VendorCollection
   * poate conține produse ale ORICĂRUI vendor (nu doar ale
   * proprietarului colecției, vezi vendorCollectionsRoutes.js), deci
   * eligibilitatea e strict pe VendorCollectionItem, fără nicio
   * verificare suplimentară de vendorId aici.
   */
  if (discountCode.scope === "VENDOR_COLLECTION") {
    if (!discountCode.vendorCollectionId) return new Set();

    const links = await db.vendorCollectionItem.findMany({
      where: {
        collectionId: discountCode.vendorCollectionId,
        productId: { in: [...cartProductIds] },
      },
      select: { productId: true },
    });
    return new Set(links.map((l) => l.productId));
  }

  return new Set();
}

/*
 * =========================================================
 * STATUS EFECTIV AL UNUI COD - SURSĂ UNICĂ
 * =========================================================
 * Folosit de validateDiscountCode (checkout / summary / oferte) ȘI de
 * listările vendor / influencer / admin (effectiveStatus), ca UI-ul să
 * afișeze exact ce acceptă validarea. Expirarea NU e scrisă în DB
 * (discountCodeExpiryJob doar notifică) - se derivă aici, la cerere.
 *
 * Ordinea = ordinea verificărilor din validateDiscountCode:
 *   DISABLED  - status != ACTIVE sau isActive = false
 *   SCHEDULED - startsAt > now
 *   EXPIRED   - endsAt <= now
 *   EXHAUSTED - usageLimit setat și usedCount >= usageLimit
 *   ACTIVE    - altfel
 * Datele sunt comparate ca instanțe Date (UTC), fără fus orar local.
 */
export const DISCOUNT_CODE_EFFECTIVE_STATUS = Object.freeze({
  DISABLED: "DISABLED",
  SCHEDULED: "SCHEDULED",
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  EXHAUSTED: "EXHAUSTED",
});

const toDateOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function deriveDiscountCodeStatus(discountCode, now = new Date()) {
  const S = DISCOUNT_CODE_EFFECTIVE_STATUS;
  if (!discountCode) return S.DISABLED;

  if (discountCode.status !== "ACTIVE" || !discountCode.isActive) return S.DISABLED;

  const at = toDateOrNull(now) || new Date();
  const startsAt = toDateOrNull(discountCode.startsAt);
  const endsAt = toDateOrNull(discountCode.endsAt);

  if (startsAt && startsAt > at) return S.SCHEDULED;
  if (endsAt && endsAt <= at) return S.EXPIRED;

  if (
    discountCode.usageLimit !== null &&
    discountCode.usageLimit !== undefined &&
    Number(discountCode.usedCount || 0) >= Number(discountCode.usageLimit)
  ) {
    return S.EXHAUSTED;
  }

  return S.ACTIVE;
}

/**
 * @returns {Promise<{
 *   valid: boolean,
 *   error: string|null,
 *   message: string|null,
 *   discountCode: object|null,
 *   eligibleProductIds: Set<string>|null,
 *   effectiveDiscountPercent: number,
 *   estimatedDiscountAmountCents: number,
 * }>}
 */
export async function validateDiscountCode({
  code,
  cartItems = [],
  currency = "RON",
  userId = null,
  customerEmail = null,
  now = new Date(),
  db = prisma,
}) {
  const invalid = (error, message) => ({
    valid: false,
    error,
    message,
    discountCode: null,
    eligibleProductIds: null,
    effectiveDiscountPercent: 0,
    estimatedDiscountAmountCents: 0,
  });

  const normalizedCode = normalizeDiscountCodeInput(code);

  if (!normalizedCode) {
    return invalid("code_required", "Introdu un cod de reducere.");
  }

  if (!Array.isArray(cartItems) || !cartItems.length) {
    return invalid("cart_empty", "Coșul este gol.");
  }

  const discountCode = await db.discountCode.findUnique({
    where: { code: normalizedCode },
  });

  if (!discountCode) {
    return invalid(
      "discount_code_not_found",
      "Codul de reducere nu există."
    );
  }

  // statusul efectiv - aceeași funcție ca listările (effectiveStatus)
  const effectiveStatus = deriveDiscountCodeStatus(discountCode, now);

  if (effectiveStatus === DISCOUNT_CODE_EFFECTIVE_STATUS.DISABLED) {
    return invalid(
      "discount_code_inactive",
      "Acest cod de reducere nu mai este activ."
    );
  }

  if (effectiveStatus === DISCOUNT_CODE_EFFECTIVE_STATUS.SCHEDULED) {
    return invalid(
      "discount_code_not_started",
      "Acest cod de reducere nu este încă valabil."
    );
  }

  if (effectiveStatus === DISCOUNT_CODE_EFFECTIVE_STATUS.EXPIRED) {
    return invalid(
      "discount_code_expired",
      "Acest cod de reducere a expirat."
    );
  }

  if (
    discountCode.currency &&
    currency &&
    discountCode.currency !== currency
  ) {
    return invalid(
      "discount_code_currency_mismatch",
      "Acest cod de reducere nu este valabil pentru moneda comenzii."
    );
  }

  // după verificarea monedei - ordinea de erori de dinainte
  if (effectiveStatus === DISCOUNT_CODE_EFFECTIVE_STATUS.EXHAUSTED) {
    return invalid(
      "discount_code_usage_limit_reached",
      "Acest cod de reducere a atins limita de utilizări."
    );
  }

  if (
    discountCode.usageLimitPerUser !== null &&
    discountCode.usageLimitPerUser !== undefined &&
    (userId || customerEmail)
  ) {
    const perUserWhere = userId
      ? { discountCodeId: discountCode.id, userId }
      : {
          discountCodeId: discountCode.id,
          customerEmail: {
            equals: normalizeEmailForMatch(customerEmail),
            mode: "insensitive",
          },
        };

    const usedByThisUser = await db.discountCodeRedemption.count({
      where: perUserWhere,
    });

    if (usedByThisUser >= discountCode.usageLimitPerUser) {
      return invalid(
        "discount_code_usage_limit_per_user_reached",
        "Ai folosit deja acest cod de reducere de numărul maxim de ori permis."
      );
    }
  }

  const eligibleProductIds = await resolveEligibleProductIds({
    discountCode,
    cartItems,
    db,
  });

  if (!eligibleProductIds.size) {
    return invalid(
      "discount_code_no_eligible_products",
      "Acest cod de reducere nu se aplică niciunui produs din coșul tău."
    );
  }

  let eligibleSubtotalCents = 0;
  for (const it of cartItems) {
    const key = lineKeyOf(it);
    if (!key || !eligibleProductIds.has(key)) continue;
    const priceCents = Number(it.product?.priceCents || 0);
    const qty = Number(it.qty || 0);
    eligibleSubtotalCents += priceCents * qty;
  }

  if (eligibleSubtotalCents <= 0) {
    return invalid(
      "discount_code_no_eligible_products",
      "Acest cod de reducere nu se aplică niciunui produs din coșul tău."
    );
  }

  if (
    discountCode.minimumOrderCents !== null &&
    discountCode.minimumOrderCents !== undefined
  ) {
    const cartOriginalSubtotalCents = cartItems.reduce(
      (sum, it) =>
        sum + Number(it.product?.priceCents || 0) * Number(it.qty || 0),
      0
    );

    if (cartOriginalSubtotalCents < discountCode.minimumOrderCents) {
      return invalid(
        "discount_code_minimum_order_not_met",
        "Valoarea comenzii nu atinge minimul necesar pentru acest cod."
      );
    }
  }

  /*
   * Procentul EFECTIV pentru acest cart, calculat o singură dată:
   * - PERCENT: discountPercent, plafonat astfel încât suma totală
   *   să nu depășească maxDiscountCents (dacă e setat).
   * - FIXED_AMOUNT: convertit într-un procent echivalent pe
   *   subtotalul eligibil, plafonat de maxDiscountCents.
   * Regulă explicată explicit userului înainte de implementare -
   * permite codului să concureze corect, per produs, cu promoțiile
   * automate (chooseBestPromotion), fără mecanism financiar separat.
   */
  let effectiveDiscountPercent = 0;

  if (discountCode.discountType === "FIXED_AMOUNT") {
    const rawAmountCents = Math.min(
      Number(discountCode.discountAmountCents || 0),
      eligibleSubtotalCents
    );

    const cappedAmountCents =
      discountCode.maxDiscountCents !== null &&
      discountCode.maxDiscountCents !== undefined
        ? Math.min(rawAmountCents, discountCode.maxDiscountCents)
        : rawAmountCents;

    effectiveDiscountPercent = clampPercent(
      (cappedAmountCents / eligibleSubtotalCents) * 100
    );
  } else {
    const basePercent = clampPercent(discountCode.discountPercent);

    if (
      discountCode.maxDiscountCents !== null &&
      discountCode.maxDiscountCents !== undefined
    ) {
      const uncappedAmountCents =
        (eligibleSubtotalCents * basePercent) / 100;

      effectiveDiscountPercent =
        uncappedAmountCents > discountCode.maxDiscountCents
          ? clampPercent(
              (discountCode.maxDiscountCents / eligibleSubtotalCents) * 100
            )
          : basePercent;
    } else {
      effectiveDiscountPercent = basePercent;
    }
  }

  if (effectiveDiscountPercent <= 0) {
    return invalid(
      "discount_code_no_discount",
      "Acest cod de reducere nu oferă nicio reducere pentru coșul tău."
    );
  }

  const estimatedDiscountAmountCents = Math.round(
    (eligibleSubtotalCents * effectiveDiscountPercent) / 100
  );

  return {
    valid: true,
    error: null,
    message: null,
    discountCode,
    eligibleProductIds,
    effectiveDiscountPercent,
    estimatedDiscountAmountCents,
  };
}

/**
 * Recalculează `estimatedDiscountAmountCents` DOAR din liniile pe care
 * codul chiar le-a câștigat la best promotion - NU un calculator nou,
 * doar o re-agregare a rezultatului deja produs de
 * getPromotionPricingForProducts()/chooseBestPromotion() (sursa unică).
 *
 * `validateDiscountCode()` calculează valoarea BRUTĂ a codului (cât ar
 * reduce dacă ar câștiga peste tot) - necesară ca prag de comparație
 * pentru chooseBestPromotion, dar NU e valoarea reală de afișat dacă
 * o altă promoție (Artizan/ProductOfDay/Collection/Campanie) câștigă
 * pe unele sau toate produsele eligibile ale codului.
 *
 * @param {object} params
 * @param {object} params.validation - rezultatul lui validateDiscountCode()
 * @param {Array} params.cartItems - același array trimis la validateDiscountCode
 *   (are nevoie de `qty`, care nu există în pricingByProductId)
 * @param {Map} params.pricingByProductId - rezultatul lui
 *   getPromotionPricingForProducts(), calculat cu candidatul acestui cod inclus
 */
export function realizeDiscountCodeAmount({
  validation,
  cartItems = [],
  pricingByProductId,
}) {
  if (!validation?.valid || !pricingByProductId) {
    return validation;
  }

  let realizedAmountCents = 0;
  let wonOnAnyItem = false;
  let lostToOtherPromotion = false;

  for (const it of cartItems) {
    const productId = it.product?.id;
    if (!productId || !validation.eligibleProductIds.has(productId)) {
      continue;
    }

    const pricing = pricingByProductId.get(productId);
    const qty = Number(it.qty || 0);

    if (pricing?.discount?.source === "DISCOUNT_CODE") {
      wonOnAnyItem = true;

      realizedAmountCents += Math.round(
        (Number(pricing.originalPriceCents || pricing.priceCents || 0) -
          Number(pricing.finalPriceCents || pricing.priceCents || 0)) *
          qty
      );
    } else {
      lostToOtherPromotion = true;
    }
  }

  return {
    ...validation,
    estimatedDiscountAmountCents: realizedAmountCents,
    wonOnAnyItem,
    lostToOtherPromotion,
  };
}

/**
 * Map<productId, promotionCandidate> - gata de trimis în
 * getPromotionPricingForProducts({ discountCodePromotionsByProductId }).
 * Returnează Map gol dacă validarea a eșuat (fail-safe pentru
 * apelurile de preview/sumar - fail-closed e responsabilitatea
 * apelantului la /checkout/place, nu a acestei funcții pur descriptive).
 *
 * `cartItems` (opțional) - aceleași obiecte trimise la
 * validateDiscountCode ({ product: { id, service: { vendorId } } }).
 * Necesar STRICT pentru garda de mai jos (VENDOR_COLLECTION +
 * finanțare VENDOR) - dacă lipsește, comportamentul e neschimbat
 * (niciun apel existent, în afara /checkout/place și guest/place, nu
 * are nevoie de gardă, fiind preview-uri fără scriere financiară).
 */
export function buildDiscountCodePromotionsByProductId(
  validation,
  { cartItems = null } = {}
) {
  const map = new Map();

  if (!validation?.valid || !validation.eligibleProductIds) {
    return map;
  }

  const { discountCode, eligibleProductIds, effectiveDiscountPercent } =
    validation;

  const promotion = discountCodeToPromotion({
    discountCodeId: discountCode.id,
    code: discountCode.code,
    discountPercent: effectiveDiscountPercent,
    fundingSource: discountCode.fundingSource,
    platformFundingBps: discountCode.platformFundingBps,
    vendorFundingBps: discountCode.vendorFundingBps,
  });

  if (!promotion) return map;

  /*
   * GARDĂ (audit 2026-09-15, regula finală de business pentru
   * VendorCollection): o reducere de colecție finanțată de VENDOR
   * (100% vendor, cerință nouă) NU poate fi scăzută din net-ul unui
   * ALT vendor - modelul actual nu are un câmp care să redirecționeze
   * "cine plătește efectiv" separat de "cărui shipment aparține
   * itemul" (vendorDiscountAmount se scrie mereu pe shipment-ul
   * SELLER-ului, niciodată pe cel al creatorului colecției). Fără o
   * schimbare de schemă, singura variantă sigură e ca reducerea să NU
   * se aplice deloc la preț pentru produsele altor vendori din
   * colecție - ATRIBUIREA (referral cross-vendor) rămâne neatinsă,
   * calculată separat, tot pe eligibleProductIds complet (vezi
   * chekoutRoutes.js) - doar prețul/reducerea efectivă e restrânsă
   * aici la produsele PROPRII ale creatorului colecției.
   */
  const isVendorFundedCollection =
    discountCode.scope === "VENDOR_COLLECTION" &&
    discountCode.fundingSource === "VENDOR";

  const vendorIdByProductId = isVendorFundedCollection
    ? new Map(
        (cartItems || [])
          .filter((it) => it.product?.id)
          .map((it) => [
            it.product.id,
            it.product?.service?.vendorId || null,
          ])
      )
    : null;

  for (const productId of eligibleProductIds) {
    if (
      isVendorFundedCollection &&
      String(vendorIdByProductId.get(productId) || "") !==
        String(discountCode.vendorId || "")
    ) {
      continue;
    }

    map.set(productId, promotion);
  }

  return map;
}

/**
 * Creează DiscountCodeRedemption + incrementează usedCount, ATOMIC
 * și concurent-safe - identic ca strategie cu decrementul de stoc
 * din /checkout/place (updateMany cu condiție pe valoarea citită
 * fresh, verificare count === 1, altfel eroare - nu tăcem niciodată).
 *
 * Trebuie apelată cu `db: tx`, în ACEEAȘI tranzacție cu tx.order.create,
 * DUPĂ ce order-ul există deja (are nevoie de orderId).
 */
export async function redeemDiscountCode({
  db = prisma,
  discountCodeId,
  usageLimit,
  usageLimitPerUser,
  orderId,
  userId = null,
  customerEmail = null,
  discountAmountCents = 0,
}) {
  /*
   * Increment ATOMIC pe usedCount - condiția `usedCount: { lt }` e
   * reevaluată de Postgres la momentul UPDATE-ului (nu pe un snapshot
   * citit anterior), exact ca decrementul de stoc din /checkout/place.
   * Efect secundar folosit intenționat: UPDATE-ul ia un lock pe rândul
   * DiscountCode, deci un al doilea request concurent pentru ACELAȘI
   * cod așteaptă până la commit-ul primului înainte să-și reevalueze
   * propriul WHERE - asta serializează corect și verificarea de mai
   * jos (per-user), care altfel ar avea o fereastră de race pe
   * dublu-submit simultan din partea ACELUIAȘI utilizator.
   */
  const now = new Date();

  /*
   * `usageLimit` e Int (INT4, max 2147483647) în schemă - un fallback
   * gen `usageLimit ?? Number.MAX_SAFE_INTEGER` nu încape în INT4 și
   * face Prisma să eșueze la construirea query-ului. Dacă nu există
   * limită, pur și simplu NU trimitem deloc condiția `usedCount.lt`
   * către Prisma, în loc să simulăm "fără limită" cu o valoare uriașă.
   */
  const normalizedUsageLimit =
    usageLimit != null ? Number(usageLimit) : null;

  const updated = await db.discountCode.updateMany({
    where: {
      id: discountCodeId,
      isActive: true,
      status: "ACTIVE",
      OR: [
        { startsAt: null },
        { startsAt: { lte: now } },
      ],
      AND: [
        {
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
      ],

      ...(normalizedUsageLimit != null
        ? {
            usedCount: {
              lt: normalizedUsageLimit,
            },
          }
        : {}),
    },
    data: {
      usedCount: { increment: 1 },
    },
  });

  if (updated.count !== 1) {
    const err = new Error("discount_code_usage_limit_reached");
    err.code = "DISCOUNT_CODE_UNAVAILABLE";
    throw err;
  }

  if (
    usageLimitPerUser !== null &&
    usageLimitPerUser !== undefined &&
    (userId || customerEmail)
  ) {
    const perUserWhere = userId
      ? { discountCodeId, userId }
      : {
          discountCodeId,
          customerEmail: {
            equals: normalizeEmailForMatch(customerEmail),
            mode: "insensitive",
          },
        };

    const usedByThisUser = await db.discountCodeRedemption.count({
      where: perUserWhere,
    });

    if (usedByThisUser >= usageLimitPerUser) {
      const err = new Error(
        "discount_code_usage_limit_per_user_reached"
      );
      err.code = "DISCOUNT_CODE_UNAVAILABLE";
      throw err;
    }
  }

  return db.discountCodeRedemption.create({
    data: {
      discountCodeId,
      orderId,
      userId: userId || null,
      customerEmail: customerEmail
        ? normalizeEmailForMatch(customerEmail)
        : null,
      discountAmountCents: Math.round(Number(discountAmountCents) || 0),
    },
  });
}
