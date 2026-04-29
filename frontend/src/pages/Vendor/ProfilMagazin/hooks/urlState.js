const QS_KEY = "store_products_filters_v2";

const filtersKey = (shopId) =>
  shopId ? `${QS_KEY}:${shopId}` : QS_KEY;

// ── util: citire din URL
export function readFiltersFromSearch(search = "") {
  const p = new URLSearchParams((search || "").replace(/^\?/, ""));

  const getBool = (k) => {
    const v = p.get(k);
    if (v === null) return undefined;
    return v === "1" || v === "true";
  };

  const getNum = (k) => {
    const v = p.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return {
    q: p.get("q") || "",
    category: p.get("category") || "",
    color: p.get("color") || "",
    material: p.get("material") || "",
    technique: p.get("technique") || "",
    styleTag: p.get("styleTag") || "",
    occasionTag: p.get("occasionTag") || "",
    onlyFav: !!getBool("onlyFav"),
    pmin: getNum("pmin"),
    pmax: getNum("pmax"),
    sort: p.get("sort") || "",

    status: p.get("status") || "",
    moderationStatus: p.get("moderationStatus") || "",
    hidden: !!getBool("hidden"),

    availability: p.get("availability") || "",
    leadTimeMax:
      (p.get("leadTimeMax") ?? "") === ""
        ? ""
        : getNum("leadTimeMax") ?? "",
    acceptsCustom: !!getBool("acceptsCustom"),
  };
}

// ── util: scriere în URL
export function writeFiltersToSearch(filters, currentSearch = "") {
  const p = new URLSearchParams((currentSearch || "").replace(/^\?/, ""));

  const setOrDel = (key, val, emptyOk = false) => {
    if (val === undefined || val === null || (!emptyOk && val === "")) {
      p.delete(key);
    } else {
      p.set(key, String(val));
    }
  };

  setOrDel("q", filters.q, true);
  setOrDel("category", filters.category);
  setOrDel("color", filters.color);
  setOrDel("material", filters.material);
  setOrDel("technique", filters.technique);
  setOrDel("styleTag", filters.styleTag);
  setOrDel("occasionTag", filters.occasionTag);
  setOrDel("onlyFav", filters.onlyFav ? "1" : "");

  setOrDel("pmin", filters.pmin);
  setOrDel("pmax", filters.pmax);
  setOrDel("sort", filters.sort);

  setOrDel("status", filters.status);
  setOrDel("moderationStatus", filters.moderationStatus);
  setOrDel("hidden", filters.hidden ? "1" : "");

  setOrDel("availability", filters.availability);
  setOrDel(
    "leadTimeMax",
    filters.leadTimeMax === "" ? "" : Number(filters.leadTimeMax)
  );
  setOrDel("acceptsCustom", filters.acceptsCustom ? "1" : "");

  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── LocalStorage per magazin
export function loadFiltersFromLS(shopId) {
  try {
    const raw = localStorage.getItem(filtersKey(shopId));
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    return parsed;
  } catch {
    return null;
  }
}

export function saveFiltersToLS(filters, shopId) {
  try {
    const toSave = {
      q: filters.q || "",
      category: filters.category || "",
      color: filters.color || "",
      material: filters.material || "",
      technique: filters.technique || "",
      styleTag: filters.styleTag || "",
      occasionTag: filters.occasionTag || "",
      onlyFav: !!filters.onlyFav,

      pmin: filters.pmin === "" ? "" : Number(filters.pmin),
pmax: filters.pmax === "" ? "" : Number(filters.pmax),
      sort: filters.sort || "relevant",

      status: filters.status || "",
      moderationStatus: filters.moderationStatus || "",
      hidden: !!filters.hidden,

      availability: filters.availability || "",
      leadTimeMax:
        filters.leadTimeMax === ""
          ? ""
          : Number(filters.leadTimeMax) || "",
      acceptsCustom: !!filters.acceptsCustom,
    };

    localStorage.setItem(filtersKey(shopId), JSON.stringify(toSave));
  } catch {
    // ignore
  }
}

export function clearFiltersFromLS(shopId) {
  try {
    localStorage.removeItem(filtersKey(shopId));
  } catch {
    // ignore
  }
}