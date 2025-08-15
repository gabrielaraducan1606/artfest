import React from "react";
import { Link } from "react-router-dom";
import styles from "./Footer.module.css";

export default function Footer() {
  return (
    <footer className={styles.footer}>
      {/* Bară decorativă în culoarea primară */}
      <div className={styles.topBar} aria-hidden="true" />

      <div className={styles.container}>
        {/* Col 1: Brand + descriere scurtă */}
        <div className={styles.colBrand}>
          <Link to="/" className={styles.brand}>
            Artfest
          </Link>
          <p className={styles.tagline}>
            Marketplace pentru produse handmade și servicii digitale pentru evenimente.
          </p>
          <div className={styles.social}>
            <a href="#" aria-label="Instagram" className={styles.socialBtn}>IG</a>
            <a href="#" aria-label="Facebook" className={styles.socialBtn}>FB</a>
            <a href="#" aria-label="TikTok" className={styles.socialBtn}>TT</a>
          </div>
        </div>

        {/* Col 2: Navigație utilă */}
        <nav className={styles.colNav} aria-labelledby="footer-nav">
          <h3 id="footer-nav" className={styles.heading}>Navigație</h3>
          <ul className={styles.list}>
            <li><Link to="/produse" className={styles.link}>Produse</Link></li>
            <li><Link to="/magazine" className={styles.link}>Magazine</Link></li>
            <li><Link to="/servicii-digitale" className={styles.link}>Servicii digitale</Link></li>
            <li><Link to="/vinde" className={styles.link}>Vinde pe Artfest</Link></li>
          </ul>
        </nav>

        {/* Col 3: Suport & Legal */}
        <nav className={styles.colSupport} aria-labelledby="footer-support">
          <h3 id="footer-support" className={styles.heading}>Suport</h3>
          <ul className={styles.list}>
            <li><Link to="/despre" className={styles.link}>Despre</Link></li>
            <li><Link to="/contact" className={styles.link}>Contact</Link></li>
            <li><Link to="/termeni" className={styles.link}>Termeni & condiții</Link></li>
            <li><Link to="/gdpr" className={styles.link}>Politica GDPR</Link></li>
          </ul>
        </nav>

        {/* Col 4: Newsletter simplu (opțional) */}
        <div className={styles.colNews}>
          <h3 className={styles.heading}>Abonează-te</h3>
          <p className={styles.note}>Noutăți, reduceri și idei de la artizani.</p>
          <form className={styles.newsForm} onSubmit={(e)=>e.preventDefault()}>
            <input
              type="email"
              className={styles.input}
              placeholder="email@exemplu.ro"
              aria-label="Adresa ta de email"
            />
            <button type="submit" className={styles.btn}>Trimite</button>
          </form>
        </div>
      </div>

      {/* Linia de jos */}
      <div className={styles.bottom}>
        <div className={styles.copy}>
          &copy; {new Date().getFullYear()} <span className={styles.brandInline}>Artfest</span>. Toate drepturile rezervate.
        </div>
        <div className={styles.bottomLinks}>
          <Link to="/termeni" className={styles.link}>Termeni</Link>
          <Link to="/gdpr" className={styles.link}>GDPR</Link>
          <Link to="/cookies" className={styles.link}>Cookie-uri</Link>
        </div>
      </div>
    </footer>
  );
}
