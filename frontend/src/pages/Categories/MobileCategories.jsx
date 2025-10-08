// frontend/src/pages/MobileCategories/MobileCategories.jsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import styles from "./MobileCategories.module.css";

import hero from "../../assets/heroSectionImage.jpg";
import logo from "../../assets/LogoArtfest.png";

import {
  FaEnvelopeOpenText, FaIdBadge, FaUtensils, FaRegAddressCard, FaMoneyCheckAlt,
  FaGift, FaSeedling, FaLightbulb, FaImage, FaFeather,
  FaGem, FaMugHot, FaTree, FaBirthdayCake,
  FaFemale, FaUserTie, FaStore, FaClock, FaTags
} from "react-icons/fa";

/* Tabs (stânga) */
const ROOT_TABS = [
  { key: "digitale", label: "Servicii digitale" },
  { key: "produse",  label: "Produse" },
  { key: "servicii", label: "Servicii" },
];

/* Servicii digitale (dreapta) */
const DIGITAL = [
  { key: "invitatia", label: "Invitație instant", to: "/digitale/invitatie",     img: hero },
  { key: "seating",   label: "Seating (SMS)",     to: "/digitale/asezare-mese",  img: hero },
  { key: "albumqr",   label: "Album QR",          to: "/digitale/album-qr",      img: logo },
];

/* Produse (dreapta) */
const PRODUCTS = [
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
  { code: "accesorii",                  label: "Accesorii",               icon: FaTags },
  { code: "ceramica",                   label: "Ceramică",                icon: FaMugHot },
  { code: "lemn",                       label: "Lemn",                    icon: FaTree },

  { code: "tort",                       label: "Tort",                    icon: FaBirthdayCake },
  { code: "rochii-domnisoare-de-onoare",label: "Rochii domnișoare",       icon: FaFemale },
  { code: "organizator",                label: "Organizator",             icon: FaUserTie },
];

/* Servicii (dreapta) */
const SERVICES = [
  { key: "magazine", label: "Magazine", to: "/magazine", icon: FaStore, soon: false },
  { key: "photo",    label: "Foto/Video", to: "#", icon: FaClock, soon: true },
  { key: "music",    label: "Formație / DJ", to: "#", icon: FaClock, soon: true },
  { key: "florist",  label: "Florărie", to: "#", icon: FaClock, soon: true },
  { key: "catering", label: "Catering", to: "#", icon: FaClock, soon: true },
  { key: "decor",    label: "Decor/Cort", to: "#", icon: FaClock, soon: true },
];

export default function MobileCategories() {
  const [tab, setTab] = useState("digitale");

  /* asigurăm --header-h corect (dacă n-a fost deja setată) */
  useEffect(() => {
    const header = document.querySelector("header, .header, [data-header]");
    if (!header) return;

    const setVar = () => {
      const h = Math.round(header.offsetHeight || 64);
      const cur = getComputedStyle(document.documentElement).getPropertyValue("--header-h");
      if (!cur || cur.trim() === "" || parseInt(cur) !== h) {
        document.documentElement.style.setProperty("--header-h", `${h}px`);
      }
    };
    setVar();
    const ro = new ResizeObserver(setVar);
    ro.observe(header);
    window.addEventListener("resize", setVar);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", setVar);
    };
  }, []);

  useEffect(() => {
    const usp = new URLSearchParams(window.location.search);
    const t = usp.get("tab");
    if (t && ROOT_TABS.some((r) => r.key === t)) setTab(t);
  }, []);

  const onPickTab = (key) => {
    setTab(key);
    const usp = new URLSearchParams(window.location.search);
    usp.set("tab", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${usp.toString()}`);
  };

  return (
    <section className={styles.page} aria-label="Categorii">
      {/* Rail stânga */}
      <aside className={styles.rail} aria-label="Secțiuni">
        {ROOT_TABS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`${styles.railItem} ${tab === r.key ? styles.railItemActive : ""}`}
            onClick={() => onPickTab(r.key)}
            aria-current={tab === r.key ? "true" : "false"}
          >
            {r.label}
          </button>
        ))}
      </aside>

      {/* Panou dreapta */}
      <main className={styles.panel}>
        {tab === "digitale" && (
          <>
            <h1 className={styles.heading}>Servicii digitale</h1>
            <div className={styles.circleGrid}>
              {DIGITAL.map((d) => (
                <Link key={d.key} to={d.to} className={styles.circleCard}>
                  <span className={styles.circleImgWrap}>
                    <img src={d.img} alt="" className={styles.circleImg} loading="lazy" />
                  </span>
                  <span className={styles.circleLabel}>{d.label}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        {tab === "produse" && (
          <>
            <h1 className={styles.heading}>Produse</h1>
            <div className={styles.grid}>
              {PRODUCTS.map(({ code, label, icon: IconComp }) => (
                <Link
                  key={code}
                  to={`/produse?cat=${encodeURIComponent(code)}`}
                  className={styles.tile}
                >
                  <span className={styles.tileIcon}>
                    {IconComp ? <IconComp size={18} /> : null}
                  </span>
                  <span className={styles.tileLabel}>{label}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        {tab === "servicii" && (
          <>
            <h1 className={styles.heading}>Servicii</h1>
            <div className={styles.grid}>
              {SERVICES.map(({ key, label, to, icon: IconComp, soon }) => (
                <Link
                  key={key}
                  to={to}
                  className={`${styles.tile} ${soon ? styles.tileSoon : ""}`}
                  onClick={(e) => { if (soon) e.preventDefault(); }}
                  title={soon ? "Disponibil în curând" : label}
                >
                  <span className={styles.tileIcon}>
                    {IconComp ? <IconComp size={18} /> : null}
                  </span>
                  <span className={styles.tileLabel}>{label}</span>
                  {soon && <span className={styles.badgeSoon}>Curând</span>}
                </Link>
              ))}
            </div>
          </>
        )}
      </main>
    </section>
  );
}
