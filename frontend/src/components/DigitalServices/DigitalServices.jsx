import React from "react";
import Button from "../../components/ui/Button/Button";
import styles from "./DigitalServices.module.css";

const services = [
  {
    title: "Invitație digitală",
    description: "Creează o invitație interactivă online, elegantă și personalizabilă.",
    link: "/invitatie-digitala",
  },
  {
    title: "Organizarea invitaților",
    description: "Gestionează și aranjează invitații la mese cu ușurință.",
    link: "/organizare-invitati",
  },
  {
    title: "Trimitere SMS personalizată",
    description: "Trimite rapid notificări și mesaje către invitați.",
    link: "/sms",
  },
];

export default function DigitalServices() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Servicii Digitale</h2>
      <div className={styles.grid}>
        {services.map((service, idx) => (
          <div key={idx} className={styles.card}>
            <h3 className={styles.title}>{service.title}</h3>
            <p className={styles.description}>{service.description}</p>
            <a href={service.link}>
              <Button>Accesează</Button>
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
