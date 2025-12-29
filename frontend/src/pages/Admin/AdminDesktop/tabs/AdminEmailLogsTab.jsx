// src/pages/Admin/AdminDesktop/tabs/AdminEmailLogsTab.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import styles from "../AdminDesktop.module.css";

const PAGE_SIZE = 25;

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

export default function AdminEmailLogsTab() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL"); // ALL|QUEUED|SENT|FAILED
  const [senderKey, setSenderKey] = useState("ALL"); // ALL|noreply|contact|admin
  const [template, setTemplate] = useState("ALL");

  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((total || 0) / PAGE_SIZE)),
    [total]
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        q: q || "",
        status,
        senderKey,
        template,
      });

      const d = await api(`/api/admin/email-logs?${params.toString()}`);
      setRows(d.logs || []);
      setTotal(d.total || 0);
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        "Nu am putut încărca email logs.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, senderKey, template]);

  return (
    <>
      <div className={styles.filtersRow}>
        <label>
          <span>Caută</span>
          <input
            type="text"
            placeholder="Email / subiect / template…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") load();
            }}
          />
        </label>

        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">Toate</option>
            <option value="QUEUED">QUEUED</option>
            <option value="SENT">SENT</option>
            <option value="FAILED">FAILED</option>
          </select>
        </label>

        <label>
          <span>Sender</span>
          <select
            value={senderKey}
            onChange={(e) => {
              setSenderKey(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">Toți</option>
            <option value="noreply">noreply</option>
            <option value="contact">contact</option>
            <option value="admin">admin</option>
          </select>
        </label>

        <label>
          <span>Template</span>
          <select
            value={template}
            onChange={(e) => {
              setTemplate(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">Toate</option>
            <option value="verify_email">verify_email</option>
            <option value="reset_password">reset_password</option>
            <option value="email_change_verify">email_change_verify</option>
            <option value="order_confirmation">order_confirmation</option>
            <option value="order_cancelled_vendor">order_cancelled_vendor</option>
            <option value="order_cancelled_user">order_cancelled_user</option>
            <option value="shipment_pickup">shipment_pickup</option>
            <option value="invoice_issued">invoice_issued</option>
            <option value="guest_support_confirmation">guest_support_confirmation</option>
            <option value="guest_support_reply">guest_support_reply</option>
            <option value="marketing">marketing</option>
            <option value="inactive_account_warning">inactive_account_warning</option>
            <option value="password_stale_reminder">password_stale_reminder</option>
            <option value="suspicious_login_warning">suspicious_login_warning</option>
            <option value="vendor_followup_reminder">vendor_followup_reminder</option>
            <option value="vendor_deactivate_confirm">vendor_deactivate_confirm</option>
          </select>
        </label>

        <div className={styles.filtersActions}>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => {
              setQ("");
              setStatus("ALL");
              setSenderKey("ALL");
              setTemplate("ALL");
              setPage(1);
              setTimeout(load, 0);
            }}
          >
            Reset
          </button>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => {
              setPage(1);
              load();
            }}
          >
            Caută
          </button>

          <span className={styles.filtersCount}>
            {loading ? "Se încarcă…" : `${total} rezultate`}
          </span>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {!rows.length ? (
        <p className={styles.subtle}>
          {loading ? "Se încarcă…" : "Nu există emailuri pentru aceste filtre."}
        </p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Dată</th>
                <th>To</th>
                <th>Sender</th>
                <th>Status</th>
                <th>Template</th>
                <th>Subiect</th>
                <th>User</th>
                <th>Eroare</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const userLabel = r.user?.email || (r.userId ? `${String(r.userId).slice(0, 8)}…` : "—");
                return (
                  <tr key={r.id}>
                    <td>{formatDate(r.createdAt)}</td>
                    <td>{r.toEmail}</td>
                    <td>{r.senderKey}</td>
                    <td>{r.status}</td>
                    <td>{r.template || "—"}</td>
                    <td
                      style={{
                        maxWidth: 420,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={r.subject}
                    >
                      {r.subject}
                    </td>
                    <td>{userLabel}</td>
                    <td
                      style={{
                        maxWidth: 360,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={r.error || ""}
                    >
                      {r.error || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <div className={styles.paginationInfo}>
            Pagina {page} din {totalPages} · {total} rezultate
          </div>
          <div className={styles.paginationControls}>
            <button
              type="button"
              className={styles.paginationBtn}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹ Înapoi
            </button>
            <button
              type="button"
              className={styles.paginationBtn}
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Înainte ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}
