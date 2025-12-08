// src/pages/ProductDetails/components/ImageZoom.jsx
import React from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import styles from "../ProductDetails.module.css";

export function ImageZoom({ open, images, setActiveIdx, activeSrc, onClose }) {
  if (!open) return null;

  return (
    <div
      className={styles.zoomBackdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={styles.zoomInner}
        onClick={(e) => e.stopPropagation()}
      >
        <img src={activeSrc} alt="Zoom" className={styles.zoomImg} />
        {images.length > 1 && (
          <div className={styles.zoomNav}>
            <button
              type="button"
              onClick={() =>
                setActiveIdx((i) => (i - 1 + images.length) % images.length)
              }
              aria-label="Imaginea anterioară"
            >
              <FaChevronLeft />
            </button>
            <button
              type="button"
              onClick={() =>
                setActiveIdx((i) => (i + 1) % images.length)
              }
              aria-label="Imaginea următoare"
            >
              <FaChevronRight />
            </button>
          </div>
        )}
        <button
          type="button"
          className={styles.zoomClose}
          onClick={onClose}
          aria-label="Închide"
        >
          ×
        </button>
      </div>
    </div>
  );
}
