import styles from "./GodParents.module.css";

/**
 * Afișează lista de nași.
 * Acceptă fie array de stringuri, fie obiecte { name?: string, note?: string }.
 * props.data.godparents?: (string | {name?: string, note?: string})[]
 */
export default function GodParents({ data = {} }) {
  const list = Array.isArray(data?.godparents) ? data.godparents : [];

  return (
    <div className={styles.pageContainer} id="godparents">
      <h1 className={styles.pageTitle}>Nași</h1>

      {list.length === 0 ? (
        <p>Adaugă informații despre nași din editor.</p>
      ) : (
        <ul className={styles.list}>
          {list.map((gp, i) => (
            <li key={i} className={styles.item}>
              {typeof gp === "string" ? (
                gp
              ) : (
                <>
                  <strong>{gp?.name || "Nume naș"}</strong>
                  {gp?.note ? <div className={styles.note}>{gp.note}</div> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
