import { useInvitation } from "../../../../../invitation/useInvitation";
import styles from "./TabForms.module.css";

export function WhereWhenForm() {
  const { data, update } = useInvitation();

  return (
    <div className={styles.form}>
      <h2>Unde & Când</h2>
      <label>Oraș</label>
      <input
        value={data.city}
        onChange={(e) => update("city", e.target.value)}
      />

      <h3>Ceremonie</h3>
      <input
        placeholder="Nume locație"
        value={data.ceremony.name}
        onChange={(e) => update("ceremony.name", e.target.value)}
      />
      <input
        placeholder="Adresă"
        value={data.ceremony.address}
        onChange={(e) => update("ceremony.address", e.target.value)}
      />
      <input
        placeholder="Link Google Maps"
        value={data.ceremony.mapUrl}
        onChange={(e) => update("ceremony.mapUrl", e.target.value)}
      />

      <h3>Restaurant</h3>
      <input
        placeholder="Nume locație"
        value={data.party.name}
        onChange={(e) => update("party.name", e.target.value)}
      />
      <input
        placeholder="Adresă"
        value={data.party.address}
        onChange={(e) => update("party.address", e.target.value)}
      />
      <input
        placeholder="Link Google Maps"
        value={data.party.mapUrl}
        onChange={(e) => update("party.mapUrl", e.target.value)}
      />
    </div>
  );
}
