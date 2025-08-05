import { useInvitation } from "../../../../../invitation/useInvitation";
import styles from "./TabForms.module.css";

export function CountdownForm() {
  const { data } = useInvitation();
  return (
    <div className={styles.form}>
      <h2>Countdown</h2>
      <p>Data evenimentului: {data.date || "Nu este setată"}</p>
      <p>Contorul se va calcula automat în preview.</p>
    </div>
  );
}
