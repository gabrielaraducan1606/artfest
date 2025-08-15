import React from "react";
import { Link } from "react-router-dom";
import styles from "./CategoryGrid.module.css";
import { FaEnvelopeOpenText, FaGift, FaFireAlt, FaBoxOpen } from "react-icons/fa";

const categories = [
  { title: "Invitații", slug: "invitatii", icon: <FaEnvelopeOpenText /> },
  { title: "Mărturii", slug: "marturii", icon: <FaGift /> },
  { title: "Lumânări", slug: "lumanari", icon: <FaFireAlt /> },
  { title: "Cutii personalizate", slug: "cutii", icon: <FaBoxOpen /> },
];

export default function CategoryGrid() {
  return (
    <section className={styles.section} aria-labelledby="cat-title">
      <div className={styles.header}>
        <h2 id="cat-title" className={styles.title}>Categorii populare</h2>
        <Link to="/produse" className={styles.viewAll}>Vezi toate</Link>
      </div>

      <div className={styles.grid}>
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            to={`/produse?categorie=${encodeURIComponent(cat.slug)}`}
            className={styles.card}
            aria-label={`Vezi produse din categoria ${cat.title}`}
          >
            <div className={styles.iconWrap}>
              <span className={styles.icon}>{cat.icon}</span>
            </div>
            <div className={styles.text}>
              <span className={styles.name}>{cat.title}</span>
              <span className={styles.cta}>Explorează →</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
