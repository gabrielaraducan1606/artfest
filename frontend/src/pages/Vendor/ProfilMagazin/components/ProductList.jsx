/**
 * ProductList.jsx – versiune cu persistenta filtrelor in URL + fallback localStorage,
 * extinsă cu filtre pentru categorie, culoare, material, tehnică, stil, ocazie.
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

const humanizeSlug = (slug = "") => {
  if (!slug || typeof slug !== "string") return "";
  return slug
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
};

const getProductId = (p) => p?.id || p?._id;

const getProductShopId = (p, detail = {}) =>
  p?.shopId ||
  p?.storeId ||
  p?.vendorStoreId ||
  p?.shop?._id ||
  p?.shop?.id ||
  p?.store?._id ||
  p?.store?.id ||
  detail?.shopId ||
  detail?.storeId ||
  detail?.vendorStoreId;
const buildDefaultFilters = (fromUrl = {}) => ({
  q: fromUrl.q || "",
  category: fromUrl.category || "",
  color: fromUrl.color || "",
  material: fromUrl.material || "",
  technique: fromUrl.technique || "",
  styleTag: fromUrl.styleTag || "",
  occasionTag: fromUrl.occasionTag || "",
  onlyFav: !!fromUrl.onlyFav,
  pmin: fromUrl.pmin ?? "",
pmax: fromUrl.pmax ?? "",
  sort: fromUrl.sort || "relevant",
  status: fromUrl.status || "",
  moderationStatus: fromUrl.moderationStatus || "",
  hidden: !!fromUrl.hidden,
  availability: fromUrl.availability || "",
  leadTimeMax: fromUrl.leadTimeMax ?? "",
  acceptsCustom: !!fromUrl.acceptsCustom,
});
export default function ProductList({
  products = [],
  isLoading = false,
  shopId,
  isOwner,
  viewMode,
  favorites,
  navigate,
  onAddFirstProduct,
  productsCacheT,
  onEditProduct,
  categories = [],
  colorLabelMap,
}) {
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
  }, [normalized, shopId]);

  React.useEffect(() => {
    if (productsCacheT) setImgCacheNonce(productsCacheT);
  }, [productsCacheT]);

  const sameImages = (a = [], b = []) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  };

  React.useEffect(() => {
    const belongsToCurrentShop = (product, detail = {}) => {
      if (!shopId) return true;

      const productShopId = getProductShopId(product, detail);

      if (!productShopId) return true;

      return String(productShopId) === String(shopId);
    };

    const onUpdated = (e) => {
      const detail = e?.detail || {};
      const up = detail?.product;
      const upId = getProductId(up) || detail?.id;

      if (!upId) return;
      if (!belongsToCurrentShop(up, detail)) return;

      setList((prev) => {
        if (!Array.isArray(prev)) return prev;

        let changed = false;

        const next = prev.map((p) => {
          const pid = getProductId(p);
          if (pid !== upId) return p;

          const merged = up ? { ...p, ...up } : { ...p };

          if (!up || !sameImages(p.images, merged.images)) {
            setImgCacheNonce(Date.now());
          }

          changed = true;
          return merged;
        });

        return changed ? next : prev;
      });
    };

    const onDeleted = (e) => {
      const detail = e?.detail || {};
      const delId = detail?.id;

      if (!delId) return;

      if (shopId) {
        const eventShopId =
          detail?.shopId || detail?.storeId || detail?.vendorStoreId;

        if (eventShopId && String(eventShopId) !== String(shopId)) {
          return;
        }
      }

      setList((prev) =>
        Array.isArray(prev)
          ? prev.filter((p) => getProductId(p) !== delId)
          : prev
      );
    };

    const onCreated = (e) => {
      const detail = e?.detail || {};
      const p = detail?.product;

      if (!p) return;
      if (!belongsToCurrentShop(p, detail)) return;

      const pid = getProductId(p);
      if (!pid) return;

      setList((prev) => {
        if (!Array.isArray(prev)) {
          setImgCacheNonce(Date.now());
          return [p];
        }

        const exists = prev.some((x) => getProductId(x) === pid);
        if (exists) return prev;

        setImgCacheNonce(Date.now());
        return [p, ...prev];
      });
    };

    window.addEventListener("vendor:productUpdated", onUpdated);
    window.addEventListener("vendor:productDeleted", onDeleted);
    window.addEventListener("vendor:productCreated", onCreated);

    return () => {
      window.removeEventListener("vendor:productUpdated", onUpdated);
      window.removeEventListener("vendor:productDeleted", onDeleted);
      window.removeEventListener("vendor:productCreated", onCreated);
    };
  }, [shopId]);

  const hasFav = React.useCallback(
    (pid) => {
      if (!favorites) return false;
      if (favorites instanceof Set) return favorites.has(pid);
      if (Array.isArray(favorites)) return favorites.includes(pid);
      return false;
    },
    [favorites]
  );

  const categoryLabelMap = React.useMemo(() => {
    const map = {};

    if (Array.isArray(categories)) {
      for (const c of categories) {
        if (!c) continue;

        if (typeof c === "string") {
          map[c] = c;
        } else if (typeof c === "object") {
          const key = c.key || c.value || "";
          if (!key) continue;

          map[key] = c.label || c.name || key;
        }
      }
    }

    return map;
  }, [categories]);

  const computed = React.useMemo(() => {
    const cats = new Set();
    const statuses = new Set();
    const colors = new Set();
    const materials = new Set();
    const techniques = new Set();
    const styleTags = new Set();
    const occasionTags = new Set();

    let min = Number.POSITIVE_INFINITY;
    let max = 0;

    const base = isOwner
      ? list
      : list.filter(
          (p) =>
            p?.isActive !== false &&
            !p?.isHidden &&
            String(p?.moderationStatus || "APPROVED").toUpperCase() ===
              "APPROVED"
        );

    for (const p of base) {
      if (p?.category) cats.add(p.category);
      if (p?.color) colors.add(p.color);
      if (p?.materialMain) materials.add(p.materialMain);
      if (p?.technique) techniques.add(p.technique);

      if (Array.isArray(p?.styleTags)) {
        p.styleTags.forEach((t) => t && styleTags.add(String(t)));
      } else if (typeof p?.styleTags === "string") {
        p.styleTags
          .split(/[,\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .forEach((t) => styleTags.add(t));
      }

      if (Array.isArray(p?.occasionTags)) {
        p.occasionTags.forEach((t) => t && occasionTags.add(String(t)));
      } else if (typeof p?.occasionTags === "string") {
        p.occasionTags
          .split(/[,\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
          .forEach((t) => occasionTags.add(t));
      }

      const price = Number(p?.price);

      if (Number.isFinite(price)) {
        if (price < min) min = price;
        if (price > max) max = price;
      }

      if (isOwner) {
        statuses.add(p?.isActive !== false ? "active" : "inactive");
      }
    }

    return {
      categories: Array.from(cats),
      colors: Array.from(colors),
      materials: Array.from(materials),
      techniques: Array.from(techniques),
      styleTags: Array.from(styleTags),
      occasionTags: Array.from(occasionTags),
      priceMin: Number.isFinite(min) ? min : 0,
      priceMax: Number.isFinite(max) ? max : 0,
      statuses: Array.from(statuses),
    };
  }, [list, isOwner]);

  const categoryOptions = React.useMemo(() => {
    if (!Array.isArray(categories) || categories.length === 0) {
      return computed.categories.map((key) => ({
        key,
        label: categoryLabelMap[key] || key,
      }));
    }

    const setFromProducts = new Set(computed.categories);

    return categories
      .map((c) => {
        if (!c) return null;

        if (typeof c === "string") {
          if (!setFromProducts.has(c)) return null;
          return { key: c, label: categoryLabelMap[c] || c };
        }

        if (typeof c === "object") {
          const key = c.key || c.value || "";
          if (!key || !setFromProducts.has(key)) return null;
          return { key, label: c.label || c.name || key };
        }

        return null;
      })
      .filter(Boolean);
  }, [categories, computed.categories, categoryLabelMap]);

  const [filters, setFilters] = React.useState(() => {
  const fromUrl = readFiltersFromSearch(location.search);
  const base = buildDefaultFilters(fromUrl);

  if (!location.search && isOwner) {
    const ls = loadFiltersFromLS(shopId);
    return ls ? { ...base, ...ls } : base;
  }

  return base;
});

React.useEffect(() => {
  const fromUrl = readFiltersFromSearch(location.search);
  const base = buildDefaultFilters(fromUrl);

  if (!location.search && isOwner) {
    const ls = loadFiltersFromLS(shopId);
    setFilters(ls ? { ...base, ...ls } : base);
    return;
  }

  setFilters(base);
}, [shopId, location.search, isOwner]);

  const [panelOpen, setPanelOpen] = React.useState(false);
  const debouncedQ = useDebouncedValue(filters.q, 200);
  const debouncedFilters = useDebouncedValue(filters, 250);

  React.useEffect(() => {
    if (!panelOpen) return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prev;
    };
  }, [panelOpen]);

  React.useEffect(() => {
    const nextSearch = writeFiltersToSearch(
      debouncedFilters,
      location.search
    );

    if (nextSearch !== location.search) {
      nav(
        {
          pathname: location.pathname,
          search: nextSearch,
        },
        { replace: true }
      );
    }

    if (isOwner) {
      saveFiltersToLS(debouncedFilters, shopId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFilters, isOwner, shopId]);

  const filteredSorted = React.useMemo(() => {
    let arr = list.slice();

    if (!isOwner) {
      arr = arr.filter(
        (p) =>
          p?.isActive !== false &&
          !p?.isHidden &&
          String(p?.moderationStatus || "APPROVED").toUpperCase() ===
            "APPROVED"
      );
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

        if (Array.isArray(p?.occasionTags)) {
          parts.push(p.occasionTags.join(" "));
        } else if (typeof p?.occasionTags === "string") {
          parts.push(p.occasionTags);
        }

        const haystack = parts.join(" ").toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    }

    if (filters.category) {
      arr = arr.filter((p) => (p?.category || "") === filters.category);
    }

    if (filters.color) {
      const c = filters.color.toLowerCase();
      arr = arr.filter((p) => (p?.color || "").toLowerCase() === c);
    }

    if (filters.material) {
      arr = arr.filter((p) => (p?.materialMain || "") === filters.material);
    }

    if (filters.technique) {
      arr = arr.filter((p) => (p?.technique || "") === filters.technique);
    }

    if (filters.styleTag) {
      const target = filters.styleTag.toLowerCase();

      arr = arr.filter((p) => {
        let tags = [];

        if (Array.isArray(p?.styleTags)) {
          tags = p.styleTags;
        } else if (typeof p?.styleTags === "string") {
          tags = p.styleTags
            .split(/[,\s]+/)
            .map((t) => t.trim())
            .filter(Boolean);
        }

        return tags.map((t) => String(t).toLowerCase()).includes(target);
      });
    }

    if (filters.occasionTag) {
      const target = filters.occasionTag.toLowerCase();

      arr = arr.filter((p) => {
        let tags = [];

        if (Array.isArray(p?.occasionTags)) {
          tags = p.occasionTags;
        } else if (typeof p?.occasionTags === "string") {
          tags = p.occasionTags
            .split(/[,\s]+/)
            .map((t) => t.trim())
            .filter(Boolean);
        }

        return tags.map((t) => String(t).toLowerCase()).includes(target);
      });
    }

    if (!isOwner && filters.onlyFav) {
      arr = arr.filter((p) => hasFav(getProductId(p)));
    }

   const hasMin = filters.pmin !== "" && filters.pmin !== null;
const hasMax = filters.pmax !== "" && filters.pmax !== null;

if (hasMin || hasMax) {
  const pmin = hasMin ? Number(filters.pmin) : 0;
  const pmax = hasMax ? Number(filters.pmax) : Number.POSITIVE_INFINITY;

  arr = arr.filter((p) => {
    const price = Number(p?.price);
    if (!Number.isFinite(price)) return false;
    return price >= pmin && price <= pmax;
  });
}

    if (isOwner && filters.status) {
      const shouldBeActive = filters.status === "active";
      arr = arr.filter((p) => (p?.isActive !== false) === shouldBeActive);
    }

    if (isOwner && filters.moderationStatus) {
      arr = arr.filter(
        (p) =>
          String(p?.moderationStatus || "PENDING").toUpperCase() ===
          filters.moderationStatus
      );
    }

    if (isOwner && filters.hidden) {
      arr = arr.filter((p) => p?.isHidden === true);
    }

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
    filters,
    isOwner,
    hasFav,
  ]);

  const activeChips = React.useMemo(() => {
    const chips = [];

    if (filters.q) chips.push({ key: "q", label: `„${filters.q}”` });

    if (filters.category) {
      chips.push({
        key: "category",
        label: categoryLabelMap[filters.category] || filters.category,
      });
    }

    if (filters.color) {
      chips.push({
        key: "color",
        label: `Culoare: ${colorLabelMap?.[filters.color] || filters.color}`,
      });
    }

    if (filters.material) {
      chips.push({
        key: "material",
        label: `Material: ${humanizeSlug(filters.material)}`,
      });
    }

    if (filters.technique) {
      chips.push({
        key: "technique",
        label: `Tehnică: ${humanizeSlug(filters.technique)}`,
      });
    }

    if (filters.styleTag) {
      chips.push({
        key: "styleTag",
        label: `Stil: ${humanizeSlug(filters.styleTag)}`,
      });
    }

    if (filters.occasionTag) {
      chips.push({
        key: "occasionTag",
        label: `Ocazie: ${humanizeSlug(filters.occasionTag)}`,
      });
    }

    if (!isOwner && filters.onlyFav) {
      chips.push({ key: "onlyFav", label: "Favorite" });
    }

    if (filters.pmin !== "")
    if (filters.pmax !== "")

    if (isOwner && filters.status) {
      chips.push({
        key: "status",
        label: filters.status === "active" ? "Active" : "Inactive",
      });
    }

    if (isOwner && filters.moderationStatus) {
      const moderationLabels = {
        PENDING: "În verificare",
        APPROVED: "Aprobate",
        CHANGES_REQUESTED: "Necesită modificări",
        REJECTED: "Respinse",
      };

      chips.push({
        key: "moderationStatus",
        label:
          moderationLabels[filters.moderationStatus] ||
          filters.moderationStatus,
      });
    }

    if (isOwner && filters.hidden) {
      chips.push({ key: "hidden", label: "Ascunse" });
    }

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
  }, [
    filters,
    isOwner,
    categoryLabelMap,
    colorLabelMap,
  ]);

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
        case "material":
          next.material = "";
          break;
        case "technique":
          next.technique = "";
          break;
        case "styleTag":
          next.styleTag = "";
          break;
        case "occasionTag":
          next.occasionTag = "";
          break;
        case "onlyFav":
          next.onlyFav = false;
          break;
        case "pmin":
  next.pmin = "";
  break;
case "pmax":
  next.pmax = "";
  break;
        case "status":
          next.status = "";
          break;
        case "moderationStatus":
          next.moderationStatus = "";
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
      material: "",
      technique: "",
      styleTag: "",
      occasionTag: "",
      onlyFav: false,
      pmin: "",
pmax: "",
      sort: "relevant",
      status: "",
      moderationStatus: "",
      hidden: false,
      availability: "",
      leadTimeMax: "",
      acceptsCustom: false,
    });
  };

  const showFiltersUI = list.length > 0;

  return (
    <section className={styles.wrap}>
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

        {showFiltersUI && (
          <div className={styles.headerRight}>
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
                  setFilters((f) => ({
                    ...f,
                    sort: "price_asc",
                  }))
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
                  setFilters((f) => ({
                    ...f,
                    sort: "price_desc",
                  }))
                }
                title="Preț descrescător"
                aria-pressed={filters.sort === "price_desc"}
              >
                <FaSortAmountDown />{" "}
                <span className={styles.hideSm}>Preț ↓</span>
              </button>
            </div>

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
        )}
      </div>

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
          <label className={styles.label}>
            Caută
            <input
              type="search"
              inputMode="search"
              className={styles.input}
              placeholder="Titlu, descriere, culoare, material…"
              value={filters.q}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  q: e.target.value,
                }))
              }
              aria-label="Căutare produse"
            />
          </label>

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

                {categoryOptions.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>

              {filters.category && (
                <button
                  className={styles.catChip}
                  onClick={() => clearChip("category")}
                  title="Șterge categoria"
                >
                  <FaTag />{" "}
                  {categoryLabelMap[filters.category] || filters.category}{" "}
                  <FaTimes className={styles.chipX} />
                </button>
              )}
            </div>
          </label>

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
                    {colorLabelMap?.[c] || c}
                  </option>
                ))}
              </select>

              {filters.color && (
                <button
                  className={styles.catChip}
                  onClick={() => clearChip("color")}
                  title="Șterge culoarea"
                >
                  <FaTag /> {colorLabelMap?.[filters.color] || filters.color}{" "}
                  <FaTimes className={styles.chipX} />
                </button>
              )}
            </div>
          </label>

          <label className={styles.label}>
            Material principal
            <div className={styles.catRow}>
              <select
                className={styles.select}
                value={filters.material}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    material: e.target.value,
                  }))
                }
                aria-label="Filtrează după material"
              >
                <option value="">Toate materialele</option>

                {computed.materials.map((m) => (
                  <option key={m} value={m}>
                    {humanizeSlug(m)}
                  </option>
                ))}
              </select>

              {filters.material && (
                <button
                  className={styles.catChip}
                  onClick={() => clearChip("material")}
                  title="Șterge materialul"
                >
                  <FaTag /> {humanizeSlug(filters.material)}{" "}
                  <FaTimes className={styles.chipX} />
                </button>
              )}
            </div>
          </label>

          <label className={styles.label}>
            Tehnică
            <div className={styles.catRow}>
              <select
                className={styles.select}
                value={filters.technique}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    technique: e.target.value,
                  }))
                }
                aria-label="Filtrează după tehnică"
              >
                <option value="">Toate tehnicile</option>

                {computed.techniques.map((t) => (
                  <option key={t} value={t}>
                    {humanizeSlug(t)}
                  </option>
                ))}
              </select>

              {filters.technique && (
                <button
                  className={styles.catChip}
                  onClick={() => clearChip("technique")}
                  title="Șterge tehnica"
                >
                  <FaTag /> {humanizeSlug(filters.technique)}{" "}
                  <FaTimes className={styles.chipX} />
                </button>
              )}
            </div>
          </label>

          <label className={styles.label}>
            Stil
            <div className={styles.catRow}>
              <select
                className={styles.select}
                value={filters.styleTag}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    styleTag: e.target.value,
                  }))
                }
                aria-label="Filtrează după stil"
              >
                <option value="">Toate stilurile</option>

                {computed.styleTags.map((s) => (
                  <option key={s} value={s}>
                    {humanizeSlug(s)}
                  </option>
                ))}
              </select>

              {filters.styleTag && (
                <button
                  className={styles.catChip}
                  onClick={() => clearChip("styleTag")}
                  title="Șterge stilul"
                >
                  <FaTag /> {humanizeSlug(filters.styleTag)}{" "}
                  <FaTimes className={styles.chipX} />
                </button>
              )}
            </div>
          </label>

          <label className={styles.label}>
            Ocazie
            <div className={styles.catRow}>
              <select
                className={styles.select}
                value={filters.occasionTag}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    occasionTag: e.target.value,
                  }))
                }
                aria-label="Filtrează după ocazie"
              >
                <option value="">Toate ocaziile</option>

                {computed.occasionTags.map((o) => (
                  <option key={o} value={o}>
                    {humanizeSlug(o)}
                  </option>
                ))}
              </select>

              {filters.occasionTag && (
                <button
                  className={styles.catChip}
                  onClick={() => clearChip("occasionTag")}
                  title="Șterge ocazia"
                >
                  <FaTag /> {humanizeSlug(filters.occasionTag)}{" "}
                  <FaTimes className={styles.chipX} />
                </button>
              )}
            </div>
          </label>

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

              <label className={styles.label}>
                Verificare admin
                <select
                  className={styles.select}
                  value={filters.moderationStatus}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      moderationStatus: e.target.value,
                    }))
                  }
                  aria-label="Filtrează după verificare admin"
                >
                  <option value="">Toate</option>
                  <option value="PENDING">În verificare</option>
                  <option value="APPROVED">Aprobate</option>
                  <option value="CHANGES_REQUESTED">
                    Necesită modificări
                  </option>
                  <option value="REJECTED">Respinse</option>
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

            <label className={styles.checkbox} style={{ alignSelf: "end" }}>
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

      {panelOpen && (
        <div
          className={styles.backdrop}
          onClick={() => setPanelOpen(false)}
          aria-hidden="true"
        />
      )}

      {isLoading ? (
        <div className={styles.empty}>
          <p>Se încarcă produsele...</p>
        </div>
      ) : list.length === 0 ? (
        <div className={styles.empty}>
          {isOwner ? (
            <>
              <p>Nu ai încă produse adăugate.</p>

              <button className={styles.cta} onClick={onAddFirstProduct}>
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
            const pid = getProductId(p) || `idx-${idx}`;

            return (
              <ProductCard
                key={pid}
                p={p}
                viewMode={isOwner ? "vendor" : viewMode}
                isFav={hasFav(pid)}
                navigate={navigate}
                productsCacheT={imgCacheNonce}
                onEditProduct={onEditProduct}
                categoryLabelMap={categoryLabelMap}
                colorLabelMap={colorLabelMap}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}