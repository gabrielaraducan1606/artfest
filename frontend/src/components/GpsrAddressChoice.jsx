// src/components/GpsrAddressChoice.jsx
//
// Explicația adresei poștale GPSR, sub câmpul de adresă (children): o frază
// scurtă vizibilă + „De ce este necesară adresa?” (extensibil) + ajutorul
// pentru cine nu are încă o adresă (`helpActions`, extensibil). Câmpul rămâne
// mereu vizibil; componenta nu citește, nu completează și nu golește adrese.
// Folosită în Smart Listing (profilul de producător) și în ProductModal.

import {
  GPSR_ADDRESS_SHORT_NOTE,
  GPSR_ADDRESS_WHY_LABEL,
  GPSR_ADDRESS_WHY_TEXT,
  GPSR_NO_ADDRESS_EXPLANATION,
  GPSR_NO_ADDRESS_LABEL,
} from "../utils/gpsrHomeAddress.js";
import styles from "./GpsrAddressChoice.module.css";

export default function GpsrAddressChoice({ children, helpActions = null }) {
  return (
    <div className={styles.wrap} data-testid="gpsr-address-choice">
      {children}

      <p className={styles.note} data-testid="gpsr-address-note">
        {GPSR_ADDRESS_SHORT_NOTE}
      </p>

      <details className={styles.more} data-testid="gpsr-address-why">
        <summary>{GPSR_ADDRESS_WHY_LABEL}</summary>
        {GPSR_ADDRESS_WHY_TEXT.map((line) => (
          <p key={line} className={styles.moreText}>
            {line}
          </p>
        ))}
      </details>

      {helpActions && (
        <details className={styles.more} data-testid="gpsr-no-address">
          <summary>{GPSR_NO_ADDRESS_LABEL}</summary>
          <p className={styles.moreText}>{GPSR_NO_ADDRESS_EXPLANATION}</p>
          {helpActions}
        </details>
      )}
    </div>
  );
}
