import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaStar } from "react-icons/fa";
import styles from "./PopularProducts.module.css";
import { api } from "../../../lib/api";

const PAGE_SIZE = 12;

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

function getImageSrc(p) {
  if (Array.isArray(p?.images) && p.images.length > 0) {
    const firstImage = p.images[0];

    if (typeof firstImage === "string" && firstImage.trim()) {
      return firstImage;
    }

    if (
      firstImage &&
      typeof firstImage === "object" &&
      typeof firstImage.url === "string" &&
      firstImage.url.trim()
    ) {
      return firstImage.url;
    }
  }

  return null;
}

function dedupeProducts(list) {
  const seen = new Set();

  return list.filter((item) => {
    const id = item?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export default function PopularProducts() {
  const [items, setItems] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [brokenImages, setBrokenImages] = useState({});

  const navigate = useNavigate();
  const loadingRef = useRef(false);
  const didInitRef = useRef(false);
  const loadMoreRef = useRef(null);

  const priceFmt = (p) => {
    const cur = p?.currency || "RON";

    if (typeof p?.priceCents === "number") {
      return new Intl.NumberFormat("ro-RO", {
        style: "currency",
        currency: cur,
      }).format(p.priceCents / 100);
    }

    if (typeof p?.price === "number") {
      return new Intl.NumberFormat("ro-RO", {
        style: "currency",
        currency: cur,
      }).format(p.price);
    }

    return "";
  };

  const storeLink = (p) => {
    const slug = p?.service?.profile?.slug || null;
    const vid = p?.service?.vendor?.id || p?.service?.vendorId || null;

    return slug
      ? `/magazin/${encodeURIComponent(slug)}`
      : vid
      ? `/magazin/${vid}`
      : "/magazine";
  };

  const storeName = (p) =>
    p?.storeName ||
    p?.service?.profile?.displayName ||
    p?.service?.vendor?.displayName ||
    "Magazin";

  const avgRating = (p) => {
    if (typeof p?.averageRating === "number") return p.averageRating;

    const revs = Array.isArray(p?.reviews) ? p.reviews : [];
    if (!revs.length) return null;

    const sum = revs.reduce((s, r) => s + (r.rating || 0), 0);
    return Math.round((sum / revs.length) * 10) / 10;
  };

  const timeAgo = (p) => {
    const ts = getTimestamp(p);
    if (!ts) return "";

    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);

    if (m < 1) return "tocmai acum";
    if (m < 60) return `${m} min`;

    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h`;

    const d = Math.floor(h / 24);
    if (d < 30) return `${d} zile`;

    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo} luni`;

    const y = Math.floor(mo / 12);
    return `${y} ani`;
  };

  const fetchPage = useCallback(
    async (nextPage = 1) => {
      if (loadingRef.current) return;
      if (nextPage > 1 && (!hasMore || loadingMore)) return;

      loadingRef.current = true;

      if (nextPage === 1) {
        setInitialLoading(true);
        setBrokenImages({});
        setHasMore(true);
      } else {
        setLoadingMore(true);
      }

      try {
        let list = [];

        if (nextPage === 1) {
          try {
            const r = await api(
              `/api/public/products/recommended?limit=${PAGE_SIZE}&page=${nextPage}`
            );

            const pageItems = Array.isArray(r?.items) ? r.items : [];

            if (pageItems.length) list = pageItems;
            else if (Array.isArray(r?.popular) && r.popular.length) {
              list = r.popular;
            } else if (Array.isArray(r?.recommended) && r.recommended.length) {
              list = r.recommended;
            } else if (Array.isArray(r?.latest) && r.latest.length) {
              list = r.latest;
            }
          } catch {
            // fallback below
          }
        }

        if (!list.length || nextPage > 1) {
          const r2 = await api(
            `/api/public/products?sort=new&limit=${PAGE_SIZE}&page=${nextPage}`
          );

          const pageItems = Array.isArray(r2?.items) ? r2.items : [];

          list = nextPage === 1 ? (list.length ? list : pageItems) : pageItems;

          setHasMore(pageItems.length >= PAGE_SIZE);
        } else if (nextPage === 1) {
          setHasMore(list.length >= PAGE_SIZE);
        }

        list.sort((a, b) => getTimestamp(b) - getTimestamp(a));

        setItems((prev) => {
          const merged = nextPage === 1 ? list : [...prev, ...list];
          return dedupeProducts(merged);
        });

        setPage(nextPage);
      } catch (err) {
        console.error("PopularProducts fetch:", err);

        if (nextPage === 1) setItems([]);
        setHasMore(false);
      } finally {
        loadingRef.current = false;
        setInitialLoading(false);
        setLoadingMore(false);
      }
    },
    [hasMore, loadingMore]
  );

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    fetchPage(1);
  }, [fetchPage]);

  useEffect(() => {
    const el = loadMoreRef.current;

    if (!el) return;
    if (!hasMore || initialLoading || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];

        if (first.isIntersecting && !loadingRef.current && hasMore) {
          fetchPage(page + 1);
        }
      },
      {
        root: null,
        rootMargin: "300px",
        threshold: 0,
      }
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, [fetchPage, hasMore, initialLoading, loadingMore, page]);

  if (initialLoading && items.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="pp-heading">
        <div className={styles.header}>
          <h2 id="pp-heading" className={styles.heading}>
            Produse populare
          </h2>
        </div>

        <div className={styles.grid} aria-busy="true">
          {Array.from({ length: PAGE_SIZE }).map((_, i) => (
            <article className={`${styles.card} ${styles.skeleton}`} key={i}>
              <div className={`${styles.thumb} ${styles.skelBox}`} />
              <div className={styles.body}>
                <div className={styles.skelLine} style={{ width: "70%" }} />
                <div className={styles.skelLine} style={{ width: "40%" }} />
                <div className={styles.skelMeta} />
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) return null;

  return (
    <section className={styles.section} aria-labelledby="pp-heading">
      <div className={styles.header}>
        <h2 id="pp-heading" className={styles.heading}>
          Produse populare
        </h2>
      </div>

      <div className={styles.grid} aria-busy={loadingMore}>
        {items.map((p, index) => {
          const rating = avgRating(p);
          const img = getImageSrc(p);
          const addedAgo = timeAgo(p);
          const hasImageError = !img || brokenImages[p.id];
          const safeKey =
            p?.id ?? `${p?.title ?? "produs"}-${getTimestamp(p)}-${index}`;

          return (
            <article
              key={safeKey}
              className={styles.card}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/produs/${p.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/produs/${p.id}`);
                }
              }}
            >
              <Link
                to={`/produs/${p.id}`}
                className={`${styles.thumbLink} ${
                  hasImageError ? styles.noImage : ""
                }`}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Vezi ${p.title}`}
              >
                {!hasImageError && (
                  <img
                    src={img}
                    alt={p.title}
                    className={styles.thumb}
                    loading="lazy"
                    onError={() => {
                      if (!p?.id) return;

                      setBrokenImages((prev) => {
                        if (prev[p.id]) return prev;
                        return {
                          ...prev,
                          [p.id]: true,
                        };
                      });
                    }}
                  />
                )}
              </Link>

              <div className={styles.body}>
                <h3 className={styles.name} title={p.title}>
                  {p.title}
                </h3>

                <div className={styles.subRow}>
                  <Link
                    to={storeLink(p)}
                    className={styles.shop}
                    onClick={(e) => e.stopPropagation()}
                    title={storeName(p)}
                  >
                    {storeName(p)}
                  </Link>

                  {addedAgo && (
                    <span className={styles.dot} aria-hidden="true">
                      •
                    </span>
                  )}
                  {addedAgo && <span className={styles.time}>{addedAgo}</span>}
                </div>

                <div className={styles.metaRow}>
                  <div
                    className={styles.rating}
                    aria-label={
                      rating != null
                        ? `Rating ${rating} din 5`
                        : "Fără recenzii"
                    }
                  >
                    {[...Array(5)].map((_, i) => (
                      <FaStar
                        key={i}
                        color={
                          rating != null && i < Math.round(rating)
                            ? "var(--color-warning)"
                            : "var(--color-border)"
                        }
                      />
                    ))}
                    {rating != null && (
                      <span className={styles.ratingVal}>{rating}</span>
                    )}
                  </div>

                  <p className={styles.price}>{priceFmt(p)}</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {hasMore && (
        <div className={styles.loadMoreWrap}>
          <button
            ref={loadMoreRef}
            type="button"
            className={styles.loadMore}
            onClick={() => {
              if (!loadingMore && hasMore) {
                fetchPage(page + 1);
              }
            }}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {loadingMore ? "Se încarcă..." : "Vezi mai mult"}
          </button>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className={styles.loadMoreWrap}>
          <span className={styles.endMessage}>Ai ajuns la final.</span>
        </div>
      )}
    </section>
  );
}