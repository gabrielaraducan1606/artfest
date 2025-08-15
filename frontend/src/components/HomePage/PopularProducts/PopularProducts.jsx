import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaHeart, FaShoppingCart, FaChevronLeft, FaChevronRight, FaStar } from "react-icons/fa";
import styles from "./PopularProducts.module.css";
import api from "../../services/api";
import { useAppContext } from "../../Context/useAppContext";
import { toast } from "react-toastify";
import { productPlaceholder, onImgError } from "../../utils/imageFallback";

const sellerHandle = (s) => s?.slug || s?.username || s?._id;

export default function PopularProducts() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const trackRef = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // drag state — fără pointer capture; folosim un prag
  const isDragging = useRef(false);
  const dragStarted = useRef(false);
  const startX = useRef(0);
  const startScrollLeft = useRef(0);
  const DRAG_THRESHOLD = 6; // px

  const isAuthed = !!localStorage.getItem("authToken");
  const { cart, setCart, favorites, setFavorites } = useAppContext();
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/products/public", {
          params: { sort: "rating", limit: 14 },
        });
        if (!mounted) return;
        setItems(Array.isArray(data?.products) ? data.products : []);
      } catch (err) {
        console.error("PopularProducts fetch:", err);
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setAtStart(start);
    setAtEnd(end);
  };

  useEffect(() => {
    updateArrows();
    const el = trackRef.current;
    if (!el) return;
    const onScroll = () => updateArrows();
    const onResize = () => updateArrows();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [items.length]);

  const scrollByAmount = (dir = 1) => {
    const el = trackRef.current;
    if (!el) return;
    const amount = Math.round(el.clientWidth * 0.9);
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  // drag-to-scroll: fără pointer capture și cu prag
  const onPointerDown = (e) => {
    const el = trackRef.current;
    if (!el) return;
    isDragging.current = true;
    dragStarted.current = false;
    startX.current = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    startScrollLeft.current = el.scrollLeft;
    el.classList.add(styles.dragging);
  };
  const onPointerMove = (e) => {
    const el = trackRef.current;
    if (!el || !isDragging.current) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const dx = x - startX.current;

    if (!dragStarted.current && Math.abs(dx) >= DRAG_THRESHOLD) {
      dragStarted.current = true;
    }
    if (dragStarted.current) {
      el.scrollLeft = startScrollLeft.current - dx;
    }
  };
  const onPointerUp = () => {
    const el = trackRef.current;
    if (!el) return;
    isDragging.current = false;
    dragStarted.current = false;
    el.classList.remove(styles.dragging);
  };
  const onClickCaptureTrack = (e) => {
    // dacă am “tras” efectiv, anulăm clickurile rezultate în timpul dragului
    if (dragStarted.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  /* ============ Acțiuni: Favorite / Coș / Magazin ============ */
  const toggleFavorite = async (product, e) => {
    e.stopPropagation();
    const exists = favorites.some((f) => f._id === product._id);

    if (!isAuthed) {
      const updated = exists
        ? favorites.filter((f) => f._id !== product._id)
        : [...favorites, product];
      setFavorites(updated);
      localStorage.setItem("wishlist", JSON.stringify(updated));
      toast.success(exists ? "Produs scos din favorite" : "Produs adăugat la favorite");
      return;
    }

    try {
      if (exists) await api.delete(`/wishlist/${product._id}`);
      else await api.post(`/wishlist/${product._id}`);
      const { data } = await api.get("/wishlist");
      setFavorites(data || []);
      toast.success(exists ? "Produs scos din favorite" : "Produs adăugat la favorite");
    } catch (err) {
      console.error("toggleFavorite:", err);
      toast.error("Nu am putut actualiza favoritele.");
    }
  };

  const addToCart = async (product, e) => {
    e.stopPropagation();
    if (!isAuthed) {
      const updated = [...cart, { ...product, qty: 1 }];
      setCart(updated);
      localStorage.setItem("cart", JSON.stringify(updated));
      toast.success("Produs adăugat în coș");
      return;
    }
    try {
      await api.post(`/cart/${product._id}`, { qty: 1 });
      const { data } = await api.get("/cart");
      setCart(data || []);
      toast.success("Produs adăugat în coș");
    } catch (err) {
      console.error("addToCart:", err);
      toast.error("Nu am putut adăuga în coș.");
    }
  };

  const goToShop = (product, e) => {
    e.stopPropagation();
    if (!product?.seller) return;
    const handle = sellerHandle(product.seller);
    if (!handle) return;
    navigate(`/magazin/${handle}`);
  };

  if (loading && items.length === 0) {
    return (
      <section className={styles.section}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Produse populare</h2>
          <Link to="/produse" className={styles.viewAll}>Vezi toate</Link>
        </div>
        <div className={styles.skeletonRow}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div className={styles.skeletonCard} key={i} />
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
        <Link to="/produse" className={styles.viewAll}>Vezi toate</Link>
      </div>

      <div className={styles.slider}>
        <button
          className={`${styles.navBtn} ${styles.prev}`}
          onClick={() => scrollByAmount(-1)}
          aria-label="Derulează înapoi"
          disabled={atStart}
          type="button"
        >
          <FaChevronLeft />
        </button>

        <div
          className={`${styles.track} ${styles.edges}`}
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onMouseLeave={onPointerUp}
          onClickCapture={onClickCaptureTrack}
        >
          {items.map((p) => (
            <article
              key={p._id}
              className={styles.card}
              onClick={() => navigate(`/produs/${p._id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") navigate(`/produs/${p._id}`);
              }}
            >
              <div className={styles.imageWrap}>
                <img
                  src={p.images?.[0] || productPlaceholder(600, 450, "Produs")}
                  alt={p.title}
                  className={styles.image}
                  loading="lazy"
                  onError={(e) => onImgError(e, 600, 450, "Produs")}
                />
              </div>

              <h3 className={styles.name} title={p.title}>{p.title}</h3>

              <div className={styles.metaRow}>
                <div className={styles.rating}>
                  {[...Array(5)].map((_, i) => (
                    <FaStar
                      key={i}
                      color={
                        i < Math.round(p.rating || p.avgRating || 0)
                          ? "var(--rating-on)"
                          : "var(--rating-off)"
                      }
                    />
                  ))}
                  {(p.reviewCount ?? 0) > 0 && (
                    <span className={styles.reviewsCount}>({p.reviewCount})</span>
                  )}
                </div>
                <p className={styles.price}>{Number(p.price).toFixed(2)} lei</p>
              </div>

              <div className={styles.bottomRow}>
                {p.seller ? (
                  <button
                    type="button"
                    className={styles.shopLinkBtn}
                    onClick={(e) => goToShop(p, e)}
                    title={p.seller.shopName || "Magazin"}
                  >
                    Vezi magazin
                  </button>
                ) : (
                  <span className={styles.shopPlaceholder}>—</span>
                )}

                <div className={styles.iconBar} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title="Favorite"
                    onClick={(e) => toggleFavorite(p, e)}
                    aria-pressed={favorites.some((f) => f._id === p._id)}
                  >
                    <FaHeart
                      color={
                        favorites.some((f) => f._id === p._id)
                          ? "var(--color-primary)"
                          : "var(--color-text)"
                      }
                    />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    title="Adaugă în coș"
                    onClick={(e) => addToCart(p, e)}
                  >
                    <FaShoppingCart />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <button
          className={`${styles.navBtn} ${styles.next}`}
          onClick={() => scrollByAmount(1)}
          aria-label="Derulează înainte"
          disabled={atEnd}
          type="button"
        >
          <FaChevronRight />
        </button>
      </div>
    </section>
  );
}
