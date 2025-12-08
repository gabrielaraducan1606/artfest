// src/pages/ProductDetails/components/ProductGallery.jsx
import React from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import styles from "../ProductDetails.module.css";
import { withCache, resolveFileUrl } from "../hooks/urlUtils.js";
import { onImgError } from "../../../../components/utils/imageFallback.js";

/**
 * Galerie de imagini pentru produs.
 * E extrasă într-o componentă separată + memo pentru a reduce re-randările.
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
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          src={activeSrc}
          srcSet={`${withCache(
            resolveFileUrl(images[activeIdx]),
            cacheT
          )} 1000w`}
          sizes="(max-width: 980px) 100vw, 58vw"
          alt={productTitle}
          className={styles.mainImg}
          decoding="async"
          onError={(e) => onImgError(e, 1000, 750, "Produs")}
        />
        {images.length > 1 && (
          <>
            <button
              className={`${styles.navBtn} ${styles.left}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveIdx((i) => (i - 1 + images.length) % images.length);
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
                setActiveIdx((i) => (i + 1) % images.length);
              }}
              aria-label="Imaginea următoare"
              type="button"
            >
              <FaChevronRight />
            </button>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className={styles.thumbs}>
          {images.map((u, i) => (
            <button
              key={`${u}-${i}`}
              className={`${styles.thumb} ${
                i === activeIdx ? styles.thumbActive : ""
              }`}
              onClick={() => setActiveIdx(i)}
              aria-label={`Miniatură ${i + 1}`}
              type="button"
            >
              <img
                loading="lazy"
                src={withCache(resolveFileUrl(u), cacheT)}
                alt={`mini-${i}`}
                onError={(e) => onImgError(e, 160, 120, "Produs")}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const ProductGallery = React.memo(ProductGalleryBase);
