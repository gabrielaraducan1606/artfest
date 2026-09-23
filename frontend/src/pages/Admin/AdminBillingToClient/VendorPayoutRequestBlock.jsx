import { Loader2, ShieldAlert, CheckCircle2, AlertTriangle } from "lucide-react";
import styles from "./AdminBillingToClient.module.css";

/*
 * CORECTAT (audit facturare, 2026-09-23): în modelul actual (Model B),
 * pentru CARD banii ajung la vendor direct prin transferul Stripe la
 * plată, iar pentru COD Artfest nu încasează niciodată suma produselor -
 * deci Artfest NU mai datorează vendorului nimic pe această cale.
 * Relația financiară e inversă: VENDORUL datorează comision Artfest
 * (facturat lunar, vezi "Creează factură"). Acest bloc NU mai afișează
 * nicio sumă „de încasat” - e STRICT o solicitare de documente fiscale
 * (factura vendorului sau alte documente), utilă administrativ/pentru
 * reconciliere, diferențiată pe tip fiscal:
 *
 * - LEGAL_ENTITY (SRL/PFA/II/IF, VendorBilling.sellerType=
 *   "verified_business") -> "Solicită factura".
 * - INDEPENDENT_PF (persoană fizică FĂRĂ formă juridică,
 *   sellerType="independent_creator") -> "Solicită documentele" -
 *   NICIODATĂ nu cerem "factură" unei persoane fizice fără formă
 *   juridică (nu presupunem că poate emite una).
 * - UNKNOWN (billing lipsă/incomplet) -> blocat, DOAR un indicator
 *   "Verifică datele fiscale", fără acțiune care trimite ceva.
 *
 * STATUS PERSISTENT (audit 2026-09-16, verificare finală): sursa de
 * adevăr e `row.payoutRequestStatus`, întors de backend (GET
 * /billing/vendors-due), derivat STRICT din Notification.dedupeKey +
 * createdAt (+ EmailLog pentru starea emailului) - NU dintr-un flag
 * local. Un refresh de pagină arată exact aceeași stare, pentru că
 * nu depinde de React state. `state` (prop separat) e STRICT pentru
 * feedback imediat, tranzitoriu (loading/eroare de rețea) - dispare
 * la următorul refetch, indiferent de rezultat.
 *
 * Zero payout automat, zero atingere de ledger/SmartBill - STRICT o
 * notificare in-app + un email informativ despre documente (vezi POST
 * /api/admin/billing/request-vendor-payout, adminInvoicesRoutes.js;
 * textele efective sunt în services/notifications.js și lib/mailer.js,
 * corectate în același audit - nu mai menționează o sumă de încasat).
 */

function formatDateTime(d) {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(d)
    );
  } catch {
    return "—";
  }
}

export default function VendorPayoutRequestBlock({ row, state, onRequest }) {
  const fiscalType = row.fiscalType || { category: "UNKNOWN", label: null };
  const loading = Boolean(state?.loading);

  // Sursa PERSISTENTĂ (backend) - nu local state.
  const requestStatus = row.payoutRequestStatus || null;
  const alreadyRequested = Boolean(requestStatus);

  const statusLabel =
    requestStatus?.type === "INVOICE" ? "Factură solicitată" : "Documente solicitate";

  return (
    <div
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: "1px dashed var(--color-border)",
        display: "grid",
        gap: 6,
        justifyItems: "end",
        textAlign: "right",
      }}
    >
      <div style={{ fontSize: 12 }} className={styles.muted}>
        Verificare fiscală / documente
      </div>

      {fiscalType.label && (
        <div className={styles.muted} style={{ fontSize: 12 }}>
          Tip fiscal vendor: {fiscalType.label}
        </div>
      )}

      {alreadyRequested ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 800,
              color: "var(--color-primary)",
            }}
          >
            <CheckCircle2 size={14} /> {statusLabel}
          </div>
          <div className={styles.muted} style={{ fontSize: 11 }}>
            Solicitat la: {formatDateTime(requestStatus.requestedAt)}
          </div>

          {requestStatus.emailStatus === "FAILED" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--color-danger)",
              }}
              title={requestStatus.emailError || undefined}
            >
              <AlertTriangle size={12} /> Emailul nu a putut fi trimis
            </div>
          )}

          {/* Buton dezactivat, cu eticheta de status - NU mai arată ca
              și cum nimic nu s-a întâmplat. "Retrimite" nu există încă -
              nicio regulă de business clară pentru retransmitere. */}
          <button type="button" className={styles.secondaryBtn} disabled>
            {statusLabel}
          </button>
        </>
      ) : fiscalType.category === "UNKNOWN" ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "var(--color-danger)",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <ShieldAlert size={14} /> Verifică datele fiscale
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
          <div className={styles.muted} style={{ fontSize: 11, maxWidth: 220, textAlign: "right" }}>
            Solicită documentele fiscale necesare pentru reconcilierea comisionului — nu este o
            solicitare de plată.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" className={styles.primaryBtn} disabled={loading} onClick={onRequest}>
              {loading ? <Loader2 size={16} className={styles.spin} /> : null}
              {fiscalType.category === "LEGAL_ENTITY" ? "Solicită factura" : "Solicită documentele"}
            </button>
          </div>
        </div>
      )}

      {!!state?.error && (
        <div className={styles.error} style={{ fontSize: 12 }}>
          {state.error}
        </div>
      )}
    </div>
  );
}
