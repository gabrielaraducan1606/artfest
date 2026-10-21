// src/pages/Home/FeaturedPicks/FeaturedPicks.jsx
//
// „Alese de echipa Artfest”: Produsul zilei + Artizanul săptămânii.
// O singură sursă pentru homepage (varianta completă) și /produse
// (varianta compactă): aceleași endpointuri, cache, prefetch și calcule
// de preț/reducere - mutate din HeroSection.jsx fără modificări de logică.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Link,
} from "react-router-dom";

import {
  FaArrowLeft,
  FaArrowRight,
  FaCheckCircle,
  FaMapMarkerAlt,
  FaStar,
  FaStore,
} from "react-icons/fa";

import styles from "./FeaturedPicks.module.css";

import imageMain from "../../../assets/heroSectionImage.jpg";

import { prefetchData, getPrefetchedData } from "../../../lib/smartPrefetch.js";
import { trackEvent } from "../../../../services/analytics.js";
import { getQuoteCardPriceLabel } from "../../Vendor/Produse/hooks/priceDisplayMode.js";
import { logHpTimingSummary, markHpTiming } from "./homepageTiming.js";

const STORE_PAGE_PREFIX =
  "/magazin";

/* =========================================================
   CACHE SCURT PENTRU "PRODUSUL ZILEI" / "ARTIZANUL SĂPTĂMÂNII"
   =========================================================
   Product of the day se schimbă o dată pe zi, Artisan of the week o
   dată pe săptămână (confirmat din backend: dateKey = zi, respectiv
   săptămână) - un TTL de 15 minute e sigur din perspectiva
   frecvenței reale de schimbare, dar rămas conservator (nu maxim
   posibil) ca să nu depindem de asta. NU e sursă finală - fetch-ul
   real de mai jos rulează întotdeauna, indiferent de cache.
========================================================= */
const HOMEPAGE_FEATURE_CACHE_TTL_MS = 15 * 60 * 1000;

function readHomepageFeatureCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.t || !parsed?.item) return null;
    if (Date.now() - parsed.t > HOMEPAGE_FEATURE_CACHE_TTL_MS) return null;
    return parsed.item;
  } catch {
    return null;
  }
}

function writeHomepageFeatureCache(key, item) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), item }));
  } catch {
    // sessionStorage indisponibil - ignorăm.
  }
}

/*
 * Bootstrap prefetch: "Homepage" e cea mai probabilă primă rută a
 * unei sesiuni noi, deci pornim cele două fetch-uri cât mai devreme
 * posibil (idle time scurt după ce acest chunk s-a evaluat), înainte
 * ca HeroSection să apuce să se monteze. Reutilizează serviciul
 * central (max 3 prefetch-uri concurente, dedup, gating pe
 * saveData/2g) - mode "auto", nu blochează nimic altceva.
 */
function bootstrapPrefetchHomepageFeatures() {
  const run = () => {
    prefetchData(
      "homepage:product-of-day",
      () =>
        fetch("/api/public/homepage/product-of-the-day", {
          headers: { Accept: "application/json" },
        }).then((r) => (r.ok ? r.json() : null)),
      { mode: "auto", url: "/api/public/homepage/product-of-the-day" }
    );

    prefetchData(
      "homepage:artisan-of-week",
      () =>
        fetch("/api/public/homepage/artisan-of-the-week", {
          headers: { Accept: "application/json" },
        }).then((r) => (r.ok ? r.json() : null)),
      { mode: "auto", url: "/api/public/homepage/artisan-of-the-week" }
    );
  };

  if (typeof window === "undefined") return;

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 500 });
  } else {
    window.setTimeout(run, 50);
  }
}

bootstrapPrefetchHomepageFeatures();

/* =========================================================
   UTILITARE
========================================================= */

function withVersion(
  url,
  version
) {
  if (!url) {
    return null;
  }

  const separator =
    url.includes("?")
      ? "&"
      : "?";

  return `${url}${separator}v=${encodeURIComponent(
    String(
      version ||
        "1"
    )
  )}`;
}

function formatMoney(
  value,
  currency = "RON"
) {
  const numericValue =
    Number(value);

  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return null;
  }

  return new Intl.NumberFormat(
    "ro-RO",
    {
      style:
        "currency",

      currency,

      maximumFractionDigits:
        2,
    }
  ).format(
    numericValue
  );
}

function normalizeImageList(
  images,
  version
) {
  if (
    !Array.isArray(
      images
    )
  ) {
    return [];
  }

  return images
    .filter(Boolean)
    .map(
      (url) =>
        withVersion(
          url,
          version
        )
    );
}

function resolvePrimaryImage(
  item
) {
  const rawImage =
    item?.image?.desktop ||
    item?.image?.mobile ||
    item?.imageUrl ||
    item?.coverUrl ||
    item?.logoUrl ||
    item?.images?.[0] ||
    item?.image ||
    null;

  return withVersion(
    rawImage,

    item?.updatedAt ||
      item?.imageUpdatedAt ||
      item?.id ||
      "1"
  );
}

function getProductUrl(
  product
) {
  return (
    product?.ctaUrl ||
    product?.url ||
    product?.productUrl ||
    (
      product?.id
        ? `/produs/${encodeURIComponent(
            product.id
          )}`
        : "/produse"
    )
  );
}

function getStoreUrl(
  service
) {
  const slug =
    service?.profile
      ?.slug ||
    service?.profileSlug ||
    service?.slug;

  if (slug) {
    return `${STORE_PAGE_PREFIX}/${encodeURIComponent(
      slug
    )}`;
  }

  return "/magazine";
}

function normalizeProductPayload(
  payload,
  fallback
) {
  const raw =
    payload?.product;

  if (!raw) {
    return fallback;
  }

  const service =
    raw.service ||
    {};

  const profile =
    service.profile ||
    {};

  const vendor =
    service.vendor ||
    {};

  const images =
    normalizeImageList(
      raw.images,

      raw.updatedAt ||
        raw.id
    );

  return {
    ...fallback,
    ...raw,

    images:
      images.length > 0
        ? images
        : (
            fallback.images ||
            [
              fallback.image,
            ]
          ),

    image:
      images[0] ||
      resolvePrimaryImage(
        raw
      ) ||
      fallback.image,

    ctaUrl:
      getProductUrl(
        raw
      ),

    storeName:
      profile.displayName ||
      service.title ||
      vendor.displayName ||
      fallback.storeName,

    subtitle:
      profile.tagline ||
      profile.shortDescription ||
      service.title ||
      fallback.subtitle,

    city:
      profile.city ||
      service.city ||
      vendor.city ||
      fallback.city,

    personalizable:
      raw.acceptsCustom ===
        true ||
      raw.orderMode ===
        "OPTIONS" ||
      raw.orderMode ===
        "QUOTE_ONLY",

    quoteOnly:
      raw.orderMode ===
      "QUOTE_ONLY",

    feature:
      payload?.feature ||
      null,
  };
}

function normalizeArtisanPayload(
  payload,
  fallback
) {
  const service =
    payload?.artisan;

  if (!service) {
    return fallback;
  }

  const profile =
    service.profile ||
    {};

  const vendor =
    service.vendor ||
    {};

  const image =
    resolvePrimaryImage({
      ...profile,

      image:
        profile.coverUrl ||
        profile.logoUrl ||
        vendor.coverUrl ||
        vendor.logoUrl ||
        service.mediaUrls?.[0],

      updatedAt:
        profile.updatedAt ||
        service.updatedAt ||
        service.id,
    }) ||
    fallback.image;

  return {
    ...fallback,
    ...service,

    id:
      service.id,

    title:
      profile.displayName ||
      service.title ||
      vendor.displayName ||
      fallback.title,

    displayName:
      profile.displayName ||
      vendor.displayName ||
      service.title,

    category:
      profile.tagline ||
      service.title ||
      fallback.category,

    description:
      profile.about ||
      profile.shortDescription ||
      service.description ||
      vendor.about ||
      fallback.description,

    city:
      profile.city ||
      service.city ||
      vendor.city ||
      fallback.city,

    profileSlug:
      profile.slug ||
      null,

    image,

    coverUrl:
      profile.coverUrl ||
      vendor.coverUrl ||
      service.mediaUrls?.[0] ||
      null,

    logoUrl:
      profile.logoUrl ||
      vendor.logoUrl ||
      null,

    ctaUrl:
      getStoreUrl(
        service
      ),

    productsCount:
      service?._count
        ?.products ||
      service?.products
        ?.length ||
      null,

    feature:
      payload?.feature ||
      null,
  };
}

/* =========================================================
   API FEATURE
========================================================= */

function useHomepageFeature({
  endpoint,
  fallback,
  normalize,
  cacheKey,
}) {
  /*
   * Dacă avem deja ceva din prefetch-ul de bootstrap (smartPrefetch,
   * declanșat la evaluarea acestui modul) sau din sessionStorage
   * (revenire/refresh, cache de max 15 min), îl folosim ca stare
   * INIȚIALĂ - nu mai pornim cu null și nu mai arătăm skeleton pentru
   * el. NU e sursă finală - fetch-ul real de mai jos rulează oricum,
   * necondiționat, și rămâne singura sursă de adevăr pentru preț/
   * discount/stoc/campanie.
   */
  const seedRef = useRef(undefined);
  if (seedRef.current === undefined) {
    const prefetchedRaw = cacheKey ? getPrefetchedData(cacheKey) : null;
    const cachedItem = cacheKey ? readHomepageFeatureCache(cacheKey) : null;

    seedRef.current = prefetchedRaw
      ? normalize(prefetchedRaw, fallback)
      : cachedItem || null;
  }

  const [
    item,
    setItem,
  ] = useState(
    seedRef.current
  );

  const [
    loading,
    setLoading,
  ] = useState(
    !seedRef.current
  );

  const [
    error,
    setError,
  ] = useState(
    null
  );

  // true dacă am afișat deja ceva (din prefetch/cache sau dintr-un
  // fetch anterior reușit) - folosit ca să NU coborâm la fallback
  // generic pe o eroare de revalidare când avem deja ceva real vizibil.
  const hasShownRealDataRef = useRef(
    !!seedRef.current
  );

  useEffect(() => {
    let mounted =
      true;

    const controller =
      new AbortController();

    const timeoutId =
      window.setTimeout(
        () => {
          controller.abort();
        },
        7000
      );

    const timingLabel =
      cacheKey === "homepage:product-of-day"
        ? "product"
        : cacheKey === "homepage:artisan-of-week"
        ? "artisan"
        : null;

    async function load() {
      try {
        if (!hasShownRealDataRef.current) {
          setLoading(
            true
          );
        }

        setError(
          null
        );

        if (timingLabel) {
          markHpTiming(`homepage:${timingLabel}-fetch-start`);
        }

        const response =
          await fetch(
            endpoint,
            {
              signal:
                controller.signal,

              headers: {
                Accept:
                  "application/json",
              },

              /*
               * Fetch-ul real rulează întotdeauna, indiferent de
               * cache - preț/discount/stoc/campanie nu vin niciodată
               * doar din cache. Backend-ul nu are cache-control
               * propriu (verificat direct - niciun header de cache),
               * deci `no-store` aici e corect: browserul n-ar avea
               * de unde să știe cât e valid oricum.
               */
              cache:
                "no-store",
            }
          );

        if (timingLabel) {
          markHpTiming(`homepage:${timingLabel}-fetch-end`);
        }

        if (
          !response.ok
        ) {
          throw new Error(
            `${endpoint}: HTTP ${response.status}`
          );
        }

        const payload =
          await response
            .json()
            .catch(
              () => ({})
            );

        if (!mounted) {
          return;
        }

        const normalized =
          normalize(
            payload,
            fallback
          );

        setItem(
          normalized
        );

        hasShownRealDataRef.current = true;

        if (cacheKey) {
          writeHomepageFeatureCache(cacheKey, normalized);
        }
      } catch (loadError) {
        if (!mounted) {
          return;
        }

        if (
          loadError?.name !==
          "AbortError"
        ) {
          console.warn(
            `[homepage-feature:${endpoint}]`,
            loadError
          );
        }

        setError(
          loadError
        );

        /*
         * Dacă avem deja date reale vizibile (din prefetch/cache sau
         * dintr-un fetch anterior reușit), o eroare de revalidare NU
         * le înlocuiește cu fallback-ul generic - le păstrăm. Folosim
         * fallback-ul doar când chiar nu avem nimic real de arătat.
         */
        if (!hasShownRealDataRef.current) {
          setItem(
            fallback
          );
        }
      } finally {
        if (mounted) {
          setLoading(
            false
          );
        }

        window.clearTimeout(
          timeoutId
        );
      }
    }

    load();

    return () => {
      mounted =
        false;

      controller.abort();

      window.clearTimeout(
        timeoutId
      );
    };
  }, [
    endpoint,
    fallback,
    normalize,
    cacheKey,
  ]);

  return {
    item,
    loading,
    error,
  };
}

/* =========================================================
   GALERIE PRODUS
========================================================= */

function SpotlightProductGallery({
  product,
  title,
  productUrl,
  onClick,
}) {
  const images =
    useMemo(
      () => {
        const list =
          Array.isArray(
            product?.images
          )
            ? product.images.filter(
                Boolean
              )
            : [];

        if (
          list.length > 0
        ) {
          return list;
        }

        return [
          resolvePrimaryImage(
            product
          ) ||
            imageMain,
        ];
      },
      [
        product,
      ]
    );

  const [
    activeIndex,
    setActiveIndex,
  ] = useState(
    0
  );

  const mainImageMarkedRef = useRef(false);
  const handleMainImageLoad = () => {
    if (mainImageMarkedRef.current) return;
    mainImageMarkedRef.current = true;
    markHpTiming("homepage:main-image-loaded");
  };

  const touchStartX =
    useRef(
      null
    );

  useEffect(() => {
    setActiveIndex(
      0
    );
  }, [
    product?.id,
  ]);

  const goPrevious =
    useCallback(
      (event) => {
        event?.preventDefault();
        event?.stopPropagation();

        setActiveIndex(
          (current) =>
            current === 0
              ? images.length -
                1
              : current -
                1
        );
      },
      [
        images.length,
      ]
    );

  const goNext =
    useCallback(
      (event) => {
        event?.preventDefault();
        event?.stopPropagation();

        setActiveIndex(
          (current) =>
            current ===
            images.length - 1
              ? 0
              : current +
                1
        );
      },
      [
        images.length,
      ]
    );

  const handleTouchStart =
    (event) => {
      touchStartX.current =
        event.touches?.[0]
          ?.clientX ??
        null;
    };

  const handleTouchEnd =
    (event) => {
      if (
        touchStartX.current ===
          null ||
        images.length <= 1
      ) {
        touchStartX.current =
          null;

        return;
      }

      const endX =
        event.changedTouches?.[0]
          ?.clientX;

      if (
        !Number.isFinite(
          endX
        )
      ) {
        touchStartX.current =
          null;

        return;
      }

      const delta =
        endX -
        touchStartX.current;

      if (
        Math.abs(
          delta
        ) >= 45
      ) {
        if (
          delta > 0
        ) {
          goPrevious();
        } else {
          goNext();
        }
      }

      touchStartX.current =
        null;
    };

  return (
    <div
      className={
        styles.spotlightMedia
      }
      onTouchStart={
        handleTouchStart
      }
      onTouchEnd={
        handleTouchEnd
      }
    >
      <Link
        to={
          productUrl
        }
        className={
          styles.spotlightImageLink
        }
        onClick={
          onClick
        }
      >
        <img
          src={
            images[
              activeIndex
            ]
          }
          alt={
            title
          }
          className={
            styles.spotlightImage
          }
          onLoad={handleMainImageLoad}
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
      </Link>

      {images.length > 1 && (
        <>
          <button
            type="button"
            className={
              styles.spotlightArrowLeft
            }
            onClick={
              goPrevious
            }
            aria-label="Imaginea precedentă"
          >
            <FaArrowLeft
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            className={
              styles.spotlightArrowRight
            }
            onClick={
              goNext
            }
            aria-label="Imaginea următoare"
          >
            <FaArrowRight
              aria-hidden="true"
            />
          </button>

          <div
            className={
              styles.spotlightDots
            }
          >
            {images.map(
              (
                _,
                index
              ) => (
                <button
                  key={
                    index
                  }
                  type="button"
                  className={
                    index ===
                    activeIndex
                      ? `${styles.spotlightDot} ${styles.spotlightDotActive}`
                      : styles.spotlightDot
                  }
                  onClick={() =>
                    setActiveIndex(
                      index
                    )
                  }
                  aria-label={`Imaginea ${
                    index + 1
                  }`}
                />
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   SKELETON
========================================================= */

function FeaturedPicksSkeleton({ compact }) {
  return (
    <section
      className={`${styles.picksSection} ${compact ? styles.compact : ""}`}
      aria-label="Se încarcă selecțiile Artfest"
      aria-busy="true"
    >
      <div className={styles.picksInner}>
        <div className={styles.picksHeader}>
          <div className={styles.skeletonHeading} />
        </div>

        <div className={styles.picksGrid}>
          {[0, 1].map((index) => (
            <div key={index} className={styles.pickSkeleton}>
              <div className={styles.pickSkeletonImage} />
              <div className={styles.pickSkeletonBody}>
                <div className={styles.pickSkeletonLineShort} />
                <div className={styles.pickSkeletonTitle} />
                <div className={styles.pickSkeletonLine} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   ALESE DE ARTFEST (Produsul zilei + Artizanul săptămânii)
========================================================= */

/*
 * Cele două campanii stau una lângă alta (desktop) / una sub alta
 * (mobil, homepage) sau într-un rând glisant (mobil, /produse) - FĂRĂ
 * rotire automată. Datele, prețurile și reducerile vin exact ca înainte
 * (aceleași endpointuri, aceleași calcule); aici e doar prezentarea.
 *
 * `compact` (pagina /produse): imagine mică în stânga, fără descriere
 * lungă și fără galerie - cardurile nu împing în jos lista de produse.
 */

function ProductPickCard({ product, onAnalytics, placement, compact }) {
  const productUrl = getProductUrl(product);

  const productTitle =
    product?.title || "Descoperă produsul zilei";

  const productCurrency = product?.currency || "RON";

  const originalProductPrice = formatMoney(
    Number.isFinite(Number(product?.originalPriceCents))
      ? Number(product.originalPriceCents) / 100
      : Number.isFinite(Number(product?.priceCents))
        ? Number(product.priceCents) / 100
        : product?.price,
    productCurrency
  );

  const discountedProductPrice = formatMoney(
    Number.isFinite(Number(product?.discountedPriceCents))
      ? Number(product.discountedPriceCents) / 100
      : Number.isFinite(Number(product?.priceCents))
        ? Number(product.priceCents) / 100
        : product?.price,
    productCurrency
  );

  const productDiscount = product?.discount || product?.feature || {};

  const productDiscountPercent = Number(
    productDiscount?.totalDiscountPercent || 0
  );

  const productHasDiscount =
    product?.quoteOnly !== true &&
    productDiscount?.active === true &&
    productDiscount?.eligible !== false &&
    productDiscountPercent > 0 &&
    Number(product?.discountedPriceCents) <
      Number(product?.originalPriceCents ?? product?.priceCents);

  const description =
    product?.description ||
    product?.subtitle ||
    "O selecție Artfest aleasă pentru inspirație, cadouri și momente speciale.";

  const category =
    product?.storeName || product?.subtitle || "Selecția Artfest";

  const titleId = `pick-product-title-${compact ? "compact" : "full"}`;

  const handleClick = () => {
    onAnalytics?.("product_of_day_click", {
      id: product?.id,
      title: productTitle,
      placement,
    });
  };

  const badge = (
    <span className={styles.pickBadge}>
      <FaStar aria-hidden="true" />
      Produsul zilei
    </span>
  );

  return (
    <article className={styles.pickCard} aria-labelledby={titleId}>
      <div className={styles.pickVisual}>
        {compact ? (
          <div className={styles.spotlightMedia}>
            <Link
              to={productUrl}
              className={styles.spotlightImageLink}
              onClick={handleClick}
              tabIndex={-1}
              aria-hidden="true"
            >
              <img
                src={resolvePrimaryImage(product) || imageMain}
                alt=""
                className={styles.spotlightImage}
                loading="lazy"
                decoding="async"
              />
            </Link>
          </div>
        ) : (
          <SpotlightProductGallery
            product={product}
            title={productTitle}
            productUrl={productUrl}
            onClick={handleClick}
          />
        )}

        {!compact && badge}
      </div>

      <div className={styles.pickBody}>
        {compact ? badge : <span className={styles.pickKicker}>{category}</span>}

        <h3 id={titleId} className={styles.pickTitle}>
          <Link to={productUrl} onClick={handleClick}>
            {productTitle}
          </Link>
        </h3>

        {compact ? (
          <span className={styles.pickKicker}>{category}</span>
        ) : (
          <>
            <p className={styles.pickDescription}>{description}</p>

            <div className={styles.pickMeta}>
              {product?.personalizable && (
                <span>
                  <FaCheckCircle aria-hidden="true" />
                  Personalizabil
                </span>
              )}

              <span>
                <FaCheckCircle aria-hidden="true" />
                Creator verificat
              </span>

              {product?.city && (
                <span>
                  <FaMapMarkerAlt aria-hidden="true" />
                  {product.city}
                </span>
              )}
            </div>
          </>
        )}

        <div className={styles.pickFooter}>
          <div className={styles.pickOffer}>
            {product?.quoteOnly ? (
              <strong className={styles.pickPrice}>
                {getQuoteCardPriceLabel({
                  ...product,
                  orderMode: "QUOTE_ONLY",
                }) || "Preț la cerere"}
              </strong>
            ) : productHasDiscount ? (
              <div className={styles.pickPriceGroup}>
                <strong className={styles.pickDiscountedPrice}>
                  {discountedProductPrice}
                </strong>

                <span className={styles.pickOldPrice}>
                  {originalProductPrice}
                </span>

                <span className={styles.pickDiscountBadge}>
                  -{productDiscountPercent}%
                </span>
              </div>
            ) : (
              originalProductPrice && (
                <strong className={styles.pickPrice}>
                  {originalProductPrice}
                </strong>
              )
            )}
          </div>

          <Link
            to={productUrl}
            className={styles.pickCta}
            onClick={handleClick}
          >
            Vezi produsul
            <FaArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function ArtisanPickCard({ artisan, onAnalytics, placement, compact }) {
  const artisanUrl =
    artisan?.ctaUrl ||
    (artisan?.profileSlug
      ? `${STORE_PAGE_PREFIX}/${encodeURIComponent(artisan.profileSlug)}`
      : "/magazine");

  const artisanTitle =
    artisan?.title ||
    artisan?.displayName ||
    "Artizan recomandat Artfest";

  const artisanDiscount = artisan?.discount || artisan?.feature || {};

  const artisanDiscountPercent = Number(
    artisanDiscount?.totalDiscountPercent || 0
  );

  const artisanHasDiscount =
    artisanDiscount?.active === true && artisanDiscountPercent > 0;

  const description =
    artisan?.description ||
    "Descoperă un atelier românesc și creații realizate cu grijă, în serii mici.";

  const category =
    artisan?.category || artisan?.subtitle || "Creator român";

  const titleId = `pick-artisan-title-${compact ? "compact" : "full"}`;

  const handleClick = () => {
    onAnalytics?.("featured_artisan_click", {
      id: artisan?.id,
      title: artisanTitle,
      placement,
    });
  };

  const badge = (
    <span className={styles.pickBadge}>
      <FaStore aria-hidden="true" />
      Artizanul săptămânii
    </span>
  );

  return (
    <article className={styles.pickCard} aria-labelledby={titleId}>
      <div className={styles.pickVisual}>
        <div className={styles.spotlightMedia}>
          <Link
            to={artisanUrl}
            className={styles.spotlightImageLink}
            onClick={handleClick}
            tabIndex={-1}
            aria-hidden="true"
          >
            <img
              src={resolvePrimaryImage(artisan) || imageMain}
              alt=""
              className={styles.spotlightImage}
              loading="lazy"
              decoding="async"
            />
          </Link>
        </div>

        {!compact && badge}
      </div>

      <div className={styles.pickBody}>
        {compact ? badge : <span className={styles.pickKicker}>{category}</span>}

        <h3 id={titleId} className={styles.pickTitle}>
          <Link to={artisanUrl} onClick={handleClick}>
            {artisanTitle}
          </Link>
        </h3>

        {compact ? (
          <span className={styles.pickKicker}>{category}</span>
        ) : (
          <>
            <p className={styles.pickDescription}>{description}</p>

            <div className={styles.pickMeta}>
              {artisan?.city && (
                <span>
                  <FaMapMarkerAlt aria-hidden="true" />
                  {artisan.city}
                </span>
              )}

              <span>
                <FaCheckCircle aria-hidden="true" />
                Magazin verificat
              </span>

              {artisan?.productsCount && (
                <span>
                  <FaStore aria-hidden="true" />
                  {artisan.productsCount} produse
                </span>
              )}
            </div>
          </>
        )}

        <div className={styles.pickFooter}>
          <div className={styles.pickOffer}>
            {artisanHasDiscount && (
              <div className={styles.pickArtisanDiscount}>
                <strong>-{artisanDiscountPercent}% săptămâna aceasta</strong>
                {!compact && <span>la produsele eligibile ale magazinului</span>}
              </div>
            )}
          </div>

          <Link
            to={artisanUrl}
            className={styles.pickCta}
            onClick={handleClick}
          >
            Vizitează atelierul
            <FaArrowRight aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

function FeaturedPicks({ product, artisan, onAnalytics, placement, compact }) {
  if (!product && !artisan) return null;

  const single = !product || !artisan;
  const headingId = compact ? "picks-heading-compact" : "picks-heading";

  return (
    <section
      className={`${styles.picksSection} ${compact ? styles.compact : ""}`}
      aria-labelledby={headingId}
    >
      <div className={styles.picksInner}>
        <div className={styles.picksHeader}>
          <span className={styles.sectionEyebrow}>Selecția Artfest</span>
          <h2 id={headingId} className={styles.picksTitle}>
            Alese de echipa Artfest
          </h2>
          {!compact && (
            <p className={styles.picksLead}>
              În fiecare zi un produs, în fiecare săptămână un atelier pe care
              merită să-l cunoști.
            </p>
          )}
        </div>

        <div
          className={`${styles.picksGrid} ${single ? styles.picksGridSingle : ""}`}
        >
          {product && (
            <ProductPickCard
              product={product}
              onAnalytics={onAnalytics}
              placement={placement}
              compact={compact}
            />
          )}

          {artisan && (
            <ArtisanPickCard
              artisan={artisan}
              onAnalytics={onAnalytics}
              placement={placement}
              compact={compact}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   SECȚIUNEA CU DATE (homepage + /produse)
========================================================= */

/**
 * Produsul zilei + Artizanul săptămânii, cu datele lor (aceleași
 * endpointuri, cache și prefetch pentru homepage și /produse).
 *
 * @param {{ compact?: boolean, placement?: string }} props
 *   compact   - varianta scurtă pentru /produse
 *   placement - eticheta din evenimentele GA4 (product_of_day_click /
 *               featured_artisan_click)
 */
export default function FeaturedPicksSection({
  compact = false,
  placement = "homepage_featured_spotlight",
}) {
  const log = useCallback((eventName, eventData = {}) => {
    // prin analytics.js: doar cu acord pentru statistici, doar către GA4
    trackEvent(eventName, eventData);
  }, []);

  const productFallback =
    useMemo(
      () => ({
        id:
          "fallback-product-day",
        title:
          "Descoperă selecția handmade Artfest",
        storeName:
          "Creatori români",
        description:
          "Produse originale și personalizabile pentru evenimente și momente memorabile.",
        image:
          imageMain,
        images: [
          imageMain,
        ],
        ctaUrl:
          "/produse",
        personalizable:
          true,
      }),
      []
    );

  const artisanFallback =
    useMemo(
      () => ({
        id:
          "fallback-artisan-week",
        title:
          "Descoperă creatorii Artfest",
        category:
          "Atelier românesc",
        description:
          "Cunoaște oamenii din spatele produselor handmade și descoperă creații realizate cu grijă.",
        image:
          imageMain,
        ctaUrl:
          "/magazine",
      }),
      []
    );

  const {
    item:
      productOfTheDay,
  } = useHomepageFeature({
    endpoint:
      "/api/public/homepage/product-of-the-day",
    fallback:
      productFallback,
    normalize:
      normalizeProductPayload,
    cacheKey:
      "homepage:product-of-day",
  });

  const {
    item:
      featuredArtisan,
  } = useHomepageFeature({
    endpoint:
      "/api/public/homepage/artisan-of-the-week",
    fallback:
      artisanFallback,
    normalize:
      normalizeArtisanPayload,
    cacheKey:
      "homepage:artisan-of-week",
  });

  /*
   * Skeleton complet DOAR dacă niciunul din cele două nu e încă gata -
   * dacă unul e disponibil (din prefetch, cache, sau fetch real),
   * randăm cardurile imediat cu ce avem; celălalt se adaugă când
   * vine, fără să mai blocheze primul.
   */
  const homepageFeatureLoading =
    !productOfTheDay &&
    !featuredArtisan;

  const firstPaintMarkedRef = useRef(false);
  const bothReadyMarkedRef = useRef(false);

  useEffect(() => {
    if (
      (productOfTheDay || featuredArtisan) &&
      !firstPaintMarkedRef.current
    ) {
      firstPaintMarkedRef.current = true;
      markHpTiming("homepage:first-spotlight-paint");
      logHpTimingSummary();
    }

    if (
      productOfTheDay &&
      featuredArtisan &&
      !bothReadyMarkedRef.current
    ) {
      bothReadyMarkedRef.current = true;
      markHpTiming("homepage:both-features-ready");
      logHpTimingSummary();
    }
  }, [productOfTheDay, featuredArtisan]);

  if (homepageFeatureLoading) {
    return <FeaturedPicksSkeleton compact={compact} />;
  }

  return (
    <FeaturedPicks
      product={productOfTheDay}
      artisan={featuredArtisan}
      onAnalytics={log}
      placement={placement}
      compact={compact}
    />
  );
}
