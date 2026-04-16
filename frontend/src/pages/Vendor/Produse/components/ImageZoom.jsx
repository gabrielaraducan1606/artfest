// src/pages/ProductDetails/components/ImageZoom.jsx
import React, { useEffect, useMemo } from "react";
import { FaChevronLeft, FaChevronRight } from "react-icons/fa";
import styles from "../ProductDetails.module.css";
import { withCache, resolveFileUrl } from "../hooks/urlUtils.js";
import { onImgError } from "../../../../components/utils/imageFallback.js";

function ImageZoomBase({
  open,
  images,
  activeIdx,
  setActiveIdx,
  activeSrc,
  onClose,
}) {
  const safeImages = useMemo(
    () => (Array.isArray(images) ? images : []),
    [images]
  );

  const canNavigate = safeImages.length > 1;

  const resolvedImages = useMemo(() => {
    return safeImages.map((img) => resolveFileUrl(img));
  }, [safeImages]);

  const currentSrc =
    activeSrc || resolvedImages[activeIdx] || resolvedImages[0] || "";

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (!canNavigate) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + safeImages.length) % safeImages.length);
      }

      if (e.key === "ArrowRight") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % safeImages.length);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose, canNavigate, setActiveIdx, safeImages.length]);

  useEffect(() => {
    if (!open || !canNavigate) return;

    const prevIdx = (activeIdx - 1 + resolvedImages.length) % resolvedImages.length;
    const nextIdx = (activeIdx + 1) % resolvedImages.length;

    const prevImg = new Image();
    prevImg.decoding = "async";
    prevImg.src = withCache(resolvedImages[prevIdx], "zoom");

    const nextImg = new Image();
    nextImg.decoding = "async";
    nextImg.src = withCache(resolvedImages[nextIdx], "zoom");
  }, [open, canNavigate, activeIdx, resolvedImages]);

  if (!open) return null;

  return (
    <div
      className={styles.zoomBackdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Imagine produs mărită"
    >
      <div className={styles.zoomInner} onClick={(e) => e.stopPropagation()}>
        <img
          src={currentSrc}
          alt="Imagine produs mărită"
          className={styles.zoomImg}
          decoding="async"
          loading="eager"
          fetchPriority="high"
          onError={(e) => onImgError(e, 1400, 1050, "Produs")}
        />

        {canNavigate && (
          <div className={styles.zoomNav}>
            <button
              type="button"
              onClick={() =>
                setActiveIdx((i) => (i - 1 + safeImages.length) % safeImages.length)
              }
              aria-label="Imaginea anterioară"
            >
              <FaChevronLeft />
            </button>

            <button
              type="button"
              onClick={() =>
                setActiveIdx((i) => (i + 1) % safeImages.length)
              }
              aria-label="Imaginea următoare"
            >
              <FaChevronRight />
            </button>
          </div>
        )}

        <button
          type="button"
          className={styles.zoomClose}
          onClick={onClose}
          aria-label="Închide"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export const ImageZoom = React.memo(ImageZoomBase);