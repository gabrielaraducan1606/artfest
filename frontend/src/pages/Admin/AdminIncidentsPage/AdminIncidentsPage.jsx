import React, { useEffect, useMemo, useState } from "react";
import styles from "./AdminIncidentsPage.module.css";
import {
  ackIncident,
  fetchIncidents,
  archiveIncident,
  unarchiveIncident,
  deleteIncident,
  addIncidentNote,
} from "../../../lib/monitorApi.js";

function formatTs(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("ro-RO");
  } catch {
    return String(ts);
  }
}

function badgeClass(statusCode) {
  if (statusCode >= 500) return `${styles.badge} ${styles.badge5xx}`;
  if (statusCode >= 400) return `${styles.badge} ${styles.badge4xx}`;
  return styles.badge;
}

export default function RouteIncidentsPage() {
  const [ack, setAck] = useState("0");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(50);

  const [view, setView] = useState("active");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshSec, setRefreshSec] = useState(15);

  const filters = useMemo(() => {
    const archived = view === "archived" ? "1" : "0";
    const deleted = view === "deleted" ? "1" : "0";
    return { ack, status, limit, archived, deleted };
  }, [ack, status, limit, view]);

  async function loadFirstPage() {
    setLoading(true);
    setErr("");
    try {
      const data = await fetchIncidents({
        ...filters,
        cursor: null,
        includeNotes: true,
      });
      setItems(Array.isArray(data?.items) ? data.items : []);
      setNextCursor(data?.nextCursor || null);
    } catch (e) {
      setErr(e?.message || "Eroare la încărcare.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    setErr("");
    try {
      const data = await fetchIncidents({
        ...filters,
        cursor: nextCursor,
        includeNotes: true,
      });
      const more = Array.isArray(data?.items) ? data.items : [];
      setItems((prev) => [...prev, ...more]);
      setNextCursor(data?.nextCursor || null);
    } catch (e) {
      setErr(e?.message || "Eroare la încărcare.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ack, status, limit, view]);

  useEffect(() => {
    if (!autoRefresh) return;
    if (view !== "active") return;

    const ms = Math.max(5, Number(refreshSec) || 15) * 1000;
    const t = setInterval(() => loadFirstPage(), ms);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, refreshSec, ack, status, limit, view]);

  async function onAck(id) {
    const by = window.prompt("Acknowledge by (nume/email):", "admin");
    if (by === null) return;
    try {
      await ackIncident(id, by || "admin");
      await loadFirstPage();
    } catch (e) {
      alert(e?.message || "Nu am putut face acknowledge.");
    }
  }

  async function onArchive(id) {
    const by = window.prompt("Archive by (nume/email):", "admin");
    if (by === null) return;
    try {
      await archiveIncident(id, by || "admin");
      await loadFirstPage();
    } catch (e) {
      alert(e?.message || "Nu am putut arhiva.");
    }
  }

  async function onUnarchive(id) {
    try {
      await unarchiveIncident(id);
      await loadFirstPage();
    } catch (e) {
      alert(e?.message || "Nu am putut scoate din arhivă.");
    }
  }

  async function onDelete(id) {
    const ok = window.confirm("Sigur vrei să ștergi (soft delete) acest incident?");
    if (!ok) return;
    const by = window.prompt("Delete by (nume/email):", "admin");
    if (by === null) return;

    try {
      await deleteIncident(id, by || "admin");
      await loadFirstPage();
    } catch (e) {
      alert(e?.message || "Nu am putut șterge.");
    }
  }

  async function onAddNote(id) {
    const by = window.prompt("Note by (nume/email):", "admin");
    if (by === null) return;
    const note = window.prompt("Notiță:", "");
    if (note === null) return;

    try {
      await addIncidentNote(id, by || "admin", note);
      await loadFirstPage();
    } catch (e) {
      alert(e?.message || "Nu am putut salva notița.");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Monitorizare erori (Route Incidents)</h2>
          <div className={styles.sub}>Active / Archived / Deleted + notițe + paginare.</div>
        </div>

        <button className={styles.btn} onClick={loadFirstPage} disabled={loading}>
          {loading ? "Se încarcă..." : "Refresh"}
        </button>
      </div>

      <div className={styles.tabs}>
        {[
          ["active", "Active"],
          ["archived", "Archived"],
          ["deleted", "Deleted"],
        ].map(([k, label]) => (
          <button
            key={k}
            className={`${styles.tab} ${view === k ? styles.tabActive : ""}`}
            onClick={() => setView(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.card}>
        <div className={styles.filters}>
          <div className={styles.field}>
            <label>Ack</label>
            <select className={styles.select} value={ack} onChange={(e) => setAck(e.target.value)}>
              <option value="0">Ne-acknowledged</option>
              <option value="1">Acknowledged</option>
              <option value="">Toate</option>
            </select>
          </div>

          <div className={styles.field}>
            <label>Status code</label>
            <input
              className={styles.input}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="ex: 500"
            />
          </div>

          <div className={styles.field}>
            <label>Limit / pagină</label>
            <select className={styles.select} value={limit} onChange={(e) => setLimit(parseInt(e.target.value, 10))}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>

          <div className={`${styles.field} ${styles.span2}`}>
            <label>Auto refresh (doar Active)</label>
            <div className={styles.autoRow}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              <span>activ</span>
              <input
                className={styles.input}
                style={{ width: 120 }}
                value={refreshSec}
                onChange={(e) => setRefreshSec(e.target.value)}
                type="number"
                min={5}
              />
              <span>sec</span>
            </div>
          </div>

          <div className={styles.count}>
            Afișate: <b>{items.length}</b>
          </div>
        </div>
      </div>

      {err ? <div className={styles.err}>{err}</div> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Data</th>
              <th>Status</th>
              <th>Method</th>
              <th>Path</th>
              <th>Mesaj + Notes</th>
              <th>Durată</th>
              <th>Ack</th>
              <th className={styles.thRight}>Acțiuni</th>
            </tr>
          </thead>

          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td className={styles.nowrap}>{formatTs(it.createdAt)}</td>

                <td>
                  <span className={badgeClass(it.statusCode || 0)}>{it.statusCode || "-"}</span>
                </td>

                <td>{it.method || "-"}</td>

                <td>
                  <div className={styles.path}>{it.path || "-"}</div>
                  {it.query ? <div className={styles.meta}>query: <code>{JSON.stringify(it.query)}</code></div> : null}
                </td>

                <td>
                  {it.message ? <div style={{ fontWeight: 600 }}>{it.message}</div> : <div className={styles.meta}>—</div>}
                  {it.code ? <div className={styles.meta}>code: <code>{it.code}</code></div> : null}

                  {Array.isArray(it.notes) && it.notes.length ? (
                    <details className={styles.notes}>
                      <summary className={styles.summary}>notes ({it.notes.length})</summary>
                      <div>
                        {it.notes.map((n) => (
                          <div key={n.id} className={styles.noteItem}>
                            <div className={styles.noteMeta}>
                              {formatTs(n.createdAt)} {n.by ? `• ${n.by}` : ""}
                            </div>
                            <div className={styles.noteText}>{n.note}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}

                  {it.stack ? (
                    <details className={styles.details}>
                      <summary className={styles.summary}>stack</summary>
                      <pre className={styles.pre}>{it.stack}</pre>
                    </details>
                  ) : null}
                </td>

                <td className={styles.nowrap}>{typeof it.durationMs === "number" ? `${it.durationMs} ms` : "—"}</td>

                <td className={styles.nowrap}>
                  {it.acknowledgedAt ? (
                    <div>
                      <div className={styles.meta}>{formatTs(it.acknowledgedAt)}</div>
                      <div className={styles.meta}>{it.acknowledgedBy || ""}</div>
                    </div>
                  ) : (
                    <span className={styles.badge}>New</span>
                  )}
                </td>

                <td>
                  <div className={styles.actions}>
                    {!it.acknowledgedAt ? (
                      <button className={styles.btn} onClick={() => onAck(it.id)}>Ack</button>
                    ) : null}

                    <button className={styles.btn} onClick={() => onAddNote(it.id)}>Add note</button>

                    {view === "archived" ? (
                      <button className={styles.btn} onClick={() => onUnarchive(it.id)}>Unarchive</button>
                    ) : view !== "deleted" ? (
                      <button className={styles.btn} onClick={() => onArchive(it.id)}>Archive</button>
                    ) : null}

                    {view !== "deleted" ? (
                      <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => onDelete(it.id)}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}

            {!items.length && !loading ? (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  Niciun incident (pentru filtrele curente).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        {nextCursor ? (
          <button className={styles.btn} onClick={loadMore} disabled={loading}>
            {loading ? "Se încarcă..." : "Load more"}
          </button>
        ) : (
          <div className={styles.meta}>—</div>
        )}
      </div>
    </div>
  );
}
