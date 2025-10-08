// src/components/Cookie/CookieBanner.jsx
import { useEffect, useState } from "react";
import { saveConsent, hasAnyDecision, defaultConsent } from "../../lib/cookieConsent.js";
import styles from "./CookieBanner.module.css"; // creezi un css simplu

export default function CookieBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(!hasAnyDecision());
  }, []);

  if (!open) return null;

  return (
    <div className={styles.bar} role="dialog" aria-label="Setări cookie">
      <div className={styles.text}>
        Folosim cookie-uri pentru a-ți îmbunătăți experiența. Unele sunt strict necesare.
        Poți alege consimțământul pentru statistici și marketing.
        <a href="/politica-cookie" className={styles.link}>Află mai multe</a>.
      </div>
      <div className={styles.actions}>
        <button
          className={styles.btn}
          onClick={() => {
            saveConsent({ ...defaultConsent, analytics: false, marketing: false });
            setOpen(false);
          }}
        >
          Doar necesare
        </button>
        <button
          className={styles.btnPrimary}
          onClick={() => {
            saveConsent({ necessary: true, analytics: true, marketing: true });
            setOpen(false);
          }}
        >
          Accept toate
        </button>
        <a className={styles.btnLink} href="/preferinte-cookie">Preferințe</a>
      </div>
    </div>
  );
}
