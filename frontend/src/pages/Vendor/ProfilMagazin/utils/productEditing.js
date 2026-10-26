// src/pages/Vendor/ProfilMagazin/utils/productEditing.js

/*
 * Bucățile editorului de produs Vendor care NU țin de pagina
 * ProfilMagazin - mutate aici (nu copiate) ca să le folosească și pagina
 * „Modificări solicitate” (/vendor/products/:id/modificari), cu același
 * ProductModal + useProductEditorController:
 *   - productFormFromApi: produsul din GET /api/vendors/products/:id ->
 *     formularul editorului (fost corp al openEditProduct);
 *   - uploadProductFile: upload-ul de imagini (fost inline în StoreModals);
 *   - updateVendorProduct: PUT-ul de salvare la editare (backend-ul
 *     verifică proprietarul - 403 pentru alt vendor);
 *   - showProductSaveReport / handleProductSaveError: mesajele de după
 *     salvare și tratarea erorilor (date de contact, abonament);
 *   - applyContactFixToProductForm: „Aplică varianta propusă” din
 *     Asistent în formularul deschis.
 */

import { api } from "../../../../lib/api";
import { buildProductPayload } from "./productPayload";
import { extractCode, extractHttpStatus } from "./activationErrors";
import { showContactInfoFix } from "../../../../components/AIAssistant/contactInfo/contactInfoFixToast.jsx";

export function productFormFromApi(full) {
  return {
    id: full.id || full._id || "",
    title: full.title || "",
    description: full.description || "",
    price:
      typeof full.price === "number"
        ? full.price
        : Number.isFinite(full.priceCents)
        ? full.priceCents / 100
        : 0,
    images: Array.isArray(full.images) ? full.images : [],
    videoUrl: full.videoUrl || null,
    videoMuted: !!full.videoMuted,
    category: full.category || "",
    // absent în API => absent în formular (backend-ul păstrează lista)
    ...(Array.isArray(full.additionalCategories)
      ? { additionalCategories: full.additionalCategories }
      : {}),
    aiSuggestedCategory: "",
    aiSuggestedAdditionalCategories: [],
    currency: full.currency || "RON",
    isActive: full.isActive !== false,
    availability: (full.availability || "READY").toUpperCase(),
    leadTimeDays: Number.isFinite(Number(full.leadTimeDays))
      ? String(Number(full.leadTimeDays))
      : "",
    readyQty:
      full.readyQty === null || full.readyQty === undefined
        ? ""
        : Number.isFinite(Number(full.readyQty))
        ? String(Number(full.readyQty))
        : "",
    nextShipDate: full.nextShipDate
      ? String(full.nextShipDate).slice(0, 10)
      : "",
    acceptsCustom: !!full.acceptsCustom,
    isHidden: !!full.isHidden,
    color: full.color || "",
    materialMain: full.materialMain || "",
    technique: full.technique || "",
    styleTags: Array.isArray(full.styleTags)
      ? full.styleTags.join(", ")
      : full.styleTags || "",
    occasionTags: Array.isArray(full.occasionTags)
      ? full.occasionTags.join(", ")
      : full.occasionTags || "",
    dimensions: full.dimensions || "",
    careInstructions: full.careInstructions || "",
    specialNotes: full.specialNotes || "",

    isOwnManufacturer:
      full.isOwnManufacturer === true || full.isOwnManufacturer === false
        ? full.isOwnManufacturer
        : null,
    manufacturerName: full.manufacturerName || "",
    manufacturerAddress: full.manufacturerAddress || "",
    manufacturerEmail: full.manufacturerEmail || "",
    manufacturerInEU:
      full.manufacturerInEU === true || full.manufacturerInEU === false
        ? full.manufacturerInEU
        : null,
    responsiblePersonName: full.responsiblePersonName || "",
    responsiblePersonAddress: full.responsiblePersonAddress || "",
    responsiblePersonEmail: full.responsiblePersonEmail || "",
    safetyWarnings:
      full.safetyWarnings === null || full.safetyWarnings === undefined
        ? null
        : full.safetyWarnings,
    isForChildren:
      full.isForChildren === true || full.isForChildren === false
        ? full.isForChildren
        : null,

    orderMode: full.orderMode || "READY_TO_BUY",

    optionsSchema: Array.isArray(full.optionsSchema) ? full.optionsSchema : [],
    customSchema: Array.isArray(full.customSchema) ? full.customSchema : [],
    repeatedGroups: Array.isArray(full.repeatedGroups) ? full.repeatedGroups : [],
    quoteSchema: Array.isArray(full.quoteSchema) ? full.quoteSchema : [],
  };
}

export async function fetchVendorProduct(id) {
  return api(`/api/vendors/products/${encodeURIComponent(id)}`, { method: "GET" });
}

export async function uploadProductFile(file) {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: fd,
  });

  const { url } = await res.json();
  return url;
}

export async function updateVendorProduct(id, form) {
  return api(`/api/vendors/products/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: buildProductPayload(form),
  });
}

export function dispatchProductSaved(saved, { isEdit, shopId = null }) {
  try {
    window.dispatchEvent(
      new CustomEvent(isEdit ? "vendor:productUpdated" : "vendor:productCreated", {
        detail: {
          product: saved,
          shopId,
          storeId: shopId,
          vendorStoreId: shopId,
        },
      })
    );
  } catch {
    // noop
  }
}

/*
 * Verificarea automată a blocat publicarea (ex. telefon/link/QR
 * într-o imagine) -> vendorul află imediat ce imagine și ce are de
 * corectat. Produsul e salvat; după înlocuirea imaginii se
 * reverifică automat. „Verificare suplimentară" nu declanșează
 * nicio alertă (apare discret pe cardul produsului).
 */
export function showProductSaveReport(saved) {
  const report = saved?.moderationReport;

  if (report?.decision === "BLOCK_PUBLICATION") {
    alert(
      [
        report.message,
        "",
        ...(report.images || []).map(
          (image) => `Imaginea ${image.position}: ${(image.messages || []).join(" ")}`
        ),
      ].join("\n")
    );
  } else if (report?.action === "COMPLETE_GPSR") {
    // acționabil, nu alarmant: vendorul poate rezolva imediat, din
    // butonul „Completează informațiile de siguranță” de pe produs
    alert(
      [
        report.message,
        "",
        "Mai lipsesc:",
        ...(report.missing || []).map((item) => `• ${item}`),
      ].join("\n")
    );
  }
}

export function handleProductSaveError(er, { navigate } = {}) {
  // date de contact externe -> nimic salvat; formularul rămâne
  // deschis, cu mesaj + „Corectează cu ajutorul asistentului”
  if (showContactInfoFix(er)) return;

  const status = extractHttpStatus(er);
  const code = extractCode(er);

  if (status === 402 || code === "upgrade_required") {
    alert(
      "Ai atins limita de produse pentru abonamentul curent. Upgradează planul ca să adaugi mai multe produse."
    );
    navigate?.("/setari?tab=subscription");
    return;
  }

  alert(er?.message || "Nu am putut salva produsul.");
}

/*
 * „Aplică varianta propusă” (CONTACT_FIX_APPLY_EVENT) pentru un produs:
 * textul corectat intră înapoi în formularul deschis al ACELUIAȘI produs.
 * Întoarce true dacă evenimentul era pentru un produs.
 */
export function applyContactFixToProductForm(detail, { open, editingId, setForm }) {
  if (detail?.entityType !== "PRODUCT") return false;
  if (!open) return true;

  const sameProduct = !detail.entityId || String(detail.entityId) === String(editingId);

  if (sameProduct && detail.field) {
    setForm((form) => ({ ...form, [detail.field]: detail.text }));
  }

  return true;
}
