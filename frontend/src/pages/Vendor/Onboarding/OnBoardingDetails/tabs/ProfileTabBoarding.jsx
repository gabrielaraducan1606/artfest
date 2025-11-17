import React, { useMemo, useState, useEffect } from "react";
import styles from "../OnBoardingDetails.module.css";
import ChipsInput from "../../fields/ChipsInput.jsx";
import { api } from "../../../../../lib/api";

/* versiuni politici (audit) */
const MASTER_VENDOR_AGREEMENT_VERSION = "v1.0";
const COURIER_POLICY_VERSION = "v1.0"; // Sameday

/* utils */
const isPhoneRO = (v) => /^(\+4)?0?7\d{8}$/.test((v || "").replace(/\s+/g, ""));
const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/(^-|-$)/g, "");

/* mici piese UI */
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

function SectionCard({ title, subtitle, open, onToggle, children, badge }) {
  return (
    <div className={styles.card} style={{ padding: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        className={styles.accHeader}
        aria-expanded={open}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={styles.pill} aria-hidden>●</span>
          <strong>{title}</strong>
          {subtitle && <span className={styles.muted}>— {subtitle}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {badge}
          <span className={styles.chev} aria-hidden>{open ? "▾" : "▸"}</span>
        </div>
      </button>
      {open && <div className={styles.accPanel}>{children}</div>}
    </div>
  );
}

/* ===== util: debounce simplu ===== */
function useDebounced(value, delay = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ===== hook: disponibilitate nume + slug ===== */
function useBrandAvailability(serviceId, name, slug) {
  const [nameState, setNameState] = useState({ state: "idle", available: null, conflict: null });
  const [slugState, setSlugState] = useState({ state: "idle", available: null, suggestion: null });

  const dName = useDebounced((name || "").trim(), 400);
  const dSlug = useDebounced((slug || "").trim(), 400);

  useEffect(() => {
    let stop = false;
    if (!dName) {
      setNameState({ state: "idle", available: null, conflict: null });
      return;
    }
    (async () => {
      try {
        setNameState((s) => ({ ...s, state: "checking" }));
        const q = `/api/vendors/vendor-services/brand/check-name?name=${encodeURIComponent(dName)}&excludeServiceId=${encodeURIComponent(serviceId)}`;
        const r = await api(q, { method: "GET" });
        if (stop) return;
        setNameState({ state: "done", available: !r?.nameClash, conflict: r?.conflict || null });
      } catch {
        if (!stop) setNameState({ state: "error", available: null, conflict: null });
      }
    })();
    return () => { stop = true; };
  }, [dName, serviceId]);

  useEffect(() => {
    let stop = false;
    if (!dSlug) {
      setSlugState({ state: "idle", available: null, suggestion: null });
      return;
    }
    (async () => {
      try {
        setSlugState((s) => ({ ...s, state: "checking" }));
        const q = `/api/vendors/vendor-services/brand/check?slug=${encodeURIComponent(dSlug)}&excludeServiceId=${encodeURIComponent(serviceId)}`;
        const r = await api(q, { method: "GET" });
        if (stop) return;
        setSlugState({ state: "done", available: !!r?.available, suggestion: r?.suggestion || null });
      } catch {
        if (!stop) setSlugState({ state: "error", available: null, suggestion: null });
      }
    })();
    return () => { stop = true; };
  }, [dSlug, serviceId]);

  return { nameState, slugState };
}

/* ====== hook: județe din API (cu „Toată țara” exclusivă) ====== */
function useRoCounties() {
  const [list, setList] = useState([]);
  const [all, setAll] = useState({ code: "RO-ALL", name: "Toată țara" });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const d = await api("/api/geo/ro/counties", { method: "GET" });
        if (!alive) return;
        const items = Array.isArray(d?.items) ? d.items : [];
        items.sort((a, b) => a.name.localeCompare(b.name, "ro"));
        setList(items);
        if (d?.all) setAll(d.all);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Nu am putut încărca județele.");
        setList([{ code: "B", name: "București" }]); // fallback
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const suggestions = useMemo(() => [all.name, ...list.map((c) => c.name)], [list, all]);
  return { suggestions, all, loading, err };
}

/* helper: generează un teaser scurt dintr-un text lung */
function makeTeaser(txt, max = 120) {
  const s = (txt || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= max) return s;
  const cut = s.slice(0, max).replace(/\W+\w*$/, "");
  return `${cut}…`;
}

/* ================= ServiceCard (acordeon pe 3 secțiuni) ================= */
function ServiceCard({
  service,
  idx,
  vanityBase,
  saveState,
  saveError,
  updateProfile,
  updateServiceBasics,
  uploadFile,
  slugTouchedMap,
  setSlugTouchedMap,
  setErr,
}) {
  const p = service.profile || {};
  const attrs = service.attributes || {};
  const [open, setOpen] = useState(0); // 0=Identitate, 1=Comercial&livrare, 2=Acorduri

  // disponibilitate nume/slug
  const { nameState, slugState } = useBrandAvailability(service.id, p.displayName, p.slug);

  // set default livrare = „Curier Sameday” o singură dată
  useEffect(() => {
    const current = Array.isArray(attrs.deliveryMethods) ? attrs.deliveryMethods : [];
    if (!current.includes("Curier Sameday")) {
      updateServiceBasics(idx, { attributes: { ...attrs, deliveryMethods: ["Curier Sameday"] } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function onName(val) {
    updateProfile(idx, { displayName: val });
    const id = service.id;
    if (!slugTouchedMap[id]) updateProfile(idx, { slug: slugify(val) });
  }
  function onSlug(val) {
    const id = service.id;
    setSlugTouchedMap((m) => ({ ...m, [id]: true }));
    updateProfile(idx, { slug: val.toLowerCase().replace(/[^a-z0-9-]/g, "-") });
  }

  const linkPreview = p.slug?.trim()
    ? `https://${vanityBase.replace(/\/+$/, "")}/magazin/${p.slug.trim()}`
    : "";

  const phoneErr = p.phone && !isPhoneRO(p.phone) ? "Număr invalid (+40 7xx…)" : "";
  const setAttrs = (patch) => updateServiceBasics(idx, { attributes: { ...attrs, ...patch } });

  // județe din API
  const deliveryArr = Array.isArray(p.delivery) ? p.delivery : [];
  const { suggestions: countySuggestions, all: allCountry, loading: countiesLoading, err: countiesErr } = useRoCounties();

  function onCountiesChange(arr) {
    const clean = Array.isArray(arr) ? arr.filter(Boolean) : [];
    if (clean.includes(allCountry.name)) {
      updateProfile(idx, { delivery: [allCountry.name] }); // exclusiv
      return;
    }
    const uniq = [...new Set(clean)].filter((n) => n !== allCountry.name);
    uniq.sort((a, b) => a.localeCompare(b, "ro"));
    updateProfile(idx, { delivery: uniq });
  }

  // badge-uri pentru status secțiuni
  const identBadge =
    !p.displayName?.trim() || !p.slug?.trim() || (!p.logoUrl && !p.coverUrl) || !p.address?.trim()
      ? <span className={styles.badgeBad}>incomplet</span>
      : <span className={styles.badgeOk}>ok</span>;

  const comBadge =
    (!Array.isArray(p.delivery) || p.delivery.length === 0)
      ? <span className={styles.badgeBad}>incomplet</span>
      : <span className={styles.badgeOk}>ok</span>;

  const accBadge =
    !attrs.masterAgreementAccepted
      ? <span className={styles.badgeBad}>incomplet</span>
      : <span className={styles.badgeOk}>ok</span>;

  /* ==== Short Description limits & helpers ==== */
  const SHORT_MAX = 120;
  const shortLen = (p.shortDescription || "").length;
  const tooLong = shortLen > SHORT_MAX;

  return (
    <div className={styles.card} key={service.id} style={{ padding: 0 }}>
      <div className={styles.cardHead} style={{ padding: "8px 12px" }}>
        <div className={styles.serviceName}>{service.type?.name || "Serviciu"}</div>
        <div className={styles.saveIndicator}>
          {saveState === "saving" ? "Se salvează…" :
           saveState === "saved"  ? "Salvat" :
           saveState === "error"  ? (saveError || "Eroare") : "—"}
        </div>
      </div>

      {/* 1) Identitate */}
      <SectionCard
        title="Identitate"
        subtitle="brand • link public • adresă"
        open={open === 0}
        onToggle={() => setOpen((o) => (o === 0 ? -1 : 0))}
        badge={identBadge}
      >
        {/* Nume brand */}
        <Row id={`brand-${service.id}`} label="Nume brand / artizan *">
          <input
            id={`brand-${service.id}`}
            className={styles.input}
            value={p.displayName || ""}
            onChange={(e) => onName(e.target.value)}
            placeholder="ex: Atelierul Ana"
            aria-describedby={`brand-${service.id}-hint`}
          />
          {nameState.state === "checking" && (
            <small className={styles.help} id={`brand-${service.id}-hint`}>Se verifică disponibilitatea…</small>
          )}
          {nameState.state === "done" && nameState.available === true && (
            <small className={styles.help} id={`brand-${service.id}-hint`}>✅ Nume disponibil</small>
          )}
          {nameState.state === "done" && nameState.available === false && (
            <small className={styles.fieldError} id={`brand-${service.id}-hint`}>❌ Numele este deja folosit</small>
          )}
          {nameState.state === "error" && (
            <small className={styles.fieldError} id={`brand-${service.id}-hint`}>Eroare la verificare</small>
          )}
        </Row>

        {/* Slug */}
        <Row id={`slug-${service.id}`} label="Link public (slug) *" help={linkPreview || "ex: atelierul-ana"}>
          <input
            id={`slug-${service.id}`}
            className={styles.input}
            value={p.slug || ""}
            onChange={(e) => onSlug(e.target.value)}
            placeholder="ex: atelierul-ana"
            aria-describedby={`slug-${service.id}-hint`}
          />
          {slugState.state === "checking" && <small className={styles.help} id={`slug-${service.id}-hint`}>Se verifică slug-ul…</small>}
          {slugState.state === "done" && slugState.available === true && <small className={styles.help} id={`slug-${service.id}-hint`}>✅ Slug disponibil</small>}
          {slugState.state === "done" && slugState.available === false && (
            <small className={styles.fieldError} id={`slug-${service.id}-hint`}>
              ❌ Slug ocupat{slugState.suggestion ? ` — sugestie: ${slugState.suggestion}` : ""}
            </small>
          )}
          {slugState.state === "error" && <small className={styles.fieldError} id={`slug-${service.id}-hint`}>Eroare la verificare</small>}
        </Row>

        {/* Descriere scurtă */}
        <Row
          id={`short-${service.id}`}
          label="Descriere scurtă (apare sub nume)"
          help="Max. 120 caractere • ex: „Magazin bijuterii handmade”"
        >
          <div className={styles.inputWrap}>
            <input
              id={`short-${service.id}`}
              className={styles.input}
              value={p.shortDescription || ""}
              onChange={(e) => {
                const v = e.target.value.slice(0, SHORT_MAX);
                updateProfile(idx, { shortDescription: v });
              }}
              placeholder="ex: Magazin bijuterii handmade"
            />
            <div className={styles.counter} aria-live="polite">
              {(p.shortDescription || "").length}/{SHORT_MAX}
            </div>
          </div>

          {!p.shortDescription && (p.about || "").trim()?.length > 0 && (
            <div className={styles.stack} style={{ marginTop: 6 }}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => {
                  const v = makeTeaser(p.about, SHORT_MAX);
                  updateProfile(idx, { shortDescription: v });
                }}
                title="Generează automat din Despre"
              >
                Generează din „Despre”
              </button>
              <small className={styles.help}>
                Vom tăia elegant din „Despre” dacă e mai lung.
              </small>
            </div>
          )}

          {tooLong && (
            <small className={styles.fieldError}>
              Prea lung — păstrează până la {SHORT_MAX} caractere.
            </small>
          )}
        </Row>

        <div className={styles.grid2}>
          {/* Logo */}
          <Row id={`logo-${service.id}`} label="Logo / poză *">
            <input type="file" accept="image/*" onChange={(e) => onUpload(e, "logoUrl")} />
            {p.logoUrl && <img src={p.logoUrl} alt="Logo" className={styles.previewThumb} />}
          </Row>
          {/* Cover */}
          <Row id={`cover-${service.id}`} label="Copertă (opțional)" help="recomandat 1920×600, max 3MB">
            <input type="file" accept="image/*" onChange={(e) => onUpload(e, "coverUrl")} />
            {p.coverUrl && <img src={p.coverUrl} alt="Cover" className={styles.previewBanner} />}
          </Row>
        </div>

        {/* Adresă */}
        <Row id={`address-${service.id}`} label="Adresă sediu / atelier *">
          <input
            id={`address-${service.id}`}
            className={styles.input}
            value={p.address || ""}
            onChange={(e) => updateProfile(idx, { address: e.target.value })}
            placeholder="Str. Exemplu 10, București"
          />
        </Row>

        {/* Contact */}
        <div className={styles.grid2}>
          <Row id={`phone-${service.id}`} label="Telefon public (opțional)" error={phoneErr}>
            <input
              id={`phone-${service.id}`}
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
          <Row id={`email-${service.id}`} label="Email public (opțional)">
            <input
              id={`email-${service.id}`}
              className={styles.input}
              value={p.email || ""}
              onChange={(e) => updateProfile(idx, { email: e.target.value })}
              placeholder="contact@brand.ro"
              type="email"
            />
          </Row>
        </div>

        {/* Despre */}
        <Row id={`about-${service.id}`} label="Despre (opțional)" help="Scurtă poveste a brandului (se poate completa și ulterior)">
          <textarea
            id={`about-${service.id}`}
            className={styles.input}
            rows={6}
            value={p.about || ""}
            onChange={(e) => updateProfile(idx, { about: e.target.value })}
            placeholder="Povestea brandului, ce creezi, cum lucrezi, ce te diferențiază…"
          />
        </Row>
      </SectionCard>

      {/* 2) Comercial & livrare */}
      <SectionCard
        title="Comercial & livrare"
        subtitle="Curier Sameday • zonă"
        open={open === 1}
        onToggle={() => setOpen((o) => (o === 1 ? -1 : 1))}
        badge={comBadge}
      >
        <Row id={`deliveryMethods-${service.id}`} label="Metodă de livrare">
          <input id={`deliveryMethods-${service.id}`} className={styles.input} value="Curier Sameday" readOnly />
          <small className={styles.help}>
            Livrarea pe platformă se face exclusiv prin <strong>Sameday</strong>. Detalii și acceptare sunt în{" "}
            <a href="/legal/vendor/onboarding" target="_blank" rel="noreferrer">Acordul Master</a>.
          </small>
        </Row>

        <Row
          id={`delivery-${service.id}`}
          label="Zonă acoperire *"
          help={countiesLoading ? "Se încarcă județele…" : "Alege județe sau 'Toată țara' (exclusiv)"}
        >
          <ChipsInput
            value={deliveryArr}
            onChange={onCountiesChange}
            suggestions={countySuggestions}
            placeholder="Toată țara, București, Ilfov, Prahova…"
          />
          {countiesErr && <small className={styles.fieldError}>{countiesErr}</small>}
        </Row>

        <div className={styles.stack}>
          <small className={styles.help}>
            Politica Sameday ({COURIER_POLICY_VERSION}) este inclusă în Acordul Master.{" "}
            <a href="/policies/courier-sameday" target="_blank" rel="noreferrer">Vezi detalii</a>.
          </small>
        </div>
      </SectionCard>

      {/* 3) Acorduri */}
      <SectionCard
        title="Acorduri"
        subtitle="acceptare unică"
        open={open === 2}
        onToggle={() => setOpen((o) => (o === 2 ? -1 : 2))}
        badge={accBadge}
      >
        <div className={styles.stack}>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={!!attrs.masterAgreementAccepted}
              onChange={async (e) => {
                const checked = !!e.target.checked;
                setAttrs({
                  masterAgreementAccepted: checked,
                  masterAgreementVersion: MASTER_VENDOR_AGREEMENT_VERSION,
                  masterAgreementAcceptedAt: checked ? new Date().toISOString() : null,
                });
                if (checked) {
                  try {
                    await api("/api/legal/vendor-accept", {
                      method: "POST",
                      body: {
                        accept: [
                          { type: "vendor_terms" },
                          { type: "shipping_addendum" },
                          { type: "returns" },
                        ],
                      },
                    });
                  } catch {
                    /* retry ulterior */
                  }
                }
              }}
            />
            <span>
              Accept{" "}
              <a href="/legal/vendor/onboarding" target="_blank" rel="noreferrer">
                Acordul Master pentru Vânzători
              </a>{" "}
              ({MASTER_VENDOR_AGREEMENT_VERSION})
            </span>
          </label>
          <small className={styles.help}>
            Include: Termenii vânzători, Politica de listare, Taxe & plăți, Livrare (incl. Sameday) și Retur.
          </small>
        </div>

        {saveState === "error" && saveError && (
          <div className={styles.error} role="alert">{saveError}</div>
        )}
      </SectionCard>
    </div>
  );
}

/* ================= Tab principal (n- servicii) ================= */
export default function ProfileTab({
  services,
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
  setErr,
}) {
  const [slugTouchedMap, setSlugTouchedMap] = useState({});
  const [isSolo, setIsSolo] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      setIsSolo(sp.get("solo") === "1");
    }
  }, []);

  const blockers = useMemo(() => {
    const list = [];
    for (const s of services) {
      const p = s.profile || {};
      const a = s.attributes || {};

      // Identitate
      if (!p.displayName?.trim()) list.push("Nume brand");
      if (!p.slug?.trim()) list.push("Slug");
      if (!p.address?.trim()) list.push("Adresă");
      if (!p.logoUrl && !p.coverUrl) list.push("O imagine (logo/copertă)");
      // Descriere scurtă este opțională — nu o adăugăm la blocanți

      // Comercial & livrare
      if (!Array.isArray(p.delivery) || p.delivery.length === 0)
        list.push("Zonă acoperire");

      // Acorduri
      if (!a.masterAgreementAccepted) list.push("Acordul Master");

      break; // validăm doar primul serviciu
    }
    return list;
  }, [services]);

  const canContinue = !isSavingAny && !hasNameConflict && blockers.length === 0;

  // URL către profilul public (bazat pe primul serviciu)
  const firstService = Array.isArray(services) && services[0] ? services[0] : null;
  const firstSlug = firstService?.profile?.slug?.trim() || "";
  const backToProfileUrl = firstSlug ? `/magazin/${firstSlug}` : "/magazin";

  return (
    <div role="tabpanel" className={styles.tabPanel} aria-labelledby="tab-profil">
      <header className={styles.header}>
        <h1 className={styles.title}>Profil vendor</h1>
        <p className={styles.subtitle}>
          {isSolo
            ? "Datele se salvează automat atunci când editezi."
            : <>Completează profilul tău. IBAN-ul și entitatea juridică sunt în <strong>Date facturare</strong>.</>}
        </p>
      </header>

      <form className={styles.form} onSubmit={(e) => e.preventDefault()} noValidate>
        {services.length === 0 ? (
          <div className={styles.empty}>
            Nu ai niciun serviciu în lucru.{" "}
            <a className={styles.link} href="/onboarding">Înapoi la selecție</a>
          </div>
        ) : (
          services.map((s, idx) => (
            <ServiceCard
              key={s.id}
              service={s}
              idx={idx}
              vanityBase={vanityBase}
              saveState={saveState[s.id] || "idle"}
              saveError={saveError[s.id] || ""}
              updateProfile={updateProfile}
              updateServiceBasics={updateServiceBasics}
              uploadFile={uploadFile}
              slugTouchedMap={slugTouchedMap}
              setSlugTouchedMap={setSlugTouchedMap}
              setErr={setErr}
            />
          ))
        )}
      </form>

      {err && <div className={styles.error} role="alert" style={{ marginTop: 12 }}>{err}</div>}

      <div className={styles.wizardNav}>
        {isSolo ? (
          <a
            href={backToProfileUrl}
            className={styles.primaryBtn}
            title="Înapoi la pagina de profil public"
          >
            Înapoi la profil
          </a>
        ) : (
          <>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={onContinue}
              disabled={!canContinue}
              aria-disabled={!canContinue}
              title={!canContinue ? `Mai ai: ${blockers.join(", ")}` : undefined}
            >
              Continuă
            </button>
            {!canContinue && <small className={styles.help}>Mai ai: {blockers.join(", ")}.</small>}
          </>
        )}
      </div>
    </div>
  );
}
