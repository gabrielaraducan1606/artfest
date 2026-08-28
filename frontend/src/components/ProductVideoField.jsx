import { useRef, useState } from "react";
import { FaVideo, FaSync, FaTrash } from "react-icons/fa";

import styles from "../pages/Vendor/ProfilMagazin/components/css/ProductModal.module.css";

const NETWORK_ERROR_MESSAGE =
  "Nu am putut încărca videoul. Verifică conexiunea și încearcă din nou.";

const AUTH_ERROR_MESSAGE =
  "Trebuie să fii autentificat pentru a încărca un video.";

/**
 * Câmp reutilizabil pentru videoul (opțional) al unui produs.
 * Se folosește DOAR de `videoUrl`, nu atinge `images[]`.
 *
 * Folosit în: ProductModal (formular manual), ProductEditModal,
 * VendorProductWizard (AI assistant).
 */
export default function ProductVideoField({
  videoUrl,
  onChange,
  posterUrl,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const uploadingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file) {
    if (!file) return;

    // Gardă sincronă, în plus față de `disabled` pe buton - nu
    // permite un al doilea upload concurent (ex. dublu-click).
    if (uploadingRef.current) return;

    setError("");
    uploadingRef.current = true;
    setUploading(true);

    try {
      let res;

      try {
        res = await fetch("/api/upload/products/video", {
          method: "POST",
          body: (() => {
            const fd = new FormData();
            fd.append("file", file);
            return fd;
          })(),
          credentials: "include",
        });
      } catch {
        // fetch a eșuat înainte de a primi orice răspuns - eroare
        // de rețea, nu vine nimic din backend de citit aici.
        throw new Error(NETWORK_ERROR_MESSAGE);
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Mesajul real din backend (413/415/400 au deja `message`
        // clar). Middleware-ul de auth (401/403) nu trimite mereu
        // `message` - în acel caz arătăm un mesaj generic, fără
        // detalii tehnice, în loc de un cod brut sau textul de
        // rețea.
        if (!data?.message && (res.status === 401 || res.status === 403)) {
          throw new Error(AUTH_ERROR_MESSAGE);
        }

        throw new Error(data?.message || NETWORK_ERROR_MESSAGE);
      }

      if (!data?.url) {
        throw new Error(NETWORK_ERROR_MESSAGE);
      }

      // videoUrl existent rămâne neatins dacă am ajuns aici pe o
      // eroare - onChange se apelează DOAR la succes real.
      onChange?.(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : NETWORK_ERROR_MESSAGE);
    } finally {
      uploadingRef.current = false;
      setUploading(false);

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  const isDisabled = disabled || uploading;

  return (
    <div className={styles.videoFieldWrap}>
      <div className={styles.videoFieldHeader}>
        <strong className={styles.videoFieldTitle}>
          Video produs (opțional)
        </strong>

        <p className={styles.videoFieldHint}>
          Recomandat 20–30 secunde · MP4/WebM · max 50 MB
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm"
        disabled={isDisabled}
        className={styles.fileInputHidden}
        onChange={(e) =>
          handleFile(e.target.files?.[0] || null)
        }
      />

      {videoUrl ? (
        <div className={styles.videoPreviewCard}>
          <video
            src={videoUrl}
            poster={posterUrl || undefined}
            controls
            playsInline
            preload="metadata"
            muted
            className={styles.videoPreviewPlayer}
          />

          <div className={styles.videoPreviewActions}>
            <button
              type="button"
              className={styles.smallBtn}
              disabled={isDisabled}
              onClick={() => inputRef.current?.click()}
            >
              <FaSync aria-hidden="true" />{" "}
              {uploading ? "Se încarcă..." : "Înlocuiește videoul"}
            </button>

            <button
              type="button"
              className={styles.smallBtn}
              disabled={isDisabled}
              onClick={() => {
                setError("");
                onChange?.(null);
              }}
            >
              <FaTrash aria-hidden="true" /> Șterge videoul
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={styles.videoAddButton}
          disabled={isDisabled}
          onClick={() => inputRef.current?.click()}
        >
          <FaVideo aria-hidden="true" />{" "}
          {uploading ? "Se încarcă..." : "Adaugă video"}
        </button>
      )}

      {error && <p className={styles.videoError}>{error}</p>}
    </div>
  );
}
