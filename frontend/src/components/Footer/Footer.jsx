// src/components/Footer/Footer.jsx
import React from "react";
import { Link } from "react-router-dom";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.topBar}></div>

      <div className={styles.container}>
        <div className={styles.copy}>
          &copy; {new Date().getFullYear()} <span className={styles.brand}>Artfest</span>. Toate drepturile rezervate.
        </div>
        <div className={styles.links}>
          <Link to="/despre" className={styles.link}>Despre</Link>
          <Link to="/termeni" className={styles.link}>Termeni și condiții</Link>
          <Link to="/gdpr" className={styles.link}>Politica GDPR</Link>
        </div>
      </div>
    </footer>
  );
}
