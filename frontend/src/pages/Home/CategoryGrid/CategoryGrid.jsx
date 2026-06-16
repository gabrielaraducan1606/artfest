import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import styles from "./CategoryGrid.module.css";
import {
  FaEnvelopeOpenText,
  FaGift,
  FaRegAddressCard,
  FaBirthdayCake,
  FaGem,
  FaMugHot,
  FaLightbulb,
  FaImage,
} from "react-icons/fa";

const FEATURED = [
  {
    label: "Invitații",
    description: "Nuntă, botez, petrecere",
    icon: FaEnvelopeOpenText,
    to: "/produse?categorie=papetarie_invitatii-nunta&page=1",
  },
  {
    label: "Mărturii",
    description: "Cadouri mici pentru invitați",
    icon: FaGift,
    to: "/produse?categorie=marturii_nunta&page=1",
  },
  {
    label: "Papetărie eveniment",
    description: "Meniuri, place cards, plicuri",
    icon: FaRegAddressCard,
    to: "/produse?categorie=papetarie_meniuri&page=1",
  },
  {
    label: "Cadouri speciale",
    description: "Pentru miri, nași și părinți",
    icon: FaGem,
    to: "/produse?categorie=cadouri_pentru-nasi&page=1",
  },
  {
    label: "Decor & lumini",
    description: "Detalii pentru atmosferă",
    icon: FaLightbulb,
    to: "/produse?categorie=decor_lumini-decorative&page=1",
  },
  {
    label: "Cake toppers",
    description: "Pentru tort și candy bar",
    icon: FaBirthdayCake,
    to: "/produse?categorie=party_cake-toppers&page=1",
  },
  {
    label: "Ceramică & lut",
    description: "Obiecte handmade pentru casă",
    icon: FaMugHot,
    to: "/produse?categorie=home_ceramica-lut&page=1",
  },
  {
    label: "Artă & tablouri",
    description: "Cadouri și decor artistic",
    icon: FaImage,
    to: "/produse?categorie=arta_tablouri&page=1",
  },
];

export default function CategoryGrid() {
  const trackRef = useRef(null);

  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const isDragging = useRef(false);
  const dragStarted = useRef(false);
  const startX = useRef(0);
  const startScrollLeft = useRef(0);

  const DRAG_THRESHOLD = 6;

  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;

    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  };

  useEffect(() => {
    updateArrows();

    const el = trackRef.current;
    if (!el) return;

    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);

    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, []);

  const scrollByAmount = (dir = 1) => {
    const el = trackRef.current;
    if (!el) return;

    const amount = Math.round(el.clientWidth * 0.9);
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  const onPointerDown = (e) => {
    const el = trackRef.current;
    if (!el) return;

    isDragging.current = true;
    dragStarted.current = false;
    startX.current = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    startScrollLeft.current = el.scrollLeft;

    el.classList.add(styles.dragging);
  };

  const onPointerMove = (e) => {
    const el = trackRef.current;
    if (!el || !isDragging.current) return;

    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const dx = x - startX.current;

    if (!dragStarted.current && Math.abs(dx) >= DRAG_THRESHOLD) {
      dragStarted.current = true;
    }

    if (dragStarted.current) {
      el.scrollLeft = startScrollLeft.current - dx;
    }
  };

  const onPointerUp = () => {
    const el = trackRef.current;
    if (!el) return;

    isDragging.current = false;
    dragStarted.current = false;
    el.classList.remove(styles.dragging);
  };

  const onClickCaptureTrack = (e) => {
    if (dragStarted.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return (
    <section className={styles.section} aria-labelledby="cat-title">
      <div className={styles.header}>
        <div>
          <h2 id="cat-title" className={styles.heading}>
            Ce cauți pentru evenimentul tău?
          </h2>

          <p className={styles.subheading}>
            Alege rapid zona care te interesează.
          </p>
        </div>

        <Link to="/produse" className={styles.viewAll}>
          Vezi toate
        </Link>
      </div>

      <div className={styles.slider}>
        <button
          className={`${styles.navBtn} ${styles.prev}`}
          onClick={() => scrollByAmount(-1)}
          aria-label="Derulează înapoi"
          disabled={atStart}
          type="button"
        >
          ‹
        </button>

        <div
          className={styles.track}
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onMouseLeave={onPointerUp}
          onClickCapture={onClickCaptureTrack}
        >
          {FEATURED.map((c) => {
            const Icon = c.icon;

            return (
              <Link
                key={c.label}
                to={c.to}
                className={styles.card}
                aria-label={`Vezi ${c.label}`}
              >
                <div className={styles.iconWrap} aria-hidden="true">
                  <span className={styles.pill} />
                  <span className={styles.icon}>
                    <Icon />
                  </span>
                </div>

                <div className={styles.textCol}>
                  <div className={styles.name}>{c.label}</div>
                  <div className={styles.countRow}>{c.description}</div>
                  <div className={styles.ctaRow}>Explorează →</div>
                </div>
              </Link>
            );
          })}
        </div>

        <button
          className={`${styles.navBtn} ${styles.next}`}
          onClick={() => scrollByAmount(1)}
          aria-label="Derulează înainte"
          disabled={atEnd}
          type="button"
        >
          ›
        </button>
      </div>
    </section>
  );
}