import React from "react";
import styles from "./Modal.module.css";

const options = [
  { value: "new", label: "Cele mai noi" },
  { value: "price-asc", label: "Preț crescător" },
  { value: "price-desc", label: "Preț descrescător" },
  { value: "rating", label: "Cele mai apreciate" },
];

export default function SortModal({ show, onClose, selected, onSelect }) {
  if (!show) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3>Sortează după</h3>
        <ul className={styles.list}>
          {options.map((opt) => (
            <li
              key={opt.value}
              onClick={() => {
                onSelect(opt.value);
              }}
              className={selected === opt.value ? styles.active : ""}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
