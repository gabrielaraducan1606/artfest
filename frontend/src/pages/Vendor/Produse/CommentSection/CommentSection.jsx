// src/pages/ProductDetails/CommentSection/CommentSection.jsx
import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FaEllipsisV,
  FaEdit,
  FaTrash,
  FaFlag,
} from "react-icons/fa";
import { api } from "../../../../lib/api.js";
import styles from "./CommentSection.module.css";

const DEFAULT_REPORT_REASONS = [
  "Conține limbaj vulgar sau ofensator",
  "Conține date personale (telefon, adresă, email etc.)",
  "Spam sau conținut irelevant",
  "Informații false sau înșelătoare",
  "Alt motiv",
];

export default function CommentsSection({
  comments,
  isOwner,
  isLoggedIn,
  onSubmit,              // handler trimis din ProductDetails (submitComment)
  submitting,
  commentText,
  setCommentText,
  currentUserId,
  editingCommentId,
  onStartEditComment,    // (comment) => void
  onCancelEditComment,   // () => void
  onAfterChange,         // () => void  (reload comentarii din backend)
}) {
  const redirect = useMemo(
    () => encodeURIComponent(window.location.pathname + window.location.search),
    []
  );

  const [activeMenuId, setActiveMenuId] = useState(null);

  // raportare
  const [reportingComment, setReportingComment] = useState(null);
  const [reportReasonKey, setReportReasonKey] = useState(
    DEFAULT_REPORT_REASONS[0]
  );
  const [reportNote, setReportNote] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const isMyComment = (c) =>
    currentUserId && c.userId && c.userId === currentUserId;

  const handleEdit = (comment) => {
    onStartEditComment?.(comment);
    setActiveMenuId(null);
  };

  const handleDelete = async (comment) => {
    const ok = window.confirm(
      "Sigur vrei să ștergi acest comentariu? Acțiunea nu poate fi anulată."
    );
    if (!ok) return;

    try {
      await api(`/api/comments/${encodeURIComponent(comment.id)}`, {
        method: "DELETE",
      });
      onAfterChange?.();
    } catch (e) {
      console.error(e);
      alert(e?.message || "Nu am putut șterge comentariul.");
    } finally {
      setActiveMenuId(null);
    }
  };

  // raportare
  const openReportDialog = (comment) => {
    setReportingComment(comment);
    setReportReasonKey(DEFAULT_REPORT_REASONS[0]);
    setReportNote("");
  };

  const closeReportDialog = () => {
    if (reportSubmitting) return;
    setReportingComment(null);
    setReportNote("");
  };

  const handleSendReport = async () => {
    if (!reportingComment) return;
    const base = reportReasonKey || DEFAULT_REPORT_REASONS[0];
    const extra = reportNote.trim();
    const fullReason = extra ? `${base} – ${extra}` : base;

    try {
      setReportSubmitting(true);
      await api(
        `/api/comments/${encodeURIComponent(reportingComment.id)}/report`,
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
      console.error(e);
      alert(e?.message || "Nu am putut trimite raportarea.");
    } finally {
      setReportSubmitting(false);
    }
  };

  const isEditing = !!editingCommentId;

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Întrebări & Comentarii</h2>

      {comments?.length ? (
        <div className={styles.list}>
          {comments.map((c) => (
            <div key={c.id} className={styles.item}>
              <div className={styles.itemTop}>
                <div className={styles.itemHead}>
                  <strong>{c.userName}</strong>
                  <span className={styles.date}>
                    {new Date(c.createdAt).toLocaleString("ro-RO")}
                  </span>
                </div>

                {isLoggedIn && (
                  <div className={styles.itemMenuWrap}>
                    <button
                      type="button"
                      className={styles.menuToggleBtn}
                      onClick={() =>
                        setActiveMenuId(
                          activeMenuId === c.id ? null : c.id
                        )
                      }
                      aria-haspopup="true"
                      aria-expanded={activeMenuId === c.id}
                    >
                      <FaEllipsisV />
                    </button>

                    {activeMenuId === c.id && (
                      <div className={styles.itemMenu}>
                        {isMyComment(c) && (
                          <>
                            <button
                              type="button"
                              className={styles.itemMenuItem}
                              onClick={() => handleEdit(c)}
                            >
                              <FaEdit /> <span>Editează</span>
                            </button>
                            <button
                              type="button"
                              className={styles.itemMenuItemDanger}
                              onClick={() => handleDelete(c)}
                            >
                              <FaTrash /> <span>Șterge</span>
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          className={styles.itemMenuItem}
                          onClick={() => {
                            openReportDialog(c);
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

              <p className={styles.text}>{c.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>Nu sunt comentarii încă.</div>
      )}

      {/* Formular / mesaje de stare */}
      {isOwner ? (
        <p className={styles.muted} role="note" style={{ marginTop: 8 }}>
          Ești proprietarul acestui produs. Nu poți adăuga comentarii la
          propriile produse.
        </p>
      ) : isLoggedIn ? (
        <form onSubmit={onSubmit} className={styles.form}>
          <div className={styles.formHeader}>
            <label className={styles.label} htmlFor="commentText">
              {isEditing ? "Editează comentariul" : "Lasă un comentariu"}
            </label>
            {isEditing && (
              <button
                type="button"
                className={styles.cancelEditBtn}
                onClick={onCancelEditComment}
              >
                Anulează editarea
              </button>
            )}
          </div>

          {isEditing && (
            <p className={styles.editHint}>
              Editezi un comentariu existent. Modificarea va actualiza
              mesajul tău pentru toți vizitatorii.
            </p>
          )}

          <textarea
            id="commentText"
            className={styles.textarea}
            rows={3}
            placeholder="Ai o întrebare despre produs?"
            required
            maxLength={2000}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          <button className={styles.primaryBtn} disabled={submitting}>
            {submitting
              ? "Se trimite…"
              : isEditing
              ? "Salvează modificarea"
              : "Trimite comentariul"}
          </button>
        </form>
      ) : (
        <p className={styles.loginPrompt}>
          Vrei să comentezi?{" "}
          <Link to={`/autentificare?redirect=${redirect}`}>
            Autentifică-te
          </Link>
          .
        </p>
      )}

      {/* ===== Dialog raportare comentariu ===== */}
      {reportingComment && (
        <div
          className={styles.reportOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-comment-title"
        >
          <div className={styles.reportCard}>
            <h3
              id="report-comment-title"
              className={styles.reportTitle}
            >
              Raportează comentariul
            </h3>
            <p className={styles.reportTextMuted}>
              Alege motivul raportării. Te rugăm să folosești opțiunea doar
              pentru încălcări reale (limbaj vulgar, date personale, spam
              etc.).
            </p>

            <div className={styles.reportOptions}>
              {DEFAULT_REPORT_REASONS.map((reason) => (
                <label key={reason} className={styles.reportOption}>
                  <input
                    type="radio"
                    name="reportCommentReason"
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
