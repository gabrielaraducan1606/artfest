// src/pages/Home/HomeDirections/HomeDirections.jsx
//
// „Două direcții” - imediat sub hero: cumpărătorul alege drumul lui
// (cumpără handmade / pregătește un eveniment) și ajunge direct la
// produse. Scurtăturile și verificarea lor: ../homeDirections.js.
//
// Înlocuiește „Cumpără după ocazie” (OccasionCarousel), care deschidea
// Asistentul AI în loc să arate produse. Asistentul rămâne disponibil
// separat, din bula FloatingHub.
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaArrowRight, FaGift, FaGlassCheers } from "react-icons/fa";

import { EVENT_SHORTCUTS, HANDMADE_SHORTCUTS } from "../homeDirections.js";
import {
  CREATE_REQUEST_FALLBACK_URL,
  EVENTS_ANCHOR_ID,
  openCreateCustomerRequest,
} from "../homeActions.js";

import styles from "./HomeDirections.module.css";

function ShortcutList({ items, direction, onAnalytics }) {
  return (
    <ul className={styles.shortcuts}>
      {items.map(({ key, label, to }) => (
        <li key={key}>
          <Link
            to={to}
            className={styles.shortcut}
            onClick={() =>
              onAnalytics?.("home_shortcut_click", {
                direction,
                shortcut: key,
              })
            }
          >
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function HomeDirections({ onAnalytics }) {
  const navigate = useNavigate();

  const handleRequestClick = () => {
    onAnalytics?.("home_cta_click", {
      cta: "create_request",
      placement: "directions_event",
    });

    if (!openCreateCustomerRequest("manual")) {
      navigate(CREATE_REQUEST_FALLBACK_URL);
    }
  };

  return (
    <section className={styles.section} aria-label="Ce vrei să faci pe Artfest">
      <div className={styles.grid}>
        <article className={styles.card}>
          <span className={styles.icon} aria-hidden="true">
            <FaGift />
          </span>

          <span className={styles.eyebrow}>Cumpără handmade</span>

          <h2 className={styles.title}>Produse create de mână, gata de comandat</h2>

          <p className={styles.text}>
            Cadouri personalizate, bijuterii și decor pentru casă, făcute în
            ateliere din toată țara.
          </p>

          <ShortcutList
            items={HANDMADE_SHORTCUTS}
            direction="handmade"
            onAnalytics={onAnalytics}
          />

          <Link
            to="/produse"
            className={styles.cta}
            onClick={() =>
              onAnalytics?.("home_cta_click", {
                cta: "discover_products",
                placement: "directions_handmade",
              })
            }
          >
            Vezi toate produsele
            <FaArrowRight aria-hidden="true" />
          </Link>
        </article>

        <article
          id={EVENTS_ANCHOR_ID}
          className={`${styles.card} ${styles.cardEvent}`}
        >
          <span className={styles.icon} aria-hidden="true">
            <FaGlassCheers />
          </span>

          <span className={styles.eyebrow}>Pregătesc un eveniment</span>

          <h2 className={styles.title}>
            Tot ce ai nevoie pentru nuntă, botez sau aniversare
          </h2>

          <p className={styles.text}>
            Mărturii, invitații, decor și cadouri pentru invitați, realizate
            pe comandă după tema ta.
          </p>

          <ShortcutList
            items={EVENT_SHORTCUTS}
            direction="event"
            onAnalytics={onAnalytics}
          />

          <button
            type="button"
            className={styles.cta}
            onClick={handleRequestClick}
          >
            Ai nevoie de ceva anume? Cere oferte
            <FaArrowRight aria-hidden="true" />
          </button>
        </article>
      </div>
    </section>
  );
}
