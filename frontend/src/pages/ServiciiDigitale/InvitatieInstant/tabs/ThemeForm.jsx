import { useInvitation } from "../../../../../invitation/useInvitation";
import styles from "./TabForms.module.css";

const THEMES = [
  { value: "classic", label: "Clasic (crem + mentă + bej)" },
  { value: "modern",  label: "Modern (albastru + roz)" },
  { value: "boho",    label: "Boho (warm, serif)" },
];

export default function ThemeForm() {
  const { data, update } = useInvitation();

  return (
    <div className={styles.form}>
      <h2>Selectează tema</h2>
      <p className={styles.help}>Schimbă aspectul invitației instant.</p>

      <div className={styles.themeOptions}>
        {THEMES.map((t) => (
          <label key={t.value} className={styles.themeOption}>
            <input
              type="radio"
              name="theme"
              value={t.value}
              checked={(data.theme || "classic") === t.value}
              onChange={(e) => update("theme", e.target.value)}
            />
            {t.label}
          </label>
        ))}
      </div>
    </div>
  );
}
