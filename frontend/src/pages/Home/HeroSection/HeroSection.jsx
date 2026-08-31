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

import styles from "./HeroSection.module.css";

import imageMain from "../../../assets/heroSectionImage.jpg";

import NewsletterModal from "../NewsletterModal/NewsletterModal.jsx";
import { prefetchData, getPrefetchedData } from "../../../lib/smartPrefetch.js";

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
 * Instrumentare minimă de timing, doar în dev, doar în consolă.
 */
const HP_TIMING_ENABLED =
  typeof window !== "undefined" &&
  typeof performance !== "undefined" &&
  Boolean(import.meta.env?.DEV);

function markHpTiming(name) {
  if (!HP_TIMING_ENABLED) return;
  try {
    performance.mark(name);
  } catch {
    // ignore
  }
}

function logHpTimingSummary() {
  if (!HP_TIMING_ENABLED) return;
  try {
    const names = [
      "homepage:mount",
      "homepage:product-fetch-start",
      "homepage:product-fetch-end",
      "homepage:artisan-fetch-start",
      "homepage:artisan-fetch-end",
      "homepage:first-spotlight-paint",
      "homepage:main-image-loaded",
      "homepage:both-features-ready",
    ];
    const entries = names
      .map((name) => performance.getEntriesByName(name, "mark")[0])
      .filter(Boolean);
    if (entries.length < 2) return;
    const t0 = entries[0].startTime;
    console.info(
      "[Homepage] timing (ms de la primul reper):",
      entries
        .map(
          (e) =>
            `${e.name.replace("homepage:", "")}: ${(e.startTime - t0).toFixed(0)}ms`
        )
        .join("  →  ")
    );
  } catch {
    // ignore
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
   INTRO
========================================================= */

function MarketplaceIntro() {
  return (
    <header
      className={
        styles.marketplaceIntro
      }
    >
      <div
        className={
          styles.marketplaceIntroInner
        }
      >
        <div
          className={
            styles.marketplaceIdentity
          }
        >
          <span
            className={
              styles.marketplaceIcon
            }
          >
            <FaStore
              aria-hidden="true"
            />
          </span>

          <div>
            <h1>
              Marketplace pentru
              evenimente & handmade
            </h1>

            <p>
              Produse și creatori
              selectați de Artfest.
            </p>
          </div>
        </div>

        <Link
          to="/produse"
          className={
            styles.marketplaceExplore
          }
        >
          Explorează marketplace-ul

          <FaArrowRight
            aria-hidden="true"
          />
        </Link>
      </div>
    </header>
  );
}

/* =========================================================
   SKELETON
========================================================= */

function FeaturedSpotlightSkeleton() {
  return (
    <section
      className={
        styles.spotlightSection
      }
      aria-label="Se încarcă selecțiile Artfest"
      aria-busy="true"
    >
      <div
        className={
          styles.spotlightSkeleton
        }
      >
        <div
          className={
            styles.spotlightSkeletonImage
          }
        />

        <div
          className={
            styles.spotlightSkeletonContent
          }
        >
          <div
            className={
              styles.spotlightSkeletonTabs
            }
          />

          <div
            className={
              styles.spotlightSkeletonSmall
            }
          />

          <div
            className={
              styles.spotlightSkeletonTitle
            }
          />

          <div
            className={
              styles.spotlightSkeletonLine
            }
          />

          <div
            className={
              styles.spotlightSkeletonLineShort
            }
          />
        </div>
      </div>
    </section>
  );
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
   FEATURED SPOTLIGHT
========================================================= */

function FeaturedSpotlight({
  product,
  artisan,
  onAnalytics,
}) {
  /*
   * Produsul zilei e tabul inițial preferat - dar dacă la montare
   * doar Artizanul e gata (cazul rar în care product-of-the-day
   * întârzie), pornim direct pe "artisan" ca să nu arătăm un tab gol.
   */
  const [
    activeTab,
    setActiveTab,
  ] = useState(
    () => (product ? "product" : "artisan")
  );

  const bothReady = Boolean(product) && Boolean(artisan);
  const rotationStartedRef = useRef(false);

  /*
   * Dacă am pornit pe "artisan" (product încă nu era gata) și
   * între timp product-ul a sosit, iar rotația nu a apucat încă să
   * pornească, comutăm pe "product" - rămâne tabul inițial real, nu
   * doar cel disponibil primul.
   */
  useEffect(() => {
    if (
      product &&
      activeTab === "artisan" &&
      !rotationStartedRef.current
    ) {
      setActiveTab("product");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product]);

  /*
   * Rotația Produs <-> Artizan pornește DOAR când ambele sunt
   * disponibile - nu rotim niciodată pe un tab gol/fallback lipsă.
   * Dacă unul dintre ele nu ajunge vreodată (eroare reală), rămânem
   * pe cel disponibil.
   */
  useEffect(() => {
    if (!bothReady) {
      return undefined;
    }

    rotationStartedRef.current = true;

    const intervalId =
      window.setInterval(
        () => {
          setActiveTab(
            (current) =>
              current ===
              "product"
                ? "artisan"
                : "product"
          );
        },
        2000
      );

    return () => {
      window.clearInterval(
        intervalId
      );
    };
  }, [bothReady]);

  const isProduct =
    activeTab ===
    "product";

  const productUrl =
    getProductUrl(
      product
    );

  const artisanUrl =
    artisan?.ctaUrl ||
    (
      artisan?.profileSlug
        ? `${STORE_PAGE_PREFIX}/${encodeURIComponent(
            artisan.profileSlug
          )}`
        : "/magazine"
    );

  const productTitle =
    product?.title ||
    "Descoperă produsul zilei";

  const artisanTitle =
    artisan?.title ||
    artisan?.displayName ||
    "Artizan recomandat Artfest";

 const productCurrency =
  product?.currency ||
  "RON";

const originalProductPrice =
  formatMoney(
    Number.isFinite(
      Number(
        product?.originalPriceCents
      )
    )
      ? Number(
          product.originalPriceCents
        ) / 100
      : Number.isFinite(
          Number(
            product?.priceCents
          )
        )
        ? Number(
            product.priceCents
          ) / 100
        : product?.price,

    productCurrency
  );

const discountedProductPrice =
  formatMoney(
    Number.isFinite(
      Number(
        product?.discountedPriceCents
      )
    )
      ? Number(
          product.discountedPriceCents
        ) / 100
      : Number.isFinite(
          Number(
            product?.priceCents
          )
        )
        ? Number(
            product.priceCents
          ) / 100
        : product?.price,

    productCurrency
  );

const productDiscount =
  product?.discount ||
  product?.feature ||
  {};

const productDiscountPercent =
  Number(
    productDiscount
      ?.totalDiscountPercent ||
      0
  );

const productHasDiscount =
  product?.quoteOnly !== true &&
  productDiscount?.active === true &&
  productDiscount?.eligible !== false &&
  productDiscountPercent > 0 &&
  Number(
    product?.discountedPriceCents
  ) <
    Number(
      product?.originalPriceCents ??
        product?.priceCents
    );

const artisanDiscount =
  artisan?.discount ||
  artisan?.feature ||
  {};

const artisanDiscountPercent =
  Number(
    artisanDiscount
      ?.totalDiscountPercent ||
      0
  );

const artisanHasDiscount =
  artisanDiscount?.active === true &&
  artisanDiscountPercent > 0;

  const activeTitle =
    isProduct
      ? productTitle
      : artisanTitle;

  const activeDescription =
    artisan?.description ||
    "Descoperă un atelier românesc și creații realizate cu grijă, în serii mici.";

  const activeEyebrow =
    isProduct
      ? "Produsul zilei"
      : "Artizanul săptămânii";

  const activeCategory =
    isProduct
      ? (
          product?.storeName ||
          product?.subtitle ||
          "Selecția Artfest"
        )
      : (
          artisan?.category ||
          artisan?.subtitle ||
          "Creator român"
        );

  const handlePrimaryClick =
    () => {
      onAnalytics?.(
        isProduct
          ? "product_of_day_click"
          : "featured_artisan_click",

        {
          id:
            isProduct
              ? product?.id
              : artisan?.id,

          title:
            activeTitle,

          placement:
            "homepage_featured_spotlight",
        }
      );
    };

  return (
    <section
      className={
        styles.spotlightSection
      }
      aria-labelledby="spotlight-title"
    >
      <article
        className={
          styles.spotlightCard
        }
      >
        {isProduct ? (
          <SpotlightProductGallery
            product={
              product
            }
            title={
              productTitle
            }
            productUrl={
              productUrl
            }
            onClick={
              handlePrimaryClick
            }
          />
        ) : (
          <div
            className={
              styles.spotlightMedia
            }
          >
            <Link
              to={
                artisanUrl
              }
              className={
                styles.spotlightImageLink
              }
              onClick={
                handlePrimaryClick
              }
            >
              <img
                src={
                  resolvePrimaryImage(
                    artisan
                  ) ||
                  imageMain
                }
                alt={
                  artisanTitle
                }
                className={
                  styles.spotlightImage
                }
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
            </Link>
          </div>
        )}

        <div
          className={
            styles.spotlightContent
          }
        >
          <div
            className={
              styles.spotlightTabs
            }
          >
            <button
              type="button"
              className={
                isProduct
                  ? `${styles.spotlightTab} ${styles.spotlightTabActive}`
                  : styles.spotlightTab
              }
              onClick={() =>
                setActiveTab(
                  "product"
                )
              }
            >
              Produsul zilei
            </button>

            <button
              type="button"
              className={
                !isProduct
                  ? `${styles.spotlightTab} ${styles.spotlightTabActive}`
                  : styles.spotlightTab
              }
              onClick={() =>
                setActiveTab(
                  "artisan"
                )
              }
            >
              Artizanul săptămânii
            </button>
          </div>

          <span
            className={
              styles.spotlightEyebrow
            }
          >
            {isProduct ? (
              <FaStar
                aria-hidden="true"
              />
            ) : (
              <FaStore
                aria-hidden="true"
              />
            )}

            {activeEyebrow}
          </span>

        <span
  className={
    styles.spotlightCategory
  }
>
  {activeCategory}
</span>

{isProduct &&
  productHasDiscount && (
    <span
      className={
        styles.spotlightDiscountBadge
      }
    >
      Reducere{" "}
      {
        productDiscountPercent
      }
      %
    </span>
  )}

{!isProduct &&
  artisanHasDiscount && (
    <span
      className={
        styles.spotlightDiscountBadge
      }
    >
      Reducere{" "}
      {
        artisanDiscountPercent
      }
      % la produsele magazinului
    </span>
  )}

          <h2
            id="spotlight-title"
            className={
              styles.spotlightTitle
            }
          >
            <Link
              to={
                isProduct
                  ? productUrl
                  : artisanUrl
              }
              onClick={
                handlePrimaryClick
              }
            >
              {activeTitle}
            </Link>
          </h2>

          {!isProduct && (
            <p
              className={
                styles.spotlightDescription
              }
            >
              {activeDescription}
            </p>
          )}

          <div
            className={
              styles.spotlightMeta
            }
          >
            {isProduct ? (
              <>
                {product?.personalizable && (
                  <span>
                    <FaCheckCircle
                      aria-hidden="true"
                    />

                    Personalizabil
                  </span>
                )}

                <span>
                  <FaCheckCircle
                    aria-hidden="true"
                  />

                  Creator verificat
                </span>

                {product?.city && (
                  <span>
                    <FaMapMarkerAlt
                      aria-hidden="true"
                    />

                    {product.city}
                  </span>
                )}
              </>
            ) : (
              <>
                {artisan?.city && (
                  <span>
                    <FaMapMarkerAlt
                      aria-hidden="true"
                    />

                    {artisan.city}
                  </span>
                )}

                <span>
                  <FaCheckCircle
                    aria-hidden="true"
                  />

                  Magazin verificat
                </span>

                {artisan?.productsCount && (
                  <span>
                    <FaStore
                      aria-hidden="true"
                    />

                    {
                      artisan.productsCount
                    }{" "}
                    produse
                  </span>
                )}
              </>
            )}
          </div>

          <div
            className={
              styles.spotlightFooter
            }
          >
            {isProduct && (
  product?.quoteOnly ? (
    <strong
      className={
        styles.spotlightPrice
      }
    >
      Preț la cerere
    </strong>
  ) : productHasDiscount ? (
    <div
      className={
        styles.spotlightPriceGroup
      }
    >
      <span
        className={
          styles.spotlightOldPrice
        }
      >
        {
          originalProductPrice
        }
      </span>

      <strong
        className={
          styles.spotlightDiscountedPrice
        }
      >
        {
          discountedProductPrice
        }
      </strong>

      <span
        className={
          styles.spotlightDiscountNote
        }
      >
        Reducere totală{" "}
        {
          productDiscountPercent
        }
        %
      </span>
    </div>
  ) : (
    originalProductPrice && (
      <strong
        className={
          styles.spotlightPrice
        }
      >
        {
          originalProductPrice
        }
      </strong>
    )
  )
)}

{!isProduct &&
  artisanHasDiscount && (
    <div
      className={
        styles.spotlightArtisanDiscount
      }
    >
      <strong>
        {
          artisanDiscountPercent
        }
        % reducere
      </strong>

      <span>
        la produsele eligibile ale
        acestui magazin
      </span>
    </div>
  )}

            <Link
              to={
                isProduct
                  ? productUrl
                  : artisanUrl
              }
              className={
                styles.spotlightCta
              }
              onClick={
                handlePrimaryClick
              }
            >
              {isProduct
                ? "Vezi produsul"
                : "Descoperă magazinul"}

              <FaArrowRight
                aria-hidden="true"
              />
            </Link>
          </div>
        </div>
      </article>
    </section>
  );
}

/* =========================================================
   PARTENER
========================================================= */

function PartnerBar({
  ambassador,
  onCopyAmbassadorLink,
  onAnalytics,
}) {
  return (
    <section
      className={
        styles.partnerBar
      }
      aria-label="Vinde pe Artfest"
    >
      <div
        className={
          styles.partnerBarInner
        }
      >
        <div
          className={
            styles.partnerCopy
          }
        >
          <span
            className={
              styles.partnerIcon
            }
            aria-hidden="true"
          >
            🎨
          </span>

          <div>
            <strong>
              Creezi produse handmade?
            </strong>

            <span>
              Deschide-ți magazinul și
              ajungi mai ușor la
              clienții potriviți.
            </span>
          </div>
        </div>

        <div
          className={
            styles.partnerActions
          }
        >
          {ambassador?.referralLink && (
            <button
              type="button"
              className={
                styles.ambassadorButton
              }
              onClick={
                onCopyAmbassadorLink
              }
            >
              Invită un creator
            </button>
          )}

          <Link
            to="/?auth=register&as=partner"
            className={
              styles.partnerCta
            }
            onClick={() =>
              onAnalytics?.(
                "partner_cta_click",
                {
                  placement:
                    "homepage_partner_bar",
                }
              )
            }
          >
            Devino partener

            <FaArrowRight
              aria-hidden="true"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* =========================================================
   COMPONENTA PRINCIPALĂ
========================================================= */

export default function HeroSection() {
  useEffect(() => {
    markHpTiming("homepage:mount");
  }, []);

  const [
    ambassador,
    setAmbassador,
  ] = useState(
    null
  );

  const log =
    useCallback(
      (
        eventName,
        eventData = {}
      ) => {
        window.gtag?.(
          "event",
          eventName,
          eventData
        );
      },
      []
    );

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
   * randăm spotlight-ul imediat cu ce avem; celălalt se adaugă când
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

  useEffect(() => {
    fetch(
      "/api/ambassadors/me",
      {
        credentials:
          "include",
      }
    )
      .then(
        (response) =>
          response.ok
            ? response.json()
            : null
      )
      .then(
        setAmbassador
      )
      .catch(
        () => {
          setAmbassador(
            null
          );
        }
      );
  }, []);

  const copyAmbassadorLink =
    useCallback(
      async () => {
        if (
          !ambassador?.referralLink
        ) {
          return;
        }

        const message = `Fac parte din Artfest, comunitatea creatorilor români. ❤️
Hai să ajungem împreună la 1000 de creatori!
Înscrie-te aici: ${ambassador.referralLink}`;

        try {
          await navigator.clipboard.writeText(
            message
          );

          log(
            "ambassador_link_copy"
          );

          window.alert(
            "Textul și linkul au fost copiate."
          );
        } catch {
          window.prompt(
            "Copiază mesajul:",
            message
          );
        }
      },
      [
        ambassador,
        log,
      ]
    );

  return (
    <>
      <NewsletterModal />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html:
            JSON.stringify({
              "@context":
                "https://schema.org",

              "@type":
                "WebSite",

              url:
                "https://www.artfest.ro/",

              publisher: {
                "@type":
                  "Organization",

                name:
                  "Artfest",

                url:
                  "https://www.artfest.ro/",
              },
            }),
        }}
      />

      <MarketplaceIntro />

      {homepageFeatureLoading ? (
        <FeaturedSpotlightSkeleton />
      ) : (
        <FeaturedSpotlight
          product={
            productOfTheDay
          }
          artisan={
            featuredArtisan
          }
          onAnalytics={
            log
          }
        />
      )}

      <PartnerBar
        ambassador={
          ambassador
        }
        onCopyAmbassadorLink={
          copyAmbassadorLink
        }
        onAnalytics={
          log
        }
      />
    </>
  );
}