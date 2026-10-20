// src/pages/Home/WhyArtfest/WhyArtfest.jsx
//
// „De ce să cumperi de pe Artfest” - elementele de încredere ale
// homepage-ului. Conținut static, DOAR afirmații pe care platforma le
// susține azi (plată card/ramburs, verificarea produselor înainte de
// publicare, mesaje directe, politica de retur). Fără cifre („X creatori”)
// până nu vin din date reale. La retur NU promitem „14 zile” fără nuanță:
// produsele personalizate sunt excepție legală - trimitem la politică.
import React from "react";
import { Link } from "react-router-dom";
import { FaComments, FaLock, FaShieldAlt, FaUndoAlt } from "react-icons/fa";

import styles from "./WhyArtfest.module.css";

/*
 * `icon` e elementul deja randat (nu o referință de componentă) -
 * regula `no-unused-vars` a proiectului (eslint.config.js, fără
 * eslint-plugin-react) nu recunoaște un `<Icon />` construit dintr-o
 * variabilă destructurată local ca fiind "folosită".
 */
const BENEFITS = [
  {
    key: "payment",
    icon: <FaLock />,
    title: "Plată sigură",
    text: "Plătești cu cardul, online, sau ramburs la livrare.",
  },
  {
    key: "verified",
    icon: <FaShieldAlt />,
    title: "Produse verificate",
    text: "Fiecare produs trece printr-o verificare înainte să apară pe Artfest.",
  },
  {
    key: "contact",
    icon: <FaComments />,
    title: "Vorbești direct cu creatorul",
    text: "Stabilești detaliile și personalizarea prin mesaje, fără intermediari.",
  },
  {
    key: "returns",
    icon: <FaUndoAlt />,
    title: "Retur clar",
    text: "Știi dinainte ce se poate returna și cum.",
    link: { to: "/politica-de-retur", label: "Vezi politica de retur" },
  },
];

export default function WhyArtfest() {
  return (
    <section className={styles.section} aria-labelledby="why-artfest-heading">
      <h2 id="why-artfest-heading" className={styles.heading}>
        De ce să cumperi de pe Artfest
      </h2>

      <p className={styles.lead}>
        Produse handmade de la creatori români, cumpărate simplu și sigur.
      </p>

      <div className={styles.grid}>
        {BENEFITS.map(({ key, icon, title, text, link }) => (
          <div key={key} className={styles.tile}>
            <span className={styles.iconWrap} aria-hidden="true">
              {icon}
            </span>
            <strong className={styles.tileTitle}>{title}</strong>
            <p className={styles.tileText}>{text}</p>
            {link && (
              <Link to={link.to} className={styles.tileLink}>
                {link.label}
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
