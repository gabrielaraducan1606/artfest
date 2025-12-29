import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaStar } from "react-icons/fa";
import styles from "./PopularProducts.module.css";
import { api } from "../../../lib/api";

const PAGE_SIZE = 12; // câte produse încărcăm la fiecare pas

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

export default function PopularProducts() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const navigate = useNavigate();

  const loadingRef = useRef(false);

  const priceFmt = (p) => {
    const cur = p?.currency || "RON";
    if (typeof p?.priceCents === "number") {
      return new Intl.NumberFormat("ro-RO", { style: "currency", currency: cur })
        .format(p.priceCents / 100);
    }
    if (typeof p?.price === "number") {
      return new Intl.NumberFormat("ro-RO", { style: "currency", currency: cur })
        .format(p.price);
    }
    return "";
  };

  const storeLink = (p) => {
    const slug = p?.service?.profile?.slug || null;
    const vid = p?.service?.vendor?.id || p?.service?.vendorId || null;
    return slug ? `/magazin/${encodeURIComponent(slug)}` : vid ? `/magazin/${vid}` : "/magazine";
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

  async function fetchPage(nextPage = 1) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    try {
      let list = [];

      // Prima pagină: încearcă endpoint-ul de „recommended”
      if (nextPage === 1) {
        try {
         const r = await api(`/api/public/products/recommended?limit=${PAGE_SIZE}&page=${nextPage}`);
const pageItems = Array.isArray(r?.items) ? r.items : [];
if (pageItems.length) list = pageItems;

          if (Array.isArray(r?.popular) && r.popular.length) list = r.popular;
          else if (Array.isArray(r?.recommended) && r.recommended.length) list = r.recommended;
          else if (Array.isArray(r?.latest) && r.latest.length) list = r.latest;
        } catch {""}
      }

      // fallback + pagina curentă
      if (!list.length || nextPage > 1) {
        const r2 = await api(
          `/api/public/products?sort=new&limit=${PAGE_SIZE}&page=${nextPage}`
        );
        const pageItems = Array.isArray(r2?.items) ? r2.items : [];
        list = nextPage === 1 ? (list.length ? list : pageItems) : pageItems;
        if (pageItems.length < PAGE_SIZE) setHasMore(false);
      } else {
        // dacă prima listă e mai mică decât PAGE_SIZE, ascundem „Vezi mai mult”
        if (nextPage === 1) setHasMore(list.length >= PAGE_SIZE);
      }

      // Ordonăm după momentul listării/publicării/creării
      list.sort((a, b) => getTimestamp(b) - getTimestamp(a));

      setItems((prev) => (nextPage === 1 ? list : [...prev, ...list]));
      setPage(nextPage);
    } catch (err) {
      console.error("PopularProducts fetch:", err);
      if (nextPage === 1) setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
      loadingRef.current = false;
      setFirstLoad(false);
    }
  }

  useEffect(() => {
    fetchPage(1);
  }, []);

  // Skeleton la prima încărcare
  if (firstLoad && loading && items.length === 0) {
    return (
      <section className={styles.section} aria-labelledby="pp-heading">
        <div className={styles.header}>
          <h2 id="pp-heading" className={styles.heading}>Produse populare</h2>
        </div>
        <div className={styles.grid}>
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
        <h2 id="pp-heading" className={styles.heading}>Produse populare</h2>
      </div>

      {/* Desktop: grid de carduri; Mobil: listă (CSS controlează layout-ul) */}
      <div className={styles.grid}>
        {items.map((p) => {
          const rating = avgRating(p);
          const img = (Array.isArray(p.images) && p.images[0]) || "/placeholder.png";
          const addedAgo = timeAgo(p);

          return (
            <article
              key={p.id}
              className={styles.card}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/produs/${p.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") navigate(`/produs/${p.id}`);
              }}
            >
              <Link
                to={`/produs/${p.id}`}
                className={styles.thumbLink}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Vezi ${p.title}`}
              >
                <img
                  src={img}
                  alt={p.title}
                  className={styles.thumb}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.src = "/placeholder.png"; }}
                />
              </Link>

              <div className={styles.body}>
                <h3 className={styles.name} title={p.title}>{p.title}</h3>

                <div className={styles.subRow}>
                  <Link
                    to={storeLink(p)}
                    className={styles.shop}
                    onClick={(e) => e.stopPropagation()}
                    title={storeName(p)}
                  >
                    {storeName(p)}
                  </Link>

                  {addedAgo && <span className={styles.dot} aria-hidden="true">•</span>}
                  {addedAgo && <span className={styles.time}>{addedAgo}</span>}
                </div>

                <div className={styles.metaRow}>
                  <div
                    className={styles.rating}
                    aria-label={rating != null ? `Rating ${rating} din 5` : "Fără recenzii"}
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
                    {rating != null && <span className={styles.ratingVal}>{rating}</span>}
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
            type="button"
            className={styles.loadMore}
            onClick={() => fetchPage(page + 1)}
            disabled={loading}
          >
            {loading ? "Se încarcă…" : "Vezi mai mult"}
          </button>
        </div>
      )}
    </section>
  );
}
