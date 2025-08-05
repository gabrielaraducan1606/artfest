import React from "react";
import styles from "./Modal.module.css";

const CATEGORY_OPTIONS = [
  { value: "", label: "Toate categoriile" },
  { value: "Invitații", label: "Invitații" },
  { value: "Mărturii", label: "Mărturii" },
  { value: "Trusouri", label: "Trusouri" },
  { value: "Decor", label: "Decor" },
];

const RATING_OPTIONS = [
  { value: "", label: "Toate rating-urile" },
  { value: "4", label: "Minim 4 ⭐" },
  { value: "3", label: "Minim 3 ⭐" },
  { value: "2", label: "Minim 2 ⭐" },
];

export default function StoreFilterModal({ show, onClose, selected, onSelect }) {
  if (!show) return null;

  const handlePick = (updates) => {
    onSelect(updates);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3>Filtrează magazine</h3>

        <div className={styles.section}>
          <h4>Categorie</h4>
          <ul className={styles.list}>
            {CATEGORY_OPTIONS.map((opt) => (
              <li
                key={opt.value}
                className={
                  (selected.category || "") === opt.value ? styles.active : ""
                }
                onClick={() => handlePick({ category: opt.value })}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.section}>
          <h4>Rating minim</h4>
          <ul className={styles.list}>
            {RATING_OPTIONS.map((opt) => (
              <li
                key={opt.value}
                className={
                  (selected.minRating || "") === opt.value ? styles.active : ""
                }
                onClick={() => handlePick({ minRating: opt.value })}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
