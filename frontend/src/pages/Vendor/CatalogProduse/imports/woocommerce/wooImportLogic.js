// src/pages/Vendor/CatalogProduse/imports/woocommerce/wooImportLogic.js
//
// Logica (fără React) a importului WooCommerce din Catalog -> Importuri:
// etichete, rezumatul produselor din planul backend-ului, confirmările
// obligatorii, importul pe loturi și mesajele de eroare. Planul vine din
// GET /api/vendor/integrations/connections/:id/products; backend-ul
// recitește oricum produsul și validează confirmările la import.

export const IMPORT_BATCH_SIZE = 10; // limita backend-ului pe cerere

export const AVAILABILITY_OPTIONS = [
  { value: "READY", label: "Gata de livrare", hint: "Produsul există în stoc." },
  { value: "MADE_TO_ORDER", label: "Realizat la comandă", hint: "Îl lucrezi după ce primești comanda." },
  { value: "PREORDER", label: "Precomandă", hint: "Va fi disponibil de la o dată viitoare." },
  { value: "SOLD_OUT", label: "Epuizat", hint: "Nu se poate comanda momentan." },
];

const AVAILABILITY_LABELS = Object.fromEntries(AVAILABILITY_OPTIONS.map((o) => [o.value, o.label]));

export function availabilityLabel(value) {
  return AVAILABILITY_LABELS[value] || "De confirmat";
}

export function formatPrice(cents) {
  if (!Number.isFinite(cents)) return "—";
  return `${new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)} lei`;
}

const BLOCKED_LABELS = {
  missing_title: "Produsul nu are titlu.",
  missing_price: "Produsul nu are preț în magazin.",
  currency_not_ron: "Magazinul folosește altă monedă decât RON.",
  unsupported_product_type: "Tipul acestui produs nu poate fi importat (doar produse simple sau cu variante).",
  variable_without_variation_attributes: "Produsul are variante, dar fără atribute de variație.",
  no_importable_variations: "Nicio variantă nu poate fi importată automat.",
};

export function blockedLabel(reason) {
  return BLOCKED_LABELS[reason] || "Produsul nu poate fi importat.";
}

const WARNING_LABELS = {
  images_truncated: "Se importă primele 10 imagini.",
  unsupported_addons: "Unele opțiuni suplimentare din magazin nu pot fi preluate; le poți configura după import.",
  store_sale_price_not_imported: "Prețul redus din magazin nu se preia; folosește promoțiile Artfest.",
  backorders_beyond_stock_not_supported: "Comenzile peste stoc (backorders) nu sunt preluate.",
  shipping_weight_missing:
    "Produsul nu are greutate în magazin. Se importă fără; până completezi greutatea coletului în Artfest, transportul se calculează cu tariful de rezervă al magazinului.",
  shipping_weight_unit_unknown:
    "Nu am putut citi unitatea de greutate a magazinului, așa că greutatea nu se preia. Completeaz-o în Artfest după import.",
  shipping_weight_invalid: "Greutatea din magazin nu e validă (lipsă, zero sau peste 100 kg), așa că nu se preia.",
  shipping_dimensions_incomplete: "Magazinul are doar o parte din dimensiunile coletului; nu se preiau (Artfest cere toate trei sau niciuna).",
  shipping_dimension_unit_unknown: "Nu am putut citi unitatea de dimensiuni a magazinului, așa că dimensiunile nu se preiau.",
  shipping_dimensions_invalid: "Dimensiunile din magazin nu sunt valide (peste 300 cm sau nenumerice), așa că nu se preiau.",
};

const formatGrams = (grams) => `${new Intl.NumberFormat("ro-RO").format(grams)} g`;

export function warningLabel(code, plan = null) {
  if (code.startsWith("duplicate_combination:")) return "O variantă duplicată din magazin a fost ignorată.";
  if (code.startsWith("parent_stock_not_managed:")) return "O variantă folosește stocul produsului, dar acesta nu e urmărit în magazin.";
  if (code.startsWith("variant_sale_price_not_imported:")) {
    const id = code.slice(code.indexOf(":") + 1);
    const variant = (plan?.variants || []).find((v) => v.externalVariantId === id);
    if (!variant) return "Prețul redus al unei variante nu se preia; se importă prețul normal. Folosește promoțiile Artfest.";
    return `Varianta „${variant.label}”: prețul redus din magazin (${formatPrice(variant.storeSalePriceCents)}) nu se preia; se importă prețul normal (${formatPrice(variantPriceCents(plan, variant))}). Folosește promoțiile Artfest.`;
  }
  if (code.startsWith("duplicate_variant_sku:")) {
    const sku = code.slice(code.indexOf(":") + 1);
    return `SKU-ul „${sku}” apare la mai multe variante în magazin; nu e preluat pe variante (asocierea se face după ID-ul variantei).`;
  }
  if (code === "shipping_weight_only_on_variants") {
    const heaviest = plan?.shipping?.heaviestVariantGrams;
    return `Greutatea e completată doar pe variante${Number.isFinite(heaviest) ? ` (cea mai grea: ${formatGrams(heaviest)})` : ""}, nu pe produs. Nu o alegem automat: completează greutatea coletului în Artfest după import; până atunci se folosește tariful de rezervă.`;
  }
  if (code === "shipping_weight_varies_by_variant") {
    const weight = plan?.shipping?.weightGrams;
    const heaviest = plan?.shipping?.heaviestVariantGrams;
    return `Variantele au greutăți diferite în magazin, dar Artfest folosește o singură greutate pe produs${Number.isFinite(weight) ? ` (${formatGrams(weight)})` : ""}.${Number.isFinite(heaviest) && heaviest > weight ? ` Cea mai grea variantă are ${formatGrams(heaviest)}; actualizează greutatea după import dacă e cazul.` : ""}`;
  }
  return WARNING_LABELS[code] || null;
}

/**
 * Coletul din previzualizare: valorile Artfest (g / cm) și, când magazinul
 * folosește alte unități, valorile originale.
 */
export function shippingSummary(plan) {
  const s = plan?.shipping;
  if (!s) return { label: "Fără greutate colet", sourceLabel: null };
  const dims = Number.isFinite(s.lengthCm) ? ` · ${s.lengthCm} × ${s.widthCm} × ${s.heightCm} cm` : "";
  const label = Number.isFinite(s.weightGrams) ? `Colet ${formatGrams(s.weightGrams)}${dims}` : `Fără greutate colet${dims}`;

  const src = s.source || {};
  const parts = [];
  if (Number.isFinite(s.weightGrams) && src.weightUnit !== "g") parts.push(`${src.weight} ${src.weightUnit}`);
  if (dims && src.dimensionUnit !== "cm") parts.push(`${src.length} × ${src.width} × ${src.height} ${src.dimensionUnit}`);
  return { label, sourceLabel: parts.length ? `În magazin: ${parts.join(" · ")}` : null };
}

/* ===================== rezumatul unui produs ===================== */

const combinationKey = (selections) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(selections || {})
        .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    )
  );

function variantPriceCents(plan, variant) {
  const overrides = (plan.product.optionsSchema || []).flatMap((f) => f?.combinationPriceOverrides || []);
  const match = overrides.find((o) => combinationKey(o.selections) === combinationKey(variant.selections));
  return match ? match.priceCents : plan.product.priceCents;
}

function variantStockLabel(variant) {
  if (variant.availability === "SOLD_OUT") return "Epuizat";
  if (variant.availability) return availabilityLabel(variant.availability);
  if (variant.stockMode === "OWN") return variant.stockQty > 0 ? `${variant.stockQty} buc.` : "Epuizat";
  if (variant.stockMode === "PRODUCT_POOL") return "Stoc comun";
  return "În stoc";
}

/**
 * Ce afișăm pentru un produs din previzualizare.
 * @param {Object} item  { title, type, sku, image, alreadyImported, plan }
 */
export function productSummary(item) {
  const plan = item.plan;
  const p = plan.product;
  const isVariable = p.stockScope === "VARIANT";

  const variants = (plan.variants || []).map((v) => ({
    id: v.externalVariantId,
    label: v.label || Object.values(v.selections || {}).join(" / "),
    sku: v.sku || null,
    priceLabel: formatPrice(variantPriceCents(plan, v)),
    stockLabel: variantStockLabel(v),
  }));

  const prices = (plan.variants || []).map((v) => variantPriceCents(plan, v)).filter(Number.isFinite);
  const priceLabel =
    isVariable && prices.length && Math.max(...prices) !== Math.min(...prices)
      ? `de la ${formatPrice(Math.min(...prices))}`
      : formatPrice(p.priceCents);

  let stockLabel;
  if (isVariable) {
    const own = (plan.variants || []).filter((v) => v.stockMode === "OWN").reduce((sum, v) => sum + (v.stockQty || 0), 0);
    const total = own + (p.variantPoolQty || 0);
    stockLabel = `${total} buc. în ${variants.length} ${variants.length === 1 ? "variantă" : "variante"}`;
  } else if (p.availability === "READY") {
    stockLabel = Number.isFinite(p.readyQty) ? `${p.readyQty} buc.` : "În stoc (cantitate neurmărită)";
  } else {
    stockLabel = availabilityLabel(p.availability);
  }

  const certainAvailability = plan.decisions?.availability?.certainty === "certain";
  const shipping = shippingSummary(plan);

  return {
    priceLabel,
    stockLabel,
    availabilityLabel: isVariable ? "Pe variante" : certainAvailability ? availabilityLabel(p.availability) : "De confirmat",
    isVariable,
    shippingLabel: shipping.label,
    shippingSourceLabel: shipping.sourceLabel,
    variants,
    blocked: (plan.blocked || []).map(blockedLabel),
    warnings: (plan.warnings || []).map((code) => warningLabel(code, plan)).filter(Boolean),
    needsConfirmation: (plan.needsConfirmation || []).length > 0,
    imported: Boolean(item.alreadyImported),
    importable: !item.alreadyImported && !(plan.blocked || []).length,
  };
}

/* ===================== confirmări ===================== */

/**
 * Câmpurile pe care vânzătorul trebuie să le confirme, în ordine, cu
 * propunerea (dacă există) - fără să o aleagă automat.
 */
export function confirmationFields(plan) {
  const decisions = plan.decisions || {};
  return (plan.needsConfirmation || []).map((key) => {
    const decision = decisions[key] || {};
    const base = { key, proposal: decision.value ?? null, reason: decision.reason || null, source: decision.source || null };
    if (key === "category") return { ...base, kind: "category", label: "Categoria Artfest" };
    if (key === "availability") return { ...base, kind: "availability", label: "Disponibilitate" };
    if (key === "leadTimeDays") return { ...base, kind: "leadTimeDays", label: "Termen de execuție (zile)" };
    if (key === "personalization") {
      return { ...base, kind: "personalization", label: "Personalizări", fields: Array.isArray(decision.value) ? decision.value : [] };
    }
    if (key.startsWith("axis:")) return { ...base, kind: "axisStock", label: `Opțiunea „${key.slice(5)}”` };
    if (/^variant:[^:]+:availability$/.test(key)) {
      const id = key.split(":")[1];
      const variant = (plan.variants || []).find((v) => v.externalVariantId === id);
      return { ...base, kind: "variantAvailability", label: `Disponibilitate - varianta ${variant?.label || id}` };
    }
    if (/^variant:[^:]+$/.test(key)) return { ...base, kind: "variantSkip", label: `Varianta #${key.slice(8)}` };
    return { ...base, kind: "unknown", label: key };
  });
}

/** Termenul de execuție e obligatoriu când produsul sau o variantă e „realizat la comandă”. */
export function leadTimeRequired(plan, answers = {}) {
  // ca applyConfirmations: răspunsul vânzătorului înlocuiește valoarea doar unde a fost cerut
  const asked = new Set(plan.needsConfirmation || []);
  const productAvailability = asked.has("availability") ? answers.availability : plan.product?.availability;
  const variantAvailability = (plan.variants || []).map((v) => {
    const key = `variant:${v.externalVariantId}:availability`;
    return asked.has(key) ? answers[key] : v.availability;
  });
  return [productAvailability, ...variantAvailability].includes("MADE_TO_ORDER");
}

function isAnswered(field, value, plan, answers) {
  switch (field.kind) {
    case "category":
      // în interfață categoria e obligatorie (backend-ul ar accepta și null)
      return typeof value === "string" && value.length > 0;
    case "availability":
    case "variantAvailability":
      return Boolean(AVAILABILITY_LABELS[value]);
    case "leadTimeDays":
      if (!leadTimeRequired(plan, answers)) return value === undefined || value === null || (Number.isInteger(value) && value > 0);
      return Number.isInteger(value) && value > 0 && value <= 365;
    case "personalization":
      return Array.isArray(value);
    case "variantSkip":
      return value === "skip";
    case "axisStock":
      return value === "stock";
    default:
      return false;
  }
}

/** Cheile încă fără un răspuns valid (importul e blocat cât timp există). */
export function missingConfirmations(plan, answers = {}) {
  return confirmationFields(plan)
    .filter((field) => {
      if (field.kind === "leadTimeDays" && !leadTimeRequired(plan, answers)) return false;
      return !(field.key in answers) || !isAnswered(field, answers[field.key], plan, answers);
    })
    .map((field) => field.key);
}

/** Confirmările trimise backend-ului (doar cheile cerute). */
export function buildConfirmations(plan, answers = {}) {
  const out = {};
  for (const field of confirmationFields(plan)) {
    if (field.kind === "leadTimeDays") {
      out[field.key] = leadTimeRequired(plan, answers) ? answers[field.key] : Number.isInteger(answers[field.key]) ? answers[field.key] : null;
    } else {
      out[field.key] = answers[field.key];
    }
  }
  return out;
}

/* ===================== import pe loturi ===================== */

export function chunk(items, size = IMPORT_BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Importă selecția în loturi de IMPORT_BATCH_SIZE, unul după altul.
 * Un lot eșuat (rețea / server) nu oprește restul; produsele lui sunt
 * raportate ca eșuate. Fără dubluri: fiecare produs apare o singură dată.
 *
 * @param {{ externalProductId: string, confirmations: Object }[]} items
 * @param {(batch) => Promise<{ results: Object[] }>} send  POST /import
 * @param {(progress: { done: number, total: number, batch: number, batches: number }) => void} [onProgress]
 */
export async function importInBatches(items, send, onProgress = () => {}) {
  const unique = [...new Map(items.map((item) => [item.externalProductId, item])).values()];
  const batches = chunk(unique);
  const results = [];

  for (const [index, batch] of batches.entries()) {
    onProgress({ done: results.length, total: unique.length, batch: index + 1, batches: batches.length });
    try {
      const response = await send(batch);
      const byId = new Map((response?.results || []).filter(Boolean).map((r) => [r.externalProductId, r]));
      for (const item of batch) results.push(byId.get(item.externalProductId) || { externalProductId: item.externalProductId, status: "failed", code: "no_result" });
    } catch (error) {
      for (const item of batch) results.push({ externalProductId: item.externalProductId, status: "failed", code: error?.code || "request_failed" });
    }
  }
  onProgress({ done: results.length, total: unique.length, batch: batches.length, batches: batches.length });

  const count = (status) => results.filter((r) => r.status === status).length;
  return {
    results,
    imported: count("imported"),
    duplicate: count("duplicate"),
    failed: results.length - count("imported") - count("duplicate"),
  };
}

/* ===================== mesaje de eroare ===================== */

const ERROR_MESSAGES = {
  woocommerce_unauthorized:
    "WooCommerce a respins cheile. Verifică dacă ai copiat corect Consumer Key și Consumer Secret, fără spații, și dacă cheia nu a fost revocată.",
  woocommerce_forbidden:
    "Cheile nu au permisiunile necesare. Creează cheia cu permisiunea „Read/Write” (Citire/Scriere).",
  woocommerce_unreachable: "Magazinul nu răspunde. Verifică adresa și dacă site-ul este online, apoi încearcă din nou.",
  woocommerce_api_unavailable:
    "Adresa nu a răspuns ca un magazin WooCommerce. Verifică adresa și ca în WordPress, la Setări → Legături permanente, să nu fie aleasă opțiunea „Simplu”.",
  woocommerce_error: "Magazinul WooCommerce a răspuns cu o eroare. Încearcă din nou peste câteva minute.",
  woocommerce_not_found: "Produsul nu mai există în magazinul WooCommerce.",
  insecure_shop_url: "Adresa magazinului trebuie să înceapă cu https://.",
  invalid_shop_url: "Adresa magazinului nu este validă. Exemplu: https://magazinul-meu.ro",
  invalid_credentials_format: "Consumer Key trebuie să înceapă cu ck_, iar Consumer Secret cu cs_.",
  shop_already_connected: "Acest magazin este deja conectat la Artfest.",
  integration_encryption_unavailable: "Conectarea magazinelor nu este încă disponibilă pe server.",
  connection_disconnected: "Magazinul este deconectat. Conectează-l din nou.",
  connection_not_found: "Conexiunea nu a fost găsită.",
  images_copy_failed: "Imaginile produsului nu au putut fi copiate. Încearcă din nou mai târziu.",
  service_not_found: "Magazinul Artfest ales nu a fost găsit.",
  confirmation_required: "Lipsesc confirmări obligatorii.",
  invalid_confirmation: "O confirmare nu este validă.",
  import_blocked: "Produsul nu poate fi importat.",
  content_sync_unavailable: "Sincronizarea conținutului nu este încă disponibilă.",
  request_failed: "Cererea nu a putut fi trimisă. Verifică conexiunea la internet.",
  not_found: "Integrarea cu magazine externe nu este activă.",
};

export function errorMessage(code, fallback) {
  return ERROR_MESSAGES[code] || fallback || "A apărut o eroare. Încearcă din nou.";
}

/* ===================== starea conexiunii ===================== */

// „Conectat”, nu „sincronizare activă”: sincronizarea automată nu e încă pornită
export function connectionStatus(connection) {
  if (connection.status === "ERROR") return { tone: "error", label: "Eroare de conexiune" };
  if (connection.status === "DISCONNECTED") return { tone: "muted", label: "Deconectat" };
  if (connection.isPaused) return { tone: "warning", label: "Sincronizare în pauză" };
  if (connection.status === "ACTIVE") return { tone: "success", label: "Conectat" };
  return { tone: "muted", label: "În verificare" };
}
