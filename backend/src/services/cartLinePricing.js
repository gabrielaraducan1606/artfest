// backend/src/services/cartLinePricing.js
//
// Prețul pe LINIE (produs + variantele alese) pentru coș și checkout, peste
// prețurile cu promoții calculate pe produs (getPromotionPricingForProducts).
//
// Promoția câștigătoare se alege în continuare pe produs (procentele nu
// depind de preț; regulile de colecție pe interval de preț folosesc prețul
// de bază). Aici doar reaplicăm ACELAȘI procent pe prețul configurat:
//   unitPrice = product.priceCents + Σ priceDeltaCents (lib/variantPricing.js)
// Fără diferențe de preț, rezultatul e exact cel de până acum.

import { resolveVariantPricing } from "../lib/variantPricing.js";
import { calculateProductPromotionPricing } from "./productPromotionPrice.js";

/**
 * Validează variantele fiecărei linii și atașează item.variantPricing.
 * Întoarce PRIMA linie invalidă (sau null). Liniile fără produs sunt sărite.
 */
export function attachVariantPricing(items = []) {
  let firstInvalid = null;

  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.product) continue;
    item.variantPricing = resolveVariantPricing(item.product, item.selectedOptions, {
      repeatedGroupAnswers: item.repeatedGroupAnswers,
    });
    if (!item.variantPricing.ok && !firstInvalid) firstInvalid = item;
  }

  return firstInvalid;
}

export function invalidVariantErrorBody(item) {
  const title = item?.product?.title ? `„${item.product.title}”` : "un produs din coș";
  return {
    error: "invalid_variant_selection",
    message: `Varianta aleasă pentru ${title} nu este validă: ${item?.variantPricing?.message || "verifică opțiunile."} Modifică produsul în coș și încearcă din nou.`,
    productId: item?.productId || item?.product?.id || null,
    configurationKey: item?.configurationKey || "default",
    fields: (item?.variantPricing?.errors || []).map((e) => ({ key: e.key, message: e.message })),
  };
}

/** Prețul unitar de bază al liniei (înainte de promoții), configurat. */
export function lineUnitPriceCents(item) {
  const unit = item?.variantPricing?.unitPriceCents;
  return Number.isFinite(unit) ? unit : Number(item?.product?.priceCents || 0);
}

/**
 * Prețul cu promoție pentru LINIE. `pricing` = rezultatul pe produs
 * (calculat pe prețul de bază). Fără diferență de preț -> neschimbat.
 */
export function linePricingFor(pricing, item) {
  const product = item?.product;
  const unit = item?.variantPricing?.unitPriceCents;
  if (!product || !Number.isFinite(unit)) return pricing || null;

  const base = Number(product.priceCents || 0);
  if (unit === base) return pricing || null;

  const promotion = pricing?.discount?.active ? pricing.discount : null;
  return calculateProductPromotionPricing({ ...product, priceCents: unit }, promotion);
}
