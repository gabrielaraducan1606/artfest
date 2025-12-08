import React from "react";
import { Link } from "react-router-dom";
import {
  Instagram,
  Facebook,
  Youtube,
  Heart,
  ShieldCheck,
  Headset,
} from "lucide-react";
import styles from "./Footer.module.css";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={styles.footer}>
      {/* Bară decorativă în culoarea primară */}
      <div className={styles.topBar} aria-hidden="true" />

      <div className={styles.container}>
        {/* Col 1: Brand + mini pitch + social */}
        <div className={styles.colBrand}>
          <Link to="/" className={styles.brand}>
            Artfest
          </Link>
          <p className={styles.tagline}>
            Marketplace pentru artizani de evenimente: produse handmade,
            servicii digitale și furnizori verificați pentru zilele speciale.
          </p>

          {/* Trust mini-strip */}
          <ul className={styles.trustList}>
            <li>
              <ShieldCheck size={16} />
              <span>Artizani verificați</span>
            </li>
            <li>
              <Heart size={16} />
              <span>Focus pe evenimente</span>
            </li>
            <li>
              <Headset size={16} />
              <span>Suport dedicat vendori</span>
            </li>
          </ul>

          <div className={styles.social}>
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram Artfest"
              className={styles.socialBtn}
            >
              <Instagram size={18} />
            </a>
            <a
              href="https://facebook.com"
              target="_blank"
              rel="noreferrer"
              aria-label="Facebook Artfest"
              className={styles.socialBtn}
            >
              <Facebook size={18} />
            </a>
            <a
              href="https://youtube.com"
              target="_blank"
              rel="noreferrer"
              aria-label="YouTube / video content Artfest"
              className={styles.socialBtn}
            >
              <Youtube size={18} />
            </a>
          </div>
        </div>

        {/* Col 2: Pentru miri / clienți */}
        <nav className={styles.colNav} aria-labelledby="footer-client">
          <h3 id="footer-client" className={styles.heading}>
            Pentru miri & clienți
          </h3>
          <ul className={styles.list}>
            <li>
              <Link to="/produse" className={styles.link}>
                Produse handmade
              </Link>
            </li>
            <li>
              <Link to="/magazine" className={styles.link}>
                Magazine & artizani
              </Link>
            </li>
            <li>
              <Link to="/digitale/invitatie" className={styles.link}>
                Invitație digitală
              </Link>
            </li>
            <li>
              <Link to="/digitale/asezare-mese" className={styles.link}>
                Așezarea la mese (SMS)
              </Link>
            </li>
            <li>
              <Link to="/digitale/album-qr" className={styles.link}>
                Album foto cu QR
              </Link>
            </li>
          </ul>
        </nav>

        {/* Col 3: Pentru artizani / vendori + suport */}
        <nav className={styles.colSupport} aria-labelledby="footer-vendor">
          <h3 id="footer-vendor" className={styles.heading}>
            Pentru artizani
          </h3>
          <ul className={styles.list}>
            <li>
              <Link to="/vinde" className={styles.link}>
                Devino partener Artfest
              </Link>
            </li>
            <li>
              <Link to="/onboarding" className={styles.link}>
                Începe setup-ul profilului
              </Link>
            </li>
            <li>
              <Link to="/asistenta-tehnica" className={styles.link}>
                Asistență & tichete suport
              </Link>
            </li>
            <li>
              <Link to="/despre" className={styles.link}>
                Despre Artfest
              </Link>
            </li>
            <li>
              <Link to="/contact" className={styles.link}>
                Contact
              </Link>
            </li>
          </ul>

          <div className={styles.legalBlock}>
            <h4 className={styles.subHeading}>Legal</h4>
            <ul className={styles.list}>
              <li>
                <Link to="/termeni" className={styles.link}>
                  Termeni & condiții
                </Link>
              </li>
              <li>
                <Link to="/gdpr" className={styles.link}>
                  Politica de confidențialitate
                </Link>
              </li>
              <li>
                <Link to="/cookies" className={styles.link}>
                  Politica de cookie-uri
                </Link>
              </li>
            </ul>
          </div>
        </nav>

        {/* Col 4: Newsletter + mesaj clar de valoare */}
        <div className={styles.colNews}>
          <h3 className={styles.heading}>Abonează-te la idei de evenimente</h3>
          <p className={styles.note}>
            Primești ocazional inspirație pentru decor, idei de cadouri și
            reduceri de la artizanii Artfest. Fără spam.
          </p>
          <form
            className={styles.newsForm}
            onSubmit={(e) => {
              e.preventDefault();
              // aici poți integra ulterior cu backend / email provider
            }}
          >
            <label className={styles.srOnly} htmlFor="newsletter-email">
              Adresa ta de email
            </label>
            <input
              id="newsletter-email"
              type="email"
              className={styles.input}
              placeholder="email@exemplu.ro"
              autoComplete="email"
              required
            />
            <button type="submit" className={styles.btn}>
              Mă abonez
            </button>
          </form>

          <p className={styles.miniLegal}>
            Prin abonare, ești de acord cu{" "}
            <Link to="/gdpr" className={styles.linkInline}>
              politica de prelucrare a datelor
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Linia de jos */}
      <div className={styles.bottom}>
        <div className={styles.copy}>
          &copy; {year}{" "}
          <span className={styles.brandInline}>Artfest</span>. Toate drepturile
          rezervate.
        </div>
        <div className={styles.bottomLinks}>
          <Link to="/termeni" className={styles.link}>
            Termeni
          </Link>
          <Link to="/gdpr" className={styles.link}>
            GDPR
          </Link>
          <Link to="/cookies" className={styles.link}>
            Cookie-uri
          </Link>
        </div>
      </div>
    </footer>
  );
}
