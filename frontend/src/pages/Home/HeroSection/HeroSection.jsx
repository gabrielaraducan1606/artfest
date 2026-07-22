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

const STORE_PAGE_PREFIX =
  "/magazin";

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
}) {
  /*
   * Pornim cu null, nu cu fallback.
   *
   * Astfel nu mai apare întâi reclama
   * generică și apoi produsul real.
   */
  const [
    item,
    setItem,
  ] = useState(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(
    true
  );

  const [
    error,
    setError,
  ] = useState(
    null
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

    async function load() {
      try {
        setLoading(
          true
        );

        setError(
          null
        );

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
               * Nu folosim cache-ul browserului,
               * deoarece backendul are deja
               * propriul cache.
               */
              cache:
                "no-store",
            }
          );

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
         * Folosim fallback-ul doar dacă
         * backendul nu a răspuns.
         */
        setItem(
          fallback
        );
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
  const [
    activeTab,
    setActiveTab,
  ] = useState(
    "product"
  );

  useEffect(() => {
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
  }, []);

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

  const productPrice =
    product?.formattedPrice ||
    formatMoney(
      Number.isFinite(
        Number(
          product?.priceCents
        )
      )
        ? Number(
            product.priceCents
          ) / 100
        : product?.price,

      product?.currency ||
        "RON"
    );

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
              ) : (
                productPrice && (
                  <strong
                    className={
                      styles.spotlightPrice
                    }
                  >
                    {productPrice}
                  </strong>
                )
              )
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

    loading:
      productLoading,
  } = useHomepageFeature({
    endpoint:
      "/api/public/homepage/product-of-the-day",

    fallback:
      productFallback,

    normalize:
      normalizeProductPayload,
  });

  const {
    item:
      featuredArtisan,

    loading:
      artisanLoading,
  } = useHomepageFeature({
    endpoint:
      "/api/public/homepage/artisan-of-the-week",

    fallback:
      artisanFallback,

    normalize:
      normalizeArtisanPayload,
  });

  const homepageFeatureLoading =
    productLoading ||
    artisanLoading ||
    !productOfTheDay ||
    !featuredArtisan;

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
                "https://artfest.ro/",

              publisher: {
                "@type":
                  "Organization",

                name:
                  "Artfest",

                url:
                  "https://artfest.ro/",
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