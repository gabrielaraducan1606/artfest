// src/pages/ProductDetails/ReviewSection/ReviewSection.jsx
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FaStar,
  FaRegStar,
  FaFlag,
  FaThumbsUp,
  FaRegThumbsUp,
  FaEllipsisV,
  FaCopy,
  FaEdit,
  FaTrash,
  FaReply,
} from "react-icons/fa";
import styles from "./ReviewSection.module.css";
import { api } from "../../../../lib/api.js";

function formatDate(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ro-RO", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Stars({ value }) {
  const full = Math.round(Number(value) || 0);
  return (
    <span className={styles.stars}>
      {Array.from({ length: 5 }, (_, i) =>
        i < full ? <FaStar key={i} /> : <FaRegStar key={i} />
      )}
    </span>
  );
}

const DEFAULT_REPORT_REASONS = [
  "Conține limbaj vulgar sau ofensator",
  "Conține date personale (telefon, adresă, email etc.)",
  "Spam sau conținut irelevant",
  "Informații false sau înșelătoare",
  "Alt motiv",
];

export default function ReviewSection({
  avg,
  reviews,
  isOwner,
  isLoggedIn,
  onSubmit,
  submitting,
  revRating,
  setRevRating,
  revText,
  setRevText,
  currentUserId,
}) {
  const location = useLocation();
  const redirect = encodeURIComponent(location.pathname + location.search);

  const [localReviews, setLocalReviews] = useState(
    (reviews || []).map((r) => ({
      ...r,
      likedByMe: r.likedByMe || false,
      helpfulCount: r.helpfulCount ?? 0,
    }))
  );
  const [files, setFiles] = useState([]);

  // raportare
  const [reportingReview, setReportingReview] = useState(null);
  const [reportReasonKey, setReportReasonKey] = useState(
    DEFAULT_REPORT_REASONS[0]
  );
  const [reportNote, setReportNote] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);

  // meniu 3 puncte
  const [activeMenuId, setActiveMenuId] = useState(null);

  // vendor reply editor state
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);

  useEffect(() => {
    setLocalReviews(
      (reviews || []).map((r) => ({
        ...r,
        likedByMe: r.likedByMe || false,
        helpfulCount: r.helpfulCount ?? 0,
      }))
    );
  }, [reviews]);

  // scroll la #rev-... dacă vine din admin
  useEffect(() => {
    if (!localReviews.length) return;
    const hash = location.hash || "";
    if (hash.startsWith("#rev-")) {
      const el = document.querySelector(hash);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [location.hash, localReviews.length]);

  const isMyReview = (r) =>
    currentUserId && r.userId && r.userId === currentUserId;

  /* ========= HELPFUL TOGGLE ========= */
  const handleHelpful = async (review) => {
    if (!isLoggedIn) {
      alert("Pentru a marca o recenzie ca utilă, te rugăm să te autentifici.");
      return;
    }

    const alreadyLiked = !!review.likedByMe;

    try {
      if (alreadyLiked) {
        await api(`/api/reviews/${encodeURIComponent(review.id)}/helpful`, {
          method: "DELETE",
        });
      } else {
        await api(`/api/reviews/${encodeURIComponent(review.id)}/helpful`, {
          method: "POST",
        });
      }

      setLocalReviews((prev) =>
        prev.map((r) =>
          r.id === review.id
            ? {
                ...r,
                likedByMe: !alreadyLiked,
                helpfulCount: Math.max(
                  0,
                  (r.helpfulCount || 0) + (alreadyLiked ? -1 : 1)
                ),
              }
            : r
        )
      );
    } catch (e) {
      console.error(e);
      alert(e?.message || "Nu am putut actualiza statusul de util.");
    }
  };

  // ===== Raportare =====
  const openReportDialog = (review) => {
    setReportingReview(review);
    setReportReasonKey(DEFAULT_REPORT_REASONS[0]);
    setReportNote("");
  };

  const closeReportDialog = () => {
    if (reportSubmitting) return;
    setReportingReview(null);
    setReportNote("");
  };

  const handleSendReport = async () => {
    if (!reportingReview) return;

    const base = reportReasonKey || DEFAULT_REPORT_REASONS[0];
    const extra = reportNote.trim();
    const fullReason = extra ? `${base} – ${extra}` : base;

    try {
      setReportSubmitting(true);
      await api(`/api/reviews/${encodeURIComponent(reportingReview.id)}/report`, {
        method: "POST",
        body: { reason: fullReason },
      });
      alert(
        "Îți mulțumim! Raportarea ta a fost înregistrată și va fi verificată de un administrator."
      );
      closeReportDialog();
    } catch (e) {
      console.error(e);
      alert(e?.message || "Nu am putut trimite raportarea.");
    } finally {
      setReportSubmitting(false);
    }
  };

  // ===== Upload imagini review =====
  const handleFilesChange = (e) => {
    const list = Array.from(e.target.files || []).slice(0, 5);
    setFiles(list);
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    await onSubmit({
      rating: revRating,
      comment: revText,
      images: files,
    });
    setFiles([]);
  };

  // ===== User menu actions =====
  const handleCopyComment = async (review) => {
    if (!review.comment) return;
    try {
      await navigator.clipboard.writeText(review.comment);
      alert("Textul recenziei a fost copiat în clipboard.");
    } catch (e) {
      console.error(e);
      alert("Nu am putut copia textul. Încearcă din nou.");
    }
  };

  const handleEditReview = (review) => {
    setRevRating(review.rating || 0);
    setRevText(review.comment || "");

    const formEl = document.querySelector("#product-reviews form");
    if (formEl) formEl.scrollIntoView({ behavior: "smooth", block: "start" });

    setActiveMenuId(null);
  };

  const handleDeleteReview = async (review) => {
    const ok = window.confirm(
      "Sigur vrei să ștergi această recenzie? Acțiunea nu poate fi anulată."
    );
    if (!ok) return;

    try {
      await api(`/api/reviews/${encodeURIComponent(review.id)}`, {
        method: "DELETE",
      });

      setLocalReviews((prev) => prev.filter((r) => r.id !== review.id));
      alert("Recenzia a fost ștearsă.");
    } catch (e) {
      console.error(e);
      alert(e?.message || "Nu am putut șterge recenzia.");
    } finally {
      setActiveMenuId(null);
    }
  };

  // ===== Vendor reply actions (în burger) =====
  const startReply = (review) => {
  setReplyingToId(review.id);
  setReplyText(review.reply?.text || "");
};

  const cancelReply = () => {
    if (replySubmitting) return;
    setReplyingToId(null);
    setReplyText("");
  };

  const submitReply = async (review) => {
    const text = (replyText || "").trim();
    if (!text) {
      alert("Scrie un răspuns (minim 1 caracter).");
      return;
    }

    try {
      setReplySubmitting(true);

      const res = await api(
        `/api/vendor/reviews/${encodeURIComponent(review.id)}/reply`,
        { method: "POST", body: { text } }
      );

      const newReply = {
        text: res?.reply?.text ?? text,
        createdAt: res?.reply?.createdAt ?? new Date().toISOString(),
      };

      setLocalReviews((prev) =>
        prev.map((r) => (r.id === review.id ? { ...r, reply: newReply } : r))
      );

      cancelReply();
    } catch (e) {
      console.error(e);
      alert(e?.message || "Nu am putut trimite răspunsul.");
    } finally {
      setReplySubmitting(false);
    }
  };

  const deleteReply = async (review) => {
    const ok = window.confirm(
      "Sigur vrei să ștergi răspunsul? Acțiunea nu poate fi anulată."
    );
    if (!ok) return;

    try {
      await api(`/api/vendor/reviews/${encodeURIComponent(review.id)}/reply`, {
        method: "DELETE",
      });

      setLocalReviews((prev) =>
        prev.map((r) => (r.id === review.id ? { ...r, reply: null } : r))
      );

      if (replyingToId === review.id) cancelReply();
    } catch (e) {
      console.error(e);
      alert(e?.message || "Nu am putut șterge răspunsul.");
    } finally {
      setActiveMenuId(null);
    }
  };

  const canWriteReview = !isOwner && isLoggedIn;
  const hasReviews = Array.isArray(localReviews) && localReviews.length > 0;

  return (
    <section className={styles.wrap} id="product-reviews">
      <header className={styles.header}>
        <div>
          {avg?.count > 0 ? (
            <p className={styles.meta}>
              <strong>{avg.average.toFixed(1)} / 5</strong>{" "}
              <Stars value={avg.average} /> · {avg.count} recenzie
              {avg.count === 1 ? "" : "i"}
            </p>
          ) : (
            <p className={styles.meta}>
              Încă nu există recenzii pentru acest produs.
            </p>
          )}
        </div>
      </header>

      {/* LISTĂ RECENZII */}
      {hasReviews && (
        <ul className={styles.list}>
          {localReviews.map((r) => {
            const isVendorBurgerEnabled = isLoggedIn && isOwner; // vendor pe propriul produs
            const canReply = isVendorBurgerEnabled; // dacă vrei: && !isMyReview(r) etc.

            return (
              <li key={r.id} id={`rev-${r.id}`} className={styles.item}>
                <div className={styles.itemTop}>
                  <div>
                    <div className={styles.itemHead}>
                      <Stars value={r.rating} />
                      <span className={styles.ratingValue}>{r.rating}.0</span>
                      {r.verified && (
                        <span className={styles.badgeVerified}>
                          Achiziție verificată
                        </span>
                      )}
                    </div>

                    <div className={styles.itemMeta}>
                      <span className={styles.author}>
                        {r.userName || "Client"}
                      </span>
                      <span className={styles.date}>
                        {formatDate(r.createdAt)}
                      </span>
                    </div>
                  </div>

                  {isLoggedIn && (
                    <div className={styles.itemMenuWrap}>
                      <button
                        type="button"
                        className={styles.menuToggleBtn}
                        onClick={() =>
                          setActiveMenuId(activeMenuId === r.id ? null : r.id)
                        }
                        aria-haspopup="true"
                        aria-expanded={activeMenuId === r.id}
                      >
                        <FaEllipsisV />
                      </button>

                      {activeMenuId === r.id && (
                        <div className={styles.itemMenu}>
                          <button
                            type="button"
                            className={styles.itemMenuItem}
                            onClick={() => handleCopyComment(r)}
                          >
                            <FaCopy /> <span>Copiază textul</span>
                          </button>

                          {/* User actions */}
                          {isMyReview(r) && (
                            <>
                              <button
                                type="button"
                                className={styles.itemMenuItem}
                                onClick={() => handleEditReview(r)}
                              >
                                <FaEdit /> <span>Editează</span>
                              </button>
                              <button
                                type="button"
                                className={styles.itemMenuItemDanger}
                                onClick={() => handleDeleteReview(r)}
                              >
                                <FaTrash /> <span>Șterge</span>
                              </button>
                            </>
                          )}

                          {/* Vendor reply actions în burger */}
                          {canReply && (
                            <>
                              <div className={styles.itemMenuDivider} />
                              {!r.reply ? (
                                <button
                                  type="button"
                                  className={styles.itemMenuItem}
                                  onClick={() => {
                                    startReply(r);
                                    setActiveMenuId(null);
                                  }}
                                >
                                  <FaReply /> <span>Răspunde</span>
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className={styles.itemMenuItem}
                                    onClick={() => {
                                      startReply(r);
                                      setActiveMenuId(null);
                                    }}
                                  >
                                    <FaEdit /> <span>Editează răspunsul</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.itemMenuItemDanger}
                                    onClick={() => deleteReply(r)}
                                  >
                                    <FaTrash /> <span>Șterge răspunsul</span>
                                  </button>
                                </>
                              )}
                            </>
                          )}

                          {/* Report */}
                          <button
                            type="button"
                            className={styles.itemMenuItem}
                            onClick={() => {
                              openReportDialog(r);
                              setActiveMenuId(null);
                            }}
                          >
                            <FaFlag /> <span>Raportează</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {r.comment && <p className={styles.comment}>{r.comment}</p>}

                {r.images && r.images.length > 0 && (
                  <div className={styles.imagesRow}>
                    {r.images.map((img) => (
                      <img
                        key={img.id}
                        src={img.url}
                        alt="Imagine recenzie"
                        className={styles.reviewImage}
                      />
                    ))}
                  </div>
                )}

                {/* reply existent */}
                {r.reply && (
                  <div className={styles.replyBox}>
                    <div className={styles.replyLabel}>Răspuns de la vânzător</div>
                    <div className={styles.replyText}>{r.reply.text}</div>
                    <div className={styles.replyDate}>
                      {formatDate(r.reply.createdAt)}
                    </div>
                  </div>
                )}

                {/* editor răspuns (NU în burger, doar când e activ) */}
                {isOwner && isLoggedIn && replyingToId === r.id && (
                  <div className={styles.vendorReplyEditor}>
                    <textarea
                      className={styles.textarea}
                      rows={3}
                      maxLength={1000}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Scrie un răspuns ca vânzător..."
                      disabled={replySubmitting}
                    />
                    <div className={styles.reportActions}>
                      <button
                        type="button"
                        className={styles.reportCancelBtn}
                        onClick={cancelReply}
                        disabled={replySubmitting}
                      >
                        Anulează
                      </button>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        onClick={() => submitReply(r)}
                        disabled={replySubmitting}
                      >
                        {replySubmitting
                          ? "Se trimite…"
                          : r.reply
                          ? "Salvează răspunsul"
                          : "Trimite răspunsul"}
                      </button>
                    </div>
                  </div>
                )}

                <div className={styles.actionsRow}>
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${
                      r.likedByMe ? styles.actionBtnActive : ""
                    }`}
                    onClick={() => handleHelpful(r)}
                    title="Marchează recenzia ca utilă"
                  >
                    {r.likedByMe ? <FaThumbsUp /> : <FaRegThumbsUp />}{" "}
                    <span>
                      Utilă{" "}
                      {r.helpfulCount != null && r.helpfulCount > 0
                        ? `(${r.helpfulCount})`
                        : ""}
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* FORMULAR RECENZIE NOUĂ */}
      {isOwner && (
        <p className={styles.ownerNote}>
          Ești proprietarul acestui produs, așa că nu poți lăsa o recenzie.
        </p>
      )}

      {!isOwner && (
        <>
          <h3 className={styles.formTitle}>Lasă o recenzie</h3>

          {canWriteReview ? (
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.fieldGroup}>
                <label className={styles.label}>Rating</label>
                <div className={styles.starsSelector}>
                  {Array.from({ length: 5 }, (_, i) => {
                    const value = i + 1;
                    const active = value <= revRating;
                    return (
                      <button
                        key={value}
                        type="button"
                        className={`${styles.starBtn} ${
                          active ? styles.starBtnActive : ""
                        }`}
                        onClick={() => setRevRating(value)}
                      >
                        {active ? <FaStar /> : <FaRegStar />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  Experiența ta cu acest produs
                </label>
                <textarea
                  className={styles.textarea}
                  rows={4}
                  maxLength={2000}
                  value={revText}
                  onChange={(e) => setRevText(e.target.value)}
                  placeholder="Povestește pe scurt cum ți s-a părut produsul: calitate, împachetare, livrare, etc."
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label}>
                  Fotografii (opțional, max. 5)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFilesChange}
                />
                {files.length > 0 && (
                  <p className={styles.filesHint}>
                    {files.length} imagine
                    {files.length === 1 ? "" : "i"} selectată
                    {files.length > 1 ? "e" : ""}.
                  </p>
                )}
              </div>

              <button
                className={styles.primaryBtn}
                disabled={submitting}
                type="submit"
              >
                {submitting ? "Se trimite…" : "Trimite recenzia"}
              </button>
            </form>
          ) : (
            <p className={styles.loginPrompt}>
              Vrei să lași o recenzie?{" "}
              <Link to={`/autentificare?redirect=${redirect}`}>
                Autentifică-te
              </Link>
              .
            </p>
          )}
        </>
      )}

      {/* ===== Dialog raportare recenzie – PRODUS ===== */}
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
            <p className={styles.reportTextMuted}>
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
                className={styles.reportCancelBtn}
                onClick={closeReportDialog}
                disabled={reportSubmitting}
              >
                Anulează
              </button>
              <button
                type="button"
                className={styles.reportSubmitBtn}
                onClick={handleSendReport}
                disabled={reportSubmitting}
              >
                {reportSubmitting ? "Se trimite…" : "Trimite raportarea"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
