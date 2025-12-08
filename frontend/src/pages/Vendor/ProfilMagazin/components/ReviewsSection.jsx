import { useMemo, useState, useEffect } from "react";
import {
  FaUserCircle,
  FaExternalLinkAlt,
  FaEdit,
  FaReply,
  FaTrash,
  FaEllipsisV,
  FaThumbsUp,
  FaFilter,
  FaUndo,
  FaPen,
  FaChevronDown,
  FaChevronUp,
} from "react-icons/fa";
import styles from "./css/Reviews.module.css";
import RatingsStars from "./RatingStars";
import { onImgError } from "../../../../components/utils/imageFallback";

function timeAgo(date) {
  const d = new Date(date);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "acum câteva secunde";
  if (diff < 3600) return `${Math.floor(diff / 60)} min în urmă`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h în urmă`;
  return d.toLocaleDateString();
}

const DEFAULT_REPORT_REASONS = [
  "Conține limbaj vulgar sau ofensator",
  "Conține date personale (telefon, adresă, email etc.)",
  "Spam sau conținut irelevant",
  "Informații false sau înșelătoare",
  "Alt motiv",
];

export default function ReviewsSection({
  rating = 0,
  reviews = [],
  totalCount = 0,
  stats = { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, avg: 0 },
  canWrite = false,
  isVendorView = false,
  me = null,
  onSubmit, // ({ rating, comment })
  onOptimisticAdd, // (tempReview)
  onHelpful,
  onReport, // async (reviewId, reasonText)
  onChangeQuery, // ({ sort, filter:{ verified, star, noReply, lowRatingOnly }, page })
  onVendorReply, // async (reviewId, text)
  onVendorDeleteReply, // async (reviewId)
  onUserDeleteReview, // async (reviewId)
  // nou pentru paginare:
  hasMore = false,
  onLoadMore, // () => void
  loadingMore = false,
}) {
  const rounded = Math.round(Number(rating || 0));

  const kpi = useMemo(() => {
    if (!reviews?.length)
      return { responded: 0, unresponded: 0, avg: rating || 0 };
    const responded = reviews.filter((r) => !!r.reply).length;
    return {
      responded,
      unresponded: totalCount - responded,
      avg: rating || 0,
    };
  }, [reviews, totalCount, rating]);

  // draft user review (inline)
  const [draft, setDraft] = useState({ rating: 0, comment: "" });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  // editare recenzie user
  const [editingReviewId, setEditingReviewId] = useState(null);

  // meniuri + editare răspuns (vendor)
  const [openReplyMenuId, setOpenReplyMenuId] = useState(null); // meniu răspuns vendor
  const [openReviewMenuId, setOpenReviewMenuId] = useState(null); // meniu recenzie (user)
  const [editingReplyId, setEditingReplyId] = useState(null);
  const [replyDrafts, setReplyDrafts] = useState({}); // {reviewId: text}

  // dialog raportare
  const [reportingReview, setReportingReview] = useState(null); // review
  const [reportReasonKey, setReportReasonKey] = useState(
    DEFAULT_REPORT_REASONS[0]
  );
  const [reportNote, setReportNote] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);

  // FILTRE în bottom-sheet
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    sort: "relevant",
    verified: false,
    noReply: false,
    lowRatingOnly: false,
    star: null,
  });

  // histogramă accordion
  const [histOpen, setHistOpen] = useState(false);

  // închide meniurile la click în afara lor
  useEffect(() => {
    function handleClickOutside(e) {
      const target = e.target;
      const isInReviewMenu =
        target.closest && target.closest('[data-review-menu-root="true"]');
      const isInReplyMenu =
        target.closest && target.closest('[data-reply-menu-root="true"]');

      if (!isInReviewMenu) {
        setOpenReviewMenuId(null);
      }
      if (!isInReplyMenu) {
        setOpenReplyMenuId(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  async function handleSubmitInline() {
    const e = {};
    if (draft.rating < 1 || draft.rating > 5) e.rating = "Alege 1–5 stele.";
    setErrors(e);
    if (Object.keys(e).length) return;

    try {
      setSubmitting(true);

      // dacă e editare, nu mai facem optimistic add, doar trimitem update
      if (editingReviewId) {
        await onSubmit?.({
          rating: draft.rating,
          comment: draft.comment,
        });
        setEditingReviewId(null);
      } else {
        const temp = {
          id: `tmp-${Date.now()}`,
          userName: me?.name || "Tu",
          rating: draft.rating,
          comment: draft.comment.trim(),
          createdAt: new Date().toISOString(),
          verified: false,
          helpfulCount: 0,
        };
        onOptimisticAdd?.(temp);
        await onSubmit?.({ rating: draft.rating, comment: draft.comment });
      }

      setDraft({ rating: 0, comment: "" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveReply(review) {
    const text = (replyDrafts[review.id] ?? review.reply?.text ?? "").trim();
    if (!text) return;
    await onVendorReply?.(review.id, text);
    setEditingReplyId(null);
    setOpenReplyMenuId(null);
  }

  async function handleDeleteReply(review) {
    if (!onVendorDeleteReply) return;
    const ok = window.confirm("Sigur vrei să ștergi răspunsul?");
    if (!ok) return;
    await onVendorDeleteReply(review.id);
    setEditingReplyId(null);
    setOpenReplyMenuId(null);
  }

  function toggleReplyMenu(reviewId) {
    setOpenReplyMenuId((cur) => (cur === reviewId ? null : reviewId));
  }

  function toggleReviewMenu(reviewId) {
    setOpenReviewMenuId((cur) => (cur === reviewId ? null : reviewId));
  }

  function openReportDialog(review) {
    setReportingReview(review);
    setReportReasonKey(DEFAULT_REPORT_REASONS[0]);
    setReportNote("");
  }

  function closeReportDialog() {
    if (reportSubmitting) return;
    setReportingReview(null);
    setReportNote("");
  }

  async function handleSendReport() {
    if (!reportingReview || !onReport) return;
    const base = reportReasonKey || DEFAULT_REPORT_REASONS[0];
    const extra = reportNote.trim();
    const fullReason = extra ? `${base} – ${extra}` : base;

    setReportSubmitting(true);
    try {
      await onReport(reportingReview.id, fullReason);
      closeReportDialog();
    } finally {
      setReportSubmitting(false);
    }
  }

  function startEditReview(r) {
    setDraft({
      rating: r.rating,
      comment: r.comment || "",
    });
    setEditingReviewId(r.id);
    // scroll la formular
    const el = document.getElementById("write-review");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // helper: construiește payload pentru onChangeQuery dintr-un set de filtre
  function buildQueryPayload(next) {
    const filter = {
      verified: next.verified,
      star: next.star ?? null,
    };

    if (isVendorView) {
      filter.noReply = next.noReply;
      filter.lowRatingOnly = next.lowRatingOnly;
    }

    return {
      sort: next.sort,
      filter,
    };
  }

  // helper: setează state + notifică parent-ul
  function applyFilters(next) {
    setFilters(next);
    const payload = buildQueryPayload(next);
    onChangeQuery?.(payload);
  }

  function handleApplyFilters() {
    applyFilters(filters);
    setFiltersOpen(false);
  }

  function handleResetFilters(closeModal = false) {
    const next = {
      sort: "relevant",
      verified: false,
      noReply: false,
      lowRatingOnly: false,
      star: null,
    };

    applyFilters(next);

    if (closeModal) {
      setFiltersOpen(false);
    }
  }

  function scrollToWriteReview() {
    const el = document.getElementById("write-review");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const canShowWriteButton = !isVendorView && (canWrite || !me);

  return (
    <section className={styles.section} aria-live="polite">
      {/* HEADER mobil-friendly */}
      <div className={styles.headerRow}>
        <div className={styles.headerRating}>
          <span className={styles.ratingValue}>
            {Number(rating || 0).toFixed(1)}
          </span>
          <div className={styles.headerRatingRight}>
            <RatingsStars value={rounded} />
            <span className={styles.mutedSmall}>
              {totalCount} recenzii
            </span>
          </div>
        </div>

        {canShowWriteButton && (
          <button
            type="button"
            className={styles.writeBtnSmall}
            onClick={scrollToWriteReview}
          >
            <FaPen style={{ marginRight: 4 }} />
            Scrie recenzie
          </button>
        )}
      </div>

      {isVendorView && (
        <div className={styles.kpiStrip}>
          <div className={styles.kpiBox}>
            <strong>
              {kpi.avg?.toFixed?.(1) ?? Number(kpi.avg).toFixed(1)}
            </strong>
            <span>Scor mediu</span>
          </div>
          <div className={styles.kpiBox}>
            <strong>{kpi.responded}</strong>
            <span>Cu răspuns</span>
          </div>
          <div className={styles.kpiBox}>
            <strong>{kpi.unresponded}</strong>
            <span>Fără răspuns</span>
          </div>
        </div>
      )}

      {/* HISTOGRAMĂ în accordion, mai „light” pe mobil */}
      <div className={styles.histWrapper}>
        <button
          type="button"
          className={styles.histToggle}
          onClick={() => setHistOpen((v) => !v)}
          aria-expanded={histOpen}
        >
          <span>Distribuția recenziilor</span>
          {histOpen ? <FaChevronUp /> : <FaChevronDown />}
        </button>

        {histOpen && (
          <ul
            className={styles.histogram}
            role="list"
            aria-label="Distribuția pe stele"
          >
            {[5, 4, 3, 2, 1].map((star) => {
              const count = stats[`c${star}`] || 0;
              const pct = totalCount
                ? Math.round((count / totalCount) * 100)
                : 0;
              return (
                <li key={star} className={styles.histRow}>
                  <button
                    className={styles.histLabel}
                    onClick={() =>
                      applyFilters({
                        ...filters,
                        star,
                      })
                    }
                    title={`Filtrează la ${star} stele`}
                  >
                    {star} ★
                  </button>
                  <div className={styles.histBar} aria-hidden>
                    <div
                      className={styles.histFill}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span
                    className={styles.histCount}
                    aria-label={`${count} recenzii cu ${star} stele`}
                  >
                    {count}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* BARĂ CONTROALE: butoane pentru Filtre + Reset */}
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setFiltersOpen(true)}
        >
          <FaFilter />
          <span>Filtre</span>
        </button>

        <button
          type="button"
          className={styles.iconBtnSecondary}
          onClick={() => handleResetFilters(false)}
        >
          <FaUndo />
          <span>Reset</span>
        </button>
      </div>

      {/* listă recenzii */}
      {reviews.map((r) => {
        const isMine =
          !!me && !!r.userId && String(r.userId) === String(me.id);

        return (
          <article
            key={r.id}
            id={`rev-${r.id}`}
            className={styles.reviewItem}
          >
            <header className={styles.reviewHeaderRow}>
              <div className={styles.reviewMainHeader}>
                <div className={styles.reviewAvatarWrap}>
                  {r.userAvatar ? (
                    <img
                      src={r.userAvatar}
                      className={styles.reviewAvatar}
                      alt={r.userName || "Utilizator"}
                      onError={(e) => onImgError(e, 40, 40, "")}
                    />
                  ) : (
                    <div className={styles.reviewAvatarPlaceholder}>
                      <FaUserCircle />
                    </div>
                  )}
                </div>

                <div className={styles.reviewHeaderText}>
                  <div className={styles.reviewNameRow}>
                    <span className={styles.reviewName}>
                      {r.userName}
                    </span>
                    {r.verified && (
                      <span className={styles.badge}>Verificat</span>
                    )}
                  </div>
                  <div className={styles.reviewSubHeader}>
                    <RatingsStars
                      value={r.rating}
                      ariaLabel={`${r.rating} din 5 stele`}
                    />
                    <time
                      title={new Date(r.createdAt).toLocaleString()}
                      className={styles.mutedTiny}
                    >
                      {timeAgo(r.createdAt)}
                    </time>
                  </div>
                </div>
              </div>

              {/* acțiuni USER: like + meniu recenzie (UN SINGUR RÂND) */}
              {!isVendorView && (
                <div className={styles.reviewActionsRight}>
                  <button
                    className={styles.iconCircleBtn}
                    onClick={() => onHelpful?.(r.id)}
                    title="Marchează recenzia ca utilă"
                  >
                    <FaThumbsUp />
                    {r.helpfulCount || 0}
                  </button>

                  <div
                    className={styles.ownerReplyMenuWrap}
                    data-review-menu-root="true"
                  >
                    <button
                      type="button"
                      className={styles.ownerReplyMenuBtn}
                      onClick={() => toggleReviewMenu(r.id)}
                      aria-label="Meniu recenzie"
                    >
                      <FaEllipsisV />
                    </button>

                    {openReviewMenuId === r.id && (
                      <div className={styles.ownerReplyMenu}>
                        {/* Copiază link-ul către recenzie – disponibil pentru toți userii */}
                        <button
                          type="button"
                          className={styles.ownerReplyMenuItem}
                          onClick={() => {
                            navigator.clipboard?.writeText(
                              `${location.origin}${location.pathname}#rev-${r.id}`
                            );
                            setOpenReviewMenuId(null);
                          }}
                        >
                          <FaExternalLinkAlt style={{ marginRight: 6 }} />
                          Copiază link-ul către recenzie
                        </button>

                        {isMine && (
                          <>
                            <button
                              type="button"
                              className={styles.ownerReplyMenuItem}
                              onClick={() => {
                                startEditReview(r);
                                setOpenReviewMenuId(null);
                              }}
                            >
                              <FaEdit style={{ marginRight: 6 }} />
                              Editează recenzia
                            </button>

                            <button
                              type="button"
                              className={styles.ownerReplyMenuItem}
                              onClick={() => {
                                if (!onUserDeleteReview) return;
                                const ok = window.confirm(
                                  "Sigur vrei să ștergi această recenzie?"
                                );
                                if (!ok) return;
                                onUserDeleteReview(r.id);
                                setOpenReviewMenuId(null);
                              }}
                            >
                              <FaTrash style={{ marginRight: 6 }} />
                              Șterge recenzia
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          className={styles.ownerReplyMenuItem}
                          onClick={() => {
                            openReportDialog(r);
                            setOpenReviewMenuId(null);
                          }}
                        >
                          Raportează recenzia
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </header>

            {r.comment && (
              <p className={styles.reviewText}>{r.comment}</p>
            )}

            {/* Vendor view: nu are acțiuni la nivel de recenzie, doar la răspuns */}
            {/* ===== Răspuns vânzător + MENIU UNIC PENTRU VENDOR ===== */}
            {(r.reply || isVendorView) && (
              <div className={styles.ownerReply}>
                <div className={styles.ownerReplyHeader}>
                  <strong>Răspunsul vânzătorului</strong>

                  {isVendorView && (
                    <div
                      className={styles.ownerReplyMenuWrap}
                      data-reply-menu-root="true"
                    >
                      {!r.reply && editingReplyId !== r.id && (
                        <button
                          type="button"
                          className={styles.linkBtnTiny}
                          onClick={() => {
                            setReplyDrafts((s) => ({
                              ...s,
                              [r.id]: "",
                            }));
                            setEditingReplyId(r.id);
                            setOpenReplyMenuId(null);
                          }}
                        >
                          <FaReply style={{ marginRight: 4 }} />
                          Adaugă răspuns
                        </button>
                      )}

                      {r.reply && (
                        <>
                          <button
                            type="button"
                            className={styles.ownerReplyMenuBtn}
                            onClick={() => toggleReplyMenu(r.id)}
                            aria-label="Meniu răspuns vânzător"
                          >
                            <FaEllipsisV />
                          </button>
                          {openReplyMenuId === r.id && (
                            <div className={styles.ownerReplyMenu}>
                              {/* Copiază link recenzie */}
                              <button
                                type="button"
                                className={styles.ownerReplyMenuItem}
                                onClick={() => {
                                  navigator.clipboard?.writeText(
                                    `${location.origin}${location.pathname}#rev-${r.id}`
                                  );
                                  setOpenReplyMenuId(null);
                                }}
                              >
                                <FaExternalLinkAlt
                                  style={{ marginRight: 6 }}
                                />
                                Copiază link-ul către recenzie
                              </button>

                              {/* Copiază text recenzie */}
                              <button
                                type="button"
                                className={styles.ownerReplyMenuItem}
                                onClick={() => {
                                  const textToCopy = r.comment || "";
                                  if (textToCopy) {
                                    navigator.clipboard?.writeText(
                                      textToCopy
                                    );
                                  }
                                  setOpenReplyMenuId(null);
                                }}
                              >
                                Copiază textul recenziei
                              </button>

                              {/* Editează răspunsul */}
                              <button
                                type="button"
                                className={styles.ownerReplyMenuItem}
                                onClick={() => {
                                  setReplyDrafts((s) => ({
                                    ...s,
                                    [r.id]: r.reply?.text || "",
                                  }));
                                  setEditingReplyId(r.id);
                                  setOpenReplyMenuId(null);
                                }}
                              >
                                <FaEdit
                                  style={{
                                    marginRight: 6,
                                  }}
                                />
                                Editează răspunsul
                              </button>

                              {/* Șterge răspunsul */}
                              <button
                                type="button"
                                className={styles.ownerReplyMenuItem}
                                onClick={() => handleDeleteReply(r)}
                              >
                                <FaTrash
                                  style={{
                                    marginRight: 6,
                                  }}
                                />
                                Șterge răspunsul
                              </button>

                              {/* Raportează recenzia */}
                              <button
                                type="button"
                                className={styles.ownerReplyMenuItem}
                                onClick={() => {
                                  openReportDialog(r);
                                  setOpenReplyMenuId(null);
                                }}
                              >
                                Raportează recenzia
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {editingReplyId === r.id ? (
                  <>
                    <textarea
                      className={styles.textareaSmall}
                      value={replyDrafts[r.id] ?? r.reply?.text ?? ""}
                      onChange={(e) =>
                        setReplyDrafts((s) => ({
                          ...s,
                          [r.id]: e.target.value,
                        }))
                      }
                      maxLength={1000}
                      placeholder="Răspunsul tău ca vânzător..."
                      rows={3}
                    />
                    <div className={styles.replyRow}>
                      <button
                        className={styles.primaryBtnSmall}
                        type="button"
                        onClick={() => handleSaveReply(r)}
                      >
                        Salvează
                      </button>
                      <button
                        type="button"
                        className={styles.linkBtnTiny}
                        onClick={() => {
                          setEditingReplyId(null);
                          setOpenReplyMenuId(null);
                        }}
                      >
                        Anulează
                      </button>
                    </div>
                  </>
                ) : (
                  r.reply && (
                    <>
                      <p className={styles.ownerReplyText}>
                        {r.reply.text}
                      </p>
                      <time className={styles.mutedTiny}>
                        {timeAgo(r.reply.createdAt)}
                      </time>
                    </>
                  )
                )}
              </div>
            )}
          </article>
        );
      })}

      {/* PAGINARE: Încarcă mai multe */}
      {hasMore && onLoadMore && (
        <div className={styles.loadMoreWrap}>
          <button
            type="button"
            className={styles.loadMoreBtn}
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Se încarcă…" : "Încarcă mai multe recenzii"}
          </button>
        </div>
      )}

      {/* Form inline: Scrie / editează o recenzie – doar pentru useri, nu pentru vendor view */}
      {!isVendorView && (
        <div style={{ marginTop: 16 }}>
          {canWrite ? (
            <div id="write-review" className={styles.writeCard}>
              <h3 className={styles.h3}>
                {editingReviewId ? "Editează recenzia" : "Scrie o recenzie"}
              </h3>
              <div className={styles.writeRow}>
                <RatingsStars
                  value={draft.rating}
                  onChange={(v) =>
                    setDraft((s) => ({
                      ...s,
                      rating: v,
                    }))
                  }
                  ariaLabel={`${draft.rating} din 5`}
                />
                {errors.rating && (
                  <span className={styles.err}>{errors.rating}</span>
                )}
              </div>
              <textarea
                value={draft.comment}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    comment: e.target.value,
                  }))
                }
                placeholder="Scrie părerea ta..."
                className={styles.textarea}
                rows={4}
                maxLength={2000}
              />
              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  onClick={handleSubmitInline}
                  disabled={submitting}
                >
                  {submitting
                    ? "Se trimite…"
                    : editingReviewId
                    ? "Salvează modificările"
                    : "Trimite recenzia"}
                </button>
                <span className={styles.muted}>
                  {draft.comment.length}/2000
                </span>
              </div>
            </div>
          ) : (
            !me && (
              <p className={styles.loginPrompt}>
                Vrei să lași o recenzie?{" "}
                <a href="/autentificare">Autentifică-te</a> sau{" "}
                <a href="/inregistrare">Creează cont</a>.
              </p>
            )
          )}
        </div>
      )}

      {/* FAB „Scrie recenzie” – doar user, doar pe mobil */}
      {canShowWriteButton && (
        <button
          type="button"
          className={styles.fabWriteBtn}
          onClick={scrollToWriteReview}
        >
          <FaPen />
          <span>Scrie recenzie</span>
        </button>
      )}

      {/* ===== Dialog raportare recenzie ===== */}
      {reportingReview && (
        <div
          className={styles.reportOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-title"
        >
          <div className={styles.reportCard}>
            <h3 id="report-title" className={styles.reportTitle}>
              Raportează recenzia
            </h3>
            <p className={styles.muted}>
              Alege motivul raportării. Te rugăm să folosești opțiunea doar
              pentru încălcări reale (limbaj vulgar, date personale, spam etc.).
            </p>

            <div className={styles.reportOptions}>
              {DEFAULT_REPORT_REASONS.map((reason) => (
                <label key={reason} className={styles.reportOption}>
                  <input
                    type="radio"
                    name="reportReason"
                    value={reason}
                    checked={reportReasonKey === reason}
                    onChange={() => setReportReasonKey(reason)}
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>

            <textarea
              className={styles.reportTextarea}
              placeholder="Detaliază (opțional, max 300 caractere)..."
              maxLength={300}
              value={reportNote}
              onChange={(e) => setReportNote(e.target.value)}
            />

            <div className={styles.reportActions}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={closeReportDialog}
                disabled={reportSubmitting}
              >
                Anulează
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleSendReport}
                disabled={reportSubmitting}
              >
                {reportSubmitting ? "Se trimite…" : "Trimite raportarea"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL FILTRE – ca bottom sheet pe mobil ===== */}
      {filtersOpen && (
        <div
          className={`${styles.reportOverlay} ${styles.sheetOverlay}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="filters-title"
        >
          <div className={`${styles.reportCard} ${styles.sheetCard}`}>
            <div className={styles.sheetHandle} />
            <h3 id="filters-title" className={styles.reportTitle}>
              Filtre recenzii
            </h3>

            <div className={styles.filtersBody}>
              <div className={styles.filtersRow}>
                <label className={styles.filterLabel}>
                  Sortare
                  <select
                    className={styles.input}
                    value={filters.sort}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, sort: e.target.value }))
                    }
                  >
                    <option value="relevant">Cele mai utile</option>
                    <option value="recent">Cele mai recente</option>
                    <option value="rating_desc">Rating descrescător</option>
                    <option value="rating_asc">Rating crescător</option>
                  </select>
                </label>
              </div>

              <div className={styles.filtersRow}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={filters.verified}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        verified: e.target.checked,
                      }))
                    }
                  />
                  Doar „verificate”
                </label>
              </div>

              {isVendorView && (
                <>
                  <div className={styles.filtersRow}>
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={filters.noReply}
                        onChange={(e) =>
                          setFilters((f) => ({
                            ...f,
                            noReply: e.target.checked,
                          }))
                        }
                      />
                      Doar fără răspuns
                    </label>
                  </div>

                  <div className={styles.filtersRow}>
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={filters.lowRatingOnly}
                        onChange={(e) =>
                          setFilters((f) => ({
                            ...f,
                            lowRatingOnly: e.target.checked,
                          }))
                        }
                      />
                      Doar recenzii ≤ 3 stele
                    </label>
                  </div>
                </>
              )}

              <div className={styles.filtersRow}>
                <span className={styles.filterLabel}>Filtru după stele</span>
                <div className={styles.filterStarsRow}>
                  {[5, 4, 3, 2, 1].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={
                        filters.star === star
                          ? styles.starFilterBtnActive
                          : styles.starFilterBtn
                      }
                      onClick={() =>
                        setFilters((f) => ({
                          ...f,
                          star: f.star === star ? null : star,
                        }))
                      }
                    >
                      {star}★
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.reportActions}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setFiltersOpen(false)}
              >
                Închide
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => handleResetFilters(true)}
              >
                Reset
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleApplyFilters}
              >
                Aplică filtrele
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
