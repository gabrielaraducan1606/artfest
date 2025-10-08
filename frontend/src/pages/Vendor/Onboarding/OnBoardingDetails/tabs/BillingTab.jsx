import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../../lib/api";
import styles from "../OnBoardingDetails.module.css";

const DRAFT_PREFIX = "onboarding.billing.draft:";

// validări simple pentru RO; ajustează după nevoi
function validate(values) {
  const v = {
    ...values,
    cui: (values.cui || "").toUpperCase().trim(),
    regCom: (values.regCom || "").toUpperCase().trim(),
    iban: (values.iban || "").replace(/\s+/g, "").toUpperCase(),
    email: (values.email || "").trim(),
    companyName: (values.companyName || "").trim(),
    address: (values.address || "").trim(),
    bank: (values.bank || "").trim(),
  };

  const errors = {};
  if (!v.companyName) errors.companyName = "Completează denumirea.";
  if (!v.cui) errors.cui = "Completează CUI-ul.";
  else if (!/^(RO)?\d{2,10}$/.test(v.cui)) errors.cui = "CUI invalid (ex: RO12345678).";

  if (!v.regCom) errors.regCom = "Completează Nr. Reg. Com.";
  else if (!/^(J|F)\d{1,2}\/\d{1,6}\/\d{2,4}$/i.test(v.regCom))
    errors.regCom = "Format invalid (ex: J40/123/2020).";

  if (!v.address) errors.address = "Completează adresa de facturare.";

  if (!v.iban) errors.iban = "Completează IBAN-ul.";
  else if (!/^RO\d{2}[A-Z]{4}\d{16}$/i.test(v.iban))
    errors.iban = "IBAN RO invalid (ex: RO49AAAA1B31007593840000).";

  if (!v.bank) errors.bank = "Completează banca.";

  if (!v.email) errors.email = "Completează emailul.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))
    errors.email = "Email invalid.";

  return { errors, normalized: v };
}

function BillingForm({ obSessionId, onSaved, onStatusChange }) {
  const draftKey = useMemo(() => `${DRAFT_PREFIX}${obSessionId || "default"}`, [obSessionId]);

  const [billing, setBilling] = useState({
    companyName: "",
    cui: "",
    regCom: "",
    address: "",
    iban: "",
    bank: "",
    email: "",
  });
  const [status, setStatus] = useState("idle"); // 'idle'|'saving'|'saved'|'error'
  const [err, setErr] = useState("");
  const [loadedDraft, setLoadedDraft] = useState(false);

  // pentru mesaje pe câmp
  const [touched, setTouched] = useState({});
  const [{ errors }, setErrorsState] = useState({ errors: {} });

  // raportează status în părinte
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // restore draft din sessionStorage (o singură dată)
  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const raw = window.sessionStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        setBilling((v) => ({
          ...v,
          ...["companyName","cui","regCom","address","iban","bank","email"].reduce((acc, k) => {
            if (typeof draft?.[k] === "string") acc[k] = draft[k];
            return acc;
          }, {}),
        }));
        setLoadedDraft(true);
      }
    } catch {
      // ignore
    }
  }, [draftKey]);

  // autosave draft în sessionStorage (debounced 300ms)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      try {
        window.sessionStorage.setItem(draftKey, JSON.stringify(billing));
      } catch {""}
    }, 300);
    return () => clearTimeout(t);
  }, [billing, draftKey]);

  function onFieldChange(name) {
    return (e) => {
      const value = e.target.value;
      setBilling((prev) => {
        const next = { ...prev, [name]: value };
        if (touched[name]) {
          const result = validate(next);
          setErrorsState(result);
        }
        return next;
      });
    };
  }

  function onFieldBlur(name) {
    return () => {
      setTouched((t) => ({ ...t, [name]: true }));
      const result = validate(billing);
      setErrorsState(result);
    };
  }

  async function save() {
    const result = validate(billing);
    setErrorsState(result);
    setTouched({
      companyName: true, cui: true, regCom: true, address: true, iban: true, bank: true, email: true
    });

    if (Object.keys(result.errors).length) {
      setStatus("error");
      setErr("Te rugăm să corectezi câmpurile evidențiate.");
      return;
    }

    try {
      setStatus("saving");
      setErr("");

      const payload = result.normalized;
      await api("/api/vendors/me/billing", { method: "PUT", body: payload });

      setStatus("saved");
      // curățăm draftul din sesiunea de TAB
      try { if (typeof window !== "undefined") window.sessionStorage.removeItem(draftKey); } catch {""}
      setTimeout(() => setStatus("idle"), 1200);
      onSaved?.();
    } catch (e) {
      setStatus("error");
      setErr(e?.message || "Eroare la salvare.");
    }
  }

  function clearDraftAndReset() {
    try { if (typeof window !== "undefined") window.sessionStorage.removeItem(draftKey); } catch {""}
    setBilling({ companyName:"", cui:"", regCom:"", address:"", iban:"", bank:"", email:"" });
    setTouched({});
    setErrorsState({ errors: {} });
    setLoadedDraft(false);
  }

  return (
    <form className={styles.form} onSubmit={(e)=>{e.preventDefault(); void save();}} noValidate>
      <header className={styles.header}>
        <h2 className={styles.cardTitle}>Date facturare</h2>
        <div className={styles.saveIndicator}>
          {status==="saving"&&<span className={styles.badgeWait}>Se salvează…</span>}
          {status==="saved" &&<span className={styles.badgeOk}>Salvat</span>}
          {status==="error" &&<span className={styles.badgeBad}>Eroare</span>}
        </div>
      </header>

      <div style={{marginBottom: 8}}>
        <small className={styles.help}>
          Se salvează local ca <em>draft</em> doar în sesiunea acestui TAB.
          {loadedDraft && (
            <> Draft încărcat. <button type="button" className={styles.link} onClick={clearDraftAndReset}>Șterge draftul</button></>
          )}
        </small>
      </div>

      <div className={styles.grid}>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="companyName">Denumire companie / Persoană fizică</label>
          <input
            id="companyName"
            className={`${styles.input} ${errors.companyName ? styles.inputError : ""}`}
            value={billing.companyName}
            onChange={onFieldChange("companyName")}
            onBlur={onFieldBlur("companyName")}
            placeholder="SC Exemplu SRL / Ion Popescu"
            aria-invalid={!!errors.companyName}
            aria-describedby={errors.companyName ? "err-companyName" : undefined}
          />
          {errors.companyName && <small id="err-companyName" className={styles.fieldError}>{errors.companyName}</small>}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="cui">CUI</label>
          <input
            id="cui"
            className={`${styles.input} ${errors.cui ? styles.inputError : ""}`}
            value={billing.cui}
            onChange={onFieldChange("cui")}
            onBlur={onFieldBlur("cui")}
            placeholder="RO12345678"
            aria-invalid={!!errors.cui}
            aria-describedby={errors.cui ? "err-cui" : undefined}
          />
          {errors.cui && <small id="err-cui" className={styles.fieldError}>{errors.cui}</small>}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="regCom">Nr. Reg. Com.</label>
          <input
            id="regCom"
            className={`${styles.input} ${errors.regCom ? styles.inputError : ""}`}
            value={billing.regCom}
            onChange={onFieldChange("regCom")}
            onBlur={onFieldBlur("regCom")}
            placeholder="J40/123/2020"
            aria-invalid={!!errors.regCom}
            aria-describedby={errors.regCom ? "err-regCom" : undefined}
          />
          {errors.regCom && <small id="err-regCom" className={styles.fieldError}>{errors.regCom}</small>}
        </div>

        <div className={styles.fieldGroup} style={{gridColumn:"1 / -1"}}>
          <label className={styles.label} htmlFor="address">Adresă facturare</label>
          <input
            id="address"
            className={`${styles.input} ${errors.address ? styles.inputError : ""}`}
            value={billing.address}
            onChange={onFieldChange("address")}
            onBlur={onFieldBlur("address")}
            placeholder="Str. Exemplu 10, București"
            aria-invalid={!!errors.address}
            aria-describedby={errors.address ? "err-address" : undefined}
          />
          {errors.address && <small id="err-address" className={styles.fieldError}>{errors.address}</small>}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="iban">IBAN</label>
          <input
            id="iban"
            className={`${styles.input} ${errors.iban ? styles.inputError : ""}`}
            value={billing.iban}
            onChange={onFieldChange("iban")}
            onBlur={onFieldBlur("iban")}
            placeholder="RO49AAAA1B31007593840000"
            aria-invalid={!!errors.iban}
            aria-describedby={errors.iban ? "err-iban" : undefined}
          />
          {errors.iban && <small id="err-iban" className={styles.fieldError}>{errors.iban}</small>}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="bank">Banca</label>
          <input
            id="bank"
            className={`${styles.input} ${errors.bank ? styles.inputError : ""}`}
            value={billing.bank}
            onChange={onFieldChange("bank")}
            onBlur={onFieldBlur("bank")}
            placeholder="BCR / ING / BT"
            aria-invalid={!!errors.bank}
            aria-describedby={errors.bank ? "err-bank" : undefined}
          />
          {errors.bank && <small id="err-bank" className={styles.fieldError}>{errors.bank}</small>}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="email">Email facturare</label>
          <input
            id="email"
            className={`${styles.input} ${errors.email ? styles.inputError : ""}`}
            type="email"
            value={billing.email}
            onChange={onFieldChange("email")}
            onBlur={onFieldBlur("email")}
            placeholder="facturi@exemplu.ro"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "err-email" : undefined}
          />
          {errors.email && <small id="err-email" className={styles.fieldError}>{errors.email}</small>}
        </div>
      </div>

      {err && <div className={styles.error} role="alert">{err}</div>}

      <div style={{marginTop:12, display:"flex", gap:8}}>
        <button type="submit" className={styles.primaryBtn} disabled={status==="saving"}>
          {status==="saving" ? "Se salvează…" : "Salvează"}
        </button>
        <button
          type="button"
          className={styles.link}
          onClick={clearDraftAndReset}
          title="Golește toate câmpurile și șterge draftul local (doar acest TAB)"
        >
          Resetează formularul
        </button>
      </div>
    </form>
  );
}

export default function BillingTab({ obSessionId, onSaved, onStatusChange, canContinue, onContinue }) {
  return (
    <div role="tabpanel" className={styles.tabPanel} aria-labelledby="tab-facturare">
      <BillingForm obSessionId={obSessionId} onSaved={onSaved} onStatusChange={onStatusChange} />

      <div className={styles.wizardNav}>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={onContinue}
          disabled={!canContinue}
          aria-disabled={!canContinue}
          title={!canContinue ? "Salvează întâi datele de facturare" : undefined}
        >
          Continuă
        </button>
        {!canContinue && (
          <small className={styles.help}>Te rugăm să salvezi formularul de facturare înainte.</small>
        )}
      </div>
    </div>
  );
}
