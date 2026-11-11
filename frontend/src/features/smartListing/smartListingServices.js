// src/features/smartListing/smartListingServices.js
//
// Serviciile REALE folosite de SmartListingPage - toate EXISTENTE în platformă:
//   api            lib/api.js
//   uploadImage    lib/uploadFile.js -> POST /api/upload (ca editorul actual)
//   compressImage  aceeași comprimare ca editorul actual (smartListingMedia.js)
//   resolveUrl     resolveFileUrl (URL-uri relative -> absolute, pentru AI)
//   gpsr           utils/vendorGpsrManufacturer.js (Vendor.gpsrManufacturer*)
//   onProductSaved evenimentul vendor:productCreated (listele se reîmprospătează)
// Testele pot injecta alte implementări; fluxul real nu conține date demonstrative.

import { api as defaultApi } from "../../lib/api.js";
import { uploadFile } from "../../lib/uploadFile.js";
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
import { compressImageForUpload } from "./smartListingMedia.js";

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
    uploadImage: (file) => uploadFile(file, "/api/upload"),
    compressImage: compressImageForUpload,
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

