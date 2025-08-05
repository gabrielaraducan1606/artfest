import styles from "./FAQ.module.css";

export default function FAQ({ data = {} }) {
  // acceptă fie [{q,a}], fie array de stringuri
  const items = Array.isArray(data.faq) ? data.faq : [];

  return (
    <div className={styles.pageContainer} id="faq">
      <h1 className={styles.pageTitle}>Întrebări frecvente</h1>

      {items.length === 0 ? (
        <p>Nu au fost adăugate întrebări încă.</p>
      ) : (
        <ul className={styles.list}>
          {items.map((it, i) => (
            <li key={i} className={styles.item}>
              {typeof it === "string" ? (
                it
              ) : (
                <>
                  <strong>{it.q}</strong>
                  {it.a ? <div className={styles.answer}>{it.a}</div> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
