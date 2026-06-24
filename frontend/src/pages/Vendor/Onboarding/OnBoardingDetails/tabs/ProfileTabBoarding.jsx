import React, { useMemo, useState, useEffect, useRef } from "react";
import styles from "./css/ProfileTabBoarding.module.css";
import { api } from "../../../../../lib/api";

const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/(^-|-$)/g, "");

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
    } catch {""}
    throw new Error(errMsg);
  }

  const data = await res.json();
  if (!data?.ok || !data?.url) {
    throw new Error("Upload eșuat. Răspuns invalid de la server.");
  }

  return data.url;
}

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

function useDebounced(value, delay = 400) {
  const [v, setV] = useState(value);

  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return v;
}

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
        if (!stop) {
          setNameState({ state: "error", available: null, conflict: null });
        }
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
        if (!stop) {
          setSlugState({ state: "error", available: null, suggestion: null });
        }
      }
    })();

    return () => {
      stop = true;
    };
  }, [dSlug, serviceId]);

  return { nameState, slugState };
}

function makeTeaser(txt, max = 120) {
  const s = (txt || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= max) return s;

  const cut = s.slice(0, max).replace(/\W+\w*$/, "");
  return `${cut}…`;
}

function ServiceCard({
  service,
  idx,
  vanityBase,
  saveState,
  saveError,
  updateProfile,
  slugTouchedMap,
  setSlugTouchedMap,
  setErr,
}) {
  const p = service.profile || {};
  const [open, setOpen] = useState(0);
  const sectionRefs = useRef([]);
  const hasMounted = useRef(false);

useEffect(() => {
  setOpen(0);
}, [service.id]);

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

  async function onUpload(e, key) {
    const f = e.target.files?.[0];
    if (!f) return;

    try {
      if (!/^image\/(png|jpe?g|webp)$/i.test(f.type)) {
        throw new Error("Acceptăm doar PNG / JPG / WebP.");
      }

      if (f.size > 3 * 1024 * 1024) {
        throw new Error("Maxim 3 MB.");
      }

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
    if (!slugTouchedMap[id]) {
      updateProfile(idx, { slug: slugify(val) });
    }
  }

  function onSlug(val) {
    const id = service.id;

    setSlugTouchedMap((m) => ({ ...m, [id]: true }));
    updateProfile(idx, {
      slug: val.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    });
  }

  const linkPreview = p.slug?.trim()
    ? `https://${vanityBase.replace(/\/+$/, "")}/magazin/${p.slug.trim()}`
    : "";

  const SHORT_MAX = 120;
  const tooLong = (p.shortDescription || "").length > SHORT_MAX;

  const storeDisplayName =
    p.displayName?.trim() ||
    service.title?.trim() ||
    p.slug?.trim() ||
    `Magazin ${idx + 1}`;

  const storeStatus =
    service.status === "ACTIVE" && service.isActive
      ? "Activ"
      : service.status === "ACTIVE"
      ? "Activ"
      : "Draft";

  const identBadge =
  !p.displayName?.trim() ||
  !p.slug?.trim() ||
  !p.logoUrl?.trim() ? (
      <span className={styles.badgeBad}>incomplet</span>
    ) : (
      <span className={styles.badgeOk}>ok</span>
    );

  return (
    <div className={styles.card} key={service.id} style={{ padding: 0 }}>
      <div
        className={styles.cardHead}
        style={{
          padding: "10px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className={styles.serviceName} style={{ fontWeight: 800 }}>
            {storeDisplayName}
          </div>
          <div className={styles.muted} style={{ fontSize: 12, marginTop: 2 }}>
            {service.type?.name || "Serviciu"} • {storeStatus}
          </div>
        </div>

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

      <div ref={(el) => (sectionRefs.current[0] = el)}>
        <SectionCard
          title="Profil public"
          subtitle="brand • link public • identitate vizuală"
          open={true}
onToggle={() => {}}
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
              <small
                className={styles.fieldError}
                id={`brand-${service.id}-hint`}
              >
                ❌ Numele este deja folosit
              </small>
            )}

            {nameState.state === "error" && (
              <small
                className={styles.fieldError}
                id={`brand-${service.id}-hint`}
              >
                Eroare la verificare
              </small>
            )}
          </Row>

          <Row
            id={`slug-${service.id}`}
            label="Link public (slug) *"
            help={linkPreview || "ex: atelierul-ana"}
          >
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
              <small
                className={styles.fieldError}
                id={`slug-${service.id}-hint`}
              >
                ❌ Slug ocupat
                {slugState.suggestion
                  ? ` — sugestie: ${slugState.suggestion}`
                  : ""}
              </small>
            )}

            {slugState.state === "error" && (
              <small
                className={styles.fieldError}
                id={`slug-${service.id}-hint`}
              >
                Eroare la verificare
              </small>
            )}
          </Row>

          <Row
            id={`short-${service.id}`}
            label="Descriere scurtă (opțional)"
            help='Max. 120 caractere • ex: „Magazin bijuterii handmade”'
          >
            <div className={styles.inputWrap}>
              <input
                id={`short-${service.id}`}
                className={styles.input}
                value={p.shortDescription || ""}
                onChange={(e) =>
                  updateProfile(idx, {
                    shortDescription: e.target.value.slice(0, SHORT_MAX),
                  })
                }
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
                  onClick={() =>
                    updateProfile(idx, {
                      shortDescription: makeTeaser(p.about, SHORT_MAX),
                    })
                  }
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
            <Row id={`logo-${service.id}`} label="Logo / poză *">
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
              id={`cover-${service.id}`}
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
            id={`about-${service.id}`}
            label="Despre magazin (opțional)"
            help="Povestea brandului se poate completa și ulterior."
          >
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
    </div>
  );
}

export default function ProfileTab({
  services,
  vanityBase,
  saveState,
  saveError,
  updateProfile,
  isSavingAny,
  hasNameConflict,
  onContinue,
  continueLabel = "Continuă",
  err,
  setErr,
}) {
  const [slugTouchedMap, setSlugTouchedMap] = useState({});
  const [isSolo, setIsSolo] = useState(false);
  const [qpServiceId, setQpServiceId] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      setIsSolo(sp.get("solo") === "1");
      setQpServiceId((sp.get("serviceId") || "").trim());
    }
  }, []);

  const blockers = useMemo(() => {
    const list = [];

    for (const s of services) {
      const p = s.profile || {};

      if (!p.displayName?.trim()) list.push("Nume brand");
      if (!p.slug?.trim()) list.push("Slug");
      if (!p.logoUrl?.trim()) list.push("Logo");

    }

    return [...new Set(list)];
  }, [services]);

  const canContinue = !isSavingAny && !hasNameConflict && blockers.length === 0;

  const firstService =
    Array.isArray(services) && services[0] ? services[0] : null;

  const firstSlug = firstService?.profile?.slug?.trim() || "";
  const backToProfileUrl = firstSlug ? `/magazin/${firstSlug}` : "/magazin";

  const autoOpenSingle = isSolo && !!qpServiceId && services.length === 1;

  return (
    <div role="tabpanel" className={styles.tabPanel} aria-labelledby="tab-profil">
      <header className={styles.header}>
        <h1 className={styles.title}>Profil magazin</h1>
        <p className={styles.subtitle}>
          {isSolo
            ? "Datele se salvează automat atunci când editezi."
            : "Completează datele publice ale magazinului. Livrarea, retururile și politicile se vor configura la adăugarea produselor."}
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
              slugTouchedMap={slugTouchedMap}
              setSlugTouchedMap={setSlugTouchedMap}
              setErr={setErr}
              initiallyOpen={autoOpenSingle && idx === 0}
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
              {continueLabel}
            </button>

            {!canContinue && (
              <small className={styles.help}>Mai ai: {blockers.join(", ")}.</small>
            )}
          </>
        )}
      </div>
    </div>
  );
}