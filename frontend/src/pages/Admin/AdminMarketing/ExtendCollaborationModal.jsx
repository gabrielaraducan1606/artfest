import { useState } from "react";
import { createPortal } from "react-dom";

import { api } from "../../../lib/api.js";
import styles from "./AdminInfluencersTab.module.css";
import {
  EXTENSION_PRESETS,
  buildExtensionPayload,
  formatExtensionDate,
  previewValidationError,
  proposeExtensionDate,
  toDateInputValue,
} from "./collaborationExtension.js";

/*
 * "Prelungește colaborarea" (Admin -> Influenceri): modal mic cu presetări
 * +1/+3/+6 luni sau o dată personalizată. Data propusă e afișată ÎNAINTE de
 * confirmare (previzualizare LOCALĂ, doar pentru UI - vezi
 * collaborationExtension.js). La confirmare, PATCH /api/admin/influencers/
 * :id/collaboration trimite data aleasă; backend-ul (services/
 * influencerCollaboration.js) validează și recalculează AUTORITAR -
 * rezultatul afișat mai departe vine STRICT din răspunsul lui, nu din
 * previzualizare.
 *
 * NU modifică status sau commissionBps (backend-ul garantează asta - vezi
 * comentariile din adminInfluencersRoutes.js).
 */
export default function ExtendCollaborationModal({ item, onClose, onExtended }) {
  const currentEnd = item?.collaboration?.collaborationEnd || null;

  const [selectedPreset, setSelectedPreset] = useState(EXTENSION_PRESETS[1]?.id || "3m");
  const [mode, setMode] = useState("preset"); // "preset" | "custom"
  const [customDate, setCustomDate] = useState(toDateInputValue(currentEnd));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!item) return null;
  if (typeof document === "undefined") return null;

  const proposedDate =
    mode === "custom"
      ? customDate
        ? new Date(customDate)
        : null
      : currentEnd
        ? proposeExtensionDate(currentEnd, EXTENSION_PRESETS.find((p) => p.id === selectedPreset)?.months || 3)
        : null;

  const validationError = proposedDate ? previewValidationError(proposedDate, currentEnd) : "Alege o dată.";

  async function submit() {
    if (validationError || !proposedDate || saving) return;

    setSaving(true);
    setError("");

    try {
      const data = await api(
        `/api/admin/influencers/${encodeURIComponent(item.id)}/collaboration`,
        {
          method: "PATCH",
          body: buildExtensionPayload(proposedDate),
        }
      );

      if (data?.ok === false) {
        throw Object.assign(new Error(data?.message || data?.error), { code: data?.error });
      }

      onExtended?.(data.collaboration);
    } catch (err) {
      setError(
        err?.code === "collaboration_end_not_after_current"
          ? "Noua dată trebuie să fie ulterioară perioadei curente de colaborare."
          : err?.code === "collaboration_end_before_start"
            ? "Noua dată trebuie să fie ulterioară începutului colaborării."
            : err?.message || "Nu am putut prelungi colaborarea. Încearcă din nou."
      );
    } finally {
      setSaving(false);
    }
  }

  const node = (
    <div
      role="presentation"
      className={styles.modalBackdrop}
      onMouseDown={(event) => {
        if (!saving && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="extend-collaboration-title"
        className={styles.modal}
      >
        <div className={styles.modalHeader}>
          <div>
            <h3 id="extend-collaboration-title" className={styles.modalTitle}>
              Prelungește colaborarea
            </h3>

            <p className={styles.modalSubtitle}>{item.name || item.email}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Închide"
            className={styles.closeButton}
          >
            ×
          </button>
        </div>

        <div className={styles.resultBody}>
          <div className={styles.infoBox}>
            <strong>Perioada curentă</strong>

            <div style={{ marginTop: 6 }}>
              {formatExtensionDate(item.collaboration?.collaborationStart)} –{" "}
              {formatExtensionDate(currentEnd)}
            </div>
          </div>

          <div className={styles.field}>
            <div className={styles.fieldLabel}>Prelungește cu</div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {EXTENSION_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={
                    mode === "preset" && selectedPreset === preset.id
                      ? styles.primaryButton
                      : styles.secondaryButton
                  }
                  disabled={saving || !currentEnd}
                  onClick={() => {
                    setMode("preset");
                    setSelectedPreset(preset.id);
                  }}
                >
                  {preset.label}
                </button>
              ))}

              <button
                type="button"
                className={mode === "custom" ? styles.primaryButton : styles.secondaryButton}
                disabled={saving}
                onClick={() => setMode("custom")}
              >
                Dată personalizată
              </button>
            </div>

            {mode === "custom" && (
              <input
                type="date"
                className={styles.input}
                style={{ marginTop: 10 }}
                value={customDate}
                disabled={saving}
                onChange={(event) => setCustomDate(event.target.value)}
              />
            )}
          </div>

          <div className={styles.infoBox}>
            <strong>Noua dată de expirare</strong>

            <div style={{ marginTop: 6 }}>
              {proposedDate && !validationError
                ? formatExtensionDate(proposedDate)
                : "—"}
            </div>
          </div>

          {(validationError || error) && (
            <div className={styles.warningBox}>{error || validationError}</div>
          )}

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={saving}
              onClick={onClose}
            >
              Anulează
            </button>

            <button
              type="button"
              className={styles.primaryButton}
              disabled={saving || Boolean(validationError)}
              onClick={submit}
            >
              {saving ? "Se salvează..." : "Prelungește colaborarea"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
