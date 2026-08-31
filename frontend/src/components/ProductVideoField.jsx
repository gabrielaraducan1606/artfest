import { useEffect, useRef, useState } from "react";
import { FaVideo, FaSync, FaTrash } from "react-icons/fa";

import styles from "../pages/Vendor/ProfilMagazin/components/css/ProductModal.module.css";

const NETWORK_ERROR_MESSAGE =
  "Nu am putut încărca videoul. Verifică conexiunea și încearcă din nou.";

const AUTH_ERROR_MESSAGE =
  "Trebuie să fii autentificat pentru a încărca un video.";

/*
 * Trebuie să rămână identic cu limita reală, aplicată server-side
 * (backend/src/routes/uploadRoutes.js, ALLOWED_VIDEO_MIME_TYPES +
 * limits.fileSize = 50*1024*1024) - verificăm ÎNAINTE de upload ca
 * vendorul să afle imediat, nu după ce așteaptă un upload de zeci
 * de MB să eșueze cu 413.
 */
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;

const SIZE_ERROR_MESSAGE =
  "Videoul este prea mare (peste 50 MB). Alege un fișier mai mic sau comprimă-l înainte de a-l încărca.";

const TYPE_ERROR_MESSAGE =
  "Acest tip de fișier nu este acceptat. Încarcă un video MP4 sau WebM.";

/**
 * Câmp reutilizabil pentru videoul (opțional) al unui produs.
 * Se folosește DOAR de `videoUrl`, nu atinge `images[]`.
 *
 * `videoMuted: true` înseamnă că fișierul de la `videoUrl` NU mai
 * are fizic pistă audio (eliminată prin remux pe server) - nu doar
 * "pornește mut". Odată eliminată, pista audio nu se poate reface
 * fără reîncărcarea originalului, de asta switch-ul se blochează
 * (disabled) cât timp `videoMuted` e true.
 *
 * Folosit în: ProductModal (formular manual), ProductEditModal,
 * VendorProductWizard (AI assistant).
 */
export default function ProductVideoField({
  videoUrl,
  onChange,
  videoMuted = false,
  onMutedChange,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const uploadingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [muting, setMuting] = useState(false);
  const [error, setError] = useState("");
  const [previewFrameReady, setPreviewFrameReady] = useState(false);

  // Orice eroare veche nu mai are ce căuta lângă un video nou/diferit
  // - fiecare `videoUrl` primit din afară pornește "curat": fără
  // eroare afișată și cu preview-ul de frame resetat.
  useEffect(() => {
    setError("");
    setPreviewFrameReady(false);
  }, [videoUrl]);

  const handlePreviewLoadedMetadata = (e) => {
    const el = e.currentTarget;
    const duration =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    const target = duration > 0 ? Math.min(0.1, Math.max(0, duration - 0.05)) : 0.1;

    try {
      el.currentTime = target;
    } catch {
      /* fallback-ul neutru rămâne vizibil */
    }
  };

  async function handleFile(file) {
    if (!file) return;

    // Gardă sincronă, în plus față de `disabled` pe buton - nu
    // permite un al doilea upload concurent (ex. dublu-click).
    if (uploadingRef.current) return;

    setError("");

    // Verificare client-side, înainte de orice request de rețea -
    // aceleași reguli ca server-side (tip + 50 MB), doar mai rapidă
    // pentru vendor (nu mai așteaptă un upload mare ca să afle abia
    // apoi că a fost respins).
    if (
      file.type &&
      !["video/mp4", "video/webm"].includes(file.type)
    ) {
      setError(TYPE_ERROR_MESSAGE);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      return;
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      setError(SIZE_ERROR_MESSAGE);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      return;
    }

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
            fd.append("muted", videoMuted ? "true" : "false");
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

  async function handleMuteToggle(nextChecked) {
    // Nu se poate reveni la "cu sunet" din switch - pista audio a
    // fost deja eliminată fizic. Butonul e oricum disabled în acest
    // caz, dar păstrăm garda și aici.
    if (!nextChecked || !videoUrl || muting) return;

    setError("");
    setMuting(true);

    try {
      let res;

      try {
        res = await fetch("/api/upload/products/video/mute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ videoUrl }),
        });
      } catch {
        throw new Error(NETWORK_ERROR_MESSAGE);
      }

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (!data?.message && (res.status === 401 || res.status === 403)) {
          throw new Error(AUTH_ERROR_MESSAGE);
        }

        throw new Error(data?.message || NETWORK_ERROR_MESSAGE);
      }

      if (!data?.url) {
        throw new Error(NETWORK_ERROR_MESSAGE);
      }

      // videoUrl-ul vechi (cu sunet) a fost deja șters pe server -
      // comutăm pe cel nou abia acum, la succes.
      onChange?.(data.url);
      onMutedChange?.(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : NETWORK_ERROR_MESSAGE);
    } finally {
      setMuting(false);
    }
  }

  const isDisabled = disabled || uploading || muting;

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
          <div className={styles.videoPreviewMediaWrap}>
            <video
              src={videoUrl}
              controls
              playsInline
              preload="metadata"
              muted
              className={styles.videoPreviewPlayer}
              onLoadedMetadata={handlePreviewLoadedMetadata}
              onSeeked={() => setPreviewFrameReady(true)}
              onLoadedData={() => setPreviewFrameReady(true)}
            />

            {!previewFrameReady && (
              <div className={styles.videoPreviewFallback} aria-hidden="true">
                <FaVideo className={styles.videoPreviewFallbackIcon} />
                <span className={styles.videoPreviewFallbackLabel}>
                  Video
                </span>
              </div>
            )}
          </div>

          <label className={styles.muteSwitchRow}>
            <span className={styles.muteSwitch}>
              <input
                type="checkbox"
                role="switch"
                checked={!!videoMuted}
                disabled={isDisabled || !!videoMuted}
                onChange={(e) => handleMuteToggle(e.target.checked)}
                className={styles.muteSwitchInput}
              />
              <span className={styles.muteSwitchTrack}>
                <span className={styles.muteSwitchThumb} />
              </span>
            </span>

            <span className={styles.muteSwitchText}>
              <span className={styles.muteSwitchLabel}>
                Redă video fără sunet
              </span>
              <span className={styles.muteSwitchHint}>
                {videoMuted
                  ? "Acest video nu mai are pistă audio. Pentru a reactiva sunetul, încarcă din nou fișierul original (Înlocuiește)."
                  : muting
                  ? "Se elimină sunetul din video..."
                  : "Odată activat, sunetul este eliminat definitiv din fișier - clientul nu îl va putea reactiva."}
              </span>
            </span>
          </label>

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
                onMutedChange?.(false);
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
