// src/pages/Admin/AdminDesktop/tabs/AdminReviewRequestsPanel.jsx
import { useEffect, useState } from "react";

import { api } from "../../../../lib/api";
import styles from "../css/AdminReviewRequestsPanel.module.css";
import { formatReviewDate as formatDate, reviewRequestPublicNotice } from "./reviewRequestNotice.js";

/*
 * Zona „Verificare solicitată de vendor” din tabul Produse: produsele cu
 * aiModeration.reviewRequest deschis (GET /api/admin/products?reviewRequested=1).
 * Separat de statusurile de moderare (PENDING / CHANGES_REQUESTED).
 * Acțiunile reutilizează fluxurile existente din AdminProductsTab
 * (fereastra de verificare, editarea, aprobarea, „Cere modificări”).
 */

export default function AdminReviewRequestsPanel({ refreshKey, workingProductId, onView, onEdit, onApprove, onRequestChanges }) {
  const [state, setState] = useState({ loading: true, items: [], error: "" });

  useEffect(() => {
    let alive = true;

    api("/api/admin/products?reviewRequested=1&take=100&sort=old")
      .then((data) => {
        if (!alive) return;
        const items = (Array.isArray(data?.items) ? data.items : [])
          .filter((p) => p.reviewRequest?.open)
          .sort((a, b) => new Date(a.reviewRequest.requestedAt) - new Date(b.reviewRequest.requestedAt));
        setState({ loading: false, items, error: "" });
      })
      .catch((e) => alive && setState({ loading: false, items: [], error: e?.message || "Nu am putut încărca solicitările." }));

    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (state.loading) return null;
  if (!state.items.length && !state.error) return null;

  return (
    <section className={styles.panel} aria-labelledby="admin-review-requests-title" data-admin-review-requests>
      <h3 id="admin-review-requests-title" className={styles.title}>
        Verificare solicitată de vendor <span className={styles.count}>{state.items.length}</span>
      </h3>
      <p className={styles.subtitle}>
        Vânzătorii au cerut voluntar ajutorul echipei Artfest pentru configurarea acestor produse.
      </p>

      {state.error ? <p className={styles.error}>{state.error}</p> : null}

      <ul className={styles.list}>
        {state.items.map((p) => {
          const image = Array.isArray(p.images) && p.images.length ? p.images[0] : "";
          const working = workingProductId === p.id;

          return (
            <li key={p.id} className={styles.card} data-review-request-row={p.id}>
              <div className={styles.thumbWrap}>
                {image ? (
                  <img src={image} alt={p.title || "Produs"} className={styles.thumb} />
                ) : (
                  <div className={styles.thumbPlaceholder}>Fără poză</div>
                )}
              </div>

              <div className={styles.body}>
                <div className={styles.productTitle}>{p.title || "Fără titlu"}</div>
                <div className={styles.meta}>
                  {p.vendor?.displayName || p.service?.displayName || "—"} · solicitat {formatDate(p.reviewRequest.requestedAt)}
                </div>
                {reviewRequestPublicNotice(p) ? (
                  <p className={styles.publicNotice} data-review-public-notice>
                    {reviewRequestPublicNotice(p)}
                  </p>
                ) : null}
                <p className={styles.note}>
                  {p.reviewRequest.note ? `„${p.reviewRequest.note}”` : "Vânzătorul nu a lăsat un mesaj."}
                </p>

                <div className={styles.actions}>
                  <button type="button" className={styles.btn} onClick={() => onView(p)}>
                    Vezi produsul
                  </button>
                  <button type="button" className={styles.btn} onClick={() => onEdit(p)}>
                    Editează produsul
                  </button>
                  <button type="button" className={styles.approve} disabled={working} onClick={() => onApprove(p)}>
                    {working ? "Se procesează..." : "Aprobă"}
                  </button>
                  <button type="button" className={styles.warn} disabled={working} onClick={() => onRequestChanges(p)}>
                    Cere modificări
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
