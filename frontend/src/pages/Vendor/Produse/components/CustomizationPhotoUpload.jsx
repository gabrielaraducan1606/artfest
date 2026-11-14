// src/pages/Vendor/Produse/components/CustomizationPhotoUpload.jsx
//
// Câmpul „Adaugă fotografie” din personalizarea produsului (ProductDetails).
//
// Valoarea (din customAnswers / repeatedGroupAnswers) poate fi:
//   - un URL (string) - o singură fotografie, exact ca înainte;
//   - o listă de URL-uri - când câmpul permite mai multe (`maxFiles` > 1).
// Componenta nu salvează nimic singură: anunță fiecare fotografie încărcată
// (onUploaded(url)) și fiecare eliminare (onRemove(url)); părintele decide
// forma valorii.
//
// Fotografiile se încarcă PE RÂND (una singură trimisă serverului la un
// moment dat), cu aceeași pregătire locală și același endpoint ca înainte
// (hooks/customizationUpload.js).
//
// onBusyChange(state): "uploading" cât timp mai sunt fotografii în lucru,
// "failed" dacă au rămas fotografii neîncărcate (de reîncercat sau
// eliminat), false când totul e în regulă. Părintele blochează coșul /
// oferta pentru orice stare diferită de false.
//
// Handler-ele sunt reținute la alegerea fotografiilor: dacă între timp
// clientul a trecut pe alt produs, părintele recunoaște rezultatul vechi
// și îl ignoră.

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./CustomizationPhotoUpload.module.css";
import {
  CUSTOMIZATION_FORMATS_LABEL,
  CUSTOMIZATION_MAX_BYTES,
  formatBytes,
  prepareCustomizationImage,
  sizeLimitMessage,
  toPhotoList,
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

let nextItemId = 0;

export default function CustomizationPhotoUpload({
  label,
  value,
  maxFiles = 1,
  required = false,
  invalid = false,
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
  const mountedRef = useRef(true);
  const activeRef = useRef(null); // { id, upload }
  const itemsRef = useRef([]);
  const reportedRef = useRef(false);
  const reporterRef = useRef(onBusyChange);

  /*
   * Fotografiile care NU sunt (încă) în valoare: în așteptare, în lucru
   * sau cu eroare. Cele încărcate trăiesc doar în `value`.
   * { id, file, name, size, preview, status, progress, error, deliver }
   * status: queued | preparing | uploading | error
   */
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState("");
  const [failedSrc, setFailedSrc] = useState(() => new Set());
  const [dragOver, setDragOver] = useState(false);

  itemsRef.current = items;

  const multiple = maxFiles > 1;
  const uploaded = useMemo(() => toPhotoList(value), [value]);
  const total = uploaded.length + items.length;
  const canAdd = !disabled && total < maxFiles;

  const patchItem = useCallback((id, patch) => {
    if (!mountedRef.current) return;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const dropItem = useCallback((id) => {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    if (!mountedRef.current) return;
    setItems((current) => current.filter((entry) => entry.id !== id));
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      activeRef.current?.upload?.abort();
      activeRef.current = null;

      for (const item of itemsRef.current) {
        if (item.preview) URL.revokeObjectURL(item.preview);
      }

      if (reportedRef.current) reporterRef.current?.(false);
    };
  }, []);

  /* starea agregată -> părinte (doar la schimbare) */
  const busyState = items.some((item) => item.status !== "error")
    ? "uploading"
    : items.length
      ? "failed"
      : false;

  useEffect(() => {
    if (busyState === reportedRef.current) return;
    reportedRef.current = busyState;
    reporterRef.current?.(busyState);
  }, [busyState]);

  /* coada: o singură fotografie în lucru la un moment dat */
  const runItem = useCallback(
    async (item) => {
      activeRef.current = { id: item.id, upload: null };
      patchItem(item.id, { status: "preparing", progress: 0, error: "" });

      try {
        const prepared = await prepareCustomizationImage(item.file);

        if (prepared.size > CUSTOMIZATION_MAX_BYTES) {
          throw new Error(sizeLimitMessage(prepared.size));
        }

        if (!mountedRef.current || activeRef.current?.id !== item.id) return;

        patchItem(item.id, { status: "uploading" });

        const upload = uploadCustomizationImage(prepared, {
          onProgress: (pct) => patchItem(item.id, { progress: pct }),
        });

        activeRef.current.upload = upload;

        const result = await upload.promise;

        item.deliver?.(result.url);
        dropItem(item.id);
      } catch (err) {
        if (err?.code === "aborted") {
          dropItem(item.id);
        } else {
          patchItem(item.id, {
            status: "error",
            error: err?.message || "Nu am putut încărca fotografia. Încearcă din nou.",
          });
        }
      } finally {
        if (activeRef.current?.id === item.id) activeRef.current = null;
        // pornește următoarea din coadă
        if (mountedRef.current) setItems((current) => [...current]);
      }
    },
    [patchItem, dropItem]
  );

  useEffect(() => {
    if (activeRef.current) return;
    const next = items.find((item) => item.status === "queued");
    if (next) runItem(next);
  }, [items, runItem]);

  /* anulează (dacă e în lucru) și scoate fotografia din listă */
  const removeItem = useCallback(
    (id) => {
      const active = activeRef.current;

      if (active?.id === id && active.upload) {
        active.upload.abort(); // runItem o scoate la "aborted"
        return;
      }

      // încă în pregătire: runItem observă și renunță
      if (active?.id === id) activeRef.current = null;
      dropItem(id);
    },
    [dropItem]
  );

  const addFiles = useCallback(
    (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length || disabled) return;

      reporterRef.current = onBusyChange;
      const deliver = onUploaded;

      // un singur câmp foto: noua alegere o înlocuiește pe cea în lucru/cu eroare
      if (!multiple) {
        for (const item of itemsRef.current) removeItem(item.id);
      }

      const room = multiple ? Math.max(0, maxFiles - uploaded.length - itemsRef.current.length) : 1;
      const known = new Set(
        itemsRef.current.map((item) => `${item.name}|${item.size}|${item.file.lastModified}`)
      );

      const accepted = [];
      const problems = [];
      let skipped = 0;

      for (const file of files) {
        const fingerprint = `${file.name}|${file.size}|${file.lastModified}`;
        if (known.has(fingerprint)) continue;
        known.add(fingerprint);

        const invalidMessage = validateCustomizationFile(file);

        if (invalidMessage) {
          problems.push(`${file.name}: ${invalidMessage}`);
          continue;
        }

        if (accepted.length >= room) {
          skipped += 1;
          continue;
        }

        let preview = null;
        try {
          preview = URL.createObjectURL(file);
        } catch {
          preview = null;
        }

        nextItemId += 1;
        accepted.push({
          id: `cp-${nextItemId}`,
          file,
          name: file.name,
          size: file.size,
          preview,
          status: "queued",
          progress: 0,
          error: "",
          deliver,
        });
      }

      const messages = [];
      if (skipped) {
        messages.push(
          `Poți adăuga cel mult ${maxFiles} fotografii aici. ${skipped} ${
            skipped === 1 ? "fotografie nu a fost adăugată" : "fotografii nu au fost adăugate"
          }.`
        );
      }
      if (problems.length) messages.push(...problems.slice(0, 3));
      if (problems.length > 3) messages.push(`Încă ${problems.length - 3} fișiere nu sunt fotografii acceptate.`);
      setNotice(messages.join(" "));

      if (accepted.length) {
        setItems((current) => [...current, ...accepted]);
      }
    },
    [disabled, multiple, maxFiles, uploaded.length, onUploaded, onBusyChange, removeItem]
  );

  const openPicker = useCallback(() => {
    if (!canAdd) return;
    inputRef.current?.click();
  }, [canAdd]);

  const onInputChange = useCallback(
    (event) => {
      const files = Array.from(event.target.files || []);
      // Fără reset, aceeași fotografie aleasă din nou nu mai declanșează onChange.
      event.target.value = "";
      addFiles(files);
    },
    [addFiles]
  );

  const retryItem = useCallback((id) => {
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "queued", error: "", progress: 0 } : item
      )
    );
  }, []);

  const retryAll = useCallback(() => {
    setItems((current) =>
      current.map((item) =>
        item.status === "error" ? { ...item, status: "queued", error: "", progress: 0 } : item
      )
    );
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragOver(false);
      if (!canAdd) return;
      addFiles(multiple ? event.dataTransfer?.files : [event.dataTransfer?.files?.[0]].filter(Boolean));
    },
    [canAdd, multiple, addFiles]
  );

  const markFailed = (src) =>
    setFailedSrc((current) => {
      if (current.has(src)) return current;
      const next = new Set(current);
      next.add(src);
      return next;
    });

  const pendingCount = items.filter((item) => item.status !== "error").length;
  const errorCount = items.length - pendingCount;

  const zoneClass = [
    styles.zone,
    dragOver ? styles.zoneDragOver : "",
    invalid || errorCount ? styles.zoneError : "",
  ]
    .filter(Boolean)
    .join(" ");

  const describedByIds = [hintId, statusId, describedBy].filter(Boolean).join(" ");
  const photoAlt = label ? `Fotografia pentru ${label}` : "Fotografia pentru personalizare";

  const statusText = pendingCount
    ? `Se încarcă fotografiile: ${uploaded.length} din ${total} gata.`
    : errorCount
      ? `${errorCount} ${errorCount === 1 ? "fotografie nu a fost încărcată" : "fotografii nu au fost încărcate"}.`
      : uploaded.length
        ? `${uploaded.length} ${uploaded.length === 1 ? "fotografie adăugată" : "fotografii adăugate"}.`
        : "";

  return (
    <div className={styles.root}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        multiple={multiple}
        className={styles.nativeInput}
        tabIndex={-1}
        aria-hidden="true"
        onChange={onInputChange}
      />

      {total > 0 && (
        <ul className={styles.grid} aria-label={label ? `Fotografii: ${label}` : "Fotografii"}>
          {uploaded.map((url, index) => (
            <li key={url} className={`${styles.tile} ${styles.tileDone}`}>
              {failedSrc.has(url) ? (
                <span className={styles.thumbFallback} title="Previzualizare indisponibilă - fotografia a fost trimisă.">
                  <PhotoIcon />
                </span>
              ) : (
                <img
                  src={url}
                  alt={`${photoAlt} (${index + 1})`}
                  className={styles.thumbImg}
                  loading="lazy"
                  decoding="async"
                  onError={() => markFailed(url)}
                />
              )}
              <button
                type="button"
                className={styles.tileRemove}
                onClick={() => onRemove?.(url)}
                disabled={disabled}
                aria-label={`Elimină fotografia ${index + 1}`}
                title="Elimină fotografia"
              >
                <CloseIcon />
              </button>
            </li>
          ))}

          {items.map((item) => {
            const isError = item.status === "error";
            const hasProgress = item.status === "uploading" && item.progress > 0;

            return (
              <li
                key={item.id}
                className={[styles.tile, isError ? styles.tileError : styles.tileBusy].join(" ")}
                title={isError ? item.error : item.name}
              >
                {item.preview && !failedSrc.has(item.preview) ? (
                  <img
                    src={item.preview}
                    alt={item.name}
                    className={styles.thumbImg}
                    onError={() => markFailed(item.preview)}
                  />
                ) : (
                  <span className={styles.thumbFallback}>
                    <PhotoIcon />
                  </span>
                )}

                {!isError && (
                  <span className={styles.tileProgress} aria-hidden="true">
                    <span
                      className={[styles.progressBar, !hasProgress ? styles.progressIndeterminate : ""]
                        .filter(Boolean)
                        .join(" ")}
                      style={hasProgress ? { width: `${Math.max(4, item.progress)}%` } : undefined}
                    />
                  </span>
                )}

                {isError && (
                  <button
                    type="button"
                    className={styles.tileRetry}
                    onClick={() => retryItem(item.id)}
                    aria-label={`Reîncearcă ${item.name}: ${item.error}`}
                  >
                    Reîncearcă
                  </button>
                )}

                <button
                  type="button"
                  className={styles.tileRemove}
                  onClick={() => removeItem(item.id)}
                  aria-label={item.status === "uploading" ? `Anulează ${item.name}` : `Elimină ${item.name}`}
                  title={item.status === "uploading" ? "Anulează" : "Elimină"}
                >
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {canAdd && (
        <button
          type="button"
          className={zoneClass}
          onClick={openPicker}
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
            <span className={styles.zoneTitle}>
              {total > 0 ? "Adaugă încă fotografii" : "Adaugă fotografie"}
            </span>
            <span className={styles.zoneSub}>
              {multiple
                ? "Apasă pentru a alege una sau mai multe fotografii"
                : "Apasă pentru a alege o fotografie"}
            </span>
          </span>
        </button>
      )}

      {(statusText || errorCount > 0) && (
        <div className={styles.summary}>
          <span className={errorCount && !pendingCount ? styles.summaryError : undefined}>{statusText}</span>
          {errorCount > 0 && !pendingCount && (
            <button type="button" className={styles.actionBtn} onClick={retryAll}>
              {errorCount === 1 ? "Încearcă din nou" : "Reîncearcă toate"}
            </button>
          )}
        </div>
      )}

      {notice && (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      )}

      <p id={hintId} className={styles.hint}>
        {CUSTOMIZATION_FORMATS_LABEL} · maxim {formatBytes(CUSTOMIZATION_MAX_BYTES)}
        {multiple ? ` / fotografie · până la ${maxFiles} fotografii` : " · o fotografie"}
      </p>

      <span id={statusId} className={styles.srOnly} aria-live="polite">
        {statusText}
      </span>
    </div>
  );
}
