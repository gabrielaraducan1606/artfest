import React from "react";
import styles from "./Modal.module.css";

const categories = [
  "Toate",
  "Invitație",
  "Invitații Botez",
  "Mărturii Nuntă",
  "Mărturii Botez",
  "Trusou Botez",
  "Set băiță a doua zi",
  "Cutii cadou",
  "Lumânări personalizate",
];

export default function FilterModal({ show, onClose, selected, onSelect }) {
  if (!show) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3>Alege categorie</h3>
        <ul className={styles.list}>
          {categories.map((cat) => (
            <li
              key={cat}
              onClick={() => {
                onSelect(cat === "Toate" ? "" : cat);
              }}
              className={selected === cat || (cat === "Toate" && !selected) ? styles.active : ""}
            >
              {cat}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
