// Logica pură a editorului de produs din Admin (AdminProductEditModal.jsx).
//
// Formularul are EXACT forma celui de Vendor (useProfilMagazin / ProfilMagazin
// openEdit), ca să poată reutiliza ProductDetailsSection și
// ProductOrderModeSection. La salvare trimitem DOAR câmpurile schimbate față
// de produsul încărcat - editarea titlului nu atinge variantele, imaginile,
// stocul sau modul de comandă.

import { normalizeAdditionalCategoryKeys } from "../../../../utils/additionalCategories.js";

const GPSR_KEYS = [
  "isOwnManufacturer",
  "manufacturerName",
  "manufacturerAddress",
  "manufacturerEmail",
  "manufacturerInEU",
  "responsiblePersonName",
  "responsiblePersonAddress",
  "responsiblePersonEmail",
  "safetyWarnings",
  "isForChildren",
];

// Câmpurile pe care editorul Admin le poate trimite. NU sunt trimise
// niciodată: prețul / moneda (gestionate de vânzător - doar afișate),
// imaginile / video (needitate aici).
export const ADMIN_EDITABLE_KEYS = [
  "title",
  "description",
  "category",
  "additionalCategories",
  "color",
  "materialMain",
  "technique",
  "styleTags",
  "occasionTags",
  "dimensions",
  "careInstructions",
  "specialNotes",
  "isActive",
  "isHidden",
  "orderMode",
  "optionsSchema",
  "customSchema",
  "repeatedGroups",
  "quoteSchema",
  "availability",
  "readyQty",
  "leadTimeDays",
  "nextShipDate",
  ...GPSR_KEYS,
];

const asArray = (value) => (Array.isArray(value) ? value : []);

const joinTags = (value) =>
  Array.isArray(value) ? value.join(", ") : value ? String(value) : "";

const nullableBool = (value) => (value === true || value === false ? value : null);

const numberOrEmpty = (value) =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? ""
    : Number(value);

// enum real (DIRECT/OPTIONS/QUOTE_ONLY) -> valorile din UI-ul Vendor
export function toUiOrderMode(value) {
  const mode = String(value || "").toUpperCase();
  if (mode === "OPTIONS" || mode === "CUSTOMIZABLE") return "OPTIONS";
  if (mode === "QUOTE_ONLY") return "QUOTE_ONLY";
  return "READY_TO_BUY";
}

// UI -> enum real (backendul Admin normalizează oricum și el)
export function toApiOrderMode(value) {
  const mode = String(value || "").toUpperCase();
  if (mode === "OPTIONS" || mode === "CUSTOMIZABLE") return "OPTIONS";
  if (mode === "QUOTE_ONLY") return "QUOTE_ONLY";
  return "DIRECT";
}

/*
 * Link-ul către pagina publică reală (ruta /produs/:id din App.jsx) +
 * motivul pentru care un client NU ar vedea-o. Aceleași condiții ca
 * GET /api/public/products/:id (publicProductRoutes.js): produs activ,
 * neascuns, APPROVED; magazin activ (ACTIVE); vendor activ.
 * Se bazează pe starea SALVATĂ a produsului, nu pe formular.
 */
export function getAdminPublicProductLink(product) {
  const id = String(product?.id || "").trim();
  if (!id) {
    return { href: null, reason: "Produsul nu are un identificator valid." };
  }

  const href = `/produs/${encodeURIComponent(id)}`;
  const service = product.service || {};

  let reason = "";
  if (product.isActive === false) reason = "Produsul este inactiv.";
  else if (product.isHidden === true) reason = "Produsul este ascuns.";
  else if (product.moderationStatus && product.moderationStatus !== "APPROVED") {
    reason = "Produsul nu este aprobat la moderare.";
  } else if (service.isActive === false || (service.status && service.status !== "ACTIVE")) {
    reason = "Magazinul nu este activ.";
  } else if (product.vendor?.isActive === false) reason = "Vendorul nu este activ.";

  return reason ? { href: null, reason: `${reason} Clienții nu pot vedea pagina publică.` } : { href, reason: "" };
}

/*
 * Produsul COMPLET (GET /api/admin/products/:id) -> formular.
 * Schemele sunt păstrate exact cum sunt salvate (fără normalizare -
 * `required` lipsă rămâne lipsă, nu devine false).
 */
export function productToAdminForm(product) {
  const p = product || {};

  const form = {
    title: p.title || "",
    description: p.description || "",
    price:
      p.price !== undefined && p.price !== null
        ? Number(p.price)
        : Number(p.priceCents || 0) / 100,
    category: p.category || "",
    images: asArray(p.images),

    color: p.color || "",
    materialMain: p.materialMain || "",
    technique: p.technique || "",
    styleTags: joinTags(p.styleTags),
    occasionTags: joinTags(p.occasionTags),
    dimensions: p.dimensions || "",
    careInstructions: p.careInstructions || "",
    specialNotes: p.specialNotes || "",

    isActive: p.isActive !== false,
    isHidden: p.isHidden === true,
    acceptsCustom: p.acceptsCustom === true,

    orderMode: toUiOrderMode(p.orderMode),
    optionsSchema: asArray(p.optionsSchema),
    customSchema: asArray(p.customSchema),
    repeatedGroups: asArray(p.repeatedGroups),
    quoteSchema: asArray(p.quoteSchema),

    availability: p.availability || "READY",
    readyQty: numberOrEmpty(p.readyQty),
    leadTimeDays: numberOrEmpty(p.leadTimeDays),
    nextShipDate: p.nextShipDate ? String(p.nextShipDate).slice(0, 10) : "",

    isOwnManufacturer: nullableBool(p.isOwnManufacturer),
    manufacturerName: p.manufacturerName || "",
    manufacturerAddress: p.manufacturerAddress || "",
    manufacturerEmail: p.manufacturerEmail || "",
    manufacturerInEU: nullableBool(p.manufacturerInEU),
    responsiblePersonName: p.responsiblePersonName || "",
    responsiblePersonAddress: p.responsiblePersonAddress || "",
    responsiblePersonEmail: p.responsiblePersonEmail || "",
    safetyWarnings:
      p.safetyWarnings === null || p.safetyWarnings === undefined ? null : p.safetyWarnings,
    isForChildren: nullableBool(p.isForChildren),
  };

  // doar dacă API-ul a trimis lista (altfel nu o atingem la salvare)
  if (Array.isArray(p.additionalCategories)) {
    form.additionalCategories = normalizeAdditionalCategoryKeys(
      p.additionalCategories,
      p.category
    );
  }

  return form;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function serialize(key, value) {
  if (key === "orderMode") return toApiOrderMode(value);
  if (key === "readyQty" || key === "leadTimeDays") {
    return value === "" || value === null || value === undefined ? null : Number(value);
  }
  if (key === "nextShipDate") return value || null;
  return value;
}

/*
 * Payload PATCH = doar câmpurile schimbate față de `initial`
 * (formularul construit din produsul încărcat).
 */
export function buildAdminProductPatch(initial, form) {
  const payload = {};

  for (const key of ADMIN_EDITABLE_KEYS) {
    if (!(key in form)) continue;
    if (key === "additionalCategories" && !("additionalCategories" in initial)) continue;
    if (same(initial[key], form[key])) continue;
    payload[key] = serialize(key, form[key]);
  }

  return payload;
}

/*
 * Validări minime înainte de trimitere - aceleași reguli ca editorul
 * Vendor (useProfilMagazin.onSaveProduct), aplicate pe starea finală.
 * Întoarce mesajul de eroare sau "".
 */
export function validateAdminProductForm(form, payload) {
  if ("title" in payload && !String(form.title || "").trim()) {
    return "Titlul nu poate fi gol.";
  }

  if (
    toApiOrderMode(form.orderMode) === "OPTIONS" &&
    !asArray(form.optionsSchema).length &&
    !asArray(form.customSchema).length
  ) {
    return "Adaugă cel puțin o variantă sau un câmp de personalizare.";
  }

  if (
    form.availability === "MADE_TO_ORDER" &&
    ("leadTimeDays" in payload || "availability" in payload) &&
    !(Number(form.leadTimeDays) > 0)
  ) {
    return "Completează timpul estimat de realizare.";
  }

  if (form.availability === "PREORDER" && "availability" in payload && !form.nextShipDate) {
    return "Selectează data estimată pentru precomandă.";
  }

  return "";
}
