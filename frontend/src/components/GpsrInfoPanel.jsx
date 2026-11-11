// src/components/GpsrInfoPanel.jsx
//
// O singură informare GPSR, compactă: inițial doar un rezumat scurt; la
// „Ce trebuie să știu despre GPSR?” se deschide informarea versionată completă
// (rezumat, punctele, mențiunea) și linkul la textul oficial. Folosită în Smart
// Listing și ProductModal, în secțiunea „Producător și siguranță” (fără pas nou).

import {
  GPSR_NOTICE_DISCLAIMER,
  GPSR_NOTICE_MORE_LABEL,
  GPSR_NOTICE_POINTS,
  GPSR_NOTICE_SUMMARY,
  GPSR_NOTICE_TEASER,
  GPSR_NOTICE_TITLE,
  GPSR_NOTICE_VERSION,
  GPSR_REGULATION_URL,
} from "../utils/gpsrNotice.js";
import styles from "./GpsrInfoPanel.module.css";

export default function GpsrInfoPanel() {
  return (
    <section className={styles.panel} data-testid="gpsr-info-panel" data-version={GPSR_NOTICE_VERSION} aria-label={GPSR_NOTICE_TITLE}>
      <p className={styles.title}>{GPSR_NOTICE_TITLE}</p>
      <p className={styles.summary}>{GPSR_NOTICE_TEASER}</p>

      <details className={styles.details}>
        <summary>{GPSR_NOTICE_MORE_LABEL}</summary>
        <p className={styles.summary}>{GPSR_NOTICE_SUMMARY}</p>
        <ol className={styles.points}>
          {GPSR_NOTICE_POINTS.map((point) => (
            <li key={point.key}>
              <strong>{point.title}.</strong> {point.text}
            </li>
          ))}
        </ol>
        <p className={styles.disclaimer}>{GPSR_NOTICE_DISCLAIMER}</p>
        <a className={styles.link} href={GPSR_REGULATION_URL} target="_blank" rel="noopener noreferrer">
          Textul oficial al Regulamentului (UE) 2023/988 ↗
        </a>
      </details>
    </section>
  );
}
