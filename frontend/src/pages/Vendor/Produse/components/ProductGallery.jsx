// src/pages/ProductDetails/components/ProductGallery.jsx
import React, { useMemo } from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import styles from "../ProductDetails.module.css";
import { withCache, resolveFileUrl } from "../hooks/urlUtils.js";
import { onImgError } from "../../../../components/utils/imageFallback.js";

/**
 * Galerie de imagini pentru produs.
 * Optimizări:
 * - imaginea principală are prioritate mare
 * - thumbnails sunt lazy
 * - URL-urile sunt memoizate corect
 * - width/height pentru stabilitate layout
 */
function ProductGalleryBase({
  productTitle,
  images,
  activeIdx,
  setActiveIdx,
  activeSrc,
  cacheT,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  setZoomOpen,
}) {
  const resolvedImages = useMemo(() => {
    const safeImages = Array.isArray(images) ? images : [];
    return safeImages.map((img) => withCache(resolveFileUrl(img), cacheT));
  }, [images, cacheT]);

  const activeImageSrc =
    activeSrc || resolvedImages[activeIdx] || resolvedImages[0] || "";

  const canNavigate = resolvedImages.length > 1;

  const goPrev = () => {
    setActiveIdx((i) => (i - 1 + resolvedImages.length) % resolvedImages.length);
  };

  const goNext = () => {
    setActiveIdx((i) => (i + 1) % resolvedImages.length);
  };

  return (
    <div className={styles.gallery}>
      <div
        className={styles.mainImgWrap}
        onClick={() => setZoomOpen(true)}
        role="button"
        tabIndex={0}
        aria-label="Deschide imaginea la dimensiune mare"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setZoomOpen(true);
          }

          if (!canNavigate) return;

          if (e.key === "ArrowLeft") {
            e.preventDefault();
            goPrev();
          }

          if (e.key === "ArrowRight") {
            e.preventDefault();
            goNext();
          }
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          src={activeImageSrc}
          alt={productTitle || "Produs"}
          className={styles.mainImg}
          decoding="async"
          loading="eager"
          fetchPriority="high"
          width={1000}
          height={750}
          sizes="(max-width: 768px) 100vw, (max-width: 980px) 92vw, 58vw"
          onError={(e) => onImgError(e, 1000, 750, "Produs")}
        />

        {canNavigate && (
          <>
            <button
              className={`${styles.navBtn} ${styles.left}`}
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              aria-label="Imaginea anterioară"
              type="button"
            >
              <FaChevronLeft />
            </button>

            <button
              className={`${styles.navBtn} ${styles.right}`}
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              aria-label="Imaginea următoare"
              type="button"
            >
              <FaChevronRight />
            </button>
          </>
        )}
      </div>

      {canNavigate && (
        <div className={styles.thumbs}>
          {resolvedImages.map((src, i) => {
            const isActive = i === activeIdx;

            return (
              <button
                key={`${src}-${i}`}
                className={`${styles.thumb} ${
                  isActive ? styles.thumbActive : ""
                }`}
                onClick={() => setActiveIdx(i)}
                aria-label={`Selectează imaginea ${i + 1}`}
                aria-pressed={isActive}
                type="button"
              >
                <img
                  src={src}
                  loading={i <= 3 ? "eager" : "lazy"}
                  decoding="async"
                  width={160}
                  height={120}
                  alt={`${productTitle || "Produs"} - imagine ${i + 1}`}
                  onError={(e) => onImgError(e, 160, 120, "Produs")}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const ProductGallery = React.memo(ProductGalleryBase);