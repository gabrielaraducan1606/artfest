import styles from "./ProductPublishCheck.module.css";

/*
 * Verificarea de dinainte de publicare (pasul „Publicare”):
 *   - ERORI: blochează publicarea, fiecare cu „Rezolvă” (duce la pasul și
 *     câmpul exact - vezi utils/productPublishCheck.js, `target`);
 *   - RECOMANDĂRI: nu blochează, cu „Vezi”. Include sugestiile AI
 *     (doar subiective) - dacă AI-ul nu răspunde, verificarea de bază
 *     rămâne completă.
 */

function countLabel(count) {
  return count === 1 ? "Mai este 1 lucru de corectat" : `Mai sunt ${count} lucruri de corectat`;
}

function AiStatus({ ai, onRetry }) {
  if (!ai || ai.status === "idle") return null;

  if (ai.status === "loading") {
    return (
      <p className={styles.aiNote} role="status">
        Verificăm și textul produsului…
      </p>
    );
  }

  if (ai.status === "unavailable") {
    return (
      <p className={styles.aiNote} role="status">
        Verificarea automată a textului nu este disponibilă acum. Verificările de bază de mai sus sunt complete.
        {onRetry && ai.reason !== "disabled" && ai.reason !== "not_enough_content" ? (
          <>
            {" "}
            <button type="button" className={styles.inlineLink} onClick={onRetry}>
              Încearcă din nou
            </button>
          </>
        ) : null}
      </p>
    );
  }

  return null;
}

export default function ProductPublishCheck({ check, ai, onResolve, onRetryAi }) {
  const errors = check?.errors || [];
  const aiItems = ai?.status === "done" ? ai.recommendations || [] : [];
  const recommendations = [...(check?.recommendations || []), ...aiItems];

  return (
    <section className={styles.panel} aria-labelledby="publish-check-title" data-publish-check>
      {errors.length ? (
        <>
          <h4 id="publish-check-title" className={styles.titleError}>
            {countLabel(errors.length)}
          </h4>
          <p className={styles.subtitle}>Trebuie rezolvate înainte de publicare:</p>

          <ul className={styles.list} data-publish-errors>
            {errors.map((item) => (
              <li key={`${item.code}|${item.message}`} className={styles.itemError}>
                <span className={styles.icon} aria-hidden="true">
                  ❌
                </span>
                <span className={styles.message}>{item.message}</span>
                <button type="button" className={styles.resolveBtn} onClick={() => onResolve(item.target)}>
                  Rezolvă
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <h4 id="publish-check-title" className={styles.titleReady} data-publish-ready>
          ✅ Produsul este gata pentru publicare.
        </h4>
      )}

      {recommendations.length ? (
        <>
          <p className={styles.subtitle}>Recomandări (nu blochează publicarea):</p>

          <ul className={styles.list} data-publish-recommendations>
            {recommendations.map((item) => (
              <li key={`${item.code}|${item.message}`} className={styles.itemWarn}>
                <span className={styles.icon} aria-hidden="true">
                  ⚠️
                </span>
                <span className={styles.message}>
                  {item.message}
                  {item.code.startsWith("AI_") ? <span className={styles.aiTag}>sugestie automată</span> : null}
                </span>
                {item.target ? (
                  <button type="button" className={styles.viewBtn} onClick={() => onResolve(item.target)}>
                    Vezi
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <AiStatus ai={ai} onRetry={onRetryAi} />
    </section>
  );
}
