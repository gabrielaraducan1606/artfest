// src/pages/Seller/onboarding/SellerInfo.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../../../components/HomePage/Navbar/Navbar";
import Footer from "../../../components/HomePage/Footer/Footer";
import styles from "./Onboarding.module.css";

export default function SellerInfo() {
  const navigate = useNavigate();

  return (
    <>
      <Navbar />
      <main className={styles.page}>
        <section className={styles.wrapWide}>
          <div className={styles.infoCard}>
            <h1 className={styles.bigTitle}>Începe configurarea magazinului</h1>
            <p className={styles.lead}>
              Finalizează cei <strong>3 pași</strong> pentru a publica magazinul tău handmade pe platformă.
              Progresul este salvat automat pe parcurs.
            </p>

            <div className={styles.grid}>
              {/* PASUL 1 */}
              <div className={styles.box}>
                <h3 className={styles.boxTitle}>Pasul 1 — Identitate & link public</h3>
                <p className={styles.boxIntro}>
                  Setează identitatea magazinului și pregătește pagina publică.
                </p>
                <ul className={styles.list}>
                  <li><strong>Nume magazin/brand</strong> (verificăm disponibilitatea în timp real)</li>
                  <li><strong>Username (slug)</strong> pentru linkul public — ex: <em>atelier-mara</em></li>
                  <li><strong>Logo</strong> (min. 240×240) și <strong>Copertă</strong> (min. 1200×400)</li>
                  <li><strong>Descriere scurtă</strong> (max. 160 caractere) + povestea brandului (opțional)</li>
                  <li><strong>Categorie principală</strong> (cu explicații & exemple)</li>
                  <li><strong>Locație</strong>: oraș și țară</li>
                  <li><strong>Contact public</strong>: telefon (opțional de afișat) și email public (opțional)</li>
                  <li>Note de livrare/retur (opțional, le poți completa și ulterior)</li>
                </ul>
              </div>

              {/* PASUL 2 */}
              <div className={styles.box}>
                <h3 className={styles.boxTitle}>Pasul 2 — Plăți & Abonament</h3>
                <p className={styles.boxIntro}>
                  Completezi datele pentru facturare, contul de încasare și alegi planul.
                </p>
                <ul className={styles.list}>
                  <li><strong>Tip entitate</strong> (PFA / SRL) și <strong>denumire</strong></li>
                  <li><strong>CUI</strong> (validat), <strong>adresă fiscală</strong>, oraș, țară</li>
                  <li><strong>IBAN</strong> (format RO, validat) și <strong>email financiar</strong></li>
                  <li><strong>Documente KYC</strong> (fișier sau link): act identitate / dovadă adresă</li>
                  <li><strong>Abonament</strong> (Start / Growth / Pro) — cu rezumatul costurilor</li>
                  <li><strong>Accept termeni & condiții</strong></li>
                </ul>
              </div>

              {/* PASUL 3 */}
              <div className={styles.box}>
                <h3 className={styles.boxTitle}>Pasul 3 — Contract & Publicare</h3>
                <p className={styles.boxIntro}>
                  Verifici contractul, îl semnezi digital și publici magazinul.
                </p>
                <ul className={styles.list}>
                  <li>Previzualizare/descărcare <strong>contract PDF</strong></li>
                  <li><strong>Semnătură</strong> pe canvas sau <strong>semnătură tipărită</strong> (font script)</li>
                  <li><strong>Confirmare consimțământ</strong> (bifă necesară înainte de semnare)</li>
                  <li>După semnare: <strong>magazinul este publicat</strong> și poți accesa Dashboard</li>
                </ul>
              </div>
            </div>

            <div className={styles.ctaRow}>
              <button
                className={styles.btn}
                onClick={() => navigate("/vanzator/onboarding?step=1")}
              >
                Începe configurarea
              </button>
              <button
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => navigate("/vanzator/onboarding?step=2")}
              >
                Reia de la pasul 2
              </button>
              <button
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={() => navigate("/vanzator/onboarding?step=3")}
              >
                Reia de la pasul 3
              </button>
            </div>

            <p className={styles.note}>
              Progresul tău este salvat automat. Poți reveni oricând și vei continua de unde ai rămas.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
