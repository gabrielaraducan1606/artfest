import React from "react";
import { Link } from "react-router-dom";
import styles from "./CategoryGrid.module.css";
import { FaEnvelopeOpenText, FaGift, FaFireAlt, FaBoxOpen } from "react-icons/fa";

const categories = [
  { title: "Invitații", link: "/produse/invitatii", icon: <FaEnvelopeOpenText /> },
  { title: "Mărturii", link: "/produse/marturii", icon: <FaGift /> },
  { title: "Lumânări", link: "/produse/lumanari", icon: <FaFireAlt /> },
  { title: "Cutii personalizate", link: "/produse/cutii", icon: <FaBoxOpen /> },
];

export default function CategoryGrid() {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>Categorii populare</h2>
      <div className={styles.grid}>
        {categories.map((cat) => (
          <div key={cat.title} className={styles.card}>
            <div className={styles.icon}>{cat.icon}</div>
            <Link to={cat.link} className={styles.link}>
              {cat.title}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
