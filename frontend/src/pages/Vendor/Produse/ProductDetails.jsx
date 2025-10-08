import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../../../lib/api";
import styles from "./ProductDetails.module.css";
import {
  FaChevronLeft,
  FaChevronRight,
  FaShareAlt,
  FaShoppingCart,
  FaHeart,
  FaRegHeart,
  FaStore,
} from "react-icons/fa";
import {
  productPlaceholder,
  avatarPlaceholder,
  onImgError,
} from "../../../components/utils/imageFallback";

import ReviewsSection from "./ReviewSection/ReviewSection";
import CommentsSection from "./CommentSection/CommentSection";
import { guestCart } from "../../../lib/guestCart";

/* ========= Helpers URL + cache-buster (acceptă data:/blob:) ========= */
const BACKEND_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const isHttp = (u = "") => /^https?:\/\//i.test(u);
const isDataOrBlob = (u = "") => /^(data|blob):/i.test(u);
const resolveFileUrl = (u) => {
  if (!u) return "";
  if (isHttp(u) || isDataOrBlob(u)) return u;
  const path = u.startsWith("/") ? u : `/${u}`;
  return BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
};
const withCache = (url, t) => {
  if (!url || !isHttp(url)) return url;
  return url.includes("?") ? `${url}&t=${t}` : `${url}?t=${t}`;
};

export default function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [me, setMe] = useState(null);
  const [favorites, setFavorites] = useState(() => new Set());

  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);

  const [reviews, setReviews] = useState([]);
  const [avg, setAvg] = useState({ average: 0, count: 0 });

  const [comments, setComments] = useState([]);

  const [activeIdx, setActiveIdx] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);

  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);

  const [revRating, setRevRating] = useState(0);
  const [revText, setRevText] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setActiveIdx(0);
    setQty(1);
  }, [id]);

  const cacheT = useMemo(
    () =>
      product?.updatedAt
        ? new Date(product.updatedAt).getTime()
        : Date.now(),
    [product?.updatedAt]
  );

  const loadAll = useCallback(async () => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);

    try {
      // me (ignora erori)
      const meRes = await api("/api/auth/me").catch(() => null);
      if (!mountedRef.current) return;
      setMe(meRes?.user || null);

      // produs
      const p = await api(
        `/api/public/products/${encodeURIComponent(id)}`,
        { signal: ctrl.signal }
      );
      if (!mountedRef.current) return;
      setProduct(p);

      // reviews & average din răspuns
      const revs = Array.isArray(p?.reviews) ? p.reviews : [];
      setReviews(revs);
      setAvg({
        average:
          typeof p?.averageRating === "number" ? p.averageRating : 0,
        count: revs.length || 0,
      });

      // favorites → doar IDs (mai ieftin)
      api("/api/favorites/ids", { signal: ctrl.signal })
        .then((fav) => {
          if (!mountedRef.current) return;
          const set =
            new Set(Array.isArray(fav?.items) ? fav.items : []);
          setFavorites(set);
        })
        .catch(() => {});

      // related: din același magazin (dacă avem slug)
      if (p?.service?.profile?.slug) {
        api(
          `/api/public/store/${encodeURIComponent(
            p.service.profile.slug
          )}/products`,
          { signal: ctrl.signal }
        )
          .then((items) => {
            if (!mountedRef.current) return;
            const list = Array.isArray(items) ? items : [];
            setRelated(list.filter((x) => x.id !== p.id).slice(0, 8));
          })
          .catch(() => mountedRef.current && setRelated([]));
      } else {
        setRelated([]);
      }

      // comments (dacă nu ai listă publică, lasă gol)
      setComments([]);
    } catch (e) {
      if (mountedRef.current)
        setError(
          e?.message || "Nu am putut încărca produsul."
        );
    } finally {
      if (mountedRef.current) setLoading(false);
    }

    return () => ctrl.abort();
  }, [id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ——— Ownership robust: compar atât vendorId-urile cât și userId-urile ———
  const myVendorId = me?.vendor?.id ?? null;
  const myUserId = me?.id ?? me?.sub ?? null;

  const ownerVendorId =
    product?.service?.vendor?.id ??
    product?.vendor?.id ??
    product?.ownerVendorId ??
    null;

  const ownerUserId =
    product?.service?.vendor?.userId ??
    product?.vendor?.userId ??
    null;

  const isOwner = useMemo(() => {
    const byVendor =
      !!myVendorId && !!ownerVendorId && myVendorId === ownerVendorId;
    const byUser =
      !!myUserId && !!ownerUserId && myUserId === ownerUserId;
    return byVendor || byUser;
  }, [myVendorId, myUserId, ownerVendorId, ownerUserId]);

  // view mode
  const viewMode = isOwner ? "vendor" : me ? "user" : "guest";

  // helper: cere login (o folosim DOAR pt favorite/recenzii/comentarii)
  const requireAuth = (fn) => (...args) => {
    if (!me) {
      alert("Trebuie să fii autentificat pentru a adăuga produse în wishlist."); // ✅ ALERTA
      const redir = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      navigate(`/autentificare?redirect=${redir}`);
      return;
    }
    return fn(...args);
  };

  const images = useMemo(() => {
    const list =
      Array.isArray(product?.images) && product.images.length
        ? product.images
        : [];
    return list.length ? list : [productPlaceholder(1000, 750, "Produs")];
  }, [product?.images]);

  useEffect(() => {
    setActiveIdx((i) => (images[i] ? i : 0));
  }, [images]);

  const activeSrc = useMemo(
    () =>
      withCache(resolveFileUrl(images[activeIdx] || images[0]), cacheT),
    [images, activeIdx, cacheT]
  );

  useEffect(() => {
    const next = images[(activeIdx + 1) % images.length];
    if (!next) return;
    const img = new Image();
    img.src = withCache(resolveFileUrl(next), cacheT);
  }, [activeIdx, images, cacheT]);

  const displayPrice = useMemo(() => {
    if (typeof product?.price === "number") return product.price;
    if (Number.isFinite(product?.priceCents))
      return product.priceCents / 100;
    return null;
  }, [product?.price, product?.priceCents]);

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat("ro-RO", {
        style: "currency",
        currency: product?.currency || "RON",
      }),
    [product?.currency]
  );

  // coș + favorite
  const onAddToCart = async () => {
    if (!product || isOwner || adding) return;
    try {
      setAdding(true);
      if (me) {
        const r = await api(`/api/cart/add`, {
          method: "POST",
          body: { productId: product.id, qty },
        });
        if (r?.error === "cannot_add_own_product") {
          alert("Nu poți adăuga în coș propriul produs.");
          return;
        }
      } else {
        // GUEST: scriem în localStorage
        guestCart.add(product.id, qty);
      }
      try {
        window.dispatchEvent(new CustomEvent("cart:changed"));
      } catch { /* ignore */ }
      alert("Produs adăugat în coș.");
    } catch (e) {
      const msg =
        e?.message ||
        (e?.status === 403
          ? "Nu poți adăuga în coș propriul produs."
          : "Nu am putut adăuga în coș.");
      alert(msg);
    } finally {
      setAdding(false);
    }
  };
  // aici NU mai cerem login — coșul funcționează și ca guest
  const addToCartAny = onAddToCart;

  const isFav = useMemo(
    () => (product ? favorites.has(product.id) : false),
    [favorites, product]
  );

  const toggleFavorite = async () => {
    if (!product || isOwner) return;
    const prev = isFav;
    // optimistic
    setFavorites((set) => {
      const next = new Set(set);
      prev ? next.delete(product.id) : next.add(product.id);
      return next;
    });
    try {
      const r = await api("/api/favorites/toggle", {
        method: "POST",
        body: { productId: product.id },
      });
      if (r?.error === "cannot_favorite_own_product") {
        // revert
        setFavorites((set) => {
          const next = new Set(set);
          prev ? next.add(product.id) : next.delete(product.id);
          return next;
        });
        alert("Nu poți adăuga la favorite un produs care îți aparține.");
      }
    } catch (e) {
      // revert pe eroare
      setFavorites((set) => {
        const next = new Set(set);
        prev ? next.add(product.id) : next.delete(product.id);
        return next;
      });
      const msg =
        e?.message ||
        (e?.status === 403
          ? "Nu poți adăuga la favorite un produs care îți aparține."
          : "Nu am putut actualiza favoritele.");
      alert(msg);
    }
  };
  // Wishlist: cere login (cu alert deja în requireAuth)
  const toggleFavoriteSafe = requireAuth(toggleFavorite);

  const shareIt = async () => {
    try {
      const url = window.location.href;
      if (navigator.share) {
        await navigator.share({ title: product?.title || "Produs", url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        alert("Link copiat în clipboard.");
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          alert("Link copiat în clipboard.");
        } finally {
          document.body.removeChild(ta);
        }
      }
    } catch {
      /* ignore */
    }
  };

  const submitReview = async (e) => {
    e?.preventDefault?.();
    if (isOwner) return;
    if (!me)
      return navigate(
        `/autentificare?redirect=${encodeURIComponent(
          window.location.pathname + window.location.search
        )}`
      );
    if (revRating < 1 || revRating > 5)
      return alert("Alege un rating între 1 și 5.");
    try {
      setSubmittingReview(true);
      await api("/api/reviews", {
        method: "POST",
        body: { productId: product.id, rating: revRating, comment: revText },
      });
      setRevRating(0);
      setRevText("");
      const fresh = await api(
        `/api/public/products/${encodeURIComponent(id)}`
      );
      const fRevs = Array.isArray(fresh?.reviews) ? fresh.reviews : [];
      setReviews(fRevs);
      setAvg({
        average:
          typeof fresh?.averageRating === "number"
            ? fresh.averageRating
            : 0,
        count: fRevs.length || 0,
      });
    } catch (e2) {
      alert(e2?.message || "Nu am putut trimite recenzia.");
    } finally {
      setSubmittingReview(false);
    }
  };

  const submitComment = async (e) => {
    e?.preventDefault?.();
    if (isOwner) return;
    if (!me)
      return navigate(
        `/autentificare?redirect=${encodeURIComponent(
          window.location.pathname + window.location.search
        )}`
      );
    const text = commentText.trim();
    if (!text) return;
    try {
      setSubmittingComment(true);
      await api("/api/comments", {
        method: "POST",
        body: { productId: product.id, text },
      });
      setCommentText("");
      setComments((prev) => [
        ...prev,
        {
          id: `tmp_${Date.now()}`,
          text,
          userName: me?.name || "Tu",
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (e2) {
      alert(e2?.message || "Nu am putut trimite comentariul.");
    } finally {
      setSubmittingComment(false);
    }
  };

  useEffect(() => {
    if (product?.title) {
      document.title = `${product.title} – ${
        product.vendor?.displayName ||
        product?.service?.profile?.displayName ||
        "Magazin"
      }`;
    }
  }, [
    product?.title,
    product?.vendor?.displayName,
    product?.service?.profile?.displayName,
  ]);

  if (loading) return <div className={styles.pageWrap}>Se încarcă…</div>;

  if (error || !product)
    return (
      <div className={styles.pageWrap}>
        <p>{error || "Produsul nu a fost găsit."}</p>
        <button className={styles.linkBtn} onClick={() => navigate(-1)}>
          <FaChevronLeft /> Înapoi
        </button>
      </div>
    );

  const imagesForLd = images.map((u) => resolveFileUrl(u));
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.description,
    image: imagesForLd,
    brand:
      product.vendor?.displayName ||
      product?.service?.profile?.displayName,
    offers: {
      "@type": "Offer",
      priceCurrency: product.currency || "RON",
      price: displayPrice ?? undefined,
      availability: "https://schema.org/InStock",
    },
  };

  return (
    <div className={styles.pageWrap}>
      {/* JSON-LD SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd),
        }}
      />

      {/* Breadcrumbs */}
      <div className={styles.breadcrumbs}>
        <button className={styles.linkBtn} onClick={() => navigate(-1)}>
          <FaChevronLeft /> Înapoi
        </button>
        <span className={styles.sep}>/</span>
        {product?.service?.profile?.slug ? (
          <Link
            className={styles.link}
            to={`/magazin/${product.service.profile.slug}`}
          >
            <FaStore style={{ marginRight: 6 }} />{" "}
            {product.service?.profile?.displayName ||
              product.vendor?.displayName ||
              "Magazin"}
          </Link>
        ) : product?.vendor?.displayName ? (
          <span className={styles.muted}>
            <FaStore style={{ marginRight: 6 }} />{" "}
            {product.vendor?.displayName}
          </span>
        ) : null}
      </div>

      <div className={styles.grid}>
        {/* Gallery */}
        <div className={styles.gallery}>
          <div
            className={styles.mainImgWrap}
            onClick={() => setZoomOpen(true)}
            role="button"
            tabIndex={0}
            aria-label="Deschide imaginea la dimensiune mare"
          >
            <img
              src={activeSrc}
              srcSet={`${withCache(
                resolveFileUrl(images[activeIdx]),
                cacheT
              )} 1000w`}
              sizes="(max-width: 980px) 100vw, 58vw"
              alt={product.title}
              className={styles.mainImg}
              onError={(e) => onImgError(e, 1000, 750, "Produs")}
            />
            {images.length > 1 && (
              <>
                <button
                  className={`${styles.navBtn} ${styles.left}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveIdx(
                      (i) => (i - 1 + images.length) % images.length
                    );
                  }}
                  aria-label="Imaginea anterioară"
                >
                  <FaChevronLeft />
                </button>
                <button
                  className={`${styles.navBtn} ${styles.right}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveIdx((i) => (i + 1) % images.length);
                  }}
                  aria-label="Imaginea următoare"
                >
                  <FaChevronRight />
                </button>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div className={styles.thumbs}>
              {images.map((u, i) => (
                <button
                  key={`${u}-${i}`}
                  className={`${styles.thumb} ${
                    i === activeIdx ? styles.thumbActive : ""
                  }`}
                  onClick={() => setActiveIdx(i)}
                  aria-label={`Miniatură ${i + 1}`}
                >
                  <img
                    loading="lazy"
                    src={withCache(resolveFileUrl(u), cacheT)}
                    alt={`mini-${i}`}
                    onError={(e) => onImgError(e, 160, 120, "Produs")}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className={styles.infoCard}>
          <h1 className={styles.title}>{product.title}</h1>

          {(product.vendor?.displayName ||
            product?.service?.profile?.displayName) && (
            <div className={styles.vendorRow}>
              {product?.service?.profile?.slug ? (
                <Link
                  to={`/magazin/${product.service.profile.slug}`}
                  className={styles.vendorLink}
                >
                  {product.service.profile.displayName ||
                    product.vendor?.displayName}
                </Link>
              ) : (
                <span className={styles.vendorName}>
                  {product.vendor?.displayName}
                </span>
              )}
              {product?.service?.vendor?.city && (
                <span className={styles.vendorCity}>
                  · {product.service.vendor.city}
                </span>
              )}
            </div>
          )}

          {displayPrice != null && (
            <div className={styles.price}>{fmt.format(displayPrice)}</div>
          )}

          {product.description && (
            <p className={styles.desc}>{product.description}</p>
          )}

          <div className={styles.ctaRow}>
            {viewMode === "vendor" ? (
              <p className={styles.muted} style={{ margin: 0 }}>
                Ești proprietarul acestui produs. Acțiunile (coș, favorite,
                recenzii și comentarii) sunt dezactivate.
              </p>
            ) : (
              <>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) =>
                    setQty(
                      Math.max(1, parseInt(e.target.value || "1", 10))
                    )
                  }
                  aria-label="Cantitate"
                  className={styles.qtyInput}
                />
                <button
                  className={styles.primaryBtn}
                  onClick={addToCartAny}
                  disabled={adding}
                  title="Adaugă în coș"
                >
                  <FaShoppingCart />{" "}
                  {adding ? "Se adaugă…" : "Adaugă în coș"}
                </button>
                <button
                  className={`${styles.iconBtn} ${
                    isFav ? styles.heartFilled : ""
                  }`}
                  onClick={toggleFavoriteSafe}
                  aria-pressed={isFav}
                  aria-label={
                    isFav ? "Elimină din favorite" : "Adaugă la favorite"
                  }
                  title={
                    isFav ? "Elimină din favorite" : "Adaugă la favorite"
                  }
                >
                  {isFav ? <FaHeart /> : <FaRegHeart />}
                </button>
              </>
            )}
            <button
              className={styles.iconBtn}
              onClick={shareIt}
              aria-label="Distribuie"
              title="Distribuie"
            >
              <FaShareAlt />
            </button>
          </div>

          {/* Mini card magazin */}
          <div className={styles.shopCard}>
            <div className={styles.shopAvatarWrap}>
              <img
                src={
                  product.service?.profile?.logoUrl
                    ? withCache(
                        resolveFileUrl(product.service.profile.logoUrl),
                        cacheT
                      )
                    : product.vendor?.logoUrl
                    ? withCache(resolveFileUrl(product.vendor.logoUrl), cacheT)
                    : avatarPlaceholder(64, "Magazin")
                }
                alt={
                  product.service?.profile?.displayName ||
                  product.vendor?.displayName ||
                  "Magazin"
                }
                className={styles.shopAvatar}
                onError={(e) => onImgError(e, 64, 64, "Magazin")}
              />
            </div>
            <div className={styles.shopMeta}>
              <div className={styles.shopNameRow}>
                {product?.service?.profile?.slug ? (
                  <Link
                    to={`/magazin/${product.service.profile.slug}`}
                    className={styles.vendorLink}
                  >
                    {product.service.profile.displayName ||
                      product.vendor?.displayName}
                  </Link>
                ) : (
                  <span className={styles.vendorName}>
                    {product.service?.profile?.displayName ||
                      product.vendor?.displayName}
                  </span>
                )}
              </div>
              {product?.service?.vendor?.city && (
                <div className={styles.shopCity}>
                  {product.service.vendor.city}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Produse similare */}
      <section className={styles.relatedSec}>
        <h2 className={styles.sectionTitle}>Mai multe din acest magazin</h2>
        <div className={styles.relatedGrid}>
          {related.length === 0 ? (
            <div className={styles.emptyBox}>Nu sunt produse similare.</div>
          ) : (
            related.map((p) => {
              const img =
                Array.isArray(p.images) && p.images[0]
                  ? withCache(resolveFileUrl(p.images[0]), cacheT)
                  : productPlaceholder(480, 360, "Produs");
              const price =
                typeof p.price === "number"
                  ? p.price
                  : Number.isFinite(p.priceCents)
                  ? p.priceCents / 100
                  : null;
              return (
                <button
                  key={p.id}
                  className={styles.relatedCard}
                  onMouseEnter={() =>
                    api(`/api/public/products/${encodeURIComponent(p.id)}`).catch(
                      () => {}
                    )
                  }
                  onClick={() => navigate(`/produs/${p.id}`)}
                  aria-label={`Vezi ${p.title}`}
                >
                  <img
                    loading="lazy"
                    src={img}
                    alt={p.title}
                    onError={(e) => onImgError(e, 480, 360, "Produs")}
                  />
                  <div className={styles.relBody}>
                    <div className={styles.relTitle}>{p.title}</div>
                    {price != null && (
                      <div className={styles.relPrice}>
                        {new Intl.NumberFormat("ro-RO", {
                          style: "currency",
                          currency: p.currency || "RON",
                        }).format(price)}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* Recenzii */}
      <ReviewsSection
        avg={avg}
        reviews={reviews}
        isOwner={isOwner}
        isLoggedIn={!!me}
        onSubmit={submitReview}
        submitting={submittingReview}
        revRating={revRating}
        setRevRating={setRevRating}
        revText={revText}
        setRevText={setRevText}
      />

      {/* Comentarii */}
      <CommentsSection
        comments={comments}
        isOwner={isOwner}
        isLoggedIn={!!me}
        onSubmit={submitComment}
        submitting={submittingComment}
        commentText={commentText}
        setCommentText={setCommentText}
      />

      {/* Zoom modal simplu */}
      {zoomOpen && (
        <div
          className={styles.zoomBackdrop}
          onClick={() => setZoomOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.zoomInner}
            onClick={(e) => e.stopPropagation()}
          >
            <img src={activeSrc} alt="Zoom" className={styles.zoomImg} />
            {images.length > 1 && (
              <div className={styles.zoomNav}>
                <button
                  onClick={() =>
                    setActiveIdx((i) => (i - 1 + images.length) % images.length)
                  }
                  aria-label="Imaginea anterioară"
                >
                  <FaChevronLeft />
                </button>
                <button
                  onClick={() => setActiveIdx((i) => (i + 1) % images.length)}
                  aria-label="Imaginea următoare"
                >
                  <FaChevronRight />
                </button>
              </div>
            )}
            <button
              className={styles.zoomClose}
              onClick={() => setZoomOpen(false)}
              aria-label="Închide"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
