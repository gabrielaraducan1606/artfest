import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../../lib/api.js";
import styles from "./css/BillingTab.module.css";

const DRAFT_PREFIX = "onboarding.billing.draft:";
const LEGAL_TYPES = ["SRL", "PFA", "II", "IF"];
const PLATFORM_VAT_RATE = "21";
const PRIVACY_POLICY_URL = "/confidentialitate";

const BILLING_PURPOSE_SUMMARY =
  "Cerem aceste date pentru emiterea facturilor aferente abonamentului și comisioanelor, administrarea relației contractuale cu vendorii și îndeplinirea obligațiilor legale fiscale și contabile.";

const BILLING_RETENTION_NOTE =
  "Datele salvate în cont pot fi păstrate conform obligațiilor legale fiscale, contabile și politicilor interne de retenție aplicabile.";

function useIsMobile(breakpointPx = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setIsMobile(!!mq.matches);

    update();
    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);

    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, [breakpointPx]);

  return isMobile;
}

function InfoNote({ children }) {
  return (
    <div
      role="note"
      aria-label="Informații facturare și confidențialitate"
      className={styles.infoNote}
    >
      <span aria-hidden="true" className={styles.infoNoteIcon}>
        ℹ️
      </span>
      <div>{children}</div>
    </div>
  );
}

function InfoNoteResponsive({ summary, children }) {
  const isMobile = useIsMobile(768);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) setOpen(true);
    else setOpen(false);
  }, [isMobile]);

  if (!isMobile) {
    return (
      <InfoNote>
        <p className={styles.noMargin}>
          <strong>De ce cerem aceste date?</strong> {summary}
        </p>
        {children}
      </InfoNote>
    );
  }

  return (
    <div className={styles.infoNote}>
      <button
        type="button"
        className={styles.infoAccordionTrigger}
        aria-expanded={open}
        aria-controls="billing-info-accordion"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.infoAccordionLeft}>
          <span aria-hidden="true" className={styles.infoNoteIcon}>
            ℹ️
          </span>
          <strong>De ce cerem aceste date?</strong>
        </span>
        <span aria-hidden="true" className={styles.infoAccordionChevron}>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div id="billing-info-accordion" className={styles.infoAccordionBody}>
          <p className={styles.noMargin}>{summary}</p>
          {children}
        </div>
      )}
    </div>
  );
}

function validate(values) {
  const v = {
    ...values,
    legalType: (values.legalType || "").toUpperCase().trim(),
    vendorName: (values.vendorName || "").trim(),
    companyName: (values.companyName || "").trim(),
    cui: (values.cui || "").toUpperCase().trim(),
    regCom: (values.regCom || "").toUpperCase().trim(),
    address: (values.address || "").trim(),
    email: (values.email || "").trim(),
    contactPerson: (values.contactPerson || "").trim(),
    phone: (values.phone || "").replace(/\s+/g, "").trim(),
    vatStatus: (values.vatStatus || "").trim(),
    vatRate: (values.vatRate || "").trim(),
  };

  if (v.vatStatus === "payer") v.vatRate = PLATFORM_VAT_RATE;
  if (v.vatStatus !== "payer") v.vatRate = "";

  const errors = {};

  if (!v.legalType || !LEGAL_TYPES.includes(v.legalType)) {
    errors.legalType = "Alege tipul entității.";
  }

  if (!v.vendorName) errors.vendorName = "Completează numele vendorului.";
  if (!v.companyName) errors.companyName = "Completează denumirea entității.";

  if (!v.cui) {
    errors.cui = "Completează codul fiscal / Tax ID.";
  }

  if (!v.regCom) {
    errors.regCom = "Completează numărul de registru / identificare.";
  }

  if (!v.address) errors.address = "Completează adresa de facturare.";

  if (!v.email) errors.email = "Completează emailul de facturare.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) {
    errors.email = "Email invalid.";
  }

  if (!v.contactPerson) {
    errors.contactPerson = "Completează persoana de contact.";
  }

  if (!v.phone) errors.phone = "Completează telefonul de contact.";
  else if (!/^\+?\d{7,15}$/.test(v.phone)) {
    errors.phone = "Telefon invalid (ex: +40722123456).";
  }

  if (!v.vatStatus) {
    errors.vatStatus = "Te rugăm să alegi dacă ești plătitor de TVA.";
  }

  if (v.vatStatus === "payer" && v.vatRate !== PLATFORM_VAT_RATE) {
    errors.vatRate = `Cota TVA pentru platformă este ${PLATFORM_VAT_RATE}%.`;
  }

  if (!values.vatResponsibilityConfirmed) {
    errors.vatResponsibilityConfirmed =
      "Trebuie să confirmi că informațiile fiscale sunt corecte.";
  }

  return { errors, normalized: v };
}

function isFormEmpty(v) {
  const keys = [
    "legalType",
    "vendorName",
    "companyName",
    "cui",
    "regCom",
    "address",
    "email",
    "contactPerson",
    "phone",
    "vatStatus",
    "vatRate",
  ];

  return keys.every((k) => !String(v?.[k] ?? "").trim());
}

function pickBillingFromApi(b) {
  if (!b) return null;

  return {
    legalType: b.legalType ?? "",
    vendorName: b.vendorName ?? "",
    companyName: b.companyName ?? "",
    cui: b.cui ?? "",
    regCom: b.regCom ?? "",
    address: b.address ?? "",
    email: b.email ?? "",
    contactPerson: b.contactPerson ?? "",
    phone: b.phone ?? "",
    vatStatus: b.vatStatus ?? "",
    vatRate: b.vatRate ?? "",
    vatResponsibilityConfirmed: !!b.vatResponsibilityConfirmed,
  };
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmText = "Confirmă",
  cancelText = "Anulează",
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className={styles.modalCard}>
        <h3 id="confirm-title" className={styles.modalTitle}>
          {title}
        </h3>
        <p className={styles.modalText}>{message}</p>
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} onClick={onCancel}>
            {cancelText}
          </button>
          <button type="button" className={styles.dangerBtn} onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

function BillingForm({ onSaved, onStatusChange }) {
  const [vendorId, setVendorId] = useState("");
  const draftKey = useMemo(
    () => (vendorId ? `${DRAFT_PREFIX}${vendorId}` : ""),
    [vendorId]
  );

  const [billing, setBilling] = useState({
    legalType: "",
    vendorName: "",
    companyName: "",
    cui: "",
    regCom: "",
    address: "",
    email: "",
    contactPerson: "",
    phone: "",
    vatStatus: "",
    vatRate: "",
    vatResponsibilityConfirmed: false,
  });

  const [initialBilling, setInitialBilling] = useState(null);

  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  const [touched, setTouched] = useState({});
  const [{ errors }, setErrorsState] = useState({ errors: {} });

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDeleteDraftConfirm, setShowDeleteDraftConfirm] = useState(false);

  const [announce, setAnnounce] = useState("");

  const [hydrated, setHydrated] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const d = await api("/api/vendors/me/billing", { method: "GET" });
        if (!alive) return;

        if (d?.vendorId) {
          setVendorId(d.vendorId);
        }

        const fromApi = pickBillingFromApi(d?.billing);

        if (fromApi) {
          setBilling(fromApi);
          setInitialBilling(fromApi);
          setAnnounce("Am încărcat datele de facturare salvate în contul tău.");
        } else {
          setInitialBilling(null);
        }
      } catch {
        // ignore
      } finally {
        if (alive) setHydrated(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (billing.vatStatus === "payer") {
      if (billing.vatRate !== PLATFORM_VAT_RATE) {
        setBilling((prev) => ({ ...prev, vatRate: PLATFORM_VAT_RATE }));
      }
    } else if (billing.vatRate) {
      setBilling((prev) => ({ ...prev, vatRate: "" }));
    }
  }, [billing.vatStatus, billing.vatRate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hydrated) return;
    if (!hasInteracted) return;
    if (!vendorId || !draftKey) return;

    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(billing));
        setHasDraft(true);
      } catch {
        // ignore
      }
    }, 300);

    return () => clearTimeout(t);
  }, [billing, draftKey, hydrated, hasInteracted, vendorId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!vendorId || !draftKey) return;

    try {
      const raw = window.localStorage.getItem(draftKey);
      setHasDraft(!!raw);

      if (raw) {
        const draft = JSON.parse(raw);
        if (!isFormEmpty(draft)) {
          setBilling((prev) => ({ ...prev, ...draft }));
          setLoadedDraft(true);
          setAnnounce(
            "S-a încărcat un draft salvat local în acest browser pentru acest cont."
          );
        }
      }
    } catch {
      // ignore
    }
  }, [vendorId, draftKey]);

  function onFieldChange(name) {
    return (e) => {
      setHasInteracted(true);
      const value = e.target.value;

      setBilling((prev) => {
        const next = { ...prev, [name]: value };
        if (touched[name]) {
          setErrorsState(validate(next));
        }
        return next;
      });
    };
  }

  function onFieldBlur(name) {
    return () => {
      setTouched((t) => ({ ...t, [name]: true }));
      setErrorsState(validate(billing));
    };
  }

  const isDirty = useMemo(() => {
    const keys = [
      "legalType",
      "vendorName",
      "companyName",
      "cui",
      "regCom",
      "address",
      "email",
      "contactPerson",
      "phone",
      "vatStatus",
      "vatRate",
      "vatResponsibilityConfirmed",
    ];

    if (!initialBilling) {
      return !isFormEmpty(billing);
    }

    return keys.some((k) => (billing[k] || "") !== (initialBilling[k] || ""));
  }, [billing, initialBilling]);

  async function save() {
    const result = validate(billing);

    setErrorsState(result);
    setTouched({
      legalType: true,
      vendorName: true,
      companyName: true,
      cui: true,
      regCom: true,
      address: true,
      email: true,
      contactPerson: true,
      phone: true,
      vatStatus: true,
      vatRate: true,
      vatResponsibilityConfirmed: true,
    });

    if (Object.keys(result.errors).length) {
      setStatus("error");
      setErr("Te rugăm să corectezi câmpurile evidențiate.");
      setAnnounce("Formular invalid. Corectează câmpurile evidențiate.");
      return;
    }

    try {
      setStatus("saving");
      setErr("");
      setAnnounce("Se salvează datele de facturare…");

      const payload = result.normalized;

      await api("/api/vendors/me/billing", {
        method: "PUT",
        body: payload,
      });

      const fresh = await api("/api/vendors/me/billing", { method: "GET" });
      const fromApi = pickBillingFromApi(fresh?.billing);

      if (fromApi) {
        setBilling(fromApi);
        setInitialBilling(fromApi);
      } else {
        setInitialBilling(payload);
      }

      setStatus("saved");
      setAnnounce("Datele de facturare au fost salvate în contul tău.");

      try {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(draftKey);
          setHasDraft(false);
          setLoadedDraft(false);
        }
      } catch {
        // ignore
      }

      setHasInteracted(false);
      setTimeout(() => setStatus("idle"), 1200);
      onSaved?.();
    } catch (e) {
      setStatus("error");
      setErr(e?.message || "Eroare la salvare.");
      setAnnounce("Eroare la salvare.");
    }
  }

  function clearDraftOnly() {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(draftKey);
      }
    } catch {
      // ignore
    }

    setLoadedDraft(false);
    setHasDraft(false);
    setAnnounce("Draftul local a fost șters.");
  }

  function resetFormHard() {
    clearDraftOnly();

    setBilling({
      legalType: "",
      vendorName: "",
      companyName: "",
      cui: "",
      regCom: "",
      address: "",
      email: "",
      contactPerson: "",
      phone: "",
      vatStatus: "",
      vatRate: "",
      vatResponsibilityConfirmed: false,
    });

    setTouched({});
    setErrorsState({ errors: {} });
    setErr("");
    setInitialBilling(null);
    setHasInteracted(false);
    setAnnounce("Formularul a fost resetat.");
  }

  const canReset = !isFormEmpty(billing);

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      <div className={styles.srOnly} aria-live="polite">
        {announce}
      </div>

      <header className={styles.header}>
        <h2 className={styles.cardTitle}>Date facturare</h2>
        <div className={styles.saveIndicator}>
          {status === "saving" && (
            <span className={`${styles.badge} ${styles.badgeWait}`}>
              <span className={styles.spinner} aria-hidden="true" /> Se salvează…
            </span>
          )}
          {status === "saved" && (
            <span className={`${styles.badge} ${styles.badgeOk}`}>Salvat</span>
          )}
          {status === "error" && (
            <span className={`${styles.badge} ${styles.badgeBad}`}>Eroare</span>
          )}
        </div>
      </header>

      <InfoNoteResponsive summary={BILLING_PURPOSE_SUMMARY}>
        <ul>
          <li>
            Colectăm doar datele necesare pentru facturare, comunicări administrative
            și gestionarea relației contractuale cu vendorii.
          </li>
          <li>
            Persoana de contact, emailul și telefonul sunt folosite pentru comunicări
            privind facturi, abonamentul, comisioanele și alte aspecte administrative.
          </li>
          <li>
            Draftul formularului poate fi salvat local în browserul tău pentru a nu
            pierde datele introduse înainte de salvarea în cont.
          </li>
          <li>
            Datele de încasare și contul bancar se configurează separat în Stripe sau
            în fluxurile dedicate de plată, nu în acest formular.
          </li>
        </ul>

        <p className={styles.infoNoteFooter}>
          Prin completarea acestui formular, datele sunt prelucrate pentru emiterea
          facturilor, administrarea relației contractuale și îndeplinirea obligațiilor
          legale fiscale și contabile. Detalii complete în{" "}
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">
            Politica de confidențialitate
          </a>
          .
        </p>
      </InfoNoteResponsive>

      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={`${styles.badge} ${styles.badgeMuted}`}>
            Statut TVA declarat
          </span>
          <small className={styles.help}>
            Statutul TVA este declarat de tine și este folosit pentru emiterea
            corectă a facturilor pentru abonament și comision.
          </small>
        </div>

        <div className={styles.toolbarRight}>
          {hasDraft && (
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => setShowDeleteDraftConfirm(true)}
              title="Șterge doar draftul local salvat în acest browser"
            >
              Șterge draftul
            </button>
          )}

          <button
            type="button"
            className={styles.dangerBtn}
            onClick={() => setShowResetConfirm(true)}
            disabled={!canReset}
            aria-disabled={!canReset}
            title={
              canReset
                ? "Golește toate câmpurile și șterge draftul local"
                : "Formularul este deja gol"
            }
          >
            Resetează formularul
          </button>
        </div>
      </div>

      <div className={styles.draftInfo}>
        <small className={styles.help}>
          Draftul se salvează local în acest browser și pe acest dispozitiv până îl
          ștergi sau resetezi formularul. {BILLING_RETENTION_NOTE}
          {loadedDraft && <> Draft local încărcat automat.</>}
        </small>
      </div>

      <div className={styles.grid}>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="legalType">
            Entitate juridică
          </label>
          <select
            id="legalType"
            className={`${styles.input} ${errors.legalType ? styles.inputError : ""}`}
            value={billing.legalType}
            onChange={onFieldChange("legalType")}
            onBlur={onFieldBlur("legalType")}
            aria-invalid={!!errors.legalType}
            aria-describedby={errors.legalType ? "err-legalType" : undefined}
          >
            <option value="">— alege —</option>
            <option value="SRL">SRL</option>
            <option value="PFA">PFA</option>
            <option value="II">Întreprindere Individuală (II)</option>
            <option value="IF">Întreprindere Familială (IF)</option>
          </select>
          {errors.legalType && (
            <small id="err-legalType" className={styles.fieldError}>
              {errors.legalType}
            </small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="companyName">
            Denumire entitate
          </label>
          <input
            id="companyName"
            className={`${styles.input} ${errors.companyName ? styles.inputError : ""}`}
            value={billing.companyName}
            onChange={onFieldChange("companyName")}
            onBlur={onFieldBlur("companyName")}
            placeholder="SC Exemplu SRL / PFA Ion Popescu"
            aria-invalid={!!errors.companyName}
            aria-describedby={errors.companyName ? "err-companyName" : undefined}
          />
          {errors.companyName && (
            <small id="err-companyName" className={styles.fieldError}>
              {errors.companyName}
            </small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="vendorName">
            Nume vendor
          </label>
          <input
            id="vendorName"
            className={`${styles.input} ${errors.vendorName ? styles.inputError : ""}`}
            value={billing.vendorName}
            onChange={onFieldChange("vendorName")}
            onBlur={onFieldBlur("vendorName")}
            placeholder="Ex: Atelierul Maria"
            aria-invalid={!!errors.vendorName}
            aria-describedby={errors.vendorName ? "err-vendorName" : undefined}
          />
          {errors.vendorName && (
            <small id="err-vendorName" className={styles.fieldError}>
              {errors.vendorName}
            </small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="cui">
            CUI / Cod fiscal
          </label>
          <input
            id="cui"
            className={`${styles.input} ${errors.cui ? styles.inputError : ""}`}
            value={billing.cui}
            onChange={onFieldChange("cui")}
            onBlur={() => {
              onFieldBlur("cui")();
              setBilling((prev) => ({
                ...prev,
                cui: (prev.cui || "").toUpperCase().trim(),
              }));
            }}
            placeholder="Ex: RO12345678 / VAT123456 / TAX-ID"
            aria-invalid={!!errors.cui}
            aria-describedby={errors.cui ? "err-cui" : undefined}
          />
          {errors.cui && (
            <small id="err-cui" className={styles.fieldError}>
              {errors.cui}
            </small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="regCom">
            Nr. registru / identificare
          </label>
          <input
            id="regCom"
            className={`${styles.input} ${errors.regCom ? styles.inputError : ""}`}
            value={billing.regCom}
            onChange={onFieldChange("regCom")}
            onBlur={() => {
              onFieldBlur("regCom")();
              setBilling((prev) => ({
                ...prev,
                regCom: (prev.regCom || "").toUpperCase().trim(),
              }));
            }}
            placeholder="Ex: J40/123/2020 / HRB 12345 / Company No."
            aria-invalid={!!errors.regCom}
            aria-describedby={errors.regCom ? "err-regCom" : undefined}
          />
          {errors.regCom && (
            <small id="err-regCom" className={styles.fieldError}>
              {errors.regCom}
            </small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="vatStatus">
            Statut TVA
          </label>
          <select
            id="vatStatus"
            className={`${styles.input} ${errors.vatStatus ? styles.inputError : ""}`}
            value={billing.vatStatus}
            onChange={onFieldChange("vatStatus")}
            onBlur={onFieldBlur("vatStatus")}
            aria-invalid={!!errors.vatStatus}
            aria-describedby={errors.vatStatus ? "err-vatStatus" : undefined}
          >
            <option value="">— alege —</option>
            <option value="payer">Plătitor de TVA</option>
            <option value="non_payer">Neplătitor de TVA</option>
          </select>

          <small className={styles.help}>
            Dacă ești plătitor de TVA, platforma aplică doar cota standard.
          </small>

          {errors.vatStatus && (
            <small id="err-vatStatus" className={styles.fieldError}>
              {errors.vatStatus}
            </small>
          )}
        </div>

        {billing.vatStatus === "payer" && (
          <div className={styles.fieldGroup}>
            <label className={styles.label} htmlFor="vatRate">
              Cotă TVA aplicată serviciilor din platformă
            </label>

            <input
              id="vatRate"
              className={styles.input}
              value={`${PLATFORM_VAT_RATE}% (cota standard)`}
              readOnly
              aria-readonly="true"
            />

            <small className={styles.help}>
              Pentru platformă folosim doar cota standard de {PLATFORM_VAT_RATE}%.
            </small>

            {errors.vatRate && (
              <small id="err-vatRate" className={styles.fieldError}>
                {errors.vatRate}
              </small>
            )}
          </div>
        )}

        <div className={`${styles.fieldGroup} ${styles.fieldGroupFull}`}>
          <label className={styles.label} htmlFor="address">
            Adresă facturare
          </label>
          <textarea
            id="address"
            className={`${styles.input} ${errors.address ? styles.inputError : ""}`}
            value={billing.address}
            onChange={onFieldChange("address")}
            onBlur={onFieldBlur("address")}
            placeholder="Str. Exemplu 10, București"
            aria-invalid={!!errors.address}
            aria-describedby={errors.address ? "err-address" : undefined}
            rows={3}
          />
          {errors.address && (
            <small id="err-address" className={styles.fieldError}>
              {errors.address}
            </small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="email">
            Email facturare
          </label>
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
          {errors.email && (
            <small id="err-email" className={styles.fieldError}>
              {errors.email}
            </small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="contactPerson">
            Persoană de contact
          </label>
          <input
            id="contactPerson"
            className={`${styles.input} ${errors.contactPerson ? styles.inputError : ""}`}
            value={billing.contactPerson}
            onChange={onFieldChange("contactPerson")}
            onBlur={onFieldBlur("contactPerson")}
            placeholder="Nume Prenume"
            aria-invalid={!!errors.contactPerson}
            aria-describedby={errors.contactPerson ? "err-contactPerson" : undefined}
          />
          {errors.contactPerson && (
            <small id="err-contactPerson" className={styles.fieldError}>
              {errors.contactPerson}
            </small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="phone">
            Telefon facturare
          </label>
          <input
            id="phone"
            className={`${styles.input} ${errors.phone ? styles.inputError : ""}`}
            type="tel"
            value={billing.phone}
            onChange={onFieldChange("phone")}
            onBlur={onFieldBlur("phone")}
            placeholder="+40722123456"
            aria-invalid={!!errors.phone}
            aria-describedby={errors.phone ? "err-phone" : undefined}
          />
          {errors.phone && (
            <small id="err-phone" className={styles.fieldError}>
              {errors.phone}
            </small>
          )}
        </div>

        <div
          className={`${styles.fieldGroup} ${styles.fieldGroupFull} ${styles.checkboxGroup}`}
        >
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkboxInput}
              checked={billing.vatResponsibilityConfirmed}
              onChange={(e) => {
                setHasInteracted(true);
                const checked = e.target.checked;

                setBilling((prev) => ({
                  ...prev,
                  vatResponsibilityConfirmed: checked,
                }));

                if (touched.vatResponsibilityConfirmed) {
                  setErrorsState(
                    validate({
                      ...billing,
                      vatResponsibilityConfirmed: checked,
                    })
                  );
                }
              }}
              onBlur={onFieldBlur("vatResponsibilityConfirmed")}
            />
            <span className={`${styles.help} ${styles.checkboxText}`}>
              Confirm că informațiile fiscale introduse sunt corecte și actualizate
              și înțeleg că răspund pentru exactitatea acestora.
            </span>
          </label>

          {errors.vatResponsibilityConfirmed && (
            <small
              className={styles.fieldError}
              id="err-vatResponsibilityConfirmed"
            >
              {errors.vatResponsibilityConfirmed}
            </small>
          )}
        </div>
      </div>

      {err && (
        <div className={styles.error} role="alert">
          {err}
        </div>
      )}

      <div className={`${styles.toolbar} ${styles.formActions}`}>
        <div className={styles.toolbarLeft} />
        <div className={styles.toolbarRight}>
          <button
            type="submit"
            className={styles.primaryBtn}
            disabled={status === "saving" || !isDirty}
            aria-disabled={status === "saving" || !isDirty}
            title={!isDirty ? "Nu există modificări nesalvate." : undefined}
          >
            {status === "saving" ? (
              <>
                <span className={styles.spinner} aria-hidden="true" /> Se salvează…
              </>
            ) : (
              "Salvează"
            )}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={showResetConfirm}
        title="Resetezi formularul?"
        message="Această acțiune golește toate câmpurile și șterge draftul local salvat în acest browser. Datele deja salvate în cont rămân neschimbate până la o nouă salvare."
        confirmText="Resetează"
        onConfirm={() => {
          setShowResetConfirm(false);
          resetFormHard();
        }}
        onCancel={() => setShowResetConfirm(false)}
      />

      <ConfirmDialog
        open={showDeleteDraftConfirm}
        title="Ștergi draftul local?"
        message="Se va elimina doar draftul salvat local în acest browser pentru acest formular. Câmpurile și datele din cont rămân neschimbate."
        confirmText="Șterge draftul"
        onConfirm={() => {
          setShowDeleteDraftConfirm(false);
          clearDraftOnly();
        }}
        onCancel={() => setShowDeleteDraftConfirm(false)}
      />
    </form>
  );
}

export default function BillingTab({
  onSaved,
  onStatusChange,
  canContinue,
  onContinue,
}) {
  return (
    <div
      role="tabpanel"
      className={styles.tabPanel}
      aria-labelledby="tab-facturare"
    >
      <BillingForm onSaved={onSaved} onStatusChange={onStatusChange} />

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
          <small className={styles.help}>
            Te rugăm să salvezi formularul de facturare înainte.
          </small>
        )}
      </div>
    </div>
  );
}