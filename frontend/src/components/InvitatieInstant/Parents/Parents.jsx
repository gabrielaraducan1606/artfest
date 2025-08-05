import styles from "./Parents.module.css";

export default function Parents({ data = {} }) {
  // suportă fie array de stringuri, fie obiecte {name, side: "mire"/"mireasă", note}
  const list = Array.isArray(data.parents) ? data.parents : [];

  return (
    <div className={styles.pageContainer} id="parents">
      <h1 className={styles.pageTitle}>Părinți</h1>

      {list.length === 0 ? (
        <p>Adaugă informații despre părinți din editor.</p>
      ) : (
        <ul className={styles.list}>
          {list.map((p, i) => (
            <li key={i} className={styles.item}>
              {typeof p === "string" ? (
                p
              ) : (
                <>
                  <strong>{p.name || "Nume părinte"}</strong>
                  {p.side ? <em className={styles.side}> — {p.side}</em> : null}
                  {p.note ? <div className={styles.note}>{p.note}</div> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
