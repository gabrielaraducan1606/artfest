import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Link, useNavigate } from "react-router-dom";

import {
  FaHeart,
  FaRegHeart,
  FaShoppingBag,
} from "react-icons/fa";

import styles from "./PopularProducts.module.css";
import { api } from "../../../lib/api";

const PAGE_SIZE = 8;
const RECENT_DAYS = 7;

/* =========================================================
   TIMESTAMP
========================================================= */

function getTimestamp(p) {
  const ts =
    p?.vendorAddedAt ||
    p?.listedAt ||
    p?.publishedAt ||
    p?.createdAt ||
    p?.created_at ||
    p?.created ||
    p?.updatedAt ||
    null;

  const t = ts ? Date.parse(ts) : NaN;

  return Number.isFinite(t) ? t : 0;
}

function getRecentCutoff() {
  return (
    Date.now() -
    RECENT_DAYS *
      24 *
      60 *
      60 *
      1000
  );
}

/* =========================================================
   IMAGINE
========================================================= */

function getImageSrc(p) {
  const firstImage =
    Array.isArray(p?.images)
      ? p.images[0]
      : null;

  if (
    typeof firstImage === "string" &&
    firstImage.trim()
  ) {
    return firstImage;
  }

  if (firstImage?.url) {
    return firstImage.url;
  }

  return null;
}

/* =========================================================
   ELIMINĂ DUPLICATE
========================================================= */

function dedupeProducts(list) {
  const seen = new Set();

  return list.filter((item) => {
    const id = item?.id;

    if (!id || seen.has(id)) {
      return false;
    }

    seen.add(id);

    return true;
  });
}

/* =========================================================
   MAGAZIN
========================================================= */

function getStoreName(p) {
  return (
    p?.storeName ||
    p?.service?.profile?.displayName ||
    p?.service?.vendor?.displayName ||
    "Un magazin"
  );
}

function getStoreLogo(p) {
  return (
    p?.storeLogo ||
    p?.service?.profile?.logoUrl ||
    p?.service?.vendor?.logoUrl ||
    p?.vendorLogoUrl ||
    null
  );
}

function getStoreLink(p) {
  const slug =
    p?.storeSlug ||
    p?.service?.profile?.slug ||
    null;

  const vendorId =
    p?.service?.vendor?.id ||
    p?.service?.vendorId ||
    null;

  if (slug) {
    return `/magazin/${encodeURIComponent(slug)}`;
  }

  if (vendorId) {
    return `/magazin/${vendorId}`;
  }

  return "/magazine";
}

/* =========================================================
   NUMERE
========================================================= */

function hasNumericValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(Number(value))
  );
}

/* =========================================================
   PREȚURI + REDUCERI
========================================================= */

function getPricing(p) {
  const isQuoteOnly =
    String(p?.orderMode || "").toUpperCase() ===
    "QUOTE_ONLY";

  if (isQuoteOnly) {
    return {
      isQuoteOnly: true,
      price: null,
      originalPrice: null,
      discountPercent: 0,
      hasDiscount: false,
    };
  }

  let finalPriceCents = null;

  if (hasNumericValue(p?.finalPriceCents)) {
    finalPriceCents = Number(
      p.finalPriceCents
    );
  } else if (
    hasNumericValue(
      p?.discountedPriceCents
    )
  ) {
    finalPriceCents = Number(
      p.discountedPriceCents
    );
  } else if (
    hasNumericValue(p?.priceCents)
  ) {
    finalPriceCents = Number(
      p.priceCents
    );
  } else if (
    hasNumericValue(p?.price)
  ) {
    finalPriceCents = Math.round(
      Number(p.price) * 100
    );
  }

  let originalPriceCents = null;

  if (
    hasNumericValue(
      p?.originalPriceCents
    )
  ) {
    originalPriceCents = Number(
      p.originalPriceCents
    );
  } else if (
    hasNumericValue(
      p?.originalPrice
    )
  ) {
    originalPriceCents = Math.round(
      Number(p.originalPrice) * 100
    );
  }

  let discountPercent = 0;

  if (
    hasNumericValue(
      p?.totalDiscountPercent
    )
  ) {
    discountPercent = Number(
      p.totalDiscountPercent
    );
  } else if (
    hasNumericValue(
      p?.discountPercent
    )
  ) {
    discountPercent = Number(
      p.discountPercent
    );
  } else if (
    hasNumericValue(
      p?.discount
        ?.totalDiscountPercent
    )
  ) {
    discountPercent = Number(
      p.discount.totalDiscountPercent
    );
  }

  const hasDiscount =
    (
      p?.hasDiscount === true ||
      p?.hasActiveHomepageDiscount === true ||
      discountPercent > 0
    ) &&
    finalPriceCents !== null &&
    originalPriceCents !== null &&
    finalPriceCents <
      originalPriceCents;

  return {
    isQuoteOnly: false,

    price:
      finalPriceCents !== null
        ? finalPriceCents / 100
        : null,

    originalPrice:
      hasDiscount
        ? originalPriceCents / 100
        : null,

    discountPercent,
    hasDiscount,
  };
}

function formatMoney(
  value,
  currency = "RON"
) {
  if (!Number.isFinite(value)) {
    return "";
  }

  try {
    return new Intl.NumberFormat(
      "ro-RO",
      {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }
    ).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

/* =========================================================
   TIMP
========================================================= */

function timeAgo(p) {
  const ts = getTimestamp(p);

  if (!ts) {
    return "";
  }

  const diff =
    Date.now() - ts;

  if (diff < 0) {
    return "acum";
  }

  const minutes =
    Math.floor(
      diff / 60000
    );

  if (minutes < 1) {
    return "acum";
  }

  if (minutes < 60) {
    return `acum ${minutes} min`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return `acum ${hours} h`;
  }

  const days =
    Math.floor(
      hours / 24
    );

  if (days === 1) {
    return "ieri";
  }

  if (days <= 7) {
    return `acum ${days} zile`;
  }

  return "";
}

/* =========================================================
   BADGE DISPONIBILITATE
========================================================= */

function getAvailabilityLabel(p) {
  const availability =
    String(
      p?.availability || ""
    ).toUpperCase();

  const orderMode =
    String(
      p?.orderMode || ""
    ).toUpperCase();

  if (
    orderMode === "QUOTE_ONLY"
  ) {
    return "Cere ofertă";
  }

  if (
    orderMode === "OPTIONS"
  ) {
    return "Personalizabil";
  }

  if (
    availability ===
    "MADE_TO_ORDER"
  ) {
    return "La comandă";
  }

  if (
    availability === "PREORDER"
  ) {
    return "Precomandă";
  }

  if (
    availability === "READY"
  ) {
    return "Gata de livrare";
  }

  return null;
}

/* =========================================================
   COMPONENTĂ
========================================================= */

export default function PopularProducts() {
  const navigate = useNavigate();

  const [items, setItems] =
    useState([]);

  const [
    initialLoading,
    setInitialLoading,
  ] = useState(true);

  const [
    loadingMore,
    setLoadingMore,
  ] = useState(false);

  const [page, setPage] =
    useState(1);

  const [hasMore, setHasMore] =
    useState(true);

  const [
    brokenImages,
    setBrokenImages,
  ] = useState({});

  const [saved, setSaved] =
    useState({});

  const loadingRef =
    useRef(false);

  const didInitRef =
    useRef(false);

  const loadMoreRef =
    useRef(null);

  /* =======================================================
     LOAD
  ======================================================= */

  const fetchPage =
    useCallback(
      async (
        nextPage = 1
      ) => {
        if (
          loadingRef.current
        ) {
          return;
        }

        if (
          nextPage > 1 &&
          !hasMore
        ) {
          return;
        }

        loadingRef.current =
          true;

        if (nextPage === 1) {
          setInitialLoading(
            true
          );

          setBrokenImages(
            {}
          );

          setHasMore(
            true
          );
        } else {
          setLoadingMore(
            true
          );
        }

        try {
          const response =
            await api(
              `/api/public/products/feed?limit=${PAGE_SIZE}&page=${nextPage}`
            );

          const pageItems =
            Array.isArray(
              response?.items
            )
              ? response.items
              : [];

          const cutoff =
            getRecentCutoff();

          const sortedPage =
            [...pageItems].sort(
              (a, b) =>
                getTimestamp(b) -
                getTimestamp(a)
            );

          const recentPage =
            sortedPage.filter(
              (item) =>
                getTimestamp(item) >=
                cutoff
            );

          const reachedOlderProducts =
            sortedPage.some(
              (item) => {
                const timestamp =
                  getTimestamp(
                    item
                  );

                return (
                  timestamp > 0 &&
                  timestamp < cutoff
                );
              }
            );

          const backendHasMore =
            typeof response?.hasMore ===
            "boolean"
              ? response.hasMore
              : pageItems.length >=
                PAGE_SIZE;

          const canLoadMore =
            backendHasMore &&
            pageItems.length > 0 &&
            !reachedOlderProducts;

          setHasMore(
            canLoadMore
          );

          setSaved(
            (prev) => {
              const next = {
                ...prev,
              };

              for (
                const item of
                pageItems
              ) {
                if (!item?.id) {
                  continue;
                }

                next[item.id] =
                  !!item.viewerFavorited ||
                  !!prev[item.id];
              }

              return next;
            }
          );

          setItems(
            (prev) => {
              const merged =
                nextPage === 1
                  ? recentPage
                  : [
                      ...prev,
                      ...recentPage,
                    ];

              return dedupeProducts(
                merged
              ).sort(
                (a, b) =>
                  getTimestamp(b) -
                  getTimestamp(a)
              );
            }
          );

          setPage(
            nextPage
          );
        } catch (err) {
          console.error(
            "Homepage products fetch:",
            err
          );

          if (
            nextPage === 1
          ) {
            setItems([]);
          }

          setHasMore(
            false
          );
        } finally {
          loadingRef.current =
            false;

          setInitialLoading(
            false
          );

          setLoadingMore(
            false
          );
        }
      },
      [
        hasMore,
      ]
    );

  /* =======================================================
     PRIMA PAGINĂ
  ======================================================= */

  useEffect(() => {
    if (
      didInitRef.current
    ) {
      return;
    }

    didInitRef.current =
      true;

    fetchPage(1);
  }, [fetchPage]);

  /* =======================================================
     AUTO LOAD MORE
  ======================================================= */

  useEffect(() => {
    const element =
      loadMoreRef.current;

    if (
      !element ||
      !hasMore ||
      initialLoading ||
      loadingMore
    ) {
      return;
    }

    const observer =
      new IntersectionObserver(
        ([entry]) => {
          if (
            entry.isIntersecting &&
            !loadingRef.current &&
            hasMore
          ) {
            fetchPage(
              page + 1
            );
          }
        },
        {
          rootMargin:
            "500px 0px",
          threshold: 0,
        }
      );

    observer.observe(
      element
    );

    return () => {
      observer.disconnect();
    };
  }, [
    fetchPage,
    hasMore,
    initialLoading,
    loadingMore,
    page,
  ]);

  /* =======================================================
     SYNC FAVORITE
  ======================================================= */

  useEffect(() => {
    const handleFavoriteChange =
      (event) => {
        const {
          productId,
          favorited,
        } =
          event.detail || {};

        if (!productId) {
          return;
        }

        setSaved((prev) => ({
          ...prev,
          [productId]:
            !!favorited,
        }));
      };

    window.addEventListener(
      "favorites-changed",
      handleFavoriteChange
    );

    return () => {
      window.removeEventListener(
        "favorites-changed",
        handleFavoriteChange
      );
    };
  }, []);

  /* =======================================================
     FAVORITE
  ======================================================= */

  const toggleFavorite =
    async (
      event,
      productId
    ) => {
      event.preventDefault();
      event.stopPropagation();

      if (!productId) {
        return;
      }

      const previous =
        !!saved[productId];

      const optimistic =
        !previous;

      setSaved((prev) => ({
        ...prev,
        [productId]:
          optimistic,
      }));

      try {
        const result =
          await api(
            "/api/favorites/toggle",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                productId,
              }),
            }
          );

        const confirmed =
          typeof result
            ?.favorited ===
          "boolean"
            ? result.favorited
            : typeof result
                ?.data
                ?.favorited ===
              "boolean"
            ? result.data
                .favorited
            : optimistic;

        setSaved((prev) => ({
          ...prev,
          [productId]:
            confirmed,
        }));

        setItems((prev) =>
          prev.map(
            (item) => {
              if (
                item.id !==
                productId
              ) {
                return item;
              }

              const oldCount =
                Number(
                  item.favoriteCount ||
                    0
                );

              const delta =
                confirmed ===
                previous
                  ? 0
                  : confirmed
                  ? 1
                  : -1;

              return {
                ...item,

                viewerFavorited:
                  confirmed,

                favoriteCount:
                  Math.max(
                    0,
                    oldCount +
                      delta
                  ),
              };
            }
          )
        );

        window.dispatchEvent(
          new CustomEvent(
            "favorites-changed",
            {
              detail: {
                productId,
                favorited:
                  confirmed,
              },
            }
          )
        );
      } catch (err) {
        console.warn(
          "Favorite failed:",
          err
        );

        setSaved((prev) => ({
          ...prev,
          [productId]:
            previous,
        }));

        if (
          err?.status === 401 ||
          err?.status === 403
        ) {
          navigate(
            `/autentificare?redirect=${encodeURIComponent(
              window.location
                .pathname
            )}`
          );
        }
      }
    };

  /* =======================================================
     LOADING INIȚIAL
  ======================================================= */

  if (
    initialLoading &&
    items.length === 0
  ) {
    return (
      <section
        className={
          styles.section
        }
        aria-labelledby="community-heading"
      >
        <div
          className={
            styles.header
          }
        >
          <div>
            <h2
              id="community-heading"
              className={
                styles.heading
              }
            >
              Noutăți pe Artfest
            </h2>

            <p
              className={
                styles.subheading
              }
            >
              Descoperă creațiile
              noi adăugate în
              ultima săptămână.
            </p>
          </div>
        </div>

        <div
          className={
            styles.feed
          }
        >
          {Array.from({
            length: 4,
          }).map(
            (_, i) => (
              <article
                key={i}
                className={`${styles.postCard} ${styles.skeleton}`}
              >
                <div
                  className={
                    styles.skelImage
                  }
                />

                <div
                  className={
                    styles.headerText
                  }
                >
                  <div
                    className={
                      styles.skelLine
                    }
                    style={{
                      width:
                        "80%",
                    }}
                  />

                  <div
                    className={
                      styles.skelLine
                    }
                    style={{
                      width:
                        "50%",
                    }}
                  />
                </div>
              </article>
            )
          )}
        </div>
      </section>
    );
  }

  if (!items.length) {
    return null;
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <section
      className={
        styles.section
      }
      aria-labelledby="community-heading"
    >
      {/* HEADER */}

      <div
        className={
          styles.header
        }
      >
        <div>
          <h2
            id="community-heading"
            className={
              styles.heading
            }
          >
            Noutăți pe Artfest
          </h2>

          <p
            className={
              styles.subheading
            }
          >
            Descoperă creațiile
            noi adăugate în
            ultima săptămână.
          </p>
        </div>

        <Link
          to="/produse?sort=new&page=1"
          className={
            styles.viewAll
          }
        >
          Vezi toate
        </Link>
      </div>

      {/* PRODUSE */}

      <div
        className={
          styles.feed
        }
      >
        {items.map(
          (p, index) => {
            const img =
              getImageSrc(p);

            const hasImageError =
              !img ||
              brokenImages[p.id];

            const storeName =
              getStoreName(p);

            const storeLogo =
              getStoreLogo(p);

            const storeHref =
              getStoreLink(p);

            const addedAgo =
              timeAgo(p);

            const productHref =
              `/produs/${encodeURIComponent(
                p.id
              )}`;

            const isSaved =
              saved[p.id] ??
              !!p.viewerFavorited;

            const {
              price,
              originalPrice,
              hasDiscount,
              discountPercent,
              isQuoteOnly,
            } = getPricing(p);

            const currency =
              p?.currency ||
              "RON";

            const priceLabel =
              formatMoney(
                price,
                currency
              );

            const originalPriceLabel =
              formatMoney(
                originalPrice,
                currency
              );

            const availabilityLabel =
              getAvailabilityLabel(
                p
              );

            const safeKey =
              p?.id ??
              `${
                p?.title ??
                "produs"
              }-${getTimestamp(
                p
              )}-${index}`;

            return (
              <article
                key={safeKey}
                className={
                  styles.postCard
                }
              >
                {/* IMAGE */}

                <div
                  className={
                    styles.productImageWrap
                  }
                >
                  {/* NOU */}

                  {addedAgo && (
                    <span
                      className={
                        styles.newBadge
                      }
                    >
                      NOU ·{" "}
                      {addedAgo}
                    </span>
                  )}

                  {/* REDUCERE */}

                  {hasDiscount &&
                    discountPercent >
                      0 && (
                      <span
                        className={
                          styles.discountBadge
                        }
                      >
                        -
                        {
                          discountPercent
                        }
                        %
                      </span>
                    )}

                  {/* FAVORITE */}

                  <button
                    type="button"
                    className={`${styles.productFavorite} ${
                      isSaved
                        ? styles.productFavoriteSaved
                        : ""
                    }`}
                    onClick={(
                      e
                    ) =>
                      toggleFavorite(
                        e,
                        p.id
                      )
                    }
                    aria-pressed={
                      isSaved
                    }
                    aria-label={
                      isSaved
                        ? "Elimină produsul de la favorite"
                        : "Adaugă produsul la favorite"
                    }
                  >
                    {isSaved ? (
                      <FaHeart />
                    ) : (
                      <FaRegHeart />
                    )}
                  </button>

                  <Link
                    to={
                      productHref
                    }
                    className={
                      styles.imageLink
                    }
                  >
                    {!hasImageError ? (
                      <img
                        src={img}
                        alt={
                          p.title ||
                          "Produs Artfest"
                        }
                        className={
                          styles.productImage
                        }
                        loading={
                          index < 2
                            ? "eager"
                            : "lazy"
                        }
                        decoding="async"
                        fetchPriority={
                          index < 2
                            ? "high"
                            : "auto"
                        }
                        onError={() => {
                          if (
                            !p?.id
                          ) {
                            return;
                          }

                          setBrokenImages(
                            (
                              prev
                            ) => ({
                              ...prev,
                              [p.id]:
                                true,
                            })
                          );
                        }}
                      />
                    ) : (
                      <span
                        className={
                          styles.noImageText
                        }
                      >
                        Fără imagine
                      </span>
                    )}
                  </Link>
                </div>

                {/* CONTENT */}

                <div
                  className={
                    styles.productBlock
                  }
                >
                  {/* MAGAZIN */}

                  <Link
                    to={
                      storeHref
                    }
                    className={
                      styles.storeRow
                    }
                  >
                    {storeLogo ? (
                      <img
                        src={
                          storeLogo
                        }
                        alt={
                          storeName
                        }
                        className={
                          styles.storeAvatar
                        }
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span
                        className={
                          styles.storeAvatarFallback
                        }
                      >
                        {storeName
                          ?.charAt(
                            0
                          )
                          ?.toUpperCase() ||
                          "A"}
                      </span>
                    )}

                    <span>
                      de{" "}
                      <strong>
                        {
                          storeName
                        }
                      </strong>
                    </span>
                  </Link>

                  {/* TITLU */}

                  <Link
                    to={
                      productHref
                    }
                    className={
                      styles.productTitleLink
                    }
                  >
                    <h3
                      className={
                        styles.productName
                      }
                    >
                      {p.title ||
                        "Produs"}
                    </h3>
                  </Link>

                  {/* BADGE */}

                  {availabilityLabel && (
                    <div
                      className={
                        styles.productTags
                      }
                    >
                      <span
                        className={
                          styles.productTag
                        }
                      >
                        {
                          availabilityLabel
                        }
                      </span>
                    </div>
                  )}

                  {/* BOTTOM */}

                  <div
                    className={
                      styles.productInfoRow
                    }
                  >
                    <div
                      className={
                        styles.priceArea
                      }
                    >
                      {isQuoteOnly ? (
                        <p
                          className={
                            styles.productPrice
                          }
                        >
                          Cere ofertă
                        </p>
                      ) : (
                        <>
                          {hasDiscount &&
                            originalPriceLabel && (
                              <span
                                className={
                                  styles.oldPrice
                                }
                              >
                                {
                                  originalPriceLabel
                                }
                              </span>
                            )}

                          {priceLabel && (
                            <p
                              className={
                                styles.productPrice
                              }
                            >
                              {
                                priceLabel
                              }
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    <Link
                      to={
                        productHref
                      }
                      className={
                        styles.buyBtn
                      }
                      aria-label={`Vezi ${
                        p.title ||
                        "produsul"
                      }`}
                    >
                      <FaShoppingBag />
                    </Link>
                  </div>
                </div>
              </article>
            );
          }
        )}
      </div>

      {/* AUTO LOAD */}

      {hasMore && (
        <div
          ref={loadMoreRef}
          aria-hidden="true"
          style={{
            width: "100%",
            height: "1px",
          }}
        />
      )}

      {loadingMore && (
        <div
          style={{
            textAlign:
              "center",
            padding:
              "18px 0 4px",
            color:
              "var(--color-muted)",
            fontSize:
              "0.78rem",
          }}
        >
          Se încarcă alte
          noutăți…
        </div>
      )}

      {/* CTA FINAL */}

      <div
        className={
          styles.loadMoreWrap
        }
      >
        <Link
          to="/produse?sort=new&page=1"
          className={
            styles.loadMore
          }
        >
          Vezi toate noutățile →
        </Link>
      </div>
    </section>
  );
}