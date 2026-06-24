import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../../lib/api.js";
import styles from "./css/BillingTab.module.css";

const DRAFT_PREFIX = "onboarding.billing.draft:";
const LEGAL_TYPES = ["SRL", "PFA", "II", "IF"];
const SELLER_TYPES = ["independent_creator", "verified_business"];
const PLATFORM_VAT_RATE = "21";
const PRIVACY_POLICY_URL = "/confidentialitate";

const BILLING_PURPOSE_SUMMARY =
  "Cerem aceste date pentru emiterea facturilor aferente abonamentului și comisioanelor, administrarea relației contractuale cu vendorii și îndeplinirea obligațiilor legale fiscale și contabile.";

const BILLING_RETENTION_NOTE =
  "Datele salvate în cont pot fi păstrate conform obligațiilor legale fiscale, contabile și politicilor interne de retenție aplicabile.";

const EMPTY_BILLING = {
  sellerType: "",
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
  taxResponsibilityConfirmed: false,
  independentTermsConfirmed: false,
};

const DIRTY_KEYS = [
  "sellerType",
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
  "taxResponsibilityConfirmed",
  "independentTermsConfirmed",
];

function hasBusinessBillingData(b) {
  if (!b) return false;
  return !!(b.legalType || b.companyName || b.cui || b.regCom || b.vatStatus);
}

function pickBillingFromApi(b) {
  if (!b) return null;

  const sellerType =
    b.sellerType ||
    b.vendorType ||
    b.accountType ||
    (hasBusinessBillingData(b) ? "verified_business" : "");

  return {
    ...EMPTY_BILLING,
    sellerType,
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
    taxResponsibilityConfirmed: !!b.taxResponsibilityConfirmed,
    independentTermsConfirmed: !!b.independentTermsConfirmed,
  };
}

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
    sellerType: (values.sellerType || "").trim(),
    legalType: (values.legalType || "").toUpperCase().trim(),
    vendorName: (values.vendorName || "").trim(),
    companyName: (values.companyName || "").trim(),
    cui: values.cui || "",
    regCom: (values.regCom || "").toUpperCase().trim(),
    address: (values.address || "").trim(),
    email: (values.email || "").trim(),
    contactPerson: (values.contactPerson || "").trim(),
    phone: (values.phone || "").replace(/\s+/g, "").trim(),
    vatStatus: (values.vatStatus || "").trim(),
    vatRate: (values.vatRate || "").trim(),
    vatResponsibilityConfirmed: !!values.vatResponsibilityConfirmed,
    taxResponsibilityConfirmed: !!values.taxResponsibilityConfirmed,
    independentTermsConfirmed: !!values.independentTermsConfirmed,
  };

  if (v.vatStatus === "payer") v.vatRate = PLATFORM_VAT_RATE;
  if (v.vatStatus !== "payer") v.vatRate = "";

  const errors = {};

  if (!v.sellerType || !SELLER_TYPES.includes(v.sellerType)) {
    errors.sellerType = "Alege cum vinzi pe platformă.";
  }

  if (!v.vendorName) errors.vendorName = "Completează numele vendorului.";
  if (!v.address) errors.address = "Completează adresa.";
  if (!v.email) errors.email = "Completează emailul de facturare.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) {
    errors.email = "Email invalid.";
  }

  if (!v.contactPerson) errors.contactPerson = "Completează persoana de contact.";
  if (!v.phone) errors.phone = "Completează telefonul de contact.";
  else if (!/^\+?\d{7,15}$/.test(v.phone)) {
    errors.phone = "Telefon invalid (ex: +40722123456).";
  }

  if (v.sellerType === "independent_creator") {
    if (!v.taxResponsibilityConfirmed) {
      errors.taxResponsibilityConfirmed =
        "Trebuie să confirmi responsabilitatea fiscală.";
    }

    if (!v.independentTermsConfirmed) {
      errors.independentTermsConfirmed =
        "Trebuie să confirmi condițiile pentru Creator Independent.";
    }

    v.legalType = "";
    v.companyName = "";
    v.cui = "";
    v.regCom = "";
    v.vatStatus = "";
    v.vatRate = "";
    v.vatResponsibilityConfirmed = false;
  }

  if (v.sellerType === "verified_business") {
    if (!v.legalType || !LEGAL_TYPES.includes(v.legalType)) {
      errors.legalType = "Alege tipul entității.";
    }

    if (!v.companyName) errors.companyName = "Completează denumirea entității.";
    if (!v.cui) errors.cui = "Completează codul fiscal / Tax ID.";
    if (!v.regCom) {
      errors.regCom = "Completează numărul de registru / identificare.";
    }

    if (!v.vatStatus) {
      errors.vatStatus = "Te rugăm să alegi dacă ești plătitor de TVA.";
    }

    if (v.vatStatus === "payer" && v.vatRate !== PLATFORM_VAT_RATE) {
      errors.vatRate = `Cota TVA pentru platformă este ${PLATFORM_VAT_RATE}%.`;
    }

    if (!v.vatResponsibilityConfirmed) {
      errors.vatResponsibilityConfirmed =
        "Trebuie să confirmi că informațiile fiscale sunt corecte.";
    }

    v.taxResponsibilityConfirmed = false;
    v.independentTermsConfirmed = false;
  }

  return { errors, normalized: v };
}

function isFormEmpty(v) {
  return DIRTY_KEYS.every((k) => !String(v?.[k] ?? "").trim());
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

function SellerTypeSelector({ billing, errors, onSelect }) {
  return (
    <div className={`${styles.fieldGroup} ${styles.fieldGroupFull}`}>
      <label className={styles.label}>Cum vinzi pe platformă?</label>

      <div className={styles.sellerTypeCards}>
        <label
          className={`${styles.sellerTypeCard} ${
            billing.sellerType === "independent_creator"
              ? styles.sellerTypeCardActive
              : ""
          }`}
        >
          <input
            type="radio"
            name="sellerType"
            value="independent_creator"
            checked={billing.sellerType === "independent_creator"}
            onChange={() => onSelect("independent_creator")}
          />
          <span>
            <strong>🌱 Creator Independent</strong>
            <small>Nu am încă PFA/SRL și vreau să testez vânzarea pe platformă.</small>
          </span>
        </label>

        <label
          className={`${styles.sellerTypeCard} ${
            billing.sellerType === "verified_business"
              ? styles.sellerTypeCardActive
              : ""
          }`}
        >
          <input
            type="radio"
            name="sellerType"
            value="verified_business"
            checked={billing.sellerType === "verified_business"}
            onChange={() => onSelect("verified_business")}
          />
          <span>
            <strong>✓ Business Verificat</strong>
            <small>Am PFA, SRL, II sau IF și pot completa datele firmei.</small>
          </span>
        </label>
      </div>

      {errors.sellerType && (
        <small className={styles.fieldError}>{errors.sellerType}</small>
      )}
    </div>
  );
}

function BillingForm({ onSaved, onStatusChange }) {
  const [vendorId, setVendorId] = useState("");
  const draftKey = useMemo(
    () => (vendorId ? `${DRAFT_PREFIX}${vendorId}` : ""),
    [vendorId]
  );

  const [billing, setBilling] = useState(EMPTY_BILLING);
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

      if (d?.vendorId) setVendorId(d.vendorId);

      const fromApi = pickBillingFromApi(d?.billing);

      if (fromApi) {
        setBilling(fromApi);
        setInitialBilling(fromApi);
        setAnnounce("Am încărcat datele de facturare salvate în contul tău.");
        return;
      }

      const me = await api("/api/vendors/me", { method: "GET" });
      const sellerType = me?.billing?.sellerType;

      if (SELLER_TYPES.includes(sellerType)) {
        setBilling((prev) => ({
          ...prev,
          sellerType,
        }));

        setInitialBilling({
          ...EMPTY_BILLING,
          sellerType,
        });
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
  if (!hydrated) return;
  if (!vendorId || !draftKey) return;

  try {
    const raw = window.localStorage.getItem(draftKey);
    setHasDraft(!!raw);

    if (!raw) return;

    const draft = JSON.parse(raw);
    if (isFormEmpty(draft)) return;

    // Datele salvate în backend au prioritate pentru vendorii existenți.
    if (initialBilling) return;

    setBilling((prev) => ({ ...prev, ...draft }));
    setLoadedDraft(true);
    setAnnounce(
      "S-a încărcat un draft salvat local în acest browser pentru acest cont."
    );
  } catch {
    // ignore
  }
}, [vendorId, draftKey, hydrated, initialBilling]);

  function onSellerTypeSelect(type) {
    setHasInteracted(true);
    setTouched((t) => ({ ...t, sellerType: true }));

    setBilling((prev) => {
      const next =
        type === "independent_creator"
          ? {
              ...prev,
              sellerType: type,
              legalType: "",
              companyName: "",
              cui: "",
              regCom: "",
              vatStatus: "",
              vatRate: "",
              vatResponsibilityConfirmed: false,
            }
          : {
              ...prev,
              sellerType: type,
              taxResponsibilityConfirmed: false,
              independentTermsConfirmed: false,
            };

      setErrorsState(validate(next));
      return next;
    });
  }

  function onFieldChange(name) {
    return (e) => {
      setHasInteracted(true);
      const value = e.target.value;

      setBilling((prev) => {
        const next = { ...prev, [name]: value };
        if (touched[name]) setErrorsState(validate(next));
        return next;
      });
    };
  }

  function onCheckboxChange(name) {
    return (e) => {
      setHasInteracted(true);
      const checked = e.target.checked;

      setBilling((prev) => {
        const next = { ...prev, [name]: checked };
        if (touched[name]) setErrorsState(validate(next));
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
    if (!initialBilling) return !isFormEmpty(billing);

    return DIRTY_KEYS.some(
      (k) => String(billing[k] ?? "") !== String(initialBilling[k] ?? "")
    );
  }, [billing, initialBilling]);

  async function save() {
    const result = validate(billing);

    setErrorsState(result);
    setTouched({
      sellerType: true,
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
      taxResponsibilityConfirmed: true,
      independentTermsConfirmed: true,
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
      if (typeof window !== "undefined") window.localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }

    setLoadedDraft(false);
    setHasDraft(false);
    setAnnounce("Draftul local a fost șters.");
  }

  function resetFormHard() {
    clearDraftOnly();
    setBilling(EMPTY_BILLING);
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
          <li>Pentru Creator Independent cerem date minime de identificare și contact.</li>
          <li>Pentru Business Verificat cerem datele firmei/PFA-ului pentru facturare.</li>
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
            {billing.sellerType === "independent_creator"
              ? "Creator Independent"
              : billing.sellerType === "verified_business"
              ? "Business Verificat"
              : "Alege tipul de vendor"}
          </span>
          <small className={styles.help}>
            Datele salvate în backend sunt încărcate automat. Conturile existente cu
            date de firmă apar ca Business Verificat.
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
        <SellerTypeSelector
          billing={billing}
          errors={errors}
          onSelect={onSellerTypeSelect}
        />

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
          />
          {errors.vendorName && (
            <small className={styles.fieldError}>{errors.vendorName}</small>
          )}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="contactPerson">
            Persoană de contact / nume complet
          </label>
          <input
            id="contactPerson"
            className={`${styles.input} ${
              errors.contactPerson ? styles.inputError : ""
            }`}
            value={billing.contactPerson}
            onChange={onFieldChange("contactPerson")}
            onBlur={onFieldBlur("contactPerson")}
            placeholder="Nume Prenume"
          />
          {errors.contactPerson && (
            <small className={styles.fieldError}>{errors.contactPerson}</small>
          )}
        </div>

        {billing.sellerType === "verified_business" && (
          <>
            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="legalType">
                Entitate juridică
              </label>
              <select
                id="legalType"
                className={`${styles.input} ${
                  errors.legalType ? styles.inputError : ""
                }`}
                value={billing.legalType}
                onChange={onFieldChange("legalType")}
                onBlur={onFieldBlur("legalType")}
              >
                <option value="">— alege —</option>
                <option value="SRL">SRL</option>
                <option value="PFA">PFA</option>
                <option value="II">Întreprindere Individuală (II)</option>
                <option value="IF">Întreprindere Familială (IF)</option>
              </select>
              {errors.legalType && (
                <small className={styles.fieldError}>{errors.legalType}</small>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="companyName">
                Denumire entitate
              </label>
              <input
                id="companyName"
                className={`${styles.input} ${
                  errors.companyName ? styles.inputError : ""
                }`}
                value={billing.companyName}
                onChange={onFieldChange("companyName")}
                onBlur={onFieldBlur("companyName")}
                placeholder="SC Exemplu SRL / PFA Ion Popescu"
              />
              {errors.companyName && (
                <small className={styles.fieldError}>{errors.companyName}</small>
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
                onBlur={onFieldBlur("cui")}
                placeholder="Ex: 12345678 sau RO12345678"
              />
              {errors.cui && (
                <small className={styles.fieldError}>{errors.cui}</small>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="regCom">
                Nr. registru / identificare
              </label>
              <input
                id="regCom"
                className={`${styles.input} ${
                  errors.regCom ? styles.inputError : ""
                }`}
                value={billing.regCom}
                onChange={onFieldChange("regCom")}
                onBlur={() => {
                  onFieldBlur("regCom")();
                  setBilling((prev) => ({
                    ...prev,
                    regCom: (prev.regCom || "").toUpperCase().trim(),
                  }));
                }}
                placeholder="Ex: J40/123/2020"
              />
              {errors.regCom && (
                <small className={styles.fieldError}>{errors.regCom}</small>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label} htmlFor="vatStatus">
                Statut TVA
              </label>
              <select
                id="vatStatus"
                className={`${styles.input} ${
                  errors.vatStatus ? styles.inputError : ""
                }`}
                value={billing.vatStatus}
                onChange={onFieldChange("vatStatus")}
                onBlur={onFieldBlur("vatStatus")}
              >
                <option value="">— alege —</option>
                <option value="payer">Plătitor de TVA</option>
                <option value="non_payer">Neplătitor de TVA</option>
              </select>

              <small className={styles.help}>
                Dacă ești plătitor de TVA, platforma aplică doar cota standard.
              </small>

              {errors.vatStatus && (
                <small className={styles.fieldError}>{errors.vatStatus}</small>
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
                />
                {errors.vatRate && (
                  <small className={styles.fieldError}>{errors.vatRate}</small>
                )}
              </div>
            )}
          </>
        )}

        <div className={`${styles.fieldGroup} ${styles.fieldGroupFull}`}>
          <label className={styles.label} htmlFor="address">
            {billing.sellerType === "independent_creator"
              ? "Adresă"
              : "Adresă facturare"}
          </label>
          <textarea
            id="address"
            className={`${styles.input} ${errors.address ? styles.inputError : ""}`}
            value={billing.address}
            onChange={onFieldChange("address")}
            onBlur={onFieldBlur("address")}
            placeholder="Str. Exemplu 10, București"
            rows={3}
          />
          {errors.address && (
            <small className={styles.fieldError}>{errors.address}</small>
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
          />
          {errors.email && (
            <small className={styles.fieldError}>{errors.email}</small>
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
          />
          {errors.phone && (
            <small className={styles.fieldError}>{errors.phone}</small>
          )}
        </div>

        {billing.sellerType === "independent_creator" && (
          <>
            <div
              className={`${styles.fieldGroup} ${styles.fieldGroupFull} ${styles.checkboxGroup}`}
            >
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  className={styles.checkboxInput}
                  checked={billing.taxResponsibilityConfirmed}
                  onChange={onCheckboxChange("taxResponsibilityConfirmed")}
                  onBlur={onFieldBlur("taxResponsibilityConfirmed")}
                />
                <span className={`${styles.help} ${styles.checkboxText}`}>
                  Confirm că folosesc platforma ca persoană fizică / creator
                  independent și înțeleg că sunt responsabil pentru declararea
                  veniturilor și respectarea obligațiilor fiscale aplicabile.
                </span>
              </label>
              {errors.taxResponsibilityConfirmed && (
                <small className={styles.fieldError}>
                  {errors.taxResponsibilityConfirmed}
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
                  checked={billing.independentTermsConfirmed}
                  onChange={onCheckboxChange("independentTermsConfirmed")}
                  onBlur={onFieldBlur("independentTermsConfirmed")}
                />
                <span className={`${styles.help} ${styles.checkboxText}`}>
                  Înțeleg că platforma îmi poate solicita trecerea la PFA/SRL dacă
                  activitatea devine constantă sau depășesc limitele pentru Creator
                  Independent.
                </span>
              </label>
              {errors.independentTermsConfirmed && (
                <small className={styles.fieldError}>
                  {errors.independentTermsConfirmed}
                </small>
              )}
            </div>
          </>
        )}

        {billing.sellerType === "verified_business" && (
          <div
            className={`${styles.fieldGroup} ${styles.fieldGroupFull} ${styles.checkboxGroup}`}
          >
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                className={styles.checkboxInput}
                checked={billing.vatResponsibilityConfirmed}
                onChange={onCheckboxChange("vatResponsibilityConfirmed")}
                onBlur={onFieldBlur("vatResponsibilityConfirmed")}
              />
              <span className={`${styles.help} ${styles.checkboxText}`}>
                Confirm că informațiile fiscale introduse sunt corecte și actualizate
                și înțeleg că răspund pentru exactitatea acestora.
              </span>
            </label>
            {errors.vatResponsibilityConfirmed && (
              <small className={styles.fieldError}>
                {errors.vatResponsibilityConfirmed}
              </small>
            )}
          </div>
        )}
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