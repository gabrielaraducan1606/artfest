// Eticheta „Întreabă vânzătorul” din inbox: produsul și motivul contactării.
// Doar date publice ale produsului (titlu, imagine), venite din API.
import React from "react";
import { Link } from "react-router-dom";
import styles from "./ProductContactBadge.module.css";

export default function ProductContactBadge({ product, contactReason, contactReasonLabel, compact = false }) {
  if (!product && !contactReason) return null;
  const isSafety = contactReason === "SAFETY";

  return (
    <span
      className={`${styles.badge} ${compact ? styles.compact : ""}`}
      data-testid="product-contact-badge"
    >
      {contactReasonLabel ? (
        <span className={`${styles.reason} ${isSafety ? styles.safety : ""}`}>{contactReasonLabel}</span>
      ) : null}
      {product ? (
        compact ? (
          <span className={styles.product} title={product.title}>
            {product.title}
          </span>
        ) : (
          <Link
            className={styles.product}
            to={`/produs/${encodeURIComponent(product.id)}`}
            title={product.title}
            onClick={(e) => e.stopPropagation()}
          >
            {product.image ? <img src={product.image} alt="" className={styles.thumb} loading="lazy" /> : null}
            {product.title}
          </Link>
        )
      ) : null}
    </span>
  );
}
