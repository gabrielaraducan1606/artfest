// src/features/smartListing/SmartListingPreviewEditor.jsx
//
// „Editor avansat” în previzualizarea Smart Listing: ProductModal EXISTENT,
// nemodificat, deschis pentru un cont Admin (care nu are magazin propriu).
// Încărcarea și salvarea primite ca props sunt refuzate local; orice altă scriere
// e oprită de blocarea din smartListingPreview.js. Închiderea nu schimbă nimic.

import { useEffect, useState } from "react";

import { CATEGORIES_DETAILED } from "../../../../backend/src/constants/categories.js";
import ProductModal from "../../pages/Vendor/ProfilMagazin/modals/ProductModal.jsx";
import { advancedEditorDraftKey } from "./smartListingSave.js";
import { PREVIEW_STORE_SLUG, SmartListingPreviewBlocked } from "./smartListingPreview.js";
import styles from "./SmartListing.module.css";

function clearPreviewDraft() {
  try {
    window.localStorage.removeItem(advancedEditorDraftKey(PREVIEW_STORE_SLUG));
  } catch {
    // stocare indisponibilă: nu avem ce curăța
  }
}

const rejectAction = async () => {
  throw new SmartListingPreviewBlocked();
};

export default function SmartListingPreviewEditor({ initialForm, onClose }) {
  const [form, setForm] = useState(() => {
    // ProductModal restaurează ciorna din această cheie: pornim mereu curat
    clearPreviewDraft();
    return initialForm;
  });

  useEffect(() => clearPreviewDraft, []);

  return (
    <>
      <div className={styles.previewPill} role="note">
        Previzualizare Editor avansat · nimic nu se încarcă, nu se analizează și nu se salvează
      </div>
      <ProductModal
        open
        onClose={onClose}
        saving={false}
        editingProduct={null}
        form={form}
        setForm={setForm}
        categories={CATEGORIES_DETAILED}
        onSave={rejectAction}
        uploadFile={rejectAction}
        storeSlug={PREVIEW_STORE_SLUG}
      />
    </>
  );
}
