import styles from "./WhereWhen.module.css";

export default function WhereWhen({ data = {} }) {
  const ceremony = data?.ceremony || {};
  const party = data?.party || {};

  return (
    <div className={styles.pageContainer} id="wherewhen">
      <h1 className={styles.pageTitle}>Unde & Când</h1>

      <div className={styles.cardsContainer}>
        <div className={styles.card}>
          <h3>{ceremony.name || "Ceremonie"}</h3>
          <p>{ceremony.address}</p>
          <p>{ceremony.time}</p>
          {ceremony.mapUrl && <a href={ceremony.mapUrl} target="_blank" rel="noreferrer">Vezi pe hartă</a>}
        </div>

        <div className={styles.card}>
          <h3>{party.name || "Petrecere"}</h3>
          <p>{party.address}</p>
          <p>{party.time}</p>
          {party.mapUrl && <a href={party.mapUrl} target="_blank" rel="noreferrer">Vezi pe hartă</a>}
        </div>
      </div>
    </div>
  );
}
