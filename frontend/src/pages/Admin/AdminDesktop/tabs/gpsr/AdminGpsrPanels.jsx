// Evidența GPSR în Admin (doar consultare):
//   AdminGpsrProductPanel  - Admin → Produse, „Conformitate GPSR”
//   AdminGpsrVendorPanel   - Admin → Vânzători, „Informări și confirmări GPSR”
//   AdminGpsrNoticeVersions - Admin → Politici, versiunile informării GPSR
// Etichetele arată DOAR existența declarației vânzătorului - nu o certificare.
import { useCallback, useEffect, useState } from "react";

import { api } from "../../../../../lib/api";
import { GPSR_STATUS_TONE, formatGpsrDate, gpsrSourceLabel } from "./adminGpsrView.js";
import styles from "./AdminGpsrPanels.module.css";

function useAdminFetch(url) {
  const [state, setState] = useState({ status: url ? "loading" : "idle", data: null });
  const load = useCallback(async () => {
    if (!url) return;
    setState({ status: "loading", data: null });
    try {
      setState({ status: "ready", data: await api(url) });
    } catch {
      setState({ status: "error", data: null });
    }
  }, [url]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

function StatusBadge({ status, label }) {
  return (
    <span className={`${styles.badge} ${styles[GPSR_STATUS_TONE[status] || "neutral"]}`} data-testid="gpsr-status-badge">
      {label}
    </span>
  );
}

function Who({ person }) {
  if (!person) return "—";
  return [person.name, person.email].filter(Boolean).join(" · ") || person.id || "—";
}

function LoadState({ state, onRetry }) {
  if (state.status === "loading") return <p className={styles.muted}>Se încarcă evidența GPSR…</p>;
  if (state.status === "error")
    return (
      <p className={styles.error}>
        Nu am putut încărca evidența GPSR.{" "}
        <button type="button" className={styles.link} onClick={onRetry}>
          Reîncearcă
        </button>
      </p>
    );
  return null;
}

export function AdminGpsrProductPanel({ productId }) {
  const state = useAdminFetch(productId ? `/api/admin/gpsr/products/${encodeURIComponent(productId)}` : null);
  const g = state.data?.gpsr;

  return (
    <div className={styles.panel} data-testid="admin-gpsr-product">
      <div className={styles.headRow}>
        <strong>Conformitate GPSR</strong>
        {g ? <StatusBadge status={g.status} label={g.label} /> : null}
      </div>
      {!g ? (
        <LoadState state={state} onRetry={state.reload} />
      ) : (
        <>
          <dl className={styles.grid}>
            <dt>Informații GPSR</dt>
            <dd>{g.complete ? "Completate" : "Incomplete"}</dd>
            <dt>Declarația vânzătorului</dt>
            <dd>{g.latest ? "Înregistrată" : "Lipsă"}</dd>
            <dt>Versiune confirmată</dt>
            <dd>
              {g.latest?.noticeVersion || "—"}
              {g.latest && g.latest.noticeVersion !== g.currentNoticeVersion ? ` (curentă: ${g.currentNoticeVersion})` : ""}
            </dd>
            <dt>Data confirmării</dt>
            <dd>{formatGpsrDate(g.latest?.createdAt)}</dd>
            <dt>Cont care a confirmat</dt>
            <dd>
              <Who person={g.latest?.confirmedBy} />
            </dd>
            <dt>Reconfirmare</dt>
            <dd>{g.reconfirmReasons?.length ? `Necesară: ${g.reconfirmReasons.join(", ")}` : "Nu este necesară"}</dd>
            <dt>Solicitare ajutor</dt>
            <dd>
              {g.helpRequest ? "Deschisă pentru acest produs" : "—"}
              {g.vendorGpsrTickets?.length ? ` · ${g.vendorGpsrTickets.length} tichet(e) GPSR ale vânzătorului` : ""}
            </dd>
          </dl>

          {g.status === "UNRECORDED" && (
            <p className={styles.muted}>Produs existent, creat înainte de evidența declarațiilor. Nu a fost marcat confirmat.</p>
          )}

          {g.history?.length > 1 && (
            <details className={styles.details}>
              <summary>Istoric confirmări ({g.history.length})</summary>
              <ul className={styles.list}>
                {g.history.map((d) => (
                  <li key={d.id}>
                    {formatGpsrDate(d.createdAt)} · {d.noticeVersion} · <Who person={d.confirmedBy} /> · {gpsrSourceLabel(d.source)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {g.vendorGpsrTickets?.length > 0 && (
            <ul className={styles.list}>
              {g.vendorGpsrTickets.slice(0, 3).map((t) => (
                <li key={t.id}>
                  <a href={t.link}>Tichet GPSR din {formatGpsrDate(t.createdAt)}</a> · {t.status}
                </li>
              ))}
            </ul>
          )}

          <p className={styles.note}>{g.note}</p>
        </>
      )}
    </div>
  );
}

export function AdminGpsrVendorPanel({ vendorId }) {
  const state = useAdminFetch(vendorId ? `/api/admin/gpsr/vendors/${encodeURIComponent(vendorId)}` : null);
  const g = state.data?.gpsr;

  return (
    <div className={styles.panel} data-testid="admin-gpsr-vendor">
      {!g ? (
        <LoadState state={state} onRetry={state.reload} />
      ) : (
        <>
          <dl className={styles.grid}>
            <dt>Ultima versiune confirmată</dt>
            <dd>{g.latestNoticeVersion || "—"}</dd>
            <dt>Data</dt>
            <dd>{formatGpsrDate(g.latestConfirmedAt)}</dd>
            <dt>Produse cu declarație</dt>
            <dd>{g.productsWithDeclaration}</dd>
            <dt>Confirmare înregistrată</dt>
            <dd>{g.counts?.VALID ?? 0}</dd>
            <dt>Confirmare lipsă / neînregistrată</dt>
            <dd>{(g.counts?.MISSING ?? 0) + (g.counts?.UNRECORDED ?? 0)}</dd>
            <dt>Reconfirmare necesară</dt>
            <dd>{g.counts?.RECONFIRM ?? 0}</dd>
            <dt>Informații incomplete</dt>
            <dd>{g.counts?.INCOMPLETE ?? 0}</dd>
          </dl>

          {g.attention?.length > 0 && (
            <details className={styles.details}>
              <summary>Produse care cer atenție ({g.attention.length})</summary>
              <ul className={styles.list}>
                {g.attention.slice(0, 50).map((p) => (
                  <li key={p.productId}>
                    <a href={p.link}>{p.title || p.productId}</a> · <StatusBadge status={p.status} label={p.label} />
                    {p.reasons?.length ? ` · ${p.reasons.join(", ")}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {g.history?.length > 0 && (
            <details className={styles.details}>
              <summary>Istoric confirmări ({g.history.length})</summary>
              <ul className={styles.list}>
                {g.history.map((d) => (
                  <li key={d.id}>
                    {formatGpsrDate(d.createdAt)} · {d.productTitle || d.productId} · {d.noticeVersion} · <Who person={d.confirmedBy} />
                  </li>
                ))}
              </ul>
            </details>
          )}

          <p className={styles.muted}>
            Solicitări GPSR trimise către Artfest: {g.gpsrTickets?.length || 0}
            {g.gpsrTickets?.[0] ? (
              <>
                {" "}
                · <a href={g.gpsrTickets[0].link}>ultima ({formatGpsrDate(g.gpsrTickets[0].createdAt)})</a>
              </>
            ) : null}
          </p>
          <p className={styles.note}>Declarațiile vânzătorului nu reprezintă o certificare a conformității produselor.</p>
        </>
      )}
    </div>
  );
}

export function AdminGpsrNoticeVersions() {
  const state = useAdminFetch("/api/admin/gpsr/notice-versions");
  const versions = state.data?.versions || [];

  return (
    <section className={styles.panel} data-testid="admin-gpsr-versions">
      <div className={styles.headRow}>
        <strong>Informarea GPSR pentru vânzători</strong>
        <span className={styles.muted}>doar consultare</span>
      </div>
      {!versions.length ? (
        <LoadState state={state} onRetry={state.reload} />
      ) : (
        <>
          <p className={styles.muted}>
            Textele sunt versionate în cod și nu se modifică retroactiv. O versiune nouă cere reconfirmare doar la
            următoarea publicare sau modificare relevantă a fiecărui produs; nu se trimit notificări automate.
          </p>
          <ul className={styles.list}>
            {versions.map((v) => (
              <li key={v.id}>
                <details className={styles.details}>
                  <summary>
                    {v.id} · {v.publishedAt} {v.current ? <span className={`${styles.badge} ${styles.ok}`}>curentă</span> : null}
                  </summary>
                  <p className={styles.mono}>sha256: {v.hash}</p>
                  <p>{v.summary}</p>
                  <ol>
                    {v.points.map((p) => (
                      <li key={p.key}>
                        <strong>{p.title}.</strong> {p.text}
                      </li>
                    ))}
                  </ol>
                  <p>
                    <strong>Textul declarației:</strong> {v.confirmationText}
                  </p>
                  <p className={styles.muted}>{v.disclaimer}</p>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
