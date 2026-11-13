// src/components/ProductPhotoUploader/ProductPhotoUploader.jsx
//
// Selectorul de fotografii COMUN pentru produse (Smart Listing - adăugare și
// editare). Afișează coada din useProductImageQueue: previzualizări, status
// per fotografie (în așteptare / se pregătește / se încarcă N% / încărcată /
// eroare), „Reîncearcă” individual, eliminare, mutare, fotografie principală.
// Eșecul unei fotografii nu blochează restul formularului.

import { useState } from "react";
import {
  ACCEPTED_FORMATS_LABEL,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_SOURCE_BYTES,
  PRODUCT_IMAGE_ACCEPT,
  formatBytes,
} from "../../lib/productImages/productImageRules.js";
import styles from "./ProductPhotoUploader.module.css";

const STATUS_TEXT = {
  queued: "În așteptare",
  processing: "Se pregătește…",
  uploading: "Se încarcă…",
};

function statusLabel(item) {
  if (item.status === "uploading" && Number.isFinite(item.progress) && item.progress > 0 && item.progress < 1) {
    return `Se încarcă ${Math.round(item.progress * 100)}%`;
  }
  if (item.status === "uploading" && item.progress === 1) return "Se procesează pe server…";
  return STATUS_TEXT[item.status] || "";
}

function Thumb({ item, resolveUrl }) {
  const [broken, setBroken] = useState(false);
  const src = item.status === "done" && item.url ? resolveUrl(item.url) : item.previewUrl;

  // HEIC în Chrome / Firefox: browserul nu îl poate previzualiza înainte de conversie
  if (!src || broken) {
    return (
      <span className={styles.placeholder} aria-hidden="true">
        <span className={styles.placeholderIcon}>🖼️</span>
        <span className={styles.placeholderName}>{item.name || "Fotografie"}</span>
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />;
}

/**
 * @param {{
 *   queue: ReturnType<import("../../lib/productImages/productImageQueue.js").createProductImageQueue>,
 *   state: object,
 *   resolveUrl?: (url: string) => string,
 *   minPhotos?: number,
 *   disabled?: boolean,
 *   showCamera?: boolean,
 *   idPrefix?: string,
 * }} props
 */
export default function ProductPhotoUploader({
  queue,
  state,
  resolveUrl = (url) => url,
  minPhotos = 0,
  disabled = false,
  showCamera = true,
  idPrefix = "photos",
}) {
  const [dragging, setDragging] = useState(false);
  const [messages, setMessages] = useState([]);
  const [announce, setAnnounce] = useState("");

  const { items, remaining, maxPhotos, pendingCount, failedCount, doneCount } = state;
  const full = remaining <= 0;

  async function handleFiles(fileList) {
    if (disabled) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const result = await queue.addFiles(files);
    setMessages(result.rejected.map((entry) => entry.message));
    if (result.added) {
      setAnnounce(`${result.added === 1 ? "O fotografie adăugată" : `${result.added} fotografii adăugate`} în coada de încărcare.`);
    }
  }

  const inputProps = (extra = {}) => ({
    type: "file",
    accept: PRODUCT_IMAGE_ACCEPT,
    className: styles.visuallyHidden,
    disabled: disabled || full,
    onChange: (event) => {
      handleFiles(event.target.files);
      event.target.value = "";
    },
    ...extra,
  });

  const canRemove = items.length > minPhotos;

  return (
    <div className={styles.root}>
      <div className={styles.pickers}>
        <label
          className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""} ${full || disabled ? styles.dropzoneDisabled : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!full && !disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            handleFiles(event.dataTransfer?.files);
          }}
        >
          <input {...inputProps({ multiple: true, "aria-describedby": `${idPrefix}-rules` })} />
          <span className={styles.dropIcon} aria-hidden="true">
            🖼️
          </span>
          <strong>
            {full
              ? `Ai atins limita de ${maxPhotos} fotografii`
              : items.length
                ? "Adaugă mai multe fotografii"
                : "Alege fotografii din galerie"}
          </strong>
          {!full ? <span className={styles.muted}>sau trage-le aici · poți alege mai multe deodată</span> : null}
        </label>

        {showCamera ? (
          <label className={`${styles.cameraBtn} ${full || disabled ? styles.dropzoneDisabled : ""}`}>
            <input {...inputProps({ accept: "image/*", capture: "environment" })} />
            📷 Fă o poză
          </label>
        ) : null}
      </div>

      <p id={`${idPrefix}-rules`} className={styles.rules}>
        {ACCEPTED_FORMATS_LABEL} · până la {maxPhotos} fotografii · maximum {formatBytes(MAX_PRODUCT_SOURCE_BYTES)} per
        fotografie aleasă. Fotografiile mari sunt optimizate automat (trimise la maximum{" "}
        {formatBytes(MAX_PRODUCT_IMAGE_BYTES)}), fără să le micșorezi tu.
      </p>

      <p className={styles.visuallyHidden} aria-live="polite">
        {announce}
      </p>

      {messages.length ? (
        <ul className={styles.messages} role="alert">
          {messages.map((message, index) => (
            <li key={`${index}-${message}`}>{message}</li>
          ))}
        </ul>
      ) : null}

      {items.length ? (
        <>
          <p className={styles.summary} aria-live="polite">
            {doneCount} din {items.length} încărcate
            {pendingCount ? ` · ${pendingCount} în lucru` : ""}
            {failedCount ? ` · ${failedCount} cu eroare` : ""}
            {failedCount > 1 ? (
              <button type="button" className={styles.linkBtn} onClick={() => queue.retryAll()}>
                Reîncearcă toate
              </button>
            ) : null}
          </p>

          <ul className={styles.grid}>
            {items.map((item, index) => {
              const position = index + 1;
              const busy = item.status !== "done" && item.status !== "error";
              return (
                <li
                  key={item.id}
                  className={`${styles.card} ${item.status === "error" ? styles.cardError : ""}`}
                  data-status={item.status}
                >
                  <div className={styles.media}>
                    <Thumb item={item} resolveUrl={resolveUrl} />

                    {index === 0 ? <span className={styles.mainBadge}>Principală</span> : null}

                    {busy ? (
                      <span className={styles.overlay} role="status">
                        <span className={styles.spinner} aria-hidden="true" />
                        {statusLabel(item)}
                        {item.status === "uploading" && Number.isFinite(item.progress) ? (
                          <span className={styles.progress} aria-hidden="true">
                            <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>

                  {item.status === "error" ? (
                    <div className={styles.errorBox} role="alert">
                      <span>{item.error || "Nu am putut încărca fotografia."}</span>
                      {item.retryable !== false ? (
                        <button
                          type="button"
                          className={styles.retryBtn}
                          onClick={() => queue.retry(item.id)}
                          aria-label={`Reîncearcă fotografia ${position}`}
                        >
                          Reîncearcă
                        </button>
                      ) : null}
                    </div>
                  ) : busy && item.error ? (
                    <p className={styles.note}>{item.error}</p>
                  ) : null}

                  <div className={styles.toolbar}>
                    <button
                      type="button"
                      onClick={() => queue.move(item.id, -1)}
                      disabled={index === 0}
                      aria-label={`Mută fotografia ${position} mai în față`}
                      title="Mută în față"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => queue.move(item.id, 1)}
                      disabled={index === items.length - 1}
                      aria-label={`Mută fotografia ${position} mai în spate`}
                      title="Mută în spate"
                    >
                      ›
                    </button>
                    {index !== 0 ? (
                      <button
                        type="button"
                        className={styles.mainBtn}
                        onClick={() => queue.makeMain(item.id)}
                        aria-label={`Fă fotografia ${position} principală`}
                      >
                        Principală
                      </button>
                    ) : (
                      <span className={styles.spacer} />
                    )}
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => queue.remove(item.id)}
                      disabled={!canRemove}
                      aria-label={busy ? `Anulează fotografia ${position}` : `Șterge fotografia ${position}`}
                      title={canRemove ? (busy ? "Anulează" : "Șterge") : "Produsul trebuie să aibă cel puțin o fotografie"}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className={styles.hint}>Prima fotografie este cea principală: apare pe card și în căutări.</p>
        </>
      ) : null}
    </div>
  );
}
