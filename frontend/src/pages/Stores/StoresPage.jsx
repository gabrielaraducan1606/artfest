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
import {
  useSmartPrefetchItem,
  useVisibleStableTrigger,
} from "../../hooks/useSmartPrefetch.js";

import styles from "./StoresPage.module.css";

import {
  FaSearch,
  FaUndoAlt,
  FaFilter,
  FaTimes,
} from "react-icons/fa";

/* =========================================================
   SORT
========================================================= */

const SORTS = [
  {
    v: "new",
    label: "Cele mai noi",
  },
  {
    v: "popular",
    label: "Populare",
  },
  {
    v: "name_asc",
    label: "Nume A–Z",
  },
  {
    v: "name_desc",
    label: "Nume Z–A",
  },
];

const LIMIT = 24;

/* =========================================================
   COMPONENT
========================================================= */

export default function StoresPage({
  embedded = false,
}) {
  const navigate =
    useNavigate();

  const [params] =
    useSearchParams();

  /* =======================================================
     NAVIGARE FILTRE

     Normal:
       /magazine?q=...

     Embedded:
       /ruta-mobile-categories?tab=magazine&q=...
  ======================================================= */

  const goToStoresParams =
    useCallback(
      (
        nextParams,
        options = {}
      ) => {
        const p =
          nextParams instanceof
          URLSearchParams
            ? new URLSearchParams(
                nextParams
              )
            : new URLSearchParams(
                nextParams ||
                  ""
              );

        if (embedded) {
          p.set(
            "tab",
            "magazine"
          );
        } else {
          p.delete(
            "tab"
          );
        }

        const query =
          p.toString();

        const pathname =
          embedded
            ? window.location
                .pathname
            : "/magazine";

        navigate(
          query
            ? `${pathname}?${query}`
            : pathname,
          options
        );
      },
      [
        embedded,
        navigate,
      ]
    );

  /* =======================================================
     QUERY PARAMS
  ======================================================= */

  const qParam =
    params.get("q") || "";

  const cityParam =
    params.get("city") ||
    "";

  const sortParam =
    params.get("sort") ||
    "new";

  /* =======================================================
     STATE LISTĂ
  ======================================================= */

  const [
    items,
    setItems,
  ] = useState([]);

  const [
    total,
    setTotal,
  ] = useState(null);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState(null);

  /* =======================================================
     INFINITE SCROLL
  ======================================================= */

  const [
    page,
    setPage,
  ] = useState(1);

  const [
    hasMore,
    setHasMore,
  ] = useState(true);

  const [
    isLoadingMore,
    setIsLoadingMore,
  ] = useState(false);

  const sentinelRef =
    useRef(null);

  const ioRef =
    useRef(null);

  /* =======================================================
     ORAȘE
  ======================================================= */

  const [
    cityOptions,
    setCityOptions,
  ] = useState([]);

  const cityLabelMap =
    useMemo(() => {
      const map =
        new Map();

      cityOptions.forEach(
        (city) => {
          map.set(
            city.slug,
            city.label
          );
        }
      );

      return map;
    }, [cityOptions]);

  /* =======================================================
     FILTRE LOCALE
  ======================================================= */

  const [
    localFilters,
    setLocalFilters,
  ] = useState({
    q: qParam,
    city: cityParam,
    sort: sortParam,
  });

  const [
    filtersOpen,
    setFiltersOpen,
  ] = useState(false);

  /* =======================================================
     AUTOCOMPLETE
  ======================================================= */

  const [
    suggestions,
    setSuggestions,
  ] = useState(null);

  const [
    suggestLoading,
    setSuggestLoading,
  ] = useState(false);

  const searchAreaRef =
    useRef(null);

  /* =======================================================
     SYNC URL -> FILTRE
  ======================================================= */

  useEffect(() => {
    setLocalFilters({
      q: qParam,
      city: cityParam,
      sort: sortParam,
    });

    setItems([]);

    setPage(1);

    setHasMore(true);

    setTotal(null);
  }, [
    qParam,
    cityParam,
    sortParam,
  ]);

  /* =======================================================
     ESCAPE MODAL
  ======================================================= */

  useEffect(() => {
    if (!filtersOpen) {
      return;
    }

    const onKey = (
      event
    ) => {
      if (
        event.key ===
        "Escape"
      ) {
        setFiltersOpen(
          false
        );
      }
    };

    window.addEventListener(
      "keydown",
      onKey
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onKey
      );
    };
  }, [filtersOpen]);

  /* =======================================================
     LOAD CITIES
  ======================================================= */

  useEffect(() => {
    let alive = true;

    const loadCities =
      async () => {
        try {
          const res =
            await api(
              "/api/public/stores/cities"
            );

          if (!alive) {
            return;
          }

          setCityOptions(
            Array.isArray(
              res?.cities
            )
              ? res.cities
              : []
          );
        } catch (error) {
          console.error(
            "load cities error",
            error
          );

          if (!alive) {
            return;
          }

          setCityOptions(
            []
          );
        }
      };

    loadCities();

    return () => {
      alive = false;
    };
  }, []);

  /* =======================================================
     LOAD STORES
  ======================================================= */

  const load =
    useCallback(
      async (
        pageToLoad = 1,
        append = false
      ) => {
        if (
          pageToLoad === 1 &&
          !append
        ) {
          setLoading(
            true
          );
        } else {
          setIsLoadingMore(
            true
          );
        }

        setError(null);

        try {
          const p =
            new URLSearchParams();

          p.set(
            "page",
            String(
              pageToLoad
            )
          );

          p.set(
            "limit",
            String(LIMIT)
          );

          if (qParam) {
            p.set(
              "q",
              qParam
            );
          }

          if (cityParam) {
            p.set(
              "city",
              cityParam
            );
          }

          if (sortParam) {
            p.set(
              "sort",
              sortParam
            );
          }

          const res =
            await api(
              `/api/public/stores?${p.toString()}`
            );

          const newItems =
            Array.isArray(
              res?.items
            )
              ? res.items
              : [];

          const apiHasMore =
            !!res?.hasMore;

          setItems(
            (prev) =>
              append
                ? [
                    ...prev,
                    ...newItems,
                  ]
                : newItems
          );

          setHasMore(
            apiHasMore
          );

          setTotal(
            typeof res?.total ===
              "number"
              ? res.total
              : null
          );
        } catch (error) {
          console.error(
            "Stores load error:",
            error
          );

          setError(
            "A apărut o eroare la încărcarea magazinelor."
          );

          if (!append) {
            setItems([]);

            setTotal(null);
          }

          setHasMore(
            false
          );
        } finally {
          if (
            pageToLoad === 1 &&
            !append
          ) {
            setLoading(
              false
            );
          } else {
            setIsLoadingMore(
              false
            );
          }
        }
      },
      [
        qParam,
        cityParam,
        sortParam,
      ]
    );

  /* =======================================================
     PRIMA PAGINĂ
  ======================================================= */

  useEffect(() => {
    load(
      1,
      false
    );
  }, [load]);

  /* =======================================================
     AUTOCOMPLETE
  ======================================================= */

  useEffect(() => {
    const q =
      (
        localFilters.q ||
        ""
      ).trim();

    if (
      !q ||
      q.length < 2
    ) {
      setSuggestions(
        null
      );

      setSuggestLoading(
        false
      );

      return;
    }

    const handle =
      window.setTimeout(
        async () => {
          try {
            setSuggestLoading(
              true
            );

            const data =
              await api(
                `/api/public/stores/suggest?q=${encodeURIComponent(
                  q
                )}`
              );

            setSuggestions(
              data || null
            );
          } catch (
            error
          ) {
            console.error(
              "store suggest error",
              error
            );

            setSuggestions(
              null
            );
          } finally {
            setSuggestLoading(
              false
            );
          }
        },
        250
      );

    return () => {
      window.clearTimeout(
        handle
      );
    };
  }, [
    localFilters.q,
  ]);

  /* =======================================================
     CLICK OUTSIDE SUGGESTIONS
  ======================================================= */

  useEffect(() => {
    if (!suggestions) {
      return;
    }

    const handleClickOutside =
      (event) => {
        if (
          !searchAreaRef.current
        ) {
          return;
        }

        if (
          searchAreaRef.current.contains(
            event.target
          )
        ) {
          return;
        }

        setSuggestions(
          null
        );
      };

    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    document.addEventListener(
      "touchstart",
      handleClickOutside
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );

      document.removeEventListener(
        "touchstart",
        handleClickOutside
      );
    };
  }, [suggestions]);

  /* =======================================================
     APPLY FILTERS
  ======================================================= */

  const applyFilters =
    useCallback(() => {
      const f =
        localFilters;

      const p =
        new URLSearchParams();

      if (f.q) {
        p.set(
          "q",
          f.q
        );
      }

      if (f.city) {
        p.set(
          "city",
          f.city
        );
      }

      if (f.sort) {
        p.set(
          "sort",
          f.sort
        );
      }

      setFiltersOpen(
        false
      );

      setSuggestions(
        null
      );

      goToStoresParams(
        p
      );
    }, [
      localFilters,
      goToStoresParams,
    ]);

  /* =======================================================
     RESET FILTERS
  ======================================================= */

  const resetFilters =
    useCallback(() => {
      setLocalFilters({
        q: "",
        city: "",
        sort: "new",
      });

      setFiltersOpen(
        false
      );

      setSuggestions(
        null
      );

      goToStoresParams(
        new URLSearchParams()
      );
    }, [
      goToStoresParams,
    ]);

  /* =======================================================
     CLICK SUGGESTION
  ======================================================= */

  const handleSuggestionClick =
    useCallback(
      (store) => {
        setSuggestions(
          null
        );

        const to =
          store.profileSlug
            ? `/magazin/${encodeURIComponent(
                store.profileSlug
              )}`
            : `/magazin/${store.id}`;

        navigate(to);
      },
      [navigate]
    );

  /* =======================================================
     INFINITE SCROLL
  ======================================================= */

  useEffect(() => {
    const element =
      sentinelRef.current;

    if (!element) {
      return;
    }

    if (
      !hasMore ||
      loading ||
      isLoadingMore
    ) {
      return;
    }

    if (
      ioRef.current
    ) {
      ioRef.current.disconnect();

      ioRef.current =
        null;
    }

    ioRef.current =
      new IntersectionObserver(
        (entries) => {
          const first =
            entries[0];

          if (
            !first?.isIntersecting
          ) {
            return;
          }

          setPage(
            (prev) =>
              prev + 1
          );
        },
        {
          root: null,

          /*
           * Nu încărcăm pagina următoare
           * mult prea devreme.
           */
          rootMargin:
            "450px 0px",

          threshold: 0,
        }
      );

    ioRef.current.observe(
      element
    );

    return () => {
      if (
        ioRef.current
      ) {
        ioRef.current.disconnect();
      }

      ioRef.current =
        null;
    };
  }, [
    hasMore,
    loading,
    isLoadingMore,
    items.length,
  ]);

  /* =======================================================
     LOAD NEXT PAGE
  ======================================================= */

  useEffect(() => {
    if (
      page === 1
    ) {
      return;
    }

    load(
      page,
      true
    );
  }, [
    page,
    load,
  ]);

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <section
      className={
        styles.page
      }
    >
      {/* =================================================
          HEADER
      ================================================= */}

      <header
        className={
          styles.head
        }
      >
        {/* HEADER NORMAL */}

        {!embedded && (
          <div
            className={
              styles.headTop
            }
          >
            <h1
              className={
                styles.h1
              }
            >
              Magazine
            </h1>

            <div
              className={
                styles.headActions
              }
            >
              <button
                type="button"
                className={
                  styles.iconCircle
                }
                onClick={() =>
                  setFiltersOpen(
                    true
                  )
                }
                title="Filtrează magazine"
                aria-label="Filtrează magazine"
              >
                <FaFilter />
              </button>

              <button
                type="button"
                className={
                  styles.iconCircle
                }
                onClick={
                  resetFilters
                }
                title="Resetează filtrele"
                aria-label="Resetează filtrele"
              >
                <FaUndoAlt />
              </button>
            </div>
          </div>
        )}

        {/* HEADER EMBEDDED */}

        {embedded && (
          <div
            className={
              styles.embeddedStoresToolbar
            }
          >
            <span>
              Descoperă
              magazine
            </span>

            <div
              className={
                styles.headActions
              }
            >
              <button
                type="button"
                className={
                  styles.iconCircle
                }
                onClick={() =>
                  setFiltersOpen(
                    true
                  )
                }
                title="Filtrează magazine"
                aria-label="Filtrează magazine"
              >
                <FaFilter />
              </button>

              <button
                type="button"
                className={
                  styles.iconCircle
                }
                onClick={
                  resetFilters
                }
                title="Resetează filtrele"
                aria-label="Resetează filtrele"
              >
                <FaUndoAlt />
              </button>
            </div>
          </div>
        )}

        {/* SEARCH */}

        <form
          ref={
            searchAreaRef
          }
          className={
            styles.searchRow
          }
          onSubmit={(
            event
          ) => {
            event.preventDefault();

            applyFilters();
          }}
        >
          <div
            className={
              styles.searchShell
            }
          >
            <button
              type="submit"
              className={
                styles.searchIconBtn
              }
              aria-label="Caută magazine"
            >
              <FaSearch />
            </button>

            <input
              className={`${styles.input} ${styles.searchInput}`}
              placeholder="Caută magazine după nume sau descriere…"
              value={
                localFilters.q
              }
              onChange={(
                event
              ) =>
                setLocalFilters(
                  (prev) => ({
                    ...prev,
                    q:
                      event
                        .target
                        .value,
                  })
                )
              }
              autoComplete="off"
              onKeyDown={(
                event
              ) => {
                if (
                  event.key ===
                  "Escape"
                ) {
                  setSuggestions(
                    null
                  );
                }
              }}
            />
          </div>

          {/* SUGGESTIONS */}

          {localFilters.q &&
            localFilters.q
              .length >= 2 &&
            (
              suggestLoading ||
              suggestions
            ) && (
              <div
                className={
                  styles.suggestBox
                }
              >
                {suggestLoading && (
                  <div
                    className={
                      styles.suggestLoading
                    }
                  >
                    Se încarcă
                    sugestiile…
                  </div>
                )}

                {!suggestLoading &&
                  suggestions
                    ?.stores &&
                  suggestions
                    .stores
                    .length >
                    0 && (
                    <div
                      className={
                        styles.suggestList
                      }
                    >
                      {suggestions.stores.map(
                        (
                          store
                        ) => {
                          const title =
                            store.storeName ||
                            store.displayName ||
                            "Magazin";

                          const subtitle =
                            [
                              store.city,
                            ]
                              .filter(
                                Boolean
                              )
                              .join(
                                " • "
                              );

                          return (
                            <button
                              key={
                                store.id
                              }
                              type="button"
                              className={
                                styles.suggestItem
                              }
                              onClick={() =>
                                handleSuggestionClick(
                                  store
                                )
                              }
                            >
                              {store.logoUrl && (
                                <img
                                  src={
                                    store.logoUrl
                                  }
                                  alt={
                                    title
                                  }
                                  className={
                                    styles.suggestThumb
                                  }
                                  loading="lazy"
                                  decoding="async"
                                />
                              )}

                              <div
                                className={
                                  styles.suggestText
                                }
                              >
                                <div
                                  className={
                                    styles.suggestTitle
                                  }
                                >
                                  {
                                    title
                                  }
                                </div>

                                {subtitle && (
                                  <div
                                    className={
                                      styles.suggestSubtitle
                                    }
                                  >
                                    {
                                      subtitle
                                    }
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        }
                      )}
                    </div>
                  )}

                {!suggestLoading &&
                  (
                    !suggestions
                      ?.stores ||
                    suggestions
                      .stores
                      .length ===
                      0
                  ) && (
                    <div
                      className={
                        styles.suggestEmpty
                      }
                    >
                      Nu avem
                      sugestii pentru
                      „
                      {
                        localFilters.q
                      }
                      ”.
                    </div>
                  )}
              </div>
            )}
        </form>

        <FilterSummary
          q={qParam}
          citySlug={
            cityParam
          }
          sort={
            sortParam
          }
          cityLabelMap={
            cityLabelMap
          }
        />
      </header>

      {/* =================================================
          TOTAL
      ================================================= */}

      {!loading &&
        !error &&
        typeof total ===
          "number" &&
        total > 0 && (
          <div
            className={
              styles.resultsInfo
            }
          >
            {total === 1
              ? "1 magazin găsit."
              : `${total} magazine găsite.`}
          </div>
        )}

      {/* =================================================
          FILTER MODAL
      ================================================= */}

      {filtersOpen && (
        <div
          className={
            styles.filtersOverlay
          }
          onClick={() =>
            setFiltersOpen(
              false
            )
          }
        >
          <div
            className={
              styles.filtersModal
            }
            onClick={(
              event
            ) =>
              event.stopPropagation()
            }
            role="dialog"
            aria-modal="true"
            aria-labelledby="stores-filters-title"
          >
            <div
              className={
                styles.filtersModalHead
              }
            >
              <h2
                className={
                  styles.filtersTitle
                }
                id="stores-filters-title"
              >
                Filtre
                magazine
              </h2>

              <button
                type="button"
                className={
                  styles.iconCircle
                }
                onClick={() =>
                  setFiltersOpen(
                    false
                  )
                }
                aria-label="Închide filtrele"
                title="Închide filtrele"
              >
                <FaTimes />
              </button>
            </div>

            <div
              className={
                styles.filters
              }
            >
              <input
                className={
                  styles.input
                }
                placeholder="Caută magazine…"
                value={
                  localFilters.q
                }
                onChange={(
                  event
                ) =>
                  setLocalFilters(
                    (
                      prev
                    ) => ({
                      ...prev,
                      q:
                        event
                          .target
                          .value,
                    })
                  )
                }
              />

              <select
                className={
                  styles.select
                }
                value={
                  localFilters.city
                }
                onChange={(
                  event
                ) =>
                  setLocalFilters(
                    (
                      prev
                    ) => ({
                      ...prev,
                      city:
                        event
                          .target
                          .value,
                    })
                  )
                }
              >
                <option value="">
                  Toate orașele
                </option>

                {cityOptions.map(
                  (city) => (
                    <option
                      key={
                        city.slug
                      }
                      value={
                        city.slug
                      }
                    >
                      {
                        city.label
                      }
                    </option>
                  )
                )}
              </select>

              <select
                className={
                  styles.select
                }
                value={
                  localFilters.sort
                }
                onChange={(
                  event
                ) =>
                  setLocalFilters(
                    (
                      prev
                    ) => ({
                      ...prev,
                      sort:
                        event
                          .target
                          .value,
                    })
                  )
                }
              >
                {SORTS.map(
                  (sort) => (
                    <option
                      key={
                        sort.v
                      }
                      value={
                        sort.v
                      }
                    >
                      {
                        sort.label
                      }
                    </option>
                  )
                )}
              </select>

              <div
                className={
                  styles.filterActions
                }
              >
                <button
                  type="button"
                  className={
                    styles.btnApply
                  }
                  onClick={
                    applyFilters
                  }
                >
                  Aplică filtre
                </button>

                <button
                  type="button"
                  className={
                    styles.btnReset
                  }
                  onClick={
                    resetFilters
                  }
                >
                  Resetează
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================
          CONTENT
      ================================================= */}

      {loading ? (
        <div
          className={
            styles.loading
          }
        >
          Se încarcă…
        </div>
      ) : error ? (
        <div
          className={
            styles.errorBox
          }
        >
          {error}
        </div>
      ) : items.length ===
        0 ? (
        <EmptyState
          onReset={
            resetFilters
          }
        />
      ) : (
        <>
          <ul
            className={
              styles.grid
            }
          >
            {items.map(
              (store, index) => (
                <StoreCard
                  key={
                    store.id
                  }
                  s={
                    store
                  }
                  autoPrefetch={index < 4}
                  onClick={() => {
                    if (import.meta.env?.DEV && typeof performance !== "undefined") {
                      try {
                        performance.mark("store:route-click");
                      } catch {
                        // ignore
                      }
                    }

                    const slug =
                      store.profileSlug || store.id;
                    const to = `/magazin/${encodeURIComponent(slug)}`;

                    /*
                     * Summary DOAR pentru primul paint instant al
                     * skeleton-ului (nume/logo) - ProfilMagazin
                     * revalidează oricum din API imediat.
                     */
                    navigate(to, {
                      state: {
                        storeSummary: {
                          slug,
                          shopName:
                            store.storeName ||
                            store.displayName ||
                            "Magazin",
                          profileImageUrl: store.logoUrl || null,
                          shortDescription: store.about || null,
                        },
                      },
                    });
                  }}
                />
              )
            )}
          </ul>

          {isLoadingMore && (
            <div
              className={
                styles.loading
              }
            >
              Se încarcă mai
              multe magazine…
            </div>
          )}

          <div
            ref={
              sentinelRef
            }
            style={{
              height: 1,
            }}
          />

          {!hasMore &&
            (
              typeof total !==
              "number"
                ? items.length >
                  0
                : total > 0
            ) && (
              <div
                className={
                  styles.resultsInfo
                }
              >
                Ai ajuns la
                finalul listei.
              </div>
            )}
        </>
      )}
    </section>
  );
}

/* =========================================================
   STORE CARD
========================================================= */

const storePrefetchDescriptor = {
  getKey: (s) => `store:${s.profileSlug || s.id}`,
  routeChunk: () => import("../Vendor/ProfilMagazin/ProfilMagazin.jsx"),
  fetchData: (s) =>
    api(
      `/api/public/store/${encodeURIComponent(
        s.profileSlug || s.id
      )}/initial`
    ),
  getDataUrl: (s) =>
    `/api/public/store/${encodeURIComponent(s.profileSlug || s.id)}/initial`,
  getImageUrl: (s) => s.logoUrl || null,
};

function StoreCard({
  s,
  onClick,
  autoPrefetch = false,
}) {
  const cardRef = useRef(null);
  const title =
    s.storeName ||
    s.displayName ||
    "Magazin";

  const subtitle =
    [
      s.city,
      s.category,
    ]
      .filter(Boolean)
      .join(" • ");

  const triggerPrefetch = useSmartPrefetchItem(s, storePrefetchDescriptor);

  useVisibleStableTrigger(
    cardRef,
    useCallback(() => triggerPrefetch("auto"), [triggerPrefetch]),
    { enabled: autoPrefetch }
  );

  return (
    <li
      ref={cardRef}
      className={
        styles.card
      }
    >
      <button
        type="button"
        className={
          styles.cardLink
        }
        onClick={
          onClick
        }
        onMouseEnter={() => triggerPrefetch("intent")}
        onFocus={() => triggerPrefetch("intent")}
        onTouchStart={() => triggerPrefetch("intent")}
        aria-label={
          title
        }
      >
        <div
          className={
            styles.thumbWrap
          }
        >
          <img
            src={
              s.logoUrl ||
              "/placeholder-store.png"
            }
            alt={
              title
            }
            className={
              styles.thumb
            }
            loading="lazy"
            decoding="async"
          />
        </div>

        <div
          className={
            styles.cardBody
          }
        >
          <div
            className={
              styles.title
            }
            title={
              title
            }
          >
            {title}
          </div>

          {subtitle && (
            <div
              className={
                styles.meta
              }
            >
              {
                subtitle
              }
            </div>
          )}

          <div
            className={
              styles.badges
            }
          >
            <span
              className={
                styles.badge
              }
            >
              {
                s.productsCount ||
                0
              }{" "}
              {Number(
                s.productsCount
              ) === 1
                ? "produs"
                : "produse"}
            </span>
          </div>

          {s.about && (
            <p
              className={
                styles.about
              }
              title={
                s.about
              }
            >
              {s.about}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

/* =========================================================
   EMPTY STATE
========================================================= */

function EmptyState({
  onReset,
}) {
  return (
    <div
      className={
        styles.empty
      }
    >
      <div
        className={
          styles.emptyTitle
        }
      >
        Nu am găsit
        magazine pentru
        filtrele alese.
      </div>

      <button
        type="button"
        className={
          styles.btnPrimary
        }
        onClick={
          onReset
        }
      >
        Resetează filtrele
      </button>
    </div>
  );
}

/* =========================================================
   FILTER SUMMARY
========================================================= */

function FilterSummary({
  q,
  citySlug,
  sort,
  cityLabelMap,
}) {
  const hasMeaningfulSort =
    sort &&
    sort !== "new";

  if (
    !q &&
    !citySlug &&
    !hasMeaningfulSort
  ) {
    return null;
  }

  const sortLabelMap = {
    new:
      "Cele mai noi",

    popular:
      "Populare",

    name_asc:
      "Nume A–Z",

    name_desc:
      "Nume Z–A",
  };

  const cityLabel =
    citySlug
      ? cityLabelMap.get(
          citySlug
        ) ||
        citySlug
      : "";

  return (
    <div
      className={
        styles.chipWrap
      }
    >
      {q && (
        <span
          className={
            styles.chip
          }
        >
          <strong>
            Cauți:
          </strong>{" "}
          „{q}”
        </span>
      )}

      {cityLabel && (
        <span
          className={
            styles.chip
          }
        >
          <strong>
            Oraș:
          </strong>{" "}
          {cityLabel}
        </span>
      )}

      {hasMeaningfulSort && (
        <span
          className={
            styles.chip
          }
        >
          <strong>
            Sortare:
          </strong>{" "}
          {
            sortLabelMap[
              sort
            ] || sort
          }
        </span>
      )}
    </div>
  );
}