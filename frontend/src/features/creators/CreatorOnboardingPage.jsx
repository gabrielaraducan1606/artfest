// src/features/creators/CreatorOnboardingPage.jsx
//
// Artfest Creators - onboarding în 3 pași (Despre tine / Rețele sociale / Cum
// colaborezi), cu salvare de draft la fiecare pas, „Completez mai târziu”,
// previzualizare și „Trimite spre aprobare”. Același ecran servește și editarea
// ulterioară a profilului (?pas=1..3). Datele obligatorii doar pentru publicare.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, Plus, Trash2, UserRound } from "lucide-react";

import { api } from "../../lib/api";
import {
  CREATORS_API,
  CREATOR_ROUTES,
  ONBOARDING_STEPS,
  clampStep,
  fieldErrors,
  friendlyError,
  liveOnboardingProgress,
  livePublishProblems,
  parseIntOrNull,
  socialRowErrors,
  statusView,
} from "./creatorsLogic.js";
import { ConfirmDialog, CreatorProfilePreview, PhotoPicker, SkeletonBlock } from "./creatorsShared.jsx";
import { cx, useCreatorState } from "./creatorsClient.js";
import styles from "./Creators.module.css";

const PLATFORM_ORDER = ["INSTAGRAM", "TIKTOK", "FACEBOOK", "YOUTUBE"];

function toggle(list, value, max) {
  if (list.includes(value)) return list.filter((v) => v !== value);
  return list.length >= max ? list : [...list, value];
}

function socialsToForm(socials = []) {
  return PLATFORM_ORDER.map((platform) => {
    const s = socials.find((x) => x.platform === platform);
    return {
      platform,
      enabled: Boolean(s),
      url: s?.url || "",
      handle: s?.handle || "",
      followers: s ? String(s.followersDeclared) : "",
      views: s?.avgViewsDeclared != null ? String(s.avgViewsDeclared) : "",
      engagement: s?.engagementBps != null ? String(s.engagementBps / 100).replace(".", ",") : "",
    };
  });
}

// „3,5” (%) -> 350 puncte de bază; null dacă e gol
function engagementToBps(value) {
  const text = String(value || "").trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : NaN;
}

function aboutFromProfile(profile) {
  return {
    displayName: profile.displayName,
    bio: profile.bio,
    city: profile.city,
    slug: profile.slug,
    niches: profile.niches,
    preferredCategories: profile.preferredCategories,
  };
}

function collabFromProfile(profile) {
  return {
    acceptsProducts: profile.acceptsProducts,
    acceptsPaid: profile.acceptsPaid,
    typicalTurnaroundDays: profile.typicalTurnaroundDays ? String(profile.typicalTurnaroundDays) : "",
    availableForCollabs: profile.availableForCollabs,
    contentLanguages: profile.contentLanguages?.length ? profile.contentLanguages : ["ro"],
  };
}

function FieldError({ message }) {
  return message ? (
    <p className={styles.fieldError} role="alert">
      {message}
    </p>
  ) : null;
}

export default function CreatorOnboardingPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const step = clampStep(params.get("pas"));
  const { state, setState, options, error: loadError, loading } = useCreatorState();
  const profile = state?.profile || null;

  const [about, setAbout] = useState(null);
  const [socials, setSocials] = useState(null);
  const [collab, setCollab] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [link, setLink] = useState({ title: "", url: "" });
  // rețele sociale: erorile pe câmp apar după ieșirea din câmp sau după o încercare de salvare
  const [socialTouched, setSocialTouched] = useState({});
  const [socialsAttempted, setSocialsAttempted] = useState(false);
  const creating = useRef(false);
  const headingRef = useRef(null);
  const successRef = useRef(null);

  // după trimitere: ecranul de confirmare de sus (altfel rămâne sub meniul fix, la poziția veche de scroll)
  useEffect(() => {
    if (!submitted) return;
    window.scrollTo?.({ top: 0 });
    successRef.current?.focus({ preventScroll: true });
  }, [submitted]);

  // prima intrare: profilul (draft) se creează aici - un singur profil per cont
  useEffect(() => {
    if (!state || state.profile || creating.current) return;
    creating.current = true;
    api(`${CREATORS_API}/profile`, { method: "POST" })
      .then(setState)
      .catch((e) => setFormError(friendlyError(e, "Nu am putut porni configurarea. Reîncarcă pagina.")));
  }, [state, setState]);

  /*
   * Formularele pornesc O SINGURĂ DATĂ din profilul salvat. După o salvare
   * explicită se reîmprospătează doar secțiunea salvată; încărcarea fotografiei
   * sau un element de portofoliu NU resetează textul încă nesalvat din alte câmpuri.
   */
  const initializedFor = useRef(null);
  useEffect(() => {
    if (!profile || initializedFor.current === profile.id) return;
    initializedFor.current = profile.id;
    setAbout(aboutFromProfile(profile));
    setSocials(socialsToForm(profile.socials));
    setCollab(collabFromProfile(profile));
  }, [profile]);

  useEffect(() => {
    headingRef.current?.focus();
    setErrors({});
    setFormError("");
    setSocialTouched({});
    setSocialsAttempted(false);
  }, [step]);

  // progresul și pașii bifați reflectă și datele încă nesalvate din formular
  const liveProblems = useMemo(
    () => livePublishProblems(profile, { about, socials, collab }, options),
    [profile, about, socials, collab, options]
  );
  const progress = useMemo(() => liveOnboardingProgress(profile, { about, socials, collab }, options), [profile, about, socials, collab, options]);
  const liveProblemsForStep = (n) => liveProblems.filter((p) => p.step === n);
  const platformDef = (value) => options?.platforms?.find((p) => p.value === value);
  const socialErrorsAt = (index) => socialRowErrors(socials?.[index], platformDef(socials?.[index]?.platform));
  const showSocialError = (index, field) => (socialsAttempted || socialTouched[`${index}.${field}`] ? socialErrorsAt(index)[field] : null);
  const locked = profile && !profile.canEditContent;
  const limits = options?.limits || {};

  function goStep(n) {
    setShowPreview(false);
    const next = new URLSearchParams(params);
    next.set("pas", String(n));
    setParams(next, { replace: false });
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  async function run(request) {
    setSaving(true);
    setErrors({});
    setFormError("");
    try {
      const next = await request();
      if (next?.profile) setState(next);
      setSavedAt(new Date());
      // răspunsul (pentru reîmprospătarea secțiunii salvate) sau null la eroare
      return next || {};
    } catch (e) {
      setErrors(fieldErrors(e));
      setFormError(friendlyError(e));
      return null;
    } finally {
      setSaving(false);
    }
  }

  const saveAbout = async () => {
    const next = await run(() =>
      api(`${CREATORS_API}/profile`, {
        method: "PATCH",
        body: {
          displayName: about.displayName,
          bio: about.bio,
          city: about.city,
          niches: about.niches,
          preferredCategories: about.preferredCategories,
          ...(profile.slugLocked || about.slug === profile.slug ? {} : { slug: about.slug }),
          expectedVersion: profile.version,
        },
      })
    );
    if (next?.profile) setAbout(aboutFromProfile(next.profile));
    return Boolean(next);
  };

  function socialsPayload() {
    const list = [];
    let invalid = false;
    socials.forEach((s, index) => {
      if (!s.enabled) return;
      if (Object.keys(socialErrorsAt(index)).length) invalid = true;
      const followers = parseIntOrNull(s.followers);
      const views = parseIntOrNull(s.views);
      const engagement = engagementToBps(s.engagement);
      list.push({
        platform: s.platform,
        url: s.url.trim(),
        handle: s.handle.trim(),
        followersDeclared: followers,
        avgViewsDeclared: Number.isNaN(views) ? null : views,
        engagementBps: Number.isNaN(engagement) ? null : engagement,
      });
    });
    return { list, invalid };
  }

  // indexurile din răspuns se referă la lista trimisă (doar platformele bifate)
  function mapSocialErrors(fields) {
    const enabled = socials.map((s, i) => (s.enabled ? i : null)).filter((i) => i !== null);
    const mapped = {};
    for (const [key, message] of Object.entries(fields)) {
      const match = /^socials\.(\d+)$/.exec(key);
      mapped[match ? `socials.${enabled[Number(match[1])]}` : key] = message;
    }
    return mapped;
  }

  async function saveSocials() {
    const { list, invalid } = socialsPayload();
    if (invalid) {
      // erorile pe câmp (bordură roșie + mesaj) se calculează din formular
      setSocialsAttempted(true);
      setErrors({});
      setFormError("Verifică rețelele sociale marcate cu roșu.");
      return false;
    }
    setSaving(true);
    setErrors({});
    setFormError("");
    try {
      const next = await api(`${CREATORS_API}/profile/socials`, { method: "PUT", body: { socials: list } });
      setState(next);
      setSocials(socialsToForm(next.profile.socials));
      setSavedAt(new Date());
      return true;
    } catch (e) {
      setErrors(mapSocialErrors(fieldErrors(e)));
      setFormError(friendlyError(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const saveCollab = async () => {
    const next = await run(() =>
      api(`${CREATORS_API}/profile`, {
        method: "PATCH",
        body: {
          acceptsProducts: collab.acceptsProducts,
          acceptsPaid: collab.acceptsPaid,
          availableForCollabs: collab.availableForCollabs,
          typicalTurnaroundDays: collab.typicalTurnaroundDays ? Number(collab.typicalTurnaroundDays) : null,
          contentLanguages: collab.contentLanguages,
          expectedVersion: profile.version,
        },
      })
    );
    if (next?.profile) setCollab(collabFromProfile(next.profile));
    return Boolean(next);
  };

  const saveCurrent = () => {
    if (step === 1) return locked ? Promise.resolve(true) : saveAbout();
    if (step === 2) return locked ? Promise.resolve(true) : saveSocials();
    return saveCollab();
  };

  async function onContinue() {
    if (!(await saveCurrent())) return;
    if (step < ONBOARDING_STEPS.length) goStep(step + 1);
    else setShowPreview(true);
  }

  async function onBack() {
    // salvarea a eșuat => rămânem pe pas, cu eroarea vizibilă (nu pierdem datele în tăcere)
    if (step > 1 && (await saveCurrent())) goStep(step - 1);
  }

  async function onLater() {
    if (await saveCurrent()) navigate(CREATOR_ROUTES.home);
  }

  async function setAvatar(url) {
    await run(() => api(`${CREATORS_API}/profile`, { method: "PATCH", body: { avatarUrl: url } }));
  }

  async function addPortfolio(body) {
    const ok = await run(() => api(`${CREATORS_API}/profile/portfolio`, { method: "POST", body }));
    // golim câmpurile linkului doar după adăugarea unui link (nu și după o fotografie)
    if (ok && body.kind === "LINK") setLink({ title: "", url: "" });
  }

  async function removePortfolio(id) {
    await run(() => api(`${CREATORS_API}/profile/portfolio/${encodeURIComponent(id)}`, { method: "DELETE" }));
  }

  async function submit() {
    const ok = await run(() => api(`${CREATORS_API}/profile/submit`, { method: "POST" }));
    setConfirmSubmit(false);
    if (ok) setSubmitted(true);
  }

  /* ---------------- randare ---------------- */

  if ((loadError || formError) && !profile) {
    return (
      <main className={styles.page}>
        <p className={styles.alert} role="alert">
          {loadError || formError}
        </p>
      </main>
    );
  }

  if (loading || !profile || !about) {
    return (
      <main className={styles.page} aria-busy="true">
        <SkeletonBlock height={28} />
        <div style={{ height: 16 }} />
        <SkeletonBlock height={320} />
      </main>
    );
  }

  if (submitted) {
    return (
      <main className={styles.page}>
        <section className={styles.statusCard} aria-live="polite">
          <span className={cx(styles.badge, styles.tone_warning)}>În verificare</span>
          <h1 className={styles.title} style={{ marginTop: 10 }} ref={successRef} tabIndex={-1}>
            Mulțumim! Profilul tău a fost trimis spre aprobare.
          </h1>
          <p className={styles.lead}>Primești un email și o notificare în cont imediat ce echipa Artfest îl verifică.</p>
          <div className={styles.actions} style={{ marginTop: 16 }}>
            <Link className={styles.btnPrimary} to={CREATOR_ROUTES.home}>
              Mergi la Artfest Creators
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const view = statusView(state);
  const stepProblems = liveProblemsForStep(step);

  return (
    <main className={cx(styles.page, styles.pageWithFooter)}>
      <div className={styles.topBar}>
        <Link to={CREATOR_ROUTES.home} className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" /> Artfest Creators
        </Link>
        <span className={styles.saveState} aria-live="polite">
          {saving ? "Se salvează…" : savedAt ? `Salvat la ${savedAt.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}` : "Draftul se salvează la fiecare pas"}
        </span>
      </div>

      <p className={styles.eyebrow}>Profilul meu de creator</p>
      <h1 className={styles.title} ref={headingRef} tabIndex={-1}>
        {ONBOARDING_STEPS[step - 1].title}
      </h1>
      <p className={styles.lead}>{ONBOARDING_STEPS[step - 1].hint}</p>

      <ol className={styles.steps} aria-label={`Pasul ${step} din ${ONBOARDING_STEPS.length}`}>
        {ONBOARDING_STEPS.map((s) => {
          const done = liveProblemsForStep(s.n).length === 0;
          return (
            <li key={s.n} className={cx(styles.step, s.n === step && styles.stepActive, done && styles.stepDone)} aria-current={s.n === step ? "step" : undefined}>
              <span className={styles.stepBar} />
              <button type="button" className={styles.btnGhost} style={{ minHeight: 32, padding: 0, justifyContent: "flex-start" }} onClick={() => saveCurrent().then((ok) => ok && goStep(s.n))}>
                <span className={styles.stepLabel}>
                  {done ? <Check size={14} aria-hidden="true" /> : `${s.n}.`} <span className={styles.stepHint}>{s.title}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className={cx(styles.hint)} style={{ marginTop: -12, marginBottom: 16 }}>
        {progress.done} din {progress.total} pași completați pentru publicare
      </p>

      {(state.entry === "changes_requested" || profile.moderationMessage) && (
        <div className={styles.message}>
          <strong>Mesajul echipei Artfest:</strong> {profile.moderationMessage || view.text}
        </div>
      )}
      {locked && (
        <p className={styles.alert} role="status">
          {view.title}. {view.text}
        </p>
      )}
      {formError && (
        <p className={styles.alert} role="alert">
          {formError}
        </p>
      )}

      {step === 1 && (
        <section className={styles.card} aria-labelledby="pas1">
          <h2 id="pas1" className={styles.srOnly}>
            Despre tine
          </h2>
          <div className={styles.field}>
            <span className={styles.label}>Fotografie de profil</span>
            <div className={styles.avatarRow}>
              {profile.avatarUrl ? (
                <img className={styles.avatar} src={profile.avatarUrl} alt="Fotografia ta de profil" />
              ) : (
                <div className={cx(styles.avatar, styles.avatarPlaceholder)}>
                  <UserRound size={36} aria-hidden="true" />
                </div>
              )}
              <PhotoPicker onUploaded={setAvatar} disabled={locked}>
                {profile.avatarUrl ? "Schimbă fotografia" : "Încarcă o fotografie"}
              </PhotoPicker>
            </div>
            <FieldError message={errors.avatarUrl} />
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Nume public</span>
            <input
              className={cx(styles.input, errors.displayName && styles.inputInvalid)}
              value={about.displayName}
              maxLength={limits.displayNameMax || 80}
              onChange={(e) => setAbout({ ...about, displayName: e.target.value })}
              disabled={locked}
              autoComplete="nickname"
            />
            <FieldError message={errors.displayName} />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Descriere</span>
            <textarea
              className={cx(styles.textarea, errors.bio && styles.inputInvalid)}
              value={about.bio}
              maxLength={limits.bioMax || 1500}
              placeholder="Despre ce creezi conținut, cui te adresezi, ce colaborări ți se potrivesc."
              onChange={(e) => setAbout({ ...about, bio: e.target.value })}
              disabled={locked}
            />
            <span className={styles.counter}>
              {about.bio.length} / {limits.bioMax || 1500} (minimum {limits.bioMin || 40} pentru publicare)
            </span>
            <FieldError message={errors.bio} />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>
              Localitate <span className={styles.muted}>(opțional)</span>
            </span>
            <input className={styles.input} value={about.city} onChange={(e) => setAbout({ ...about, city: e.target.value })} disabled={locked} autoComplete="address-level2" />
          </label>

          <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
            <legend className={styles.label}>Nișe (maximum {limits.nichesMax || 5})</legend>
            <div className={styles.chips}>
              {options?.niches?.map((n) => {
                const active = about.niches.includes(n.value);
                return (
                  <button key={n.value} type="button" aria-pressed={active} className={cx(styles.chip, active && styles.chipActive)} onClick={() => setAbout({ ...about, niches: toggle(about.niches, n.value, limits.nichesMax || 5) })} disabled={locked}>
                    {n.label}
                  </button>
                );
              })}
            </div>
            <FieldError message={errors.niches} />
          </fieldset>

          <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
            <legend className={styles.label}>
              Categorii de produse preferate <span className={styles.muted}>(opțional)</span>
            </legend>
            <div className={styles.chips}>
              {options?.categories?.map((c) => {
                const active = about.preferredCategories.includes(c.value);
                return (
                  <button key={c.value} type="button" aria-pressed={active} className={cx(styles.chip, active && styles.chipActive)} onClick={() => setAbout({ ...about, preferredCategories: toggle(about.preferredCategories, c.value, limits.categoriesMax || 6) })} disabled={locked}>
                    {c.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <details>
            <summary className={styles.small}>Adresa profilului: artfest.ro/creatori/{about.slug}</summary>
            <label className={styles.field} style={{ marginTop: 10 }}>
              <span className={styles.label}>Adresa (litere mici, cifre și cratime)</span>
              <input className={cx(styles.input, errors.slug && styles.inputInvalid)} value={about.slug} onChange={(e) => setAbout({ ...about, slug: e.target.value.toLowerCase() })} disabled={locked || profile.slugLocked} />
              {profile.slugLocked && <p className={styles.hint}>Adresa nu se mai schimbă după publicare, ca linkurile distribuite să rămână valide.</p>}
              <FieldError message={errors.slug} />
            </label>
          </details>
        </section>
      )}

      {step === 2 && (
        <>
          <section className={styles.card} aria-labelledby="pas2">
            <h2 id="pas2" className={styles.cardTitle}>
              Rețelele tale
            </h2>
            <p className={styles.hint} style={{ margin: "4px 0 14px" }}>
              Adaugă linkul complet al profilului și numărul de urmăritori. Statisticile apar pe profil marcate ca „declarate”.
            </p>
            {socials.map((s, index) => {
              const def = options?.platforms?.find((p) => p.value === s.platform);
              const update = (patch) => setSocials(socials.map((x, i) => (i === index ? { ...x, ...patch } : x)));
              const touch = (field) => setSocialTouched((t) => (t[`${index}.${field}`] ? t : { ...t, [`${index}.${field}`]: true }));
              const fieldProps = (field, extra) => {
                const message = showSocialError(index, field);
                const id = `social-${s.platform}-${field}`;
                return {
                  id,
                  className: cx(styles.input, message && styles.inputInvalid),
                  "aria-invalid": message ? true : undefined,
                  "aria-describedby": message ? `${id}-error` : undefined,
                  onBlur: () => touch(field),
                  disabled: locked,
                  ...extra,
                };
              };
              const fieldMessage = (field) => {
                const message = showSocialError(index, field);
                return message ? (
                  <p id={`social-${s.platform}-${field}-error`} className={styles.fieldError} role="alert">
                    {message}
                  </p>
                ) : null;
              };
              return (
                <div key={s.platform} className={styles.socialRow}>
                  <div className={styles.socialHead}>
                    <strong>{def?.label || s.platform}</strong>
                    <label className={styles.small} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.target.checked })} disabled={locked} />
                      Am cont {def?.label}
                    </label>
                  </div>
                  {s.enabled && (
                    <>
                      <label className={styles.field} style={{ marginBottom: 0 }}>
                        <span className={styles.label}>Link profil</span>
                        <input {...fieldProps("url")} type="url" inputMode="url" autoComplete="url" placeholder={`https://${def?.host || ""}/numele-tau`} value={s.url} onChange={(e) => update({ url: e.target.value })} />
                        {fieldMessage("url")}
                      </label>
                      <div className={styles.socialStats}>
                        <label className={styles.field} style={{ marginBottom: 0 }}>
                          <span className={styles.label}>Urmăritori</span>
                          <input {...fieldProps("followers")} inputMode="numeric" value={s.followers} onChange={(e) => update({ followers: e.target.value })} />
                          {fieldMessage("followers")}
                        </label>
                        <label className={styles.field} style={{ marginBottom: 0 }}>
                          <span className={styles.label}>
                            Vizualizări medii <span className={styles.muted}>(opțional)</span>
                          </span>
                          <input {...fieldProps("views")} inputMode="numeric" value={s.views} onChange={(e) => update({ views: e.target.value })} />
                          {fieldMessage("views")}
                        </label>
                        <label className={styles.field} style={{ marginBottom: 0 }}>
                          <span className={styles.label}>
                            Engagement % <span className={styles.muted}>(opțional)</span>
                          </span>
                          <input {...fieldProps("engagement")} inputMode="decimal" value={s.engagement} onChange={(e) => update({ engagement: e.target.value })} />
                          {fieldMessage("engagement")}
                        </label>
                      </div>
                      <FieldError message={errors[`socials.${index}`]} />
                    </>
                  )}
                </div>
              );
            })}
            <FieldError message={errors.socials} />
          </section>

          <section className={styles.card} aria-labelledby="portofoliu">
            <h2 id="portofoliu" className={styles.cardTitle}>
              Portofoliu <span className={cx(styles.muted, styles.small)}>(opțional)</span>
            </h2>
            <p className={styles.hint} style={{ margin: "4px 0 14px" }}>
              Fotografii sau linkuri către Reel-uri și videoclipuri din colaborări anterioare (maximum {limits.portfolioMax || 12}).
            </p>
            {profile.portfolio.length > 0 && (
              <div className={styles.portfolioGrid} style={{ marginBottom: 14 }}>
                {profile.portfolio.map((item) => (
                  <div key={item.id} className={styles.portfolioItem}>
                    {item.kind === "IMAGE" ? (
                      <img src={item.imageUrl} alt={item.title} loading="lazy" />
                    ) : (
                      <a className={styles.portfolioLink} href={item.linkUrl} target="_blank" rel="noopener noreferrer nofollow">
                        {item.title}
                      </a>
                    )}
                    <div className={styles.portfolioCaption}>{item.title}</div>
                    {!locked && (
                      <button type="button" className={styles.iconBtn} onClick={() => removePortfolio(item.id)} aria-label={`Șterge „${item.title}”`}>
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!locked && profile.portfolio.length < (limits.portfolioMax || 12) && (
              <div className={styles.grid}>
                <PhotoPicker onUploaded={(url) => addPortfolio({ kind: "IMAGE", imageUrl: url, title: "Fotografie din portofoliu" })}>Adaugă o fotografie</PhotoPicker>
                <div className={styles.field} style={{ marginBottom: 0 }}>
                  <span className={styles.label}>sau un link</span>
                  <input className={styles.input} placeholder="Titlu (ex. Reel colaborare decor)" value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} />
                  <input className={styles.input} inputMode="url" placeholder="https://www.instagram.com/reel/..." value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} />
                  <FieldError message={errors.linkUrl || errors.title} />
                  <div>
                    <button type="button" className={styles.btn} onClick={() => addPortfolio({ kind: "LINK", title: link.title, linkUrl: link.url })} disabled={!link.url.trim() || saving}>
                      <Plus size={16} aria-hidden="true" /> Adaugă linkul
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {step === 3 && (
        <section className={styles.card} aria-labelledby="pas3">
          <h2 id="pas3" className={styles.srOnly}>
            Cum dorești să colaborezi
          </h2>
          <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
            <legend className={styles.label}>Ce tip de colaborări accepți?</legend>
            <div className={styles.choices} role="radiogroup">
              {[
                { key: "products", title: "Produse gratuite", text: "Promovezi în schimbul produselor.", value: { acceptsProducts: true, acceptsPaid: false } },
                { key: "paid", title: "Promovare plătită", text: "Ai tarife pentru serviciile tale.", value: { acceptsProducts: false, acceptsPaid: true } },
                { key: "both", title: "Ambele", text: "Produse, plată sau o combinație.", value: { acceptsProducts: true, acceptsPaid: true } },
              ].map((c) => {
                const active = collab.acceptsProducts === c.value.acceptsProducts && collab.acceptsPaid === c.value.acceptsPaid;
                return (
                  <button key={c.key} type="button" role="radio" aria-checked={active} className={cx(styles.choice, active && styles.choiceActive)} onClick={() => setCollab({ ...collab, ...c.value })}>
                    <strong>{c.title}</strong>
                    <span>{c.text}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className={cx(styles.grid, styles.grid2)}>
            <label className={styles.field}>
              <span className={styles.label}>
                Termen orientativ de realizare (zile) <span className={styles.muted}>(opțional)</span>
              </span>
              <input className={cx(styles.input, errors.typicalTurnaroundDays && styles.inputInvalid)} inputMode="numeric" value={collab.typicalTurnaroundDays} onChange={(e) => setCollab({ ...collab, typicalTurnaroundDays: e.target.value.replace(/\D/g, "") })} />
              <FieldError message={errors.typicalTurnaroundDays} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Disponibilitate</span>
              <select className={styles.select} value={collab.availableForCollabs ? "yes" : "no"} onChange={(e) => setCollab({ ...collab, availableForCollabs: e.target.value === "yes" })}>
                <option value="yes">Disponibil(ă) pentru colaborări noi</option>
                <option value="no">Momentan nu accept colaborări noi</option>
              </select>
            </label>
          </div>

          <fieldset className={styles.field} style={{ border: 0, padding: 0 }}>
            <legend className={styles.label}>Limba conținutului</legend>
            <div className={styles.chips}>
              {options?.languages?.map((l) => {
                const active = collab.contentLanguages.includes(l.value);
                return (
                  <button key={l.value} type="button" aria-pressed={active} className={cx(styles.chip, active && styles.chipActive)} onClick={() => setCollab({ ...collab, contentLanguages: toggle(collab.contentLanguages, l.value, 3) })}>
                    {l.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <p className={styles.hint}>
            Pachetele de promovare și tarifele le configurezi oricând din <strong>Ofertele mele</strong>, după acest pas.
          </p>
        </section>
      )}

      {stepProblems.length > 0 && !showPreview && (
        <p className={styles.hint} role="note">
          Pentru publicare mai trebuie: {stepProblems.map((p) => p.message.replace(/\.$/, "").toLowerCase()).join("; ")}. Poți continua și reveni oricând.
        </p>
      )}

      {showPreview && (
        <section className={styles.card} aria-labelledby="preview-title">
          <h2 id="preview-title" className={styles.cardTitle} style={{ marginBottom: 12 }}>
            Previzualizare profil
          </h2>
          <CreatorProfilePreview profile={profile} options={options} />
          {profile.publishProblems.length > 0 ? (
            <div className={styles.message} style={{ marginTop: 14 }}>
              <strong>Mai ai de completat înainte de trimitere:</strong>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {profile.publishProblems.map((p) => (
                  <li key={p.field}>
                    {p.message}{" "}
                    <button type="button" className={styles.btnGhost} style={{ minHeight: 0, padding: 0, textDecoration: "underline" }} onClick={() => goStep(p.step)}>
                      Mergi la pasul {p.step}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className={styles.hint} style={{ marginTop: 14 }}>
              {profile.hasPublishedVersion
                ? "După aprobare, modificările înlocuiesc versiunea publică actuală."
                : "După aprobare, profilul devine vizibil pentru magazinele Artfest."}
            </p>
          )}
        </section>
      )}

      <div className={styles.footerBar}>
        <div className={styles.actions}>
          <button type="button" className={styles.btnGhost} onClick={onLater} disabled={saving}>
            Completez mai târziu
          </button>
        </div>
        <div className={styles.actions}>
          {step > 1 && (
            <button type="button" className={styles.btn} onClick={onBack} disabled={saving}>
              Înapoi
            </button>
          )}
          {showPreview ? (
            <button type="button" className={styles.btnPrimary} onClick={() => setConfirmSubmit(true)} disabled={saving || !profile.canSubmit}>
              Trimite spre aprobare
            </button>
          ) : (
            <button type="button" className={styles.btnPrimary} onClick={onContinue} disabled={saving}>
              {step < ONBOARDING_STEPS.length ? "Continuă" : "Salvează și previzualizează"}
            </button>
          )}
        </div>
      </div>

      {confirmSubmit && (
        <ConfirmDialog title="Trimiți profilul spre aprobare?" confirmLabel="Trimite" onConfirm={submit} onCancel={() => setConfirmSubmit(false)} busy={saving}>
          Echipa Artfest verifică profilul și îți răspunde prin email și notificare. Cât timp este în verificare, conținutul profilului nu se poate modifica.
        </ConfirmDialog>
      )}
    </main>
  );
}
