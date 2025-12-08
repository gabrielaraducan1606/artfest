// UserInvoicesPage.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "../../Vendor/Invoices/InvoicePage.module.css";

const STATUS_LABELS = {
  PAID: "Plătită",
  UNPAID: "Neplătită",
  OVERDUE: "Scadentă",
  CANCELLED: "Anulată",
};

function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ro-RO");
}

export default function UserInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [statusFilter, setStatusFilter] = useState("ALL");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr("");

        // 👇 endpoint pentru facturile userului – îl vei implementa în backend
        const res = await api("/api/users/me/invoices").catch(() => ({ items: [] }));
        if (!alive) return;

        setInvoices(res.items || res || []);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Nu am putut încărca facturile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== "ALL" && inv.status !== statusFilter) return false;
      return true;
    });
  }, [invoices, statusFilter]);

  const summary = useMemo(() => {
    let totalPaid = 0;
    let totalUnpaid = 0;

    for (const inv of invoices) {
      const val = Number(inv.totalGross || inv.total || 0) || 0;

      if (inv.status === "PAID") totalPaid += val;
      if (inv.status === "UNPAID" || inv.status === "OVERDUE") totalUnpaid += val;

      // dacă vrei poți adăuga și total pe lună etc.
    }

    return { totalPaid, totalUnpaid };
  }, [invoices]);

  return (
    <main className={styles.page}>
      {/* HEADER */}
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Facturile mele</h1>
          <p className={styles.subtitle}>
            Aici vezi facturile emise pentru comenzile tale din ArtFest.
          </p>
        </div>
      </header>

      {/* REZUMAT SIMPLU */}
      <section className={styles.summaryRow} aria-label="Situație facturi">
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Total plătit</span>
          <span className={styles.summaryValue}>
            {summary.totalPaid.toFixed(2)} RON
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Suma neplătită</span>
          <span className={styles.summaryValue}>
            {summary.totalUnpaid.toFixed(2)} RON
          </span>
        </div>
      </section>

      {/* FILTRE */}
      <section className={styles.filters} aria-label="Filtre facturi">
        <div className={styles.filterGroup}>
          <label htmlFor="statusFilter">Status</label>
          <select
            id="statusFilter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">Toate</option>
            <option value="UNPAID">Neplătite</option>
            <option value="OVERDUE">Scadente</option>
            <option value="PAID">Plătite</option>
            <option value="CANCELLED">Anulate</option>
          </select>
        </div>
      </section>

      {loading && <p className={styles.info}>Se încarcă facturile…</p>}
      {err && !loading && (
        <p className={styles.error} role="alert">
          {err}
        </p>
      )}

      {!loading && !err && (
        <section aria-label="Lista facturilor" className={styles.tableWrap}>
          {filteredInvoices.length === 0 ? (
            <p className={styles.info}>
              Nu există facturi pentru criteriile selectate.
            </p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Număr</th>
                  <th>Data</th>
                  <th>Comandă</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.number || inv.invoiceNumber || "-"}</td>
                    <td>{formatDate(inv.issueDate)}</td>
                    <td>{inv.orderNumber || inv.orderId || "-"}</td>
                    <td>
                      {(inv.totalGross || inv.total || 0).toFixed(2)}{" "}
                      {inv.currency || "RON"}
                    </td>
                    <td>
                      <span
                        className={`${styles.status} ${
                          styles[`status_${inv.status}`]
                        }`}
                      >
                        {STATUS_LABELS[inv.status] || inv.status}
                      </span>
                    </td>
                    <td>
                      {inv.downloadUrl && (
                        <a
                          href={inv.downloadUrl}
                          className={styles.linkBtn}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Descarcă PDF
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
