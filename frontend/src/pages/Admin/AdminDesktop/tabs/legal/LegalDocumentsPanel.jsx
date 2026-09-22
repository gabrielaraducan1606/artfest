import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../../../lib/api.js";
import styles from "../../AdminDesktop.module.css";
import s from "./LegalDocumentsPanel.module.css";
import AcceptanceHistoryDrawer from "./AcceptanceHistoryDrawer.jsx";
import PublishDialog from "./PublishDialog.jsx";
import ReacceptanceDialog from "./ReacceptanceDialog.jsx";
import {
  audienceLabel,
  canPublishRow,
  canRequestRow,
  formatDrafts,
  formatUnregistered,
  sortCatalogRows,
  statusLabel,
  statusTone,
  summarizeCatalog,
} from "./legalDocumentsView.js";

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ro-RO");
}

/*
 * Admin -> Politici / consimțăminte -> Documente juridice.
 *
 * Un rând per (document, audiență). "Publică versiunea" și "Cere
 * reacceptarea" sunt acțiuni SEPARATE: publicarea nu obligă pe nimeni;
 * doar cererea de reacceptare deschide gate-ul. Cookies apare informativ
 * (CookieConsent), fără acțiuni contractuale.
 */
export default function LegalDocumentsPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null); // { type, row }

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const data = await api("/api/admin/legal/documents");
      setRows(sortCatalogRows(data.rows || []));
      setError("");
    } catch (e) {
      setError(e?.data?.message || e?.message || "Nu am putut încărca documentele.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => summarizeCatalog(rows), [rows]);

  function finish(message) {
    setDialog(null);
    setNotice(message || "");
    load();
  }

  return (
    <section>
      <h3 className={styles.sectionTitle}>Documente juridice</h3>

      <p className={styles.subtle} style={{ marginTop: -6 }}>
        <strong>Publică versiunea</strong> face o versiune activă (pagina publică și conturile noi) fără să
        oblige pe cineva. <strong>Cere reacceptarea</strong> este acțiunea separată care le cere
        utilizatorilor existenți să accepte.
      </p>

      <div className={s.banner}>
        <span>
          Cereri deschise: <strong>{summary.open}</strong>
          {summary.overdue > 0 && <> (din care depășite: {summary.overdue})</>}
        </span>
        <span>Drafturi disponibile: <strong>{summary.drafts}</strong></span>
        <span>Nepublicate în DB: <strong>{summary.notPublished}</strong></span>
        <button type="button" className={s.btn} onClick={load} disabled={loading}>
          {loading ? "Se încarcă…" : "Reîncarcă"}
        </button>
      </div>

      {notice && <div className={s.notice}>{notice}</div>}
      {error && <div className={s.error}>{error}</div>}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Document</th>
              <th>Cheie</th>
              <th>Audiență</th>
              <th>Obligatoriu</th>
              <th>Versiune activă</th>
              <th>Draft disponibil</th>
              <th>Vizați</th>
              <th>Acceptat</th>
              <th>De reacceptat</th>
              <th>Ultima publicare</th>
              <th>Status</th>
              <th>Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const informational = row.informational === true;
              const unregistered = formatUnregistered(row);

              return (
                <tr key={row.rowId}>
                  <td>
                    <strong>{row.label}</strong>
                    {informational && <div className={s.key}>{row.note}</div>}
                  </td>
                  <td>
                    <code className={s.key}>{row.key}</code>
                  </td>
                  <td>{informational ? "—" : audienceLabel(row.audience)}</td>
                  <td>{row.required ? "Da" : "Nu"}</td>
                  <td>
                    {row.published?.version ? (
                      <>
                        {row.published.version}
                        {row.published.source === "manifest" && (
                          <div className={s.key}>din manifest (nepublicat în DB)</div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {formatDrafts(row)}
                    {unregistered && (
                      <div className={s.key} title="Există fișierul, dar versiunea nu e înregistrată în manifest">
                        fișiere neînregistrate: {unregistered}
                      </div>
                    )}
                  </td>

                  {informational ? (
                    <>
                      <td colSpan={3}>
                        {row.stats?.totalEvents ?? 0} evenimente CookieConsent
                        {row.stats?.lastConsentVersion && (
                          <div className={s.key}>ultima versiune: {row.stats.lastConsentVersion}</div>
                        )}
                      </td>
                      <td>{formatDate(row.stats?.lastEventAt)}</td>
                    </>
                  ) : (
                    <>
                      <td>{row.targetCount ?? 0}</td>
                      <td>{row.acceptedCount ?? 0}</td>
                      <td>{row.mustReacceptCount ?? 0}</td>
                      <td>{formatDate(row.lastPublishedAt)}</td>
                    </>
                  )}

                  <td>
                    <span className={`${s.badge} ${s[`tone_${statusTone(row.status)}`]}`}>
                      {statusLabel(row.status)}
                    </span>
                    {row.requirement?.deadlineAt && (
                      <div className={s.key}>termen {formatDate(row.requirement.deadlineAt)}</div>
                    )}
                  </td>

                  <td>
                    {informational ? (
                      <span className={s.key}>Fără reacceptare contractuală</span>
                    ) : (
                      <div className={s.actions}>
                        <button
                          type="button"
                          className={s.btn}
                          disabled={!canPublishRow(row)}
                          onClick={() => setDialog({ type: "publish", row })}
                        >
                          Publică versiunea
                        </button>
                        <button
                          type="button"
                          className={`${s.btn} ${s.btnPrimary}`}
                          disabled={!canRequestRow(row)}
                          title={
                            canRequestRow(row)
                              ? undefined
                              : "Publică mai întâi versiunea în baza de date"
                          }
                          onClick={() => setDialog({ type: "request", row })}
                        >
                          Cere reacceptarea
                        </button>
                        <button
                          type="button"
                          className={s.btn}
                          onClick={() => setDialog({ type: "history", row })}
                        >
                          Istoric
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}

            {!rows.length && !loading && (
              <tr>
                <td colSpan={12}>Niciun document.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {dialog?.type === "publish" && (
        <PublishDialog row={dialog.row} onClose={() => setDialog(null)} onDone={finish} />
      )}

      {dialog?.type === "request" && (
        <ReacceptanceDialog row={dialog.row} onClose={() => setDialog(null)} onDone={finish} />
      )}

      {dialog?.type === "history" && (
        <AcceptanceHistoryDrawer row={dialog.row} onClose={() => setDialog(null)} onChanged={load} />
      )}
    </section>
  );
}
