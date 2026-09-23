// src/pages/Admin/AdminDesktop/tabs/AdminWithdrawalsTab.jsx
//
// Vizibilitate MINIMĂ pentru Admin asupra declarațiilor de retragere
// din contract (audit "Retragere din contract" 2026-09-23) - listă
// simplă, read-only, fără filtre/workflow (cerut explicit, "nu e
// nevoie de workflow complex acum"). Reutilizează GET /api/admin/withdrawals,
// deja fără efecte secundare.

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import styles from "../AdminDesktop.module.css";

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

const STATUS_LABEL = {
  SUBMITTED: "Transmisă",
  FORWARDED_TO_VENDOR: "Transmisă vânzătorului",
  CLOSED: "Procesată",
};

export default function AdminWithdrawalsTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError("");

      try {
        const res = await api("/api/admin/withdrawals");
        if (!alive) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Nu am putut încărca cererile de retragere.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <p className={styles.subtle} style={{ marginBottom: 12 }}>
        Declarații de retragere din contract transmise de clienți - STRICT
        informativ (nu modifică nimic pe comandă). Procesarea efectivă se
        face de vendor, pe pagina fiecărei comenzi.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {!items.length ? (
        <p className={styles.subtle}>
          {loading ? "Se încarcă…" : "Nu există cereri de retragere."}
        </p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Comandă</th>
                <th>Client</th>
                <th>Vendor(i)</th>
                <th>Acoperă</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDate(item.submittedAt)}</td>
                  <td>#{item.orderNumber || item.orderId}</td>
                  <td>
                    {item.clientName || "—"}
                    {item.contactEmail ? ` (${item.contactEmail})` : ""}
                  </td>
                  <td>{item.vendorNames?.join(", ") || "—"}</td>
                  <td>
                    {item.coversWholeOrder
                      ? "întreaga comandă"
                      : "livrare parțială"}
                  </td>
                  <td>{STATUS_LABEL[item.status] || item.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
