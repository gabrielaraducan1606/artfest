import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FaHeart, FaRegHeart, FaShoppingBag } from "react-icons/fa";
import styles from "./PopularProducts.module.css";
import { api } from "../../../lib/api";

const PAGE_SIZE = 8;

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
  const firstImage = Array.isArray(p?.images) ? p.images[0] : null;
  if (typeof firstImage === "string" && firstImage.trim()) return firstImage;
  if (firstImage?.url) return firstImage.url;
  return null;
}

async function loadFavoriteIds() {
  try {
    const r = await api("/api/favorites/ids?limit=50");

    const ids = Array.isArray(r?.items)
      ? r.items.map((x) => x.productId).filter(Boolean)
      : [];

    return new Set(ids);
  } catch (err) {
    console.error("loadFavoriteIds failed:", err);
    return null;
  }
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
  const slug = p?.storeSlug || p?.service?.profile?.slug || null;
  const vid = p?.service?.vendor?.id || p?.service?.vendorId || null;

  return slug
    ? `/magazin/${encodeURIComponent(slug)}`
    : vid
    ? `/magazin/${vid}`
    : "/magazine";
}

function priceFmt(p) {
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
}

function timeAgo(p) {
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
  return `${Math.floor(mo / 12)} ani`;
}

export default function PopularProducts() {
  const [items, setItems] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [brokenImages, setBrokenImages] = useState({});
  const [saved, setSaved] = useState({});

  const loadingRef = useRef(false);
  const didInitRef = useRef(false);
  const loadMoreRef = useRef(null);

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
        const r = await api(
          `/api/public/products/feed?limit=${PAGE_SIZE}&page=${nextPage}`
        );

        const pageItems = Array.isArray(r?.items) ? r.items : [];

        const favoriteIds = await loadFavoriteIds();

setSaved((prev) => {
  const next = { ...prev };

  for (const item of pageItems) {
    if (!item?.id) continue;

    next[item.id] =
      favoriteIds instanceof Set
        ? favoriteIds.has(item.id) || !!item.viewerFavorited
        : !!item.viewerFavorited || !!prev[item.id];
  }

  return next;
});

        setHasMore(!!r?.hasMore || pageItems.length >= PAGE_SIZE);

        const sorted = [...pageItems].sort(
          (a, b) => getTimestamp(b) - getTimestamp(a)
        );

        setItems((prev) =>
          dedupeProducts(nextPage === 1 ? sorted : [...prev, ...sorted])
        );

        setPage(nextPage);
      } catch (err) {
        console.error("Community feed fetch:", err);
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
    if (!el || !hasMore || initialLoading || loadingMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingRef.current && hasMore) {
          fetchPage(page + 1);
        }
      },
      { rootMargin: "300px", threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchPage, hasMore, initialLoading, loadingMore, page]);

  useEffect(() => {
  const handleFavoriteChange = (e) => {
    const { productId, favorited } = e.detail;

    setSaved((prev) => ({
      ...prev,
      [productId]: favorited,
    }));
  };

  window.addEventListener(
    "favorites-changed",
    handleFavoriteChange
  );

  return () =>
    window.removeEventListener(
      "favorites-changed",
      handleFavoriteChange
    );
}, []);

const toggleFavorite = async (e, productId) => {
  e.preventDefault();
  e.stopPropagation();

  const previous = !!saved[productId];
  const optimistic = !previous;

  setSaved((prev) => ({
    ...prev,
    [productId]: optimistic,
  }));

  try {
    const result = await api("/api/favorites/toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ productId }),
    });

    const confirmedFavorited =
      typeof result?.favorited === "boolean"
        ? result.favorited
        : typeof result?.data?.favorited === "boolean"
        ? result.data.favorited
        : optimistic;

    setSaved((prev) => ({
      ...prev,
      [productId]: confirmedFavorited,
    }));

    setItems((prev) =>
  prev.map((item) => {
    if (item.id !== productId) return item;

    const oldCount = Number(item.favoriteCount || 0);

    return {
      ...item,
      viewerFavorited: confirmedFavorited,
      favoriteCount: confirmedFavorited
        ? oldCount + 1
        : Math.max(0, oldCount - 1),
    };
  })
);
    window.dispatchEvent(
  new CustomEvent("favorites-changed", {
    detail: {
      productId,
      favorited: confirmedFavorited,
      delta: confirmedFavorited ? 1 : -1,
    },
  })
);
  } catch (err) {
    console.warn("Favorite failed:", err);

    setSaved((prev) => ({
      ...prev,
      [productId]: previous,
    }));
  }
};

  if (initialLoading && items.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="community-heading">
        <div className={styles.header}>
          <div>
            <h2 id="community-heading" className={styles.heading}>
              Activitate recentă
            </h2>
            <p className={styles.subheading}>
              Produse noi adăugate de artizani.
            </p>
          </div>
        </div>

        <div className={styles.feed}>
          {Array.from({ length: 3 }).map((_, i) => (
            <article
              className={`${styles.postCard} ${styles.skeleton}`}
              key={i}
            >
              <div className={styles.postHeader}>
                <div className={styles.avatarSkeleton} />
                <div className={styles.headerText}>
                  <div className={styles.skelLine} style={{ width: "60%" }} />
                  <div className={styles.skelLine} style={{ width: "35%" }} />
                </div>
              </div>
              <div className={styles.skelImage} />
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (!items.length) return null;

  return (
    <section className={styles.section} aria-labelledby="community-heading">
      <div className={styles.header}>
        <div>
          <h2 id="community-heading" className={styles.heading}>
            Activitate recentă
          </h2>
          <p className={styles.subheading}>
            Vezi ce produse noi adaugă artizanii și salvează ce îți place.
          </p>
        </div>

        <Link to="/produse?sort=new&page=1" className={styles.viewAll}>
          Vezi toate
        </Link>
      </div>

      <div className={styles.feed}>
        {items.map((p, index) => {
          const img = getImageSrc(p);
          const hasImageError = !img || brokenImages[p.id];
          const storeName = getStoreName(p);
          const storeLogo = getStoreLogo(p);
          const storeHref = getStoreLink(p);
          const addedAgo = timeAgo(p);
          const productHref = `/produs/${encodeURIComponent(p.id)}`;
          const isSaved = saved[p.id] ?? !!p.viewerFavorited;
          const favoriteCount = Number(p.favoriteCount || 0);

          const safeKey =
            p?.id ?? `${p?.title ?? "produs"}-${getTimestamp(p)}-${index}`;

          return (
            <article key={safeKey} className={styles.postCard}>
              <div className={styles.postHeader}>
                <Link to={storeHref} className={styles.avatarLink}>
                  {storeLogo ? (
                    <img
                      src={storeLogo}
                      alt={storeName}
                      className={styles.avatar}
                      loading="lazy"
                    />
                  ) : (
                    <span className={styles.avatarFallback}>
                      {storeName?.charAt(0)?.toUpperCase() || "M"}
                    </span>
                  )}
                </Link>

                <div className={styles.postMeta}>
                  <div className={styles.postTitle}>
                    <Link to={storeHref} className={styles.storeName}>
                      {storeName}
                    </Link>{" "}
                    <span>a adăugat un produs nou</span>
                  </div>

                  <div className={styles.postTime}>
                    {addedAgo ? `${addedAgo} în urmă` : "recent"}
                  </div>
                </div>
              </div>

              <div className={styles.productImageWrap}>
                <button
  type="button"
  className={`${styles.productFavorite} ${
    isSaved ? styles.productFavoriteSaved : ""
  }`}
  onClick={(e) => toggleFavorite(e, p.id)}
  aria-pressed={isSaved}
  aria-label={
    isSaved
      ? "Elimină produsul de la favorite"
      : "Adaugă produsul la favorite"
  }
>
  {isSaved ? <FaHeart /> : <FaRegHeart />}
</button>

                <Link to={productHref} className={styles.imageLink}>
                  {!hasImageError && (
                    <img
                      src={img}
                      alt={p.title}
                      className={styles.productImage}
                      loading="lazy"
                      onError={() => {
                        if (!p?.id) return;
                        setBrokenImages((prev) => ({
                          ...prev,
                          [p.id]: true,
                        }));
                      }}
                    />
                  )}

                  {hasImageError && (
                    <span className={styles.noImageText}>Fără imagine</span>
                  )}
                </Link>
              </div>

              <Link to={productHref} className={styles.productBlock}>
                <div className={styles.productInfo}>
                  <h3 className={styles.productName}>{p.title}</h3>

                  <div className={styles.productInfoRow}>
                    <p className={styles.productPrice}>{priceFmt(p)}</p>

                    {favoriteCount > 0 && (
                      <p className={styles.favoriteCount}>
                        ❤️ {favoriteCount} salvări
                      </p>
                    )}
                  </div>
                </div>
              </Link>

              <div className={styles.engagementBar}>
                <Link to={productHref} className={styles.buyBtn}>
                  <FaShoppingBag />
                  <span>Vezi produsul</span>
                </Link>
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
              if (!loadingMore && hasMore) fetchPage(page + 1);
            }}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {loadingMore ? "Se încarcă..." : "Vezi mai multe noutăți"}
          </button>
        </div>
      )}
    </section>
  );
}