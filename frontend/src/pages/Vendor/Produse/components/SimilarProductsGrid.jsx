// src/pages/ProductDetails/components/SimilarProductsGrid.jsx
import React, { useCallback, useMemo, useRef } from "react";
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

function SimilarProductsGridBase({ products, cacheT, navigate }) {
  const prefetchedRef = useRef(new Set());

  const normalizedProducts = useMemo(() => {
    const list = Array.isArray(products) ? products : [];

    return list.map((p) => {
      const imageSrc =
        Array.isArray(p.images) && p.images[0]
          ? withCache(resolveFileUrl(p.images[0]), cacheT)
          : productPlaceholder(480, 360, "Produs");

      const price =
        typeof p.priceCents === "number" && p.priceCents >= 0
          ? p.priceCents / 100
          : typeof p.price === "number"
          ? p.price
          : null;

      // badge unic (max 1 per card) - reducerea are prioritate față de
      // "Personalizabil" (mai relevantă pentru decizia de cumpărare)
      const badge =
        p.hasDiscount && p.discountPercent > 0
          ? { kind: "discount", label: `-${p.discountPercent}%` }
          : p.acceptsCustom
            ? { kind: "custom", label: "Personalizabil" }
            : null;

      return {
        ...p,
        imageSrc,
        price,
        formattedPrice:
          price != null ? formatMoney(price, p.currency || "RON") : null,
        storeName: p.storeName || p.service?.profile?.displayName || null,
        badge,
      };
    });
  }, [products, cacheT]);

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

  if (!normalizedProducts.length) return null;

  return (
    <section className={styles.relatedSecAlt}>
      <h2 className={styles.sectionTitle}>Produse similare</h2>

      <div className={styles.relatedGrid}>
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
            <div className={styles.relImageWrap}>
              <img
                loading={index < 4 ? "eager" : "lazy"}
                decoding="async"
                src={p.imageSrc}
                alt={p.title || "Produs"}
                width={480}
                height={360}
                onError={(e) => onImgError(e, 480, 360, "Produs")}
              />

              {p.badge && (
                <span
                  className={`${styles.relBadge} ${
                    p.badge.kind === "discount" ? styles.relBadgeDiscount : ""
                  }`}
                >
                  {p.badge.label}
                </span>
              )}
            </div>

            <div className={styles.relBody}>
              {p.storeName && <div className={styles.relStore}>{p.storeName}</div>}

              <div className={styles.relTitle}>{p.title}</div>

              {p.formattedPrice && (
                <div className={styles.relPrice}>{p.formattedPrice}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export const SimilarProductsGrid = React.memo(SimilarProductsGridBase);