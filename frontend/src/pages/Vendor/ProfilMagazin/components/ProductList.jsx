/**
 * ProductList.jsx – versiune cu persistenta filtrelor in URL + fallback localStorage
 */
import React from "react";
import {
  FaPlus,
  FaFilter,
  FaTimes,
  FaSortAmountDown,
  FaSortAmountUp,
  FaHeart,
  FaTag,
} from "react-icons/fa";
import { useLocation, useNavigate } from "react-router-dom";
import ProductCard from "./ProductCard";
import styles from "./css/ProductList.module.css";
import {
  readFiltersFromSearch,
  writeFiltersToSearch,
  loadFiltersFromLS,
  saveFiltersToLS,
} from "../hooks/urlState.js";

function useDebouncedValue(value, delay = 200) {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function ProductList({
  products = [],
  isOwner,
  viewMode,
  favorites, // Set sau array cu productId-uri
  navigate,
  onAddFirstProduct, // handler -> openNewProduct()
  productsCacheT, // cache-buster venit din părinte (opțional)
  onEditProduct, // p => deschide ProductModal în modul edit
}) {
  /* ================= Normalizare + cache ================= */
  const location = useLocation();
  const nav = useNavigate();

  const normalized = React.useMemo(
    () =>
      (Array.isArray(products) ? products : []).filter(
        (p) => p && typeof p === "object"
      ),
    [products]
  );
  const [list, setList] = React.useState(normalized);
  const [imgCacheNonce, setImgCacheNonce] = React.useState(
    () => productsCacheT || Date.now()
  );

  React.useEffect(() => {
    setList(normalized);
  }, [normalized]);
  React.useEffect(() => {
    if (productsCacheT) setImgCacheNonce(productsCacheT);
  }, [productsCacheT]);

  const sameImages = (a = [], b = []) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  React.useEffect(() => {
    const onUpdated = (e) => {
      const up = e?.detail?.product;
      const upId = up?.id || up?._id || e?.detail?.id;
      if (!upId) return;

      setList((prev) => {
        if (!Array.isArray(prev)) return prev;
        let changed = false;
        const next = prev.map((p) => {
          const pid = p?.id || p?._id;
          if (pid !== upId) return p;
          const merged = up ? { ...p, ...up } : { ...p };
          if (!up || !sameImages(p.images, merged.images))
            setImgCacheNonce(Date.now());
          changed = true;
          return merged;
        });
        return changed ? next : prev;
      });
    };

    const onDeleted = (e) => {
      const delId = e?.detail?.id;
      if (!delId) return;
      setList((prev) =>
        Array.isArray(prev)
          ? prev.filter((p) => (p?.id || p?._id) !== delId)
          : prev
      );
    };

    window.addEventListener("vendor:productUpdated", onUpdated);
    window.addEventListener("vendor:productDeleted", onDeleted);
    return () => {
      window.removeEventListener("vendor:productUpdated", onUpdated);
      window.removeEventListener("vendor:productDeleted", onDeleted);
    };
  }, []);

  const hasFav = React.useCallback(
    (pid) => {
      if (!favorites) return false;
      if (favorites instanceof Set) return favorites.has(pid);
      if (Array.isArray(favorites)) return favorites.includes(pid);
      return false;
    },
    [favorites]
  );

  /* ================= Filtre disponibile (din listă) ================= */
  const computed = React.useMemo(() => {
    const cats = new Set();
    const statuses = new Set();
    const colors = new Set();

    let min = Number.POSITIVE_INFINITY;
    let max = 0;

    const base = isOwner
      ? list
      : list.filter((p) => p?.isActive !== false && !p?.isHidden);
    for (const p of base) {
      if (p?.category) cats.add(p.category);
      if (p?.color) colors.add(p.color);

      const price = Number(p?.price);
      if (Number.isFinite(price)) {
        if (price < min) min = price;
        if (price > max) max = price;
      }
      if (isOwner) statuses.add(p?.isActive !== false ? "active" : "inactive");
    }

    return {
      categories: Array.from(cats),
      colors: Array.from(colors),
      priceMin: Number.isFinite(min) ? min : 0,
      priceMax: Number.isFinite(max) ? max : 0,
      statuses: Array.from(statuses),
    };
  }, [list, isOwner]);

  /* ================= State filtre cu sincronizare URL ================= */
  const [filters, setFilters] = React.useState(() => {
    const fromUrl = readFiltersFromSearch(location.search);
    const base = {
      q: fromUrl.q || "",
      category: fromUrl.category || "",
      color: fromUrl.color || "", // 🆕
      onlyFav: !!fromUrl.onlyFav,
      pmin: 0,
      pmax: 0,
      sort: fromUrl.sort || "relevant",
      status: fromUrl.status || "",
      hidden: !!fromUrl.hidden,
      availability: fromUrl.availability || "",
      leadTimeMax: fromUrl.leadTimeMax ?? "",
      acceptsCustom: !!fromUrl.acceptsCustom,
    };
    // dacă URL e gol, încearcă LS
    const ls = location.search ? null : loadFiltersFromLS();
    return ls ? { ...base, ...ls } : base;
  });

  // aliniază pmin/pmax cu domeniul din computed
  React.useEffect(() => {
    setFilters((f) => ({
      ...f,
      pmin: f.pmin === 0 || f.pmin === "" ? computed.priceMin : f.pmin,
      pmax: f.pmax === 0 || f.pmax === "" ? computed.priceMax : f.pmax,
    }));
  }, [computed.priceMin, computed.priceMax]);

  const panelOpenState = React.useState(false);
  const [panelOpen, setPanelOpen] = panelOpenState;
  const debouncedQ = useDebouncedValue(filters.q, 200);
  const debouncedFilters = useDebouncedValue(filters, 250);

  // Lock scroll pentru panou
  React.useEffect(() => {
    if (panelOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [panelOpen]);

  // Scrie filtrele în URL + LS la schimbare
  React.useEffect(() => {
    const nextSearch = writeFiltersToSearch(debouncedFilters, location.search);
    if (nextSearch !== location.search) {
      nav(
        { pathname: location.pathname, search: nextSearch },
        { replace: true }
      );
    }
    saveFiltersToLS(debouncedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFilters]);

  /* ================= Aplicare filtre + sort ================= */
  const filteredSorted = React.useMemo(() => {
    let arr = list.slice();

    // USER: ascunde din start produse inactive/ascunse
    if (!isOwner) {
      arr = arr.filter((p) => p?.isActive !== false && !p?.isHidden);
    }

    const q = (debouncedQ || "").trim().toLowerCase();
    if (q) {
      const terms = q
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);

      arr = arr.filter((p) => {
        const parts = [];

        if (p?.title) parts.push(p.title);
        if (p?.description) parts.push(p.description);
        if (p?.category) parts.push(p.category);
        if (p?.color) parts.push(p.color);
        if (p?.materialMain) parts.push(p.materialMain);
        if (p?.technique) parts.push(p.technique);
        if (p?.dimensions) parts.push(p.dimensions);
        if (p?.careInstructions) parts.push(p.careInstructions);
        if (p?.specialNotes) parts.push(p.specialNotes);

        if (Array.isArray(p?.styleTags)) parts.push(p.styleTags.join(" "));
        else if (typeof p?.styleTags === "string") parts.push(p.styleTags);

        if (Array.isArray(p?.occasionTags)) parts.push(p.occasionTags.join(" "));
        else if (typeof p?.occasionTags === "string") parts.push(p.occasionTags);

        const haystack = parts.join(" ").toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    }

    if (filters.category) {
      arr = arr.filter((p) => (p?.category || "") === filters.category);
    }

    // 🆕 culoare
    if (filters.color) {
      const c = filters.color.toLowerCase();
      arr = arr.filter((p) => (p?.color || "").toLowerCase() === c);
    }

    if (!isOwner && filters.onlyFav) {
      arr = arr.filter((p) => hasFav(p?.id || p?._id));
    }

    // preț
    const pmin = Number(filters.pmin) || 0;
    const pmax = Number(filters.pmax) || Number.POSITIVE_INFINITY;
    arr = arr.filter((p) => {
      const price = Number(p?.price);
      if (!Number.isFinite(price)) return false;
      return price >= pmin && price <= pmax;
    });

    // vendor: status / hidden
    if (isOwner && filters.status) {
      const shouldBeActive = filters.status === "active";
      arr = arr.filter((p) => (p?.isActive !== false) === shouldBeActive);
    }
    if (isOwner && filters.hidden) {
      arr = arr.filter((p) => p?.isHidden === true);
    }

    // handmade: availability / lead time / custom
    if (filters.availability) {
      const av = String(filters.availability);
      if (av === "READY") {
        arr = arr.filter((p) => {
          const a = (p?.availability || "READY").toUpperCase();
          const qtty = Number.isFinite(Number(p?.readyQty))
            ? Number(p.readyQty)
            : null;
          return a === "READY" && (qtty == null || qtty > 0);
        });
      } else if (av === "SOLD_OUT") {
        arr = arr.filter((p) => {
          const a = (p?.availability || "READY").toUpperCase();
          const qtty = Number.isFinite(Number(p?.readyQty))
            ? Number(p.readyQty)
            : null;
          return (
            a === "SOLD_OUT" ||
            (a === "READY" && qtty !== null && qtty <= 0)
          );
        });
      } else {
        arr = arr.filter(
          (p) => (p?.availability || "READY").toUpperCase() === av
        );
      }
    }

    if (Number(filters.leadTimeMax) > 0) {
      const maxDays = Number(filters.leadTimeMax);
      arr = arr.filter((p) => {
        const a = (p?.availability || "READY").toUpperCase();
        if (a === "MADE_TO_ORDER") {
          return (
            Number(p?.leadTimeDays) > 0 &&
            Number(p?.leadTimeDays) <= maxDays
          );
        }
        return true;
      });
    }

    if (filters.acceptsCustom) {
      arr = arr.filter((p) => !!p?.acceptsCustom);
    }

    // sort
    switch (filters.sort) {
      case "price_asc":
        arr.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
        break;
      case "price_desc":
        arr.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
        break;
      case "new":
        arr.sort(
          (a, b) =>
            new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0)
        );
        break;
      case "old":
        arr.sort(
          (a, b) =>
            new Date(a?.createdAt || 0) - new Date(b?.createdAt || 0)
        );
        break;
      default:
        break;
    }
    return arr;
  }, [
    list,
    debouncedQ,
    filters.category,
    filters.color,
    filters.onlyFav,
    filters.pmin,
    filters.pmax,
    filters.sort,
    filters.status,
    filters.hidden,
    filters.availability,
    filters.leadTimeMax,
    filters.acceptsCustom,
    isOwner,
    hasFav,
  ]);

  /* ================= UI Helpers ================= */
  const activeChips = React.useMemo(() => {
    const chips = [];
    if (filters.q) chips.push({ key: "q", label: `„${filters.q}”` });
    if (filters.category)
      chips.push({ key: "category", label: filters.category });
    if (filters.color)
      chips.push({
        key: "color",
        label: `Culoare: ${filters.color}`,
      });
    if (!isOwner && filters.onlyFav)
      chips.push({ key: "onlyFav", label: "Favorite" });
    if (Number(filters.pmin) > computed.priceMin)
      chips.push({
        key: "pmin",
        label: `≥ ${filters.pmin} RON`,
      });
    if (Number(filters.pmax) < computed.priceMax)
      chips.push({
        key: "pmax",
        label: `≤ ${filters.pmax} RON`,
      });
    if (isOwner && filters.status)
      chips.push({
        key: "status",
        label: filters.status === "active" ? "Active" : "Inactive",
      });
    if (isOwner && filters.hidden)
      chips.push({ key: "hidden", label: "Ascunse" });
    if (filters.availability) {
      const map = {
        READY: "Gata de livrare",
        MADE_TO_ORDER: "La comandă",
        PREORDER: "Precomandă",
        SOLD_OUT: "Epuizat",
      };
      chips.push({
        key: "availability",
        label: map[filters.availability] || filters.availability,
      });
    }
    if (Number(filters.leadTimeMax) > 0) {
      chips.push({
        key: "leadTimeMax",
        label: `Execuție ≤ ${filters.leadTimeMax} zile`,
      });
    }
    if (filters.acceptsCustom) {
      chips.push({
        key: "acceptsCustom",
        label: "Personalizabile",
      });
    }
    return chips;
  }, [filters, computed.priceMin, computed.priceMax, isOwner]);

  const clearChip = (key) => {
    setFilters((f) => {
      const next = { ...f };
      switch (key) {
        case "q":
          next.q = "";
          break;
        case "category":
          next.category = "";
          break;
        case "color":
          next.color = "";
          break;
        case "onlyFav":
          next.onlyFav = false;
          break;
        case "pmin":
          next.pmin = computed.priceMin;
          break;
        case "pmax":
          next.pmax = computed.priceMax;
          break;
        case "status":
          next.status = "";
          break;
        case "hidden":
          next.hidden = false;
          break;
        case "availability":
          next.availability = "";
          break;
        case "leadTimeMax":
          next.leadTimeMax = "";
          break;
        case "acceptsCustom":
          next.acceptsCustom = false;
          break;
        default:
          break;
      }
      return next;
    });
  };

  const resetAll = () => {
    setFilters({
      q: "",
      category: "",
      color: "",
      onlyFav: false,
      pmin: computed.priceMin,
      pmax: computed.priceMax,
      sort: "relevant",
      status: "",
      hidden: false,
      availability: "",
      leadTimeMax: "",
      acceptsCustom: false,
    });
  };

  /* ================= Render ================= */
  return (
    <section className={styles.wrap}>
      {/* Header + sortare + filtre */}
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>Produse</h2>
          <span
            className={styles.count}
            aria-label={`Număr produse: ${list.length}`}
          >
            {list.length}
          </span>
          {isOwner && (
            <button
              className={styles.addBtn}
              type="button"
              onClick={onAddFirstProduct}
              title="Adaugă produs"
              aria-label="Adaugă produs"
            >
              <FaPlus />
            </button>
          )}
        </div>

        <div className={styles.headerRight}>
          {/* sortare scurtă */}
          <div
            className={styles.sortInline}
            role="group"
            aria-label="Sortare rapidă"
          >
            <button
              type="button"
              className={`${styles.sortBtn} ${
                filters.sort === "price_asc" ? styles.active : ""
              }`}
              onClick={() =>
                setFilters((f) => ({ ...f, sort: "price_asc" }))
              }
              title="Preț crescător"
              aria-pressed={filters.sort === "price_asc"}
            >
              <FaSortAmountUp />{" "}
              <span className={styles.hideSm}>Preț ↑</span>
            </button>
            <button
              type="button"
              className={`${styles.sortBtn} ${
                filters.sort === "price_desc" ? styles.active : ""
              }`}
              onClick={() =>
                setFilters((f) => ({ ...f, sort: "price_desc" }))
              }
              title="Preț descrescător"
              aria-pressed={filters.sort === "price_desc"}
            >
              <FaSortAmountDown />{" "}
              <span className={styles.hideSm}>Preț ↓</span>
            </button>
          </div>

          {/* buton panou filtre */}
          <button
            type="button"
            className={styles.filterBtn}
            onClick={() => setPanelOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={panelOpen ? "true" : "false"}
            aria-controls="filters-panel"
            title="Deschide filtre"
          >
            <FaFilter />
            <span className={styles.hideSm}>Filtre</span>
            {activeChips.length > 0 && (
              <span className={styles.badge}>{activeChips.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* Chip-uri active */}
      {activeChips.length > 0 && (
        <div
          className={styles.chipsRow}
          role="list"
          aria-label="Filtre active"
        >
          {activeChips.map((c) => (
            <button
              key={c.key}
              className={styles.chip}
              onClick={() => clearChip(c.key)}
              role="listitem"
              title={`Elimină filtrul: ${c.label}`}
            >
              <FaTimes className={styles.chipX} aria-hidden />
              {c.label}
            </button>
          ))}
          <button
            className={styles.resetAll}
            onClick={resetAll}
            title="Resetează filtrele"
          >
            Resetează
          </button>
        </div>
      )}

      {/* Panou filtre */}
      <div
        id="filters-panel"
        className={`${styles.panel} ${panelOpen ? styles.open : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Filtre produse"
      >
        <div className={styles.panelGrabber} aria-hidden />

        <button
          type="button"
          className={styles.panelCloseFab}
          onClick={() => setPanelOpen(false)}
          aria-label="Închide filtre"
          title="Închide"
        >
          <FaTimes />
        </button>

        <div className={styles.panelHeader}>
          <strong>Filtre</strong>
          <button
            className={styles.panelClose}
            onClick={() => setPanelOpen(false)}
            aria-label="Închide filtre"
          >
            <FaTimes />
          </button>
        </div>

        <div className={styles.panelBody}>
          {/* Căutare */}
          <label className={styles.label}>
            Caută
            <input
              type="search"
              inputMode="search"
              className={styles.input}
              placeholder="Titlu, descriere, culoare, material…"
              value={filters.q}
              onChange={(e) =>
                setFilters((f) => ({ ...f, q: e.target.value }))
              }
              aria-label="Căutare produse"
            />
          </label>

          {/* Categorie */}
          <label className={styles.label}>
            Categorie
            <div className={styles.catRow}>
              <select
                className={styles.select}
                value={filters.category}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    category: e.target.value,
                  }))
                }
                aria-label="Filtrează după categorie"
              >
                <option value="">Toate categoriile</option>
                {computed.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {filters.category && (
                <button
                  className={styles.catChip}
                  onClick={() => clearChip("category")}
                  title="Șterge categoria"
                >
                  <FaTag /> {filters.category}{" "}
                  <FaTimes className={styles.chipX} />
                </button>
              )}
            </div>
          </label>

          {/* 🆕 Culoare */}
          <label className={styles.label}>
            Culoare
            <div className={styles.catRow}>
              <select
                className={styles.select}
                value={filters.color}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    color: e.target.value,
                  }))
                }
                aria-label="Filtrează după culoare"
              >
                <option value="">Toate culorile</option>
                {computed.colors.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {filters.color && (
                <button
                  className={styles.catChip}
                  onClick={() => clearChip("color")}
                  title="Șterge culoarea"
                >
                  <FaTag /> {filters.color}{" "}
                  <FaTimes className={styles.chipX} />
                </button>
              )}
            </div>
          </label>

          {/* Preț */}
          <div className={styles.twoCols}>
            <label className={styles.label}>
              Preț minim
              <input
                type="number"
                className={styles.input}
                min={0}
                step="1"
                value={filters.pmin ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    pmin: e.target.value,
                  }))
                }
                placeholder={`${computed.priceMin}`}
                aria-label="Preț minim"
              />
            </label>
            <label className={styles.label}>
              Preț maxim
              <input
                type="number"
                className={styles.input}
                min={0}
                step="1"
                value={filters.pmax ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    pmax: e.target.value,
                  }))
                }
                placeholder={`${computed.priceMax}`}
                aria-label="Preț maxim"
              />
            </label>
          </div>

          {/* USER: favorite */}
          {!isOwner && (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={filters.onlyFav}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    onlyFav: e.target.checked,
                  }))
                }
              />
              <FaHeart aria-hidden /> Doar favorite
            </label>
          )}

          {/* VENDOR: status & ascunse */}
          {isOwner && (
            <>
              <label className={styles.label}>
                Status produs
                <select
                  className={styles.select}
                  value={filters.status}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      status: e.target.value,
                    }))
                  }
                  aria-label="Filtrează după status"
                >
                  <option value="">Toate</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>

              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={filters.hidden}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      hidden: e.target.checked,
                    }))
                  }
                />
                Ascunse
              </label>
            </>
          )}

          {/* Disponibilitate (user & vendor) */}
          <label className={styles.label}>
            Disponibilitate
            <select
              className={styles.select}
              value={filters.availability}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  availability: e.target.value,
                }))
              }
              aria-label="Filtrează după disponibilitate"
            >
              <option value="">Toate</option>
              <option value="READY">Gata de livrare</option>
              <option value="MADE_TO_ORDER">La comandă</option>
              <option value="PREORDER">Precomandă</option>
              <option value="SOLD_OUT">Epuizat</option>
            </select>
          </label>

          <div className={styles.twoCols}>
            <label className={styles.label}>
              Execuție max (zile)
              <input
                type="number"
                className={styles.input}
                min={1}
                step={1}
                value={filters.leadTimeMax ?? ""}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    leadTimeMax: e.target.value,
                  }))
                }
                placeholder="ex: 7"
              />
            </label>
            <label
              className={styles.checkbox}
              style={{ alignSelf: "end" }}
            >
              <input
                type="checkbox"
                checked={filters.acceptsCustom}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    acceptsCustom: e.target.checked,
                  }))
                }
              />
              Personalizabile
            </label>
          </div>
        </div>

        <div className={styles.panelFooter}>
          <button className={styles.linkBtn} onClick={resetAll}>
            Resetează
          </button>
          <button
            className={styles.primaryBtn}
            onClick={() => setPanelOpen(false)}
          >
            Aplică filtre
          </button>
        </div>
      </div>

      {/* backdrop */}
      {panelOpen && (
        <div
          className={styles.backdrop}
          onClick={() => setPanelOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Grid produse */}
      {list.length === 0 ? (
        <div className={styles.empty}>
          {isOwner ? (
            <>
              <p>Nu ai încă produse adăugate.</p>
              <button
                className={styles.cta}
                onClick={onAddFirstProduct}
              >
                <FaPlus /> Adaugă primul produs
              </button>
            </>
          ) : (
            <p>Acest magazin nu are produse momentan.</p>
          )}
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className={styles.empty}>
          <p>Niciun produs nu corespunde filtrelor alese.</p>
          <button className={styles.linkBtn} onClick={resetAll}>
            Resetează filtrele
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredSorted.map((p, idx) => {
            const pid = p?.id || p?._id || `idx-${idx}`;
            const version =
              (p?.updatedAt &&
                new Date(p.updatedAt).getTime()) || imgCacheNonce;
            return (
              <ProductCard
                key={`${pid}:${version}`}
                p={p}
                viewMode={isOwner ? "vendor" : viewMode}
                isFav={hasFav(pid)}
                navigate={navigate}
                productsCacheT={imgCacheNonce}
                onEditProduct={onEditProduct}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
