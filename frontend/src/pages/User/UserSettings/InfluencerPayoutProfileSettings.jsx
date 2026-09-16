import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { api } from "../../../lib/api.js";
import InfluencerFilesModal from "../../Influencer/components/InfluencerFilesModal.jsx";

import styles from "./InfluencerPayoutProfileSettings.module.css";

/*
 * „Trimite documente” - flux SEPARAT de factura oficială de payout
 * (secțiunea „Facturi și documente” de mai sus, care rămâne legată de
 * InfluencerPayout/Invoice, neschimbată).
 *
 * Aici sunt doar cele două căi pentru documente GENERALE (contracte,
 * briefuri, alte documente): modalul InfluencerFilesModal existent
 * (model InfluencerFile) și WhatsApp, ca alternativă. Nu se creează
 * niciun Invoice și nu se atinge fluxul de payout.
 */
const DOCS_WHATSAPP_PHONE = "40760565147";

const DOCS_WHATSAPP_MESSAGE =
  "Bună! Sunt influencer Artfest și vreau să trimit un document/factură.";

const DOCS_WHATSAPP_URL = `https://wa.me/${DOCS_WHATSAPP_PHONE}?text=${encodeURIComponent(
  DOCS_WHATSAPP_MESSAGE
)}`;

const DOC_FILE_TYPE_LABELS = {
  CONTRACT: "Contract",
  BRIEF: "Brief",
  DOCUMENT: "Document",
  OTHER: "Altul",
};

function formatFileSize(value) {
  const bytes = Number(value || 0);

  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/*
 * Tab „Setări” -> secțiunea „Fiscalizare & plăți” din dashboardul
 * de Influencer. Componentă SELF-CONTAINED (își face propriul fetch/
 * save, ca InfluencerDiscountCodesModal.jsx/InfluencerCollectionsModal.jsx),
 * ca să nu încarce și mai mult state-ul deja foarte mare din
 * InfluencerDashboardPage.jsx.
 *
 * NU integrează Stripe, NU efectuează nicio plată automată - profilul
 * de date (beneficiar/IBAN/date fiscale) rămâne editabil aici.
 *
 * FLUX FACTURARE (2026-09-09): Artfest NU emite nicio factură în
 * numele influencerului. Influencerul vede aici datele fiscale ale
 * Artfest (secțiunea „Date de facturare Artfest”, sursă unică
 * PlatformBilling - vezi GET /api/influencer/billing-info) și suma/
 * perioada de facturat per payout („Sume de facturat”), își emite
 * EL factura în afara platformei și o încarcă (PDF, + XML opțional) -
 * STRICT stocare, fără OCR/parsare/validare fiscală automată. Doar
 * pentru PFA/COMPANY - INDIVIDUAL/OTHER văd un mesaj, nu formularul
 * de upload.
 */

const PAYOUT_WORKFLOW = {
  AWAITING_INVOICE: {
    label: "Așteaptă factură",
    className: "statusIncomplete",
  },
  INVOICE_RECEIVED: {
    label: "Factură primită",
    className: "statusUnderReview",
  },
  PAID: {
    label: "Plătit",
    className: "statusComplete",
  },
};

function getPayoutWorkflow(payout) {
  if (payout.status === "PAID") return PAYOUT_WORKFLOW.PAID;
  return payout.invoice
    ? PAYOUT_WORKFLOW.INVOICE_RECEIVED
    : PAYOUT_WORKFLOW.AWAITING_INVOICE;
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("ro-RO");
  } catch {
    return "—";
  }
}

function formatMoney(value, currency = "RON") {
  const number = Number(value || 0);
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(number);
}

const BENEFICIARY_TYPE_OPTIONS = [
  { value: "INDIVIDUAL", label: "Persoană fizică" },
  { value: "PFA", label: "PFA" },
  { value: "COMPANY", label: "Companie / SRL" },
  { value: "OTHER", label: "Altă formă" },
];

const FISCAL_REQUIRED_TYPES = new Set(["PFA", "COMPANY"]);

const STATUS_LABELS = {
  INCOMPLETE: "Incomplet",
  COMPLETE: "Complet",
  UNDER_REVIEW: "În verificare",
  VERIFIED: "Verificat",
  REJECTED: "Respins",
};

const STATUS_CLASS = {
  INCOMPLETE: styles.statusIncomplete,
  COMPLETE: styles.statusComplete,
  UNDER_REVIEW: styles.statusUnderReview,
  VERIFIED: styles.statusVerified,
  REJECTED: styles.statusRejected,
};

const EMPTY_FORM = {
  beneficiaryType: "",
  beneficiaryName: "",
  iban: "",
  bankName: "",
  countryCode: "RO",
  fiscalName: "",
  taxId: "",
  registrationNumber: "",
  fiscalAddress: "",
  city: "",
  postalCode: "",
};

function toFormValue(value) {
  return value === null || value === undefined ? "" : value;
}

function toPayload(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

export default function InfluencerPayoutProfileSettings() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [form, setForm] = useState(EMPTY_FORM);

  const [status, setStatus] = useState({
    exists: false,
    isComplete: false,
    verificationStatus: "INCOMPLETE",
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  const [billing, setBilling] = useState(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");

  const [payouts, setPayouts] = useState([]);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [payoutsError, setPayoutsError] = useState("");

  const [filesModalOpen, setFilesModalOpen] = useState(false);

  const [docFiles, setDocFiles] = useState([]);
  const [docFilesLoading, setDocFilesLoading] = useState(true);
  const [docFilesError, setDocFilesError] = useState("");
  const [deletingFileId, setDeletingFileId] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const data = await api("/api/influencer/payout-profile");

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut încărca datele de plată."
        );
      }

      const p = data?.payoutProfile || {};

      setForm({
        beneficiaryType: toFormValue(p.beneficiaryType),
        beneficiaryName: toFormValue(p.beneficiaryName),
        iban: toFormValue(p.iban),
        bankName: toFormValue(p.bankName),
        countryCode: toFormValue(p.countryCode) || "RO",
        fiscalName: toFormValue(p.fiscalName),
        taxId: toFormValue(p.taxId),
        registrationNumber: toFormValue(p.registrationNumber),
        fiscalAddress: toFormValue(p.fiscalAddress),
        city: toFormValue(p.city),
        postalCode: toFormValue(p.postalCode),
      });

      setStatus({
        exists: Boolean(p.exists),
        isComplete: Boolean(p.isComplete),
        verificationStatus: p.verificationStatus || "INCOMPLETE",
      });
    } catch (err) {
      setLoadError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca datele de plată."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const showFiscalSection = FISCAL_REQUIRED_TYPES.has(form.beneficiaryType);

  const loadPayouts = useCallback(async () => {
    setPayoutsLoading(true);
    setPayoutsError("");

    try {
      const data = await api("/api/influencer/payouts");

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut încărca sumele de facturat."
        );
      }

      setPayouts(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setPayoutsError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca sumele de facturat."
      );
    } finally {
      setPayoutsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPayouts();
  }, [loadPayouts]);

  const loadDocFiles = useCallback(async () => {
    setDocFilesLoading(true);
    setDocFilesError("");

    try {
      const data = await api("/api/influencer/files");

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut încărca documentele."
        );
      }

      setDocFiles(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setDocFilesError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca documentele."
      );
    } finally {
      setDocFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocFiles();
  }, [loadDocFiles]);

  async function deleteDocFile(file) {
    const confirmed = window.confirm(
      `Ștergi documentul „${file.title || file.originalFilename}”?`
    );

    if (!confirmed) return;

    setDeletingFileId(file.id);

    try {
      await api(`/api/influencer/files/${file.id}`, {
        method: "DELETE",
      });

      toast.success("Documentul a fost șters.");
      await loadDocFiles();
    } catch (err) {
      toast.error(
        err?.data?.message ||
          err?.message ||
          "Nu am putut șterge documentul."
      );
    } finally {
      setDeletingFileId("");
    }
  }

  useEffect(() => {
    if (!showFiscalSection || billing || billingLoading) {
      return;
    }

    let active = true;

    async function loadBilling() {
      setBillingLoading(true);
      setBillingError("");

      try {
        const data = await api("/api/influencer/billing-info");

        if (!active) return;

        if (data?.ok === false) {
          throw new Error(
            data?.message || "Nu am putut încărca datele de facturare."
          );
        }

        setBilling(data?.billing || null);
      } catch (err) {
        if (!active) return;

        setBillingError(
          err?.data?.message ||
            err?.message ||
            "Nu am putut încărca datele de facturare Artfest."
        );
      } finally {
        if (active) setBillingLoading(false);
      }
    }

    loadBilling();

    return () => {
      active = false;
    };
  }, [showFiscalSection, billing, billingLoading]);

  function copyBillingData() {
    if (!billing) return;

    const lines = [
      billing.companyName,
      billing.legalType ? `Formă juridică: ${billing.legalType}` : null,
      `CUI/CIF: ${billing.cui}`,
      billing.regCom ? `Nr. Reg. Com.: ${billing.regCom}` : null,
      `Sediu: ${billing.address}`,
      billing.email ? `Email facturare: ${billing.email}` : null,
    ].filter(Boolean);

    navigator.clipboard
      ?.writeText(lines.join("\n"))
      .then(() => toast.success("Date copiate."))
      .catch(() => toast.error("Nu am putut copia datele."));
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveError("");
    setSaveSuccess("");
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.beneficiaryType) {
      setSaveError("Alege tipul beneficiarului.");
      return;
    }

    setSaving(true);
    setSaveError("");
    setSaveSuccess("");

    const body = {
      beneficiaryType: form.beneficiaryType,
      beneficiaryName: toPayload(form.beneficiaryName),
      iban: toPayload(form.iban),
      bankName: toPayload(form.bankName),
      countryCode: toPayload(form.countryCode) || "RO",
      fiscalName: toPayload(form.fiscalName),
      taxId: toPayload(form.taxId),
      registrationNumber: toPayload(form.registrationNumber),
      fiscalAddress: toPayload(form.fiscalAddress),
      city: toPayload(form.city),
      postalCode: toPayload(form.postalCode),
    };

    try {
      const data = await api("/api/influencer/payout-profile", {
        method: "PATCH",
        body,
      });

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut salva datele de plată."
        );
      }

      const p = data?.payoutProfile || {};

      setStatus({
        exists: Boolean(p.exists),
        isComplete: Boolean(p.isComplete),
        verificationStatus: p.verificationStatus || "INCOMPLETE",
      });

      setSaveSuccess("Datele de plată au fost salvate.");
    } catch (err) {
      setSaveError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut salva datele de plată. Încearcă din nou."
      );
    } finally {
      setSaving(false);
    }
  }

  const statusLabel = useMemo(
    () => STATUS_LABELS[status.verificationStatus] || status.verificationStatus,
    [status.verificationStatus]
  );

  if (loading) {
    return (
      <section className={styles.card}>
        <p className={styles.centerState}>Se încarcă…</p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Setări</div>
          <h2 className={styles.title}>Fiscalizare &amp; plăți</h2>
          <p className={styles.subtitle}>
            Aceste date sunt folosite pentru plata câștigurilor
            confirmate. Nu folosim aceste informații pentru plățile
            clienților sau pentru comenzile din marketplace.
          </p>
        </div>

        <span
          className={`${styles.statusBadge} ${
            STATUS_CLASS[status.verificationStatus] || ""
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {loadError && <div className={styles.errorBox}>{loadError}</div>}

      <form onSubmit={handleSubmit} className={styles.form}>
        {/* =====================================================
            A. TIP BENEFICIAR
        ===================================================== */}

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Tip beneficiar</h3>

          <div className={styles.radioGrid}>
            {BENEFICIARY_TYPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`${styles.radioOption} ${
                  form.beneficiaryType === option.value
                    ? styles.radioOptionActive
                    : ""
                }`}
              >
                <input
                  type="radio"
                  name="beneficiaryType"
                  value={option.value}
                  checked={form.beneficiaryType === option.value}
                  onChange={(e) =>
                    updateField("beneficiaryType", e.target.value)
                  }
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* =====================================================
            B. DATE DE PLATĂ
        ===================================================== */}

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Date de plată</h3>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Nume beneficiar *</span>
              <input
                type="text"
                value={form.beneficiaryName}
                onChange={(e) =>
                  updateField("beneficiaryName", e.target.value)
                }
                placeholder="Nume și prenume / denumire"
              />
            </label>

            <label className={styles.field}>
              <span>IBAN *</span>
              <input
                type="text"
                value={form.iban}
                onChange={(e) => updateField("iban", e.target.value)}
                placeholder="RO49AAAA1B31007593840000"
              />
            </label>

            <label className={styles.field}>
              <span>Bancă</span>
              <input
                type="text"
                value={form.bankName}
                onChange={(e) => updateField("bankName", e.target.value)}
                placeholder="Opțional"
              />
            </label>

            <label className={styles.field}>
              <span>Țară *</span>
              <input
                type="text"
                maxLength={2}
                value={form.countryCode}
                onChange={(e) =>
                  updateField("countryCode", e.target.value.toUpperCase())
                }
                placeholder="RO"
              />
            </label>
          </div>
        </div>

        {/* =====================================================
            C. DATE FISCALE (doar PFA/COMPANY)
        ===================================================== */}

        {showFiscalSection ? (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Date fiscale</h3>

            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span>Denumire fiscală *</span>
                <input
                  type="text"
                  value={form.fiscalName}
                  onChange={(e) =>
                    updateField("fiscalName", e.target.value)
                  }
                />
              </label>

              <label className={styles.field}>
                <span>CUI/CIF *</span>
                <input
                  type="text"
                  value={form.taxId}
                  onChange={(e) => updateField("taxId", e.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span>Nr. registru</span>
                <input
                  type="text"
                  value={form.registrationNumber}
                  onChange={(e) =>
                    updateField("registrationNumber", e.target.value)
                  }
                  placeholder="Opțional"
                />
              </label>

              <label className={styles.field}>
                <span>Adresă fiscală *</span>
                <input
                  type="text"
                  value={form.fiscalAddress}
                  onChange={(e) =>
                    updateField("fiscalAddress", e.target.value)
                  }
                />
              </label>

              <label className={styles.field}>
                <span>Localitate *</span>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => updateField("city", e.target.value)}
                />
              </label>

              <label className={styles.field}>
                <span>Cod poștal</span>
                <input
                  type="text"
                  value={form.postalCode}
                  onChange={(e) =>
                    updateField("postalCode", e.target.value)
                  }
                  placeholder="Opțional"
                />
              </label>
            </div>
          </div>
        ) : (
          form.beneficiaryType &&
          form.beneficiaryType !== "PFA" &&
          form.beneficiaryType !== "COMPANY" && (
            <p className={styles.note}>
              În această etapă nu solicităm CNP. Dacă vor fi necesare
              documente suplimentare pentru efectuarea unei plăți,
              acestea îți vor fi solicitate separat.
            </p>
          )
        )}

        {saveError && <div className={styles.errorBox}>{saveError}</div>}
        {saveSuccess && (
          <div className={styles.successBox}>{saveSuccess}</div>
        )}

        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={saving}
          >
            {saving ? "Se salvează…" : "Salvează"}
          </button>
        </div>
      </form>

      {/* =====================================================
          DATE DE FACTURARE ARTFEST (doar PFA/COMPANY)
      ===================================================== */}

      {showFiscalSection && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            Date de facturare Artfest
          </h3>

          {billingError && (
            <div className={styles.errorBox}>{billingError}</div>
          )}

          {billingLoading ? (
            <p className={styles.centerState}>Se încarcă…</p>
          ) : billing ? (
            <>
              <div className={styles.readOnlyGrid}>
                <div className={styles.readOnlyItem}>
                  <span>Denumire juridică</span>
                  <span>{billing.companyName}</span>
                </div>

                <div className={styles.readOnlyItem}>
                  <span>CUI/CIF</span>
                  <span>{billing.cui}</span>
                </div>

                {billing.regCom && (
                  <div className={styles.readOnlyItem}>
                    <span>Nr. Registrul Comerțului</span>
                    <span>{billing.regCom}</span>
                  </div>
                )}

                <div className={styles.readOnlyItem}>
                  <span>Sediu</span>
                  <span>{billing.address}</span>
                </div>

                {billing.email && (
                  <div className={styles.readOnlyItem}>
                    <span>Email de facturare</span>
                    <span>{billing.email}</span>
                  </div>
                )}
              </div>

              <p className={styles.note}>
                Folosește aceste date pentru factura emisă către
                Artfest pentru serviciile de promovare și afiliere.
              </p>

              <div className={styles.actions} style={{ marginTop: 4 }}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={copyBillingData}
                >
                  Copiază datele
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* =====================================================
          FACTURI ȘI DOCUMENTE
      ===================================================== */}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Facturi și documente</h3>

        <p className={styles.note} style={{ marginBottom: 12 }}>
          Aici vezi sumele pregătite de Artfest pentru facturare, facturile
          pe care le-ai trimis și statusul lor de plată.
        </p>

        {payoutsError && (
          <div className={styles.errorBox}>{payoutsError}</div>
        )}

        {payoutsLoading ? (
          <p className={styles.centerState}>Se încarcă…</p>
        ) : payouts.length === 0 ? (
          <p className={styles.note}>
            Nu ai încă nicio sumă pregătită de plată.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {payouts.map((payout) => (
              <PayoutInvoiceCard
                key={payout.id}
                payout={payout}
                beneficiaryType={form.beneficiaryType}
                onUploaded={loadPayouts}
              />
            ))}
          </div>
        )}
      </div>

      {/* =====================================================
          TRIMITE DOCUMENTE (documente generale - InfluencerFile,
          SEPARAT de factura oficială de payout de mai sus)
      ===================================================== */}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Trimite documente</h3>

        <p className={styles.note} style={{ marginBottom: 12 }}>
          Poți încărca documentele direct în Artfest sau ni le poți trimite
          pe WhatsApp.
        </p>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 18,
          }}
        >
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => setFilesModalOpen(true)}
          >
            + Încarcă fișier
          </button>

          <a
            href={DOCS_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.secondaryButton}
          >
            Trimite pe WhatsApp
          </a>
        </div>

        <h4 className={styles.docFilesTitle}>
          Documentele tale{" "}
          {!docFilesLoading && docFiles.length > 0 && `(${docFiles.length})`}
        </h4>

        {docFilesError && (
          <div className={styles.errorBox}>{docFilesError}</div>
        )}

        {docFilesLoading ? (
          <p className={styles.centerState}>Se încarcă…</p>
        ) : docFiles.length === 0 ? (
          <p className={styles.note}>Nu ai încă documente încărcate.</p>
        ) : (
          <div className={styles.docFilesList}>
            {docFiles.map((file) => (
              <div key={file.id} className={styles.docFileRow}>
                <div className={styles.docFileMain}>
                  <div className={styles.docFileTop}>
                    <strong className={styles.docFileName}>
                      {file.title || file.originalFilename}
                    </strong>

                    <span className={styles.typeBadge}>
                      {DOC_FILE_TYPE_LABELS[file.type] || "Document"}
                    </span>
                  </div>

                  <div className={styles.docFileMeta}>
                    {formatDate(file.createdAt)} ·{" "}
                    {formatFileSize(file.sizeBytes)}
                  </div>
                </div>

                <div className={styles.docFileActions}>
                  <a
                    href={file.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.smallButton}
                  >
                    Deschide
                  </a>

                  <button
                    type="button"
                    className={styles.smallButton}
                    disabled={deletingFileId === file.id}
                    onClick={() => deleteDocFile(file)}
                  >
                    {deletingFileId === file.id ? "Se șterge…" : "Șterge"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className={styles.note} style={{ marginTop: 12 }}>
          Pentru facturile aferente sumelor de plată, folosește secțiunea
          „Facturi și documente” de mai sus. Pentru alte documente, poți
          folosi încărcarea de fișiere sau WhatsApp.
        </p>
      </div>

      {filesModalOpen && (
        <InfluencerFilesModal
          mode="upload"
          onClose={() => setFilesModalOpen(false)}
          onChanged={loadDocFiles}
        />
      )}
    </section>
  );
}

/* =========================================================
   CARD PAYOUT + CELE DOUĂ METODE DE FACTURARE
========================================================= */

function PayoutInvoiceCard({ payout, beneficiaryType, onUploaded }) {
  const [formOpen, setFormOpen] = useState(false);

  const workflow = getPayoutWorkflow(payout);
  const canSelfInvoice =
    beneficiaryType === "PFA" || beneficiaryType === "COMPANY";

  /*
   * INDIVIDUAL: nu intră deloc în fluxul de factură - nici status de
   * factură, nici SmartBill, nici upload. Doar suma/perioada + mesajul
   * cerut explicit.
   */
  if (beneficiaryType === "INDIVIDUAL") {
    return (
      <div className={styles.payoutCard}>
        <div className={styles.payoutCardHeader}>
          <div>
            <div className={styles.payoutAmount}>
              {formatMoney(payout.amount, payout.currency)}
            </div>

            <div className={styles.payoutPeriod}>
              {formatDate(payout.periodFrom)} – {formatDate(payout.periodTo)}
            </div>
          </div>
        </div>

        <p className={styles.note} style={{ margin: 0 }}>
          Pentru persoanele fizice fără formă juridică, documentele și
          modalitatea de procesare a plății se stabilesc separat, în
          funcție de situația fiscală aplicabilă.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.payoutCard}>
      <div className={styles.payoutCardHeader}>
        <div>
          <div className={styles.payoutAmount}>
            {formatMoney(payout.amount, payout.currency)}
          </div>

          <div className={styles.payoutPeriod}>
            {formatDate(payout.periodFrom)} – {formatDate(payout.periodTo)}
          </div>
        </div>

        <span
          className={`${styles.statusBadge} ${
            styles[workflow.className] || ""
          }`}
        >
          {workflow.label}
        </span>
      </div>

      {payout.invoice && (
        <div className={styles.payoutPeriod}>
          Factură {payout.invoice.number || "—"} din{" "}
          {formatDate(payout.invoice.issueDate)}
          {payout.invoice.uploadedAt && (
            <> · încărcată {formatDate(payout.invoice.uploadedAt)}</>
          )}
          <br />
          {payout.invoice.pdfUrl && (
            <a
              href={payout.invoice.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Vezi PDF
            </a>
          )}
          {payout.invoice.xmlUrl && (
            <>
              {" · "}
              <a
                href={payout.invoice.xmlUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Vezi XML
              </a>
            </>
          )}
        </div>
      )}

      {payout.status === "UNPAID" && !payout.invoice && (
        <>
          {canSelfInvoice ? (
            formOpen ? (
              <PayoutInvoiceUploadForm
                payoutId={payout.id}
                onCancel={() => setFormOpen(false)}
                onUploaded={() => {
                  setFormOpen(false);
                  onUploaded?.();
                }}
              />
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <p className={styles.note} style={{ margin: 0 }}>
                  Poți conecta propriul cont SmartBill pentru a simplifica
                  emiterea facturilor sau poți emite factura în orice
                  program de facturare și o poți încărca manual.
                </p>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled
                    title="Disponibil într-o etapă viitoare"
                  >
                    Conectează SmartBill
                  </button>

                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={() => setFormOpen(true)}
                  >
                    Încarcă factura manual
                  </button>
                </div>
              </div>
            )
          ) : (
            <p className={styles.note} style={{ margin: 0 }}>
              Necesită procesare manuală.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PayoutInvoiceUploadForm({ payoutId, onCancel, onUploaded }) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [file, setFile] = useState(null);
  const [xmlFile, setXmlFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();

    if (!invoiceNumber.trim()) {
      setError("Introdu numărul facturii.");
      return;
    }

    if (!invoiceDate) {
      setError("Alege data facturii.");
      return;
    }

    if (!file) {
      setError("Atașează factura în format PDF.");
      return;
    }

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("invoiceNumber", invoiceNumber.trim());
      formData.append("invoiceDate", invoiceDate);
      formData.append("file", file);
      if (xmlFile) {
        formData.append("xmlFile", xmlFile);
      }

      const data = await api(
        `/api/influencer/payouts/${encodeURIComponent(payoutId)}/invoice`,
        { method: "POST", body: formData }
      );

      if (data?.ok === false) {
        throw new Error(data?.message || "Nu am putut trimite factura.");
      }

      toast.success("Factura a fost trimisă.");
      onUploaded?.();
    } catch (err) {
      setError(
        err?.data?.message || err?.message || "Nu am putut trimite factura."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.uploadForm}>
      <div className={styles.fieldGrid}>
        <label className={styles.field}>
          <span>Număr factură *</span>
          <input
            type="text"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="ex. FACT-0001"
          />
        </label>

        <label className={styles.field}>
          <span>Data facturii *</span>
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>Factură (PDF) *</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>

        <label className={styles.field}>
          <span>XML (opțional)</span>
          <input
            type="file"
            accept="application/xml,text/xml"
            onChange={(e) => setXmlFile(e.target.files?.[0] || null)}
          />
        </label>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="submit"
          className={styles.primaryButton}
          disabled={uploading}
        >
          {uploading ? "Se trimite…" : "Trimite factura"}
        </button>

        <button
          type="button"
          className={styles.secondaryButton}
          disabled={uploading}
          onClick={onCancel}
        >
          Renunță
        </button>
      </div>
    </form>
  );
}
