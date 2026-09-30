// src/components/Returns/ReturnParts.jsx
//
// Piese comune pentru cardurile de retur (vânzător, client, guest, admin).
// Doar afișare - statusurile, etichetele și acțiunile permise vin de la
// backend (services/returnRequestRules.js).

import { useEffect, useState } from "react";
import { RETURN_STATUS_SHORT, returnStyles as styles } from "./returnUtils.js";

export function ReturnBadge({ status }) {
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`] || ""}`}>
      {RETURN_STATUS_SHORT[status] || status}
    </span>
  );
}

export function ReturnItems({ items = [] }) {
  if (!items.length) return null;

  return (
    <ul className={styles.items}>
      {items.map((item) => (
        <li key={item.id || item.title} className={styles.item}>
          <span>{item.title}</span>
          <span className={styles.qty}>× {item.qty}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReturnPhotos({ photos = [] }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!preview) return undefined;

    const onKey = (e) => {
      if (e.key === "Escape") setPreview(null);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  if (!photos.length) return null;

  return (
    <>
      <div className={styles.photos}>
        {photos.map((url, index) => (
          <button
            key={url}
            type="button"
            className={styles.photoBtn}
            onClick={() => setPreview(url)}
            aria-label={`Mărește fotografia ${index + 1}`}
          >
            <img src={url} alt={`Fotografie retur ${index + 1}`} loading="lazy" />
          </button>
        ))}
      </div>

      {preview && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label="Previzualizare fotografie"
          onClick={() => setPreview(null)}
        >
          <img src={preview} alt="Fotografie retur" onClick={(e) => e.stopPropagation()} />
          <button type="button" className={styles.lightboxClose} onClick={() => setPreview(null)} aria-label="Închide">
            ×
          </button>
        </div>
      )}
    </>
  );
}

