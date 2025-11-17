const QS_KEY = "store_products_filters_v2"; // schimbă versiunea dacă vrei să „rupi” LS vechi

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
    color: p.get("color") || "",          // 🆕 culoare
    onlyFav: !!getBool("onlyFav"),
    pmin: getNum("pmin"),
    pmax: getNum("pmax"),
    sort: p.get("sort") || "",
    // vendor-only
    status: p.get("status") || "",
    hidden: !!getBool("hidden"),
    // handmade
    availability: p.get("availability") || "",
    leadTimeMax: (p.get("leadTimeMax") ?? "") === "" ? "" : getNum("leadTimeMax") ?? "",
    acceptsCustom: !!getBool("acceptsCustom"),
  };
}

// ── util: scriere în URL (păstrăm cheile existente dacă nu se schimbă)
export function writeFiltersToSearch(filters, currentSearch = "") {
  const p = new URLSearchParams((currentSearch || "").replace(/^\?/, ""));

  const setOrDel = (key, val, emptyOk = false) => {
    if (val === undefined || val === null || (!emptyOk && val === "")) p.delete(key);
    else p.set(key, String(val));
  };

  setOrDel("q", filters.q, true);
  setOrDel("category", filters.category);
  setOrDel("color", filters.color);                       // 🆕 culoare
  setOrDel("onlyFav", filters.onlyFav ? "1" : "");
  setOrDel("pmin", filters.pmin);
  setOrDel("pmax", filters.pmax);
  setOrDel("sort", filters.sort);

  // vendor-only
  setOrDel("status", filters.status);
  setOrDel("hidden", filters.hidden ? "1" : "");

  // handmade
  setOrDel("availability", filters.availability);
  setOrDel("leadTimeMax", filters.leadTimeMax === "" ? "" : Number(filters.leadTimeMax));
  setOrDel("acceptsCustom", filters.acceptsCustom ? "1" : "");

  const s = p.toString();
  return s ? `?${s}` : "";
}

// ── LocalStorage
export function loadFiltersFromLS() {
  try {
    const raw = localStorage.getItem(QS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // validare minimă ca să nu stricăm state-ul
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFiltersToLS(filters) {
  try {
    const toSave = {
      q: filters.q || "",
      category: filters.category || "",
      color: filters.color || "",                         // 🆕 culoare
      onlyFav: !!filters.onlyFav,
      pmin: Number(filters.pmin) || 0,
      pmax: Number.isFinite(Number(filters.pmax)) ? Number(filters.pmax) : 0,
      sort: filters.sort || "relevant",
      status: filters.status || "",
      hidden: !!filters.hidden,
      availability: filters.availability || "",
      leadTimeMax: filters.leadTimeMax === "" ? "" : Number(filters.leadTimeMax) || "",
      acceptsCustom: !!filters.acceptsCustom,
    };
    localStorage.setItem(QS_KEY, JSON.stringify(toSave));
  } catch {
    // ignore
  }
}
