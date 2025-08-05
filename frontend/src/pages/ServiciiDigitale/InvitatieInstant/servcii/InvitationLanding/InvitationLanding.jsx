// src/pages/servicii/InvitatieInstantLanding.jsx
import styles from "./InvitationLanding.module.css";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../../../../../components/Context/useAppContext";
import Navbar from "../../../../../components/Navbar/Navbar"; // calea ta existentă
import Footer from "../../../../../components/Footer/Footer";

export default function InvitatieInstantLanding() {
  const navigate = useNavigate();
  const { user } = useAppContext(); // presupunem că ai context cu user logat

  const handleStart = () => {
    if (user) {
      navigate("/servicii-digitale/invitatie-instant/editor/new");
    } else {
      navigate("/login?redirect=/servicii-digitale/invitatie-instant/editor/new");
    }
  };

  return (
    <div className={styles.landing}>
      <Navbar />
      {/* HERO */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <h1 className={styles.title}>Invitație Instant</h1>
          <p className={styles.subtitle}>
            Creează-ți propria invitație online, personalizată și gata de trimis în câteva minute.
          </p>
          <button className={styles.ctaBtn} onClick={handleStart}>
            Începe să creezi invitația
          </button>
          <p className={styles.note}>*Este nevoie de cont gratuit pentru salvare și publicare.</p>
        </div>
        <div className={styles.heroImage}>
          <img src="/images/invitatie-preview.png" alt="Preview invitație" />
        </div>
      </section>

      {/* STEPS */}
      <section className={styles.steps}>
        <h2 className={styles.sectionTitle}>Cum funcționează</h2>
        <div className={styles.stepsGrid}>
          <div className={styles.step}>
            <span className={styles.stepNumber}>1</span>
            <h3>Creează</h3>
            <p>Completează formularul intuitiv și adaugă informațiile evenimentului tău.</p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNumber}>2</span>
            <h3>Personalizează</h3>
            <p>Adaugă poze, texte și vezi modificările în timp real.</p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNumber}>3</span>
            <h3>Publică & Trimite</h3>
            <p>Finalizează plata și primești un link unic pentru invitați + cod QR.</p>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className={styles.features}>
        <h2 className={styles.sectionTitle}>Funcționalități</h2>
        <ul className={styles.featureList}>
          <li>Formular intuitiv pe secțiuni (About Us, Nași, Părinți, etc.)</li>
          <li>Preview live pe toate device-urile</li>
          <li>Link unic & QR code pentru RSVP</li>
          <li>Posibilitatea de editare ulterioară</li>
          <li>Salvare automată a draftului</li>
        </ul>
      </section>
      <Footer />
    </div>
  );
}
