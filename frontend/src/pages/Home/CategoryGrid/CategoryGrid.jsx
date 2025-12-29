import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import styles from "./CategoryGrid.module.css";
import { api } from "../../../lib/api";
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

/**
 * Categorii "curated" (ALINIATE cu Product.category din backend/constants/categories.js)
 * Cheia (code) trebuie să fie exact slug-ul salvat în DB.
 */
const FEATURED = [
  // Invitații
  { code: "papetarie_invitatii-nunta", label: "Invitații nuntă", icon: FaEnvelopeOpenText },
  { code: "papetarie_invitatii-botez", label: "Invitații botez", icon: FaEnvelopeOpenText },
  { code: "papetarie_invitatii-petrecere", label: "Invitații petrecere", icon: FaEnvelopeOpenText },

  // Papetărie populară
  { code: "papetarie_meniuri", label: "Meniuri", icon: FaRegAddressCard },
  { code: "papetarie_place-cards", label: "Place cards", icon: FaRegAddressCard },
  { code: "papetarie_plicuri-bani", label: "Plicuri de bani", icon: FaRegAddressCard },

  // Mărturii
  { code: "marturii_nunta", label: "Mărturii nuntă", icon: FaGift },
  { code: "marturii_botez", label: "Mărturii botez", icon: FaGift },

  // Cadouri
  { code: "cadouri_pentru-miri", label: "Cadouri pentru miri", icon: FaGift },
  { code: "cadouri_pentru-nasi", label: "Cadouri pentru nași", icon: FaGift },
  { code: "cadouri_pentru-parinti", label: "Cadouri pentru părinți", icon: FaGift },

  // Extra (opțional, dar de obicei merg bine)
  { code: "bijuterii_seturi", label: "Seturi bijuterii", icon: FaGem },
  { code: "home_ceramica-lut", label: "Ceramică / lut", icon: FaMugHot },
  { code: "decor_lumini-decorative", label: "Lumini decorative", icon: FaLightbulb },
  { code: "arta_tablouri", label: "Tablouri", icon: FaImage },
  { code: "party_cake-toppers", label: "Cake toppers", icon: FaBirthdayCake },
];

export default function CategoryGrid({ limit = 12 }) {
  const [stats, setStats] = useState(null);

  // slider refs + state
  const trackRef = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // drag-to-scroll state
  const isDragging = useRef(false);
  const dragStarted = useRef(false);
  const startX = useRef(0);
  const startScrollLeft = useRef(0);
  const DRAG_THRESHOLD = 6;

  // OPTIONAL: ia counts, dacă endpoint-ul există (îl ai deja în codul tău)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await api("/api/public/products/categories/stats");
        if (alive) setStats(Array.isArray(s) ? s : []);
      } catch {
        setStats(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const items = useMemo(() => {
    const base = FEATURED.slice(0, limit);

    if (!Array.isArray(stats)) return base;

    const counts = new Map(
      stats.map((s) => [String(s.category), Number(s?._count?.category || 0)])
    );

    // atașăm count dacă există, dar NU reordonăm după count (fiind listă curated)
    return base.map((c) => ({ ...c, count: counts.get(c.code) ?? 0 }));
  }, [stats, limit]);

  // nav state
  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setAtStart(start);
    setAtEnd(end);
  };

  useEffect(() => {
    updateArrows();
    const el = trackRef.current;
    if (!el) return;

    const onScroll = () => updateArrows();
    const onResize = () => updateArrows();

    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [items.length]);

  const scrollByAmount = (dir = 1) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.9);
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  // drag-to-scroll handlers
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

  if (!items.length) return null;

  return (
    <section className={styles.section} aria-labelledby="cat-title">
      <div className={styles.header}>
        <h2 id="cat-title" className={styles.heading}>
          Categorii populare
        </h2>
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
          className={`${styles.track}`}
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onMouseLeave={onPointerUp}
          onClickCapture={onClickCaptureTrack}
        >
          {items.map((c) => {
            const Icon = c.icon;
            const hasCount = typeof c.count === "number" && c.count > 0;

            return (
              <Link
                key={c.code}
                to={`/produse?categorie=${encodeURIComponent(c.code)}`}
                className={styles.card}
                aria-label={`Vezi produse din categoria ${c.label}`}
              >
                <div className={styles.iconWrap} aria-hidden="true">
                  <span className={styles.pill} />
                  <span className={styles.icon}>
                    <Icon />
                  </span>
                </div>

                <div className={styles.textCol}>
                  <div className={styles.name}>{c.label}</div>

                  {hasCount && (
                    <div className={styles.countRow}>{c.count} produse</div>
                  )}

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
