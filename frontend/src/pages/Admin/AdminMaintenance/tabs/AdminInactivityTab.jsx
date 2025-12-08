import styles from "../AdminMaintenancePage.module.css";
import { useState, useMemo } from "react";

// helper de formatat dată – local pentru acest tab
function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

/**
 * Tabul "Inactivitate conturi"
 */
export default function AdminInactivityTab({
  loading,
  actionLoading,
  previewItems,
  config,
  warningLogs,
  error,
  message,
  onReloadAll,
  onSendWarnings,
  onRunCleanup,
}) {
  // Filtru local pe status avertizare
  const [filterStatus, setFilterStatus] = useState("ALL"); // ALL | NO_WARNING | WARNING_SENT | SCHEDULED

  const { filteredPreviewItems, totalPreview, filteredTotal } = useMemo(() => {
    const total = previewItems.length;

    const filtered = previewItems.filter((u) => {
      if (filterStatus === "ALL") return true;

      const hasWarning = !!u.inactiveNotifiedAt;
      const hasScheduled = !!u.scheduledDeletionAt;

      if (filterStatus === "NO_WARNING") {
        return !hasWarning && !hasScheduled;
      }
      if (filterStatus === "WARNING_SENT") {
        return hasWarning && !hasScheduled;
      }
      if (filterStatus === "SCHEDULED") {
        return hasScheduled;
      }
      return true;
    });

    return {
      filteredPreviewItems: filtered,
      totalPreview: total,
      filteredTotal: filtered.length,
    };
  }, [previewItems, filterStatus]);

  return (
    <div className={styles.maintenanceWrapper}>
      {/* Politică inactivitate */}
      <section className={styles.drawerSection}>
        <h4>Politică de inactivitate conturi</h4>
        <p className={styles.subtle}>
          În acest tab poți gestiona conturile care nu au mai fost folosite de
          o perioadă lungă de timp.
        </p>
        <p className={styles.subtle}>
          <b>Regulă actuală (din backend):</b>{" "}
          Conturile <b>fără comenzi</b>, care nu au mai fost folosite de{" "}
          <b>{config.inactivityMonths ?? "…"}</b> luni (de ex. 12 luni), devin
          eligibile pentru ștergere. Înainte de ștergere, trimitem un email de
          avertizare cu <b>{config.warningDays ?? "…"}</b> zile înainte.
        </p>
      </section>

      {/* Acțiuni */}
      <section className={styles.drawerSection}>
        <h4>Acțiuni asupra conturilor inactive</h4>
        <div className={styles.drawerActions}>
          <button
            type="button"
            className={styles.adminActionBtn}
            onClick={onReloadAll}
            disabled={loading || actionLoading}
          >
            Reîncarcă date (conturi + log emailuri)
          </button>

          <button
            type="button"
            className={styles.adminActionBtn}
            onClick={onSendWarnings}
            disabled={loading || actionLoading || !totalPreview}
            title={
              totalPreview
                ? "Trimite emailuri de avertizare către conturile eligibile"
                : "Nu există conturi eligibile pentru avertizare"
            }
          >
            Trimite email-uri de avertizare
          </button>

          <button
            type="button"
            className={styles.adminActionBtnDanger}
            onClick={onRunCleanup}
            disabled={loading || actionLoading}
          >
            Rulează curățare acum
          </button>
        </div>

        {loading && (
          <p className={styles.subtle}>
            Se încarcă lista de conturi inactive…
          </p>
        )}
        {error && <p className={styles.actionError}>{error}</p>}
        {message && <p className={styles.actionSuccess}>{message}</p>}
      </section>

      {/* Lista conturi inactive */}
      <section className={styles.drawerSection}>
        <h4>Conturi inactive eligibile pentru ștergere</h4>

        <div
          style={{
            display: "flex",
            gap: "12px",
            alignItems: "center",
            marginBottom: "8px",
            flexWrap: "wrap",
          }}
        >
          <p className={styles.subtle} style={{ margin: 0 }}>
            {totalPreview
              ? `Sunt ${totalPreview} conturi inactive eligibile.`
              : "Nu există conturi inactive eligibile în acest moment."}
          </p>

          {totalPreview > 0 && (
            <label
              className={styles.subtle}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <span>Filtru după status avertizare:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="ALL">Toate</option>
                <option value="NO_WARNING">Fără avertizare trimisă</option>
                <option value="WARNING_SENT">Avertizare trimisă</option>
                <option value="SCHEDULED">Ștergere programată</option>
              </select>
            </label>
          )}

          {totalPreview > 0 && (
            <span className={styles.subtle}>
              Afișate după filtru: <b>{filteredTotal}</b>
            </span>
          )}
        </div>

        {filteredTotal > 0 && (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Creat la</th>
                  <th>Ultima activitate</th>
                  <th>Luni inactiv</th>
                  <th>Avertizat la</th>
                  <th>Ștergere programată la</th>
                </tr>
              </thead>
              <tbody>
                {filteredPreviewItems.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <code>{u.id}</code>
                    </td>
                    <td>{u.email || "—"}</td>
                    <td>{formatDate(u.createdAt)}</td>
                    <td>
                      {u.lastLoginAt
                        ? formatDate(u.lastLoginAt)
                        : "Niciodată / doar signup"}
                    </td>
                    <td>{u.monthsInactive}</td>
                    <td>
                      {u.inactiveNotifiedAt
                        ? formatDate(u.inactiveNotifiedAt)
                        : "—"}
                    </td>
                    <td>
                      {u.scheduledDeletionAt
                        ? formatDate(u.scheduledDeletionAt)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Istoric emailuri de avertizare */}
      <section className={styles.drawerSection}>
        <h4>Istoric email-uri de avertizare (inactivitate)</h4>
        <p className={styles.subtle}>
          Aici vezi toate emailurile de avertizare trimise automat sau manual
          pentru conturile inactive.
        </p>

        {warningLogs.length === 0 ? (
          <p className={styles.subtle}>
            Nu există încă înregistrări în logul de avertizări.
          </p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID log</th>
                  <th>User ID</th>
                  <th>Email</th>
                  <th>Trimis la</th>
                  <th>Status</th>
                  <th>Mesaj eroare</th>
                </tr>
              </thead>
              <tbody>
                {warningLogs.map((log) => (
                  <tr key={log.id}>
                    <td>
                      <code>{log.id}</code>
                    </td>
                    <td>{log.userId ? <code>{log.userId}</code> : "—"}</td>
                    <td>{log.email || "—"}</td>
                    <td>{log.sentAt ? formatDate(log.sentAt) : "—"}</td>
                    <td>{log.status || "—"}</td>
                    <td>{log.errorMessage || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
