// src/pages/SecretSanta/SecretSantaCta.jsx
//
// Card discret în dashboard-ul vânzătorului: apare doar cât există o ediție
// Secret Santa publicată (cu înscrieri deschise sau după extragere).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Gift } from "lucide-react";
import { api } from "../../lib/api";
import { SS_PUBLIC_API } from "./secretSanta.js";
import styles from "./SecretSantaCta.module.css";

export default function SecretSantaCta() {
  const [edition, setEdition] = useState(null);

  useEffect(() => {
    let alive = true;
    api(SS_PUBLIC_API)
      .then((data) => alive && setEdition(data?.edition || null))
      .catch(() => null); // fără date nu blocăm dashboard-ul
    return () => {
      alive = false;
    };
  }, []);

  if (!edition || (!edition.registrationOpen && !edition.drawn)) return null;

  return (
    <section className={styles.cta} aria-label="Secret Santa Artfest">
      <span className={styles.icon} aria-hidden="true">
        <Gift size={20} />
      </span>
      <span className={styles.text}>
        <strong>{edition.title}</strong>
        <span className={styles.subtitle}>
          {edition.drawn ? "Extragerea a avut loc. Vezi cui îi trimiți cadoul." : "Schimb gratuit de cadouri handmade între vânzători."}
        </span>
      </span>
      <Link className={styles.btn} to="/secret-santa">
        {edition.drawn ? "Secret Santa-ul meu" : "Participă"} <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}
