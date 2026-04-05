// frontend/src/pages/User/Orders/components/SkeletonOrderCard.jsx
import React from "react";
import styles from "../Orders.module.css";

export default function SkeletonOrderCard() {
  // dacă vrei aspect consistent, adaugă în Orders.module.css:
  // .skeleton { background: rgba(0,0,0,.06); border-radius: 12px; height: 120px; margin-bottom: 12px; }
  return <div className={styles.skeleton || ""} style={{ height: 120, marginBottom: 12 }} />;
}
