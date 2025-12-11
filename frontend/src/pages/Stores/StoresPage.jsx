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

  // === query params din URL (fără page) ===
  const qParam = params.get("q") || "";
  const cityParam = params.get("city") || ""; // slug
  const sortParam = params.get("sort") || "new";

  const limit = 24;

  // === state listă ===
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true); // pentru prima pagină
  const [error, setError] = useState(null);

  // === infinite scroll ===
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // === orașe pentru filtre (slug + label) ===
  const [cityOptions, setCityOptions] = useState([]);
  const cityLabelMap = useMemo(() => {
    const map = new Map();
    cityOptions.forEach((c) => {
      map.set(c.slug, c.label);
    });
    return map;
  }, [cityOptions]);

  // === filtre locale (nu lovim API-ul la fiecare tastă) ===
  const [localFilters, setLocalFilters] = useState({
    q: qParam,
    city: cityParam, // slug
    sort: sortParam,
  });

  // === modal filtre ===
  const [filtersOpen, setFiltersOpen] = useState(false);

  // === autocomplete sugestii ===
  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  // ref pentru zona de căutare + dropdown sugestii
  const searchAreaRef = useRef(null);

  // sincronizează filtrele locale când se schimbă URL-ul
  useEffect(() => {
    setLocalFilters({
      q: qParam,
      city: cityParam, // slug
      sort: sortParam,
    });
    // când se schimbă filtrele, resetăm listă + paginare
    setItems([]);
    setPage(1);
    setHasMore(true);
  }, [qParam, cityParam, sortParam]);

  // închide modal la Escape
  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setFiltersOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  // === încărcare orașe (o singură dată) ===
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

  // === funcție de load generică (folosită pentru prima pagină + load mai multe) ===
  const load = useCallback(
    async (pageToLoad = 1, append = false) => {
      if (pageToLoad === 1 && !append) {
        setLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      try {
        const p = new URLSearchParams();
        p.set("page", String(pageToLoad));
        p.set("limit", String(limit));
        if (qParam) p.set("q", qParam);
        if (cityParam) p.set("city", cityParam); // slug
        if (sortParam) p.set("sort", sortParam);

        const res = await api(`/api/public/stores?${p.toString()}`);
        const newItems = res?.items || [];
        const totalFromApi = res?.total || 0;

        setItems((prev) =>
          append ? [...prev, ...newItems] : newItems
        );
        setTotal(totalFromApi);

        const totalPages = Math.max(
          1,
          Math.ceil(totalFromApi / limit)
        );
        setHasMore(pageToLoad < totalPages);
      } catch (e) {
        console.error(e);
        setError("A apărut o eroare la încărcarea magazinelor.");
        if (!append) {
          setItems([]);
          setTotal(0);
        }
        setHasMore(false);
      } finally {
        if (pageToLoad === 1 && !append) {
          setLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }
    },
    [qParam, cityParam, sortParam]
  );

  // === încarcă prima pagină atunci când se schimbă filtrele (sau la mount) ===
  useEffect(() => {
    load(1, false);
  }, [load, qParam, cityParam, sortParam]);

  // === autocomplete: sugestii magazine pentru q ===
  useEffect(() => {
    const q = (localFilters.q || "").trim();

    if (!q || q.length < 2) {
      setSuggestions(null);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        setSuggestLoading(true);
        const data = await api(
          `/api/public/stores/suggest?q=${encodeURIComponent(
            q
          )}`
        );
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

  // === Închide sugestiile la click în afara barei de căutare ===
  useEffect(() => {
    if (!suggestions) return;

    const handleClickOutside = (e) => {
      if (!searchAreaRef.current) return;
      if (searchAreaRef.current.contains(e.target)) return;
      setSuggestions(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );
  }, [suggestions]);

  // === Aplică filtre (scrie în URL, resetează implicit page la 1) ===
  const applyFilters = () => {
    const f = localFilters;
    const p = new URLSearchParams();

    if (f.q) p.set("q", f.q);
    if (f.city) p.set("city", f.city); // slug
    if (f.sort) p.set("sort", f.sort);

    // nu mai avem page în URL; pagina 1 e implicit
    setFiltersOpen(false);
    setSuggestions(null);
    navigate(`/magazine?${p.toString()}`);
  };

  // === Reset filtre ===
  const resetFilters = () => {
    setLocalFilters({
      q: "",
      city: "",
      sort: "new",
    });
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

  // === Infinite scroll: când ajungem aproape de bottom, încărcăm pagina următoare ===
  useEffect(() => {
    if (!hasMore) return;

    const handleScroll = () => {
      const scrollPosition =
        window.innerHeight + window.scrollY;
      const threshold = document.body.offsetHeight - 400;

      if (
        scrollPosition >= threshold &&
        !loading &&
        !isLoadingMore &&
        hasMore
      ) {
        setPage((prev) => prev + 1);
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [loading, isLoadingMore, hasMore]);

  // când page crește (>1), încărcăm următoarea pagină și concatenăm
  useEffect(() => {
    if (page === 1) return;
    load(page, true);
  }, [page, load]);

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        {/* titlu + butoane icon (filtre / reset) */}
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

        {/* bara de căutare principală (pilulă) – caută full-text magazine */}
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
                setLocalFilters((f) => ({
                  ...f,
                  q: e.target.value,
                }))
              }
              autoComplete="off"
            />
          </div>

          {/* 🔍 dropdown sugestii (autocomplete) */}
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
                        const title =
                          s.storeName ||
                          s.displayName ||
                          "Magazin";
                        const subtitle = [s.city]
                          .filter(Boolean)
                          .join(" • ");
                        return (
                          <button
                            key={s.id}
                            type="button"
                            className={styles.suggestItem}
                            onClick={() =>
                              handleSuggestionClick(s)
                            }
                          >
                            {s.logoUrl && (
                              <img
                                src={s.logoUrl}
                                alt={title}
                                className={styles.suggestThumb}
                              />
                            )}
                            <div className={styles.suggestText}>
                              <div className={styles.suggestTitle}>
                                {title}
                              </div>
                              {subtitle && (
                                <div
                                  className={
                                    styles.suggestSubtitle
                                  }
                                >
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
                  (!suggestions ||
                    !suggestions.stores ||
                    suggestions.stores.length === 0) && (
                    <div className={styles.suggestEmpty}>
                      Nu avem sugestii pentru „
                      {localFilters.q}”.
                    </div>
                  )}
              </div>
            )}
        </form>

        {/* mic rezumat filtre (chip-uri) */}
        <FilterSummary
          q={qParam}
          citySlug={cityParam}
          sort={sortParam}
          cityLabelMap={cityLabelMap}
        />
      </header>

      {/* info despre numărul de rezultate */}
      {!loading && !error && total > 0 && (
        <div className={styles.resultsInfo}>
          {total === 1
            ? "1 magazin găsit."
            : `${total} magazine găsite.`}
        </div>
      )}

      {/* === MODAL FILTRE (q + city + sort) === */}
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
              <h2
                className={styles.filtersTitle}
                id="stores-filters-title"
              >
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
              {/* Căutare text */}
              <input
                className={styles.input}
                placeholder="Caută magazine…"
                value={localFilters.q}
                onChange={(e) =>
                  setLocalFilters((f) => ({
                    ...f,
                    q: e.target.value,
                  }))
                }
              />

              {/* Oraș (dropdown cu slug + label) */}
              <select
                className={styles.select}
                value={localFilters.city}
                onChange={(e) =>
                  setLocalFilters((f) => ({
                    ...f,
                    city: e.target.value,
                  }))
                }
              >
                <option value="">Toate orașele</option>
                {cityOptions.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>

              {/* Sortare */}
              <select
                className={styles.select}
                value={localFilters.sort}
                onChange={(e) =>
                  setLocalFilters((f) => ({
                    ...f,
                    sort: e.target.value,
                  }))
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
                    ? `/magazin/${encodeURIComponent(
                        s.profileSlug
                      )}`
                    : `/magazin/${s.id}`;
                  navigate(to);
                }}
              />
            ))}
          </ul>

          {/* Loader mic la final când încărcăm încă o pagină */}
          {isLoadingMore && (
            <div className={styles.loading}>
              Se încarcă mai multe magazine…
            </div>
          )}

          {!hasMore && total > 0 && (
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
  const subtitle = [s.city, s.category]
    .filter(Boolean)
    .join(" • ");
  return (
    <li className={styles.card}>
      <button
        className={styles.cardLink}
        onClick={onClick}
        aria-label={title}
      >
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
          {subtitle && (
            <div className={styles.meta}>{subtitle}</div>
          )}
          <div className={styles.badges}>
            <span className={styles.badge}>
              {s.productsCount}{" "}
              {s.productsCount === 1 ? "produs" : "produse"}
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

// Mic rezumat text al filtrelor active
function FilterSummary({ q, citySlug, sort, cityLabelMap }) {
  if (!q && !citySlug && !sort) return null;

  const sortLabelMap = {
    new: "Cele mai noi",
    popular: "Populare",
    name_asc: "Nume A–Z",
    name_desc: "Nume Z–A",
  };

  const cityLabel = citySlug
    ? cityLabelMap.get(citySlug) || citySlug
    : "";

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
          <strong>Sortare:</strong>{" "}
          {sortLabelMap[sort] || sort}
        </span>
      )}
    </div>
  );
}
