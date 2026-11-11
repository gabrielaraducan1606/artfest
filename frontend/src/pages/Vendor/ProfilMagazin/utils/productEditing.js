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

export { productFormFromApi } from "./productFormFromApi.js";

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
