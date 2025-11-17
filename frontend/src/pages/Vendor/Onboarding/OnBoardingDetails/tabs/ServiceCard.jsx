import React, { useEffect } from "react";
import styles from "../OnBoardingDetails.module.css";
import ChipsInput from "../../fields/ChipsInput.jsx";

/* helpers */
const isPhoneRO = (v) => /^(\+4)?0?7\d{8}$/.test((v || "").replace(/\s+/g, ""));

/* coverage helpers (pentru input text cu virgulă) */
function stringifyCoverage(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const head = arr[0];
  const list = head === "counties" ? arr.slice(1) : arr;
  return list.join(", ");
}
function parseCoverage(str) {
  const parts = (str || "").split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? ["counties", ...parts] : [];
}

/* UI mici */
function Row({ id, label, children, error, help }) {
  return (
    <div className={styles.fieldRow}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <div className={styles.fieldCol}>
        {children}
        {help && <small className={styles.help}>{help}</small>}
        {error && <small className={styles.fieldError} id={`${id}-err`}>{error}</small>}
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
  updateServiceBasics,
  uploadFile,
  setErr,
  nameState,   // opțional, dacă vrei să-l injectezi din părinte
  slugState,
  countiesLoading = false,
  countiesErr = "",
}) {
  const p = s.profile || {};
  const attrs = s.attributes || {};

  useEffect(() => {
    const profCity = (p.city || "").trim();
    if (profCity && !s.city) updateServiceBasics?.(idx, { city: profCity });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phoneErr = p.phone && !isPhoneRO(p.phone) ? "Număr invalid (+40 7xx…)" : "";

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
      if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) throw new Error("PNG/JPG/WebP doar.");
      if (f.size > 3 * 1024 * 1024) throw new Error("Maxim 3 MB.");
      const url = await uploadFile(f);
      updateProfile(idx, { [key]: url });
    } catch (er) {
      setErr?.(er?.message || "Upload eșuat");
    } finally {
      e.target.value = "";
    }
  }

  function onCountiesChangeText(v) {
    updateProfile(idx, { delivery: parseCoverage(v) });
  }

  function setAttrs(patch) {
    updateServiceBasics(idx, { attributes: { ...attrs, ...patch } });
  }

  const linkPreview = p.slug?.trim()
    ? `https://${vanityBase.replace(/\/+$/, "")}/magazin/${p.slug.trim()}`
    : "";

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={styles.typeCode}>{s.type?.code || s.typeCode}</span>
          <h2 className={styles.cardTitle}>{s.type?.name || "Serviciu"}</h2>
        </div>
        <div className={styles.saveIndicator} aria-live="polite">
          {saveState === "saving" && <span className={styles.badgeWait}>Se salvează…</span>}
          {saveState === "saved"  && <span className={styles.badgeOk}>Salvat</span>}
          {saveState === "error"  && <span className={styles.badgeBad}>Eroare</span>}
        </div>
      </div>

      {/* container non-form pentru a evita nested <form> */}
      <div className={styles.form} style={{ padding: 12 }} role="group" aria-labelledby={`service-${s.id}-legend`}>
        {/* Identitate */}
        <fieldset className={styles.fieldset}>
          <legend id={`service-${s.id}-legend`} className={styles.legend}>Identitate</legend>

          <Row id={`brand-${s.id}`} label="Nume brand / artizan *">
            <input
              id={`brand-${s.id}`}
              className={styles.input}
              value={p.displayName || ""}
              onChange={(e) => onName(e.target.value)}
              placeholder="ex: Atelierul Ana"
              aria-describedby={`brand-${s.id}-hint`}
            />
            {nameState?.state === "checking" && <small className={styles.help} id={`brand-${s.id}-hint`}>Se verifică disponibilitatea…</small>}
            {nameState?.state === "done" && nameState?.available === true && <small className={styles.help} id={`brand-${s.id}-hint`}>✅ Nume disponibil</small>}
            {nameState?.state === "done" && nameState?.available === false && <small className={styles.fieldError} id={`brand-${s.id}-hint`}>❌ Numele este deja folosit</small>}
            {nameState?.state === "error" && <small className={styles.fieldError} id={`brand-${s.id}-hint`}>Eroare la verificare</small>}
          </Row>

          <Row id={`slug-${s.id}`} label="Link public (slug) *" help={linkPreview || "ex: atelierul-ana"}>
            <input
              id={`slug-${s.id}`}
              className={styles.input}
              value={p.slug || ""}
              onChange={(e) => onSlug(e.target.value)}
              placeholder="ex: atelierul-ana"
              aria-describedby={`slug-${s.id}-hint`}
            />
            {slugState?.state === "checking" && <small className={styles.help} id={`slug-${s.id}-hint`}>Se verifică slug-ul…</small>}
            {slugState?.state === "done" && slugState?.available === true && <small className={styles.help} id={`slug-${s.id}-hint`}>✅ Slug disponibil</small>}
            {slugState?.state === "done" && slugState?.available === false && (
              <small className={styles.fieldError} id={`slug-${s.id}-hint`}>
                ❌ Slug ocupat{slugState?.suggestion ? ` — sugestie: ${slugState?.suggestion}` : ""}
              </small>
            )}
            {slugState?.state === "error" && <small className={styles.fieldError} id={`slug-${s.id}-hint`}>Eroare la verificare</small>}
          </Row>

          <div className={styles.grid2}>
            <Row id={`logo-${s.id}`} label="Logo / poză *">
              <input type="file" accept="image/*" onChange={(e) => onUpload(e, "logoUrl")} />
              {p.logoUrl && <img src={p.logoUrl} alt="Logo" className={styles.previewThumb} />}
            </Row>
            <Row id={`cover-${s.id}`} label="Copertă (opțional)" help="recomandat 1920×600, max 3MB">
              <input type="file" accept="image/*" onChange={(e) => onUpload(e, "coverUrl")} />
              {p.coverUrl && <img src={p.coverUrl} alt="Cover" className={styles.previewBanner} />}
            </Row>
          </div>

          <Row id={`address-${s.id}`} label="Adresă sediu / atelier *">
            <input
              id={`address-${s.id}`}
              className={styles.input}
              value={p.address || ""}
              onChange={(e) => updateProfile(idx, { address: e.target.value })}
              placeholder="Str. Exemplu 10, București"
            />
          </Row>

          <div className={styles.grid2}>
            <Row id={`phone-${s.id}`} label="Telefon public (opțional)" error={phoneErr}>
              <input
                id={`phone-${s.id}`}
                className={styles.input}
                value={p.phone || ""}
                onChange={(e) => updateProfile(idx, { phone: e.target.value })}
                onBlur={(e) => {
                  const raw = e.target.value.replace(/\s+/g, "");
                  if (/^0?7\d{8}$/.test(raw)) {
                    updateProfile(idx, { phone: `+4${raw.startsWith("0") ? raw.slice(1) : raw}` });
                  }
                }}
                placeholder="+40 7xx xxx xxx"
              />
            </Row>
            <Row id={`email-${s.id}`} label="Email public (opțional)">
              <input
                id={`email-${s.id}`}
                className={styles.input}
                value={p.email || ""}
                onChange={(e) => updateProfile(idx, { email: e.target.value })}
                placeholder="contact@brand.ro"
                type="email"
              />
            </Row>
          </div>

          <Row id={`about-${s.id}`} label="Despre (opțional)" help="Scurtă poveste a brandului (se poate completa și ulterior)">
            <textarea
              id={`about-${s.id}`}
              className={styles.input}
              rows={6}
              value={p.about || ""}
              onChange={(e) => updateProfile(idx, { about: e.target.value })}
              placeholder="Povestea brandului, ce creezi, cum lucrezi, ce te diferențiază…"
            />
          </Row>
        </fieldset>

        {/* Comercial & livrare */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Comercial & livrare</legend>

          <Row id={`deliveryMethods-${s.id}`} label="Metodă de livrare">
            <input id={`deliveryMethods-${s.id}`} className={styles.input} value="Curier Sameday" readOnly />
            <small className={styles.help}>
              Livrarea pe platformă se face exclusiv prin <strong>Sameday</strong>. Detalii și acceptare sunt în{" "}
              <a href="/legal/vendor/onboarding" target="_blank" rel="noreferrer">Acordul Master</a>.
            </small>
          </Row>

          <Row id={`leadTimes-${s.id}`} label="Termene execuție / disponibilitate">
            <input
              id={`leadTimes-${s.id}`}
              className={styles.input}
              value={attrs.leadTimes || ""}
              onChange={(e) => setAttrs({ leadTimes: e.target.value })}
              placeholder="ex: 3–5 zile lucr., programare cu 2 săpt."
            />
          </Row>

          <Row id={`delivery-${s.id}`} label="Zonă acoperire *" help={countiesLoading ? "Se încarcă județele…" : "Alege județe sau 'Toată țara' (exclusiv)"}>
            <input
              className={styles.input}
              value={stringifyCoverage(p.delivery)}
              onChange={(e) => onCountiesChangeText(e.target.value)}
              placeholder="Toată țara, București, Ilfov…"
            />
            {/* alternativ: ChipsInput (dacă preferi chips-uri) */}
            {/* <ChipsInput
              value={Array.isArray(p.delivery) ? p.delivery : []}
              onChange={(arr) => updateProfile(idx, { delivery: arr })}
              suggestions={countySuggestions}
              placeholder="Toată țara, București, Ilfov…"
            /> */}
            {countiesErr && <small className={styles.fieldError}>{countiesErr}</small>}
          </Row>

          <div className={styles.stack}>
            <small className={styles.help}>
              Politica Sameday este inclusă în Acordul Master. <a href="/policies/courier-sameday" target="_blank" rel="noreferrer">Vezi detalii</a>.
            </small>
          </div>
        </fieldset>

        {/* Acorduri */}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Acorduri</legend>

          <div className={styles.stack}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={!!attrs.masterAgreementAccepted}
                onChange={(e) => {
                  const checked = !!e.target.checked;
                  setAttrs({
                    masterAgreementAccepted: checked,
                    masterAgreementVersion: "v1.0",
                    masterAgreementAcceptedAt: checked ? new Date().toISOString() : null,
                  });
                }}
              />
              <span>
                Accept{" "}
                <a href="/legal/vendor/onboarding" target="_blank" rel="noreferrer">
                  Acordul Master pentru Vânzători
                </a>{" "}
                (v1.0)
              </span>
            </label>
          </div>

          {saveState === "error" && saveError && <div className={styles.error} role="alert">{saveError}</div>}
        </fieldset>
      </div>
    </div>
  );
}
