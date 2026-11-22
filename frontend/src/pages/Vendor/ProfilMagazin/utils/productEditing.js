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
import { uploadProductImageWithRetry } from "../../../../lib/productImages/uploadProductImage.js";
import { buildProductPayload } from "./productPayload";
import { extractCode, extractHttpStatus } from "./activationErrors";
import { showContactInfoFix } from "../../../../components/AIAssistant/contactInfo/contactInfoFixToast.jsx";
import { PRODUCT_SAVED_IN_REVIEW, isModerationQueued, productSaveErrorText } from "../../../../lib/productCreateRequest.js";

export { productFormFromApi } from "./productFormFromApi.js";

export async function fetchVendorProduct(id) {
  return api(`/api/vendors/products/${encodeURIComponent(id)}`, { method: "GET" });
}

/*
 * Upload-ul unei fotografii de produs (ProductModal, Modificări cerute):
 * ruta de PRODUSE (/api/upload/products - 40 MB după optimizare, conversie HEIC), cu
 * reîncercări automate. Înainte: /api/upload (avatar, 10 MB) și, la eroare,
 * întorcea `undefined` în loc să arunce - fotografia „dispărea” din formular.
 */
export function uploadProductFile(file) {
  return uploadProductImageWithRetry(file);
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
  } else if (isModerationQueued(saved)) {
    // verificarea AI rulează după răspuns: produsul NU e încă public
    alert(`${PRODUCT_SAVED_IN_REVIEW}
Îl publicăm după verificare; starea apare pe cardul produsului.`);
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

export function handleProductSaveError(er, { navigate, creating = false } = {}) {
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

  // eroare fără răspuns HTTP aruncată local (ex. „Slug lipsă”): mesajul ei e deja pentru vânzător
  if (!status && er?.message && !/fetch|network|load failed|abort/i.test(er.message)) {
    alert(er.message);
    return;
  }

  // validare / fotografii / fără confirmare / eroare de server - mesaj clar + cod de diagnostic
  alert(productSaveErrorText(er, { creating }));
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
