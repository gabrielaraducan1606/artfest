import { useInvitation } from "../../../../../invitation/useInvitation";
import styles from "./TabForms.module.css";

export function RSVPForm() {
  const { data, update } = useInvitation();
  return (
    <div className={styles.form}>
      <h2>RSVP</h2>
      <label>Telefon</label>
      <input
        value={data.rsvp.phone}
        onChange={(e) => update("rsvp.phone", e.target.value)}
      />
      <label>Termen limită</label>
      <input
        type="date"
        value={data.rsvp.deadline}
        onChange={(e) => update("rsvp.deadline", e.target.value)}
      />
      <label>Link formular extern</label>
      <input
        placeholder="https://..."
        value={data.rsvp.link}
        onChange={(e) => update("rsvp.link", e.target.value)}
      />
    </div>
  );
}
