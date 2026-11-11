// src/pages/Vendor/Produse/components/CustomizationPhotoUpload.jsx
//
// Câmpul „Adaugă fotografie” din personalizarea produsului (ProductDetails).
// Valoarea salvată rămâne aceeași ca înainte: un singur URL (string) în
// customAnswers / repeatedGroupAnswers - coșul, comanda și pagina
// vânzătorului o citesc neschimbat.
//
// onUploaded / onBusyChange sunt citite O DATĂ, la începutul upload-ului:
// dacă între timp clientul a trecut pe alt produs, părintele recunoaște
// rezultatul vechi și îl ignoră.

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./CustomizationPhotoUpload.module.css";
import {
  CUSTOMIZATION_FORMATS_LABEL,
  CUSTOMIZATION_MAX_BYTES,
  formatBytes,
  prepareCustomizationImage,
  sizeLimitMessage,
  uploadCustomizationImage,
  validateCustomizationFile,
} from "../hooks/customizationUpload.js";

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M4 7.5A2.5 2.5 0 0 1 6.5 5h1.3l1.1-1.4A1.5 1.5 0 0 1 10.1 3h3.8a1.5 1.5 0 0 1 1.2.6L16.2 5h1.3A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M5 10.5l3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default function CustomizationPhotoUpload({
  label,
  value,
  required = false,
  invalid = false,
  externalBusy = false,
  disabled = false,
  describedBy,
  onUploaded,
  onRemove,
  onBusyChange,
}) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const statusId = `${inputId}-status`;

  const inputRef = useRef(null);
  const uploadRef = useRef(null);
  const previewUrlRef = useRef(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState("idle"); // idle | preparing | uploading | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [localPreview, setLocalPreview] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [retryFile, setRetryFile] = useState(null);
  // sursa (URL) pe care browserul nu a putut-o afișa (ex. HEIC în Chrome)
  const [failedSrc, setFailedSrc] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const setPreviewFromFile = useCallback((file) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }

    if (file) {
      try {
        previewUrlRef.current = URL.createObjectURL(file);
      } catch {
        previewUrlRef.current = null;
      }
    }

    setLocalPreview(previewUrlRef.current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;

      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  const busy = status === "preparing" || status === "uploading";
  const hasProgress = status === "uploading" && progress > 0;
  const showBusy = busy || (externalBusy && !value);

  const startUpload = useCallback(
    async (file) => {
      const deliver = onUploaded;
      const reportBusy = onBusyChange;

      const invalidMessage = validateCustomizationFile(file);

      if (invalidMessage) {
        setStatus("error");
        setError(invalidMessage);
        setFileInfo(file ? { name: file.name, size: file.size } : null);
        setRetryFile(null);
        return;
      }

      setRetryFile(file);
      setError("");
      setProgress(0);
      setFileInfo({ name: file.name, size: file.size });
      setPreviewFromFile(file);
      setStatus("preparing");
      reportBusy?.(true);

      try {
        const prepared = await prepareCustomizationImage(file);

        if (prepared.size > CUSTOMIZATION_MAX_BYTES) {
          throw new Error(sizeLimitMessage(prepared.size));
        }

        if (mountedRef.current) {
          setStatus("uploading");
        }

        const upload = uploadCustomizationImage(prepared, {
          onProgress: (pct) => {
            if (mountedRef.current) setProgress(pct);
          },
        });

        uploadRef.current = upload;

        const result = await upload.promise;

        deliver?.(result.url);

        if (mountedRef.current) {
          setStatus("idle");
          setProgress(100);
          setRetryFile(null);
          setPreviewFromFile(null);
        }
      } catch (err) {
        if (mountedRef.current) {
          if (err?.code === "aborted") {
            setStatus("idle");
            setError("");
            setFileInfo(null);
            setRetryFile(null);
            setPreviewFromFile(null);
          } else {
            setStatus("error");
            setError(err?.message || "Nu am putut încărca fotografia. Încearcă din nou.");
          }
        }
      } finally {
        uploadRef.current = null;
        reportBusy?.(false);
      }
    },
    [onUploaded, onBusyChange, setPreviewFromFile]
  );

  const openPicker = useCallback(() => {
    if (disabled || busy) return;
    inputRef.current?.click();
  }, [disabled, busy]);

  const onInputChange = useCallback(
    (event) => {
      const file = event.target.files?.[0] || null;

      // Fără reset, aceeași fotografie aleasă din nou (după o eroare sau
      // după „Elimină”) nu mai declanșează onChange.
      event.target.value = "";

      if (file) startUpload(file);
    },
    [startUpload]
  );

  const onRetry = useCallback(() => {
    if (retryFile) {
      startUpload(retryFile);
    } else {
      openPicker();
    }
  }, [retryFile, startUpload, openPicker]);

  const onCancel = useCallback(() => {
    uploadRef.current?.abort();
  }, []);

  const onRemoveClick = useCallback(() => {
    setStatus("idle");
    setError("");
    setFileInfo(null);
    setPreviewFromFile(null);
    setRetryFile(null);
    onRemove?.();
  }, [onRemove, setPreviewFromFile]);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragOver(false);

      if (disabled || busy) return;

      const file = event.dataTransfer?.files?.[0];
      if (file) startUpload(file);
    },
    [disabled, busy, startUpload]
  );

  const previewSrc = busy || status === "error" ? localPreview : value || null;
  const previewFailed = !!previewSrc && failedSrc === previewSrc;
  const hasPhoto = !!value && !busy && status !== "error";

  const zoneClass = [
    styles.zone,
    dragOver ? styles.zoneDragOver : "",
    invalid || status === "error" ? styles.zoneError : "",
  ]
    .filter(Boolean)
    .join(" ");

  const describedByIds = [hintId, statusId, describedBy].filter(Boolean).join(" ");

  return (
    <div className={styles.root}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className={styles.nativeInput}
        tabIndex={-1}
        aria-hidden="true"
        onChange={onInputChange}
      />

      {!hasPhoto && !showBusy && status !== "error" && (
        <button
          type="button"
          className={zoneClass}
          onClick={openPicker}
          disabled={disabled}
          aria-label={label ? `Adaugă fotografie: ${label}` : "Adaugă fotografie"}
          aria-describedby={describedByIds}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          onDragOver={(event) => {
            event.preventDefault();
            if (!dragOver) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <span className={styles.zoneIcon}>
            <PhotoIcon />
          </span>
          <span className={styles.zoneText}>
            <span className={styles.zoneTitle}>Adaugă fotografie</span>
            <span className={styles.zoneSub}>
              Apasă pentru a alege o fotografie
            </span>
          </span>
        </button>
      )}

      {(hasPhoto || showBusy || status === "error") && (
        <div
          className={[
            styles.card,
            status === "error" ? styles.cardError : "",
            hasPhoto ? styles.cardSuccess : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div className={styles.thumb}>
            {previewSrc && !previewFailed ? (
              <img
                src={previewSrc}
                alt={label ? `Fotografia pentru ${label}` : "Fotografia pentru personalizare"}
                className={styles.thumbImg}
                onError={() => setFailedSrc(previewSrc)}
              />
            ) : (
              <span className={styles.thumbFallback}>
                <PhotoIcon />
              </span>
            )}
          </div>

          <div className={styles.cardBody}>
            {showBusy && (
              <>
                <span className={styles.cardTitle}>
                  {status === "preparing" ? "Se pregătește fotografia…" : "Se încarcă fotografia…"}
                </span>

                <div
                  className={styles.progress}
                  role="progressbar"
                  aria-label="Progres încărcare fotografie"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={hasProgress ? progress : undefined}
                >
                  <span
                    className={[
                      styles.progressBar,
                      !hasProgress ? styles.progressIndeterminate : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={hasProgress ? { width: `${Math.max(4, progress)}%` } : undefined}
                  />
                </div>

                <span className={styles.cardMeta}>
                  {hasProgress ? `${progress}%` : ""}
                  {fileInfo?.size ? `${hasProgress ? " · " : ""}${formatBytes(fileInfo.size)}` : ""}
                </span>
              </>
            )}

            {hasPhoto && (
              <>
                <span className={`${styles.cardTitle} ${styles.cardTitleSuccess}`}>
                  <span className={styles.successDot}>
                    <CheckIcon />
                  </span>
                  Fotografie adăugată
                </span>
                {previewFailed && (
                  <span className={styles.cardMeta}>
                    Previzualizarea nu este disponibilă în acest browser, dar fotografia a fost trimisă.
                  </span>
                )}
              </>
            )}

            {status === "error" && (
              <>
                <span className={`${styles.cardTitle} ${styles.cardTitleError}`}>
                  Fotografia nu a fost încărcată
                </span>
                <span className={styles.cardMeta} role="alert">
                  {error}
                </span>
              </>
            )}

            <div className={styles.actions}>
              {status === "uploading" && (
                <button type="button" className={styles.actionBtn} onClick={onCancel}>
                  Anulează
                </button>
              )}

              {status === "error" && (
                <>
                  {retryFile && (
                    <button type="button" className={`${styles.actionBtn} ${styles.actionPrimary}`} onClick={onRetry}>
                      Încearcă din nou
                    </button>
                  )}
                  <button type="button" className={styles.actionBtn} onClick={openPicker}>
                    Alege altă fotografie
                  </button>
                  {value && (
                    <button type="button" className={styles.actionBtn} onClick={() => { setStatus("idle"); setError(""); setPreviewFromFile(null); }}>
                      Păstrează fotografia anterioară
                    </button>
                  )}
                </>
              )}

              {hasPhoto && (
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={openPicker}
                  disabled={disabled}
                  aria-describedby={hintId}
                >
                  Înlocuiește
                </button>
              )}
            </div>
          </div>

          {hasPhoto && (
            <button
              type="button"
              className={styles.removeBtn}
              onClick={onRemoveClick}
              disabled={disabled}
              aria-label={label ? `Elimină fotografia pentru ${label}` : "Elimină fotografia"}
              title="Elimină fotografia"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      )}

      <p id={hintId} className={styles.hint}>
        {CUSTOMIZATION_FORMATS_LABEL} · maxim {formatBytes(CUSTOMIZATION_MAX_BYTES)} · o fotografie
      </p>

      <span id={statusId} className={styles.srOnly} aria-live="polite">
        {status === "preparing"
          ? "Se pregătește fotografia."
          : status === "uploading"
            ? "Se încarcă fotografia."
            : status === "error"
              ? `Eroare: ${error}`
              : hasPhoto
                ? "Fotografia a fost adăugată."
                : ""}
      </span>
    </div>
  );
}
