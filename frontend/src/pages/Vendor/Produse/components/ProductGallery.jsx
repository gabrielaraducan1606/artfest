// src/pages/ProductDetails/components/ProductGallery.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaChevronLeft, FaChevronRight, FaPlay, FaVideo } from "react-icons/fa";
import styles from "../ProductDetails.module.css";
import { withCache, resolveFileUrl } from "../hooks/urlUtils.js";
import { onImgError } from "../../../../components/utils/imageFallback.js";

/**
 * Frame real din video (nu poza produsului), folosit ca thumbnail
 * în galerie. Cât timp frame-ul nu s-a putut încă genera (sau
 * browserul nu poate), rămâne vizibil fallback-ul neutru.
 */
function VideoFrameThumb({ src }) {
  const [ready, setReady] = useState(false);

  const handleLoadedMetadata = (e) => {
    const el = e.currentTarget;
    const duration =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    const target = duration > 0 ? Math.min(0.1, Math.max(0, duration - 0.05)) : 0.1;

    try {
      el.currentTime = target;
    } catch {
      /* fallback-ul rămâne vizibil */
    }
  };

  return (
    <span className={styles.videoThumbFrame}>
      <video
        src={src}
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
        aria-hidden="true"
        className={styles.videoThumbVideo}
        onLoadedMetadata={handleLoadedMetadata}
        onSeeked={() => setReady(true)}
        onLoadedData={() => setReady(true)}
      />

      {!ready && (
        <span className={styles.videoThumbFallback} aria-hidden="true">
          <FaVideo />
        </span>
      )}

      <span className={styles.videoThumbPlayIcon} aria-hidden="true">
        <FaPlay />
      </span>
    </span>
  );
}

/**
 * Galerie de imagini + video pentru produs.
 * Optimizări:
 * - imaginea principală are prioritate mare
 * - thumbnails sunt lazy
 * - URL-urile sunt memoizate corect
 * - width/height pentru stabilitate layout
 *
 * Ordinea slide-urilor (când există video): poza principală,
 * apoi videoul, apoi restul pozelor. Videoul nu e niciodată
 * amestecat în images[].
 */
function ProductGalleryBase({
  productTitle,
  images,
  videoUrl,
  videoMuted,
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

  const hasVideo = !!videoUrl;
  const slideCount = resolvedImages.length + (hasVideo ? 1 : 0);

  // Videoul ocupă slot-ul 1 (după poza principală) dacă există poze,
  // altfel slot-ul 0. Trebuie ținut în sincron cu ProductDetails.jsx
  // (slideIndexForImage / imageIndexForSlide).
  const videoSlideIndex = hasVideo ? (resolvedImages.length ? 1 : 0) : -1;
  const isVideoActive = hasVideo && activeIdx === videoSlideIndex;
  const imageIdx = !hasVideo
    ? activeIdx
    : activeIdx <= 0
    ? 0
    : Math.max(0, activeIdx - 1);

  const videoRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  // Reper de timing (doar dev) pentru imaginea principală - marcat o
  // singură dată, nu la fiecare navigare ulterioară prin galerie.
  const mainImageMarkedRef = useRef(false);

  const handleMainImageLoad = () => {
    if (mainImageMarkedRef.current) return;
    if (!(import.meta.env?.DEV && typeof performance !== "undefined")) return;
    mainImageMarkedRef.current = true;
    try {
      performance.mark("productdetails:main-image-loaded");
    } catch {
      // ignore
    }
  };

  // La schimbarea slide-ului de pe video: oprim redarea (unmount-ul
  // <video> de mai jos o face oricum) și resetăm starea la
  // preview/play, nu redare automată la revenire.
  useEffect(() => {
    if (!isVideoActive) {
      setIsPlaying(false);
      setFrameReady(false);
    }
  }, [isVideoActive]);

  const playVideo = (e) => {
    e.stopPropagation();
    videoRef.current?.play();
    setIsPlaying(true);
  };

  // Plasă de siguranță suplimentară: dacă `videoMuted` e true (fișier
  // fără pistă audio, sau produse mai vechi marcate muted înainte de
  // eliminarea fizică a audio), forțăm mut la orice încercare a
  // clientului de a da unmute din controalele native.
  const enforceMuted = (e) => {
    if (videoMuted && !e.currentTarget.muted) {
      e.currentTarget.muted = true;
    }
  };

  const handleVideoLoadedMetadata = (e) => {
    const el = e.currentTarget;
    const duration =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    const target = duration > 0 ? Math.min(0.1, Math.max(0, duration - 0.05)) : 0.1;

    try {
      el.currentTime = target;
    } catch {
      /* fallback-ul neutru rămâne vizibil */
    }
  };

  const activeImageSrc =
    activeSrc || resolvedImages[imageIdx] || resolvedImages[0] || "";

  const canNavigate = slideCount > 1;

  const goPrev = () => {
    setActiveIdx((i) => (i - 1 + slideCount) % slideCount);
  };

  const goNext = () => {
    setActiveIdx((i) => (i + 1) % slideCount);
  };

  const thumbItems = useMemo(() => {
    const items = [];

    if (hasVideo && resolvedImages.length === 0) {
      items.push({ type: "video", slideIdx: videoSlideIndex });
    }

    resolvedImages.forEach((src, i) => {
      if (i === 0) {
        items.push({ type: "image", slideIdx: 0, src, imgIndex: 0 });
        if (hasVideo) {
          items.push({ type: "video", slideIdx: videoSlideIndex });
        }
        return;
      }

      items.push({
        type: "image",
        slideIdx: hasVideo ? i + 1 : i,
        src,
        imgIndex: i,
      });
    });

    return items;
  }, [resolvedImages, hasVideo, videoSlideIndex]);

  return (
    <div className={styles.gallery}>
      <div
        className={styles.mainImgWrap}
        onClick={() => {
          if (!isVideoActive) setZoomOpen(true);
        }}
        role="button"
        tabIndex={0}
        aria-label={
          isVideoActive
            ? "Video produs"
            : "Deschide imaginea la dimensiune mare"
        }
        onKeyDown={(e) => {
          if (
            (e.key === "Enter" || e.key === " ") &&
            !isVideoActive
          ) {
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
        {isVideoActive ? (
          <div className={styles.videoSlide}>
            <video
              ref={videoRef}
              src={videoUrl}
              controls={isPlaying}
              playsInline
              preload="metadata"
              muted={!isPlaying || !!videoMuted}
              className={styles.mainImg}
              style={{ background: "#000" }}
              onLoadedMetadata={handleVideoLoadedMetadata}
              onSeeked={() => setFrameReady(true)}
              onLoadedData={() => setFrameReady(true)}
              onPlay={() => setIsPlaying(true)}
              onVolumeChange={enforceMuted}
            />

            {!isPlaying && !frameReady && (
              <div className={styles.videoFrameFallback} aria-hidden="true">
                <FaVideo className={styles.videoFrameFallbackIcon} />
                <span className={styles.videoFrameFallbackLabel}>Video</span>
              </div>
            )}

            {!isPlaying && (
              <button
                type="button"
                className={styles.videoPlayOverlay}
                aria-label="Redă videoul"
                onClick={playVideo}
              >
                <span className={styles.videoPlayButton}>
                  <FaPlay
                    className={styles.videoPlayIcon}
                    aria-hidden="true"
                  />
                </span>
              </button>
            )}
          </div>
        ) : (
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
            onLoad={handleMainImageLoad}
            onError={(e) => onImgError(e, 1000, 750, "Produs")}
          />
        )}

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
          {thumbItems.map((item) =>
            item.type === "video" ? (
              <button
                key="video-thumb"
                className={`${styles.thumb} ${
                  isVideoActive ? styles.thumbActive : ""
                }`}
                onClick={() => setActiveIdx(item.slideIdx)}
                aria-label="Selectează videoul"
                aria-pressed={isVideoActive}
                type="button"
              >
                <VideoFrameThumb src={videoUrl} />
              </button>
            ) : (
              <button
                key={`${item.src}-${item.imgIndex}`}
                className={`${styles.thumb} ${
                  item.slideIdx === activeIdx ? styles.thumbActive : ""
                }`}
                onClick={() => setActiveIdx(item.slideIdx)}
                aria-label={`Selectează imaginea ${item.imgIndex + 1}`}
                aria-pressed={item.slideIdx === activeIdx}
                type="button"
              >
                <img
                  src={item.src}
                  loading={item.imgIndex <= 3 ? "eager" : "lazy"}
                  decoding="async"
                  width={160}
                  height={120}
                  alt={`${productTitle || "Produs"} - imagine ${
                    item.imgIndex + 1
                  }`}
                  onError={(e) => onImgError(e, 160, 120, "Produs")}
                />
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export const ProductGallery = React.memo(ProductGalleryBase);
