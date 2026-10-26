// src/pages/Admin/AdminDesktop/tabs/ProductChangeRequestModal.jsx

/*
 * „Cere modificări” - preview produs, motive rapide (multi-select),
 * observații și opțiunea EXPLICITĂ „Ascunde temporar produsul”.
 * Trimiterea: PATCH /api/admin/products/:id/request-changes
 * { reasons, note, hideProduct } - vendorul primește o notificare și un
 * email (vezi backend/src/services/productChangeRequest.js).
 */

import { useEffect, useRef, useState } from "react";
import styles from "../css/ProductChangeRequestModal.module.css";
import {
  CHANGE_REQUEST_NOTE_MAX,
  CHANGE_REQUEST_REASONS,
} from "../../../../features/productChanges/changeRequestReasons.js";

export default function ProductChangeRequestModal({ product, working, onClose, onSubmit }) {
  const [reasons, setReasons] = useState([]);
  const [note, setNote] = useState("");
  const [hideProduct, setHideProduct] = useState(false);
  const [localError, setLocalError] = useState("");
  // anti dublu-click (ref: se actualizează sincron, înaintea re-randării)
  const submittingRef = useRef(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape" && !working) onClose();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, working]);

  const image = Array.isArray(product.images) && product.images.length ? product.images[0] : "";
  const storeName = product.service?.displayName || product.vendor?.displayName || "—";
  const isApproved = String(product.moderationStatus || "").toUpperCase() === "APPROVED";
  const trimmedNote = note.trim();
  const needsNote = reasons.includes("OTHER") && !trimmedNote;
  const canSubmit = !working && (reasons.length > 0 || trimmedNote) && !needsNote;

  function toggleReason(code) {
    setLocalError("");
    setReasons((old) => (old.includes(code) ? old.filter((c) => c !== code) : [...old, code]));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (needsNote) {
      setLocalError("Pentru „Alt motiv”, scrie ce trebuie modificat.");
      return;
    }

    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;

    try {
      const ok = await onSubmit({ reasons, note: trimmedNote, hideProduct });
      if (ok === false) setLocalError("Nu am putut trimite solicitarea. Încearcă din nou.");
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <div className={styles.backdrop} onClick={() => !working && onClose()}>
      <form
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-request-title"
      >
        <div className={styles.head}>
          <h3 id="change-request-title" className={styles.title}>
            Cere modificări
          </h3>

          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={working}
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className={styles.preview}>
          {image ? (
            <img src={image} alt="" className={styles.previewImg} />
          ) : (
            <div className={styles.previewPlaceholder}>Fără poză</div>
          )}

          <div className={styles.previewInfo}>
            <div className={styles.previewTitle}>{product.title || "Produs fără titlu"}</div>
            <div className={styles.previewStore}>{storeName}</div>
          </div>
        </div>

        <fieldset className={styles.section}>
          <legend className={styles.sectionTitle}>Ce trebuie modificat?</legend>

          <div className={styles.reasons}>
            {CHANGE_REQUEST_REASONS.map((reason) => {
              const checked = reasons.includes(reason.code);

              return (
                <label
                  key={reason.code}
                  className={`${styles.reason} ${checked ? styles.reasonChecked : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleReason(reason.code)}
                  />
                  <span>{reason.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className={styles.section}>
          <span className={styles.sectionTitle}>
            Observații pentru vânzător{reasons.includes("OTHER") ? " *" : ""}
          </span>

          <textarea
            className={styles.textarea}
            value={note}
            maxLength={CHANGE_REQUEST_NOTE_MAX}
            placeholder="Ex.: Adaugă variantele de culoare din fotografii și dimensiunile exacte."
            onChange={(e) => {
              setLocalError("");
              setNote(e.target.value);
            }}
          />
        </label>

        <label className={styles.hideOption}>
          <input
            type="checkbox"
            checked={hideProduct}
            onChange={(e) => setHideProduct(e.target.checked)}
          />
          <span>
            <strong>Ascunde temporar produsul până la corectare</strong>
            <small>
              {isApproved
                ? "Nebifat: produsul rămâne vizibil pe site cât timp vânzătorul face modificările."
                : "Produsul nu este încă aprobat, deci nu apare pe site."}
            </small>
          </span>
        </label>

        {localError ? <p className={styles.error}>{localError}</p> : null}

        <div className={styles.actions}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={working}>
            Renunță
          </button>

          <button type="submit" className={styles.primaryBtn} disabled={!canSubmit}>
            {working ? "Se trimite..." : "Trimite solicitarea"}
          </button>
        </div>

        <p className={styles.footnote}>
          Vânzătorul primește o notificare și un email cu linkul spre pagina de modificări.
        </p>
      </form>
    </div>
  );
}
