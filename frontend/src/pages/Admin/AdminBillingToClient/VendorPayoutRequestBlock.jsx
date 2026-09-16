import { Loader2, ShieldAlert, CheckCircle2, AlertTriangle } from "lucide-react";
import styles from "./AdminBillingToClient.module.css";

/*
 * Artfest DATOREAZĂ vendorului (audit 2026-09-16) - bloc UI pentru
 * solicitarea documentului corect, STRICT diferențiat pe tip fiscal:
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
 * notificare in-app + un email informativ (vezi POST
 * /api/admin/billing/request-vendor-payout, adminInvoicesRoutes.js).
 */

function formatMoney(n, currency = "RON") {
  const v = Number(n || 0);
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(v);
}

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
        Sumă de încasat de la Artfest
      </div>
      <div style={{ fontWeight: 900 }}>{formatMoney(row.vendorNet, row.currency || "RON")}</div>

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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" className={styles.primaryBtn} disabled={loading} onClick={onRequest}>
            {loading ? <Loader2 size={16} className={styles.spin} /> : null}
            {fiscalType.category === "LEGAL_ENTITY" ? "Solicită factura" : "Solicită documentele"}
          </button>
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
