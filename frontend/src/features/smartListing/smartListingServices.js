// src/features/smartListing/smartListingServices.js
//
// Serviciile REALE folosite de SmartListingPage - toate EXISTENTE în platformă:
//   api            lib/api.js
//   uploadImage    lib/productImages -> POST /api/upload/products (rută de produse:
//                  40 MB după optimizare, conversie HEIC, progres); (file, { onProgress, signal }) -> url
//   prepareImage   lib/productImages/prepareProductImage.js (micșorare / orientare / JPEG)
//   resolveUrl     resolveFileUrl (URL-uri relative -> absolute, pentru AI)
//   gpsr           utils/vendorGpsrManufacturer.js (Vendor.gpsrManufacturer*)
//   onProductSaved evenimentul vendor:productCreated (listele se reîmprospătează)
// Testele pot injecta alte implementări; fluxul real nu conține date demonstrative.

import { api as defaultApi } from "../../lib/api.js";
import { prepareProductImage } from "../../lib/productImages/prepareProductImage.js";
import { uploadProductImage } from "../../lib/productImages/uploadProductImage.js";
import { resolveFileUrl } from "../../pages/Vendor/ProfilMagazin/hooks/useProfilMagazin.js";
import { dispatchProductSaved } from "../../pages/Vendor/ProfilMagazin/utils/productEditing.js";
import {
  cancelEditingVendorGpsr,
  saveVendorGpsrDraftIfNeeded,
  startEditingVendorGpsr,
  updateVendorGpsrDraft,
  useVendorGpsrManufacturer,
  vendorGpsrForCheck,
} from "../../pages/Vendor/ProfilMagazin/utils/vendorGpsrManufacturer.js";

/**
 * Upload prin serviciile curente (reale sau injectate în teste): `uploadImage`
 * poate întoarce URL-ul (string) sau { url }.
 */
export async function uploadWithServices(services, file, ctx = {}) {
  const result = await services.uploadImage(file, ctx);
  return { url: typeof result === "string" ? result : result?.url || "" };
}

function safeStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Serviciile REALE (implicite). */
export function createDefaultServices() {
  return {
    api: defaultApi,
    uploadImage: (file, { onProgress, signal } = {}) =>
      uploadProductImage(file, { onProgress, signal }).then((result) => result.url),
    prepareImage: prepareProductImage,
    resolveUrl: resolveFileUrl,
    gpsr: {
      useState: useVendorGpsrManufacturer,
      startEditing: startEditingVendorGpsr,
      updateDraft: updateVendorGpsrDraft,
      cancelEditing: cancelEditingVendorGpsr,
      saveIfNeeded: saveVendorGpsrDraftIfNeeded,
      forCheck: vendorGpsrForCheck,
    },
    storage: safeStorage(),
    onProductSaved: (saved) => dispatchProductSaved(saved, { isEdit: false }),
  };
}

