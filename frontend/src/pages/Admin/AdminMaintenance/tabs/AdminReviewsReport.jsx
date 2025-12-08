// src/admin/maintenance/AdminReviewReportsTab.jsx
import { useEffect, useState } from "react";
import { FaFlag, FaExternalLinkAlt } from "react-icons/fa";
import styles from "../AdminMaintenancePage.module.css";

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

function truncate(str, max = 120) {
  if (!str) return "—";
  const s = String(str);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function kindLabel(kind) {
  switch (kind) {
    case "product":
      return "Recenzie produs";
    case "store":
      return "Recenzie profil magazin";
    default:
      return kind || "—";
  }
}

function roleLabel(role) {
  if (!role) return "—";
  switch (role) {
    case "VENDOR":
      return "Vânzător";
    case "USER":
    case "CUSTOMER":
      return "Client";
    case "ADMIN":
      return "Admin";
    default:
      return role;
  }
}

function statusLabel(status) {
  if (!status) return "—";
  switch (status) {
    case "PENDING":
      return "În așteptare";
    case "APPROVED":
      return "Aprobată";
    case "REJECTED":
      return "Respinsă / ascunsă";
    case "HIDDEN":
      return "Ascunsă";
    case "DELETED":
      return "Ștearsă";
    default:
      return status;
  }
}

function editedInfo(review) {
  if (!review) return "—";
  const created = review.createdAt ? new Date(review.createdAt) : null;
  const updated = review.updatedAt ? new Date(review.updatedAt) : null;

  if (!created || !updated) {
    return `Creată: ${formatDate(review.createdAt)}`;
  }

  // dacă updated == created → o afișăm ca „Creată”
  if (updated.getTime() <= created.getTime()) {
    return `Creată: ${formatDate(review.createdAt)}`;
  }

  return `Editată: ${formatDate(review.updatedAt)}`;
}

export default function AdminReviewReportsTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // lista combinată (produs + profil)
  const [items, setItems] = useState([]);

  // totaluri generale
  const [totalAll, setTotalAll] = useState(0);
  const [recentAll, setRecentAll] = useState(0);

  // totaluri pe tip (produs / profil)
  const [totalByKind, setTotalByKind] = useState({
    product: 0,
    store: 0,
  });
  const [recentByKind, setRecentByKind] = useState({
    product: 0,
    store: 0,
  });

  // selecție pt panoul de detalii
  const [selected, setSelected] = useState(null); // { kind, reviewId, reportId }
  const [editLogs, setEditLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

  // acțiuni admin
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");
      setSelected(null);
      setEditLogs([]);
      setLogsError("");
      setActionError("");

      const [resProd, resStore] = await Promise.all([
        fetch("/api/admin/maintenance/review-reports?take=200&days=30"),
        fetch("/api/admin/maintenance/store-review-reports?take=200&days=30"),
      ]);

      if (!resProd.ok) {
        throw new Error("Nu am putut încărca raportările de recenzii de produs.");
      }
      if (!resStore.ok) {
        throw new Error("Nu am putut încărca raportările de recenzii de profil.");
      }

      const dataProd = await resProd.json();
      const dataStore = await resStore.json();

      const prodItems = (dataProd.items || []).map((it) => ({
        ...it,
        _kind: "product",
      }));
      const storeItems = (dataStore.items || []).map((it) => ({
        ...it,
        _kind: "store",
      }));

      const merged = [...prodItems, ...storeItems].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      setItems(merged);

      const totalProduct = dataProd.total || 0;
      const totalStore = dataStore.total || 0;
      const recentProduct = dataProd.recentCount || 0;
      const recentStore = dataStore.recentCount || 0;

      setTotalAll(totalProduct + totalStore);
      setRecentAll(recentProduct + recentStore);

      setTotalByKind({
        product: totalProduct,
        store: totalStore,
      });
      setRecentByKind({
        product: recentProduct,
        store: recentStore,
      });
    } catch (e) {
      console.error(e);
      setError(e.message || "A apărut o eroare la încărcarea raportărilor.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // când selectăm o recenzie, încărcăm istoricul de editări
  useEffect(() => {
    async function loadLogs(sel) {
      if (!sel) {
        setEditLogs([]);
        setLogsError("");
        return;
      }

      try {
        setLogsLoading(true);
        setLogsError("");

        const base =
          sel.kind === "product"
            ? "/api/admin/maintenance/product-reviews"
            : "/api/admin/maintenance/store-reviews";

        const res = await fetch(`${base}/${sel.reviewId}/edit-logs`);
        if (!res.ok) {
          throw new Error("Nu am putut încărca istoricul de editări.");
        }
        const data = await res.json();
        setEditLogs(data.items || []);
      } catch (e) {
        console.error(e);
        setLogsError(e.message || "Eroare la încărcarea istoricului de editări.");
        setEditLogs([]);
      } finally {
        setLogsLoading(false);
      }
    }

    loadLogs(selected);
  }, [selected]);

  const hasItems = items && items.length > 0;

  function handleSelect(row) {
    if (!row?.review?.id) return;

    if (selected && selected.reviewId === row.review.id) {
      // toggle: dacă e deja selectată, o ascundem
      setSelected(null);
      setEditLogs([]);
      setLogsError("");
      setActionError("");
      return;
    }

    setSelected({
      kind: row._kind, // "product" sau "store"
      reviewId: row.review.id,
      reportId: row.id,
    });
    setActionError("");
  }

  async function handleHideReview() {
    if (!selected) return;
    try {
      setActionLoading(true);
      setActionError("");

      const base =
        selected.kind === "product"
          ? "/api/admin/maintenance/product-reviews"
          : "/api/admin/maintenance/store-reviews";

      const res = await fetch(`${base}/${selected.reviewId}/hide`, {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Nu am putut ascunde recenzia.");
      }

      const data = await res.json();
      const updatedReview = data.review;

      setItems((prev) =>
        prev.map((r) => {
          if (r.review?.id !== selected.reviewId) return r;
          return {
            ...r,
            review: {
              ...r.review,
              status: updatedReview.status,
              updatedAt: updatedReview.updatedAt,
            },
          };
        })
      );
    } catch (e) {
      console.error(e);
      setActionError(e.message || "Eroare la ascunderea recenziei.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteReview() {
    if (!selected) return;
    const ok = window.confirm(
      "Ești sigură că vrei să ștergi definitiv această recenzie? Acțiunea nu poate fi anulată."
    );
    if (!ok) return;

    try {
      setActionLoading(true);
      setActionError("");

      const base =
        selected.kind === "product"
          ? "/api/admin/maintenance/product-reviews"
          : "/api/admin/maintenance/store-reviews";

      const res = await fetch(`${base}/${selected.reviewId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Nu am putut șterge recenzia.");
      }

      setItems((prev) =>
        prev.filter((r) => r.review?.id !== selected.reviewId)
      );
      setSelected(null);
      setEditLogs([]);
    } catch (e) {
      console.error(e);
      setActionError(e.message || "Eroare la ștergerea recenziei.");
    } finally {
      setActionLoading(false);
    }
  }

  const selectedRow = selected
    ? items.find((r) => r.review?.id === selected.reviewId)
    : null;

  return (
    <div>
      <div className={styles.sectionHead}>
        <div>
          <div className={styles.sectionTitleRow}>
            <h3 className={styles.sectionTitle}>
              Raportări recenzii{" "}
              {totalAll > 0 && (
                <span className={styles.badgeLight}>
                  <FaFlag style={{ marginRight: 4 }} />
                  {totalAll}
                </span>
              )}
            </h3>
          </div>

          <p className={styles.subtle}>
            Aici vezi toate recenziile raportate de utilizatori sau
            vendori (limbaj nepotrivit, date personale, spam etc.).
            De aici poți decide dacă păstrezi recenzia, o ascunzi sau
            o ștergi manual.
          </p>

          <p className={styles.subtle}>
            Total raportări cunoscute:{" "}
            <strong>{totalAll}</strong> · Din ultimele 30 zile:{" "}
            <strong>{recentAll}</strong>
          </p>

          <p className={styles.subtle}>
            <strong>Pe tip recenzie:</strong>{" "}
            <span style={{ marginRight: 12 }}>
              Produs:{" "}
              <strong>{totalByKind.product}</strong> (recent:{" "}
              {recentByKind.product})
            </span>
            <span>
              Profil magazin:{" "}
              <strong>{totalByKind.store}</strong> (recent:{" "}
              {recentByKind.store})
            </span>
          </p>
        </div>

        <div className={styles.sectionActions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={load}
            disabled={loading}
          >
            Reîncarcă
          </button>
        </div>
      </div>

      {loading && (
        <p className={styles.subtle}>
          Se încarcă lista de raportări de recenzii…
        </p>
      )}

      {error && !loading && (
        <p className={styles.errorText}>{error}</p>
      )}

      {!loading && !error && !hasItems && (
        <p className={styles.subtle}>
          Momentan nu există recenzii raportate sau logica de
          raportare nu a fost încă folosită.
        </p>
      )}

      {!loading && !error && hasItems && (
        <>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Data raportării</th>
                  <th>Tip</th>
                  <th>Motiv</th>
                  <th>Recenzie</th>
                  <th>Rating</th>
                  <th>Info recenzie</th>
                  <th>Țintă (produs / magazin)</th>
                  <th>Raportat de</th>
                  <th>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const kind = r._kind;
                  const review = r.review;

                  const product =
                    kind === "product" ? review?.product : null;
                  const vendorFromProduct =
                    product?.service?.vendor || null;

                  const vendorFromStore =
                    kind === "store" ? review?.vendor : null;

                  const reporter = r.reporter;

                  const link =
                    kind === "product" && product?.id && review?.id
                      ? `/produs/${product.id}#rev-${review.id}`
                      : kind === "store" &&
                        vendorFromStore?.id &&
                        review?.id
                      ? `/magazin/${vendorFromStore.id}#rev-${review.id}`
                      : null;

                  const targetLabel =
                    kind === "product"
                      ? product?.title || "Produs necunoscut"
                      : vendorFromStore?.displayName ||
                        vendorFromProduct?.displayName ||
                        "Magazin";

                  const targetSubLabel =
                    kind === "product" && vendorFromProduct
                      ? `Magazin: ${vendorFromProduct.displayName}`
                      : kind === "store" && vendorFromStore
                      ? `Profil magazin: ${vendorFromStore.displayName}`
                      : "";

                  const isSelected =
                    selected && selected.reviewId === review?.id;

                  return (
                    <tr
                      key={r.id}
                      className={isSelected ? styles.rowSelected : undefined}
                    >
                      <td>{formatDate(r.createdAt)}</td>
                      <td>{kindLabel(kind)}</td>
                      <td>{truncate(r.reason, 120)}</td>
                      <td>{truncate(review?.comment, 120)}</td>
                      <td>{review?.rating ?? "—"}</td>
                      <td>
                        <div>
                          <div>
                            Status:{" "}
                            <strong>
                              {statusLabel(review?.status)}
                            </strong>
                          </div>
                          <div className={styles.subtle}>
                            {editedInfo(review)}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div>
                          <div>{truncate(targetLabel, 80)}</div>
                          {targetSubLabel && (
                            <div className={styles.subtle}>
                              {truncate(targetSubLabel, 80)}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        {reporter ? (
                          <>
                            {reporter.name || reporter.email || "—"}
                            <br />
                            <span className={styles.subtle}>
                              {reporter.email || "—"}{" "}
                              {reporter.role
                                ? `(${roleLabel(reporter.role)})`
                                : ""}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          {link && (
                            <a
                              href={link}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.linkInline}
                            >
                              <FaExternalLinkAlt
                                style={{
                                  marginRight: 4,
                                  fontSize: 12,
                                }}
                              />
                              Vezi recenzia
                            </a>
                          )}
                          <button
                            type="button"
                            className={styles.btnLink}
                            onClick={() => handleSelect(r)}
                          >
                            {isSelected
                              ? "Ascunde detaliile"
                              : "Detalii / istoric"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedRow && (
            <div className={styles.card} style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8 }}>Detalii recenzie raportată</h4>

              {actionError && (
                <p className={styles.errorText}>{actionError}</p>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: 16,
                }}
              >
                <div>
                  <p className={styles.subtle}>
                    <strong>Tip:</strong>{" "}
                    {kindLabel(selectedRow._kind)} ·{" "}
                    <strong>Status:</strong>{" "}
                    {statusLabel(selectedRow.review?.status)}
                  </p>
                  <p className={styles.subtle}>
                    <strong>Creată:</strong>{" "}
                    {formatDate(selectedRow.review?.createdAt)} ·{" "}
                    <strong>Ultima modificare:</strong>{" "}
                    {formatDate(selectedRow.review?.updatedAt)}
                  </p>

                  <p style={{ marginTop: 8 }}>
                    <strong>Rating:</strong>{" "}
                    {selectedRow.review?.rating ?? "—"}
                  </p>
                  <p>
                    <strong>Comentariu:</strong>{" "}
                    {selectedRow.review?.comment || "—"}
                  </p>

                  <p style={{ marginTop: 8 }}>
                    <strong>Raportată pentru:</strong>{" "}
                    {selectedRow.reason}
                  </p>

                  <p style={{ marginTop: 8 }}>
                    <strong>Autor recenzie:</strong>{" "}
                    {selectedRow.review?.user?.name ||
                      selectedRow.review?.user?.email ||
                      "—"}{" "}
                    {selectedRow.review?.user?.role && (
                      <span className={styles.subtle}>
                        {" "}
                        ({roleLabel(selectedRow.review.user.role)})
                      </span>
                    )}
                  </p>

                  <p>
                    <strong>Magazin / produs vizat:</strong>{" "}
                    {selectedRow._kind === "product"
                      ? selectedRow.review?.product?.title ||
                        "Produs necunoscut"
                      : selectedRow.review?.vendor?.displayName ||
                        "Magazin"}
                  </p>
                </div>

                <div>
                  <p className={styles.subtle}>
                    <strong>Acțiuni admin</strong>
                  </p>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      onClick={handleHideReview}
                      disabled={actionLoading}
                    >
                      Ascunde din site (status REJECTED)
                    </button>
                    <button
                      type="button"
                      className={styles.btnDanger}
                      onClick={handleDeleteReview}
                      disabled={actionLoading}
                    >
                      Șterge definitiv recenzia
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 16 }}>
                <h5 style={{ marginBottom: 4 }}>Istoric editări</h5>
                {logsLoading && (
                  <p className={styles.subtle}>
                    Se încarcă istoricul de editări…
                  </p>
                )}
                {logsError && (
                  <p className={styles.errorText}>{logsError}</p>
                )}
                {!logsLoading && !logsError && editLogs.length === 0 && (
                  <p className={styles.subtle}>
                    Nu există editări înregistrate pentru această recenzie.
                  </p>
                )}
                {!logsLoading && !logsError && editLogs.length > 0 && (
                  <ul
                    style={{
                      listStyle: "none",
                      paddingLeft: 0,
                      margin: 0,
                    }}
                  >
                    {editLogs.map((log) => {
  const isReplyEdit = log.reason === "VENDOR_REPLY_EDIT";

  return (
    <li
      key={log.id}
      className={styles.subtle}
      style={{
        padding: "4px 0",
        borderBottom: "1px solid rgba(0,0,0,0.05)",
      }}
    >
      <div>
        <strong>{formatDate(log.createdAt)}</strong>{" "}
        · {log.reason || (isReplyEdit ? "VENDOR_REPLY_EDIT" : "EDIT")}
      </div>
      <div>
        De:{" "}
        {log.editor?.name ||
          log.editor?.email ||
          "necunoscut"}{" "}
        {log.editor?.role && (
          <span>
            {" "}
            ({roleLabel(log.editor.role)})
          </span>
        )}
      </div>

      {isReplyEdit ? (
        <>
          <div>
            <strong>Răspuns vechi:</strong>{" "}
            {truncate(log.oldComment || "—", 200)}
          </div>
          <div>
            <strong>Răspuns nou:</strong>{" "}
            {truncate(log.newComment || "—", 200)}
          </div>
        </>
      ) : (
        <>
          <div>
            Rating: {log.oldRating} → {log.newRating}
          </div>
          <div>
            Comentariu vechi:{" "}
            {truncate(log.oldComment || "—", 200)}
          </div>
          <div>
            Comentariu nou:{" "}
            {truncate(log.newComment || "—", 200)}
          </div>
        </>
      )}
    </li>
  );
})}

                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
