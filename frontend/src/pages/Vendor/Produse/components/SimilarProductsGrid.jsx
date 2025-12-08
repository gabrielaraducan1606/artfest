// src/pages/ProductDetails/components/SimilarProductsGrid.jsx
import React from "react";
import styles from "../ProductDetails.module.css";
import {
  productPlaceholder,
  onImgError,
} from "../../../../components/utils/imageFallback.js";
import { withCache, resolveFileUrl } from "../hooks/urlUtils.js";

function SimilarProductsGridBase({ products, cacheT, navigate }) {
  if (products.length === 0) return null;

  return (
    <section className={styles.relatedSecAlt}>
      <h2 className={styles.sectionTitle}>Produse similare din alte magazine</h2>
      <div className={styles.relatedGrid}>
        {products.map((p) => {
          const img =
            Array.isArray(p.images) && p.images[0]
              ? withCache(resolveFileUrl(p.images[0]), cacheT)
              : productPlaceholder(480, 360, "Produs");

          const price =
            typeof p.priceCents === "number" ? p.priceCents / 100 : null;

          return (
            <button
              key={p.id}
              className={styles.relatedCard}
              onClick={() => navigate(`/produs/${p.id}`)}
              aria-label={`Vezi ${p.title}`}
              type="button"
            >
              <img
                loading="lazy"
                src={img}
                alt={p.title}
                onError={(e) => onImgError(e, 480, 360, "Produs")}
              />
              <div className={styles.relBody}>
                <div className={styles.relTitle}>{p.title}</div>
                {price != null && (
                  <div className={styles.relPrice}>
                    {new Intl.NumberFormat("ro-RO", {
                      style: "currency",
                      currency: p.currency || "RON",
                    }).format(price)}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export const SimilarProductsGrid = React.memo(SimilarProductsGridBase);
