import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import styles from "./css/ProfileTabBoarding.module.css";
import ChipsInput from "../../fields/ChipsInput.jsx";
import { api } from "../../../../../lib/api";

/* utils */
const isPhoneRO = (v) => /^(\+4)?0?7\d{8}$/.test((v || "").replace(/\s+/g, ""));
const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/(^-|-$)/g, "");

/**
 * URL absolut către backend pentru documente (dacă VITE_API_URL există),
 * altfel rămâne relativ (merge pe același origin).
 */
function absUrl(pathname) {
  const p = pathname || "";
  if (/^https?:\/\//i.test(p)) return p;
  const rel = p.startsWith("/") ? p : `/${p}`;
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
  return base ? `${base}${rel}` : rel;
}

/* ===== helper upload direct în R2 via /api/upload ===== */
async function uploadToR2(file) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/upload", {
    method: "POST",
    body: form,
    credentials: "include",
  });

  if (!res.ok) {
    let errMsg = "Upload eșuat. Încearcă din nou.";
    try {
      const data = await res.json();
      if (data?.message) errMsg = data.message;
    } catch {
      // ignore
    }
    throw new Error(errMsg);
  }

  const data = await res.json(); // { ok, url, key }
  if (!data?.ok || !data?.url) {
    throw new Error("Upload eșuat. Răspuns invalid de la server.");
  }
  return data.url;
}

/* mici piese UI */
function Row({ id, label, children, error, help, className = "" }) {
  return (
    <div className={`${styles.fieldRow} ${className}`}>
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

function SectionCard({ title, subtitle, open, onToggle, children, badge }) {
  return (
    <div className={styles.section} data-open={open ? "1" : "0"}>
      <button
        type="button"
        onClick={onToggle}
        className={styles.accHeader}
        aria-expanded={open}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={styles.pill} aria-hidden>
            ●
          </span>
          <strong>{title}</strong>
          {subtitle && <span className={styles.muted}>— {subtitle}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {badge}
          <span className={styles.chev} aria-hidden>
            {open ? "▾" : "▸"}
          </span>
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
  const [nameState, setNameState] = useState({
    state: "idle",
    available: null,
    conflict: null,
  });
  const [slugState, setSlugState] = useState({
    state: "idle",
    available: null,
    suggestion: null,
  });

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
        const q = `/api/vendors/vendor-services/brand/check-name?name=${encodeURIComponent(
          dName
        )}&excludeServiceId=${encodeURIComponent(serviceId)}`;
        const r = await api(q, { method: "GET" });
        if (stop) return;
        setNameState({
          state: "done",
          available: !r?.nameClash,
          conflict: r?.conflict || null,
        });
      } catch {
        if (!stop)
          setNameState({ state: "error", available: null, conflict: null });
      }
    })();
    return () => {
      stop = true;
    };
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
        const q = `/api/vendors/vendor-services/brand/check?slug=${encodeURIComponent(
          dSlug
        )}&excludeServiceId=${encodeURIComponent(serviceId)}`;
        const r = await api(q, { method: "GET" });
        if (stop) return;
        setSlugState({
          state: "done",
          available: !!r?.available,
          suggestion: r?.suggestion || null,
        });
      } catch {
        if (!stop)
          setSlugState({ state: "error", available: null, suggestion: null });
      }
    })();
    return () => {
      stop = true;
    };
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
    return () => {
      alive = false;
    };
  }, []);

  const suggestions = useMemo(
    () => [all.name, ...list.map((c) => c.name)],
    [list, all]
  );
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

/* ===================== Legal (vendor) ===================== */

const VENDOR_DOCS = {
  vendor_terms: {
    attrAccepted: "masterAgreementAccepted",
    attrVersion: "masterAgreementVersion",
    attrAcceptedAt: "masterAgreementAcceptedAt",
    label: "Acordul Master pentru Vânzători",
    fallbackUrl: "/acord-vanzatori",
  },
  shipping_addendum: {
    attrAccepted: "courierAddendumAccepted",
    attrVersion: "courierAddendumVersion",
    attrAcceptedAt: "courierAddendumAcceptedAt",
    label: "Anexa de curierat Sameday",
    fallbackUrl: "/anexa-expediere",
  },
  returns: {
    attrAccepted: "returnsPolicyAccepted",
    attrVersion: "returnsPolicyVersion",
    attrAcceptedAt: "returnsPolicyAcceptedAt",
    label: "Politica de retur pentru vânzători",
    fallbackUrl: "/politica-retur",
  },
};

function useVendorAgreementsStatus() {
  const [docs, setDocs] = useState(null);
  const [allOK, setAllOK] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await api("/api/vendor/agreements/status", { method: "GET" });
      const list = Array.isArray(r?.docs) ? r.docs : [];
      setDocs(list);
      setAllOK(!!r?.allOK);
    } catch (e) {
      setErr(e?.message || "Nu am putut încărca acordurile.");
      setDocs(null);
      setAllOK(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api("/api/vendor/agreements/status", { method: "GET" });
        if (!alive) return;
        const list = Array.isArray(r?.docs) ? r.docs : [];
        setDocs(list);
        setAllOK(!!r?.allOK);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Nu am putut încărca acordurile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const byKey = useMemo(() => {
    const m = new Map();
    for (const d of docs || []) m.set(d.doc_key, d);
    return m;
  }, [docs]);

  return { docs, byKey, allOK, loading, err, refresh };
}

async function acceptVendorDoc(type) {
  await api("/api/legal/vendor-accept", {
    method: "POST",
    body: { accept: [{ type }] },
  });
}

/* ================= ServiceCard ================= */
function ServiceCard({
  service,
  idx,
  vanityBase,
  saveState,
  saveError,
  updateProfile,
  updateServiceBasics,
  slugTouchedMap,
  setSlugTouchedMap,
  setErr,
  legalByKey,
  legalLoading,
  legalError,
  refreshLegal,
}) {
  const p = service.profile || {};
  const attrs = service.attributes || {};
  const [open, setOpen] = useState(0);

  const sectionRefs = useRef([]);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (open < 0) return;
    const el = sectionRefs.current[open];
    if (!el || typeof window === "undefined") return;

    try {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      const rect = el.getBoundingClientRect();
      window.scrollTo({
        top: window.scrollY + rect.top - 120,
        behavior: "smooth",
      });
    }
  }, [open]);

  const { nameState, slugState } = useBrandAvailability(
    service.id,
    p.displayName,
    p.slug
  );

  useEffect(() => {
    const current = Array.isArray(attrs.deliveryMethods)
      ? attrs.deliveryMethods
      : [];
    const patch = {};
    if (!current.includes("Curier Sameday")) patch.deliveryMethods = ["Curier Sameday"];
    if (!attrs.courierEnabled) patch.courierEnabled = true;
    if (Object.keys(patch).length > 0) {
      updateServiceBasics(idx, { attributes: { ...attrs, ...patch } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onUpload(e, key) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      if (!/^image\/(png|jpe?g|webp)$/i.test(f.type))
        throw new Error("Acceptăm doar PNG / JPG / WebP.");
      if (f.size > 3 * 1024 * 1024) throw new Error("Maxim 3 MB.");

      const url = await uploadToR2(f);
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
  const emailErr =
    p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email) ? "Adresă de email invalidă" : "";

  const setAttrs = (patch) =>
    updateServiceBasics(idx, { attributes: { ...attrs, ...patch } });

  const deliveryArr = Array.isArray(p.delivery) ? p.delivery : [];
  const { suggestions: countySuggestions, all: allCountry, loading: countiesLoading, err: countiesErr } =
    useRoCounties();

  function onCountiesChange(arr) {
    const clean = Array.isArray(arr) ? arr.filter(Boolean) : [];
    if (clean.includes(allCountry.name)) {
      updateProfile(idx, { delivery: [allCountry.name] });
      return;
    }
    const uniq = [...new Set(clean)].filter((n) => n !== allCountry.name);
    uniq.sort((a, b) => a.localeCompare(b, "ro"));
    updateProfile(idx, { delivery: uniq });
  }

  const shippingDoc = legalByKey?.get?.("SHIPPING_ADDENDUM") || null;
  const vendorTermsDoc = legalByKey?.get?.("VENDOR_TERMS") || null;
  const returnsDoc = legalByKey?.get?.("RETURNS_POLICY_ACK") || null;

  const shippingAccepted = !!shippingDoc?.accepted || !!attrs.courierAddendumAccepted;
  const vendorTermsAccepted = !!vendorTermsDoc?.accepted || !!attrs.masterAgreementAccepted;
  const returnsAccepted = !!returnsDoc?.accepted || !!attrs.returnsPolicyAccepted;

  const shippingUrl = absUrl(shippingDoc?.url || VENDOR_DOCS.shipping_addendum.fallbackUrl);
  const vendorTermsUrl = absUrl(vendorTermsDoc?.url || VENDOR_DOCS.vendor_terms.fallbackUrl);
  const returnsUrl = absUrl(returnsDoc?.url || VENDOR_DOCS.returns.fallbackUrl);

  const shippingVersion = shippingDoc?.version || attrs.courierAddendumVersion || "?";
  const vendorTermsVersion = vendorTermsDoc?.version || attrs.masterAgreementVersion || "?";
  const returnsVersion = returnsDoc?.version || attrs.returnsPolicyVersion || "?";

  async function onToggleAccept(type, checked) {
    const nowIso = checked ? new Date().toISOString() : null;

    if (type === "shipping_addendum") {
      setAttrs({
        courierEnabled: true,
        courierAddendumAccepted: checked,
        courierAddendumVersion: checked ? String(shippingVersion || "?") : null,
        courierAddendumAcceptedAt: nowIso,
      });
    } else if (type === "vendor_terms") {
      setAttrs({
        masterAgreementAccepted: checked,
        masterAgreementVersion: checked ? String(vendorTermsVersion || "?") : null,
        masterAgreementAcceptedAt: nowIso,
      });
    } else if (type === "returns") {
      setAttrs({
        returnsPolicyAccepted: checked,
        returnsPolicyVersion: checked ? String(returnsVersion || "?") : null,
        returnsPolicyAcceptedAt: nowIso,
      });
    }

    if (!checked) return;

    try {
      await acceptVendorDoc(type);
      await refreshLegal?.();
    } catch {
      // ignore
    }
  }

  const identBadge =
    !p.displayName?.trim() ||
    !p.slug?.trim() ||
    !p.city?.trim() ||
    (!p.logoUrl && !p.coverUrl) ||
    !p.address?.trim() ? (
      <span className={styles.badgeBad}>incomplet</span>
    ) : (
      <span className={styles.badgeOk}>ok</span>
    );

  const comBadge =
    !Array.isArray(p.delivery) || p.delivery.length === 0 || !shippingAccepted ? (
      <span className={styles.badgeBad}>incomplet</span>
    ) : (
      <span className={styles.badgeOk}>ok</span>
    );

  const accBadge = !vendorTermsAccepted || !returnsAccepted ? (
    <span className={styles.badgeBad}>incomplet</span>
  ) : (
    <span className={styles.badgeOk}>ok</span>
  );

  const SHORT_MAX = 120;
  const shortLen = (p.shortDescription || "").length;
  const tooLong = shortLen > SHORT_MAX;

  return (
    <div className={styles.card} key={service.id} style={{ padding: 0 }}>
      <div className={styles.cardHead} style={{ padding: "8px 12px" }}>
        <div className={styles.serviceName}>{service.type?.name || "Serviciu"}</div>
        <div className={styles.saveIndicator}>
          {saveState === "saving"
            ? "Se salvează…"
            : saveState === "saved"
            ? "Salvat"
            : saveState === "error"
            ? saveError || "Eroare"
            : "—"}
        </div>
      </div>

      {/* 1) Identitate */}
      <div ref={(el) => (sectionRefs.current[0] = el)}>
        <SectionCard
          title="Identitate"
          subtitle="brand • link public • adresă"
          open={open === 0}
          onToggle={() => setOpen((o) => (o === 0 ? -1 : 0))}
          badge={identBadge}
        >
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
              <small className={styles.help} id={`brand-${service.id}-hint`}>
                Se verifică disponibilitatea…
              </small>
            )}
            {nameState.state === "done" && nameState.available === true && (
              <small className={styles.help} id={`brand-${service.id}-hint`}>
                ✅ Nume disponibil
              </small>
            )}
            {nameState.state === "done" && nameState.available === false && (
              <small className={styles.fieldError} id={`brand-${service.id}-hint`}>
                ❌ Numele este deja folosit
              </small>
            )}
            {nameState.state === "error" && (
              <small className={styles.fieldError} id={`brand-${service.id}-hint`}>
                Eroare la verificare
              </small>
            )}
          </Row>

          <Row id={`slug-${service.id}`} label="Link public (slug) *" help={linkPreview || "ex: atelierul-ana"}>
            <input
              id={`slug-${service.id}`}
              className={styles.input}
              value={p.slug || ""}
              onChange={(e) => onSlug(e.target.value)}
              placeholder="ex: atelierul-ana"
              aria-describedby={`slug-${service.id}-hint`}
            />
            {slugState.state === "checking" && (
              <small className={styles.help} id={`slug-${service.id}-hint`}>
                Se verifică slug-ul…
              </small>
            )}
            {slugState.state === "done" && slugState.available === true && (
              <small className={styles.help} id={`slug-${service.id}-hint`}>
                ✅ Slug disponibil
              </small>
            )}
            {slugState.state === "done" && slugState.available === false && (
              <small className={styles.fieldError} id={`slug-${service.id}-hint`}>
                ❌ Slug ocupat{slugState.suggestion ? ` — sugestie: ${slugState.suggestion}` : ""}
              </small>
            )}
            {slugState.state === "error" && (
              <small className={styles.fieldError} id={`slug-${service.id}-hint`}>
                Eroare la verificare
              </small>
            )}
          </Row>

          <Row
            id={`city-${service.id}`}
            label="Oraș afișat public *"
            help="Este afișat pe profilul magazinului și folosit la filtre. Dacă atelierul este într-un sat sau într-o comună, poți alege cel mai apropiat oraș mare."
          >
            <input
              id={`city-${service.id}`}
              className={styles.input}
              value={p.city || ""}
              onChange={(e) => updateProfile(idx, { city: e.target.value })}
              placeholder="ex: București, Cluj-Napoca, Iași"
            />
          </Row>

          <Row
            id={`short-${service.id}`}
            label="Descriere scurtă (apare sub nume)"
            help='Max. 120 caractere • ex: „Magazin bijuterii handmade”'
          >
            <div className={styles.inputWrap}>
              <input
                id={`short-${service.id}`}
                className={styles.input}
                value={p.shortDescription || ""}
                onChange={(e) => updateProfile(idx, { shortDescription: e.target.value.slice(0, SHORT_MAX) })}
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
                  className={styles.link}
                  onClick={() => updateProfile(idx, { shortDescription: makeTeaser(p.about, SHORT_MAX) })}
                  title="Generează automat din Despre"
                >
                  Generează din „Despre”
                </button>
                <small className={styles.help}>Vom tăia elegant din „Despre” dacă e mai lung.</small>
              </div>
            )}

            {tooLong && (
              <small className={styles.fieldError}>
                Prea lung — păstrează până la {SHORT_MAX} caractere.
              </small>
            )}
          </Row>

          <div className={styles.grid2}>
            <Row id={`logo-${service.id}`} label="Logo / poză *">
              <input type="file" accept="image/*" onChange={(e) => onUpload(e, "logoUrl")} />
              {p.logoUrl && <img src={p.logoUrl} alt="Logo" className={styles.previewThumb} />}
            </Row>

            <Row id={`cover-${service.id}`} label="Copertă (opțional)" help="recomandat 1920×600, max 3MB">
              <input type="file" accept="image/*" onChange={(e) => onUpload(e, "coverUrl")} />
              {p.coverUrl && <img src={p.coverUrl} alt="Cover" className={styles.previewBanner} />}
            </Row>
          </div>

          <Row
            id={`address-${service.id}`}
            label="Adresă sediu / atelier *"
            help="Adresă COMPLETĂ pentru retururi și documente fiscale (nu este afișată public)."
          >
            <input
              id={`address-${service.id}`}
              className={styles.input}
              value={p.address || ""}
              onChange={(e) => updateProfile(idx, { address: e.target.value })}
              placeholder="Localitate, stradă și număr, bloc/scară/ap., județ"
            />
          </Row>

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

            <Row id={`email-${service.id}`} label="Email public (opțional)" error={emailErr}>
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

          <Row id={`about-${service.id}`} label="Despre (opțional)" help="Scurtă poveste a brandului (se poate completa și ulterior)">
            <textarea
              id={`about-${service.id}`}
              className={styles.input}
              rows={6}
              value={p.about || ""}
              onChange={(e) => updateProfile(idx, { about: e.target.value })}
              placeholder="Povestea brandului, ce creezi, cum lucrezi…"
            />
          </Row>
        </SectionCard>
      </div>

      {/* 2) Comercial & livrare */}
      <div ref={(el) => (sectionRefs.current[1] = el)}>
        <SectionCard
          title="Comercial & livrare"
          subtitle="Curier Sameday • zonă"
          open={open === 1}
          onToggle={() => setOpen((o) => (o === 1 ? -1 : 1))}
          badge={comBadge}
        >
          <Row id={`deliveryMethods-${service.id}`} label="Metodă de livrare pe platformă">
            <input id={`deliveryMethods-${service.id}`} className={styles.input} value="Curier Sameday" readOnly />
            <small className={styles.help}>
              Livrarea comenzilor prin platformă se face prin curierul <strong>Sameday</strong>.
            </small>
          </Row>

          <div className={`${styles.stack} ${styles.courierBox}`}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={shippingAccepted}
                onChange={(e) => onToggleAccept("shipping_addendum", !!e.target.checked)}
                disabled={legalLoading}
              />
              <span>
                Accept{" "}
                <a href={shippingUrl} target="_blank" rel="noreferrer">
                  {VENDOR_DOCS.shipping_addendum.label}
                </a>{" "}
                (v{shippingVersion})
              </span>
            </label>

            <small className={styles.help}>
              Anexa de curierat reglementează modul de preluare, livrare și facturare a transportului prin Sameday.
            </small>

            {legalError && (
              <small className={styles.fieldError}>
                {legalError} (link-urile implicite rămân disponibile)
              </small>
            )}
          </div>

          {/* ✅ IMPORTANT: overlayRow ridică dropdown-ul peste următoarele acordeoane */}
          <Row
            className={styles.overlayRow}
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
        </SectionCard>
      </div>

      {/* 3) Acorduri */}
      <div ref={(el) => (sectionRefs.current[2] = el)}>
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
                checked={vendorTermsAccepted}
                onChange={(e) => onToggleAccept("vendor_terms", !!e.target.checked)}
                disabled={legalLoading}
              />
              <span>
                Accept{" "}
                <a href={vendorTermsUrl} target="_blank" rel="noreferrer">
                  {VENDOR_DOCS.vendor_terms.label}
                </a>{" "}
                (v{vendorTermsVersion})
              </span>
            </label>
            <small className={styles.help}>
              Include: Termenii pentru vânzători, reguli de listare și informații despre taxe & plăți.
            </small>
          </div>

          <div className={styles.stack} style={{ marginTop: 12 }}>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={returnsAccepted}
                onChange={(e) => onToggleAccept("returns", !!e.target.checked)}
                disabled={legalLoading}
              />
              <span>
                Confirm că am citit și accept{" "}
                <a href={returnsUrl} target="_blank" rel="noreferrer">
                  {VENDOR_DOCS.returns.label}
                </a>{" "}
                (v{returnsVersion})
              </span>
            </label>
            <small className={styles.help}>
              Politica de retur definește drepturile clienților și obligațiile tale ca vânzător.
            </small>
          </div>

          {saveState === "error" && saveError && (
            <div className={styles.error} role="alert">
              {saveError}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/* ================= Tab principal ================= */
export default function ProfileTab({
  services,
  vanityBase,
  saveState,
  saveError,
  updateProfile,
  updateServiceBasics,
  isSavingAny,
  hasNameConflict,
  onContinue,
  err,
  setErr,
}) {
  const [slugTouchedMap, setSlugTouchedMap] = useState({});
  const [isSolo, setIsSolo] = useState(false);

  const { byKey: legalByKey, loading: legalLoading, err: legalError, refresh: refreshLegal } =
    useVendorAgreementsStatus();

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

      const shippingDoc = legalByKey?.get?.("SHIPPING_ADDENDUM") || null;
      const vendorTermsDoc = legalByKey?.get?.("VENDOR_TERMS") || null;
      const returnsDoc = legalByKey?.get?.("RETURNS_POLICY_ACK") || null;

      const shippingAccepted = !!shippingDoc?.accepted || !!a.courierAddendumAccepted;
      const vendorTermsAccepted = !!vendorTermsDoc?.accepted || !!a.masterAgreementAccepted;
      const returnsAccepted = !!returnsDoc?.accepted || !!a.returnsPolicyAccepted;

      if (!p.displayName?.trim()) list.push("Nume brand");
      if (!p.slug?.trim()) list.push("Slug");
      if (!p.city?.trim()) list.push("Oraș afișat public");
      if (!p.address?.trim()) list.push("Adresă sediu / atelier");
      if (!p.logoUrl && !p.coverUrl) list.push("O imagine (logo sau copertă)");

      if (!Array.isArray(p.delivery) || p.delivery.length === 0) list.push("Zonă acoperire");
      if (!shippingAccepted) list.push("Acceptarea anexei de curierat Sameday");

      if (!vendorTermsAccepted) list.push("Acceptarea Acordului Master pentru Vânzători");
      if (!returnsAccepted) list.push("Acceptarea Politicii de retur pentru vânzători");

      break;
    }
    return list;
  }, [services, legalByKey]);

  const canContinue = !isSavingAny && !hasNameConflict && blockers.length === 0;

  const firstService = Array.isArray(services) && services[0] ? services[0] : null;
  const firstSlug = firstService?.profile?.slug?.trim() || "";
  const backToProfileUrl = firstSlug ? `/magazin/${firstSlug}` : "/magazin";

  return (
    <div role="tabpanel" className={styles.tabPanel} aria-labelledby="tab-profil">
      <header className={styles.header}>
        <h1 className={styles.title}>Profil vendor</h1>
        <p className={styles.subtitle}>
          {isSolo ? (
            "Datele se salvează automat atunci când editezi."
          ) : (
            <>
              Completează profilul tău. IBAN-ul și entitatea juridică sunt în{" "}
              <strong>Date facturare</strong>.
            </>
          )}
        </p>
      </header>

      <form className={styles.form} onSubmit={(e) => e.preventDefault()} noValidate>
        {services.length === 0 ? (
          <div className={styles.empty}>
            Nu ai niciun serviciu în lucru.{" "}
            <a className={styles.link} href="/onboarding">
              Înapoi la selecție
            </a>
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
              slugTouchedMap={slugTouchedMap}
              setSlugTouchedMap={setSlugTouchedMap}
              setErr={setErr}
              legalByKey={legalByKey}
              legalLoading={legalLoading}
              legalError={legalError}
              refreshLegal={refreshLegal}
            />
          ))
        )}
      </form>

      {err && (
        <div className={styles.error} role="alert" style={{ marginTop: 12 }}>
          {err}
        </div>
      )}

      <div className={styles.wizardNav}>
        {isSolo ? (
          <a href={backToProfileUrl} className={styles.primaryBtn} title="Înapoi la pagina de profil public">
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
