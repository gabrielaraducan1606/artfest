// src/pages/Influencer/InfluencerCompliancePage/InfluencerCompliancePage.jsx
//
// Formularul de conformitate (ex. acord părinte / tutore pentru minori),
// cerut MANUAL de admin. Un singur flux pe 4 pași, mobile friendly, fără
// tabel. Accesibil doar după login (RequireInfluencer). Backend:
// GET /api/influencer/compliance, POST /api/influencer/compliance/:gateId/submit
// (services/influencerComplianceGate.js).

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

import { api } from "../../../lib/api.js";
import { sanitizeHtml } from "../../../utils/sanitizeHtml.js";
import styles from "./InfluencerCompliancePage.module.css";
import { AGE_MESSAGES, classifyBirthDate } from "./complianceAge.js";

const STEPS = ["Date influencer", "Părinte / tutore", "Declarații", "Confirmare"];

const DECLARATIONS = [
  { key: "readDocuments", label: "Am citit documentele aplicabile." },
  { key: "consentParticipation", label: "Sunt de acord cu participarea minorului în programul Artfest." },
  {
    key: "consentDataProcessing",
    label: "Sunt de acord cu prelucrarea datelor necesare pentru administrarea programului.",
  },
  { key: "infoAccurate", label: "Confirm că informațiile furnizate sunt corecte." },
  {
    key: "withdrawalInfo",
    label: "Înțeleg că pot contacta Artfest pentru retragerea acordului, unde este aplicabil.",
  },
];

const RELATIONSHIPS = [
  { value: "PARENT", label: "Părinte" },
  { value: "LEGAL_GUARDIAN", label: "Tutore legal" },
];

const FIELD_MESSAGES = {
  influencerName: "Completează numele influencerului.",
  influencerEmail: "Emailul nu este valid.",
  influencerBirthDate: "Data nașterii nu este validă.",
  declaredMinor: "Confirmă că persoana este minoră la data completării.",
  guardianName: "Completează numele complet al părintelui / tutorelui.",
  guardianRelationship: "Alege relația cu minorul.",
  guardianEmail: "Emailul nu este valid (diferit de emailul influencerului).",
  guardianEmailConfirm: "Emailurile părintelui / tutorelui nu coincid.",
  guardianPhone: "Telefonul nu este valid (ex. 0712345678).",
  "declarations.guardianConfirmed": "Confirmarea este obligatorie.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

function emptyForm(prefill) {
  return {
    influencerName: prefill?.influencerName || "",
    influencerEmail: prefill?.influencerEmail || "",
    influencerBirthDate: "",
    declaredMinor: false,
    guardianName: "",
    guardianRelationship: "",
    guardianEmail: "",
    guardianEmailConfirm: "",
    guardianPhone: "",
    declarations: {
      guardianConfirmed: false,
      ...Object.fromEntries(DECLARATIONS.map((d) => [d.key, false])),
    },
  };
}

// validare locală pe pas (serverul revalidează tot)
function validateStep(step, form) {
  const e = {};
  if (step === 0) {
    if (form.influencerName.trim().length < 2) e.influencerName = FIELD_MESSAGES.influencerName;
    if (!EMAIL_RE.test(form.influencerEmail.trim())) e.influencerEmail = FIELD_MESSAGES.influencerEmail;
    const ageCategory = classifyBirthDate(form.influencerBirthDate);
    if (ageCategory === "INVALID") e.influencerBirthDate = FIELD_MESSAGES.influencerBirthDate;
    else if (ageCategory === "UNDER_MIN") e.influencerBirthDate = AGE_MESSAGES.UNDER_MIN;
    else if (ageCategory === "ADULT") e.influencerBirthDate = AGE_MESSAGES.ADULT;
    if (!form.declaredMinor) e.declaredMinor = FIELD_MESSAGES.declaredMinor;
  }
  if (step === 1) {
    if (form.guardianName.trim().length < 3) e.guardianName = FIELD_MESSAGES.guardianName;
    if (!form.guardianRelationship) e.guardianRelationship = FIELD_MESSAGES.guardianRelationship;
    const ge = normalizeEmail(form.guardianEmail);
    if (!EMAIL_RE.test(ge) || ge === normalizeEmail(form.influencerEmail)) {
      e.guardianEmail = FIELD_MESSAGES.guardianEmail;
    }
    const gc = normalizeEmail(form.guardianEmailConfirm);
    if (!gc || gc !== ge) e.guardianEmailConfirm = FIELD_MESSAGES.guardianEmailConfirm;
    if (!/^\+?\d{9,15}$/.test(form.guardianPhone.replace(/[^\d+]/g, ""))) e.guardianPhone = FIELD_MESSAGES.guardianPhone;
    if (!form.declarations.guardianConfirmed) e["declarations.guardianConfirmed"] = FIELD_MESSAGES["declarations.guardianConfirmed"];
  }
  if (step === 2) {
    for (const d of DECLARATIONS) {
      if (!form.declarations[d.key]) e[`declarations.${d.key}`] = "Declarația este obligatorie.";
    }
  }
  return e;
}

const STEP_OF_FIELD = (field) =>
  field.startsWith("influencer") || field === "declaredMinor"
    ? 0
    : field.startsWith("guardian") || field === "declarations.guardianConfirmed"
    ? 1
    : 2;

export default function InfluencerCompliancePage() {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [form, setForm] = useState(() => emptyForm(null));
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const headingRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/influencer/compliance")
      .then((data) => {
        if (cancelled) return;
        setState({ loading: false, error: "", data });
        setForm(emptyForm(data?.prefill));
      })
      .catch((e) => {
        if (!cancelled) setState({ loading: false, error: e?.message || "Nu am putut încărca formularul.", data: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    headingRef.current?.focus?.();
  }, [step, done]);

  const documentHtml = useMemo(() => sanitizeHtml(state.data?.document?.html || ""), [state.data]);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((x) => ({ ...x, [key]: undefined }));
  };
  const setDeclaration = (key, value) => {
    setForm((f) => ({ ...f, declarations: { ...f.declarations, [key]: value } }));
    setErrors((x) => ({ ...x, [`declarations.${key}`]: undefined }));
  };

  const next = () => {
    const e = validateStep(step, form);
    setErrors(e);
    if (Object.keys(e).length) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = async () => {
    if (busy) return;
    setSubmitError("");
    setBusy(true);
    try {
      await api(`/api/influencer/compliance/${encodeURIComponent(state.data.gate.id)}/submit`, {
        method: "POST",
        body: form,
      });
      setDone(true);
    } catch (e) {
      setSubmitError(e?.data?.message || e?.message || "Nu am putut trimite formularul.");
      const fields = Array.isArray(e?.data?.fields) ? e.data.fields : [];
      if (fields.length) {
        const ageMessage = AGE_MESSAGES[e?.data?.ageCategory];
        setErrors(
          Object.fromEntries(
            fields.map((f) => [
              f,
              (f === "influencerBirthDate" && ageMessage) || FIELD_MESSAGES[f] || "Verifică acest câmp.",
            ])
          )
        );
        setStep(Math.min(...fields.map(STEP_OF_FIELD)));
      }
    } finally {
      setBusy(false);
    }
  };

  if (state.loading) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>
          <Loader2 size={16} className={styles.spin} aria-hidden="true" /> Se încarcă formularul…
        </p>
      </main>
    );
  }

  const data = state.data;

  if (done) {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <CheckCircle2 size={36} className={styles.success} aria-hidden="true" />
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Acordul a fost înregistrat
          </h1>
          <p className={styles.text}>
            Mulțumim! Am trimis o confirmare pe emailul tău și pe emailul părintelui / tutorelui. Funcțiile
            contului de influencer sunt din nou disponibile.
          </p>
          <Link to="/influencer" className={styles.primaryBtn}>
            Mergi la dashboard
          </Link>
        </section>
      </main>
    );
  }

  if (state.error || !data?.enabled || !data?.canSubmit || !data?.gate) {
    const status = data?.status;
    const message = state.error
      ? state.error
      : status === "COMPLETED"
      ? "Acordul de conformitate a fost deja înregistrat."
      : status === "NOT_REQUIRED" || !data?.enabled
      ? "Nu ai niciun formular de conformitate de completat."
      : "Această solicitare nu mai este activă. Scrie-ne la support@artfest.ro pentru o solicitare nouă.";
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Formular de conformitate
          </h1>
          <p className={styles.text}>{message}</p>
          <Link to="/influencer" className={styles.secondaryBtn}>
            Înapoi la dashboard
          </Link>
        </section>
      </main>
    );
  }

  const progress = Math.round(((step + 1) / STEPS.length) * 100);
  const err = (key) =>
    errors[key] ? (
      <span id={`err-${key}`} className={styles.fieldError} role="alert">
        {errors[key]}
      </span>
    ) : null;

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>
          <ShieldCheck size={16} aria-hidden="true" /> Conformitate
        </p>
        <h1 className={styles.title}>Acord părinte / tutore pentru participarea la programul Artfest</h1>

        <div className={styles.progress} aria-label={`Pasul ${step + 1} din ${STEPS.length}: ${STEPS[step]}`}>
          <div className={styles.progressMeta}>
            <span>
              Pasul {step + 1} din {STEPS.length}
            </span>
            <strong>{STEPS[step]}</strong>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressBar} style={{ width: `${progress}%` }} />
          </div>
        </div>

        <h2 ref={headingRef} tabIndex={-1} className={styles.stepTitle}>
          {STEPS[step]}
        </h2>

        {step === 0 && (
          <div className={styles.fields}>
            <label className={styles.field}>
              <span>Nume influencer *</span>
              <input
                className={styles.input}
                value={form.influencerName}
                maxLength={160}
                autoComplete="name"
                onChange={(e) => set("influencerName", e.target.value)}
                aria-invalid={!!errors.influencerName}
              />
              {err("influencerName")}
            </label>
            <label className={styles.field}>
              <span>Email influencer *</span>
              <input
                className={styles.input}
                type="email"
                value={form.influencerEmail}
                maxLength={320}
                autoComplete="email"
                onChange={(e) => set("influencerEmail", e.target.value)}
                aria-invalid={!!errors.influencerEmail}
              />
              {err("influencerEmail")}
            </label>
            <label className={styles.field}>
              <span>Data nașterii influencerului *</span>
              <input
                className={styles.input}
                type="date"
                value={form.influencerBirthDate}
                onChange={(e) => set("influencerBirthDate", e.target.value)}
                aria-invalid={!!errors.influencerBirthDate}
              />
              {err("influencerBirthDate")}
              <small className={styles.muted}>
                Programul este disponibil de la 16 ani împliniți; între 16 și 18 ani este necesar acordul părintelui
                sau tutorelui legal.
              </small>
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={form.declaredMinor} onChange={(e) => set("declaredMinor", e.target.checked)} />
              <span>Declar că persoana este minoră la data completării.</span>
            </label>
            {err("declaredMinor")}
          </div>
        )}

        {step === 1 && (
          <div className={styles.fields}>
            <label className={styles.field}>
              <span>Numele complet al părintelui / tutorelui *</span>
              <input
                className={styles.input}
                value={form.guardianName}
                maxLength={160}
                onChange={(e) => set("guardianName", e.target.value)}
                aria-invalid={!!errors.guardianName}
              />
              {err("guardianName")}
            </label>
            <fieldset className={styles.radioGroup}>
              <legend>Relația cu minorul *</legend>
              {RELATIONSHIPS.map((r) => (
                <label key={r.value} className={styles.radio}>
                  <input
                    type="radio"
                    name="guardianRelationship"
                    value={r.value}
                    checked={form.guardianRelationship === r.value}
                    onChange={() => set("guardianRelationship", r.value)}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
              {err("guardianRelationship")}
            </fieldset>
            <label className={styles.field}>
              <span>Emailul părintelui / tutorelui *</span>
              <input
                className={styles.input}
                type="email"
                value={form.guardianEmail}
                maxLength={320}
                onChange={(e) => set("guardianEmail", e.target.value)}
                aria-invalid={!!errors.guardianEmail}
              />
              {err("guardianEmail")}
            </label>
            <label className={styles.field}>
              <span>Confirmă emailul părintelui / tutorelui *</span>
              <input
                className={styles.input}
                type="email"
                value={form.guardianEmailConfirm}
                maxLength={320}
                autoComplete="off"
                onChange={(e) => set("guardianEmailConfirm", e.target.value)}
                aria-invalid={!!errors.guardianEmailConfirm}
              />
              {err("guardianEmailConfirm")}
            </label>
            <label className={styles.field}>
              <span>Telefonul părintelui / tutorelui *</span>
              <input
                className={styles.input}
                type="tel"
                inputMode="tel"
                value={form.guardianPhone}
                maxLength={40}
                onChange={(e) => set("guardianPhone", e.target.value)}
                aria-invalid={!!errors.guardianPhone}
              />
              {err("guardianPhone")}
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.declarations.guardianConfirmed}
                onChange={(e) => setDeclaration("guardianConfirmed", e.target.checked)}
              />
              <span>Confirm că sunt părintele sau tutorele legal al minorului.</span>
            </label>
            {err("declarations.guardianConfirmed")}
          </div>
        )}

        {step === 2 && (
          <div className={styles.fields}>
            <details className={styles.document}>
              <summary>
                Citește documentul: {data.document?.title} (versiunea {data.document?.version})
              </summary>
              <div className={styles.documentBody} dangerouslySetInnerHTML={{ __html: documentHtml }} />
            </details>
            {DECLARATIONS.map((d) => (
              <div key={d.key}>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={form.declarations[d.key]}
                    onChange={(e) => setDeclaration(d.key, e.target.checked)}
                  />
                  <span>{d.label}</span>
                </label>
                {err(`declarations.${d.key}`)}
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className={styles.fields}>
            <dl className={styles.summary}>
              <dt>Influencer</dt>
              <dd>
                {form.influencerName} · {form.influencerEmail}
              </dd>
              <dt>Data nașterii</dt>
              <dd>{form.influencerBirthDate.split("-").reverse().join(".")}</dd>
              <dt>Părinte / tutore</dt>
              <dd>
                {form.guardianName} ({RELATIONSHIPS.find((r) => r.value === form.guardianRelationship)?.label})
              </dd>
              <dt>Contact părinte / tutore</dt>
              <dd>
                {normalizeEmail(form.guardianEmail)} · {form.guardianPhone}
              </dd>
              <dt>Document</dt>
              <dd>
                {data.document?.title}, versiunea {data.document?.version}
              </dd>
            </dl>
            <p className={styles.muted}>
              După trimitere, trimitem o confirmare pe emailul tău și pe emailul părintelui / tutorelui.
            </p>
            {submitError && (
              <div className={styles.error} role="alert">
                {submitError}
              </div>
            )}
          </div>
        )}

        <div className={styles.actions}>
          {step > 0 && (
            <button type="button" className={styles.secondaryBtn} onClick={() => setStep((s) => s - 1)} disabled={busy}>
              Înapoi
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button type="button" className={styles.primaryBtn} onClick={next}>
              Continuă
            </button>
          ) : (
            <button type="button" className={styles.primaryBtn} onClick={submit} disabled={busy}>
              {busy && <Loader2 size={16} className={styles.spin} aria-hidden="true" />}
              {busy ? "Se trimite…" : "Trimite acordul"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
