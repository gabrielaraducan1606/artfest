import React from "react";
import { Link } from "react-router-dom";
import Button from "../../ui/Button/Button";
import styles from "./DigitalServices.module.css";

const services = [
  {
    title: "Invitație Instant",
    description:
      "Creează o invitație digitală elegantă, interactivă și ușor de distribuit.",
    link: "/servicii-digitale/invitatie-instant",
  },
  {
    title: "Seating & SMS",
    description:
      "Organizează invitații pe mese și trimite notificări personalizate prin SMS.",
    link: "/servicii-digitale/seating-sms",
  },
  {
    title: "Album QR",
    description:
      "Colectează fotografii de la invitați printr-un album accesibil cu QR.",
    link: "/servicii-digitale/album-qr",
  },
];

export default function DigitalServices() {
  return (
    <section className={styles.section} aria-labelledby="ds-heading">
      <div className={styles.header}>
        <h2 id="ds-heading" className={styles.heading}>Servicii Digitale</h2>
        <p className={styles.subheading}>
          Instrumente care simplifică organizarea evenimentului tău.
        </p>
      </div>

      <div className={styles.grid}>
        {services.map((s) => (
          <Link
            key={s.title}
            to={s.link}
            className={styles.card}
            aria-label={`Deschide serviciul: ${s.title}`}
          >
            <div className={styles.cardInner}>
              <div className={styles.pill} aria-hidden="true" />
              <h3 className={styles.title}>{s.title}</h3>
              <p className={styles.description}>{s.description}</p>
              <div className={styles.ctaRow}>
                <Button size="md">Accesează</Button>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
