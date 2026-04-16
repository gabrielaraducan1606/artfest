// src/pages/ProductDetails/components/StoreProductsSlider.jsx
import React, { useCallback, useMemo, useRef } from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import { api } from "../../../../lib/api.js";
import styles from "../ProductDetails.module.css";
import {
  productPlaceholder,
  onImgError,
} from "../../../../components/utils/imageFallback.js";
import { withCache, resolveFileUrl } from "../hooks/urlUtils.js";

function formatMoney(value, currency = "RON") {
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
  }).format(value);
}

function StoreProductsSliderBase({ products, cacheT, navigate }) {
  const scrollRef = useRef(null);
  const prefetchedRef = useRef(new Set());

  const normalizedProducts = useMemo(() => {
    const list = Array.isArray(products) ? products : [];

    return list.map((p) => {
      const imageSrc =
        Array.isArray(p.images) && p.images[0]
          ? withCache(resolveFileUrl(p.images[0]), cacheT)
          : productPlaceholder(480, 360, "Produs");

      const price =
        Number.isFinite(p.priceCents) && p.priceCents >= 0
          ? p.priceCents / 100
          : typeof p.price === "number"
          ? p.price
          : null;

      return {
        ...p,
        imageSrc,
        price,
        formattedPrice:
          price != null ? formatMoney(price, p.currency || "RON") : null,
      };
    });
  }, [products, cacheT]);

  const scroll = useCallback((dir) => {
    const el = scrollRef.current;
    if (!el) return;

    const first = el.firstElementChild;
    const cardWidth = first ? first.getBoundingClientRect().width : 260;
    const delta = (cardWidth + 16) * (dir === "left" ? -1 : 1);

    el.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  const prefetchProduct = useCallback((product) => {
    if (!product?.id) return;

    const key = String(product.id);
    if (prefetchedRef.current.has(key)) return;
    prefetchedRef.current.add(key);

    api(`/api/public/products/${encodeURIComponent(product.id)}`).catch(() => {});

    if (product.imageSrc) {
      const img = new Image();
      img.decoding = "async";
      img.src = product.imageSrc;
    }
  }, []);

  const handleNavigate = useCallback(
    (productId) => {
      if (!productId) return;
      navigate(`/produs/${productId}`);
    },
    [navigate]
  );

  if (!normalizedProducts.length) {
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
        {normalizedProducts.map((p, index) => (
          <button
            key={p.id}
            className={styles.relatedCard}
            onClick={() => handleNavigate(p.id)}
            onMouseEnter={() => prefetchProduct(p)}
            onFocus={() => prefetchProduct(p)}
            onTouchStart={() => prefetchProduct(p)}
            aria-label={`Vezi ${p.title}`}
            type="button"
          >
            <img
              loading={index < 2 ? "eager" : "lazy"}
              decoding="async"
              src={p.imageSrc}
              alt={p.title || "Produs"}
              width={480}
              height={360}
              onError={(e) => onImgError(e, 480, 360, "Produs")}
            />

            <div className={styles.relBody}>
              <div className={styles.relTitle}>{p.title}</div>
              {p.formattedPrice && (
                <div className={styles.relPrice}>{p.formattedPrice}</div>
              )}
            </div>
          </button>
        ))}
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