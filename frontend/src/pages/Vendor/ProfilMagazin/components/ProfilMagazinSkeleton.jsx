import React from "react";
import styles from "../ProfilMagazin.module.css";

export default function ProfilMagazinSkeleton() {
  return (
    <div className={styles.wrapper} style={{ padding: "1rem" }}>
      <div style={{ height: 220, borderRadius: 12, background: "#f3f4f6" }} />
      <div style={{ height: 16 }} />
      <div style={{ height: 420, borderRadius: 12, background: "#f3f4f6" }} />
    </div>
  );
}