// src/pages/Home/WhyArtfest/WhyArtfest.jsx
//
// "De ce Artfest" - ultima secțiune importantă de homepage, înainte de
// footer. Conținut static (4 beneficii, cerute explicit ca text fix,
// nu date din API) - icon + titlu scurt + o singură propoziție.
import React from "react";
import { FaComments, FaMapMarkerAlt, FaPalette, FaStore } from "react-icons/fa";

import styles from "./WhyArtfest.module.css";

/*
 * `icon` e elementul deja randat (nu o referință de componentă) -
 * regula `no-unused-vars` a proiectului (eslint.config.js, fără
 * eslint-plugin-react) nu recunoaște un `<Icon />` construit dintr-o
 * variabilă destructurată local ca fiind "folosită".
 */
const BENEFITS = [
  {
    key: "romanian-creators",
    icon: <FaMapMarkerAlt />,
    title: "Creatori români",
    text: "Ateliere și artizani verificați, din toată țara.",
  },
  {
    key: "customizable",
    icon: <FaPalette />,
    title: "Produse personalizabile",
    text: "Multe creații se adaptează exact la ce ai nevoie.",
  },
  {
    key: "quote-requests",
    icon: <FaComments />,
    title: "Cereri de ofertă direct către creator",
    text: "Spui ce cauți, primești oferte reale, fără intermediari.",
  },
  {
    key: "all-in-one",
    icon: <FaStore />,
    title: "Totul într-un singur loc",
    text: "Produse, mesaje și comenzi, într-un singur marketplace.",
  },
];

export default function WhyArtfest() {
  return (
    <section className={styles.section} aria-labelledby="why-artfest-heading">
      <h2 id="why-artfest-heading" className={styles.heading}>
        De ce Artfest
      </h2>

      <div className={styles.grid}>
        {BENEFITS.map(({ key, icon, title, text }) => (
          <div key={key} className={styles.tile}>
            <span className={styles.iconWrap} aria-hidden="true">
              {icon}
            </span>
            <strong className={styles.tileTitle}>{title}</strong>
            <p className={styles.tileText}>{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
