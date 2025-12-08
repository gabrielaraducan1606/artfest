// src/pages/ProductDetails/components/StoreProductsSlider.jsx
import React, { useRef } from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import styles from "../ProductDetails.module.css";
import {
  productPlaceholder,
  onImgError,
} from "../../../../components/utils/imageFallback.js";
import { withCache, resolveFileUrl } from "../hooks/urlUtils.js";

function StoreProductsSliderBase({ products, cacheT, navigate }) {
  const scrollRef = useRef(null);

  const scroll = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    const first = el.firstElementChild;
    const cardWidth = first ? first.getBoundingClientRect().width : 260;
    const delta = (cardWidth + 16) * (dir === "left" ? -1 : 1);
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  if (products.length === 0) {
    return (
      <div className={styles.emptyBox}>
        Nu mai sunt produse publice în acest magazin.
      </div>
    );
  }

  return (
    <div className={styles.relatedSlider}>
      <button
        type="button"
        className={`${styles.sliderArrow} ${styles.sliderArrowLeft}`}
        onClick={() => scroll("left")}
        aria-label="Derulează spre stânga"
      >
        <FaChevronLeft />
      </button>

      <div className={styles.relatedScroll} ref={scrollRef}>
        {products.map((p) => {
          const img =
            Array.isArray(p.images) && p.images[0]
              ? withCache(resolveFileUrl(p.images[0]), cacheT)
              : productPlaceholder(480, 360, "Produs");

          const price =
            Number.isFinite(p.priceCents) && p.priceCents >= 0
              ? p.priceCents / 100
              : null;

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

      <button
        type="button"
        className={`${styles.sliderArrow} ${styles.sliderArrowRight}`}
        onClick={() => scroll("right")}
        aria-label="Derulează spre dreapta"
      >
        <FaChevronRight />
      </button>
    </div>
  );
}

export const StoreProductsSlider = React.memo(StoreProductsSliderBase);
