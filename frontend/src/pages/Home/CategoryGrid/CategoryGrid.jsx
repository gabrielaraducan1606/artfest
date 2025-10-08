import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import styles from "./CategoryGrid.module.css";
import { api } from "../../../lib/api";
import {
  FaEnvelopeOpenText, FaIdBadge, FaUtensils, FaRegAddressCard, FaMoneyCheckAlt,
  FaGift, FaSeedling, FaLightbulb, FaImage, FaFeather, FaGem, FaHatCowboy,
  FaMugHot, FaTree, FaBirthdayCake, FaFemale, FaUserTie, FaQrcode, FaSms
} from "react-icons/fa";

// Catalogul (cod + etichetă + icon)
const BASE = [
  { code: "invitatii",                  label: "Invitații",               icon: FaEnvelopeOpenText },
  { code: "papetarie-eveniment",        label: "Papetărie eveniment",     icon: FaIdBadge },
  { code: "meniuri",                    label: "Meniuri",                 icon: FaUtensils },
  { code: "place-cards",                label: "Place cards",             icon: FaRegAddressCard },
  { code: "plicuri-bani",               label: "Plicuri bani",            icon: FaMoneyCheckAlt },

  { code: "marturii",                   label: "Mărturii",                icon: FaGift },
  { code: "aranjamente-florale",        label: "Aranjamente florale",     icon: FaSeedling },
  { code: "lumini-decor",               label: "Lumini decor",            icon: FaLightbulb },
  { code: "tablouri",                   label: "Tablouri",                icon: FaImage },
  { code: "textile",                    label: "Textile",                 icon: FaFeather },

  { code: "cadouri",                    label: "Cadouri",                 icon: FaGift },
  { code: "bijuterii",                  label: "Bijuterii",               icon: FaGem },
  { code: "accesorii",                  label: "Accesorii",               icon: FaHatCowboy },
  { code: "ceramica",                   label: "Ceramică",                icon: FaMugHot },
  { code: "lemn",                       label: "Lemn",                    icon: FaTree },

  { code: "tort",                       label: "Tort",                    icon: FaBirthdayCake },
  { code: "rochii-domnisoare-de-onoare",label: "Rochii domnișoare de onoare", icon: FaFemale },
  { code: "organizator",                label: "Organizator",             icon: FaUserTie },

  { code: "invitatie-digitala",         label: "Invitație digitală",      icon: FaEnvelopeOpenText },
  { code: "album-qr",                   label: "Album QR",                icon: FaQrcode },
  { code: "seating-sms",                label: "Seating & SMS",           icon: FaSms },
];

export default function CategoryGrid({ limit = 12 }) {
  const [stats, setStats] = useState(null);

  // pentru glisare + butoane
  const trackRef = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const isDragging = useRef(false);
  const dragStarted = useRef(false);
  const startX = useRef(0);
  const startScrollLeft = useRef(0);
  const DRAG_THRESHOLD = 6;

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
    return () => { alive = false; };
  }, []);

  const items = useMemo(() => {
    if (!Array.isArray(stats)) return BASE.slice(0, limit);
    const counts = new Map(stats.map(s => [String(s.category), Number(s?._count?.category || 0)]));
    const withCounts = BASE.map(c => ({ ...c, count: counts.get(c.code) ?? 0 }));
    withCounts.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label, "ro");
    });
    return withCounts.slice(0, limit);
  }, [stats, limit]);

  // nav state
  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setAtStart(start); setAtEnd(end);
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
    const el = trackRef.current; if (!el) return;
    const amount = Math.round(el.clientWidth * 0.9);
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  // drag-to-scroll
  const onPointerDown = (e) => {
    const el = trackRef.current; if (!el) return;
    isDragging.current = true;
    dragStarted.current = false;
    startX.current = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    startScrollLeft.current = el.scrollLeft;
    el.classList.add(styles.dragging);
  };
  const onPointerMove = (e) => {
    const el = trackRef.current; if (!el || !isDragging.current) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const dx = x - startX.current;
    if (!dragStarted.current && Math.abs(dx) >= DRAG_THRESHOLD) dragStarted.current = true;
    if (dragStarted.current) el.scrollLeft = startScrollLeft.current - dx;
  };
  const onPointerUp = () => {
    const el = trackRef.current; if (!el) return;
    isDragging.current = false;
    dragStarted.current = false;
    el.classList.remove(styles.dragging);
  };
  const onClickCaptureTrack = (e) => {
    if (dragStarted.current) { e.stopPropagation(); e.preventDefault(); }
  };

  if (!items.length) return null;

  return (
    <section className={styles.section} aria-labelledby="cat-title">
      <div className={styles.header}>
        <h2 id="cat-title" className={styles.heading}>Categorii populare</h2>
        <Link to="/produse" className={styles.viewAll}>Vezi toate</Link>
      </div>

      <div className={styles.slider}>
        <button
          className={`${styles.navBtn} ${styles.prev}`}
          onClick={() => scrollByAmount(-1)}
          aria-label="Derulează înapoi"
          disabled={atStart}
          type="button"
        >‹</button>

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
                  <span className={styles.pill}/>
                  <span className={styles.icon}><Icon /></span>
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
        >›</button>
      </div>
    </section>
  );
}
