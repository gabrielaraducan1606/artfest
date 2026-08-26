// src/pages/Vendor/CostsProfit/components/PhotoCostingModal.jsx

import { useState } from "react";

import PhotoCostingDraftEditor from "./PhotoCostingDraftEditor.jsx";

import {
  fetchProductCosting,
  saveProductCosting,
  costingToCostDraftShape,
} from "../productCostingApi.js";

/**
 * Modal complet (overlay + chrome) pentru pagina de detaliu
 * costing. Logica de upload/analiză/validare a componentelor
 * trăiește în PhotoCostingDraftEditor (reutilizat și în
 * Vendor Assistant) - aici doar orchestrăm salvarea, fiindcă
 * pe pagina de detaliu productId e deja cunoscut.
 */
export default function PhotoCostingModal({
  productId,
  productImageUrl,
  onClose,
  onSaved,
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleConfirm(materials) {
    setSaving(true);
    setSaveError("");

    try {
      const existingCosting =
        await fetchProductCosting(productId);

      const baseDraft = costingToCostDraftShape(
        existingCosting
      );

      const finalCostDraft = {
        ...baseDraft,
        materials,
      };

      const saved = await saveProductCosting(
        productId,
        finalCostDraft
      );

      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : "Nu am putut salva componentele."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={panelStyle}
      >
        <div style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: 17 }}>
            Calculează din fotografie
          </h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            style={iconBtnStyle}
          >
            ✕
          </button>
        </div>

        <PhotoCostingDraftEditor
          initialImageUrl={productImageUrl}
          onConfirm={handleConfirm}
          onCancel={onClose}
          busy={saving}
          busyLabel="Se salvează..."
          externalError={saveError}
        />
      </div>
    </div>
  );
}

/* =========================================================
   Stiluri (doar chrome-ul de modal)
========================================================= */

const overlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 1200,
};

const panelStyle = {
  background: "var(--surface, #ffffff)",
  color: "var(--color-text, #2d2d2d)",
  borderRadius: 14,
  boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
  width: "100%",
  maxWidth: 560,
  maxHeight: "90vh",
  overflowY: "auto",
  padding: 20,
};

const headerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
};

const iconBtnStyle = {
  border: 0,
  background: "transparent",
  color: "var(--color-muted, #6b7280)",
  fontSize: 16,
  cursor: "pointer",
};
