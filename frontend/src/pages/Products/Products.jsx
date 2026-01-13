// client/pages/Products/ProductsPage.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../lib/api.js";
import styles from "./Products.module.css";
import { guestCart } from "../../lib/guestCart";
import ProductCard from "../Vendor/ProfilMagazin/components/ProductCard";

import { FaFilter, FaUndoAlt, FaTimes, FaSearch, FaCamera } from "react-icons/fa";
import { useImageSearch } from "../../hooks/useImageSearch";

const SORTS = [
  { v: "new", label: "Cele mai noi" },
  { v: "popular", label: "Populare" },
  { v: "price_asc", label: "Preț crescător" },
  { v: "price_desc", label: "Preț descrescător" },
];

const humanizeSlug = (slug = "") =>
  slug.replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

const humanizeCategory = (slug = "") => {
  if (!slug) return "";
  const noPrefix = slug.replace(/^[^_]+_/, "");
  return humanizeSlug(noPrefix);
};

export default function ProductsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const searchRef = useRef(null);

  // sentinel pt. infinite scroll
  const sentinelRef = useRef(null);

  // 👇 hook de căutare după imagine (reutilizabil)
  const {
    searching: imageSearching,
    fileInputRef: imageInputRef,
    openPicker: openImagePicker,
    handleFileChange: handleImageFileChange,
  } = useImageSearch();

  // query params
  const ids = params.get("ids") || "";

  const qParam = params.get("q") || "";
  const categoryParam = params.get("categorie") || params.get("category") || "";
  const cityParam = params.get("city") || "";
  const sortParam = params.get("sort") || "new";
  const minPriceParam = params.get("minPrice") || params.get("min") || "";
  const maxPriceParam = params.get("maxPrice") || params.get("max") || "";

  const colorParam = params.get("color") || "";
  const materialParam = params.get("materialMain") || params.get("material") || "";
  const techniqueParam = params.get("technique") || "";
  const styleTagParam = params.get("styleTag") || params.get("style") || "";
  const occasionTagParam = params.get("occasionTag") || params.get("occasion") || "";
  const availabilityParam = params.get("availability") || "";
  const acceptsCustomRaw = params.get("acceptsCustom");
  const acceptsCustomParam = acceptsCustomRaw === "1" || acceptsCustomRaw === "true";
  const leadTimeMaxParam = params.get("leadTimeMax") || "";

  const [me, setMe] = useState(null);
  const [favorites, setFavorites] = useState(() => new Set());

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);

  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const limit = 24;

  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [smartInfo, setSmartInfo] = useState(null);
  const [appliedFiltersInfo, setAppliedFiltersInfo] = useState(null);

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

  // sync din URL -> filtre locale + reset pentru infinite scroll
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

    setItems([]);
    setPage(1);
    setHasMore(true);
    setTotal(null);
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

  // load me + favorites
  useEffect(() => {
    (async () => {
      try {
        const d = await api("/api/auth/me");
        if (d?.__unauth) {
          setMe(null);
          setFavorites(new Set());
        } else {
          setMe(d?.user || null);
          if (d?.user) {
            const fav = await api("/api/favorites/ids").catch(() => ({ items: [] }));
            setFavorites(new Set(Array.isArray(fav?.items) ? fav.items : []));
          }
        }
      } catch {
        setMe(null);
        setFavorites(new Set());
      }
    })();
  }, []);

  const openAuthModal = useCallback(() => {
    const current = window.location.pathname + window.location.search;
    const url = new URL(window.location.href);
    url.searchParams.set("auth", "login");
    url.searchParams.set("redirect", current);
    navigate(url.pathname + url.search, { replace: false });
  }, [navigate]);

  // load products – prima pagină + append
  const load = useCallback(
    async (pageToLoad = 1, append = false) => {
      if (pageToLoad === 1 && !append) setLoading(true);
      else setIsLoadingMore(true);

      try {
        const p = new URLSearchParams();
        p.set("page", String(pageToLoad));
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

        const res = await api(`/api/public/products?${p.toString()}`);

        const newItems = Array.isArray(res?.items) ? res.items : [];
        const serverHasMore = !!res?.hasMore;

        setItems((prev) => (append ? [...prev, ...newItems] : newItems));

        // total e trimis doar pe page=1 (server), îl păstrăm
        if (res?.total !== null && res?.total !== undefined) {
          setTotal(res.total);
        }

        setSmartInfo(res?.smart || null);
        setAppliedFiltersInfo(res?.appliedFilters || null);
        setHasMore(serverHasMore);
      } finally {
        if (pageToLoad === 1 && !append) setLoading(false);
        else setIsLoadingMore(false);
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

  // prima pagină
  useEffect(() => {
    load(1, false);
  }, [load]);

  // autocomplete
  useEffect(() => {
    const q = (localFilters.q || "").trim();
    if (!q || q.length < 2) {
      setSuggestions(null);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        setSuggestLoading(true);
        const data = await api(`/api/public/products/suggest?q=${encodeURIComponent(q)}`);
        setSuggestions(data || null);
      } catch {
        setSuggestions(null);
      } finally {
        setSuggestLoading(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [localFilters.q]);

  // click outside -> închide sugestiile
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSuggestions(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, []);

  // ✅ Infinite scroll cu IntersectionObserver (mai stabil decât scroll event)
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;

        if (!loading && !isLoadingMore && hasMore) {
          setPage((prev) => prev + 1);
        }
      },
      { root: null, rootMargin: "800px 0px", threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, isLoadingMore, hasMore]);

  // când page crește (>1), încărcăm următoarea pagină și concatenăm
  useEffect(() => {
    if (page === 1) return;
    load(page, true);
  }, [page, load]);

  const doAddToCart = useCallback(
    async (productId) => {
      if (me) {
        const r = await api(`/api/cart/add`, { method: "POST", body: { productId, qty: 1 } });
        if (r?.__unauth) guestCart.add(productId, 1);
      } else {
        guestCart.add(productId, 1);
      }
      try {
        window.dispatchEvent(new CustomEvent("cart:changed"));
      } catch {
        /* ignore */
      }
      alert("Produs adăugat în coș.");
    },
    [me]
  );

  // ✅ useCallback ca să nu recreezi funcția la fiecare render
  const toggleFavorite = useCallback(
    async (productId) => {
      if (!me) {
        alert(
          "Pentru a salva produsele tale preferate și a putea discuta mai târziu cu artizanii despre personalizare, este nevoie să te autentifici. Te așteptăm cu drag, durează doar câteva secunde! 💛"
        );
        try {
          sessionStorage.setItem("intent", JSON.stringify({ type: "favorite_toggle", productId }));
        } catch {
          /* ignore */
        }
        openAuthModal();
        return;
      }

      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(productId)) next.delete(productId);
        else next.add(productId);
        return next;
      });

      try {
        const r = await api("/api/favorites/toggle", { method: "POST", body: { productId } });
        if (r?.error === "cannot_favorite_own_product") {
          // revert (server refused)
          setFavorites((prev) => {
            const next = new Set(prev);
            // dacă server zice că nu ai voie, întoarcem la starea anterioară
            if (next.has(productId)) next.delete(productId);
            else next.add(productId);
            return next;
          });
          alert("Nu poți adăuga la favorite un produs care îți aparține.");
        }
      } catch {
        // revert dacă a picat requestul
        setFavorites((prev) => {
          const next = new Set(prev);
          if (next.has(productId)) next.delete(productId);
          else next.add(productId);
          return next;
        });
      }
    },
    [me, openAuthModal]
  );

  // după login, executăm intent
  useEffect(() => {
    if (!me) return;
    const raw = sessionStorage.getItem("intent");
    if (!raw) return;

    try {
      const intent = JSON.parse(raw);
      (async () => {
        try {
          if (intent?.type === "favorite_toggle" && intent?.productId) {
            await api("/api/favorites/toggle", { method: "POST", body: { productId: intent.productId } });
            const fav = await api("/api/favorites/ids").catch(() => ({ items: [] }));
            setFavorites(new Set(Array.isArray(fav?.items) ? fav.items : []));
          }
        } finally {
          sessionStorage.removeItem("intent");
        }
      })();
    } catch {
      sessionStorage.removeItem("intent");
    }
  }, [me]);

  // facete din items
  const facets = useMemo(() => {
    const cats = new Set();
    const colors = new Set();
    const materials = new Set();
    const techniques = new Set();
    const styleTags = new Set();
    const occasionTags = new Set();

    let priceMin = Number.POSITIVE_INFINITY;
    let priceMax = 0;

    for (const raw of items) {
      const price = typeof raw.price === "number" ? raw.price : (raw.priceCents || 0) / 100;

      if (Number.isFinite(price)) {
        if (price < priceMin) priceMin = price;
        if (price > priceMax) priceMax = price;
      }

      if (raw?.category) cats.add(raw.category);
      if (raw?.color) colors.add(raw.color);
      if (raw?.materialMain) materials.add(raw.materialMain);
      if (raw?.technique) techniques.add(raw.technique);

      if (Array.isArray(raw?.styleTags)) raw.styleTags.forEach((t) => t && styleTags.add(String(t)));
      else if (typeof raw?.styleTags === "string") {
        raw.styleTags
          .split(/[,\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .forEach((t) => styleTags.add(t));
      }

      if (Array.isArray(raw?.occasionTags)) raw.occasionTags.forEach((t) => t && occasionTags.add(String(t)));
      else if (typeof raw?.occasionTags === "string") {
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
      priceMin: Number.isFinite(priceMin) && priceMin !== Infinity ? priceMin : "",
      priceMax: Number.isFinite(priceMax) && priceMax !== 0 ? priceMax : "",
    };
  }, [items]);

  const categoryLabelMap = useMemo(() => {
    const map = {};
    for (const p of items) {
      const key = p?.category;
      if (!key || map[key]) continue;
      map[key] = humanizeCategory(key);
    }
    return map;
  }, [items]);

  const applyFilters = () => {
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
  };

  const resetFilters = () => {
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
  };

  const clearImageIds = () => {
    const p = new URLSearchParams(params);
    p.delete("ids");
    p.delete("page");
    navigate(`/produse?${p.toString()}`);
  };

  const handleSuggestionCategoryClick = (catKey) => {
    const p = new URLSearchParams();
    p.set("q", localFilters.q || "");
    p.set("categorie", catKey);
    p.set("page", "1");
    setSuggestions(null);
    navigate(`/produse?${p.toString()}`);
  };

  const handleSuggestionProductClick = (id) => {
    setSuggestions(null);
    navigate(`/produse/${id}`);
  };

  const handleApplySmartCategory = (catKey) => {
    const p = new URLSearchParams(params);
    p.set("categorie", catKey);
    p.set("page", "1");
    navigate(`/produse?${p.toString()}`);
  };

  const itemsNormalized = useMemo(() => {
    return items.map((pRaw) => ({
      ...pRaw,
      price: typeof pRaw.price === "number" ? pRaw.price : (pRaw.priceCents || 0) / 100,
    }));
  }, [items]);

  return (
    <section className={styles.page}>
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

        {/* search */}
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
            <button type="submit" className={styles.searchIconBtn} aria-label="Caută">
              <FaSearch />
            </button>

            <input
              className={`${styles.input} ${styles.searchInput}`}
              placeholder="Caută: invitații, mărturii, lumini decor…"
              value={localFilters.q}
              onChange={(e) => setLocalFilters((f) => ({ ...f, q: e.target.value }))}
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

          {/* inputul „invizibil” pentru imagine */}
          <input
            type="file"
            accept="image/*"
            ref={imageInputRef}
            style={{ display: "none" }}
            onChange={handleImageFileChange}
          />

          {localFilters.q && localFilters.q.length >= 2 && (suggestLoading || suggestions) && (
            <div role="listbox" aria-label="Sugestii de căutare" className={styles.suggestDropdown}>
              {suggestLoading && <div className={styles.suggestLoading}>Se încarcă sugestiile…</div>}

              {!suggestLoading && suggestions && (
                <>
                  {(!suggestions.products || !suggestions.products.length) &&
                    (!suggestions.categories || !suggestions.categories.length) && (
                      <div className={styles.suggestEmpty}>
                        Nu avem sugestii exacte pentru <strong>{localFilters.q}</strong>.
                      </div>
                    )}

                  {suggestions.categories && suggestions.categories.length > 0 && (
                    <div className={styles.suggestSection}>
                      <div className={styles.suggestSectionTitle}>Categorii sugerate</div>
                      {suggestions.categories.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          role="option"
                          className={styles.suggestCategoryBtn}
                          onClick={() => handleSuggestionCategoryClick(c.key)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {suggestions.products && suggestions.products.length > 0 && (
                    <div className={styles.suggestSection}>
                      <div className={styles.suggestSectionTitle}>Produse sugerate</div>
                      <div className={styles.suggestProductsList}>
                        {suggestions.products.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            role="option"
                            className={styles.suggestProductBtn}
                            onClick={() => handleSuggestionProductClick(p.id)}
                          >
                            {p.images?.[0] && (
                              <img src={p.images[0]} alt={p.title} className={styles.suggestProductThumb} />
                            )}
                            <div className={styles.suggestProductMeta}>
                              <div className={styles.suggestProductTitle}>{p.title}</div>
                              <div className={styles.suggestProductPrice}>
                                {(p.priceCents / 100).toFixed(2)} {p.currency || "RON"}
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
              Rezultate după imagine — ordinea este de similaritate. Poți rafina cu filtrele.
            </span>
            <button onClick={clearImageIds} className={`${styles.btnPrimary} ${styles.imageSearchBtn}`}>
              Resetează imaginea
            </button>
          </div>
        )}
      </header>

      {filtersOpen && (
        <div className={styles.filtersOverlay} onClick={() => setFiltersOpen(false)}>
          <div className={styles.filtersModal} onClick={(e) => e.stopPropagation()}>
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
                onChange={(e) => setLocalFilters((f) => ({ ...f, q: e.target.value }))}
              />

              <select
                className={styles.select}
                value={localFilters.category}
                onChange={(e) => setLocalFilters((f) => ({ ...f, category: e.target.value }))}
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
                onChange={(e) => setLocalFilters((f) => ({ ...f, color: e.target.value }))}
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
                onChange={(e) => setLocalFilters((f) => ({ ...f, material: e.target.value }))}
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
                onChange={(e) => setLocalFilters((f) => ({ ...f, technique: e.target.value }))}
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
                onChange={(e) => setLocalFilters((f) => ({ ...f, styleTag: e.target.value }))}
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
                onChange={(e) => setLocalFilters((f) => ({ ...f, occasionTag: e.target.value }))}
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
                onChange={(e) => setLocalFilters((f) => ({ ...f, city: e.target.value }))}
              />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  className={styles.inputN}
                  type="number"
                  min="0"
                  placeholder={facets.priceMin ? `Min (ex: ${Math.floor(facets.priceMin)})` : "Min (RON)"}
                  value={localFilters.minPrice}
                  onChange={(e) => setLocalFilters((f) => ({ ...f, minPrice: e.target.value }))}
                />
                <input
                  className={styles.inputN}
                  type="number"
                  min="0"
                  placeholder={facets.priceMax ? `Max (ex: ${Math.ceil(facets.priceMax)})` : "Max (RON)"}
                  value={localFilters.maxPrice}
                  onChange={(e) => setLocalFilters((f) => ({ ...f, maxPrice: e.target.value }))}
                />
              </div>

              <select
                className={styles.select}
                value={localFilters.availability}
                onChange={(e) => setLocalFilters((f) => ({ ...f, availability: e.target.value }))}
                aria-label="Disponibilitate"
              >
                <option value="">Toate disponibilitățile</option>
                <option value="READY">Gata de livrare</option>
                <option value="MADE_TO_ORDER">La comandă</option>
                <option value="PREORDER">Precomandă</option>
                <option value="SOLD_OUT">Epuizat</option>
              </select>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className={styles.inputN}
                  type="number"
                  min="1"
                  placeholder="Execuție max (zile)"
                  value={localFilters.leadTimeMax}
                  onChange={(e) => setLocalFilters((f) => ({ ...f, leadTimeMax: e.target.value }))}
                />
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={localFilters.acceptsCustom}
                    onChange={(e) => setLocalFilters((f) => ({ ...f, acceptsCustom: e.target.checked }))}
                  />{" "}
                  Personalizabile
                </label>
              </div>

              <select
                className={styles.select}
                value={localFilters.sort}
                onChange={(e) => setLocalFilters((f) => ({ ...f, sort: e.target.value }))}
                disabled={!!ids}
                title={ids ? "Sortarea este fixă (ordine de similaritate)" : "Sortează"}
              >
                {SORTS.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </select>

              <div className={styles.filterActions}>
                <button type="button" className={styles.btnApply} onClick={applyFilters}>
                  Aplică filtre
                </button>
                <button type="button" className={styles.btnReset} onClick={resetFilters}>
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
          {itemsNormalized.length === 0 ? (
            <EmptyState />
          ) : (
            <div className={styles.grid}>
              {itemsNormalized.map((p) => {
                const ownerUserId = p?.service?.vendor?.userId;
                const isOwner = !!me && !!ownerUserId && (me.id === ownerUserId || me.sub === ownerUserId);
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
                  />
                );
              })}
            </div>
          )}

          {/* sentinel pt. infinite scroll */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {isLoadingMore && <div className={styles.loading}>Se încarcă mai multe produse…</div>}

          {!hasMore && (total ?? 0) > 0 && (
            <div className={styles.resultsInfo}>Ai ajuns la finalul listei de produse.</div>
          )}
        </>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>Nu am găsit produse pentru filtrele alese.</div>
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
        <button key={key} type="button" className={styles.chip} onClick={() => removeKey(key)}>
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

function SmartSearchSummary({ q, smart, applied, categoryParam, onApplySmartCategory }) {
  if (!smart && !applied && !q) return null;

  const categoryFromSmart = smart?.inferredCategory && !categoryParam && !applied?.category;

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
          {categoryFromSmart && <span style={{ fontSize: 11, opacity: 0.7 }}> (dedusă din text)</span>}
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

      {applied?.acceptsCustom && <span className={styles.chip}>Personalizabile</span>}

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
        <span className={styles.smartSummaryText}>Cuvinte cheie folosite: {smart.mustTextTokens.join(", ")}</span>
      )}
    </div>
  );
}
