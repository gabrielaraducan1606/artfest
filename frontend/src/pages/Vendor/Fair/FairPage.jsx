// src/pages/Vendor/Fair/FairPage.jsx
//
// /vendor/targ-artfest - Târgul de Crăciun Artfest (etapa 1: înscriere).
// Inventarul / recepția / POS-ul NU sunt implementate aici; pentru
// înscrierile aprobate există doar locul pregătit pentru pasul următor.

import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Gift, MapPin, Package, Truck, X } from "lucide-react";
import { api } from "../../../lib/api";
import {
  DEFAULT_CANCELLATION_MESSAGE,
  FAIR_API,
  FAIR_TITLE,
  PARTICIPATION_LABEL,
  PARTICIPATION_OPTIONS,
  STATUS_LABEL,
  STATUS_TONE,
  formatFairDate,
  useArtfestFair,
} from "./artfestFair.js";
import FairInventorySection from "./FairInventorySection.jsx";
import FairReturnsSection from "./FairReturnsSection.jsx";
import FairSalesSection from "./FairSalesSection.jsx";
import FairSettlementsSection from "./FairSettlementsSection.jsx";
import styles from "./FairPage.module.css";

const SUCCESS_MESSAGE = "Înscrierea ta a fost trimisă. Te vom anunța după verificare.";
// ce poate face vendorul când înscrierea nu e disponibilă (motivul vine de pe server)
const ELIGIBILITY_CTA = {
  store_not_activated: { to: "/onboarding", label: "Activează-ți magazinul" },
  profile_incomplete: { to: "/onboarding/details", label: "Completează profilul magazinului" },
};

// pagina de citire a draftului - NU este termsUrl și nu se salvează la înscriere
const FAIR_RULES_DRAFT_PATH = "/targ-artfest/regulament-draft";
const MAX_PRODUCT_TYPES = 20;

const OPTION_ICONS = {
  PARTICIPARE_FIZICA: MapPin,
  PARTICIPARE_LA_DISTANTA: Truck,
};

// prefill = contactul vendorului (prima înscriere) sau înscrierea retrasă (reînscriere)
function emptyForm(prefill) {
  return {
    participationType: prefill?.participationType || "",
    contactName: prefill?.contactName || "",
    contactPhone: prefill?.contactPhone || "",
    contactEmail: prefill?.contactEmail || "",
    productTypes: Array.isArray(prefill?.productTypes) ? prefill.productTypes : [],
    productTypeDraft: "",
    estimatedProductCount: prefill?.estimatedProductCount ? String(prefill.estimatedProductCount) : "",
    notes: prefill?.notes || "",
    // acceptarea condițiilor se cere de fiecare dată
    termsAccepted: false,
    // declarația de activitate legală - doar validare în formular, nu se trimite / salvează
    legalActivityConfirmed: false,
  };
}

function splitProductTypes(text) {
  return String(text || "")
    .split(",")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function mergeProductTypes(current, additions) {
  const seen = new Set(current.map((item) => item.toLocaleLowerCase("ro-RO")));
  const out = [...current];
  for (const item of additions) {
    const key = item.toLocaleLowerCase("ro-RO");
    if (seen.has(key) || out.length >= MAX_PRODUCT_TYPES) continue;
    seen.add(key);
    out.push(item.slice(0, 80));
  }
  return out;
}

export default function FairPage() {
  const { loading, error, data, setData, reload } = useArtfestFair();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const formRef = useRef(null);

  const fair = data?.fair || null;
  const registration = data?.registration || null;
  const actions = data?.actions || { canRegister: false, canWithdraw: false };
  const eligibility = data?.eligibility || null;

  const dateLabel = useMemo(() => {
    const start = formatFairDate(fair?.startsAt);
    const end = formatFairDate(fair?.endsAt);
    if (start && end && start !== end) return `${start} – ${end}`;
    return start || "";
  }, [fair?.startsAt, fair?.endsAt]);

  function openForm() {
    setForm(emptyForm(data?.prefill || registration));
    setFieldErrors({});
    setSubmitError("");
    setSuccess("");
    setFormOpen(true);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: "" } : prev));
  }

  function addProductTypes(text) {
    const additions = splitProductTypes(text);
    if (!additions.length) return;
    setForm((prev) => ({
      ...prev,
      productTypes: mergeProductTypes(prev.productTypes, additions),
      productTypeDraft: "",
    }));
    setFieldErrors((prev) => ({ ...prev, productTypes: "" }));
  }

  function removeProductType(item) {
    setForm((prev) => ({ ...prev, productTypes: prev.productTypes.filter((p) => p !== item) }));
  }

  function validate(values) {
    const errors = {};
    if (!values.participationType) errors.participationType = "Alege tipul de participare.";
    if (values.contactName.trim().length < 2) errors.contactName = "Completează persoana de contact.";
    if (values.contactPhone.replace(/\D/g, "").length < 6) errors.contactPhone = "Completează un număr de telefon valid.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.contactEmail.trim())) {
      errors.contactEmail = "Completează o adresă de email validă.";
    }
    if (!values.productTypes.length) errors.productTypes = "Spune-ne ce tipuri de produse ai aduce sau trimite.";
    const count = Number(values.estimatedProductCount);
    if (!Number.isInteger(count) || count < 1) {
      errors.estimatedProductCount = "Completează un număr estimativ de produse (minimum 1).";
    }
    if (!values.legalActivityConfirmed) {
      errors.legalActivityConfirmed =
        "Pentru a trimite înscrierea, confirmă că desfășori activitatea într-o formă legală și autorizată și că poți emite documentele necesare.";
    }
    if (!values.termsAccepted) errors.termsAccepted = "Trebuie să accepți condițiile de participare.";
    return errors;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (submitting || !form) return;

    // textul rămas în câmpul de tipuri de produse se adaugă automat
    const values = {
      ...form,
      productTypes: mergeProductTypes(form.productTypes, splitProductTypes(form.productTypeDraft)),
    };

    const errors = validate(values);
    setFieldErrors(errors);
    setSubmitError("");
    if (Object.keys(errors).length) return;

    setSubmitting(true);
    try {
      const res = await api(`${FAIR_API}/registration`, {
        method: "POST",
        body: {
          participationType: values.participationType,
          contactName: values.contactName,
          contactPhone: values.contactPhone,
          contactEmail: values.contactEmail,
          productTypes: values.productTypes,
          estimatedProductCount: Number(values.estimatedProductCount),
          notes: values.notes,
          termsAccepted: values.termsAccepted === true,
          // versiunea citită și bifată; serverul o înregistrează doar dacă e cea legată acum de târg
          termsVersion: fair?.termsVersion || null,
        },
      });
      // starea nouă vine direct din răspuns (fără să mai apară CTA-ul de înscriere)
      setData({
        ...data,
        registration: res?.registration || null,
        actions: { canRegister: false, canWithdraw: true },
        prefill: null,
      });
      setFormOpen(false);
      setForm(null);
      setSuccess(res?.message || SUCCESS_MESSAGE);
    } catch (err) {
      if (err?.data?.fields) setFieldErrors(err.data.fields);
      // regulament actualizat între timp: bifa nu mai e valabilă, vendorul o dă din nou după ce citește
      if (err?.data?.error === "terms_version_changed") setForm((prev) => (prev ? { ...prev, termsAccepted: false } : prev));
      setSubmitError(err?.data?.message || err?.message || "Nu am putut trimite înscrierea.");
      if (err?.status === 409) await reload();
    } finally {
      setSubmitting(false);
    }
  }

  async function onWithdraw() {
    if (withdrawing) return;
    if (!window.confirm("Sigur vrei să îți retragi înscrierea la Târgul Artfest?")) return;

    setWithdrawing(true);
    setSuccess("");
    try {
      const res = await api(`${FAIR_API}/registration/withdraw`, { method: "POST" });
      setData({
        ...data,
        registration: res?.registration || registration,
        actions: {
          canRegister: fair?.registrationOpen !== false && Boolean(fair?.termsUrl) && data?.eligibility?.eligible !== false,
          canWithdraw: false,
        },
      });
    } catch (err) {
      setSubmitError(err?.data?.message || err?.message || "Nu am putut retrage înscrierea.");
      await reload();
    } finally {
      setWithdrawing(false);
    }
  }

  if (loading && !data) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Se încarcă…</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={styles.page}>
        <div className={styles.errorBox} role="alert">
          {error || "Nu am putut încărca informațiile despre târg."}
        </div>
      </main>
    );
  }

  const status = registration?.status || null;
  const registerLabel = status === "WITHDRAWN" ? "Înscrie-te din nou" : "Înscrie-te la târg";

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <span className={styles.heroIcon} aria-hidden="true">
          <Gift size={26} />
        </span>
        <div className={styles.heroText}>
          <h1 className={styles.title}>{fair?.title || FAIR_TITLE}</h1>
          <p className={styles.subtitle}>
            {fair?.subtitle || "Artfest iese din online și își întâlnește pentru prima dată publicul."}
          </p>
          {(dateLabel || fair?.venue) && (
            <p className={styles.meta}>
              {[dateLabel, fair?.venue, fair?.city].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </header>

      {success && (
        <div className={styles.successBox} role="status">
          <CheckCircle2 size={18} aria-hidden="true" /> {success}
        </div>
      )}

      <section className={styles.options} aria-label="Variante de participare">
        {PARTICIPATION_OPTIONS.map((option) => {
          const Icon = OPTION_ICONS[option.value] || Package;
          return (
            <article key={option.value} className={styles.option}>
              <span className={styles.optionIcon} aria-hidden="true">
                <Icon size={20} />
              </span>
              <h2 className={styles.optionTitle}>{option.label}</h2>
              <p className={styles.optionText}>{option.description}</p>
            </article>
          );
        })}
      </section>

      {/* pentru toți vendorii, indiferent de înscriere; bifa obligatorie e doar în formular */}
      <section className={styles.legalNotice} aria-labelledby="fair-legal-notice-title">
        <h2 id="fair-legal-notice-title" className={styles.legalNoticeTitle}>
          Important pentru participarea la Târgul Artfest
        </h2>
        <p>
          Pentru participarea la târg și comercializarea produselor prin Artfest, este necesar să desfășori activitatea
          într-o formă legală și autorizată și să poți emite documentele fiscale/comerciale necesare pentru produsele
          vândute.
        </p>
        <p>
          Persoanele care desfășoară activitatea fără o formă legală de organizare și fără posibilitatea de a emite
          documentele necesare nu pot participa la comercializarea produselor în cadrul târgului.
        </p>
      </section>

      {registration && (
        <section className={styles.card} aria-label="Înscrierea ta">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Înscrierea ta</h2>
            <span className={`${styles.badge} ${styles[`tone_${STATUS_TONE[status] || "muted"}`]}`}>
              {STATUS_LABEL[status] || status}
            </span>
          </div>

          <dl className={styles.summary}>
            <div>
              <dt>Tip participare</dt>
              <dd>{PARTICIPATION_LABEL[registration.participationType] || registration.participationType}</dd>
            </div>
            <div>
              <dt>Persoană de contact</dt>
              <dd>
                {registration.contactName} · {registration.contactPhone} · {registration.contactEmail}
              </dd>
            </div>
            <div>
              <dt>Tipuri de produse</dt>
              <dd>{registration.productTypes?.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>Număr estimativ de produse</dt>
              <dd>{registration.estimatedProductCount ?? "—"}</dd>
            </div>
            {registration.notes && (
              <div>
                <dt>Observații</dt>
                <dd className={styles.preWrap}>{registration.notes}</dd>
              </div>
            )}
            <div>
              <dt>Trimisă la</dt>
              <dd>{formatFairDate(registration.submittedAt) || "—"}</dd>
            </div>
          </dl>

          {status === "SUBMITTED" && (
            <p className={styles.muted}>Îți verificăm înscrierea și te anunțăm după verificare.</p>
          )}

          {status === "APPROVED" && (
            <p className={styles.muted}>
              Pasul următor: adaugă mai jos produsele pe care le aduci sau le trimiți la târg. Etichetele le generăm și le aplicăm noi, la recepție.
            </p>
          )}

          {status === "REJECTED" && (
            <p className={styles.muted}>
              Pentru detalii, poți contacta echipa Artfest din <Link to="/vendor/support">Asistență</Link>.
            </p>
          )}

          {status === "WITHDRAWN" && (
            <p className={styles.muted}>Ți-ai retras înscrierea. Te poți înscrie din nou cât timp înscrierile sunt deschise.</p>
          )}

          {status === "CANCELLED" && (
            <div className={styles.errorBox} role="status">
              <p className={styles.preWrap}>{registration.cancellationMessage || DEFAULT_CANCELLATION_MESSAGE}</p>
              <p>
                Pentru întrebări, scrie-ne din <Link to="/vendor/support">Asistență</Link>.
              </p>
            </div>
          )}

          {actions.canWithdraw && (
            <div className={styles.cardActions}>
              <button type="button" className={styles.btnGhost} onClick={onWithdraw} disabled={withdrawing}>
                {withdrawing ? "Se retrage…" : "Retrage înscrierea"}
              </button>
            </div>
          )}
        </section>
      )}

      {(status === "APPROVED" || status === "CANCELLED") && <FairSettlementsSection />}
      {(status === "APPROVED" || status === "CANCELLED") && <FairSalesSection />}
      {(status === "APPROVED" || status === "CANCELLED") && <FairReturnsSection />}
      {(status === "APPROVED" || status === "CANCELLED") && <FairInventorySection />}

      {!registration && fair?.registrationOpen === false && (
        <p className={styles.muted}>Înscrierile pentru târg sunt închise.</p>
      )}

      {fair?.registrationOpen !== false && !fair?.termsUrl && (!registration || status === "WITHDRAWN") && (
        // fără regulament publicat nu există ce accepta: înscrierea nu se poate trimite
        <p className={styles.muted}>
          Înscrierile se deschid după publicarea regulamentului târgului. Până atunci poți citi{" "}
          <a href={FAIR_RULES_DRAFT_PATH} target="_blank" rel="noopener noreferrer">
            draftul regulamentului
          </a>{" "}
          (nu este versiunea oficială).
        </p>
      )}

      {fair?.registrationOpen !== false &&
        fair?.termsUrl &&
        eligibility &&
        eligibility.eligible === false &&
        (!registration || status === "WITHDRAWN") && (
          // magazin neactivat / dezactivat / cont restricționat: înscrierea nu e disponibilă (regula e și pe server)
          <section className={styles.eligibilityBox} role="status" aria-label="Înscrierea nu este disponibilă">
            <p>{eligibility.message}</p>
            <Link className={styles.btn} to={ELIGIBILITY_CTA[eligibility.reason]?.to || "/vendor/support"}>
              {ELIGIBILITY_CTA[eligibility.reason]?.label || "Contactează Asistența"}
            </Link>
          </section>
        )}

      {submitError && !formOpen && (
        <div className={styles.errorBox} role="alert">
          {submitError}
        </div>
      )}

      {actions.canRegister && !formOpen && (
        <div className={styles.ctaRow}>
          <button type="button" className={styles.btn} onClick={openForm}>
            {registerLabel}
          </button>
        </div>
      )}

      {formOpen && form && (
        <form ref={formRef} className={styles.card} onSubmit={onSubmit} noValidate aria-label="Formular de înscriere">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Formular de înscriere</h2>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setFormOpen(false)}
              aria-label="Închide formularul"
            >
              <X size={18} />
            </button>
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>Tip participare</legend>
            <div className={styles.radioGrid}>
              {PARTICIPATION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`${styles.radioCard} ${
                    form.participationType === option.value ? styles.radioCardActive : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="participationType"
                    value={option.value}
                    checked={form.participationType === option.value}
                    onChange={() => update("participationType", option.value)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
            {fieldErrors.participationType && <p className={styles.fieldError}>{fieldErrors.participationType}</p>}
          </fieldset>

          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.label}>Persoană de contact</span>
              <input
                className={styles.input}
                value={form.contactName}
                onChange={(e) => update("contactName", e.target.value)}
                maxLength={160}
                autoComplete="name"
                aria-invalid={fieldErrors.contactName ? "true" : undefined}
              />
              {fieldErrors.contactName && <span className={styles.fieldError}>{fieldErrors.contactName}</span>}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Telefon</span>
              <input
                className={styles.input}
                type="tel"
                value={form.contactPhone}
                onChange={(e) => update("contactPhone", e.target.value)}
                maxLength={50}
                autoComplete="tel"
                aria-invalid={fieldErrors.contactPhone ? "true" : undefined}
              />
              {fieldErrors.contactPhone && <span className={styles.fieldError}>{fieldErrors.contactPhone}</span>}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Email</span>
              <input
                className={styles.input}
                type="email"
                value={form.contactEmail}
                onChange={(e) => update("contactEmail", e.target.value)}
                maxLength={320}
                autoComplete="email"
                aria-invalid={fieldErrors.contactEmail ? "true" : undefined}
              />
              {fieldErrors.contactEmail && <span className={styles.fieldError}>{fieldErrors.contactEmail}</span>}
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Număr estimativ de produse</span>
              <input
                className={styles.input}
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                step={1}
                value={form.estimatedProductCount}
                onChange={(e) => update("estimatedProductCount", e.target.value)}
                aria-invalid={fieldErrors.estimatedProductCount ? "true" : undefined}
              />
              {fieldErrors.estimatedProductCount && (
                <span className={styles.fieldError}>{fieldErrors.estimatedProductCount}</span>
              )}
            </label>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="fair-product-types">
              Tipuri de produse pe care vrei să le aduci sau să le trimiți
            </label>
            {form.productTypes.length > 0 && (
              <ul className={styles.chips}>
                {form.productTypes.map((item) => (
                  <li key={item} className={styles.chip}>
                    {item}
                    <button type="button" onClick={() => removeProductType(item)} aria-label={`Elimină ${item}`}>
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.inline}>
              <input
                id="fair-product-types"
                className={styles.input}
                value={form.productTypeDraft}
                placeholder="ex.: ceramică, lumânări, decorațiuni"
                onChange={(e) => update("productTypeDraft", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addProductTypes(form.productTypeDraft);
                  }
                }}
                aria-invalid={fieldErrors.productTypes ? "true" : undefined}
              />
              <button type="button" className={styles.btnGhost} onClick={() => addProductTypes(form.productTypeDraft)}>
                Adaugă
              </button>
            </div>
            {fieldErrors.productTypes && <span className={styles.fieldError}>{fieldErrors.productTypes}</span>}
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Observații (opțional)</span>
            <textarea
              className={styles.textarea}
              rows={4}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
            />
          </label>

          {/* ambele tipuri de participare: vânzarea se face prin Artfest; informarea e în zona comună a paginii */}
          <div className={styles.legalConfirm}>
            <label className={styles.checkbox} htmlFor="fair-legal-activity">
              <input
                id="fair-legal-activity"
                type="checkbox"
                checked={form.legalActivityConfirmed}
                onChange={(e) => update("legalActivityConfirmed", e.target.checked)}
                aria-invalid={fieldErrors.legalActivityConfirmed ? "true" : undefined}
                aria-describedby={fieldErrors.legalActivityConfirmed ? "fair-legal-activity-error" : undefined}
              />
              <span>
                Confirm că desfășor activitatea într-o formă legală și autorizată și că pot emite documentele
                fiscale/comerciale necesare pentru produsele comercializate prin Târgul Artfest.
              </span>
            </label>
            {fieldErrors.legalActivityConfirmed && (
              <p id="fair-legal-activity-error" className={styles.fieldError} role="alert">
                {fieldErrors.legalActivityConfirmed}
              </p>
            )}
          </div>

          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={form.termsAccepted}
              onChange={(e) => update("termsAccepted", e.target.checked)}
              aria-invalid={fieldErrors.termsAccepted ? "true" : undefined}
            />
            <span>
              Am citit și accept{" "}
              {fair?.termsUrl && fair?.termsVersion ? (
                <>
                  <a href={fair.termsUrl} target="_blank" rel="noopener noreferrer">
                    Regulamentul și condițiile de participare la Târgul Artfest
                  </a>{" "}
                  (versiunea {fair.termsVersion})
                </>
              ) : (
                "Regulamentul și condițiile de participare la Târgul Artfest"
              )}
              .
            </span>
          </label>
          {!(fair?.termsUrl && fair?.termsVersion) && (
            // regulamentul oficial nu e publicat încă: draftul se poate citi, separat de acceptare
            <p className={styles.muted}>
              <a href={FAIR_RULES_DRAFT_PATH} target="_blank" rel="noopener noreferrer">
                Vezi draftul regulamentului
              </a>{" "}
              (draft de lucru – nu este versiunea oficială).
            </p>
          )}
          {fieldErrors.termsAccepted && <p className={styles.fieldError}>{fieldErrors.termsAccepted}</p>}

          {submitError && (
            <div className={styles.errorBox} role="alert">
              {submitError}
            </div>
          )}

          <div className={styles.cardActions}>
            <button type="button" className={styles.btnGhost} onClick={() => setFormOpen(false)} disabled={submitting}>
              Renunță
            </button>
            <button type="submit" className={styles.btn} disabled={submitting}>
              {submitting ? "Se trimite…" : "Trimite înscrierea"}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
