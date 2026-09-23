// src/pages/Home/OccasionCarousel/OccasionCarousel.jsx
//
// "Cumpără după ocazie" - carusel orizontal de chip-uri vizuale.
//
// NU navighează către o listă de produse - fiecare card deschide
// Asistentul Artfest existent (FloatingHub/AiAssistant), cu un mesaj
// precompletat, EDITABIL de utilizator înainte de trimitere. Reutilizează
// STRICT mecanismul de deep-link deja existent (evenimentele
// "artfest:personalization-start"/"artfest:quote-request", ascultate în
// FloatingHub.jsx) - aici doar adăugăm un al treilea nume de eveniment,
// "artfest:assistant-prompt", cu `detail: { text }`. Fără AI nou, fără
// endpoint nou, fără tag-uri noi în backend.
import React from "react";
import {
  FaBaby,
  FaBirthdayCake,
  FaChalkboardTeacher,
  FaChurch,
  FaGifts,
  FaHome,
  FaRing,
  FaTree,
} from "react-icons/fa";

import styles from "./OccasionCarousel.module.css";

/*
 * `icon` e elementul deja randat (nu o referință de componentă) -
 * regula `no-unused-vars` a proiectului (eslint.config.js, fără
 * eslint-plugin-react) nu recunoaște un `<Icon />` construit dintr-o
 * variabilă destructurată local ca fiind "folosită".
 */
const OCCASIONS = [
  {
    key: "wedding",
    label: "Nuntă",
    icon: <FaRing />,
    text: "Caut produse pentru o nuntă.",
  },
  {
    key: "baptism",
    label: "Botez",
    icon: <FaChurch />,
    text: "Caut produse pentru un botez.",
  },
  {
    key: "anniversary",
    label: "Aniversare",
    icon: <FaBirthdayCake />,
    text: "Caut un cadou pentru o aniversare.",
  },
  {
    key: "gifts",
    label: "Cadouri",
    icon: <FaGifts />,
    text: "Ajută-mă să găsesc un cadou.",
  },
  {
    key: "new_home",
    label: "Casă nouă",
    icon: <FaHome />,
    text: "Caut un cadou pentru casă nouă.",
  },
  {
    key: "teachers",
    label: "Profesori",
    icon: <FaChalkboardTeacher />,
    text: "Caut un cadou pentru profesori.",
  },
  {
    key: "baby",
    label: "Bebe",
    icon: <FaBaby />,
    text: "Caut produse sau cadouri pentru bebe.",
  },
  {
    key: "christmas",
    label: "Crăciun",
    icon: <FaTree />,
    text: "Caut cadouri de Crăciun.",
  },
];

/*
 * Deschide Asistentul (FloatingHub) cu textul precompletat - ascultat
 * global în FloatingHub.jsx, exact ca personalization-start/quote-request.
 * Utilizatorul poate edita mesajul înainte de a-l trimite (nu se trimite
 * automat - vezi AiAssistant.jsx, ramura "artfest:assistant-prompt").
 */
function openAssistantWithPrompt(text) {
  window.dispatchEvent(
    new CustomEvent("artfest:assistant-prompt", {
      detail: { text },
    })
  );
}

export default function OccasionCarousel() {
  return (
    <section className={styles.section} aria-labelledby="occasion-heading">
      <div className={styles.header}>
        <div>
          <h2 id="occasion-heading" className={styles.heading}>
            Cumpără după ocazie
          </h2>
          <p className={styles.subheading}>
            Alege ocazia și Asistentul Artfest te ajută să găsești exact ce
            cauți.
          </p>
        </div>
      </div>

      <div className={styles.track} role="list">
        {OCCASIONS.map(({ key, label, icon, text }) => (
          <button
            key={key}
            type="button"
            role="listitem"
            className={styles.card}
            onClick={() => openAssistantWithPrompt(text)}
            aria-label={`${label} - deschide Asistentul Artfest`}
          >
            <span className={styles.iconWrap} aria-hidden="true">
              {icon}
            </span>
            <span className={styles.label}>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
