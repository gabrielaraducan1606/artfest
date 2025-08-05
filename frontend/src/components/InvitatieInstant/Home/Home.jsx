import styles from "./Home.module.css";

export default function Home({ data = {} }) {
  const groom = data?.couple?.groom || "Nume Mire";
  const bride = data?.couple?.bride || "Nume Mireasă";
  const date = data?.date || "2025-05-17";
  const city = data?.city || "Buzău";

  return (
    <div className={styles.pageContainer} id="home">
      <h1 className={styles.pageTitle}>{bride} & {groom}</h1>
      <p className={styles.pageContent}>
        {new Date(date).toLocaleDateString("ro-RO", { day:"2-digit", month:"long", year:"numeric" })} – {city}, România
      </p>
    </div>
  );
}
