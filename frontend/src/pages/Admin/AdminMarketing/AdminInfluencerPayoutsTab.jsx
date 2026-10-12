import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";

import { api } from "../../../lib/api";
import styles from "./AdminInfluencersTab.module.css";

/*
 * Subtab „Fiscalizare & plăți” (Admin -> Marketing -> Influenceri).
 *
 * Profilul fiscal (InfluencerPayoutProfile) rămâne STRICT read-only -
 * editarea lui e exclusiv acțiunea influencerului. "Pregătește plata"
 * blochează câștigurile neprocesate într-un InfluencerPayout.
 *
 * FLUX FINAL (2026-09-09): Artfest NU mai emite nicio factură în
 * numele influencerului - influencerul își încarcă PROPRIA factură
 * (emisă de el, în afara platformei) din contul lui. Adminul doar
 * VEDE/descarcă acea factură (GET /api/admin/invoices/:id/pdf, deja
 * existent) și, după ce a făcut transferul IBAN MANUAL, apasă
 * "Marchează ca plătit" - STRICT bookkeeping, nu declanșează niciun
 * transfer (Stripe/bancar).
 *
 * Status derivat per payout (nu un câmp nou în DB):
 * - "Așteaptă factură"  = UNPAID, fără invoice
 * - "Factură primită"   = UNPAID, cu invoice încărcat de influencer
 * - "Plătit"             = payout.status === "PAID"
 */

const BENEFICIARY_TYPE_LABELS = {
  INDIVIDUAL: "Persoană fizică",
  PFA: "PFA",
  COMPANY: "Companie",
  OTHER: "Altul",
};

const VERIFICATION_STATUS_LABELS = {
  INCOMPLETE: "Incomplet",
  COMPLETE: "Complet",
  UNDER_REVIEW: "În verificare",
  VERIFIED: "Verificat",
  REJECTED: "Respins",
};

const VERIFICATION_STATUS_CLASSES = {
  INCOMPLETE: "statusIncomplete",
  COMPLETE: "statusCompletePayout",
  UNDER_REVIEW: "statusUnderReview",
  VERIFIED: "statusVerified",
  REJECTED: "statusRejected",
};

/*
 * Status derivat per payout - NU un câmp nou în DB, doar o citire a
 * payout.status + prezența payout.invoice (vezi comentariul de sus).
 * Reutilizăm paleta EXISTENTĂ de culori (statusActive/statusInvited/
 * statusDisabled) - nu inventăm clase noi.
 */
function getPayoutWorkflowLabel(payout) {
  if (payout.status === "PAID") {
    return "Plătit";
  }

  if (payout.status === "CANCELLED") {
    return "Anulat";
  }

  return payout.invoice ? "Factură primită" : "Așteaptă factură";
}

function getPayoutWorkflowClass(payout) {
  if (payout.status === "PAID") {
    return styles.statusActive;
  }

  if (payout.status === "CANCELLED") {
    return styles.statusDisabled;
  }

  return payout.invoice ? styles.statusInvited : styles.statusDisabled;
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleString("ro-RO");
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

function getBeneficiaryTypeLabel(type) {
  return BENEFICIARY_TYPE_LABELS[type] || "—";
}

function getVerificationStatusLabel(status) {
  return VERIFICATION_STATUS_LABELS[status] || status || "Incomplet";
}

function getVerificationStatusClass(status) {
  const key =
    VERIFICATION_STATUS_CLASSES[status] || "statusIncomplete";
  return styles[key];
}

/*
 * Mascare IBAN pentru afișare: păstrează primele 4 și ultimele 4
 * caractere, restul devine „•”. Folosit ca stare implicită în
 * drawer (chiar dacă rândul de listă nu conține niciodată IBAN-ul).
 */
function maskIban(iban) {
  const value = String(iban || "").trim();

  if (value.length <= 8) {
    return value ? "••••" : "—";
  }

  const start = value.slice(0, 4);
  const end = value.slice(-4);

  return `${start} •••• •••• ${end}`;
}

/*
 * Facturile influencerilor sunt încărcate direct pe R2 (URL public,
 * vezi influencerPayoutsRoutes.js) - spre deosebire de PDF-urile
 * SmartBill ale vendorilor (fișier local, proxy prin backend), aici
 * nu mai e nevoie de niciun endpoint intermediar - link direct.
 */

/* =========================================================
   COMPONENT
========================================================= */

export default function AdminInfluencerPayoutsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedItem, setSelectedItem] = useState(null);

  const loadPayoutProfiles = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await api(
        "/api/admin/influencers/payout-profiles"
      );

      if (data?.ok === false) {
        throw new Error(
          data?.message ||
            "Nu am putut încărca datele de fiscalizare."
        );
      }

      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca datele de fiscalizare."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPayoutProfiles();
  }, [loadPayoutProfiles]);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.cardTitle}>
            Fiscalizare & plăți
          </div>

          <div className={styles.cardSubtitle}>
            Statusul datelor bancare/fiscale ale influencerilor,
            câștigul disponibil pentru plată și istoricul payout-urilor.
            Plata efectivă se face manual, prin transfer IBAN, în
            afara aplicației.
          </div>
        </div>

        <button
          type="button"
          onClick={loadPayoutProfiles}
          className={styles.secondaryButton}
        >
          Reîncarcă
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.loading}>Se încarcă…</div>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyTitle}>
            Nu există încă influenceri.
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Influencer</th>
                <th>Email</th>
                <th>Tip beneficiar</th>
                <th>Status fiscal</th>
                <th>Disponibil pentru plată</th>
                <th>Câștig confirmat total</th>
                <th>Ultima plată</th>
                <th>Acțiuni</th>
              </tr>
            </thead>

            <tbody>
              {items.map((item) => (
                <tr key={item.influencerId}>
                  <td className={styles.nameCell}>
                    {item.displayName || "—"}
                  </td>

                  <td>{item.email || "—"}</td>

                  <td>
                    {getBeneficiaryTypeLabel(
                      item.beneficiaryType
                    )}
                  </td>

                  <td>
                    <span
                      className={`${
                        styles.status
                      } ${getVerificationStatusClass(
                        item.verificationStatus
                      )}`}
                    >
                      {getVerificationStatusLabel(
                        item.verificationStatus
                      )}
                    </span>
                  </td>

                  <td>{formatMoney(item.availableForPayout)}</td>

                  <td>
                    {formatMoney(item.confirmedEarningsAmount)}
                  </td>

                  <td>
                    {item.lastPayout ? (
                      <span
                        className={`${
                          styles.status
                        } ${getPayoutWorkflowClass({
                          status: item.lastPayout.status,
                          invoice: item.lastPayout.hasInvoice,
                        })}`}
                        title={formatMoney(
                          item.lastPayout.amount,
                          item.lastPayout.currency
                        )}
                      >
                        {getPayoutWorkflowLabel({
                          status: item.lastPayout.status,
                          invoice: item.lastPayout.hasInvoice,
                        })}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td>
                    <button
                      type="button"
                      className={styles.smallButton}
                      onClick={() => setSelectedItem(item)}
                    >
                      Vezi detalii
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedItem && (
        <PayoutDetailsDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onChanged={loadPayoutProfiles}
        />
      )}
    </div>
  );
}

/* =========================================================
   DRAWER DETALII
========================================================= */

function PayoutDetailsDrawer({ item, onClose, onChanged }) {
  const influencerId = item.influencerId;

  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [ibanRevealed, setIbanRevealed] = useState(false);

  const [payouts, setPayouts] = useState([]);
  const [loadingPayouts, setLoadingPayouts] = useState(true);
  const [payoutsError, setPayoutsError] = useState("");

  const [preparing, setPreparing] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoadingProfile(true);
    setProfileError("");

    try {
      const data = await api(
        `/api/admin/influencers/${encodeURIComponent(
          influencerId
        )}/payout-profile`
      );

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut încărca profilul de plată."
        );
      }

      setProfile(data?.profile || null);
    } catch (err) {
      setProfileError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca profilul de plată."
      );
    } finally {
      setLoadingProfile(false);
    }
  }, [influencerId]);

  const loadPayouts = useCallback(async () => {
    setLoadingPayouts(true);
    setPayoutsError("");

    try {
      const data = await api(
        `/api/admin/influencers/${encodeURIComponent(
          influencerId
        )}/payouts`
      );

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut încărca istoricul plăților."
        );
      }

      setPayouts(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setPayoutsError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut încărca istoricul plăților."
      );
    } finally {
      setLoadingPayouts(false);
    }
  }, [influencerId]);

  useEffect(() => {
    loadProfile();
    loadPayouts();
  }, [loadProfile, loadPayouts]);

  async function handlePreparePayout() {
    setPreparing(true);

    try {
      const data = await api(
        `/api/admin/influencers/${encodeURIComponent(
          influencerId
        )}/payouts`,
        { method: "POST" }
      );

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut pregăti plata."
        );
      }

      toast.success(
        `Payout pregătit: ${formatMoney(data.payout?.amount)}.`
      );

      await loadPayouts();
      onChanged?.();
    } catch (err) {
      toast.error(
        err?.data?.message ||
          err?.message ||
          "Nu am putut pregăti plata."
      );
    } finally {
      setPreparing(false);
    }
  }

  if (typeof document === "undefined") {
    return null;
  }

  const node = (
    <div
      className={styles.drawerOverlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        className={styles.drawer}
        aria-label="Detalii fiscalizare & plăți"
      >
        <div className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>
              {item.displayName || "Influencer"}
            </h3>

            <div className={styles.drawerSub}>
              {item.email || "—"}
            </div>
          </div>

          <button
            type="button"
            className={styles.drawerClose}
            onClick={onClose}
            aria-label="Închide"
          >
            ×
          </button>
        </div>

        <div className={styles.drawerBody}>
          {profileError && (
            <div className={styles.error}>{profileError}</div>
          )}

          {loadingProfile ? (
            <div className={styles.loading}>Se încarcă…</div>
          ) : !profile?.exists ? (
            <section className={styles.drawerSection}>
              <h4>Status</h4>

              <DrawerField
                label="Status fiscal"
                value="Incomplet - influencerul nu a completat încă profilul de plată."
              />
            </section>
          ) : (
            <>
              <section className={styles.drawerSection}>
                <h4>Status</h4>

                <DrawerField label="Status fiscal">
                  <span
                    className={`${
                      styles.status
                    } ${getVerificationStatusClass(
                      profile.verificationStatus
                    )}`}
                  >
                    {getVerificationStatusLabel(
                      profile.verificationStatus
                    )}
                  </span>
                </DrawerField>

                <DrawerField
                  label="Profil complet"
                  value={profile.isComplete ? "Da" : "Nu"}
                />

                <DrawerField
                  label="Verificat la"
                  value={formatDate(profile.verifiedAt)}
                />

                <DrawerField
                  label="Ultima actualizare"
                  value={formatDate(profile.updatedAt)}
                />
              </section>

              <section className={styles.drawerSection}>
                <h4>Beneficiar</h4>

                <DrawerField label="Tip beneficiar">
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {getBeneficiaryTypeLabel(profile.beneficiaryType)}
                  </span>
                </DrawerField>

                <DrawerField
                  label="Nume beneficiar"
                  value={profile.beneficiaryName || "—"}
                />

                <DrawerField label="IBAN">
                  {profile.iban ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <code>
                        {ibanRevealed
                          ? profile.iban
                          : maskIban(profile.iban)}
                      </code>

                      <button
                        type="button"
                        className={styles.smallButton}
                        onClick={() =>
                          setIbanRevealed((current) => !current)
                        }
                      >
                        {ibanRevealed ? "Ascunde" : "Arată"}
                      </button>
                    </div>
                  ) : (
                    "—"
                  )}
                </DrawerField>

                <DrawerField
                  label="Bancă"
                  value={profile.bankName || "—"}
                />

                <DrawerField
                  label="Țară"
                  value={profile.countryCode || "—"}
                />
              </section>

              <section className={styles.drawerSection}>
                <h4>Date fiscale</h4>

                <DrawerField
                  label="Nume fiscal"
                  value={profile.fiscalName || "—"}
                />

                <DrawerField
                  label="CUI / CNP"
                  value={profile.taxId || "—"}
                />

                <DrawerField
                  label="Nr. înregistrare"
                  value={profile.registrationNumber || "—"}
                />

                <DrawerField
                  label="Adresă fiscală"
                  value={profile.fiscalAddress || "—"}
                />

                <DrawerField
                  label="Oraș"
                  value={profile.city || "—"}
                />

                <DrawerField
                  label="Cod poștal"
                  value={profile.postalCode || "—"}
                />
              </section>
            </>
          )}

          <section className={styles.drawerSection}>
            <h4>Plăți</h4>

            <DrawerField
              label="Disponibil pentru plată"
              value={formatMoney(item.availableForPayout)}
            />

            <DrawerField
              label="Câștig confirmat total"
              value={formatMoney(item.confirmedEarningsAmount)}
            />

            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={preparing || Number(item.availableForPayout) <= 0}
                onClick={handlePreparePayout}
              >
                {preparing ? "Se pregătește..." : "Pregătește plata"}
              </button>
            </div>
          </section>

          <section className={styles.drawerSection}>
            <h4>Istoric plăți</h4>

            {payoutsError && (
              <div className={styles.error}>{payoutsError}</div>
            )}

            {loadingPayouts ? (
              <div className={styles.loading}>Se încarcă…</div>
            ) : payouts.length === 0 ? (
              <div className={styles.subtitle} style={{ fontSize: 13 }}>
                Niciun payout creat încă pentru acest influencer.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {payouts.map((payout) => (
                  <PayoutHistoryRow
                    key={payout.id}
                    payout={payout}
                    influencerId={influencerId}
                    influencerName={item.displayName}
                    iban={profile?.iban}
                    onChanged={async () => {
                      await loadPayouts();
                      onChanged?.();
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}

/* =========================================================
   RÂND ISTORIC PAYOUT (Vezi factura / Marchează ca plătit)
========================================================= */

function PayoutHistoryRow({ payout, influencerId, influencerName, iban, onChanged }) {
  const [markingOpen, setMarkingOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const [opening, setOpening] = useState("");

  // backend: invoiceUploaded / payoutAllowed / payoutBlockedMessages (factură + conformitate)
  const invoiceUploaded = Boolean(payout.invoiceUploaded ?? payout.invoice);
  const payoutAllowed = payout.status === "UNPAID" && payout.payoutAllowed === true;
  const blockedMessages = Array.isArray(payout.payoutBlockedMessages)
    ? payout.payoutBlockedMessages
    : [];

  // factura doar prin link semnat cu expirare (fără URL public R2)
  async function openInvoiceFile(kind) {
    setOpening(kind);

    try {
      const data = await api(
        `/api/admin/influencers/${encodeURIComponent(
          influencerId
        )}/payouts/${encodeURIComponent(payout.id)}/invoice/file?kind=${kind}`
      );
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(
        err?.data?.message || err?.message || "Nu am putut deschide factura."
      );
    } finally {
      setOpening("");
    }
  }
  const [paidAt, setPaidAt] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  const [paymentReference, setPaymentReference] = useState("");

  async function handleConfirmMarkPaid() {
    setMarking(true);

    try {
      const data = await api(
        `/api/admin/influencer-payouts/${encodeURIComponent(
          payout.id
        )}/mark-paid`,
        {
          method: "POST",
          body: {
            paidAt: paidAt
              ? new Date(`${paidAt}T12:00:00`).toISOString()
              : undefined,
            paymentReference: paymentReference.trim() || undefined,
          },
        }
      );

      if (data?.ok === false) {
        throw new Error(
          data?.message || "Nu am putut marca payout-ul ca plătit."
        );
      }

      toast.success("Payout marcat ca plătit.");
      setMarkingOpen(false);
      setPaymentReference("");
      await onChanged?.();
    } catch (err) {
      toast.error(
        err?.data?.message ||
          err?.message ||
          "Nu am putut marca payout-ul ca plătit."
      );
    } finally {
      setMarking(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: 10,
        display: "grid",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontWeight: 700 }}>
            {formatMoney(payout.amount, payout.currency)}
          </div>

          <div className={styles.subtitle} style={{ fontSize: 12 }}>
            {formatDate(payout.periodFrom)} - {formatDate(payout.periodTo)}
          </div>
        </div>

        <span
          className={`${styles.status} ${getPayoutWorkflowClass(payout)}`}
        >
          {getPayoutWorkflowLabel(payout)}
        </span>
      </div>

      <div className={styles.subtitle} style={{ fontSize: 12 }}>
        Pregătit: {formatDate(payout.issuedAt)}
        {payout.paidAt && (
          <>
            {" "}
            · Plătit: {formatDate(payout.paidAt)}
          </>
        )}
        {payout.paymentReference && (
          <>
            {" "}
            · Referință: {payout.paymentReference}
          </>
        )}
      </div>

      {payout.invoice ? (
        <div className={styles.subtitle} style={{ fontSize: 12 }}>
          Factură: {payout.invoice.number || "—"} din{" "}
          {formatDate(payout.invoice.issueDate)} (
          {formatMoney(payout.invoice.totalGross, payout.currency)})
          {payout.invoice.uploadedAt && (
            <> · încărcată {formatDate(payout.invoice.uploadedAt)}</>
          )}
          {payout.invoice.hasPdf && (
            <>
              {" — "}
              <button
                type="button"
                className={styles.smallButton}
                disabled={!!opening}
                onClick={() => openInvoiceFile("pdf")}
              >
                {opening === "pdf" ? "Se deschide..." : "Vezi factura"}
              </button>
            </>
          )}
          {payout.invoice.hasXml && (
            <>
              {" "}
              <button
                type="button"
                className={styles.smallButton}
                disabled={!!opening}
                onClick={() => openInvoiceFile("xml")}
              >
                {opening === "xml" ? "Se deschide..." : "XML"}
              </button>
            </>
          )}
        </div>
      ) : (
        payout.status === "UNPAID" && (
          <div className={styles.subtitle} style={{ fontSize: 12 }}>
            Influencerul nu a încărcat încă factura pentru acest payout.
          </div>
        )
      )}

      {payout.status === "UNPAID" && (
        <div className={styles.subtitle} style={{ fontSize: 12 }}>
          Factură: <strong>{invoiceUploaded ? "Încărcată" : "Lipsă"}</strong>
          {" · "}
          Payout permis: <strong>{payoutAllowed ? "DA" : "NU"}</strong>
        </div>
      )}

      {payout.status === "UNPAID" &&
        blockedMessages.map((message) => (
          <div key={message} className={styles.payoutBlocked} role="status">
            {message}
          </div>
        ))}

      {payout.status === "UNPAID" && !markingOpen && (
        <div>
          <button
            type="button"
            className={styles.smallButton}
            onClick={() => setMarkingOpen(true)}
            disabled={!payoutAllowed}
            title={payoutAllowed ? undefined : blockedMessages.join(" ")}
          >
            Marchează ca plătit
          </button>
        </div>
      )}

      {markingOpen && payoutAllowed && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: 10,
            display: "grid",
            gap: 8,
          }}
        >
          <div className={styles.subtitle} style={{ fontSize: 12 }}>
            Confirmi transferul manual către{" "}
            <strong>{influencerName || "influencer"}</strong>, sumă{" "}
            <strong>{formatMoney(payout.amount, payout.currency)}</strong>
            {iban && (
              <>
                {" "}
                pe IBAN <code>{iban}</code>
              </>
            )}
            .
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span className={styles.subtitle} style={{ fontSize: 11 }}>
                Data plății
              </span>

              <input
                type="date"
                value={paidAt}
                onChange={(event) => setPaidAt(event.target.value)}
                className={styles.input}
                style={{ maxWidth: 170 }}
              />
            </label>

            <label style={{ display: "grid", gap: 4, flex: 1 }}>
              <span className={styles.subtitle} style={{ fontSize: 11 }}>
                Referință transfer / nr. OP (opțional)
              </span>

              <input
                type="text"
                placeholder="ex. OP 1234"
                value={paymentReference}
                onChange={(event) =>
                  setPaymentReference(event.target.value)
                }
                className={styles.input}
                style={{ minWidth: 200 }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={marking}
              onClick={handleConfirmMarkPaid}
            >
              {marking ? "Se salvează..." : "Confirmă plata"}
            </button>

            <button
              type="button"
              className={styles.secondaryButton}
              disabled={marking}
              onClick={() => {
                setMarkingOpen(false);
                setPaymentReference("");
              }}
            >
              Renunță
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DrawerField({ label, value, children }) {
  return (
    <div className={styles.drawerField}>
      <span>{label}</span>
      <div>{children ?? value}</div>
    </div>
  );
}
