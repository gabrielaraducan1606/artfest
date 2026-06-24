import React from "react";
import styles from "../OnBoardingDetails.module.css";

function Row({ id, label, children, error, help }) {
  return (
    <div className={styles.fieldRow}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.fieldCol}>
        {children}
        {help && <small className={styles.help}>{help}</small>}
        {error && (
          <small className={styles.fieldError} id={`${id}-err`}>
            {error}
          </small>
        )}
      </div>
    </div>
  );
}

export default function ServiceCard({
  service: s,
  idx,
  vanityBase,
  saveState = "idle",
  saveError = "",
  updateProfile,
  uploadFile,
  setErr,
  nameState,
  slugState,
}) {
  const p = s.profile || {};

  function onName(val) {
    updateProfile(idx, { displayName: val, _autoSlugFromName: true });
  }

  function onSlug(val) {
    const norm = val.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    updateProfile(idx, { slug: norm, _touchSlug: true });
  }

  async function onUpload(e, key) {
    const f = e.target.files?.[0];
    if (!f) return;

    try {
      if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
        throw new Error("PNG/JPG/WebP doar.");
      }

      if (f.size > 3 * 1024 * 1024) {
        throw new Error("Maxim 3 MB.");
      }

      const url = await uploadFile(f);
      updateProfile(idx, { [key]: url });
    } catch (er) {
      setErr?.(er?.message || "Upload eșuat");
    } finally {
      e.target.value = "";
    }
  }

  const linkPreview = p.slug?.trim()
    ? `https://${vanityBase.replace(/\/+$/, "")}/magazin/${p.slug.trim()}`
    : "";

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={styles.typeCode}>{s.type?.code || s.typeCode}</span>
          <h2 className={styles.cardTitle}>{s.type?.name || "Magazin"}</h2>
        </div>

        <div className={styles.saveIndicator} aria-live="polite">
          {saveState === "saving" && (
            <span className={styles.badgeWait}>Se salvează…</span>
          )}
          {saveState === "saved" && (
            <span className={styles.badgeOk}>Salvat</span>
          )}
          {saveState === "error" && (
            <span className={styles.badgeBad}>Eroare</span>
          )}
        </div>
      </div>

      <div
        className={styles.form}
        style={{ padding: 12 }}
        role="group"
        aria-labelledby={`service-${s.id}-legend`}
      >
        <fieldset className={styles.fieldset}>
          <legend id={`service-${s.id}-legend`} className={styles.legend}>
            Profil public
          </legend>

          <Row id={`brand-${s.id}`} label="Nume brand / artizan *">
            <input
              id={`brand-${s.id}`}
              className={styles.input}
              value={p.displayName || ""}
              onChange={(e) => onName(e.target.value)}
              placeholder="ex: Atelierul Ana"
              aria-describedby={`brand-${s.id}-hint`}
            />

            {nameState?.state === "checking" && (
              <small className={styles.help} id={`brand-${s.id}-hint`}>
                Se verifică disponibilitatea…
              </small>
            )}

            {nameState?.state === "done" && nameState?.available === true && (
              <small className={styles.help} id={`brand-${s.id}-hint`}>
                ✅ Nume disponibil
              </small>
            )}

            {nameState?.state === "done" && nameState?.available === false && (
              <small className={styles.fieldError} id={`brand-${s.id}-hint`}>
                ❌ Numele este deja folosit
              </small>
            )}

            {nameState?.state === "error" && (
              <small className={styles.fieldError} id={`brand-${s.id}-hint`}>
                Eroare la verificare
              </small>
            )}
          </Row>

          <Row
            id={`slug-${s.id}`}
            label="Link public (slug) *"
            help={linkPreview || "ex: atelierul-ana"}
          >
            <input
              id={`slug-${s.id}`}
              className={styles.input}
              value={p.slug || ""}
              onChange={(e) => onSlug(e.target.value)}
              placeholder="ex: atelierul-ana"
              aria-describedby={`slug-${s.id}-hint`}
            />

            {slugState?.state === "checking" && (
              <small className={styles.help} id={`slug-${s.id}-hint`}>
                Se verifică slug-ul…
              </small>
            )}

            {slugState?.state === "done" && slugState?.available === true && (
              <small className={styles.help} id={`slug-${s.id}-hint`}>
                ✅ Slug disponibil
              </small>
            )}

            {slugState?.state === "done" && slugState?.available === false && (
              <small className={styles.fieldError} id={`slug-${s.id}-hint`}>
                ❌ Slug ocupat
                {slugState?.suggestion ? ` — sugestie: ${slugState.suggestion}` : ""}
              </small>
            )}

            {slugState?.state === "error" && (
              <small className={styles.fieldError} id={`slug-${s.id}-hint`}>
                Eroare la verificare
              </small>
            )}
          </Row>

          <div className={styles.grid2}>
            <Row id={`logo-${s.id}`} label="Logo / poză *">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onUpload(e, "logoUrl")}
              />
              {p.logoUrl && (
                <img
                  src={p.logoUrl}
                  alt="Logo"
                  className={styles.previewThumb}
                />
              )}
            </Row>

            <Row
              id={`cover-${s.id}`}
              label="Copertă (opțional)"
              help="Recomandat 1920×600, max 3MB."
            >
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onUpload(e, "coverUrl")}
              />
              {p.coverUrl && (
                <img
                  src={p.coverUrl}
                  alt="Cover"
                  className={styles.previewBanner}
                />
              )}
            </Row>
          </div>

          <Row
            id={`short-${s.id}`}
            label="Descriere scurtă (opțional)"
            help="O poți completa și mai târziu."
          >
            <input
              id={`short-${s.id}`}
              className={styles.input}
              value={p.shortDescription || ""}
              onChange={(e) =>
                updateProfile(idx, {
                  shortDescription: e.target.value.slice(0, 120),
                })
              }
              placeholder="ex: Magazin bijuterii handmade"
            />
          </Row>

          <Row
            id={`about-${s.id}`}
            label="Despre magazin (opțional)"
            help="Povestea brandului se poate completa și ulterior."
          >
            <textarea
              id={`about-${s.id}`}
              className={styles.input}
              rows={6}
              value={p.about || ""}
              onChange={(e) => updateProfile(idx, { about: e.target.value })}
              placeholder="Povestea brandului, ce creezi, cum lucrezi…"
            />
          </Row>

          {saveState === "error" && saveError && (
            <div className={styles.error} role="alert">
              {saveError}
            </div>
          )}
        </fieldset>
      </div>
    </div>
  );
}