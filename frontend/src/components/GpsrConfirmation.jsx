// src/components/GpsrConfirmation.jsx
//
// Declarația GPSR a vânzătorului pentru UN produs, la publicare. Singura bifă
// GPSR din formular. Serverul înregistrează cine, când, pentru ce produs și
// ce versiune - browserul trimite doar acordul și versiunea afișată.
// `reason` = de ce se cere (reconfirmare); `note` = ce mai acoperă bifa
// (de exemplu actualizarea datelor centrale de producător).

import { GPSR_CONFIRMATION_TEXT, GPSR_NOTICE_VERSION } from "../utils/gpsrNotice.js";
import styles from "./GpsrConfirmation.module.css";

export default function GpsrConfirmation({ checked, onChange, reason = "", note = "", showError = false, disabled = false }) {
  return (
    <div
      className={`${styles.box} ${showError && !checked ? styles.boxError : ""}`}
      data-testid="gpsr-confirmation"
      data-version={GPSR_NOTICE_VERSION}
    >
      {reason ? <p className={styles.reason}>{reason}</p> : null}
      <label className={styles.label}>
        <input
          type="checkbox"
          checked={checked === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{GPSR_CONFIRMATION_TEXT}</span>
      </label>
      {note ? <p className={styles.note}>{note}</p> : null}
      <p className={styles.meta}>Se înregistrează la publicare. Nu e necesară pentru ciornele private.</p>
      {showError && !checked ? (
        <p className={styles.error} role="alert">
          Bifează confirmarea GPSR pentru a publica produsul.
        </p>
      ) : null}
    </div>
  );
}
