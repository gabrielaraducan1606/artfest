// src/pages/DigitalServicesPage/DigitalServicesPage.jsx
import React from "react";
import { Link } from "react-router-dom";
import styles from "./DigitalServicesPage.module.css";
import Button from "../../components/ui/Button/Button";
import { FaEnvelopeOpenText, FaChair, FaSms, FaQrcode } from "react-icons/fa";
import Navbar from "../../components/HomePage/Navbar/Navbar";
import Footer from "../../components/HomePage/Footer/Footer";

// imagine hero (poți înlocui)
import heroImg from "../../assets/LogoArfest.png";

const services = [
  {
    icon: <FaEnvelopeOpenText />,
    title: "Invitație digitală",
    description: "Creează o invitație interactivă online, elegantă și personalizabilă.",
    // pagină distinctă (landing) pentru acest buton
    link: "/servicii-digitale/invitatie-instant",
  },
  {
    icon: <FaChair />,
    title: "Organizarea invitaților",
    description: "Gestionează și aranjează invitații la mese cu ușurință.",
    link: "/servicii-digitale/seating-sms-landing",
  },
  {
    icon: <FaSms />,
    title: "Trimitere SMS personalizată",
    description: "Trimite rapid notificări și mesaje către invitați.",
    link: "/servicii-digitale/sms-landing",
  },
  {
    icon: <FaQrcode />,
    title: "Album QR",
    description: "Colectează și distribuie poze de la invitați printr-un cod QR unic.",
    link: "/servicii-digitale/album-qr-landing",
  },
];

export default function DigitalServicesPage() {

  return (
    <div className={styles.page}>
      <Navbar />

      {/* HERO (fără CTA central) */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroContent}>
            <h1 className={styles.title}>Servicii Digitale pentru Evenimente</h1>
            <p className={styles.subtitle}>
              Unelte moderne care fac organizarea evenimentului tău mai simplă și mai plăcută.
            </p>
          </div>
          <div className={styles.heroImage}>
            <img src={heroImg} alt="Servicii digitale" />
          </div>
        </div>
      </section>

      {/* GRID SERVICII */}
      <section className={styles.services}>
        {services.map((s) => (
          <div key={s.title} className={styles.card}>
            <div className={styles.icon}>{s.icon}</div>
            <h3 className={styles.cardTitle}>{s.title}</h3>
            <p className={styles.cardDesc}>{s.description}</p>

            {/* "Accesează" merge pe landing-ul separat al fiecărui serviciu */}
            <Link to={s.link}>
              <Button size="md" variant="outline">Accesează</Button>
            </Link>
          </div>
        ))}
      </section>

      {/* BENEFICII */}
      <section className={styles.benefits}>
        <h2 className={styles.benefitsTitle}>De ce să alegi serviciile noastre</h2>
        <ul className={styles.benefitsList}>
          <li>🔒 Securitate și confidențialitate a datelor</li>
          <li>⚡ Rapid și ușor de folosit</li>
          <li>📱 Compatibil pe orice dispozitiv</li>
          <li>💬 Suport tehnic dedicat</li>
        </ul>
      </section>

      {/* CTA FINAL — poți trimite și asta spre un landing */}
      <section className={styles.cta}>
        <h2>Organizează-ți evenimentul cu Artfest</h2>
        <Link to="/inregistrare">
          <Button size="lg" className={styles.button}>Creează cont gratuit</Button>
        </Link>
      </section>

      <Footer />
    </div>
  );
}
