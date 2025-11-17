import { useMemo, useState } from "react";
import { FaUserCircle, FaExternalLinkAlt, FaEdit, FaReply, FaTrash } from "react-icons/fa";
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

export default function ReviewsSection({
  rating = 0,
  reviews = [],
  totalCount = 0,
  stats = { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, avg: 0 },
  canWrite = false,
  isVendorView = false,
  me = null,
  onSubmit,            // ({ rating, comment })
  onOptimisticAdd,     // (tempReview)
  onHelpful,
  onReport,
  onChangeQuery,       // ({ sort, filter:{ verified, star }, page })
  onVendorReply,       // async (reviewId, text)
  onVendorDeleteReply, // async (reviewId)
}) {
  const rounded = Math.round(Number(rating || 0));

  const kpi = useMemo(() => {
    if (!reviews?.length) return { responded: 0, unresponded: 0, avg: rating || 0 };
    const responded = reviews.filter(r => !!r.reply).length;
    return { responded, unresponded: totalCount - responded, avg: rating || 0 };
  }, [reviews, totalCount, rating]);

  // draft user review (inline)
  const [draft, setDraft] = useState({ rating: 0, comment: "" });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  async function handleSubmitInline() {
    const e = {};
    if (draft.rating < 1 || draft.rating > 5) e.rating = "Alege 1–5 stele.";
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      setSubmitting(true);
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
      setDraft({ rating: 0, comment: "" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={styles.section} aria-live="polite">
      <h2 className={styles.sectionTitle}>Recenzii</h2>

      <div className={styles.ratingRow}>
        <span className={styles.ratingValue}>{Number(rating || 0).toFixed(1)}</span>
        <RatingsStars value={rounded} />
        <span className={styles.muted}>{totalCount} recenzii</span>
      </div>

      {isVendorView && (
        <div className={styles.kpiStrip}>
          <div className={styles.kpiBox}><strong>{kpi.avg?.toFixed?.(1) ?? Number(kpi.avg).toFixed(1)}</strong><span>Scor mediu</span></div>
          <div className={styles.kpiBox}><strong>{kpi.responded}</strong><span>Cu răspuns</span></div>
          <div className={styles.kpiBox}><strong>{kpi.unresponded}</strong><span>Fără răspuns</span></div>
        </div>
      )}

      <ul className={styles.histogram} role="list" aria-label="Distribuția pe stele">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = stats[`c${star}`] || 0;
          const pct = totalCount ? Math.round((count / totalCount) * 100) : 0;
          return (
            <li key={star} className={styles.histRow}>
              <button className={styles.histLabel} onClick={() => onChangeQuery?.({ filter: { star } })} title={`Filtrează la ${star} stele`}>{star} ★</button>
              <div className={styles.histBar} aria-hidden>
                <div className={styles.histFill} style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.histCount} aria-label={`${count} recenzii cu ${star} stele`}>{count}</span>
            </li>
          );
        })}
      </ul>

      <div className={styles.controls}>
        <select onChange={(e) => onChangeQuery?.({ sort: e.target.value })} className={styles.input} aria-label="Sortează recenziile">
          <option value="relevant">Cele mai utile</option>
          <option value="recent">Cele mai recente</option>
          <option value="rating_desc">Rating descrescător</option>
          <option value="rating_asc">Rating crescător</option>
        </select>
        <label className={styles.checkbox}>
          <input type="checkbox" onChange={(e) => onChangeQuery?.({ filter: { verified: e.target.checked } })} />
          Doar „verificate”
        </label>
        {isVendorView && (
          <label className={styles.checkbox}>
            <input type="checkbox" onChange={(e) => onChangeQuery?.({ filter: { noReply: e.target.checked } })} />
            Doar fără răspuns
          </label>
        )}
      </div>

      {/* listă recenzii */}
      {reviews.map((r) => (
        <div key={r.id} id={`rev-${r.id}`} className={styles.reviewItem}>
          <div className={styles.reviewAvatarWrap}>
            {r.userAvatar ? (
              <img
                src={r.userAvatar}
                className={styles.reviewAvatar}
                alt={r.userName || "Utilizator"}
                onError={(e) => onImgError(e, 48, 48, "")}
              />
            ) : (
              <div className={styles.reviewAvatarPlaceholder}><FaUserCircle /></div>
            )}
          </div>

          <div className={styles.reviewBody}>
            <div className={styles.reviewHeader}>
              <span className={styles.reviewName}>
                {r.userName} {r.verified && <span className={styles.badge}>Verificat</span>}
              </span>
              <RatingsStars value={r.rating} ariaLabel={`${r.rating} din 5 stele`} />
            </div>

            {r.comment && <p className={styles.reviewText}>{r.comment}</p>}

            <div className={styles.reviewMeta}>
              <time title={new Date(r.createdAt).toLocaleString()}>{timeAgo(r.createdAt)}</time>

              {!isVendorView && (
                <>
                  <button className={styles.linkBtn} onClick={() => onHelpful?.(r.id)}>
                    Utilă ({r.helpfulCount || 0})
                  </button>
                  <button className={styles.linkBtn} onClick={() => onReport?.(r.id)}>
                    Raportează
                  </button>
                </>
              )}

              {isVendorView && (
                <div className={styles.vendorActions}>
                  <button
                    className={styles.linkBtn}
                    onClick={() => navigator.clipboard?.writeText(`${location.origin}${location.pathname}#rev-${r.id}`)}
                    title="Copiază link-ul către recenzie"
                  >
                    <FaExternalLinkAlt style={{ marginRight: 6 }} /> Copiază link
                  </button>
                </div>
              )}
            </div>

            {isVendorView ? (
              <details className={styles.replyBox} open={!!r.reply}>
                <summary className={styles.linkBtn}>
                  {r.reply ? (<><FaEdit style={{marginRight:6}}/>Editează răspunsul</>) : (<><FaReply style={{marginRight:6}}/>Răspunde</>)}
                </summary>
                <textarea
                  className={styles.textarea}
                  defaultValue={r.reply?.text || ""}
                  maxLength={1000}
                  onChange={(e) => (r._tmp = e.target.value)}
                  placeholder="Răspunsul tău ca vânzător..."
                  rows={3}
                />
                <div className={styles.replyRow}>
                  <button
                    className={styles.primaryBtn}
                    onClick={async () => {
                      const text = (r._tmp ?? r.reply?.text ?? "").trim();
                      if (!text) return;
                      await onVendorReply?.(r.id, text);
                    }}
                  >
                    Salvează răspunsul
                  </button>
                  {r.reply && (
                    <button className={styles.linkBtn} onClick={() => onVendorDeleteReply?.(r.id)}>
                      <FaTrash style={{ marginRight: 6 }} /> Șterge
                    </button>
                  )}
                </div>
                {r.reply && (
                  <div className={styles.ownerReply}>
                    <strong>Răspunsul vânzătorului</strong>
                    <p>{r.reply.text}</p>
                    <time>{timeAgo(r.reply.createdAt)}</time>
                  </div>
                )}
              </details>
            ) : (
              r.reply && (
                <div className={styles.ownerReply}>
                  <strong>Răspunsul vânzătorului</strong>
                  <p>{r.reply.text}</p>
                  <time>{timeAgo(r.reply.createdAt)}</time>
                </div>
              )
            )}
          </div>
        </div>
      ))}

      {/* Form inline: Scrie o recenzie */}
      {!isVendorView && (
        <div style={{ marginTop: 20 }}>
          {canWrite ? (
            <div id="write-review" className={styles.writeCard}>
              <h3 className={styles.h3}>Scrie o recenzie</h3>
              <div className={styles.writeRow}>
                <RatingsStars
                  value={draft.rating}
                  onChange={(v) => setDraft((s) => ({ ...s, rating: v }))}
                  ariaLabel={`${draft.rating} din 5`}
                />
                {errors.rating && <span className={styles.err}>{errors.rating}</span>}
              </div>
              <textarea
                value={draft.comment}
                onChange={(e) => setDraft((s) => ({ ...s, comment: e.target.value }))}
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
                  {submitting ? "Se trimite…" : "Trimite recenzia"}
                </button>
                <span className={styles.muted}>{draft.comment.length}/2000</span>
              </div>
            </div>
          ) : (
            !me && (
              <p className={styles.loginPrompt}>
                Vrei să lași o recenzie? <a href="/autentificare">Autentifică-te</a> sau{" "}
                <a href="/inregistrare">Creează cont</a>.
              </p>
            )
          )}
        </div>
      )}
    </section>
  );
}
