// src/pages/Home/RequestsExplainer/RequestsExplainer.jsx
//
// Explică cererile gratuite ÎNAINTE de lista „Ce caută oamenii acum”
// (CustomerRequestsSection): ce sunt, ce urmează, ce faci. Butonul
// deschide formularul existent din CustomerRequestsSection
// (guest -> login -> formular), prin ../homeActions.js.
import React from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowRight, FaCheck } from "react-icons/fa";

import { trackEvent } from "../../../../services/analytics.js";
import {
  CREATE_REQUEST_FALLBACK_URL,
  openCreateCustomerRequest,
} from "../homeActions.js";

import styles from "./RequestsExplainer.module.css";

const STEPS = [
  {
    key: "describe",
    title: "Descrii ce cauți",
    text: "Produsul dorit, ocazia și bugetul. Poți adăuga și o fotografie.",
  },
  {
    key: "offers",
    title: "Primești oferte",
    text: "Vânzătorii interesați îți pot trimite oferte personalizate.",
  },
  {
    key: "choose",
    title: "Alegi varianta potrivită",
    text: "Compari ofertele, discuți direct cu creatorul și decizi tu.",
  },
];

/* Fără un număr garantat de oferte - doar ce e adevărat oricând. */
const HIGHLIGHTS = [
  "O singură cerere",
  "Poți primi mai multe oferte",
  "Fără obligația de a comanda",
];

export default function RequestsExplainer() {
  const navigate = useNavigate();

  const handleCreate = () => {
    // prin analytics.js: doar cu acord pentru statistici, doar către GA4
    trackEvent("home_cta_click", {
      cta: "create_request",
      placement: "requests_explainer",
    });

    if (!openCreateCustomerRequest("manual")) {
      navigate(CREATE_REQUEST_FALLBACK_URL);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="requests-explainer-heading">
      <div className={styles.inner}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>Cereri gratuite</span>

          <h2 id="requests-explainer-heading" className={styles.title}>
            Nu găsești exact ce cauți?
            <span className={styles.titleAccent}>
              Publică gratuit o cerere și lasă creatorii să vină la tine cu
              oferte personalizate.
            </span>
          </h2>

          <p className={styles.lead}>
            Spune ce produs îți dorești, pentru ce ocazie și ce buget ai.
            Vânzătorii interesați îți pot trimite oferte, iar tu alegi varianta
            potrivită.
          </p>

          <ul className={styles.highlights}>
            {HIGHLIGHTS.map((text) => (
              <li key={text}>
                <FaCheck aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>

          <button type="button" className={styles.cta} onClick={handleCreate}>
            Publică gratuit o cerere
            <FaArrowRight aria-hidden="true" />
          </button>

          <p className={styles.note}>Publicarea cererii este gratuită.</p>
        </div>

        <ol className={styles.steps}>
          {STEPS.map(({ key, title, text }, index) => (
            <li key={key} className={styles.step}>
              <span className={styles.stepNumber} aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <strong className={styles.stepTitle}>{title}</strong>
                <p className={styles.stepText}>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
