// backend/src/integrations/core/importPlanner.js
//
// „Importul inteligent”: un produs extern (forma comună, core/normalize.js)
// -> planul produsului Artfest, cu fiecare decizie marcată:
//   certain  - din date structurate ale magazinului (stoc urmărit, epuizat,
//              variații concrete, add-on-uri de personalizare);
//   proposed - dedusă din text sau propusă de AI: cere confirmarea
//              vânzătorului;
//   unknown  - lipsește: cere completarea de către vânzător.
// Planul NU inventează variante, cantități sau termene. Un produs se
// importă doar după ce toate cheile din `needsConfirmation` au primit o
// valoare (applyConfirmations).
//
// Separarea variantelor de personalizări: doar atributele de variație
// (variation: true) devin opțiuni de stoc (stockAxis); câmpurile de
// personalizare (nume, mesaj, fotografie - add-on-uri) devin customSchema
// și nu au stoc.
//
// Profilul logistic (greutate / dimensiuni colet) se preia din produs,
// convertit (core/normalize.js normalizeShippingMeasures). Lipsa lui NU
// blochează importul și NU cere confirmare: produsul rămâne pe tariful de
// rezervă al vânzătorului până completează greutatea în Artfest. Variantele
// nu au profil propriu în Artfest: greutățile lor sunt doar semnalate.

import { combinationKey, setCombinationOverrides } from "../../lib/variantPricing.js";
import { availabilityHints, htmlToText, looksLikePersonalization } from "./normalize.js";

const AVAILABILITIES = new Set(["READY", "MADE_TO_ORDER", "PREORDER", "SOLD_OUT"]);
const MAX_IMAGES = 10;

/** Disponibilitatea unei unități de stoc din datele magazinului. */
function stockDecision(stock, hints) {
  const status = stock?.status;
  const backorders = stock?.backorders !== "no" || status === "onbackorder";

  if (stock?.managed) {
    const qty = Number(stock.quantity) || 0;
    if (qty > 0) return { availability: "READY", qty, certainty: "certain", reason: "stoc urmărit, disponibil" };
    if (!backorders) return { availability: "SOLD_OUT", qty: 0, certainty: "certain", reason: "stoc urmărit, epuizat" };
  } else {
    if (status === "instock") return { availability: "READY", qty: null, certainty: "certain", reason: "în stoc, cantitate neurmărită" };
    if (status === "outofstock") return { availability: "SOLD_OUT", qty: 0, certainty: "certain", reason: "marcat epuizat" };
  }

  // comenzi acceptate fără stoc: la comandă SAU precomandă - textul doar sugerează
  const proposal = hints.preorder ? "PREORDER" : hints.madeToOrder ? "MADE_TO_ORDER" : null;
  return {
    availability: proposal,
    qty: null,
    certainty: proposal ? "proposed" : "unknown",
    reason: "comenzi acceptate fără stoc (backorders) - la comandă sau precomandă?",
  };
}

const SHIPPING_WARNINGS = {
  weight_missing: "shipping_weight_missing",
  weight_unit_unknown: "shipping_weight_unit_unknown",
  weight_invalid: "shipping_weight_invalid",
  dimensions_incomplete: "shipping_dimensions_incomplete",
  dimension_unit_unknown: "shipping_dimension_unit_unknown",
  dimensions_invalid: "shipping_dimensions_invalid",
};

/**
 * Profilul logistic al produsului părinte -> plan.product + plan.shipping
 * (valori originale + convertite, pentru previzualizare) + avertismente.
 */
function applyShipping(plan, product) {
  const shipping = product.shipping || { weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, issues: ["weight_missing"], source: null };
  Object.assign(plan.product, {
    shippingWeightGrams: shipping.weightGrams,
    shippingLengthCm: shipping.lengthCm,
    shippingWidthCm: shipping.widthCm,
    shippingHeightCm: shipping.heightCm,
  });

  // greutățile variațiilor importate (API-ul dă greutatea părintelui variațiilor fără valoare proprie)
  const imported = new Set(plan.variants.map((v) => v.externalVariantId));
  const variantWeights = (product.variations || [])
    .filter((v) => imported.has(v.externalId))
    .map((v) => v.shipping?.weightGrams)
    .filter(Number.isInteger);
  const heaviestVariantGrams = variantWeights.length ? Math.max(...variantWeights) : null;

  const issues = [...(shipping.issues || [])];
  const warnings = issues.map((issue) => SHIPPING_WARNINGS[issue]).filter(Boolean);
  if (shipping.weightGrams === null && issues.includes("weight_missing") && heaviestVariantGrams !== null) {
    // doar variantele au greutate: nu alegem noi una pentru produs
    warnings.splice(warnings.indexOf("shipping_weight_missing"), 1, "shipping_weight_only_on_variants");
  } else if (shipping.weightGrams !== null && variantWeights.some((g) => g !== shipping.weightGrams)) {
    warnings.push("shipping_weight_varies_by_variant");
  }
  plan.warnings.push(...warnings);

  plan.shipping = {
    weightGrams: shipping.weightGrams,
    lengthCm: shipping.lengthCm,
    widthCm: shipping.widthCm,
    heightCm: shipping.heightCm,
    source: shipping.source,
    issues,
    heaviestVariantGrams,
  };
}

/**
 * @param {import("./normalize.js").ExternalProduct} product
 * @param {{ storeCurrency?: string|null }} [options]
 */
export function planImport(product, { storeCurrency = null } = {}) {
  const decisions = {};
  const needsConfirmation = [];
  const warnings = [];
  const blocked = [];
  const decide = (field, value, certainty, reason, source = "store") => {
    decisions[field] = { value, certainty, reason, source };
    if (certainty !== "certain" && !needsConfirmation.includes(field)) needsConfirmation.push(field);
  };

  const description = htmlToText(product.descriptionHtml) || htmlToText(product.shortDescriptionHtml);
  const hints = availabilityHints(product.name, product.descriptionHtml, product.shortDescriptionHtml);

  if (!product.name) blocked.push("missing_title");
  if (storeCurrency && String(storeCurrency).toUpperCase() !== "RON") blocked.push("currency_not_ron");
  if (product.type === "other") blocked.push("unsupported_product_type");

  const images = [...new Set([...(product.images || []), ...(product.variations || []).map((v) => v.image).filter(Boolean)])];
  if (images.length > MAX_IMAGES) warnings.push("images_truncated");

  // categoria Artfest: întotdeauna aleasă de vânzător (categoriile magazinului doar o sugerează)
  decide("category", null, "unknown", `categorii în magazin: ${(product.categories || []).join(", ") || "-"}`);

  /* ---------------- personalizări ---------------- */
  const personalization = (product.personalizationFields || []).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: Boolean(f.required),
  }));
  const details = [];
  for (const attr of (product.attributes || []).filter((a) => !a.variation)) {
    if (looksLikePersonalization(attr.name)) {
      personalization.push({ key: attr.key, label: attr.name, type: "text", required: false, guessed: true });
    } else if (attr.options.length) {
      details.push(`${attr.name}: ${attr.options.join(", ")}`);
    }
  }
  if (personalization.length) {
    const guessed = personalization.some((f) => f.guessed);
    decide(
      "personalization",
      personalization.map(({ guessed: _g, ...f }) => f),
      guessed ? "proposed" : "certain",
      guessed ? "atribute care par personalizări (nu variante de stoc)" : "câmpuri de personalizare din add-on-uri"
    );
  }
  if (product.unsupportedAddons?.length) warnings.push("unsupported_addons");
  if (product.salePriceCents !== null && product.salePriceCents !== undefined) warnings.push("store_sale_price_not_imported");

  const plan = {
    externalProductId: product.externalId,
    externalType: product.type,
    externalSku: product.sku,
    product: {
      title: product.name,
      description: [description, details.length ? `Detalii:\n${details.map((d) => `• ${d}`).join("\n")}` : ""].filter(Boolean).join("\n\n"),
      priceCents: null,
      images: images.slice(0, MAX_IMAGES),
      orderMode: "DIRECT",
      stockScope: "PRODUCT",
      availability: "READY",
      readyQty: null,
      leadTimeDays: null,
      variantPoolQty: null,
      optionsSchema: [],
    },
    productStockLink: null,
    variants: [],
    decisions,
    needsConfirmation,
    warnings,
    blocked,
    unsupportedAddons: product.unsupportedAddons || [],
  };

  /* ---------------- produs simplu ---------------- */
  if (product.type === "simple") {
    plan.product.priceCents = product.priceCents;
    const stock = stockDecision(product.stock, hints);
    decide("availability", stock.availability, stock.certainty, stock.reason);
    plan.product.availability = stock.availability;
    plan.product.readyQty = stock.qty;
    if (product.stock?.managed && product.stock.backorders !== "no" && (product.stock.quantity || 0) > 0) {
      warnings.push("backorders_beyond_stock_not_supported");
    }
    plan.productStockLink = {
      externalVariantId: "",
      stockManagedAt: product.stock?.managed ? "VARIANT" : "NONE",
      externalStock: { quantity: product.stock?.quantity ?? null, status: product.stock?.status || null },
    };
  }

  /* ---------------- produs variabil ---------------- */
  if (product.type === "variable") {
    const axes = (product.attributes || []).filter((a) => a.variation);
    if (!axes.length) blocked.push("variable_without_variation_attributes");
    for (const axis of axes) {
      if (looksLikePersonalization(axis.name)) {
        decide(`axis:${axis.key}`, "stock", "proposed", `„${axis.name}” e o variație reală în magazin, dar pare o personalizare`);
      }
    }

    const seen = new Set();
    const prices = [];
    // asocierea variantelor e după ID-ul extern; un SKU folosit de mai multe
    // variații nu identifică nimic, deci nu îl copiem pe variantele Artfest
    const skuCount = new Map();
    for (const variation of product.variations || []) {
      if (variation.sku) skuCount.set(variation.sku, (skuCount.get(variation.sku) || 0) + 1);
    }
    for (const [sku, count] of skuCount) {
      if (count > 1) warnings.push(`duplicate_variant_sku:${sku}`);
    }
    for (const variation of product.variations || []) {
      const vKey = `variant:${variation.externalId}`;
      const values = Object.fromEntries(variation.attributes.map((a) => [a.key, a.option]));
      const anyValue = axes.filter((axis) => !values[axis.key]);
      if (anyValue.length) {
        // „oricare valoare” = nu e o combinație concretă: nu inventăm combinațiile
        decide(vKey, "skip", "proposed", `acceptă orice ${anyValue.map((a) => a.name).join(", ")} - configurează manual`);
        continue;
      }
      const selections = Object.fromEntries(axes.map((axis) => [axis.key, values[axis.key]]));
      const key = combinationKey(selections);
      if (seen.has(key)) {
        warnings.push(`duplicate_combination:${variation.externalId}`);
        continue;
      }
      seen.add(key);

      let stockMode = "UNTRACKED";
      let stockQty = null;
      let availability = null;
      if (variation.stockManagedAt === "VARIANT") {
        stockMode = "OWN";
        stockQty = Math.max(0, Number(variation.stock.quantity) || 0);
        if (stockQty === 0 && variation.stock.backorders !== "no") {
          const decision = stockDecision({ ...variation.stock, managed: false, status: "onbackorder" }, hints);
          decide(`${vKey}:availability`, decision.availability, decision.certainty, decision.reason);
          availability = decision.availability;
        }
      } else if (variation.stockManagedAt === "PARENT") {
        if (product.stock?.managed) stockMode = "PRODUCT_POOL";
        else warnings.push(`parent_stock_not_managed:${variation.externalId}`);
      }
      if (stockMode === "UNTRACKED") {
        const decision = stockDecision({ ...variation.stock, managed: false }, hints);
        availability = decision.availability === "READY" ? null : decision.availability;
        if (decision.certainty !== "certain") decide(`${vKey}:availability`, decision.availability, decision.certainty, decision.reason);
      }

      if (variation.priceCents !== null) prices.push({ selections, priceCents: variation.priceCents });
      // Artfest are un singur preț pe variantă (reducerile = promoții Artfest):
      // se importă prețul normal, iar reducerea din magazin e semnalată explicit
      const storeSalePriceCents =
        variation.salePriceCents !== null &&
        variation.salePriceCents !== undefined &&
        (variation.priceCents === null || variation.salePriceCents < variation.priceCents)
          ? variation.salePriceCents
          : null;
      if (storeSalePriceCents !== null) warnings.push(`variant_sale_price_not_imported:${variation.externalId}`);
      const sku = variation.sku && skuCount.get(variation.sku) === 1 ? variation.sku : null;
      plan.variants.push({
        externalVariantId: variation.externalId,
        sku,
        externalSku: variation.sku || null,
        storeSalePriceCents,
        combinationKey: key,
        selections,
        label: axes.map((axis) => selections[axis.key]).join(" / "),
        stockMode,
        stockQty,
        availability,
        stockManagedAt: variation.stockManagedAt,
        externalStock: { quantity: variation.stock.quantity, status: variation.stock.status },
      });
    }

    if (!plan.variants.length) blocked.push("no_importable_variations");

    const base = prices.length ? Math.min(...prices.map((p) => p.priceCents)) : product.priceCents;
    plan.product.priceCents = base ?? null;
    plan.product.orderMode = "OPTIONS";
    plan.product.stockScope = "VARIANT";
    plan.product.readyQty = null; // totalul se calculează din variante (syncVariantAggregate)
    plan.product.variantPoolQty = plan.variants.some((v) => v.stockMode === "PRODUCT_POOL")
      ? Math.max(0, Number(product.stock.quantity) || 0)
      : null;
    // variante = opțiuni de STOC; valorile folosite efectiv de variațiile importate
    const optionsSchema = axes.map((axis) => ({
      key: axis.key,
      label: axis.name,
      type: "select",
      required: true,
      stockAxis: true,
      options: axis.options.filter((option) => plan.variants.some((v) => v.selections[axis.key] === option)),
    }));
    const overrides = prices.filter((p) => p.priceCents !== base && plan.variants.some((v) => v.combinationKey === combinationKey(p.selections)));
    plan.product.optionsSchema = overrides.length ? setCombinationOverrides(optionsSchema, overrides) : optionsSchema;
    // stocul comun (variațiile „parent”) e stocul produsului părinte din magazin
    plan.productStockLink =
      plan.product.variantPoolQty !== null
        ? {
            externalVariantId: "",
            stockManagedAt: "VARIANT",
            externalStock: { quantity: product.stock.quantity, status: product.stock.status },
          }
        : null;
  }

  if (plan.product.priceCents === null || plan.product.priceCents <= 0) blocked.push("missing_price");

  // la comandă: termenul nu se inventează; un indiciu din text e doar propunere
  const madeToOrder =
    plan.product.availability === "MADE_TO_ORDER" ||
    Object.entries(decisions).some(([k, d]) => k.endsWith(":availability") && d.value === "MADE_TO_ORDER");
  const ambiguousAvailability = needsConfirmation.some((k) => k === "availability" || k.endsWith(":availability"));
  if (madeToOrder || ambiguousAvailability) {
    decide(
      "leadTimeDays",
      hints.leadTimeDays,
      hints.leadTimeDays ? "proposed" : "unknown",
      hints.leadTimeDays ? "termen găsit în descriere" : "termenul de realizare nu e specificat"
    );
  }

  applyShipping(plan, product);
  return plan;
}

/**
 * Propuneri AI DOAR pentru câmpurile ambigue rămase fără propunere
 * (disponibilitate, termen, categorie). Rezultatul rămâne „proposed” și
 * cere confirmare; AI-ul nu atinge cantități, variante sau prețuri.
 *
 * @param {(input: Object) => Promise<{ availability?: string, leadTimeDays?: number, category?: string }>} suggest
 */
export async function enrichPlanWithAi(plan, product, suggest) {
  const open = plan.needsConfirmation.filter((k) => ["availability", "leadTimeDays", "category"].includes(k) && plan.decisions[k]?.value == null);
  if (!open.length || typeof suggest !== "function") return plan;

  let suggestion = null;
  try {
    suggestion = await suggest({
      fields: open,
      title: product.name,
      description: htmlToText(product.descriptionHtml || product.shortDescriptionHtml).slice(0, 4000),
      categories: product.categories || [],
    });
  } catch (error) {
    console.warn("[integrations] AI suggestion failed:", error?.message || error);
    return plan;
  }

  for (const field of open) {
    let value = suggestion?.[field];
    if (field === "availability" && !["MADE_TO_ORDER", "PREORDER"].includes(value)) value = undefined;
    if (field === "leadTimeDays" && !(Number.isInteger(value) && value > 0 && value <= 120)) value = undefined;
    if (field === "category" && !(typeof value === "string" && value.trim())) value = undefined;
    if (value !== undefined) plan.decisions[field] = { value, certainty: "proposed", reason: "propunere AI - verifică", source: "ai" };
  }
  return plan;
}

/**
 * Aplică răspunsurile vânzătorului. Fiecare cheie din needsConfirmation
 * trebuie să aibă un răspuns explicit (chiar și null pentru categorie).
 * @param {{ isValidCategory?: (key: string) => boolean }} [options]  categoriile platformei
 * @returns planul final, gata de import
 */
export function applyConfirmations(plan, confirmations = {}, { isValidCategory = null } = {}) {
  const missing = plan.needsConfirmation.filter((key) => !Object.prototype.hasOwnProperty.call(confirmations, key));
  if (missing.length) {
    const error = new Error("confirmation_required");
    error.code = "confirmation_required";
    error.missing = missing;
    throw error;
  }
  if (plan.blocked.length) {
    const error = new Error("import_blocked");
    error.code = "import_blocked";
    error.reasons = plan.blocked;
    throw error;
  }

  const final = structuredClone(plan);
  const invalid = (key) => {
    const error = new Error("invalid_confirmation");
    error.code = "invalid_confirmation";
    error.field = key;
    return error;
  };
  const get = (key) => (Object.prototype.hasOwnProperty.call(confirmations, key) ? confirmations[key] : final.decisions[key]?.value);

  if (final.needsConfirmation.includes("availability")) {
    const value = confirmations.availability;
    if (!AVAILABILITIES.has(value)) throw invalid("availability");
    final.product.availability = value;
    final.product.readyQty = value === "SOLD_OUT" ? 0 : value === "READY" ? final.product.readyQty : null;
  }

  for (const variant of [...final.variants]) {
    const key = `variant:${variant.externalVariantId}:availability`;
    if (!final.needsConfirmation.includes(key)) continue;
    const value = confirmations[key];
    if (!AVAILABILITIES.has(value)) throw invalid(key);
    variant.availability = value === "READY" ? null : value;
  }

  for (const key of final.needsConfirmation.filter((k) => /^variant:[^:]+$/.test(k))) {
    // variațiile „oricare valoare” nu se importă automat
    if (confirmations[key] !== "skip") throw invalid(key);
  }
  for (const key of final.needsConfirmation.filter((k) => k.startsWith("axis:"))) {
    if (confirmations[key] !== "stock") throw invalid(key);
  }

  if (final.needsConfirmation.includes("personalization")) {
    const kept = confirmations.personalization;
    const allowed = new Map((final.decisions.personalization?.value || []).map((f) => [f.key, f]));
    if (!Array.isArray(kept) || kept.some((k) => !allowed.has(k))) throw invalid("personalization");
    final.decisions.personalization.value = kept.map((k) => allowed.get(k));
  }
  final.product.customSchema = final.decisions.personalization?.value || [];

  const category = get("category") || null;
  if (category !== null && (typeof category !== "string" || (isValidCategory && !isValidCategory(category)))) throw invalid("category");
  final.product.category = category;

  const needsLeadTime =
    final.product.availability === "MADE_TO_ORDER" || final.variants.some((v) => v.availability === "MADE_TO_ORDER");
  const leadTime = get("leadTimeDays");
  if (needsLeadTime) {
    if (!(Number.isInteger(leadTime) && leadTime > 0 && leadTime <= 365)) throw invalid("leadTimeDays");
    final.product.leadTimeDays = leadTime;
  } else if (Number.isInteger(leadTime) && leadTime > 0) {
    final.product.leadTimeDays = leadTime;
  }

  final.confirmed = true;
  return final;
}
