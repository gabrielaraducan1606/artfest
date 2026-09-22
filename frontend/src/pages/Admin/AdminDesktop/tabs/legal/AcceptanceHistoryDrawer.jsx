import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../../../../lib/api.js";
import styles from "../../AdminDesktop.module.css";
import s from "./LegalDocumentsPanel.module.css";
import { audienceLabel } from "./legalDocumentsView.js";

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ro-RO");
}

const VIEWS = { VERSIONS: "VERSIONS", CAMPAIGNS: "CAMPAIGNS", ACCEPTANCES: "ACCEPTANCES" };

/*
 * "Istoric": versiunile publicate, cererile/publicările (cu acțiuni de
 * închidere și retrimitere email) și lista individuală a acceptărilor pe
 * versiune (cine a acceptat / cine nu). Doar citire, în afara celor două
 * acțiuni pe campanii.
 */
export default function AcceptanceHistoryDrawer({ row, onClose, onChanged }) {
  const catalogId = row.catalogId;
  const audience = row.audience;

  const [view, setView] = useState(VIEWS.VERSIONS);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState(null);

  const [version, setVersion] = useState(
    row.requirement?.version || row.published?.version || ""
  );
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [acceptances, setAcceptances] = useState(null);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api(
        `/api/admin/legal/documents/history?catalogId=${encodeURIComponent(catalogId)}&audience=${encodeURIComponent(audience)}`
      );
      setHistory(data);
      setError("");
    } catch (e) {
      setError(e?.message || "Nu am putut încărca istoricul.");
    }
  }, [catalogId, audience]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (view !== VIEWS.ACCEPTANCES || !version) return undefined;

    let cancelled = false;

    api(
      `/api/admin/legal/documents/acceptances?catalogId=${encodeURIComponent(catalogId)}&audience=${encodeURIComponent(audience)}&version=${encodeURIComponent(version)}&status=${status}&page=${page}`
    )
      .then((data) => {
        if (!cancelled) setAcceptances(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Nu am putut încărca acceptările.");
      });

    return () => {
      cancelled = true;
    };
  }, [view, catalogId, audience, version, status, page]);

  async function campaignAction(campaign, action) {
    setBusyId(`${action}:${campaign.campaignId}`);
    setError("");
    setMessage("");

    try {
      const result = await api(`/api/admin/legal/campaigns/${campaign.campaignId}/${action}`, {
        method: "POST",
      });

      if (action === "resend-email") {
        setMessage(
          `Email: ${result.sent ?? 0} trimise, ${result.failed ?? 0} eșuate, ${result.alreadySent ?? 0} deja trimise.`
        );
      } else {
        setMessage("Cererea a fost închisă; utilizatorii nu mai sunt obligați să accepte.");
      }

      await loadHistory();
      onChanged?.();
    } catch (e) {
      setError(e?.data?.message || e?.message || "Acțiunea a eșuat.");
    } finally {
      setBusyId(null);
    }
  }

  if (typeof document === "undefined") return null;

  const versions = (history?.policies || []).map((p) => p.version);
  const totalPages = acceptances ? Math.max(1, Math.ceil(acceptances.total / acceptances.pageSize)) : 1;

  return createPortal(
    <div className={styles.drawerOverlay} onClick={onClose} style={{ zIndex: 9998 }}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        aria-label="Istoric document"
        style={{ maxWidth: 820, width: "min(820px, 100%)" }}
      >
        <header className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>Istoric — {row.label}</h3>
            <p className={styles.drawerSub}>
              {audienceLabel(audience)} · <code>{row.key}</code>
            </p>
          </div>
          <button type="button" className={styles.drawerClose} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </header>

        <div className={styles.drawerBody}>
          <div className={s.tabs}>
            {[
              [VIEWS.VERSIONS, "Versiuni"],
              [VIEWS.CAMPAIGNS, "Cereri și publicări"],
              [VIEWS.ACCEPTANCES, "Acceptări"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${styles.paginationBtn} ${view === id ? styles.paginationBtnActive : ""}`}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {error && <div className={s.error}>{error}</div>}
          {message && <div className={s.notice}>{message}</div>}
          {!history && !error && <p className={styles.subtle}>Se încarcă…</p>}

          {history && view === VIEWS.VERSIONS && (
            <section className={styles.drawerSection}>
              <h4>Versiuni publicate</h4>
              {history.policies.length === 0 && (
                <p className={styles.subtle}>Nicio versiune publicată în baza de date încă.</p>
              )}
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Versiune</th>
                      <th>Activă</th>
                      <th>Publicată la</th>
                      <th>Acceptări</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.policies.map((p) => (
                      <tr key={p.version}>
                        <td>{p.version}</td>
                        <td>{p.isActive ? "Da" : "Nu"}</td>
                        <td>{formatDate(p.publishedAt)}</td>
                        <td>
                          {history.acceptancesByVersion.find((a) => a.version === p.version)?.count ?? 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {history && view === VIEWS.CAMPAIGNS && (
            <section className={styles.drawerSection}>
              <h4>Cereri de reacceptare și publicări</h4>
              {history.campaigns.length === 0 && <p className={styles.subtle}>Nimic înregistrat.</p>}
              {history.campaigns.map((c) => (
                <div key={c.campaignId} className={s.campaignRow}>
                  <div>
                    <strong>{c.type === "PUBLISH" ? "Publicare" : "Cerere de reacceptare"}</strong>{" "}
                    v{c.version}
                    {c.audience && <> · {audienceLabel(c.audience)}</>}
                    <div className={styles.subtle}>
                      {formatDate(c.createdAt)}
                      {c.type === "REQUEST" && (
                        <>
                          {" · "}
                          {c.requiresAction ? "obligatorie" : "informativă/închisă"}
                          {c.deadlineAt && <> · termen {formatDate(c.deadlineAt)}</>}
                          {" · "}vizați {c.targetCount ?? 0}, notificați {c.createdCount ?? 0}
                          {c.emailQueued !== null && c.emailQueued !== undefined && (
                            <>
                              {" · "}email: {c.emailQueued} de trimis, {c.emailFailed ?? 0} eșuate
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {c.type === "REQUEST" && (
                    <div className={s.actions}>
                      {c.emailQueued !== null && c.emailQueued !== undefined && (
                        <button
                          type="button"
                          className={s.btn}
                          disabled={busyId !== null}
                          onClick={() => campaignAction(c, "resend-email")}
                        >
                          {busyId === `resend-email:${c.campaignId}` ? "Se trimite…" : "Retrimite email eșuat"}
                        </button>
                      )}
                      {c.requiresAction && (
                        <button
                          type="button"
                          className={`${s.btn} ${s.btnDanger}`}
                          disabled={busyId !== null}
                          onClick={() => campaignAction(c, "close")}
                        >
                          Închide cererea
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {history && view === VIEWS.ACCEPTANCES && (
            <section className={styles.drawerSection}>
              <h4>Acceptări individuale</h4>

              <div className={styles.filtersRow}>
                <label>
                  <span>Versiune</span>
                  <select
                    value={version}
                    onChange={(e) => {
                      setVersion(e.target.value);
                      setPage(1);
                    }}
                  >
                    {[...new Set([version, ...versions].filter(Boolean))].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Stare</span>
                  <select
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="all">Toți</option>
                    <option value="accepted">Au acceptat</option>
                    <option value="pending">Nu au acceptat</option>
                  </select>
                </label>
              </div>

              {!acceptances && <p className={styles.subtle}>Se încarcă…</p>}

              {acceptances && (
                <>
                  <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Cont</th>
                          <th>Rol</th>
                          <th>Acceptat</th>
                          <th>Data</th>
                          <th>IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acceptances.items.map((item) => (
                          <tr key={`${item.userId}:${item.vendorId}`}>
                            <td>{item.name ? `${item.name} · ` : ""}{item.email || "—"}</td>
                            <td>{item.role}</td>
                            <td>{item.accepted ? "Da" : "Nu"}</td>
                            <td>{formatDate(item.acceptedAt)}</td>
                            <td>{item.ip || "—"}</td>
                          </tr>
                        ))}
                        {acceptances.items.length === 0 && (
                          <tr>
                            <td colSpan={5}>Niciun rezultat.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className={s.actions} style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className={s.btn}
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      ‹
                    </button>
                    <span className={styles.subtle}>
                      Pagina {page} / {totalPages} · {acceptances.total} conturi
                    </span>
                    <button
                      type="button"
                      className={s.btn}
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      ›
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}
