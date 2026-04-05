// frontend/src/pages/User/Orders/components/EmptyState.jsx
import React from "react";
import styles from "../Orders.module.css";

export default function EmptyState({ title, subtitle, ctaText, href }) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.subtle}>{subtitle}</div>
      <a className={styles.btnPrimary} href={href}>
        {ctaText}
      </a>
    </div>
  );
}
