import styles from "./Form.module.css";

export default function Form({ data = {} }) {
  const phone = data?.rsvp?.phone || "";
  const deadline = data?.rsvp?.deadline || "";
  const link = data?.rsvp?.link || "";

  return (
    <div className={styles.pageContainer} id="rsvp">
      <h1 className={styles.pageTitle}>RSVP</h1>
      {link ? (
        <a className={styles.btn} href={link} target="_blank" rel="noreferrer">Completează RSVP</a>
      ) : (
        <p>Sunați la: <strong>{phone || "—"}</strong> până la <strong>{deadline || "—"}</strong></p>
      )}
    </div>
  );
}
