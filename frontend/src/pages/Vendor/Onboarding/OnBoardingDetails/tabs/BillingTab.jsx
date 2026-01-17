import { useEffect, useMemo, useState, useRef } from "react";
import { api } from "../../../../../lib/api.js";
import styles from "./css/BillingTab.module.css";

const DRAFT_PREFIX = "onboarding.billing.draft:";
const LEGAL_TYPES = ["SRL", "PFA", "II", "IF"];
const VERIFY_COOLDOWN_SEC = 30;

// ✅ pentru platformă: doar 21% (cota standard)
const PLATFORM_VAT_RATE = "21";

/* ---------- Componentă mică pentru nota informativă ---------- */
function InfoNote({ children }) {
  return (
    <div
      role="note"
      aria-label="Informații verificare și facturare"
      className={styles.infoNote}
    >
      <span aria-hidden="true" className={styles.infoNoteIcon}>
        ℹ️
      </span>
      <div>{children}</div>
    </div>
  );
}

/* ---------- Validări + normalizări ---------- */
function validate(values) {
  const v = {
    ...values,
    legalType: (values.legalType || "").toUpperCase().trim(),
    vendorName: (values.vendorName || "").trim(),
    companyName: (values.companyName || "").trim(),
    cui: (values.cui || "").toUpperCase().trim(),
    regCom: (values.regCom || "").toUpperCase().trim(),
    address: (values.address || "").trim(),
    iban: (values.iban || "").replace(/\s+/g, "").toUpperCase(),
    bank: (values.bank || "").trim(),
    email: (values.email || "").trim(),
    contactPerson: (values.contactPerson || "").trim(),
    phone: (values.phone || "").replace(/\s+/g, "").trim(),
    // TVA
    vatStatus: (values.vatStatus || "").trim(),
    vatRate: (values.vatRate || "").trim(),
  };

  // ✅ normalizare TVA: dacă e plătitor -> forțăm 21; altfel -> gol
  if (v.vatStatus === "payer") v.vatRate = PLATFORM_VAT_RATE;
  if (v.vatStatus !== "payer") v.vatRate = "";

  const errors = {};
  if (!v.legalType || !LEGAL_TYPES.includes(v.legalType))
    errors.legalType = "Alege tipul entității (PF nu este acceptat).";

  if (!v.vendorName) errors.vendorName = "Completează numele vendorului.";
  if (!v.companyName) errors.companyName = "Completează denumirea.";

  if (!v.cui) errors.cui = "Completează CUI-ul.";
  else if (!/^(RO)?\d{2,10}$/i.test(v.cui))
    errors.cui = "CUI invalid (ex: RO12345678).";

  if (!v.regCom) errors.regCom = "Completează Nr. Reg. Com.";
  else if (!/^(J|F)\d{1,2}\/\d{1,6}\/\d{2,4}$/i.test(v.regCom))
    errors.regCom = "Format invalid (ex: J40/123/2020).";

  if (!v.address) errors.address = "Completează adresa de facturare.";

  if (!v.iban) errors.iban = "Completează IBAN-ul.";
  else if (!/^RO\d{2}[A-Z]{4}[A-Z0-9]{16}$/i.test(v.iban))
    errors.iban = "IBAN RO invalid (ex: RO49AAAA1B31007593840000).";

  if (!v.bank) errors.bank = "Completează banca.";

  if (!v.email) errors.email = "Completează emailul.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))
    errors.email = "Email invalid.";

  if (!v.contactPerson)
    errors.contactPerson = "Completează persoana de contact.";
  if (!v.phone) errors.phone = "Completează telefonul de contact.";
  else if (!/^\+?\d{7,15}$/.test(v.phone))
    errors.phone = "Telefon invalid (ex: +40722123456).";

  // --- Validare TVA ---
  if (!v.vatStatus) {
    errors.vatStatus = "Te rugăm să alegi dacă ești plătitor de TVA.";
  }

  // ✅ dacă e plătitor, cota trebuie să fie 21 (și e setată automat)
  if (v.vatStatus === "payer" && v.vatRate !== PLATFORM_VAT_RATE) {
    errors.vatRate = `Cota TVA pentru platformă este ${PLATFORM_VAT_RATE}%.`;
  }

  if (!values.vatResponsibilityConfirmed) {
    errors.vatResponsibilityConfirmed =
      "Trebuie să confirmi că aceste informații fiscale sunt corecte.";
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
    "iban",
    "bank",
    "email",
    "contactPerson",
    "phone",
    "vatStatus",
    "vatRate",
  ];
  return keys.every((k) => !String(v?.[k] ?? "").trim());
}

/**
 * Helper ca să nu pierdem valorile TVA din formular
 * dacă backend-ul încă nu le trimite sau sunt null.
 */
function mergeBillingKeepVat(prev, incoming) {
  if (!incoming) return prev;
  return {
    ...prev,
    ...incoming,
    vatStatus:
      incoming.vatStatus !== undefined && incoming.vatStatus !== null
        ? incoming.vatStatus
        : prev.vatStatus,
    vatRate:
      incoming.vatRate !== undefined && incoming.vatRate !== null
        ? incoming.vatRate
        : prev.vatRate,
    vatResponsibilityConfirmed:
      typeof incoming.vatResponsibilityConfirmed === "boolean"
        ? incoming.vatResponsibilityConfirmed
        : prev.vatResponsibilityConfirmed,
  };
}

/**
 * Whitelist: luăm doar câmpurile de care avem nevoie din API,
 * ca să nu ne intre id/vendorId/createdAt etc în state.
 */
function pickBillingFromApi(b) {
  if (!b) return null;
  return {
    legalType: b.legalType ?? "",
    vendorName: b.vendorName ?? "",
    companyName: b.companyName ?? "",
    cui: b.cui ?? "",
    regCom: b.regCom ?? "",
    address: b.address ?? "",
    iban: b.iban ?? "",
    bank: b.bank ?? "",
    email: b.email ?? "",
    contactPerson: b.contactPerson ?? "",
    phone: b.phone ?? "",

    vatStatus: b.vatStatus ?? "",
    vatRate: b.vatRate ?? "",
    vatResponsibilityConfirmed: !!b.vatResponsibilityConfirmed,

    tvaActive: b.tvaActive,
    tvaVerifiedAt: b.tvaVerifiedAt,
    tvaSource: b.tvaSource,
    tvaCode: b.tvaCode,
    anafName: b.anafName,
    anafAddress: b.anafAddress,
  };
}

/* ---------- Dialog simplu de confirmare ---------- */
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
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={onCancel}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Formularul propriu-zis ---------- */
function BillingForm({ onSaved, onStatusChange }) {
  const draftKey = useMemo(() => `${DRAFT_PREFIX}global`, []);

  const [billing, setBilling] = useState({
    legalType: "",
    vendorName: "",
    companyName: "",
    cui: "",
    regCom: "",
    address: "",
    iban: "",
    bank: "",
    email: "",
    contactPerson: "",
    phone: "",

    vatStatus: "",
    vatRate: "",
    vatResponsibilityConfirmed: false,

    // read-only (populate din backend)
    tvaActive: undefined,
    tvaVerifiedAt: undefined,
    tvaSource: undefined,
    tvaCode: undefined,
    anafName: undefined,
    anafAddress: undefined,
  });

  const [initialBilling, setInitialBilling] = useState(null);

  const [status, setStatus] = useState("idle"); // idle|saving|saved|error
  const [checking, setChecking] = useState(false);
  const [verifyCooldown, setVerifyCooldown] = useState(0);
  const verifyTimerRef = useRef(null);

  const [err, setErr] = useState("");
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  const [touched, setTouched] = useState({});
  const [{ errors }, setErrorsState] = useState({ errors: {} });

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDeleteDraftConfirm, setShowDeleteDraftConfirm] = useState(false);

  const [announce, setAnnounce] = useState("");

  // ✅ nou: controlăm “hidratarea” (backend + draft) + interacțiunea userului
  const [hydrated, setHydrated] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // Prefill corect:
  // 1) backend
  // 2) draft doar dacă există și NU e gol
  // 3) abia la final setHydrated(true) -> autosave devine permis
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const d = await api("/api/vendors/me/billing", { method: "GET" });
        if (!alive) return;

        const fromApi = pickBillingFromApi(d?.billing);

        if (fromApi) {
          setBilling((prev) => mergeBillingKeepVat(prev, fromApi));
          setInitialBilling(fromApi);
          setAnnounce("Am încărcat datele de facturare salvate în contul tău.");
        } else {
          setInitialBilling(null);
        }

        // draft local (doar dacă nu e gol)
        try {
          if (typeof window !== "undefined") {
            const raw = window.localStorage.getItem(draftKey);
            setHasDraft(!!raw);

            if (raw) {
              const draft = JSON.parse(raw);
              if (!isFormEmpty(draft)) {
                setBilling((prev) => ({ ...prev, ...draft }));
                setLoadedDraft(true);
                setAnnounce(
                  "S-a încărcat un draft salvat local în acest browser pentru acest formular."
                );
              }
            }
          }
        } catch {
          // ignore
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
  }, [draftKey]);

  // ✅ TVA platformă: când e plătitor -> setăm automat 21; altfel -> golim
  useEffect(() => {
    if (billing.vatStatus === "payer") {
      if (billing.vatRate !== PLATFORM_VAT_RATE) {
        setBilling((prev) => ({ ...prev, vatRate: PLATFORM_VAT_RATE }));
      }
    } else {
      if (billing.vatRate) {
        setBilling((prev) => ({ ...prev, vatRate: "" }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billing.vatStatus]);

  // ✅ autosave draft în localStorage doar după hydration + doar dacă userul a interacționat
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!hydrated) return;
    if (!hasInteracted) return;

    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(billing));
        setHasDraft(true);
      } catch {
        // ignore
      }
    }, 300);

    return () => clearTimeout(t);
  }, [billing, draftKey, hydrated, hasInteracted]);

  // cooldown timer pentru verificare
  useEffect(() => {
    if (verifyCooldown <= 0 && verifyTimerRef.current) {
      clearInterval(verifyTimerRef.current);
      verifyTimerRef.current = null;
    }
  }, [verifyCooldown]);

  function onFieldChange(name) {
    return (e) => {
      setHasInteracted(true);
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

  const isDirty = useMemo(() => {
    const keys = [
      "legalType",
      "vendorName",
      "companyName",
      "cui",
      "regCom",
      "address",
      "iban",
      "bank",
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
      iban: true,
      bank: true,
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

      // re-fetch (source of truth)
      const fresh = await api("/api/vendors/me/billing", { method: "GET" });

      const fromApi = pickBillingFromApi(fresh?.billing);
      if (fromApi) {
        setBilling((prev) => mergeBillingKeepVat(prev, fromApi));
        setInitialBilling(fromApi);
      } else {
        // fallback: menținem ce aveam
        setInitialBilling(pickBillingFromApi(billing));
      }

      setStatus("saved");
      setAnnounce("Datele de facturare au fost salvate în contul tău.");

      // ✅ curățăm draftul local după save
      try {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(draftKey);
          setHasDraft(false);
          setLoadedDraft(false);
        }
      } catch {
        // ignore
      }

      // ✅ userul nu mai e “în editare” după save
      setHasInteracted(false);

      setTimeout(() => setStatus("idle"), 1200);
      onSaved?.();
    } catch (e) {
      setStatus("error");
      setErr(e?.message || "Eroare la salvare.");
      setAnnounce("Eroare la salvare.");
    }
  }

  function startVerifyCooldown() {
    setVerifyCooldown(VERIFY_COOLDOWN_SEC);
    if (verifyTimerRef.current) clearInterval(verifyTimerRef.current);
    verifyTimerRef.current = setInterval(() => {
      setVerifyCooldown((s) => Math.max(0, s - 1));
    }, 1000);
  }

  async function verifyNow() {
    try {
      const cuiOk = /^(RO)?\d{2,10}$/i.test(
        String(billing.cui || "").trim().toUpperCase()
      );
      if (!cuiOk) {
        setErr(
          "Completează și salvează mai întâi un CUI valid (ex: RO12345678)."
        );
        setAnnounce("CUI invalid pentru verificare.");
        return;
      }
      if (verifyCooldown > 0) return;

      setChecking(true);
      setAnnounce("Se verifică CUI la ANAF…");
      await api("/api/vendors/me/billing/verify", { method: "POST" });

      const d = await api("/api/vendors/me/billing", { method: "GET" });
      const fromApi = pickBillingFromApi(d?.billing);
      if (fromApi) {
        setBilling((prev) => mergeBillingKeepVat(prev, fromApi));
      }
      setAnnounce("Verificarea ANAF s-a încheiat.");
    } catch (e) {
      setErr(e?.message || "Verificarea ANAF a eșuat.");
      setAnnounce("Verificarea ANAF a eșuat.");
    } finally {
      setChecking(false);
      startVerifyCooldown();
    }
  }

  function clearDraftOnly() {
    try {
      if (typeof window !== "undefined")
        window.localStorage.removeItem(draftKey);
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
      iban: "",
      bank: "",
      email: "",
      contactPerson: "",
      phone: "",
      vatStatus: "",
      vatRate: "",
      vatResponsibilityConfirmed: false,
      tvaActive: undefined,
      tvaVerifiedAt: undefined,
      tvaSource: undefined,
      tvaCode: undefined,
      anafName: undefined,
      anafAddress: undefined,
    });
    setTouched({});
    setErrorsState({ errors: {} });
    setErr("");
    setInitialBilling(null);
    setHasInteracted(false);
    setAnnounce("Formularul a fost resetat.");
  }

  const hasTvaInfo = typeof billing.tvaActive !== "undefined";
  const canVerify =
    !checking &&
    verifyCooldown === 0 &&
    /^(RO)?\d{2,10}$/i.test(String(billing.cui || "").trim().toUpperCase());
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
              <span className={styles.spinner} aria-hidden="true" /> Se
              salvează…
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

      <InfoNote>
        <p style={{ margin: 0 }}>
          <strong>De ce cerem aceste date?</strong> Pentru a preveni conturile
          false și a emite documente fiscale corecte, anumite informații sunt{" "}
          <em>verificate automat</em> (ex. CUI) prin surse oficiale (ANAF).
        </p>
        <ul style={{ margin: "6px 0 0 18px" }}>
          <li>
            CUI-ul poate fi verificat periodic; această verificare nu afectează
            statutul dvs. fiscal.
          </li>
          <li>
            Dacă nu sunteți plătitor de TVA, este în regulă — vom emite facturile
            în consecință.
          </li>
          <li>
            Persoana de contact și telefonul sunt necesare pentru comunicări
            legate de facturare.
          </li>
          <li>
            Datele sunt folosite exclusiv pentru facturare și verificări
            anti-fraudă, în conformitate cu GDPR.
          </li>
        </ul>
        <p style={{ margin: "6px 0 0 0", color: "#6B7280" }}>
          Dacă serviciile ANAF sunt temporar indisponibile, veți putea continua,
          iar verificarea va fi refăcută ulterior.
        </p>
      </InfoNote>

      {/* Status TVA + verificare on-demand */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {hasTvaInfo && (
            <>
              {billing.tvaActive === true && (
                <span className={`${styles.badge} ${styles.badgeOk}`}>
                  Verificat ANAF ✓
                </span>
              )}
              {billing.tvaActive === false && (
                <span className={`${styles.badge} ${styles.badgeWarn}`}>
                  Neînregistrat TVA
                </span>
              )}
              {billing.tvaActive == null && (
                <span className={`${styles.badge} ${styles.badgeMuted}`}>
                  ANAF indisponibil
                </span>
              )}
              {billing.tvaVerifiedAt && (
                <small className={styles.help}>
                  actualizat:{" "}
                  {new Date(billing.tvaVerifiedAt).toLocaleDateString()}
                </small>
              )}
              {billing.anafName && (
                <small className={styles.help}>
                  Denumire (ANAF): {billing.anafName}
                </small>
              )}
              {billing.anafAddress && (
                <small className={styles.help}>
                  Adresă (ANAF): {billing.anafAddress}
                </small>
              )}
            </>
          )}
        </div>

        <div className={styles.toolbarRight}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={verifyNow}
            disabled={!canVerify}
            aria-disabled={!canVerify}
            title={
              checking
                ? "Se verifică…"
                : verifyCooldown > 0
                ? `Poți reîncerca în ${verifyCooldown}s`
                : !/^(RO)?\d{2,10}$/i.test(String(billing.cui || ""))
                ? "Completează un CUI valid mai întâi"
                : "Interoghează imediat ANAF"
            }
          >
            {checking ? (
              <>
                <span className={styles.spinner} aria-hidden="true" /> Se
                verifică…
              </>
            ) : verifyCooldown > 0 ? (
              `Reîncearcă în ${verifyCooldown}s`
            ) : (
              "Verifică CUI acum"
            )}
          </button>

          {hasDraft && (
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => setShowDeleteDraftConfirm(true)}
              title="Șterge doar draftul local (salvat în acest browser)"
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

      <div style={{ marginBottom: 8 }}>
        <small className={styles.help}>
          Draftul se salvează local în acest browser și pe acest dispozitiv,
          până îl ștergi sau resetezi formularul. Datele salvate în cont sunt
          păstrate permanent în baza de date și se încarcă automat la
          următoarea accesare a tab-ului.
          {loadedDraft && <> Draft local încărcat automat.</>}
        </small>
      </div>

      {/* Grid câmpuri */}
      <div className={styles.grid}>
        {/* legalType */}
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

        {/* vendorName */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="vendorName">
            Nume vendor
          </label>
          <input
            id="vendorName"
            className={`${styles.input} ${
              errors.vendorName ? styles.inputError : ""
            }`}
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

        {/* companyName */}
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
            aria-invalid={!!errors.companyName}
            aria-describedby={errors.companyName ? "err-companyName" : undefined}
          />
          {errors.companyName && (
            <small id="err-companyName" className={styles.fieldError}>
              {errors.companyName}
            </small>
          )}
        </div>

        {/* cui */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="cui">
            CUI
          </label>
          <input
            id="cui"
            className={`${styles.input} ${errors.cui ? styles.inputError : ""}`}
            value={billing.cui}
            inputMode="numeric"
            onChange={onFieldChange("cui")}
            onBlur={() => {
              onFieldBlur("cui")();
              setBilling((prev) => {
                let val = (prev.cui || "").toUpperCase().trim();
                if (/^\d{2,10}$/.test(val)) val = `RO${val}`;
                return { ...prev, cui: val };
              });
            }}
            placeholder="RO12345678"
            aria-invalid={!!errors.cui}
            aria-describedby={errors.cui ? "err-cui" : undefined}
          />
          {errors.cui && (
            <small id="err-cui" className={styles.fieldError}>
              {errors.cui}
            </small>
          )}
        </div>

        {/* regCom */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="regCom">
            Nr. Reg. Com.
          </label>
          <input
            id="regCom"
            className={`${styles.input} ${
              errors.regCom ? styles.inputError : ""
            }`}
            value={billing.regCom}
            onChange={onFieldChange("regCom")}
            onBlur={onFieldBlur("regCom")}
            placeholder="J40/123/2020"
            aria-invalid={!!errors.regCom}
            aria-describedby={errors.regCom ? "err-regCom" : undefined}
          />
          {errors.regCom && (
            <small id="err-regCom" className={styles.fieldError}>
              {errors.regCom}
            </small>
          )}
        </div>

        {/* Statut TVA */}
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
            aria-invalid={!!errors.vatStatus}
            aria-describedby={errors.vatStatus ? "err-vatStatus" : undefined}
          >
            <option value="">— alege —</option>
            <option value="payer">Plătitor de TVA</option>
            <option value="non_payer">Neplătitor de TVA</option>
          </select>
          <small className={styles.help}>
            Conform informațiilor ANAF:{" "}
            {billing.tvaActive === true
              ? "ești înregistrat în scopuri de TVA."
              : billing.tvaActive === false
              ? "nu ești înregistrat ca plătitor de TVA."
              : "nu am putut determina automat statutul TVA."}{" "}
            Te rugăm să confirmi statutul real.
          </small>
          {errors.vatStatus && (
            <small id="err-vatStatus" className={styles.fieldError}>
              {errors.vatStatus}
            </small>
          )}
        </div>

        {/* Cotă TVA (doar afișare; valoarea reală e setată automat la 21) */}
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

        {/* address */}
        <div className={styles.fieldGroup} style={{ gridColumn: "1 / -1" }}>
          <label className={styles.label} htmlFor="address">
            Adresă facturare
          </label>
          <input
            id="address"
            className={`${styles.input} ${
              errors.address ? styles.inputError : ""
            }`}
            value={billing.address}
            onChange={onFieldChange("address")}
            onBlur={onFieldBlur("address")}
            placeholder="Str. Exemplu 10, București"
            aria-invalid={!!errors.address}
            aria-describedby={errors.address ? "err-address" : undefined}
          />
          {errors.address && (
            <small id="err-address" className={styles.fieldError}>
              {errors.address}
            </small>
          )}
        </div>

        {/* iban */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="iban">
            IBAN
          </label>
          <input
            id="iban"
            className={`${styles.input} ${
              errors.iban ? styles.inputError : ""
            }`}
            value={billing.iban}
            onChange={onFieldChange("iban")}
            onBlur={onFieldBlur("iban")}
            placeholder="RO49AAAA1B31007593840000"
            aria-invalid={!!errors.iban}
            aria-describedby={errors.iban ? "err-iban" : undefined}
          />
          {errors.iban && (
            <small id="err-iban" className={styles.fieldError}>
              {errors.iban}
            </small>
          )}
        </div>

        {/* bank */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="bank">
            Banca
          </label>
          <input
            id="bank"
            className={`${styles.input} ${
              errors.bank ? styles.inputError : ""
            }`}
            value={billing.bank}
            onChange={onFieldChange("bank")}
            onBlur={onFieldBlur("bank")}
            placeholder="BCR / ING / BT"
            aria-invalid={!!errors.bank}
            aria-describedby={errors.bank ? "err-bank" : undefined}
          />
          {errors.bank && (
            <small id="err-bank" className={styles.fieldError}>
              {errors.bank}
            </small>
          )}
        </div>

        {/* email */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="email">
            Email facturare
          </label>
          <input
            id="email"
            className={`${styles.input} ${
              errors.email ? styles.inputError : ""
            }`}
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

        {/* contactPerson */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="contactPerson">
            Persoană de contact
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
            aria-invalid={!!errors.contactPerson}
            aria-describedby={
              errors.contactPerson ? "err-contactPerson" : undefined
            }
          />
          {errors.contactPerson && (
            <small id="err-contactPerson" className={styles.fieldError}>
              {errors.contactPerson}
            </small>
          )}
        </div>

        {/* phone */}
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="phone">
            Telefon facturare
          </label>
          <input
            id="phone"
            className={`${styles.input} ${
              errors.phone ? styles.inputError : ""
            }`}
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

        {/* Confirmare responsabilitate TVA */}
        <div
          className={styles.fieldGroup}
          style={{ gridColumn: "1 / -1", marginTop: 4 }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={billing.vatResponsibilityConfirmed}
              onChange={(e) => {
                setHasInteracted(true);
                const checked = e.target.checked;
                setBilling((prev) => ({ ...prev, vatResponsibilityConfirmed: checked }));
                if (touched.vatResponsibilityConfirmed) {
                  setErrorsState(validate({ ...billing, vatResponsibilityConfirmed: checked }));
                }
              }}
              onBlur={onFieldBlur("vatResponsibilityConfirmed")}
              style={{ marginTop: 4 }}
            />
            <span className={styles.help}>
              Confirm că informațiile despre statutul TVA și cota de TVA sunt
              reale și actualizate, și înțeleg că răspund legal pentru
              corectitudinea lor.
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

      <div className={styles.toolbar} style={{ marginTop: 12 }}>
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
                <span className={styles.spinner} aria-hidden="true" /> Se
                salvează…
              </>
            ) : (
              "Salvează"
            )}
          </button>
        </div>
      </div>

      {/* Confirmări */}
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

/* ---------- Wrapper tab ---------- */
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
