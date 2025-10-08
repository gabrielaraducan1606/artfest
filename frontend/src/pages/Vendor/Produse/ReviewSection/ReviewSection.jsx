import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import styles from "./ReviewSection.module.css";

export default function ReviewsSection({
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
  const average = Number(avg?.average || 0);
  const count = Number(avg?.count || 0);

  // redirect pentru login -> revine la produs după autentificare
  const redirect = useMemo(
    () => encodeURIComponent(window.location.pathname + window.location.search),
    []
  );

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>
        Recenzii <span className={styles.muted}>({count})</span>
      </h2>

      <div className={styles.summaryRow}>
        <span className={styles.avg} aria-label={`Rating mediu ${average.toFixed(1)} din 5`}>
          {average.toFixed(1)}
        </span>
        <span className={styles.stars} aria-hidden="true">
          {[...Array(5)].map((_, i) => (
            <span
              key={i}
              className={i < Math.round(average) ? styles.starFull : styles.starEmpty}
              title={`${i + 1} stele`}
            >
              ★
            </span>
          ))}
        </span>
      </div>

      {reviews?.length ? (
        <div className={styles.list}>
          {reviews.map((r) => (
            <div key={r.id} className={styles.item}>
              <div className={styles.itemHead}>
                <strong>{r.userName}</strong>
                <span className={styles.itemStars} aria-label={`${r.rating} din 5`}>
                  {[...Array(5)].map((_, i) => (
                    <span key={i} className={i < r.rating ? styles.starFull : styles.starEmpty}>★</span>
                  ))}
                </span>
              </div>
              {r.comment && <p className={styles.text}>{r.comment}</p>}
              <div className={styles.meta}>
                {new Date(r.createdAt).toLocaleDateString("ro-RO")}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>Fii primul care lasă o recenzie.</div>
      )}

      {/* Formular / mesaje de stare */}
      {isOwner ? (
        <p className={styles.muted} role="note" style={{ marginTop: 8 }}>
          Ești proprietarul acestui produs. Nu poți adăuga recenzii pentru propriile produse.
        </p>
      ) : isLoggedIn ? (
        <form onSubmit={onSubmit} className={styles.form}>
          <label className={styles.label} htmlFor="revRating">Rating</label>
          <select
            id="revRating"
            className={styles.input}
            value={revRating}
            onChange={(e) => setRevRating(parseInt(e.target.value, 10))}
            required
          >
            <option value={0}>Alege…</option>
            {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} stele</option>)}
          </select>

          <label className={styles.label} htmlFor="revText">Comentariu (opțional)</label>
          <textarea
            id="revText"
            className={styles.textarea}
            rows={4}
            placeholder="Cum ți s-a părut produsul?"
            value={revText}
            onChange={(e) => setRevText(e.target.value)}
          />
          <button className={styles.primaryBtn} disabled={submitting}>
            {submitting ? "Se trimite…" : "Trimite recenzia"}
          </button>
        </form>
      ) : (
        <p className={styles.loginPrompt}>
          Vrei să lași o recenzie?{" "}
          <Link to={`/autentificare?redirect=${redirect}`}>Autentifică-te</Link>.
        </p>
      )}
    </section>
  );
}
