// Varianta completă – fără rețele sociale / fără limbi
import React, { useMemo, useState } from "react";
import styles from "../OnBoardingDetails.module.css";
import ChipsInput from "../../fields/ChipsInput.jsx";
import COUNTIES_RO from "../../constants/countiesRo.js";

/* ---------- Opțiuni fallback ---------- */
const DOMAIN_OPTIONS = [
  "Bijuterii & accesorii","Papetărie & invitații","Decor & home","Ceramică & sticlă",
  "Lumânări & arome","Cosmetice naturale","Textile & fashion","Ilustrație & print",
  "Floristică","Foto/Video & servicii","Cadouri personalizate","Jucării & copii",
];
const BUSINESS_TYPE_OPTIONS = [
  "Producător / Atelier","Artizan individual","Retailer / Reseller",
  "Furnizor servicii personalizare","Studio (foto/video/design)","Organizator evenimente",
];
const PRODUCT_FAMILY_OPTIONS = [
  "Invitații","Plicuri & etichete","Lumânări","Ceramică",
  "Textile (pungi, tricouri, tote)","Bijuterii","Accesorii păr","Cosmetice naturale",
  "Ilustrații / printuri","Pictură","Decorațiuni casă","Jucării","Papetărie nuntă/botez",
  "Aranjamente florale","Servicii foto/video",
];

/* ---------- Utils ---------- */
function slugify(s = "") {
  return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
const isPhoneRO = (v) => /^(\+4)?0?7\d{8}$/.test((v || "").replace(/\s+/g, ""));

/* ---------- UI helper ---------- */
function Field({ label, children, help, error, id }) {
  const ariaProps = {};
  if (error) {
    ariaProps["aria-invalid"] = true;
    ariaProps["aria-describedby"] = `${id}-err`;
  }
  return (
    <div className={styles.fieldRow}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <div className={styles.fieldCol}>
        <div {...ariaProps}>{children}</div>
        {help ? <small className={styles.help}>{help}</small> : null}
        {error ? <small id={`${id}-err`} className={styles.error}>{error}</small> : null}
      </div>
    </div>
  );
}

/* ---------- Specificații dinamice ---------- */
function SpecField({ f, value, onChange }) {
  const req = f?.required ? " *" : "";
  const type = f?.type || "text";

  if (type === "number") {
    return (
      <Field label={`${f.label}${req}`} help={f.help}>
        <input
          className={styles.field}
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          placeholder={f.placeholder || ""}
        />
      </Field>
    );
  }

  if (type === "select") {
    return (
      <Field label={`${f.label}${req}`} help={f.help}>
        <select
          className={styles.field}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">— alege —</option>
          {(f.options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </Field>
    );
  }

  if (type === "multi_select") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <Field label={`${f.label}${req}`} help={f.help}>
        <div className={styles.tagsWrap}>
          {(f.options || []).map((opt) => {
            const checked = arr.includes(opt);
            return (
              <label key={opt} className={styles.tagCheck}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(arr);
                    e.target.checked ? next.add(opt) : next.delete(opt);
                    onChange(Array.from(next));
                  }}
                /> {opt}
              </label>
            );
          })}
        </div>
      </Field>
    );
  }

  if (type === "checkbox_with_details") {
    const v = value || { checked: false, details: "" };
    return (
      <Field label={`${f.label}${req}`} help={f.help}>
        <label className={styles.inline}>
          <input
            type="checkbox"
            checked={!!v.checked}
            onChange={(e) => onChange({ ...v, checked: !!e.target.checked })}
          /> activ
        </label>
        <input
          className={styles.field}
          placeholder={f.placeholder || "Detalii"}
          value={v.details || ""}
          onChange={(e) => onChange({ ...v, details: e.target.value })}
          disabled={!v.checked}
        />
      </Field>
    );
  }

  return (
    <Field label={`${f.label}${req}`} help={f.help}>
      <input
        className={styles.field}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder={f.placeholder || ""}
      />
    </Field>
  );
}

/* ---------- Card Serviciu ---------- */
function ServiceCard({
  service, idx,
  availability, linkAvailability, vanityBase,
  saveState, saveError,
  updateProfile, updateServiceBasics, uploadFile,
  slugTouchedMap, setSlugTouchedMap,
}) {
  const p = service.profile || {};
  const nameAv = availability || { state: "idle", available: null };
  const linkAv = linkAvailability || { state: "idle", available: null };

  const [taglineCount, setTaglineCount] = useState((p.tagline || "").length);

  async function onUpload(e, key) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) throw new Error("Imaginea trebuie să fie PNG/JPG/WebP.");
      if (f.size > 3 * 1024 * 1024) throw new Error("Maxim 3 MB.");
      const url = await uploadFile(f);
      updateProfile(idx, { [key]: url });
    } catch (err) {
      alert(err?.message || "Upload eșuat");
    } finally {
      e.target.value = "";
    }
  }

  function onDisplayNameChange(val) {
    updateProfile(idx, { displayName: val });
    const id = service.id;
    if (!slugTouchedMap[id]) updateProfile(idx, { slug: slugify(val) });
  }
  function onSlugChange(val) {
    const id = service.id;
    setSlugTouchedMap((m) => ({ ...m, [id]: true }));
    updateProfile(idx, { slug: val.toLowerCase().replace(/[^a-z0-9-]/g, "-") });
  }

  const linkPreview = (p.slug || "").trim()
    ? `https://${vanityBase.replace(/\/+$/, "")}/magazin/${(p.slug || "").trim()}`
    : "";

  // Fields din backend sau fallback
  let fields = [];
  if (Array.isArray(service.type?.fields)) fields = service.type.fields;
  else if (typeof service.type?.fields === "string") {
    try { fields = JSON.parse(service.type.fields) || []; } catch { fields = []; }
  }
  if (!fields.length) {
    fields = [
      { key: "domain", label: "Domeniu", type: "select", required: true, options: DOMAIN_OPTIONS, help: "Verticala principală." },
      { key: "businessType", label: "Tip business", type: "select", required: true, options: BUSINESS_TYPE_OPTIONS, help: "Modelul tău principal." },
      { key: "listedProducts", label: "Produse listate", type: "multi_select", options: PRODUCT_FAMILY_OPTIONS, help: "Familiile pe care le vei lista." },
    ];
  }

  const phoneErr = p.phone && !isPhoneRO(p.phone) ? "Număr invalid (ex: +40 7xx xxx xxx)" : "";
  const deliveryArr = Array.isArray(p.delivery) ? p.delivery : [];

  return (
    <div className={styles.card} key={service.id}>
      <div className={styles.cardHead}>
        <div className={styles.serviceName}>{service.type?.name || "Serviciu"}</div>
        <div className={styles.subtle}>
          {saveState === "saving" ? "Se salvează…" :
           saveState === "saved"  ? "Salvat" :
           saveState === "error"  ? (saveError || "Eroare la salvare") : "—"}
        </div>
      </div>

      {/* Identitate */}
      <h4 className={styles.sectionTitle}>Identitate</h4>

      <Field label="Numele brandului *" id={`brand-${service.id}`}>
        <input
          id={`brand-${service.id}`}
          className={styles.field}
          value={p.displayName || ""}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          placeholder="Ex: Artfest"
        />
        {nameAv?.state === "done" && nameAv?.available === false && (
          <small className={styles.error}>Numele este ocupat.</small>
        )}
      </Field>

      <Field
        label="Link public (slug) *"
        id={`slug-${service.id}`}
        help={linkPreview ? linkPreview : "Acesta este linkul public al magazinului tău."}
        error={linkAv?.state === "done" && linkAv?.available === false ? `Link-ul este ocupat${linkAv?.suggestion ? ` — sugestie: ${linkAv.suggestion}` : ""}.` : ""}
      >
        <input
          id={`slug-${service.id}`}
          className={styles.field}
          value={p.slug || ""}
          onChange={(e) => onSlugChange(e.target.value)}
          placeholder="ex: artfest"
        />
        {linkAv?.state === "done" && linkAv?.available === false && linkAv?.suggestion && (
          <button type="button" className={styles.link} onClick={() => onSlugChange(linkAv.suggestion)} style={{ marginTop: 6 }}>
            Folosește sugestia: {linkAv.suggestion}
          </button>
        )}
      </Field>

      <div className={styles.grid2}>
        <Field label="Logo (min. 1 imagine obligatoriu)" id={`logo-${service.id}`}>
          <input type="file" accept="image/*" onChange={(e)=>onUpload(e,"logoUrl")} />
          {p.logoUrl && <img src={p.logoUrl} alt="Logo" style={{ height: 60, marginTop: 8, borderRadius: 8 }} />}
        </Field>
        <Field label="Copertă" id={`cover-${service.id}`} help="Recomandat: 1920×600, max 3MB">
          <input type="file" accept="image/*" onChange={(e)=>onUpload(e,"coverUrl")} />
          {p.coverUrl && <img src={p.coverUrl} alt="Copertă" style={{ height: 60, marginTop: 8, borderRadius: 8, objectFit:"cover" }} />}
        </Field>
      </div>

      <Field label="Descriere scurtă (tagline) *" id={`tagline-${service.id}`} help={`Max 160 caractere • ${taglineCount}/160`}>
        <input
          id={`tagline-${service.id}`}
          className={styles.field}
          value={p.tagline || ""}
          onChange={(e) => { setTaglineCount(e.target.value.length); updateProfile(idx, { tagline: e.target.value.slice(0,160) }); }}
          placeholder="ex: Invitații de nuntă personalizate, în 48h."
          maxLength={160}
        />
      </Field>

      {/* Serviciu de bază */}
      <h4 className={styles.sectionTitle}>Serviciu de bază</h4>

      <Field label="Titlu/Pachet *" id={`title-${service.id}`}>
        <input
          id={`title-${service.id}`}
          className={styles.field}
          value={service.title || ""}
          onChange={(e) => updateServiceBasics(idx, { title: e.target.value })}
          placeholder="Ex: Magazin invitații – pachet standard"
        />
      </Field>

      <Field label="Oraș serviciu *" id={`city-${service.id}`} help="Folosește orașul principal de operare.">
        <input
          id={`city-${service.id}`}
          className={styles.field}
          value={service.city || ""}
          onChange={(e) => updateServiceBasics(idx, { city: e.target.value })}
          placeholder="Ex: București"
        />
      </Field>

      {/* Contact & zonă */}
      <h4 className={styles.sectionTitle}>Contact & Zonă</h4>

      <Field label="Preferință contact" id={`pref-${service.id}`} help="Așa vom prioritiza mesajele cumpărătorilor.">
        <div className={styles.tagsWrap} role="radiogroup" aria-label="Preferință contact">
          {["messages","phone","email"].map(opt => (
            <label key={opt} className={styles.tagCheck}>
              <input
                type="radio"
                name={`contactPref-${service.id}`}
                checked={(p.contactPreference || "messages") === opt}
                onChange={() => updateProfile(idx, { contactPreference: opt })}
              /> { opt === "messages" ? "Mesagerie internă" : opt === "phone" ? "Telefon" : "Email" }
            </label>
          ))}
        </div>
      </Field>

      <div className={styles.grid2}>
        <Field label="Telefon (opțional)" id={`phone-${service.id}`} error={phoneErr}>
          <input
            id={`phone-${service.id}`}
            className={styles.field}
            value={p.phone || ""}
            onChange={(e) => updateProfile(idx, { phone: e.target.value })}
            onBlur={(e) => {
              const raw = e.target.value.replace(/\s+/g, "");
              if (/^0?7\d{8}$/.test(raw)) updateProfile(idx, { phone: `+4${raw.startsWith("0") ? raw.slice(1) : raw}` });
            }}
            placeholder="+40 7xx xxx xxx"
          />
        </Field>

        <Field label="Email public (opțional)" id={`email-${service.id}`}>
          <input
            id={`email-${service.id}`}
            className={styles.field}
            value={p.email || ""}
            onChange={(e) => updateProfile(idx, { email: e.target.value })}
            placeholder="contact@brand.ro"
            type="email"
          />
        </Field>
      </div>

      <Field label="Zonă acoperire *" id={`delivery-${service.id}`} help="Alege județe/zone sau adaugă liber (Enter).">
        <ChipsInput
          value={deliveryArr}
          onChange={(arr) => updateProfile(idx, { delivery: arr })}
          suggestions={COUNTIES_RO}
          placeholder="Ex.: București, Ilfov, Prahova…"
        />
      </Field>

      {/* Descrieri */}
      <h4 className={styles.sectionTitle}>Descrieri</h4>

      <Field label="Povestea brandului (recomandat)" id={`about-${service.id}`} help="Recomandat min. 300 caractere pentru un profil mai credibil.">
        <textarea
          id={`about-${service.id}`}
          className={styles.textarea}
          value={p.about || ""}
          onChange={(e) => updateProfile(idx, { about: e.target.value })}
          placeholder="Spune-ne povestea brandului tău…"
          rows={6}
        />
      </Field>

      {/* Detalii specifice */}
      {fields.length > 0 && (
        <div className={styles.cardSection}>
          <h4 className={styles.sectionTitle}>Detalii specifice serviciului</h4>
          {fields.map((f) => (
            <SpecField
              key={f.key}
              f={f}
              value={(service.attributes || {})[f.key]}
              onChange={(val) => {
                const nextAttrs = { ...(service.attributes || {}), [f.key]: val };
                updateServiceBasics(idx, { attributes: nextAttrs });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Tab principal ---------- */
export default function ProfileTab({
  services,
  availability,
  linkAvailability,
  vanityBase,
  saveState,
  saveError,
  updateProfile,
  updateServiceBasics,
  uploadFile,
  isSavingAny,
  hasNameConflict,
  onContinue,
  err,
}) {
  const [slugTouchedMap, setSlugTouchedMap] = useState({});

  const blockers = useMemo(() => {
    const list = [];
    for (const s of services) {
      const p = s.profile || {};
      if (!s.title?.trim()) list.push("Titlu/Pachet");
      if (!s.city?.trim()) list.push("Oraș serviciu");
      if (!p.displayName?.trim()) list.push("Numele brandului");
      if (!p.slug?.trim()) list.push("Slug");
      if (!p.tagline?.trim()) list.push("Tagline");
      const hasImg = !!p.logoUrl || !!p.coverUrl;
      if (!hasImg) list.push("Cel puțin o imagine (logo/copertă)");
      if (!Array.isArray(p.delivery) || p.delivery.length === 0) list.push("Zonă acoperire");
      break;
    }
    return list;
  }, [services]);

  const canContinue = !isSavingAny && !hasNameConflict && blockers.length === 0;

  return (
    <div role="tabpanel" className={styles.tabPanel} aria-labelledby="tab-profil">
      <header className={styles.header}>
        <h1 className={styles.title}>Profil per serviciu</h1>
        <p className={styles.subtitle}>
          Minim necesar pentru publicare: nume brand, slug, titlu, oraș, tagline, zonă acoperire și cel puțin o imagine.
          Modificările se <strong>salvează automat</strong> după câteva momente de pauză.
        </p>
      </header>

      <form className={styles.form} onSubmit={(e)=>e.preventDefault()} noValidate>
        {services.length === 0 ? (
          <div className={styles.empty}>
            Nu ai niciun serviciu în lucru. <a className={styles.link} href="/onboarding">Înapoi la selecție</a>
          </div>
        ) : (
          services.map((s, idx) => (
            <ServiceCard
              key={s.id}
              service={s}
              idx={idx}
              availability={availability[s.id] || { state:"idle", available:null }}
              linkAvailability={linkAvailability[s.id] || { state:"idle", available:null }}
              vanityBase={vanityBase}
              saveState={saveState[s.id] || "idle"}
              saveError={saveError[s.id] || ""}
              updateProfile={updateProfile}
              updateServiceBasics={updateServiceBasics}
              uploadFile={uploadFile}
              slugTouchedMap={slugTouchedMap}
              setSlugTouchedMap={setSlugTouchedMap}
            />
          ))
        )}
      </form>

      {err && <div className={styles.error} role="alert" style={{marginTop:12}}>{err}</div>}

      <div className={styles.wizardNav}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={onContinue}
          disabled={!canContinue}
          aria-disabled={!canContinue}
          title={!canContinue ? `Mai ai de completat: ${blockers.join(", ")}` : undefined}
        >
          Continuă
        </button>
        {!canContinue && (
          <small className={styles.help}>Mai ai de completat: {blockers.join(", ")}.</small>
        )}
      </div>
    </div>
  );
}
