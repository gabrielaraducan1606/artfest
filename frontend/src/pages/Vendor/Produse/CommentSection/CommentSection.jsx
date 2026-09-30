// src/pages/ProductDetails/CommentSection/CommentSection.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FaEllipsisV,
  FaEdit,
  FaTrash,
  FaFlag,
  FaCopy,
  FaReply,
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

// coduri de eroare backend (commentProductRoutes.js) -> mesaje pentru UI
const ERROR_MESSAGES = {
  text_required: "Scrie un mesaj înainte să trimiți.",
  product_not_accepting_comments:
    "Produsul nu mai acceptă întrebări noi în acest moment.",
  cannot_comment_own_product:
    "Ești proprietarul produsului - poți doar răspunde la întrebări.",
  reply_vendor_only: "Doar vânzătorul produsului poate răspunde.",
  vendor_reply_exists:
    "Ai răspuns deja la această întrebare. Poți edita răspunsul existent.",
  parent_comment_not_found: "Întrebarea nu mai este disponibilă.",
  comment_not_found: "Mesajul nu mai este disponibil.",
  comment_not_active: "Mesajul a fost ascuns de moderare și nu mai poate fi editat.",
  cannot_report_own_comment: "Nu îți poți raporta propriul mesaj.",
  forbidden: "Nu ai permisiunea pentru această acțiune.",
  unauthenticated: "Sesiunea a expirat. Autentifică-te din nou.",
};

function errorMessage(e, fallback) {
  return ERROR_MESSAGES[e?.code] || fallback;
}

const shortDateFormatter = new Intl.DateTimeFormat("ro-RO", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatShortDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : shortDateFormatter.format(d);
}

function isEdited(c) {
  if (!c?.updatedAt || !c?.createdAt) return false;
  return new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime() > 1000;
}

export default function CommentsSection({
  productId,
  comments,
  onCommentsChange, // (updater) => void - setState din ProductDetails
  total,
  onQuestionCountChange, // (delta) => void - întrebare nouă (+1) / ștearsă (-1)
  loading,
  error,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
  acceptsNewComments = true,
  isOwner,
  isLoggedIn,
  currentUserId,
}) {
  const location = useLocation();
  const redirect = encodeURIComponent(location.pathname + location.search);

  const [activeMenuId, setActiveMenuId] = useState(null);

  // întrebare nouă
  const [newText, setNewText] = useState("");
  const [newSubmitting, setNewSubmitting] = useState(false);
  const [formNotice, setFormNotice] = useState(null);

  // răspuns vendor (inline)
  const [replyingToId, setReplyingToId] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);

  // editare inline (autorul mesajului)
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  // mesaj (eroare/succes) atașat unui element din listă
  const [itemNotice, setItemNotice] = useState(null); // { id, type, text }

  // raportare
  const [reportingComment, setReportingComment] = useState(null);
  const [reportReasonKey, setReportReasonKey] = useState(
    DEFAULT_REPORT_REASONS[0]
  );
  const [reportNote, setReportNote] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState("");

  const list = useMemo(() => comments || [], [comments]);

  const isMine = (c) =>
    !!currentUserId && !!c?.userId && c.userId === currentUserId;

  /* ===== meniu 3 puncte: închidere la click în afară / Escape ===== */
  const menuRootRef = useRef(null);
  useEffect(() => {
    if (!activeMenuId) return undefined;

    const onPointerDown = (e) => {
      if (menuRootRef.current && !menuRootRef.current.contains(e.target)) {
        setActiveMenuId(null);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") setActiveMenuId(null);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [activeMenuId]);

  /* ===== dialog raportare: Escape închide ===== */
  useEffect(() => {
    if (!reportingComment) return undefined;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !reportSubmitting) setReportingComment(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [reportingComment, reportSubmitting]);

  /* ===== link direct #comment-<id> (ex. din notificare) ===== */
  const [highlightId, setHighlightId] = useState(null);
  const scrolledHashRef = useRef(null);
  useEffect(() => {
    const hash = location.hash || "";
    if (!hash.startsWith("#comment-")) return undefined;
    if (scrolledHashRef.current === hash) return undefined;

    let targetId;
    try {
      targetId = decodeURIComponent(hash.slice("#comment-".length));
    } catch {
      return undefined;
    }

    const el = document.getElementById(`comment-${targetId}`);
    if (!el) return undefined;

    scrolledHashRef.current = hash;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(targetId);
    const t = setTimeout(() => setHighlightId(null), 2400);
    return () => clearTimeout(t);
  }, [location.hash, list]);

  /* ===== helpers pentru actualizarea listei locale ===== */
  const updateThreads = (updater) => onCommentsChange?.(updater);

  const replaceComment = (updated) => {
    updateThreads((prev) =>
      (prev || []).map((q) =>
        q.id === updated.id
          ? { ...q, ...updated, replies: q.replies || [] }
          : {
              ...q,
              replies: (q.replies || []).map((r) =>
                r.id === updated.id ? { ...r, ...updated } : r
              ),
            }
      )
    );
  };

  /* ===== întrebare nouă ===== */
  const submitNew = async (e) => {
    e.preventDefault();
    const text = newText.trim();
    if (!text) {
      setFormNotice({ type: "error", text: ERROR_MESSAGES.text_required });
      return;
    }

    try {
      setNewSubmitting(true);
      setFormNotice(null);
      const res = await api("/api/comments", {
        method: "POST",
        body: { productId, text },
      });

      if (res?.comment) {
        updateThreads((prev) => [
          { ...res.comment, replies: [] },
          ...(prev || []).filter((q) => q.id !== res.comment.id),
        ]);
        onQuestionCountChange?.(1);
      }
      setNewText("");
      setFormNotice({
        type: "success",
        text: "Întrebarea ta a fost publicată. Vânzătorul a fost notificat.",
      });
    } catch (err) {
      console.error(err);
      setFormNotice({
        type: "error",
        text: errorMessage(err, "Nu am putut trimite mesajul. Încearcă din nou."),
      });
    } finally {
      setNewSubmitting(false);
    }
  };

  /* ===== răspuns vendor ===== */
  const startReply = (question) => {
    setEditingId(null);
    setItemNotice(null);
    setReplyingToId(question.id);
    setReplyText("");
  };

  const cancelReply = () => {
    setReplyingToId(null);
    setReplyText("");
  };

  const submitReply = async (question) => {
    const text = replyText.trim();
    if (!text) {
      setItemNotice({ id: question.id, type: "error", text: ERROR_MESSAGES.text_required });
      return;
    }

    try {
      setReplySubmitting(true);
      setItemNotice(null);
      const res = await api("/api/comments", {
        method: "POST",
        body: { productId, text, parentId: question.id },
      });

      if (res?.comment) {
        updateThreads((prev) =>
          (prev || []).map((q) =>
            q.id === question.id
              ? { ...q, replies: [...(q.replies || []), res.comment] }
              : q
          )
        );
      }
      cancelReply();
    } catch (err) {
      console.error(err);
      setItemNotice({
        id: question.id,
        type: "error",
        text: errorMessage(err, "Nu am putut trimite răspunsul. Încearcă din nou."),
      });
    } finally {
      setReplySubmitting(false);
    }
  };

  /* ===== editare inline ===== */
  const startEdit = (c) => {
    setReplyingToId(null);
    setItemNotice(null);
    setActiveMenuId(null);
    setEditingId(c.id);
    setEditText(c.text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const submitEdit = async (c) => {
    const text = editText.trim();
    if (!text) {
      setItemNotice({ id: c.id, type: "error", text: ERROR_MESSAGES.text_required });
      return;
    }

    try {
      setEditSubmitting(true);
      setItemNotice(null);
      const res = await api(`/api/comments/${encodeURIComponent(c.id)}`, {
        method: "PATCH",
        body: { text },
      });
      replaceComment(res?.comment || { id: c.id, text });
      cancelEdit();
    } catch (err) {
      console.error(err);
      setItemNotice({
        id: c.id,
        type: "error",
        text: errorMessage(err, "Nu am putut salva modificarea. Încearcă din nou."),
      });
    } finally {
      setEditSubmitting(false);
    }
  };

  /* ===== ștergere ===== */
  const handleDelete = async (c) => {
    setActiveMenuId(null);
    const isQuestion = !c.parentId;
    const ok = window.confirm(
      isQuestion
        ? "Sigur vrei să ștergi întrebarea? Se vor șterge și răspunsurile ei. Acțiunea nu poate fi anulată."
        : "Sigur vrei să ștergi răspunsul? Acțiunea nu poate fi anulată."
    );
    if (!ok) return;

    try {
      setItemNotice(null);
      await api(`/api/comments/${encodeURIComponent(c.id)}`, {
        method: "DELETE",
      });

      if (isQuestion) {
        updateThreads((prev) => (prev || []).filter((q) => q.id !== c.id));
        onQuestionCountChange?.(-1);
      } else {
        updateThreads((prev) =>
          (prev || []).map((q) =>
            q.id === c.parentId
              ? { ...q, replies: (q.replies || []).filter((r) => r.id !== c.id) }
              : q
          )
        );
      }
      if (editingId === c.id) cancelEdit();
    } catch (err) {
      console.error(err);
      setItemNotice({
        id: c.id,
        type: "error",
        text: errorMessage(err, "Nu am putut șterge mesajul. Încearcă din nou."),
      });
    }
  };

  /* ===== copiere ===== */
  const handleCopy = async (c) => {
    setActiveMenuId(null);
    try {
      await navigator.clipboard.writeText(c.text || "");
      setItemNotice({ id: c.id, type: "success", text: "Text copiat." });
    } catch {
      setItemNotice({ id: c.id, type: "error", text: "Nu am putut copia textul." });
    }
  };

  /* ===== raportare ===== */
  const openReportDialog = (c) => {
    setActiveMenuId(null);
    setReportingComment(c);
    setReportReasonKey(DEFAULT_REPORT_REASONS[0]);
    setReportNote("");
    setReportError("");
  };

  const closeReportDialog = () => {
    if (reportSubmitting) return;
    setReportingComment(null);
    setReportNote("");
    setReportError("");
  };

  const handleSendReport = async () => {
    if (!reportingComment) return;

    const base = reportReasonKey || DEFAULT_REPORT_REASONS[0];
    const extra = reportNote.trim();
    const fullReason = extra ? `${base} – ${extra}` : base;

    try {
      setReportSubmitting(true);
      setReportError("");
      await api(
        `/api/comments/${encodeURIComponent(reportingComment.id)}/report`,
        { method: "POST", body: { reason: fullReason } }
      );
      setItemNotice({
        id: reportingComment.id,
        type: "success",
        text: "Mulțumim! Raportarea a fost înregistrată și va fi verificată.",
      });
      setReportingComment(null);
      setReportNote("");
    } catch (err) {
      console.error(err);
      setReportError(errorMessage(err, "Nu am putut trimite raportarea."));
    } finally {
      setReportSubmitting(false);
    }
  };

  /* ===== randare ===== */
  const renderNotice = (id) =>
    itemNotice && itemNotice.id === id ? (
      <p
        className={
          itemNotice.type === "error" ? styles.noticeError : styles.noticeSuccess
        }
        role={itemNotice.type === "error" ? "alert" : "status"}
      >
        {itemNotice.text}
      </p>
    ) : null;

  const renderMenu = (c, label) => {
    const canReport = isLoggedIn && !isMine(c);
    return (
      <div
        className={styles.itemMenuWrap}
        ref={activeMenuId === c.id ? menuRootRef : undefined}
      >
        <button
          type="button"
          className={styles.menuToggleBtn}
          onClick={() => setActiveMenuId(activeMenuId === c.id ? null : c.id)}
          aria-haspopup="menu"
          aria-expanded={activeMenuId === c.id}
          aria-label={label}
          title={label}
        >
          <FaEllipsisV aria-hidden="true" />
        </button>

        {activeMenuId === c.id && (
          <div className={styles.itemMenu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.itemMenuItem}
              onClick={() => handleCopy(c)}
            >
              <FaCopy aria-hidden="true" /> <span>Copiază textul</span>
            </button>
            {canReport && (
              <button
                type="button"
                role="menuitem"
                className={styles.itemMenuItem}
                onClick={() => openReportDialog(c)}
              >
                <FaFlag aria-hidden="true" /> <span>Raportează</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderEditor = (c) => (
    <div className={styles.inlineEditor}>
      <textarea
        className={styles.textarea}
        rows={3}
        maxLength={2000}
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        disabled={editSubmitting}
        aria-label={c.parentId ? "Editează răspunsul" : "Editează întrebarea"}
        autoFocus
      />
      <div className={styles.editorActions}>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={cancelEdit}
          disabled={editSubmitting}
        >
          Anulează
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => submitEdit(c)}
          disabled={editSubmitting}
        >
          {editSubmitting ? "Se salvează…" : "Salvează"}
        </button>
      </div>
    </div>
  );

  const renderOwnActions = (c) => (
    <div className={styles.inlineActions}>
      <button type="button" className={styles.linkBtn} onClick={() => startEdit(c)}>
        <FaEdit aria-hidden="true" /> <span>Editează</span>
      </button>
      <button
        type="button"
        className={styles.linkBtnDanger}
        onClick={() => handleDelete(c)}
      >
        <FaTrash aria-hidden="true" /> <span>Șterge</span>
      </button>
    </div>
  );

  const renderList = () => {
    if (loading) {
      return (
        <div className={styles.stateBox} role="status" aria-live="polite">
          Se încarcă întrebările…
        </div>
      );
    }

    if (error) {
      return (
        <div className={styles.stateBoxError} role="alert">
          <span>Nu am putut încărca întrebările.</span>
          {onRetry && (
            <button type="button" className={styles.ghostBtn} onClick={onRetry}>
              Reîncearcă
            </button>
          )}
        </div>
      );
    }

    if (!list.length) {
      return (
        <div className={styles.empty}>
          {isOwner
            ? "Nu există încă întrebări pentru acest produs."
            : "Nu există încă întrebări. Fii primul care întreabă vânzătorul."}
        </div>
      );
    }

    return (
      <>
        <ul className={styles.list}>
          {list.map((q) => {
            const replies = q.replies || [];
            const hasVendorReply = replies.some((r) => r.isVendorReply);
            const canReply = isOwner && isLoggedIn && !hasVendorReply;

            return (
              <li
                key={q.id}
                id={`comment-${q.id}`}
                className={`${styles.item} ${
                  highlightId === q.id ? styles.itemHighlight : ""
                }`}
              >
                <div className={styles.itemTop}>
                  <div className={styles.itemHead}>
                    <span className={styles.author}>{q.userName}</span>
                    <span className={styles.dot} aria-hidden="true">
                      ·
                    </span>
                    <time className={styles.date} dateTime={q.createdAt}>
                      {formatShortDate(q.createdAt)}
                    </time>
                    {isEdited(q) && <span className={styles.edited}>editat</span>}
                  </div>
                  {renderMenu(q, "Opțiuni întrebare")}
                </div>

                {editingId === q.id ? (
                  renderEditor(q)
                ) : (
                  <>
                    <p className={styles.text}>{q.text}</p>
                    {isMine(q) && renderOwnActions(q)}
                  </>
                )}
                {renderNotice(q.id)}

                {replies.length > 0 && (
                  <ul className={styles.replies}>
                    {replies.map((r) => (
                      <li
                        key={r.id}
                        id={`comment-${r.id}`}
                        className={`${styles.replyItem} ${
                          highlightId === r.id ? styles.itemHighlight : ""
                        }`}
                      >
                        <div className={styles.itemTop}>
                          <div className={styles.itemHead}>
                            <span className={styles.author}>{r.userName}</span>
                            {r.isVendorReply && (
                              <span className={styles.vendorBadge}>Vânzător</span>
                            )}
                            <span className={styles.dot} aria-hidden="true">
                              ·
                            </span>
                            <time className={styles.date} dateTime={r.createdAt}>
                              {formatShortDate(r.createdAt)}
                            </time>
                            {isEdited(r) && (
                              <span className={styles.edited}>editat</span>
                            )}
                          </div>
                          {renderMenu(r, "Opțiuni răspuns")}
                        </div>

                        {editingId === r.id ? (
                          renderEditor(r)
                        ) : (
                          <>
                            <p className={styles.text}>{r.text}</p>
                            {isMine(r) && renderOwnActions(r)}
                          </>
                        )}
                        {renderNotice(r.id)}
                      </li>
                    ))}
                  </ul>
                )}

                {canReply &&
                  (replyingToId === q.id ? (
                    <div className={styles.inlineEditor}>
                      <textarea
                        className={styles.textarea}
                        rows={3}
                        maxLength={2000}
                        placeholder="Scrie răspunsul tău ca vânzător…"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        disabled={replySubmitting}
                        aria-label="Răspuns ca vânzător"
                        autoFocus
                      />
                      <div className={styles.editorActions}>
                        <button
                          type="button"
                          className={styles.ghostBtn}
                          onClick={cancelReply}
                          disabled={replySubmitting}
                        >
                          Anulează
                        </button>
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          onClick={() => submitReply(q)}
                          disabled={replySubmitting}
                        >
                          {replySubmitting ? "Se trimite…" : "Trimite răspunsul"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.replyBtn}
                      onClick={() => startReply(q)}
                    >
                      <FaReply aria-hidden="true" /> <span>Răspunde</span>
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>

        {hasMore && (
          <div className={styles.loadMoreRow}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore
                ? "Se încarcă…"
                : `Mai multe întrebări${
                    Number(total) > list.length
                      ? ` (${Number(total) - list.length})`
                      : ""
                  }`}
            </button>
          </div>
        )}
      </>
    );
  };

  const renderForm = () => {
    if (isOwner) {
      return (
        <p className={styles.ownerNote} role="note">
          Produsul tău - poți răspunde la întrebările clienților.
        </p>
      );
    }

    if (!acceptsNewComments) {
      return (
        <p className={styles.ownerNote} role="note">
          Produsul nu mai acceptă întrebări noi în acest moment.
        </p>
      );
    }

    if (!isLoggedIn) {
      return (
        <p className={styles.loginPrompt}>
          Ai o întrebare?{" "}
          <Link to={`/autentificare?redirect=${redirect}`}>Autentifică-te</Link>{" "}
          ca să o trimiți vânzătorului.
        </p>
      );
    }

    return (
      <form onSubmit={submitNew} className={styles.form}>
        <label className={styles.label} htmlFor={`commentText-${productId}`}>
          Pune o întrebare
        </label>
        <textarea
          id={`commentText-${productId}`}
          className={styles.textarea}
          rows={3}
          placeholder="Ai o întrebare despre produs? Vânzătorul îți va răspunde aici."
          maxLength={2000}
          value={newText}
          onChange={(e) => {
            setNewText(e.target.value);
            if (formNotice?.type === "error") setFormNotice(null);
          }}
          disabled={newSubmitting}
        />
        {formNotice && (
          <p
            className={
              formNotice.type === "error" ? styles.noticeError : styles.noticeSuccess
            }
            role={formNotice.type === "error" ? "alert" : "status"}
          >
            {formNotice.text}
          </p>
        )}
        <div className={styles.formActions}>
          <button type="submit" className={styles.primaryBtn} disabled={newSubmitting}>
            {newSubmitting ? "Se trimite…" : "Trimite întrebarea"}
          </button>
        </div>
      </form>
    );
  };

  return (
    <section className={styles.section}>
      {renderList()}
      {renderForm()}

      {/* ===== Dialog raportare ===== */}
      {reportingComment && (
        <div
          className={styles.reportOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-comment-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeReportDialog();
          }}
        >
          <div className={styles.reportCard}>
            <h3 id="report-comment-title" className={styles.reportTitle}>
              Raportează mesajul
            </h3>
            <p className={styles.reportTextMuted}>
              Alege motivul raportării. Folosește opțiunea doar pentru încălcări
              reale (limbaj vulgar, date personale, spam etc.).
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
              aria-label="Detalii raportare"
            />

            {reportError && (
              <p className={styles.noticeError} role="alert">
                {reportError}
              </p>
            )}

            <div className={styles.reportActions}>
              <button
                type="button"
                className={styles.ghostBtn}
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
    </section>
  );
}
