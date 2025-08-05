import React from "react";
import styles from "./Modal.module.css";

const OPTIONS = [
  { value: "featured", label: "Relevanță (recomandate)" },
  { value: "rating", label: "Rating descrescător" },
  { value: "products", label: "Număr produse descrescător" },
  { value: "name-asc", label: "Nume A–Z" },
  { value: "name-desc", label: "Nume Z–A" },
  { value: "newest", label: "Cele mai noi" },
];

export default function StoreSortModal({ show, onClose, selected, onSelect }) {
  if (!show) return null;

  const handlePick = (value) => {
    onSelect(value);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3>Sortează magazine</h3>
        <ul className={styles.list}>
          {OPTIONS.map((opt) => (
            <li
              key={opt.value}
              className={selected === opt.value ? styles.active : ""}
              onClick={() => handlePick(opt.value)}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
