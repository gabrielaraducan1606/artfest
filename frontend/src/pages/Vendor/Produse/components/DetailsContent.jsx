// src/pages/ProductDetails/components/DetailsContent.jsx
import React from "react";
import styles from "../ProductDetails.module.css";
import { hasText, splitTags } from "../hooks/detailsUtils.js";

// fișierul acesta exportă DOAR componentă React → OK pentru Fast Refresh
function DetailsContentBase({ product, availabilityText }) {
  if (!product) return null;

  return (
    <>
      {availabilityText && (
        <p className={styles.detailsLine}>
          <strong>Disponibilitate:</strong> {availabilityText}
        </p>
      )}

      {product.acceptsCustom && (
        <p className={styles.detailsLine}>
          <strong>Personalizare:</strong> Acest produs poate fi realizat și în
          variantă personalizată. Poți discuta detaliile direct cu artizanul
          după plasarea comenzii.
        </p>
      )}

      {hasText(product.materialMain) && (
        <p className={styles.detailsLine}>
          <strong>Material principal:</strong> {product.materialMain}
        </p>
      )}

      {hasText(product.technique) && (
        <p className={styles.detailsLine}>
          <strong>Tehnică:</strong> {product.technique}
        </p>
      )}

      {hasText(product.dimensions) && (
        <p className={styles.detailsLine}>
          <strong>Dimensiuni:</strong> {product.dimensions}
        </p>
      )}

      {splitTags(product.styleTags).length > 0 && (
        <p className={styles.detailsLine}>
          <strong>Stil:</strong>{" "}
          {splitTags(product.styleTags).map((tag) => (
            <span key={tag} className={styles.detailTag}>
              {tag}
            </span>
          ))}
        </p>
      )}

      {splitTags(product.occasionTags).length > 0 && (
        <p className={styles.detailsLine}>
          <strong>Ocazii:</strong>{" "}
          {splitTags(product.occasionTags).map((tag) => (
            <span key={tag} className={styles.detailTag}>
              {tag}
            </span>
          ))}
        </p>
      )}

      {splitTags(product.careInstructions).length > 0 && (
        <p className={styles.detailsLine}>
          <strong>Îngrijire:</strong>{" "}
          {splitTags(product.careInstructions).map((tag) => (
            <span key={tag} className={styles.detailTag}>
              {tag}
            </span>
          ))}
        </p>
      )}

      {hasText(product.specialNotes) && (
        <p className={styles.detailsLine}>
          <strong>Note speciale:</strong> {product.specialNotes}
        </p>
      )}

      {hasText(product.color) && (
        <p className={styles.detailsLine}>
          <strong>Culoare principală:</strong> {product.color}
        </p>
      )}
    </>
  );
}

// export default singur → nu mai încalcă regula react-refresh/only-export-components
const DetailsContent = React.memo(DetailsContentBase);
export default DetailsContent;
