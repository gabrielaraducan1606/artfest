import React from "react";
import { Link } from "react-router-dom";
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

function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export default function DigitalServices() {
  return (
    <section className={styles.section} aria-labelledby="ds-heading">
      <div className={styles.header}>
        <h2 id="ds-heading" className={styles.heading}>
          Servicii Digitale
        </h2>
        <p className={styles.subheading}>
          Instrumente care simplifică organizarea evenimentului tău.
        </p>
        <p className={styles.visuallyHidden} aria-live="polite">
          {services.length} servicii disponibile
        </p>
      </div>

      <div className={styles.grid} role="list">
        {services.map((s) => {
          const id = slugify(s.title);
          return (
            <Link
              key={s.title}
              to={s.link}
              className={styles.card}
              role="listitem"
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-desc`}
            >
              <div className={styles.cardInner}>
                <span className={styles.pill} aria-hidden="true" />
                <h3 id={`${id}-title`} className={styles.title}>
                  {s.title}
                </h3>
                <p id={`${id}-desc`} className={styles.description}>
                  {s.description}
                </p>

                <span className={styles.chevron} aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    focusable="false"
                  >
                    <path
                      d="M9 18l6-6-6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
