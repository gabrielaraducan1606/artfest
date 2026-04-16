import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../../../lib/api.js";
import styles from "./ProductDetails.module.css";
import {
  FaChevronLeft,
  FaChevronDown,
  FaShareAlt,
  FaShoppingCart,
  FaHeart,
  FaRegHeart,
  FaStore,
  FaEdit,
} from "react-icons/fa";
import {
  productPlaceholder,
  avatarPlaceholder,
  onImgError,
} from "../../../components/utils/imageFallback.js";

import { useIsMobile } from "./hooks/useIsMobile.js";
import { ProductGallery } from "./components/ProductGallery.jsx";
import DetailsContent from "./components/DetailsContent.jsx";
import { getHasStructuredDetails } from "./hooks/detailsUtils.js";
import { resolveFileUrl, withCache } from "./hooks/urlUtils.js";

const ReviewsSection = lazy(() => import("./ReviewSection/ReviewSection"));
const CommentsSection = lazy(() => import("./CommentSection/CommentSection"));
const ProductModal = lazy(() =>
  import("../ProfilMagazin/modals/ProductModal.jsx")
);

const StoreProductsSlider = lazy(() =>
  import("./components/StoreProductsSlider.jsx").then((m) => ({
    default: m.StoreProductsSlider,
  }))
);

const SimilarProductsGrid = lazy(() =>
  import("./components/SimilarProductsGrid.jsx").then((m) => ({
    default: m.SimilarProductsGrid,
  }))
);

const ImageZoom = lazy(() =>
  import("./components/ImageZoom.jsx").then((m) => ({
    default: m.ImageZoom,
  }))
);

const dateOnlyToISO = (yyyyMmDd) => {
  if (!yyyyMmDd) return null;
  const [y, m, d] = String(yyyyMmDd).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  return dt.toISOString();
};

const emptyProdForm = {
  id: "",
  title: "",
  description: "",
  price: 0,
  images: [],
  category: "",
  currency: "RON",
  isActive: true,

  availability: "READY",
  leadTimeDays: "",
  readyQty: "",
  nextShipDate: "",
  acceptsCustom: false,
  isHidden: false,

  color: "",
  materialMain: "",
  technique: "",
  styleTags: "",
  occasionTags: "",
  dimensions: "",
  careInstructions: "",
  specialNotes: "",
};

function ProductDetailsSkeleton() {
  return (
    <div className={styles.pageWrap}>
      <div className={styles.breadcrumbs}>
        <button className={styles.linkBtn} type="button" disabled>
          <FaChevronLeft /> Înapoi
        </button>
      </div>

      <div className={styles.grid}>
        <div
          style={{
            width: "100%",
            aspectRatio: "4 / 3",
            borderRadius: 16,
            background: "rgba(255,255,255,0.06)",
          }}
        />

        <div className={styles.infoCard}>
          <div
            style={{
              height: 34,
              width: "70%",
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              marginBottom: 12,
            }}
          />
          <div
            style={{
              height: 18,
              width: "40%",
              borderRadius: 10,
              background: "rgba(255,255,255,0.05)",
              marginBottom: 18,
            }}
          />
          <div
            style={{
              height: 28,
              width: 120,
              borderRadius: 10,
              background: "rgba(255,255,255,0.08)",
              marginBottom: 18,
            }}
          />
          <div
            style={{
              height: 44,
              width: "100%",
              borderRadius: 12,
              background: "rgba(255,255,255,0.05)",
              marginBottom: 12,
            }}
          />
          <div
            style={{
              height: 110,
              width: "100%",
              borderRadius: 14,
              background: "rgba(255,255,255,0.04)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [me, setMe] = useState(null);
  const [favorites, setFavorites] = useState(() => new Set());
  const [product, setProduct] = useState(null);

  const [storeProducts, setStoreProducts] = useState([]);
  const [similarProducts, setSimilarProducts] = useState([]);

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
  const [editingCommentId, setEditingCommentId] = useState(null);

  const [openAccordions, setOpenAccordions] = useState({
    details: false,
    reviews: false,
    comments: false,
  });

  const [activeMobileTab, setActiveMobileTab] = useState("descriere");
  const isMobile = useIsMobile(768);

  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [prodForm, setProdForm] = useState(emptyProdForm);
  const [savingProd, setSavingProd] = useState(false);
  const [categories, setCategories] = useState([]);

  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [deferredSections, setDeferredSections] = useState(false);

  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);

  const touchStartX = useRef(null);
  const touchEndX = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setActiveIdx(0);
    setQty(1);
    setZoomOpen(false);

    setEditOpen(false);
    setEditingProduct(null);
    setProdForm(emptyProdForm);

    setComments([]);
    setCommentText("");
    setEditingCommentId(null);

    setReviews([]);
    setAvg({ average: 0, count: 0 });

    setStoreProducts([]);
    setSimilarProducts([]);

    setReviewsLoaded(false);
    setCommentsLoaded(false);
    setDeferredSections(false);
  }, [id]);

  const cacheT = useMemo(() => {
    if (!product?.updatedAt) return "1";
    return String(new Date(product.updatedAt).getTime());
  }, [product?.updatedAt]);

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
    () => withCache(resolveFileUrl(images[activeIdx] || images[0]), cacheT),
    [images, activeIdx, cacheT]
  );

  useEffect(() => {
    if (!activeSrc) return;

    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = activeSrc;
    document.head.appendChild(link);

    return () => {
      try {
        document.head.removeChild(link);
      } catch {
        /* ignore */
      }
    };
  }, [activeSrc]);

  useEffect(() => {
    const next = images[(activeIdx + 1) % images.length];
    if (!next) return;

    const img = new Image();
    img.decoding = "async";
    img.src = withCache(resolveFileUrl(next), cacheT);
  }, [activeIdx, images, cacheT]);

  const displayPrice = useMemo(() => {
    if (typeof product?.price === "number") return product.price;
    if (Number.isFinite(product?.priceCents)) return product.priceCents / 100;
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

  const priceInfo = useMemo(() => {
    if (!product || displayPrice == null) return null;
    return "TVA inclus în preț.";
  }, [product, displayPrice]);

  const availabilityText = useMemo(() => {
    if (!product?.availability) return null;

    switch (product.availability) {
      case "READY":
        if (typeof product.readyQty === "number") {
          if (product.readyQty > 0) {
            return `În stoc (${product.readyQty} bucăți disponibile).`;
          }
          return "În stoc, dar stoc foarte limitat.";
        }
        return "În stoc, gata de livrare.";

      case "MADE_TO_ORDER":
        return product.leadTimeDays
          ? `Realizat la comandă, timpul de execuție este de aproximativ ${product.leadTimeDays} zile.`
          : "Realizat la comandă, timpul de execuție este comunicat după plasarea comenzii.";

      case "PREORDER":
        return product.nextShipDate
          ? `Disponibil la precomandă, livrare estimată începând cu ${new Date(
              product.nextShipDate
            ).toLocaleDateString("ro-RO")}.`
          : "Disponibil la precomandă.";

      case "SOLD_OUT":
        return "Stoc epuizat momentan.";

      default:
        return null;
    }
  }, [product]);

  const isSoldOut = product?.availability === "SOLD_OUT";

  const myVendorId = me?.vendor?.id ?? null;
  const myUserId = me?.id ?? me?.sub ?? null;

  const ownerVendorId =
    product?.service?.vendor?.id ??
    product?.vendor?.id ??
    product?.ownerVendorId ??
    null;

  const ownerUserId =
    product?.service?.vendor?.userId ?? product?.vendor?.userId ?? null;

  const isOwner = useMemo(() => {
    const byVendor =
      !!myVendorId && !!ownerVendorId && myVendorId === ownerVendorId;
    const byUser = !!myUserId && !!ownerUserId && myUserId === ownerUserId;
    return byVendor || byUser;
  }, [myVendorId, myUserId, ownerVendorId, ownerUserId]);

  const viewMode = isOwner ? "vendor" : me ? "user" : "guest";

  const requireAuth = useCallback(
    (fn) => (...args) => {
      if (!me) {
        alert(
          "Pentru a salva produsele tale preferate și a putea reveni la ele oricând, te rugăm să te autentifici. Te așteptăm cu drag, durează doar câteva secunde! 💛"
        );
        const redir = encodeURIComponent(
          window.location.pathname + window.location.search
        );
        navigate(`/autentificare?redirect=${redir}`);
        return;
      }
      return fn(...args);
    },
    [me, navigate]
  );

  const onAddToCart = useCallback(async () => {
    if (!product || isOwner || adding || isSoldOut) return;

    if (!me) {
      alert(
        "Majoritatea produselor pot fi personalizate, iar pentru a putea vorbi cu artizanul și salva preferințele tale, este nevoie să te autentifici. Te așteptăm cu drag, durează doar câteva secunde! ✨"
      );

      const redir = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      navigate(`/autentificare?redirect=${redir}`);
      return;
    }

    try {
      setAdding(true);

      const r = await api(`/api/cart/add`, {
        method: "POST",
        body: { productId: product.id, qty },
      });

      if (r?.error === "cannot_add_own_product") {
        alert("Nu poți adăuga în coș propriul produs.");
        return;
      }

      try {
        window.dispatchEvent(new CustomEvent("cart:changed"));
      } catch {
        /* ignore */
      }

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
  }, [product, isOwner, adding, isSoldOut, me, navigate, qty]);

  const addToCartAny = onAddToCart;

  const isFav = useMemo(
    () => (product ? favorites.has(product.id) : false),
    [favorites, product]
  );

  const toggleFavorite = useCallback(async () => {
    if (!product || isOwner) return;

    const prev = isFav;

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
        setFavorites((set) => {
          const next = new Set(set);
          prev ? next.add(product.id) : next.delete(product.id);
          return next;
        });
        alert("Nu poți adăuga la favorite un produs care îți aparține.");
      }
    } catch (e) {
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
  }, [product, isOwner, isFav]);

  const toggleFavoriteSafe = requireAuth(toggleFavorite);

  const shareIt = useCallback(async () => {
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
    } catch (e) {
      console.error(e);
      alert("Nu am putut copia linkul.");
    }
  }, [product?.title]);

  const loadReviewsForProduct = useCallback(async (prodId) => {
    try {
      const [list, stats] = await Promise.all([
        api(
          `/api/public/product/${encodeURIComponent(
            prodId
          )}/reviews?sort=recent&skip=0&take=50`
        ),
        api(
          `/api/public/product/${encodeURIComponent(
            prodId
          )}/reviews/average`
        ),
      ]);

      const items = Array.isArray(list?.items) ? list.items : [];

      if (!mountedRef.current) return;

      setReviews(items);
      setAvg({
        average: typeof stats?.average === "number" ? stats.average : 0,
        count: typeof stats?.count === "number" ? stats.count : items.length,
      });
    } catch {
      if (!mountedRef.current) return;
      setReviews([]);
      setAvg({ average: 0, count: 0 });
    }
  }, []);

  const loadCommentsForProduct = useCallback(async (prodId) => {
    try {
      const res = await api(
        `/api/public/product/${encodeURIComponent(
          prodId
        )}/comments?skip=0&take=50`
      );

      const items = Array.isArray(res?.items) ? res.items : [];
      if (!mountedRef.current) return;

      setComments(items);
    } catch (e) {
      console.error("loadCommentsForProduct error", e);
      if (!mountedRef.current) return;
      setComments([]);
    }
  }, []);

  const loadStoreProducts = useCallback(async (p) => {
    if (!p?.service?.profile?.slug) {
      if (mountedRef.current) setStoreProducts([]);
      return;
    }

    try {
      const items = await api(
        `/api/public/store/${encodeURIComponent(p.service.profile.slug)}/products`
      );

      if (!mountedRef.current) return;

      const list = Array.isArray(items) ? items : [];
      setStoreProducts(list.filter((x) => x.id !== p.id));
    } catch {
      if (mountedRef.current) setStoreProducts([]);
    }
  }, []);

  const loadSimilarProducts = useCallback(async (p) => {
    try {
      const params = new URLSearchParams();
      params.set("limit", "48");
      params.set("sort", "popular");
      if (p.category) params.set("category", p.category);
      if (p.color) params.set("color", p.color);

      const res = await api(`/api/public/products?${params.toString()}`);
      if (!mountedRef.current) return;

      const items = Array.isArray(res?.items) ? res.items : [];
      const baseList = items.filter((it) => it.id !== p.id);

      const same = (a, b) =>
        a && b && String(a).toLowerCase() === String(b).toLowerCase();

      const splitTags = (v) =>
        String(v || "")
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);

      const productStyleTags = splitTags(p.styleTags);
      const productOccasionTags = splitTags(p.occasionTags);

      let strict = baseList.filter((it) => same(it.category, p.category));

      if (p.color) {
        strict = strict.filter((it) => same(it.color, p.color));
      }

      if (productStyleTags.length) {
        strict = strict.filter((it) => {
          const itsTags = splitTags(it.styleTags);
          return itsTags.some((tag) => productStyleTags.includes(tag));
        });
      }

      if (productOccasionTags.length) {
        strict = strict.filter((it) => {
          const itsTags = splitTags(it.occasionTags);
          return itsTags.some((tag) => productOccasionTags.includes(tag));
        });
      }

      let finalList = strict;

      if (finalList.length < 4) {
        finalList = baseList.filter((it) => same(it.category, p.category));
      }

      if (finalList.length < 4) {
        finalList = baseList;
      }

      setSimilarProducts(finalList.slice(0, 12));
    } catch {
      if (mountedRef.current) setSimilarProducts([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    const seq = ++requestSeqRef.current;

    setLoading(true);
    setError(null);

    try {
      const [productRes, meRes, favRes] = await Promise.allSettled([
        api(`/api/public/products/${encodeURIComponent(id)}`),
        api("/api/auth/me"),
        api("/api/favorites/ids"),
      ]);

      if (!mountedRef.current || requestSeqRef.current !== seq) return;

      if (productRes.status !== "fulfilled") {
        throw productRes.reason;
      }

      const p = productRes.value;
      setProduct(p);

      const user =
        meRes.status === "fulfilled" ? meRes.value?.user || null : null;
      setMe(user);

      const favItems =
        favRes.status === "fulfilled" && Array.isArray(favRes.value?.items)
          ? favRes.value.items
          : [];
      setFavorites(new Set(favItems));

      setLoading(false);
    } catch (e) {
      if (!mountedRef.current || requestSeqRef.current !== seq) return;
      setError(e?.message || "Nu am putut încărca produsul.");
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!product) return;

    const run = () => {
      if (!mountedRef.current) return;
      setDeferredSections(true);
    };

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(run, { timeout: 700 });
      return () => {
        if ("cancelIdleCallback" in window) {
          window.cancelIdleCallback(idleId);
        }
      };
    }

    const t = setTimeout(run, 100);
    return () => clearTimeout(t);
  }, [product]);

  useEffect(() => {
    if (!product || !deferredSections) return;
    loadStoreProducts(product);
    loadSimilarProducts(product);
  }, [product, deferredSections, loadStoreProducts, loadSimilarProducts]);

  useEffect(() => {
    if (!product?.id || reviewsLoaded) return;

    if (isMobile) {
      if (activeMobileTab !== "recenzii") return;
    } else {
      if (!openAccordions.reviews) return;
    }

    setReviewsLoaded(true);
    loadReviewsForProduct(product.id);
  }, [
    product?.id,
    reviewsLoaded,
    isMobile,
    activeMobileTab,
    openAccordions.reviews,
    loadReviewsForProduct,
  ]);

  useEffect(() => {
    if (!product?.id || commentsLoaded) return;

    if (isMobile) {
      if (activeMobileTab !== "intrebari") return;
    } else {
      if (!openAccordions.comments) return;
    }

    setCommentsLoaded(true);
    loadCommentsForProduct(product.id);
  }, [
    product?.id,
    commentsLoaded,
    isMobile,
    activeMobileTab,
    openAccordions.comments,
    loadCommentsForProduct,
  ]);

  const submitReview = useCallback(
    async ({ rating, comment, images: reviewImages }) => {
      if (isOwner) return;

      if (!me) {
        return navigate(
          `/autentificare?redirect=${encodeURIComponent(
            window.location.pathname + window.location.search
          )}`
        );
      }

      if (rating < 1 || rating > 5) {
        alert("Alege un rating între 1 și 5.");
        return;
      }

      try {
        setSubmittingReview(true);

        const form = new FormData();
        form.append("productId", product.id);
        form.append("rating", String(rating));
        form.append("comment", comment || "");

        (reviewImages || []).forEach((file) => {
          form.append("images", file);
        });

        const res = await fetch("/api/reviews", {
          method: "POST",
          body: form,
        });

        if (!res.ok) {
          let msg = "Nu am putut trimite recenzia.";
          try {
            const err = await res.json();
            if (err?.error === "rate_limited") {
              msg =
                "Ai atins limita de recenzii. Poți trimite maximum 10 recenzii la 24 de ore.";
            } else if (err?.error === "cannot_review_own_product") {
              msg = "Nu poți lăsa recenzie pentru propriul produs.";
            }
          } catch {
            /* ignore */
          }
          alert(msg);
          return;
        }

        setRevRating(0);
        setRevText("");
        setReviewsLoaded(true);
        await loadReviewsForProduct(product.id);
      } catch (e2) {
        alert(e2?.message || "Nu am putut trimite recenzia.");
      } finally {
        setSubmittingReview(false);
      }
    },
    [isOwner, me, navigate, product?.id, loadReviewsForProduct]
  );

  const startEditComment = useCallback((comment) => {
    setEditingCommentId(comment.id);
    setCommentText(comment.text || "");

    const formTextarea = document.querySelector(
      "#tab-intrebari textarea, .commentsSection textarea"
    );

    if (formTextarea) {
      formTextarea.scrollIntoView({ behavior: "smooth", block: "start" });
      formTextarea.focus();
    }
  }, []);

  const cancelEditComment = useCallback(() => {
    setEditingCommentId(null);
    setCommentText("");
  }, []);

  const submitComment = useCallback(
    async (e) => {
      e?.preventDefault?.();

      if (isOwner && !editingCommentId) return;

      if (!me) {
        return navigate(
          `/autentificare?redirect=${encodeURIComponent(
            window.location.pathname + window.location.search
          )}`
        );
      }

      const text = commentText.trim();
      if (!text) return;

      try {
        setSubmittingComment(true);

        if (editingCommentId) {
          await api(`/api/comments/${encodeURIComponent(editingCommentId)}`, {
            method: "PATCH",
            body: { text },
          });
          setEditingCommentId(null);
          setCommentText("");
        } else {
          await api("/api/comments", {
            method: "POST",
            body: { productId: product.id, text },
          });
          setCommentText("");
        }

        setCommentsLoaded(true);
        await loadCommentsForProduct(product.id);
      } catch (e2) {
        alert(e2?.message || "Nu am putut trimite comentariul.");
      } finally {
        setSubmittingComment(false);
      }
    },
    [
      isOwner,
      editingCommentId,
      me,
      navigate,
      commentText,
      product?.id,
      loadCommentsForProduct,
    ]
  );

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

  const hasDescription =
    typeof product?.description === "string" &&
    product.description.trim().length > 0;

  const imagesForLd = useMemo(
    () => images.map((u) => resolveFileUrl(u)),
    [images]
  );

  const schemaAvailability = useMemo(() => {
    switch (product?.availability) {
      case "READY":
        return "https://schema.org/InStock";
      case "MADE_TO_ORDER":
        return "https://schema.org/PreOrder";
      case "PREORDER":
        return "https://schema.org/PreOrder";
      case "SOLD_OUT":
        return "https://schema.org/OutOfStock";
      default:
        return "https://schema.org/InStock";
    }
  }, [product?.availability]);

  const displayPriceForLd = displayPrice ?? undefined;

  const jsonLd = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@type": "Product",
      name: product?.title || "",
      description: product?.description || "",
      image: imagesForLd,
      brand:
        product?.vendor?.displayName ||
        product?.service?.profile?.displayName ||
        "",
      offers: {
        "@type": "Offer",
        priceCurrency: product?.currency || "RON",
        price: displayPriceForLd,
        availability: schemaAvailability,
      },
    }),
    [product, imagesForLd, displayPriceForLd, schemaAvailability]
  );

  const onTouchStart = useCallback((e) => {
    if (!e.touches || e.touches.length === 0) return;
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!e.touches || e.touches.length === 0) return;
    touchEndX.current = e.touches[0].clientX;
  }, []);

  const onTouchEnd = useCallback(() => {
    if (
      touchStartX.current == null ||
      touchEndX.current == null ||
      images.length <= 1
    ) {
      touchStartX.current = null;
      touchEndX.current = null;
      return;
    }

    const diff = touchStartX.current - touchEndX.current;
    const threshold = 40;

    if (Math.abs(diff) > threshold) {
      if (diff > 0) {
        setActiveIdx((i) => (i + 1) % images.length);
      } else {
        setActiveIdx((i) => (i - 1 + images.length) % images.length);
      }
    }

    touchStartX.current = null;
    touchEndX.current = null;
  }, [images.length]);

  const toggleAccordion = useCallback((key) => {
    setOpenAccordions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const ensureCategories = useCallback(async () => {
    if (categories.length) return;

    try {
      const c = await api("/api/public/categories/detailed").catch(() => []);
      if (!mountedRef.current) return;
      setCategories(Array.isArray(c) ? c : []);
    } catch {
      if (mountedRef.current) setCategories([]);
    }
  }, [categories.length]);

  const uploadFile = useCallback(async (f) => {
    const fd = new FormData();
    fd.append("file", f);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: fd,
    });

    if (!res.ok) throw new Error("Upload eșuat");

    const { url } = await res.json();
    return url;
  }, []);

  const openEditModal = useCallback(async () => {
    if (!product?.id) return;

    try {
      await ensureCategories();

      const full = await api(
        `/api/vendors/products/${encodeURIComponent(product.id)}`
      );

      if (!mountedRef.current) return;

      setEditingProduct(full);

      const price =
        typeof full?.price === "number"
          ? full.price
          : Number.isFinite(full?.priceCents)
          ? full.priceCents / 100
          : 0;

      setProdForm({
        id: full.id || full._id || "",
        title: full.title || "",
        description: full.description || "",
        price,
        images: Array.isArray(full.images) ? full.images : [],
        category: full.category || "",
        currency: full.currency || "RON",
        isActive: full.isActive !== false,

        availability: (full.availability || "READY").toUpperCase(),
        leadTimeDays: Number.isFinite(Number(full.leadTimeDays))
          ? String(Number(full.leadTimeDays))
          : "",
        readyQty:
          full.readyQty === null || full.readyQty === undefined
            ? ""
            : Number.isFinite(Number(full.readyQty))
            ? String(Number(full.readyQty))
            : "",
        nextShipDate: full.nextShipDate
          ? String(full.nextShipDate).slice(0, 10)
          : "",
        acceptsCustom: !!full.acceptsCustom,
        isHidden: !!full.isHidden,

        color: full.color || "",
        materialMain: full.materialMain || "",
        technique: full.technique || "",
        styleTags: Array.isArray(full.styleTags)
          ? full.styleTags.join(", ")
          : full.styleTags || "",
        occasionTags: Array.isArray(full.occasionTags)
          ? full.occasionTags.join(", ")
          : full.occasionTags || "",
        dimensions: full.dimensions || "",
        careInstructions: full.careInstructions || "",
        specialNotes: full.specialNotes || "",
      });

      setEditOpen(true);
    } catch (e) {
      alert(e?.message || "Nu am putut încărca produsul pentru editare.");
    }
  }, [product?.id, ensureCategories]);

  const handleSaveProduct = useCallback(
    async (e) => {
      e?.preventDefault?.();

      if (!editingProduct || !prodForm.id) {
        alert("Nu am găsit produsul pentru salvare.");
        return;
      }

      try {
        setSavingProd(true);

        const title = (prodForm.title || "").trim();
        const description = prodForm.description || "";
        const price = Number(prodForm.price);
        const imagesArr = Array.isArray(prodForm.images) ? prodForm.images : [];
        const category = (prodForm.category || "").trim();

        const color = (prodForm.color || "").trim() || null;
        const materialMain = (prodForm.materialMain || "").trim() || null;
        const technique = (prodForm.technique || "").trim() || null;
        const styleTags = (prodForm.styleTags || "").trim();
        const occasionTags = (prodForm.occasionTags || "").trim();
        const dimensions = (prodForm.dimensions || "").trim() || null;
        const careInstructions =
          (prodForm.careInstructions || "").trim() || null;
        const specialNotes = (prodForm.specialNotes || "").trim() || null;

        if (!title) {
          alert("Te rog adaugă un titlu.");
          setSavingProd(false);
          return;
        }

        if (!Number.isFinite(price) || price < 0) {
          alert("Preț invalid.");
          setSavingProd(false);
          return;
        }

        if (!category) {
          alert("Selectează categoria produsului.");
          setSavingProd(false);
          return;
        }

        const basePayload = {
          title,
          description,
          price,
          images: imagesArr,
          category,
          currency: prodForm.currency || "RON",
          isActive: prodForm.isActive !== false,
          isHidden: !!prodForm.isHidden,
          acceptsCustom: !!prodForm.acceptsCustom,
          color,
          materialMain,
          technique,
          styleTags,
          occasionTags,
          dimensions,
          careInstructions,
          specialNotes,
        };

        const av = String(prodForm.availability || "READY").toUpperCase();

        const payload = {
          ...basePayload,
          availability: av,
          leadTimeDays: null,
          readyQty: null,
          nextShipDate: null,
        };

        if (av === "MADE_TO_ORDER") {
          const lt = Number(prodForm.leadTimeDays || 0);
          payload.leadTimeDays = Number.isFinite(lt) && lt > 0 ? lt : 1;
        }

        if (av === "READY") {
          if (prodForm.readyQty !== "" && prodForm.readyQty != null) {
            const rq = Number(prodForm.readyQty);
            payload.readyQty = Number.isFinite(rq) && rq >= 0 ? rq : 0;
          } else {
            payload.readyQty = null;
          }
        }

        if (av === "PREORDER") {
          payload.nextShipDate = prodForm.nextShipDate
            ? dateOnlyToISO(prodForm.nextShipDate)
            : null;
        }

        if (av === "SOLD_OUT") {
          payload.readyQty = 0;
        }

        const pid = editingProduct.id || editingProduct._id;

        const saved = await api(
          `/api/vendors/products/${encodeURIComponent(pid)}`,
          {
            method: "PUT",
            body: payload,
          }
        );

        try {
          window.dispatchEvent(
            new CustomEvent("vendor:productUpdated", {
              detail: { product: saved },
            })
          );
        } catch {
          /* noop */
        }

        setProduct((prev) => ({ ...(prev || {}), ...(saved || {}) }));

        setEditOpen(false);
        setEditingProduct(null);
      } catch (er) {
        alert(er?.message || "Nu am putut salva produsul.");
      } finally {
        setSavingProd(false);
      }
    },
    [editingProduct, prodForm]
  );

  const hasStructuredDetails = getHasStructuredDetails(
    product,
    availabilityText
  );

  if (loading) {
    return <ProductDetailsSkeleton />;
  }

  if (error || !product) {
    return (
      <div className={styles.pageWrap}>
        <p>{error || "Produsul nu a fost găsit."}</p>
        <button
          className={styles.linkBtn}
          onClick={() => navigate(-1)}
          type="button"
        >
          <FaChevronLeft /> Înapoi
        </button>
      </div>
    );
  }

  return (
    <div className={styles.pageWrap}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className={styles.breadcrumbs}>
        <button
          className={styles.linkBtn}
          onClick={() => navigate(-1)}
          type="button"
        >
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
            <FaStore style={{ marginRight: 6 }} /> {product.vendor?.displayName}
          </span>
        ) : null}
      </div>

      <div className={styles.grid}>
        <ProductGallery
          productTitle={product.title}
          images={images}
          activeIdx={activeIdx}
          setActiveIdx={setActiveIdx}
          activeSrc={activeSrc}
          cacheT={cacheT}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          setZoomOpen={setZoomOpen}
        />

        <div className={styles.infoCard}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{product.title}</h1>
          </div>

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
            <>
              <div className={styles.price}>{fmt.format(displayPrice)}</div>
              {priceInfo && (
                <div className={styles.priceInfo}>{priceInfo}</div>
              )}
            </>
          )}

          {isOwner && (
            <p className={styles.ownerNote}>
              Ești proprietarul acestui produs.
            </p>
          )}

          {product.availability && (
            <div className={styles.availabilityRow}>
              {product.availability === "READY" && (
                <span className={styles.badgeReady}>
                  {typeof product.readyQty === "number" && product.readyQty > 0
                    ? `În stoc (${product.readyQty} buc.)`
                    : "În stoc"}
                </span>
              )}

              {product.availability === "MADE_TO_ORDER" && (
                <span className={styles.badgeMto}>
                  Realizat la comandă
                  {product.leadTimeDays ? ` · ${product.leadTimeDays} zile` : ""}
                </span>
              )}

              {product.availability === "PREORDER" && (
                <span className={styles.badgePreorder}>
                  Precomandă
                  {product.nextShipDate
                    ? ` · livrare din ${new Date(
                        product.nextShipDate
                      ).toLocaleDateString("ro-RO")}`
                    : ""}
                </span>
              )}

              {product.availability === "SOLD_OUT" && (
                <span className={styles.badgeSoldOut}>Stoc epuizat</span>
              )}

              {product.acceptsCustom && (
                <span className={styles.badgeCustom}>
                  Acceptă comenzi personalizate
                </span>
              )}
            </div>
          )}

          {product.color && (
            <div className={styles.colorRow}>
              Culoare principală:{" "}
              <span className={styles.colorValue}>{product.color}</span>
            </div>
          )}

          {hasDescription && (
            <div className={styles.inlineDetailsBox}>
              <h2 className={styles.inlineBoxTitle}>Descriere produs</h2>
              <p className={styles.inlineDescription}>{product.description}</p>
            </div>
          )}

          <div className={styles.ctaRow}>
            {viewMode !== "vendor" && (
              <>
                <button
                  className={styles.primaryBtn}
                  onClick={addToCartAny}
                  disabled={adding || isSoldOut}
                  title={
                    isSoldOut
                      ? "Produs indisponibil momentan"
                      : "Adaugă în coș"
                  }
                  type="button"
                >
                  <FaShoppingCart />{" "}
                  {isSoldOut
                    ? "Stoc epuizat"
                    : adding
                    ? "Se adaugă…"
                    : "Adaugă în coș"}
                </button>

                <div className={styles.qtyRow}>
                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() =>
                      setQty((q) => Math.max(1, Math.min(999, q - 1)))
                    }
                    aria-label="Scade cantitatea"
                  >
                    −
                  </button>

                  <input
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(e) =>
                      setQty(
                        Math.max(
                          1,
                          Math.min(999, parseInt(e.target.value || "1", 10))
                        )
                      )
                    }
                    aria-label="Cantitate"
                    className={styles.qtyInput}
                  />

                  <button
                    type="button"
                    className={styles.qtyBtn}
                    onClick={() =>
                      setQty((q) => Math.max(1, Math.min(999, q + 1)))
                    }
                    aria-label="Crește cantitatea"
                  >
                    +
                  </button>
                </div>

                <button
                  className={`${styles.iconBtn} ${
                    isFav ? styles.heartFilled : ""
                  }`}
                  onClick={toggleFavoriteSafe}
                  aria-pressed={isFav}
                  aria-label={
                    isFav ? "Elimină din favorite" : "Adaugă la favorite"
                  }
                  title={isFav ? "Elimină din favorite" : "Adaugă la favorite"}
                  type="button"
                >
                  {isFav ? <FaHeart /> : <FaRegHeart />}
                </button>
              </>
            )}

            <div className={styles.ctaIconGroup}>
              <button
                className={styles.iconBtn}
                onClick={shareIt}
                aria-label="Distribuie"
                title="Distribuie"
                type="button"
              >
                <FaShareAlt />
              </button>

              {isOwner && (
                <button
                  type="button"
                  className={`${styles.iconBtn} ${styles.editIconBtn}`}
                  onClick={openEditModal}
                  disabled={savingProd}
                  aria-label="Editează produsul"
                  title="Editează produsul"
                >
                  <FaEdit />
                </button>
              )}
            </div>
          </div>

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
                loading="lazy"
                decoding="async"
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

          {isMobile && (
            <>
              <div
                className={styles.mobileTabs}
                aria-label="Secțiuni produs"
                role="tablist"
              >
                <button
                  type="button"
                  className={`${styles.mobileTab} ${
                    activeMobileTab === "descriere"
                      ? styles.mobileTabActive
                      : ""
                  }`}
                  onClick={() => setActiveMobileTab("descriere")}
                  role="tab"
                  aria-selected={activeMobileTab === "descriere"}
                  aria-controls="tab-descriere"
                >
                  Descriere
                </button>

                {hasStructuredDetails && (
                  <button
                    type="button"
                    className={`${styles.mobileTab} ${
                      activeMobileTab === "detalii"
                        ? styles.mobileTabActive
                        : ""
                    }`}
                    onClick={() => setActiveMobileTab("detalii")}
                    role="tab"
                    aria-selected={activeMobileTab === "detalii"}
                    aria-controls="tab-detalii"
                  >
                    Detalii
                  </button>
                )}

                <button
                  type="button"
                  className={`${styles.mobileTab} ${
                    activeMobileTab === "recenzii"
                      ? styles.mobileTabActive
                      : ""
                  }`}
                  onClick={() => setActiveMobileTab("recenzii")}
                  role="tab"
                  aria-selected={activeMobileTab === "recenzii"}
                  aria-controls="tab-recenzii"
                >
                  Recenzii
                </button>

                <button
                  type="button"
                  className={`${styles.mobileTab} ${
                    activeMobileTab === "intrebari"
                      ? styles.mobileTabActive
                      : ""
                  }`}
                  onClick={() => setActiveMobileTab("intrebari")}
                  role="tab"
                  aria-selected={activeMobileTab === "intrebari"}
                  aria-controls="tab-intrebari"
                >
                  Întrebări
                </button>
              </div>

              <div className={styles.mobileTabPanels}>
                <div
                  id="tab-descriere"
                  role="tabpanel"
                  hidden={activeMobileTab !== "descriere"}
                >
                  {activeMobileTab === "descriere" && (
                    <div className={styles.mobileTabPanel}>
                      {hasDescription ? (
                        <p>{product.description}</p>
                      ) : (
                        <p>Nu există încă o descriere pentru acest produs.</p>
                      )}
                    </div>
                  )}
                </div>

                {hasStructuredDetails && (
                  <div
                    id="tab-detalii"
                    role="tabpanel"
                    hidden={activeMobileTab !== "detalii"}
                  >
                    {activeMobileTab === "detalii" && (
                      <div className={styles.mobileTabPanel}>
                        <DetailsContent
                          product={product}
                          availabilityText={availabilityText}
                        />
                      </div>
                    )}
                  </div>
                )}

                <div
                  id="tab-recenzii"
                  role="tabpanel"
                  hidden={activeMobileTab !== "recenzii"}
                >
                  {activeMobileTab === "recenzii" && (
                    <div className={styles.mobileTabPanel}>
                      <Suspense fallback={<div>Se încarcă recenziile…</div>}>
                        <ReviewsSection
                          avg={avg}
                          reviews={reviews}
                          isOwner={isOwner}
                          isLoggedIn={!!me}
                          currentUserId={myUserId}
                          onSubmit={submitReview}
                          submitting={submittingReview}
                          revRating={revRating}
                          setRevRating={setRevRating}
                          revText={revText}
                          setRevText={setRevText}
                        />
                      </Suspense>
                    </div>
                  )}
                </div>

                <div
                  id="tab-intrebari"
                  role="tabpanel"
                  hidden={activeMobileTab !== "intrebari"}
                >
                  {activeMobileTab === "intrebari" && (
                    <div className={styles.mobileTabPanel}>
                      <Suspense fallback={<div>Se încarcă comentariile…</div>}>
                        <CommentsSection
                          comments={comments}
                          isOwner={isOwner}
                          isLoggedIn={!!me}
                          onSubmit={submitComment}
                          submitting={submittingComment}
                          commentText={commentText}
                          setCommentText={setCommentText}
                          currentUserId={myUserId}
                          editingCommentId={editingCommentId}
                          onStartEditComment={startEditComment}
                          onCancelEditComment={cancelEditComment}
                          onAfterChange={() =>
                            loadCommentsForProduct(product.id)
                          }
                        />
                      </Suspense>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {!isMobile && hasStructuredDetails && (
        <section className={styles.descriptionSection}>
          <div className={styles.accordion}>
            <button
              type="button"
              className={styles.accordionHeader}
              onClick={() => toggleAccordion("details")}
              aria-expanded={openAccordions.details}
            >
              <div className={styles.accordionTitleWrap}>
                <span className={styles.accordionTitle}>Detalii produs</span>
                <span className={styles.accordionMeta}>
                  Informații despre disponibilitate, material, dimensiuni și
                  alte detalii
                </span>
              </div>
              <span className={styles.accordionIcon}>
                <FaChevronDown />
              </span>
            </button>

            {openAccordions.details && (
              <div className={styles.accordionBody}>
                <DetailsContent
                  product={product}
                  availabilityText={availabilityText}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {!isMobile && (
        <section className={styles.reviewsSection}>
          <div className={styles.accordion}>
            <button
              type="button"
              className={styles.accordionHeader}
              onClick={() => toggleAccordion("reviews")}
              aria-expanded={openAccordions.reviews}
            >
              <div className={styles.accordionTitleWrap}>
                <span className={styles.accordionTitle}>Recenzii produs</span>
                <span className={styles.accordionMeta}>
                  {avg.count > 0
                    ? `${avg.average.toFixed(1)} ★ · ${avg.count} recenzii`
                    : "Nu există recenzii încă"}
                </span>
              </div>
              <span className={styles.accordionIcon}>
                <FaChevronDown />
              </span>
            </button>

            {openAccordions.reviews && (
              <div className={styles.accordionBody}>
                <Suspense fallback={<div>Se încarcă recenziile…</div>}>
                  <ReviewsSection
                    avg={avg}
                    reviews={reviews}
                    isOwner={isOwner}
                    isLoggedIn={!!me}
                    currentUserId={myUserId}
                    onSubmit={submitReview}
                    submitting={submittingReview}
                    revRating={revRating}
                    setRevRating={setRevRating}
                    revText={revText}
                    setRevText={setRevText}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </section>
      )}

      {!isMobile && (
        <section className={styles.commentsSection}>
          <div className={styles.accordion}>
            <button
              type="button"
              className={styles.accordionHeader}
              onClick={() => toggleAccordion("comments")}
              aria-expanded={openAccordions.comments}
            >
              <div className={styles.accordionTitleWrap}>
                <span className={styles.accordionTitle}>
                  Întrebări & comentarii
                </span>
                <span className={styles.accordionMeta}>
                  Pune o întrebare sau lasă un mesaj pentru vânzător
                </span>
              </div>
              <span className={styles.accordionIcon}>
                <FaChevronDown />
              </span>
            </button>

            {openAccordions.comments && (
              <div className={styles.accordionBody}>
                <Suspense fallback={<div>Se încarcă comentariile…</div>}>
                  <CommentsSection
                    comments={comments}
                    isOwner={isOwner}
                    isLoggedIn={!!me}
                    onSubmit={submitComment}
                    submitting={submittingComment}
                    commentText={commentText}
                    setCommentText={setCommentText}
                    currentUserId={myUserId}
                    editingCommentId={editingCommentId}
                    onStartEditComment={startEditComment}
                    onCancelEditComment={cancelEditComment}
                    onAfterChange={() => loadCommentsForProduct(product.id)}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </section>
      )}

      {deferredSections && (
        <Suspense fallback={null}>
          <>
            <section className={styles.relatedSec}>
              <h2 className={styles.sectionTitle}>Mai multe din acest magazin</h2>
              <StoreProductsSlider
                products={storeProducts}
                cacheT={cacheT}
                navigate={navigate}
              />
            </section>

            <SimilarProductsGrid
              products={similarProducts}
              cacheT={cacheT}
              navigate={navigate}
            />
          </>
        </Suspense>
      )}

      {zoomOpen && (
        <Suspense fallback={null}>
          <ImageZoom
            open={zoomOpen}
            images={images}
            activeIdx={activeIdx}
            setActiveIdx={setActiveIdx}
            activeSrc={activeSrc}
            onClose={() => setZoomOpen(false)}
          />
        </Suspense>
      )}

      {isOwner && editOpen && (
        <Suspense fallback={null}>
          <ProductModal
            open={editOpen}
            onClose={() => {
              setEditOpen(false);
              setEditingProduct(null);
            }}
            saving={savingProd}
            editingProduct={editingProduct}
            form={prodForm}
            setForm={setProdForm}
            categories={categories}
            onSave={handleSaveProduct}
            uploadFile={uploadFile}
          />
        </Suspense>
      )}
    </div>
  );
}