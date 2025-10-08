import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import styles from "./CommentSection.module.css";

export default function CommentsSection({
  comments,
  isOwner,
  isLoggedIn,
  onSubmit,
  submitting,
  commentText,
  setCommentText,
}) {
  const redirect = useMemo(
    () => encodeURIComponent(window.location.pathname + window.location.search),
    []
  );

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Întrebări & Comentarii</h2>

      {comments?.length ? (
        <div className={styles.list}>
          {comments.map((c) => (
            <div key={c.id} className={styles.item}>
              <div className={styles.itemHead}>
                <strong>{c.userName}</strong>
                <span className={styles.date}>
                  {new Date(c.createdAt).toLocaleString("ro-RO")}
                </span>
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
          Ești proprietarul acestui produs. Nu poți adăuga comentarii la propriile produse.
        </p>
      ) : isLoggedIn ? (
        <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.label} htmlFor="commentText">Lasă un comentariu</label>
          <textarea
            id="commentText"
            className={styles.textarea}
            rows={3}
            placeholder="Ai o întrebare despre produs?"
            required
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          <button className={styles.primaryBtn} disabled={submitting}>
            {submitting ? "Se trimite…" : "Trimite comentariul"}
          </button>
        </form>
      ) : (
        <p className={styles.loginPrompt}>
          Vrei să comentezi?{" "}
          <Link to={`/autentificare?redirect=${redirect}`}>Autentifică-te</Link>.
        </p>
      )}
    </section>
  );
}
