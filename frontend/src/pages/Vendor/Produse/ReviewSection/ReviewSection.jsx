// src/pages/ProductDetails/ReviewSection/ReviewSection.jsx
import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FaStar, FaRegStar, FaFlag, FaThumbsUp } from "react-icons/fa";
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
}) {
  const location = useLocation();
  const redirect = encodeURIComponent(
    location.pathname + location.search
  );

  // local copy pentru a putea incrementa helpful etc.
  const [localReviews, setLocalReviews] = useState(reviews || []);
  const [files, setFiles] = useState([]);

  // dialog raportare
  const [reportingReview, setReportingReview] = useState(null); // review object
  const [reportReasonKey, setReportReasonKey] = useState(
    DEFAULT_REPORT_REASONS[0]
  );
  const [reportNote, setReportNote] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);

  useEffect(() => {
    setLocalReviews(reviews || []);
  }, [reviews]);

  // scroll la #rev-... dacă vine din admin
  useEffect(() => {
    if (!localReviews.length) return;
    const hash = location.hash || "";
    if (hash.startsWith("#rev-")) {
      const el = document.querySelector(hash);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [location.hash, localReviews.length]);

  const handleHelpful = async (reviewId) => {
    try {
      await api(`/api/reviews/${encodeURIComponent(reviewId)}/helpful`, {
        method: "POST",
      });

      // incrementăm local, ca feedback
      setLocalReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? { ...r, helpfulCount: (r.helpfulCount || 0) + 1 }
            : r
        )
      );
    } catch (e) {
      alert(e?.message || "Nu am putut marca recenzia ca utilă.");
    }
  };

  // ==== LOGICĂ MODAL RAPORTARE ====
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
      await api(
        `/api/reviews/${encodeURIComponent(
          reportingReview.id
        )}/report`,
        {
          method: "POST",
          body: { reason: fullReason },
        }
      );
      alert(
        "Îți mulțumim! Raportarea ta a fost înregistrată și va fi verificată de un administrator."
      );
      closeReportDialog();
    } catch (e) {
      alert(e?.message || "Nu am putut trimite raportarea.");
    } finally {
      setReportSubmitting(false);
    }
  };
  // ================================

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

  const canWriteReview = !isOwner && isLoggedIn;
  const hasReviews = Array.isArray(localReviews) && localReviews.length > 0;

  return (
    <section className={styles.wrap} id="product-reviews">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Recenzii produs</h2>
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
          {localReviews.map((r) => (
            <li
              key={r.id}
              id={`rev-${r.id}`} // important pentru linkul din admin
              className={styles.item}
            >
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

              {r.comment && (
                <p className={styles.comment}>{r.comment}</p>
              )}

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

              {r.reply && (
                <div className={styles.replyBox}>
                  <div className={styles.replyLabel}>
                    Răspuns de la vânzător
                  </div>
                  <div className={styles.replyText}>{r.reply.text}</div>
                  <div className={styles.replyDate}>
                    {formatDate(r.reply.createdAt)}
                  </div>
                </div>
              )}

              <div className={styles.actionsRow}>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => handleHelpful(r.id)}
                  title="Marchează recenzia ca utilă"
                >
                  <FaThumbsUp />{" "}
                  <span>
                    Utilă{" "}
                    {r.helpfulCount != null && r.helpfulCount > 0
                      ? `(${r.helpfulCount})`
                      : ""}
                  </span>
                </button>

                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => openReportDialog(r)}
                  title="Raportează recenzia"
                >
                  <FaFlag /> <span>Raportează</span>
                </button>
              </div>
            </li>
          ))}
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
              Alege motivul raportării. Te rugăm să folosești opțiunea
              doar pentru încălcări reale (limbaj vulgar, date personale,
              spam etc.).
            </p>

            <div className={styles.reportOptions}>
              {DEFAULT_REPORT_REASONS.map((reason) => (
                <label
                  key={reason}
                  className={styles.reportOption}
                >
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
                {reportSubmitting
                  ? "Se trimite…"
                  : "Trimite raportarea"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
