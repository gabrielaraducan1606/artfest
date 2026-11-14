// src/pages/Vendor/Produse/components/CustomizationQuantityPrompt.jsx
//
// Confirmarea scurtă „Ai încărcat N fotografii, dar ai selectat M produse”.
// Doar întreabă: alegerea clientului NU garantează că numărul de bucăți e
// corect, iar prețul final rămâne cel calculat de coș (aici e o estimare
// din prețul unitar afișat pe pagină).

import React, { useEffect, useId, useRef } from "react";
import styles from "./CustomizationQuantityPrompt.module.css";
import { photosLabel, productsLabel } from "../hooks/customizationQuantity.js";

/* aceeași limită ca /api/cart/add (clamp 1..99) */
const CART_MAX_QTY = 99;

export default function CustomizationQuantityPrompt({
  photoCount,
  qty,
  unitPrice,
  formatPrice,
  onChooseCount,
  onKeepQty,
  onClose,
}) {
  const titleId = useId();
  const firstButtonRef = useRef(null);

  const target = Math.min(CART_MAX_QTY, photoCount);
  const hasPrice = typeof unitPrice === "number" && Number.isFinite(unitPrice) && unitPrice > 0;
  const total = (count) => (hasPrice && formatPrice ? formatPrice(unitPrice * count) : null);

  useEffect(() => {
    firstButtonRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <p id={titleId} className={styles.text}>
          Ai încărcat <strong>{photosLabel(photoCount)}</strong>, dar ai selectat{" "}
          <strong>{productsLabel(qty)}</strong>. Dorești {productsLabel(target)} personalizate
          sau toate fotografiile sunt pentru {qty === 1 ? "un singur produs" : `cele ${productsLabel(qty)}`}?
        </p>

        <div className={styles.options}>
          <button
            ref={firstButtonRef}
            type="button"
            className={`${styles.option} ${styles.optionPrimary}`}
            onClick={() => onChooseCount?.(target)}
          >
            <span className={styles.optionTitle}>{productsLabel(target)}</span>
            {total(target) && <span className={styles.optionPrice}>Total estimat: {total(target)}</span>}
          </button>

          <button type="button" className={styles.option} onClick={() => onKeepQty?.(qty)}>
            <span className={styles.optionTitle}>
              {qty === 1 ? "Un singur produs" : `Păstrez ${productsLabel(qty)}`}
            </span>
            {total(qty) && <span className={styles.optionPrice}>Total estimat: {total(qty)}</span>}
          </button>
        </div>

        {photoCount > CART_MAX_QTY && (
          <p className={styles.note}>Într-o comandă se pot adăuga cel mult {CART_MAX_QTY} bucăți.</p>
        )}
        <p className={styles.note}>
          Totalul final se calculează în coș. Dacă nu ești sigur, verifică descrierea produsului sau
          întreabă vânzătorul.
        </p>

        <button type="button" className={styles.close} onClick={onClose}>
          Înapoi
        </button>
      </div>
    </div>
  );
}
