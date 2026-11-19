// src/features/creators/creatorsShared.jsx
//
// Artfest Creators - componente comune: încărcarea unei fotografii,
// previzualizarea profilului, dialogul de confirmare, skeleton.
// (hook-ul de stare și utilitarele sunt în creatorsClient.js)

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, UserRound } from "lucide-react";

import { formatFollowers, friendlyError } from "./creatorsLogic.js";
import { cx, labelOf, uploadCreatorImage } from "./creatorsClient.js";
import styles from "./Creators.module.css";

export function PhotoPicker({ label, onUploaded, disabled, children }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onUploaded(await uploadCreatorImage(file));
    } catch (e) {
      setError(friendlyError(e, "Nu am putut încărca fotografia. Încearcă din nou."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" className={styles.fileInput} onChange={onChange} tabIndex={-1} aria-hidden="true" />
      <button type="button" className={styles.btn} onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
        {busy ? <Loader2 size={18} aria-hidden="true" /> : <ImagePlus size={18} aria-hidden="true" />}
        {busy ? "Se încarcă…" : children || label}
      </button>
      {error && (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------------- previzualizare (ce va vedea publicul) ---------------- */

export function CreatorProfilePreview({ profile, options }) {
  if (!profile) return null;
  const socials = profile.socials || [];
  return (
    <article className={styles.preview} aria-label="Previzualizarea profilului">
      <div className={styles.previewCover} />
      <div className={styles.previewBody}>
        {profile.avatarUrl ? (
          <img className={styles.previewAvatar} src={profile.avatarUrl} alt="" />
        ) : (
          <div className={cx(styles.previewAvatar, styles.avatarPlaceholder)}>
            <UserRound size={34} aria-hidden="true" />
          </div>
        )}
        <h3 className={styles.previewName}>{profile.displayName || "Numele tău public"}</h3>
        <p className={cx(styles.muted, styles.small)}>
          {[profile.city, ...(profile.niches || []).map((n) => labelOf(options?.niches, n))].filter(Boolean).join(" · ") || "Nișele tale"}
        </p>
        <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{profile.bio || "Descrierea ta apare aici."}</p>

        {socials.length > 0 && (
          <div className={styles.previewSocials}>
            {socials.map((s) => (
              <div key={s.platform} className={styles.previewSocial}>
                <span>
                  <strong>{labelOf(options?.platforms, s.platform)}</strong> @{s.handle}
                </span>
                <span>
                  {formatFollowers(s.followersDeclared)} urmăritori <span className={styles.declared}>(declarat)</span>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className={styles.chips}>
          {profile.acceptsProducts && <span className={cx(styles.badge, styles.tone_success)}>Acceptă produse</span>}
          {profile.acceptsPaid && <span className={cx(styles.badge, styles.tone_info)}>Promovare plătită</span>}
          {profile.typicalTurnaroundDays ? <span className={cx(styles.badge, styles.tone_muted)}>~{profile.typicalTurnaroundDays} zile</span> : null}
        </div>
        <p className={cx(styles.hint)} style={{ marginTop: 12 }}>
          Statisticile sunt declarate de tine și apar marcate ca „declarat”. Emailul, telefonul și datele de plată nu apar niciodată public.
        </p>
      </div>
    </article>
  );
}

/* ---------------- dialog de confirmare ---------------- */

export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "Renunță", onConfirm, onCancel, busy = false, danger = false, confirmDisabled = false }) {
  const confirmRef = useRef(null);
  // ultimele valori, fără să re-rulăm efectul (onCancel e de obicei o funcție nouă la fiecare randare)
  const latest = useRef({ busy, onCancel });
  latest.current = { busy, onCancel };

  // focus DOAR la deschidere: altfel fiecare tastă dintr-un câmp al dialogului (ex. motivul)
  // ar muta focusul pe butonul de confirmare
  useEffect(() => {
    const previous = document.activeElement;
    const first = confirmRef.current?.closest("[role='dialog']")?.querySelector("textarea, input, select");
    (first || confirmRef.current)?.focus();
    const onKey = (e) => e.key === "Escape" && !latest.current.busy && latest.current.onCancel();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className={styles.dialogBackdrop} role="presentation" onClick={() => !busy && onCancel()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="creators-dialog-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="creators-dialog-title" className={styles.cardTitle}>
          {title}
        </h2>
        <div style={{ margin: "12px 0 18px", lineHeight: 1.55 }}>{children}</div>
        <div className={styles.actions} style={{ justifyContent: "flex-end" }}>
          <button type="button" className={styles.btnGhost} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className={danger ? styles.btnDanger : styles.btnPrimary} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {busy ? "Se trimite…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SkeletonBlock({ height = 120 }) {
  return <div className={styles.skeleton} style={{ height }} aria-hidden="true" />;
}
