// client/pages/Products/ProductsPage.jsx
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api.js";
import styles from "./Products.module.css";
import { guestCart } from "../../lib/guestCart";
import ProductCard from "../Vendor/ProfilMagazin/components/ProductCard";
import { SEO } from "../../components/Seo/SeoProvider";
import { SEO_CATEGORIES } from "../../constants/seoCategories";
import {
  FaFilter,
  FaUndoAlt,
  FaTimes,
  FaSearch,
  FaCamera,
} from "react-icons/fa";
import { useImageSearch } from "../../hooks/useImageSearch";

const SORTS = [
  { v: "new", label: "Cele mai noi" },
  { v: "popular", label: "Populare" },
  { v: "price_asc", label: "Preț crescător" },
  { v: "price_desc", label: "Preț descrescător" },
];

const LIMIT = 12;

const humanizeSlug = (slug = "") =>
  slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

const humanizeCategory = (slug = "") => {
  if (!slug) return "";
  const noPrefix = slug.replace(/^[^_]+_/, "");
  return humanizeSlug(noPrefix);
};

function buildProductsSearch({
  page = 1,
  limit = LIMIT,
  ids = "",
  qParam = "",
  categoryParam = "",
  cityParam = "",
  sortParam = "new",
  minPriceParam = "",
  maxPriceParam = "",
  colorParam = "",
  materialParam = "",
  techniqueParam = "",
  styleTagParam = "",
  occasionTagParam = "",
  availabilityParam = "",
  leadTimeMaxParam = "",
  acceptsCustomParam = false,
}) {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("limit", String(limit));
  p.set("serviceType", "products");

  if (ids) p.set("ids", ids);
  if (qParam) p.set("q", qParam);
  if (categoryParam) p.set("category", categoryParam);
  if (cityParam) p.set("city", cityParam);
  if (!ids && sortParam) p.set("sort", sortParam);
  if (minPriceParam) p.set("minPrice", minPriceParam);
  if (maxPriceParam) p.set("maxPrice", maxPriceParam);

  if (colorParam) p.set("color", colorParam);
  if (materialParam) p.set("materialMain", materialParam);
  if (techniqueParam) p.set("technique", techniqueParam);
  if (styleTagParam) p.set("styleTag", styleTagParam);
  if (occasionTagParam) p.set("occasionTag", occasionTagParam);
  if (availabilityParam) p.set("availability", availabilityParam);
  if (leadTimeMaxParam) p.set("leadTimeMax", leadTimeMaxParam);
  if (acceptsCustomParam) p.set("acceptsCustom", "1");

  return p;
}

function mergeUniqueById(prev, next) {
  const map = new Map();
  for (const item of prev) map.set(item.id, item);
  for (const item of next) map.set(item.id, item);
  return Array.from(map.values());
}

function normalizeProducts(items = []) {
  return items
    .filter((pRaw) => {
      const moderationStatus = String(
        pRaw?.moderationStatus || "APPROVED"
      ).toUpperCase();

      return (
        pRaw?.isActive !== false &&
        !pRaw?.isHidden &&
        moderationStatus === "APPROVED"
      );
    })
    .map((pRaw) => ({
      ...pRaw,
      price:
        typeof pRaw.price === "number"
          ? pRaw.price
          : (pRaw.priceCents || 0) / 100,
    }));
}

function extractFacetsFromItems(itemsList = []) {
  const cats = new Set();
  const colors = new Set();
  const materials = new Set();
  const techniques = new Set();
  const styleTags = new Set();
  const occasionTags = new Set();

  let priceMin = Number.POSITIVE_INFINITY;
  let priceMax = 0;

  for (const raw of itemsList) {
    const price =
      typeof raw.price === "number"
        ? raw.price
        : (raw.priceCents || 0) / 100;

    if (Number.isFinite(price)) {
      if (price < priceMin) priceMin = price;
      if (price > priceMax) priceMax = price;
    }

    if (raw?.category) cats.add(raw.category);
    if (raw?.color) colors.add(raw.color);
    if (raw?.materialMain) materials.add(raw.materialMain);
    if (raw?.technique) techniques.add(raw.technique);

    if (Array.isArray(raw?.styleTags)) {
      raw.styleTags.forEach((t) => t && styleTags.add(String(t)));
    } else if (typeof raw?.styleTags === "string") {
      raw.styleTags
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((t) => styleTags.add(t));
    }

    if (Array.isArray(raw?.occasionTags)) {
      raw.occasionTags.forEach((t) => t && occasionTags.add(String(t)));
    } else if (typeof raw?.occasionTags === "string") {
      raw.occasionTags
        .split(/[,\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((t) => occasionTags.add(t));
    }
  }

  return {
    categories: Array.from(cats),
    colors: Array.from(colors),
    materials: Array.from(materials),
    techniques: Array.from(techniques),
    styleTags: Array.from(styleTags),
    occasionTags: Array.from(occasionTags),
    priceMin:
      Number.isFinite(priceMin) && priceMin !== Infinity ? priceMin : "",
    priceMax: Number.isFinite(priceMax) && priceMax !== 0 ? priceMax : "",
  };
}

export default function ProductsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const searchRef = useRef(null);
  const sentinelRef = useRef(null);

  const initialLoadDoneRef = useRef(false);
  const productsRequestIdRef = useRef(0);
  const suggestRequestIdRef = useRef(0);
  const suggestCacheRef = useRef(new Map());

  const {
    searching: imageSearching,
    fileInputRef: imageInputRef,
    openPicker: openImagePicker,
    handleFileChange: handleImageFileChange,
  } = useImageSearch();

  const ids = params.get("ids") || "";

  const qParam = params.get("q") || "";
  const categoryParam = params.get("categorie") || params.get("category") || "";
  const currentSeoCategory = categoryParam ? SEO_CATEGORIES[categoryParam] : null;
  const cityParam = params.get("city") || "";
  const sortParam = params.get("sort") || "new";
  const minPriceParam = params.get("minPrice") || params.get("min") || "";
  const maxPriceParam = params.get("maxPrice") || params.get("max") || "";

  const colorParam = params.get("color") || "";
  const materialParam =
    params.get("materialMain") || params.get("material") || "";
  const techniqueParam = params.get("technique") || "";
  const styleTagParam = params.get("styleTag") || params.get("style") || "";
  const occasionTagParam =
    params.get("occasionTag") || params.get("occasion") || "";
  const availabilityParam = params.get("availability") || "";
  const acceptsCustomRaw = params.get("acceptsCustom");
  const acceptsCustomParam =
    acceptsCustomRaw === "1" || acceptsCustomRaw === "true";
  const leadTimeMaxParam = params.get("leadTimeMax") || "";

  const [me, setMe] = useState(null);
  const [favorites, setFavorites] = useState(() => new Set());

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [smartInfo, setSmartInfo] = useState(null);
  const [appliedFiltersInfo, setAppliedFiltersInfo] = useState(null);

  const [facets, setFacets] = useState({
    categories: [],
    colors: [],
    materials: [],
    techniques: [],
    styleTags: [],
    occasionTags: [],
    priceMin: "",
    priceMax: "",
  });

  const [localFilters, setLocalFilters] = useState({
    q: qParam,
    category: categoryParam,
    city: cityParam,
    minPrice: minPriceParam,
    maxPrice: maxPriceParam,
    sort: sortParam,
    color: colorParam,
    material: materialParam,
    technique: techniqueParam,
    styleTag: styleTagParam,
    occasionTag: occasionTagParam,
    availability: availabilityParam,
    acceptsCustom: acceptsCustomParam,
    leadTimeMax: leadTimeMaxParam,
  });

  const [filtersOpen, setFiltersOpen] = useState(false);

  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const deferredQ = useDeferredValue(localFilters.q || "");

  const productsQueryKey = useMemo(
    () =>
      JSON.stringify({
        ids,
        qParam,
        categoryParam,
        cityParam,
        sortParam,
        minPriceParam,
        maxPriceParam,
        colorParam,
        materialParam,
        techniqueParam,
        styleTagParam,
        occasionTagParam,
        availabilityParam,
        acceptsCustomParam,
        leadTimeMaxParam,
      }),
    [
      ids,
      qParam,
      categoryParam,
      cityParam,
      sortParam,
      minPriceParam,
      maxPriceParam,
      colorParam,
      materialParam,
      techniqueParam,
      styleTagParam,
      occasionTagParam,
      availabilityParam,
      acceptsCustomParam,
      leadTimeMaxParam,
    ]
  );

  const openAuthModal = useCallback(() => {
    const current = window.location.pathname + window.location.search;
    const url = new URL(window.location.href);
    url.searchParams.set("auth", "login");
    url.searchParams.set("redirect", current);
    navigate(url.pathname + url.search, { replace: false });
  }, [navigate]);

  const loadProducts = useCallback(
    async (pageToLoad = 1, append = false) => {
      const requestId = ++productsRequestIdRef.current;

      const firstLoad = pageToLoad === 1 && !append && !initialLoadDoneRef.current;
      const refetchLoad =
        pageToLoad === 1 && !append && initialLoadDoneRef.current;

      if (firstLoad) setLoading(true);
      else if (refetchLoad) setRefreshing(true);
      else setIsLoadingMore(true);

      try {
        const p = buildProductsSearch({
          page: pageToLoad,
          limit: LIMIT,
          ids,
          qParam,
          categoryParam,
          cityParam,
          sortParam,
          minPriceParam,
          maxPriceParam,
          colorParam,
          materialParam,
          techniqueParam,
          styleTagParam,
          occasionTagParam,
          availabilityParam,
          leadTimeMaxParam,
          acceptsCustomParam,
        });

        const res = await api(`/api/public/products?${p.toString()}`);

        if (requestId !== productsRequestIdRef.current) return;

        const rawItems = Array.isArray(res?.items) ? res.items : [];
        const normalizedItems = normalizeProducts(rawItems);
        const serverHasMore = !!res?.hasMore;

        setItems((prev) => {
          if (!append) return normalizedItems;
          return mergeUniqueById(prev, normalizedItems);
        });

        if (!append) {
          setFacets(extractFacetsFromItems(normalizedItems));
        }

        if (res?.total !== null && res?.total !== undefined) {
          setTotal(res.total);
        } else if (!append && normalizedItems.length === 0) {
          setTotal(0);
        }

        setSmartInfo(res?.smart || null);
        setAppliedFiltersInfo(res?.appliedFilters || null);
        setHasMore(serverHasMore);
        initialLoadDoneRef.current = true;
      } catch (err) {
        if (requestId !== productsRequestIdRef.current) return;
        console.error("Products load error:", err);

        if (!append) {
          setItems((prev) => prev);
          if (!initialLoadDoneRef.current) {
            setItems([]);
            setTotal(0);
            setFacets({
              categories: [],
              colors: [],
              materials: [],
              techniques: [],
              styleTags: [],
              occasionTags: [],
              priceMin: "",
              priceMax: "",
            });
          }
        }
      } finally {
        if (requestId === productsRequestIdRef.current) {
          if (firstLoad) setLoading(false);
          else if (refetchLoad) setRefreshing(false);
          else setIsLoadingMore(false);
        }
      }
    },
    [
      ids,
      qParam,
      categoryParam,
      cityParam,
      sortParam,
      minPriceParam,
      maxPriceParam,
      colorParam,
      materialParam,
      techniqueParam,
      styleTagParam,
      occasionTagParam,
      availabilityParam,
      leadTimeMaxParam,
      acceptsCustomParam,
    ]
  );

  useEffect(() => {
    setLocalFilters({
      q: qParam,
      category: categoryParam,
      city: cityParam,
      minPrice: minPriceParam,
      maxPrice: maxPriceParam,
      sort: sortParam,
      color: colorParam,
      material: materialParam,
      technique: techniqueParam,
      styleTag: styleTagParam,
      occasionTag: occasionTagParam,
      availability: availabilityParam,
      acceptsCustom: acceptsCustomParam,
      leadTimeMax: leadTimeMaxParam,
    });

    setPage(1);
    setHasMore(true);
    setTotal((prev) => prev);
  }, [
    qParam,
    categoryParam,
    cityParam,
    minPriceParam,
    maxPriceParam,
    sortParam,
    colorParam,
    materialParam,
    techniqueParam,
    styleTagParam,
    occasionTagParam,
    availabilityParam,
    acceptsCustomParam,
    leadTimeMaxParam,
  ]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const meData = await api("/api/auth/me").catch(() => null);

        if (!alive) return;

        if (!meData || meData?.__unauth) {
          setMe(null);
          setFavorites(new Set());
          return;
        }

        setMe(meData?.user || null);
      } catch {
        if (!alive) return;
        setMe(null);
        setFavorites(new Set());
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    if (!me) return;

    (async () => {
      try {
        const fav = await api("/api/favorites/ids").catch(() => ({ items: [] }));
        if (!alive) return;
        setFavorites(new Set(Array.isArray(fav?.items) ? fav.items : []));
      } catch {
        if (!alive) return;
        setFavorites(new Set());
      }
    })();

    return () => {
      alive = false;
    };
  }, [me]);

  useEffect(() => {
    loadProducts(1, false);
  }, [productsQueryKey, loadProducts]);

  useEffect(() => {
    if (page === 1) return;
    loadProducts(page, true);
  }, [page, loadProducts]);

  useEffect(() => {
    const q = deferredQ.trim();

    if (!q || q.length < 2) {
      setSuggestions(null);
      setSuggestLoading(false);
      return;
    }

    const cacheKey = q.toLowerCase();
    if (suggestCacheRef.current.has(cacheKey)) {
      setSuggestions(suggestCacheRef.current.get(cacheKey));
      setSuggestLoading(false);
      return;
    }

    const handle = setTimeout(async () => {
      const requestId = ++suggestRequestIdRef.current;
      try {
        setSuggestLoading(true);
        const data = await api(
          `/api/public/products/suggest?q=${encodeURIComponent(q)}`
        );

        if (requestId !== suggestRequestIdRef.current) return;

        suggestCacheRef.current.set(cacheKey, data || null);
        setSuggestions(data || null);
      } catch {
        if (requestId !== suggestRequestIdRef.current) return;
        setSuggestions(null);
      } finally {
        if (requestId === suggestRequestIdRef.current) {
          setSuggestLoading(false);
        }
      }
    }, 220);

    return () => clearTimeout(handle);
  }, [deferredQ]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSuggestions(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (loading || refreshing || isLoadingMore || !hasMore) return;

        setPage((prev) => prev + 1);
      },
      { root: null, rootMargin: "900px 0px", threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, refreshing, isLoadingMore, hasMore]);

  const doAddToCart = useCallback(
    async (productId) => {
      if (me) {
        const r = await api(`/api/cart/add`, {
          method: "POST",
          body: { productId, qty: 1 },
        });
        if (r?.__unauth) guestCart.add(productId, 1);
      } else {
        guestCart.add(productId, 1);
      }

      try {
        window.dispatchEvent(new CustomEvent("cart:changed"));
      } catch {
        // ignore
      }

      alert("Produs adăugat în coș.");
    },
    [me]
  );

  const toggleFavorite = useCallback(
    async (productId) => {
      if (!me) {
        alert(
          "Pentru a salva produsele tale preferate și a putea discuta mai târziu cu artizanii despre personalizare, este nevoie să te autentifici. Te așteptăm cu drag, durează doar câteva secunde! 💛"
        );
        try {
          sessionStorage.setItem(
            "intent",
            JSON.stringify({ type: "favorite_toggle", productId })
          );
        } catch {
          // ignore
        }
        openAuthModal();
        return;
      }

      const wasFav = favorites.has(productId);

      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(productId)) next.delete(productId);
        else next.add(productId);
        return next;
      });

      try {
        const r = await api("/api/favorites/toggle", {
          method: "POST",
          body: { productId },
        });

        if (r?.error === "cannot_favorite_own_product") {
          setFavorites((prev) => {
            const next = new Set(prev);
            if (wasFav) next.add(productId);
            else next.delete(productId);
            return next;
          });
          alert("Nu poți adăuga la favorite un produs care îți aparține.");
        }
      } catch {
        setFavorites((prev) => {
          const next = new Set(prev);
          if (wasFav) next.add(productId);
          else next.delete(productId);
          return next;
        });
      }
    },
    [me, favorites, openAuthModal]
  );

  useEffect(() => {
    if (!me) return;

    const raw = sessionStorage.getItem("intent");
    if (!raw) return;

    try {
      const intent = JSON.parse(raw);

      (async () => {
        try {
          if (intent?.type === "favorite_toggle" && intent?.productId) {
            await api("/api/favorites/toggle", {
              method: "POST",
              body: { productId: intent.productId },
            });

            const fav = await api("/api/favorites/ids").catch(() => ({
              items: [],
            }));
            setFavorites(
              new Set(Array.isArray(fav?.items) ? fav.items : [])
            );
          }
        } finally {
          sessionStorage.removeItem("intent");
        }
      })();
    } catch {
      sessionStorage.removeItem("intent");
    }
  }, [me]);

  const categoryLabelMap = useMemo(() => {
    const map = {};
    for (const p of items) {
      const key = p?.category;
      if (!key || map[key]) continue;
      map[key] = humanizeCategory(key);
    }
    return map;
  }, [items]);

  const applyFilters = useCallback(() => {
    const f = localFilters;
    const p = new URLSearchParams();

    if (ids) p.set("ids", ids);

    if (f.q) p.set("q", f.q);
    if (f.category) p.set("categorie", f.category);
    if (f.city) p.set("city", f.city);
    if (f.minPrice) p.set("minPrice", f.minPrice);
    if (f.maxPrice) p.set("maxPrice", f.maxPrice);

    if (f.color) p.set("color", f.color);
    if (f.material) p.set("materialMain", f.material);
    if (f.technique) p.set("technique", f.technique);
    if (f.styleTag) p.set("styleTag", f.styleTag);
    if (f.occasionTag) p.set("occasionTag", f.occasionTag);
    if (f.availability) p.set("availability", f.availability);
    if (f.leadTimeMax) p.set("leadTimeMax", f.leadTimeMax);
    if (f.acceptsCustom) p.set("acceptsCustom", "1");

    if (!ids && f.sort) p.set("sort", f.sort);

    p.set("page", "1");

    setFiltersOpen(false);
    setSuggestions(null);
    navigate(`/produse?${p.toString()}`);
  }, [ids, localFilters, navigate]);

  const resetFilters = useCallback(() => {
    setLocalFilters({
      q: "",
      category: "",
      city: "",
      minPrice: "",
      maxPrice: "",
      sort: "new",
      color: "",
      material: "",
      technique: "",
      styleTag: "",
      occasionTag: "",
      availability: "",
      acceptsCustom: false,
      leadTimeMax: "",
    });

    setFiltersOpen(false);
    setSuggestions(null);
    navigate("/produse");
  }, [navigate]);

  const clearImageIds = useCallback(() => {
    const p = new URLSearchParams(params);
    p.delete("ids");
    p.delete("page");
    navigate(`/produse?${p.toString()}`);
  }, [navigate, params]);

  const handleSuggestionCategoryClick = useCallback(
    (catKey) => {
      const p = new URLSearchParams();
      p.set("q", localFilters.q || "");
      p.set("categorie", catKey);
      p.set("page", "1");
      setSuggestions(null);
      navigate(`/produse?${p.toString()}`);
    },
    [localFilters.q, navigate]
  );

  const handleSuggestionProductClick = useCallback(
  (id) => {
    setSuggestions(null);
    navigate(`/produs/${id}`);
  },
  [navigate]
);

  const handleApplySmartCategory = useCallback(
    (catKey) => {
      const p = new URLSearchParams(params);
      p.set("categorie", catKey);
      p.set("page", "1");
      navigate(`/produse?${p.toString()}`);
    },
    [navigate, params]
  );

  const productCards = useMemo(() => {
    return items.map((p) => {
      const ownerUserId = p?.service?.vendor?.userId;
      const isOwner =
        !!me &&
        !!ownerUserId &&
        (me.id === ownerUserId || me.sub === ownerUserId);

      const viewMode = isOwner ? "vendor" : me ? "user" : "guest";
      const isFav = favorites.has(p.id);

      return (
        <ProductCard
          key={p.id}
          p={p}
          viewMode={viewMode}
          isFav={isFav}
          onAddToCart={doAddToCart}
          onToggleFavorite={toggleFavorite}
          categoryLabelMap={categoryLabelMap}
          vendorActionsOverride={
            isOwner ? (
              <div className={styles.ownerOverrideRow}>
                <span className={styles.ownerBadge}>
                  Produsul tău
                </span>

                <button
                  type="button"
                  className={styles.ownerManageBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate("/vendor/store");
                  }}
                >
                  Gestionează
                </button>
              </div>
            ) : null
          }
        />
      );
    });
  }, [
    items,
    me,
    favorites,
    doAddToCart,
    toggleFavorite,
    categoryLabelMap,
    navigate,
  ]);

  return (
    <section className={styles.page}>
      <SEO
  title={
    currentSeoCategory
      ? `${currentSeoCategory.title} | Produse`
      : "Produse handmade"
  }
  description={
    currentSeoCategory
      ? currentSeoCategory.description
      : "Descoperă produse handmade, cadouri personalizate și creații artizanale românești pe Artfest."
  }
  canonical={
    currentSeoCategory
      ? `https://artfest.ro/categorii/${currentSeoCategory.slug}`
      : "https://artfest.ro/produse"
  }
  url={
    currentSeoCategory
      ? `https://artfest.ro/categorii/${currentSeoCategory.slug}`
      : "https://artfest.ro/produse"
  }
/>
      <header className={styles.head}>
        <div className={styles.headTop}>
          <h1 className={styles.h1}>Produse</h1>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.iconCircle}
              onClick={() => setFiltersOpen(true)}
              title="Filtrează produse"
              aria-label="Filtrează produse"
            >
              <FaFilter />
            </button>
            <button
              type="button"
              className={styles.iconCircle}
              onClick={resetFilters}
              title="Resetează filtrele"
              aria-label="Resetează filtrele"
            >
              <FaUndoAlt />
            </button>
          </div>
        </div>

        <form
          ref={searchRef}
          className={styles.searchRow}
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters();
          }}
          style={{ position: "relative" }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSuggestions(null);
          }}
        >
          <div className={styles.searchShell}>
            <button
              type="submit"
              className={styles.searchIconBtn}
              aria-label="Caută"
            >
              <FaSearch />
            </button>

            <input
              className={`${styles.input} ${styles.searchInput}`}
              placeholder="Caută: invitații, mărturii, lumini decor…"
              value={localFilters.q}
              onChange={(e) =>
                setLocalFilters((f) => ({ ...f, q: e.target.value }))
              }
              autoComplete="off"
            />

            <button
              type="button"
              className={styles.searchCameraBtn}
              aria-label="Caută după imagine"
              onClick={openImagePicker}
              disabled={imageSearching}
            >
              <FaCamera />
            </button>
          </div>

          <input
            type="file"
            accept="image/*"
            ref={imageInputRef}
            style={{ display: "none" }}
            onChange={handleImageFileChange}
          />

          {localFilters.q &&
            localFilters.q.length >= 2 &&
            (suggestLoading || suggestions) && (
              <div
                role="listbox"
                aria-label="Sugestii de căutare"
                className={styles.suggestDropdown}
              >
                {suggestLoading && (
                  <div className={styles.suggestLoading}>
                    Se încarcă sugestiile…
                  </div>
                )}

                {!suggestLoading && suggestions && (
                  <>
                    {(!suggestions.products ||
                      !suggestions.products.length) &&
                      (!suggestions.categories ||
                        !suggestions.categories.length) && (
                        <div className={styles.suggestEmpty}>
                          Nu avem sugestii exacte pentru{" "}
                          <strong>{localFilters.q}</strong>.
                        </div>
                      )}

                    {suggestions.categories &&
                      suggestions.categories.length > 0 && (
                        <div className={styles.suggestSection}>
                          <div className={styles.suggestSectionTitle}>
                            Categorii sugerate
                          </div>
                          {suggestions.categories.map((c) => (
                            <button
                              key={c.key}
                              type="button"
                              role="option"
                              className={styles.suggestCategoryBtn}
                              onClick={() =>
                                handleSuggestionCategoryClick(c.key)
                              }
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}

                    {suggestions.products &&
                      suggestions.products.length > 0 && (
                        <div className={styles.suggestSection}>
                          <div className={styles.suggestSectionTitle}>
                            Produse sugerate
                          </div>
                          <div className={styles.suggestProductsList}>
                            {suggestions.products.map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                role="option"
                                className={styles.suggestProductBtn}
                                onClick={() =>
                                  handleSuggestionProductClick(p.id)
                                }
                              >
                                {p.images?.[0] && (
                                  <img
                                    src={p.images[0]}
                                    alt={p.title}
                                    className={styles.suggestProductThumb}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                )}
                                <div className={styles.suggestProductMeta}>
                                  <div className={styles.suggestProductTitle}>
                                    {p.title}
                                  </div>
                                  <div className={styles.suggestProductPrice}>
                                    {(p.priceCents / 100).toFixed(2)}{" "}
                                    {p.currency || "RON"}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                  </>
                )}
              </div>
            )}
        </form>

        <SmartSearchSummary
          q={qParam}
          smart={smartInfo}
          applied={appliedFiltersInfo}
          categoryParam={categoryParam}
          onApplySmartCategory={handleApplySmartCategory}
        />

        <ActiveFilterChips params={params} navigate={navigate} />

        {ids && (
          <div className={styles.imageSearchNotice}>
            <span className={styles.imageSearchText}>
              Rezultate după imagine — ordinea este de similaritate. Poți rafina
              cu filtrele.
            </span>
            <button
              onClick={clearImageIds}
              className={`${styles.btnPrimary} ${styles.imageSearchBtn}`}
            >
              Resetează imaginea
            </button>
          </div>
        )}
      </header>

      {filtersOpen && (
        <div
          className={styles.filtersOverlay}
          onClick={() => setFiltersOpen(false)}
        >
          <div
            className={styles.filtersModal}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.filtersModalHead}>
              <h2 className={styles.filtersTitle}>Filtre produse</h2>
              <button
                type="button"
                className={styles.iconCircle}
                onClick={() => setFiltersOpen(false)}
                aria-label="Închide filtrele"
                title="Închide filtrele"
              >
                <FaTimes />
              </button>
            </div>

            <div className={styles.filters}>
              <input
                className={styles.input}
                placeholder="Caută produse…"
                value={localFilters.q}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, q: e.target.value }))
                }
              />

              <select
                className={styles.select}
                value={localFilters.category}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, category: e.target.value }))
                }
                aria-label="Categorie produs"
              >
                <option value="">Toate categoriile</option>
                {facets.categories.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabelMap[c] || humanizeCategory(c)}
                  </option>
                ))}
              </select>

              <select
                className={styles.select}
                value={localFilters.color}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, color: e.target.value }))
                }
                aria-label="Culoare"
              >
                <option value="">Toate culorile</option>
                {facets.colors.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                className={styles.select}
                value={localFilters.material}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, material: e.target.value }))
                }
                aria-label="Material principal"
              >
                <option value="">Toate materialele</option>
                {facets.materials.map((m) => (
                  <option key={m} value={m}>
                    {humanizeSlug(m)}
                  </option>
                ))}
              </select>

              <select
                className={styles.select}
                value={localFilters.technique}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, technique: e.target.value }))
                }
                aria-label="Tehnică"
              >
                <option value="">Toate tehnicile</option>
                {facets.techniques.map((t) => (
                  <option key={t} value={t}>
                    {humanizeSlug(t)}
                  </option>
                ))}
              </select>

              <select
                className={styles.select}
                value={localFilters.styleTag}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, styleTag: e.target.value }))
                }
                aria-label="Stil"
              >
                <option value="">Toate stilurile</option>
                {facets.styleTags.map((s) => (
                  <option key={s} value={s}>
                    {humanizeSlug(s)}
                  </option>
                ))}
              </select>

              <select
                className={styles.select}
                value={localFilters.occasionTag}
                onChange={(e) =>
                  setLocalFilters((f) => ({
                    ...f,
                    occasionTag: e.target.value,
                  }))
                }
                aria-label="Ocazie"
              >
                <option value="">Toate ocaziile</option>
                {facets.occasionTags.map((o) => (
                  <option key={o} value={o}>
                    {humanizeSlug(o)}
                  </option>
                ))}
              </select>

              <input
                className={styles.input}
                placeholder="Oraș"
                value={localFilters.city}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, city: e.target.value }))
                }
              />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  className={styles.inputN}
                  type="number"
                  min="0"
                  placeholder={
                    facets.priceMin
                      ? `Min (ex: ${Math.floor(facets.priceMin)})`
                      : "Min (RON)"
                  }
                  value={localFilters.minPrice}
                  onChange={(e) =>
                    setLocalFilters((f) => ({
                      ...f,
                      minPrice: e.target.value,
                    }))
                  }
                />
                <input
                  className={styles.inputN}
                  type="number"
                  min="0"
                  placeholder={
                    facets.priceMax
                      ? `Max (ex: ${Math.ceil(facets.priceMax)})`
                      : "Max (RON)"
                  }
                  value={localFilters.maxPrice}
                  onChange={(e) =>
                    setLocalFilters((f) => ({
                      ...f,
                      maxPrice: e.target.value,
                    }))
                  }
                />
              </div>

              <select
                className={styles.select}
                value={localFilters.availability}
                onChange={(e) =>
                  setLocalFilters((f) => ({
                    ...f,
                    availability: e.target.value,
                  }))
                }
                aria-label="Disponibilitate"
              >
                <option value="">Toate disponibilitățile</option>
                <option value="READY">Gata de livrare</option>
                <option value="MADE_TO_ORDER">La comandă</option>
                <option value="PREORDER">Precomandă</option>
                <option value="SOLD_OUT">Epuizat</option>
              </select>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <input
                  className={styles.inputN}
                  type="number"
                  min="1"
                  placeholder="Execuție max (zile)"
                  value={localFilters.leadTimeMax}
                  onChange={(e) =>
                    setLocalFilters((f) => ({
                      ...f,
                      leadTimeMax: e.target.value,
                    }))
                  }
                />
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={localFilters.acceptsCustom}
                    onChange={(e) =>
                      setLocalFilters((f) => ({
                        ...f,
                        acceptsCustom: e.target.checked,
                      }))
                    }
                  />{" "}
                  Personalizabile
                </label>
              </div>

              <select
                className={styles.select}
                value={localFilters.sort}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, sort: e.target.value }))
                }
                disabled={!!ids}
                title={
                  ids
                    ? "Sortarea este fixă (ordine de similaritate)"
                    : "Sortează"
                }
              >
                {SORTS.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </select>

              <div className={styles.filterActions}>
                <button
                  type="button"
                  className={styles.btnApply}
                  onClick={applyFilters}
                >
                  Aplică filtre
                </button>
                <button
                  type="button"
                  className={styles.btnReset}
                  onClick={resetFilters}
                >
                  Resetează
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <ProductsSkeleton />
      ) : (
        <>
          {refreshing && items.length > 0 && (
            <div className={styles.loading}>Actualizăm rezultatele…</div>
          )}

          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className={styles.grid}>{productCards}</div>
          )}

          <div ref={sentinelRef} style={{ height: 1 }} />

          {isLoadingMore && (
            <div className={styles.loading}>
              Se încarcă mai multe produse…
            </div>
          )}

          {!hasMore && (total ?? 0) > 0 && (
            <div className={styles.resultsInfo}>
              Ai ajuns la finalul listei de produse.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>
        Nu am găsit produse pentru filtrele alese.
      </div>
      <a className={styles.btnPrimary} href="/produse">
        Resetează filtrele
      </a>
    </div>
  );
}

function ProductsSkeleton() {
  return (
    <div className={styles.grid}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className={styles.cardSkeleton}>
          <div className={styles.skelImage} />
          <div className={styles.skelLine} />
          <div className={styles.skelLineShort} />
        </div>
      ))}
    </div>
  );
}

function ActiveFilterChips({ params, navigate }) {
  const p = new URLSearchParams(params);

  const removeKey = (key) => {
    const next = new URLSearchParams(p);
    next.delete(key);
    next.set("page", "1");
    navigate(`/produse?${next.toString()}`);
  };

  const keys = [
    ["q", "Căutare"],
    ["categorie", "Categorie"],
    ["city", "Oraș"],
    ["color", "Culoare"],
    ["materialMain", "Material"],
    ["technique", "Tehnică"],
    ["styleTag", "Stil"],
    ["occasionTag", "Ocazie"],
    ["availability", "Disponibilitate"],
    ["leadTimeMax", "Execuție max"],
    ["minPrice", "Preț min"],
    ["maxPrice", "Preț max"],
  ];

  const chips = keys
    .map(([key, label]) => {
      const value = p.get(key);
      if (!value) return null;

      return (
        <button
          key={key}
          type="button"
          className={styles.chip}
          onClick={() => removeKey(key)}
        >
          <span className={styles.chipLabel}>
            <strong>{label}:</strong> {value}
          </span>
          <FaTimes className={styles.chipCloseIcon} />
        </button>
      );
    })
    .filter(Boolean);

  if (!chips.length) return null;
  return <div className={styles.chipsWrap}>{chips}</div>;
}

function SmartSearchSummary({
  q,
  smart,
  applied,
  categoryParam,
  onApplySmartCategory,
}) {
  if (!smart && !applied && !q) return null;

  const categoryFromSmart =
    smart?.inferredCategory && !categoryParam && !applied?.category;

  const formatCategory = (cat) => (cat ? humanizeCategory(cat) : "");
  const formatSlug = (slug) => (slug ? humanizeSlug(slug) : "");

  return (
    <div className={styles.smartSummaryWrap}>
      {q && (
        <span className={styles.smartSummaryText}>
          Cauți: <strong>„{q}”</strong>
        </span>
      )}

      {applied?.category && (
        <span className={styles.chip}>
          <strong>Categorie:</strong> {formatCategory(applied.category)}
          {categoryFromSmart && (
            <span style={{ fontSize: 11, opacity: 0.7 }}>
              {" "}
              (dedusă din text)
            </span>
          )}
        </span>
      )}

      {applied?.color && (
        <span className={styles.chip}>
          <strong>Culoare:</strong> {formatSlug(applied.color)}
        </span>
      )}

      {applied?.occasionTag && (
        <span className={styles.chip}>
          <strong>Ocazie:</strong> {formatSlug(applied.occasionTag)}
        </span>
      )}

      {applied?.availability && (
        <span className={styles.chip}>
          <strong>Disponibilitate:</strong> {applied.availability}
        </span>
      )}

      {applied?.acceptsCustom && (
        <span className={styles.chip}>Personalizabile</span>
      )}

      {categoryFromSmart && (
        <button
          type="button"
          className={styles.smartCategorySuggest}
          onClick={() => onApplySmartCategory?.(smart.inferredCategory)}
        >
          Sugestie categorie: {formatCategory(smart.inferredCategory)}
        </button>
      )}

      {smart?.mustTextTokens && smart.mustTextTokens.length > 0 && (
        <span className={styles.smartSummaryText}>
          Cuvinte cheie folosite: {smart.mustTextTokens.join(", ")}
        </span>
      )}
    </div>
  );
}