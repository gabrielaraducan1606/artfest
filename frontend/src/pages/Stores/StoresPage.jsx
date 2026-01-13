// src/pages/Stores/StoresPage.jsx
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  useSearchParams,
  useNavigate,
} from "react-router-dom";
import { api } from "../../lib/api";
import styles from "./StoresPage.module.css";
import {
  FaSearch,
  FaUndoAlt,
  FaFilter,
  FaTimes,
} from "react-icons/fa";

const SORTS = [
  { v: "new", label: "Cele mai noi" },
  { v: "popular", label: "Populare" },
  { v: "name_asc", label: "Nume A–Z" },
  { v: "name_desc", label: "Nume Z–A" },
];

export default function StoresPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // === query params din URL ===
  const qParam = params.get("q") || "";
  const cityParam = params.get("city") || ""; // slug
  const sortParam = params.get("sort") || "new";

  const limit = 24;

  // === state listă ===
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null); // ✅ null când nu e furnizat
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // === infinite scroll ===
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // sentinel pentru IntersectionObserver
  const sentinelRef = useRef(null);
  const ioRef = useRef(null);

  // === orașe pentru filtre ===
  const [cityOptions, setCityOptions] = useState([]);
  const cityLabelMap = useMemo(() => {
    const map = new Map();
    cityOptions.forEach((c) => map.set(c.slug, c.label));
    return map;
  }, [cityOptions]);

  // === filtre locale ===
  const [localFilters, setLocalFilters] = useState({
    q: qParam,
    city: cityParam,
    sort: sortParam,
  });

  const [filtersOpen, setFiltersOpen] = useState(false);

  // === autocomplete sugestii ===
  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const searchAreaRef = useRef(null);

  // sync URL -> filtre locale + reset listă
  useEffect(() => {
    setLocalFilters({ q: qParam, city: cityParam, sort: sortParam });
    setItems([]);
    setPage(1);
    setHasMore(true);
    setTotal(null);
  }, [qParam, cityParam, sortParam]);

  // Escape modal
  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e) => e.key === "Escape" && setFiltersOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  // load cities once
  useEffect(() => {
    (async () => {
      try {
        const res = await api("/api/public/stores/cities");
        setCityOptions(res?.cities || []);
      } catch (e) {
        console.error("load cities error", e);
        setCityOptions([]);
      }
    })();
  }, []);

  const load = useCallback(
    async (pageToLoad = 1, append = false) => {
      if (pageToLoad === 1 && !append) setLoading(true);
      else setIsLoadingMore(true);

      setError(null);

      try {
        const p = new URLSearchParams();
        p.set("page", String(pageToLoad));
        p.set("limit", String(limit));
        if (qParam) p.set("q", qParam);
        if (cityParam) p.set("city", cityParam);
        if (sortParam) p.set("sort", sortParam);

        const res = await api(`/api/public/stores?${p.toString()}`);

        const newItems = Array.isArray(res?.items) ? res.items : [];
        const apiHasMore = !!res?.hasMore;

        setItems((prev) => (append ? [...prev, ...newItems] : newItems));
        setHasMore(apiHasMore);

        // total doar când vine (page=1)
        setTotal(typeof res?.total === "number" ? res.total : null);
      } catch (e) {
        console.error(e);
        setError("A apărut o eroare la încărcarea magazinelor.");
        if (!append) {
          setItems([]);
          setTotal(null);
        }
        setHasMore(false);
      } finally {
        if (pageToLoad === 1 && !append) setLoading(false);
        else setIsLoadingMore(false);
      }
    },
    [qParam, cityParam, sortParam]
  );

  // prima pagină când se schimbă filtrele
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
        const data = await api(`/api/public/stores/suggest?q=${encodeURIComponent(q)}`);
        setSuggestions(data || null);
      } catch (e) {
        console.error("store suggest error", e);
        setSuggestions(null);
      } finally {
        setSuggestLoading(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [localFilters.q]);

  // click outside -> close suggestions
  useEffect(() => {
    if (!suggestions) return;
    const handleClickOutside = (e) => {
      if (!searchAreaRef.current) return;
      if (searchAreaRef.current.contains(e.target)) return;
      setSuggestions(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [suggestions]);

  const applyFilters = () => {
    const f = localFilters;
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.city) p.set("city", f.city);
    if (f.sort) p.set("sort", f.sort);

    setFiltersOpen(false);
    setSuggestions(null);
    navigate(`/magazine?${p.toString()}`);
  };

  const resetFilters = () => {
    setLocalFilters({ q: "", city: "", sort: "new" });
    setFiltersOpen(false);
    setSuggestions(null);
    navigate("/magazine");
  };

  const handleSuggestionClick = (store) => {
    setSuggestions(null);
    const to = store.profileSlug
      ? `/magazin/${encodeURIComponent(store.profileSlug)}`
      : `/magazin/${store.id}`;
    navigate(to);
  };

  // ✅ IntersectionObserver infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;

    // dacă nu mai avem, oprim
    if (!hasMore || loading || isLoadingMore) return;

    // cleanup vechi observer
    if (ioRef.current) {
      ioRef.current.disconnect();
      ioRef.current = null;
    }

    ioRef.current = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        // evităm multiple increments
        setPage((prev) => prev + 1);
      },
      { root: null, rootMargin: "800px", threshold: 0.01 }
    );

    ioRef.current.observe(sentinelRef.current);

    return () => {
      if (ioRef.current) ioRef.current.disconnect();
      ioRef.current = null;
    };
  }, [hasMore, loading, isLoadingMore, items.length]);

  // când crește page (>1), încarcă următoarea pagină
  useEffect(() => {
    if (page === 1) return;
    load(page, true);
  }, [page, load]);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headTop}>
          <h1 className={styles.h1}>Magazine</h1>
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.iconCircle}
              onClick={() => setFiltersOpen(true)}
              title="Filtrează magazine"
              aria-label="Filtrează magazine"
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
          ref={searchAreaRef}
          className={styles.searchRow}
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters();
          }}
        >
          <div className={styles.searchShell}>
            <button
              type="submit"
              className={styles.searchIconBtn}
              aria-label="Caută magazine"
            >
              <FaSearch />
            </button>

            <input
              className={`${styles.input} ${styles.searchInput}`}
              placeholder="Caută magazine după nume sau descriere…"
              value={localFilters.q}
              onChange={(e) =>
                setLocalFilters((f) => ({ ...f, q: e.target.value }))
              }
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Escape") setSuggestions(null);
              }}
            />
          </div>

          {localFilters.q &&
            localFilters.q.length >= 2 &&
            (suggestLoading || suggestions) && (
              <div className={styles.suggestBox}>
                {suggestLoading && (
                  <div className={styles.suggestLoading}>
                    Se încarcă sugestiile…
                  </div>
                )}

                {!suggestLoading &&
                  suggestions?.stores &&
                  suggestions.stores.length > 0 && (
                    <div className={styles.suggestList}>
                      {suggestions.stores.map((s) => {
                        const title = s.storeName || s.displayName || "Magazin";
                        const subtitle = [s.city].filter(Boolean).join(" • ");
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={styles.suggestItem}
                            onClick={() => handleSuggestionClick(s)}
                          >
                            {s.logoUrl && (
                              <img
                                src={s.logoUrl}
                                alt={title}
                                className={styles.suggestThumb}
                              />
                            )}
                            <div className={styles.suggestText}>
                              <div className={styles.suggestTitle}>{title}</div>
                              {subtitle && (
                                <div className={styles.suggestSubtitle}>
                                  {subtitle}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                {!suggestLoading &&
                  (!suggestions?.stores || suggestions.stores.length === 0) && (
                    <div className={styles.suggestEmpty}>
                      Nu avem sugestii pentru „{localFilters.q}”.
                    </div>
                  )}
              </div>
            )}
        </form>

        <FilterSummary
          q={qParam}
          citySlug={cityParam}
          sort={sortParam}
          cityLabelMap={cityLabelMap}
        />
      </header>

      {/* total doar dacă există */}
      {!loading && !error && typeof total === "number" && total > 0 && (
        <div className={styles.resultsInfo}>
          {total === 1 ? "1 magazin găsit." : `${total} magazine găsite.`}
        </div>
      )}

      {filtersOpen && (
        <div
          className={styles.filtersOverlay}
          onClick={() => setFiltersOpen(false)}
        >
          <div
            className={styles.filtersModal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="stores-filters-title"
          >
            <div className={styles.filtersModalHead}>
              <h2 className={styles.filtersTitle} id="stores-filters-title">
                Filtre magazine
              </h2>
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
                placeholder="Caută magazine…"
                value={localFilters.q}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, q: e.target.value }))
                }
              />

              <select
                className={styles.select}
                value={localFilters.city}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, city: e.target.value }))
                }
              >
                <option value="">Toate orașele</option>
                {cityOptions.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>

              <select
                className={styles.select}
                value={localFilters.sort}
                onChange={(e) =>
                  setLocalFilters((f) => ({ ...f, sort: e.target.value }))
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
        <div className={styles.loading}>Se încarcă…</div>
      ) : error ? (
        <div className={styles.errorBox}>{error}</div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <ul className={styles.grid}>
            {items.map((s) => (
              <StoreCard
                key={s.id}
                s={s}
                onClick={() => {
                  const to = s.profileSlug
                    ? `/magazin/${encodeURIComponent(s.profileSlug)}`
                    : `/magazin/${s.id}`;
                  navigate(to);
                }}
              />
            ))}
          </ul>

          {isLoadingMore && (
            <div className={styles.loading}>
              Se încarcă mai multe magazine…
            </div>
          )}

          {/* sentinel pentru IO */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {!hasMore && (typeof total !== "number" ? items.length > 0 : total > 0) && (
            <div className={styles.resultsInfo}>
              Ai ajuns la finalul listei.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StoreCard({ s, onClick }) {
  const title = s.storeName || s.displayName || "Magazin";
  const subtitle = [s.city, s.category].filter(Boolean).join(" • ");

  return (
    <li className={styles.card}>
      <button className={styles.cardLink} onClick={onClick} aria-label={title}>
        <div className={styles.thumbWrap}>
          <img
            src={s.logoUrl || "/placeholder-store.png"}
            alt={title}
            className={styles.thumb}
            loading="lazy"
          />
        </div>
        <div className={styles.cardBody}>
          <div className={styles.title} title={title}>
            {title}
          </div>
          {subtitle && <div className={styles.meta}>{subtitle}</div>}
          <div className={styles.badges}>
            <span className={styles.badge}>
              {s.productsCount} {s.productsCount === 1 ? "produs" : "produse"}
            </span>
          </div>
          {s.about && (
            <p className={styles.about} title={s.about}>
              {s.about}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyTitle}>
        Nu am găsit magazine pentru filtrele alese.
      </div>
      <a className={styles.btnPrimary} href="/magazine">
        Resetează filtrele
      </a>
    </div>
  );
}

function FilterSummary({ q, citySlug, sort, cityLabelMap }) {
  if (!q && !citySlug && !sort) return null;

  const sortLabelMap = {
    new: "Cele mai noi",
    popular: "Populare",
    name_asc: "Nume A–Z",
    name_desc: "Nume Z–A",
  };

  const cityLabel = citySlug ? cityLabelMap.get(citySlug) || citySlug : "";

  return (
    <div className={styles.chipWrap}>
      {q && (
        <span className={styles.chip}>
          <strong>Cauți:</strong> „{q}”
        </span>
      )}
      {cityLabel && (
        <span className={styles.chip}>
          <strong>Oraș:</strong> {cityLabel}
        </span>
      )}
      {sort && (
        <span className={styles.chip}>
          <strong>Sortare:</strong> {sortLabelMap[sort] || sort}
        </span>
      )}
    </div>
  );
}
