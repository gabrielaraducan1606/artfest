/// client/src/pages/Vendor/ProfilMagazin/hooks/useProfilMagazin.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../lib/api.js";

/* ================= Fallback categorii (labels + grupuri) ================= */
const FALLBACK_CATEGORY_LABELS = {
  "papetarie_invitatii-nunta": "Invitații nuntă",
  "papetarie_invitatii-botez": "Invitații botez",
  "papetarie_invitatii-corporate": "Invitații corporate",
  "papetarie_invitatii-petrecere": "Invitații petrecere",
  "papetarie_place-cards": "Place cards",
  "papetarie_meniuri": "Meniuri",
  "papetarie_numere-mese": "Numere mese",
  "papetarie_guest-book": "Guest book",
  "papetarie_guest-book-alternativ": "Guest book alternativ",
  "papetarie_etichete-personalizate": "Etichete personalizate",
  "papetarie_stickere": "Stickere",
  "papetarie_sigilii-ceara": "Sigilii din ceară",
  "papetarie_carduri-cadou": "Carduri cadou",
  "papetarie_plicuri-bani": "Plicuri de bani",
  "papetarie_afis-welcome": "Afiș Welcome",
  "papetarie_afis-program": "Afiș Programul Zilei",
  "papetarie_afis-bar-menu": "Afiș Meniu Bar",

  "ceremonie_pernuta-verighete": "Pernuță verighete",
  "ceremonie_cutie-verighete": "Cutie verighete",
  "ceremonie_pahare-miri": "Pahare miri",
  "ceremonie_cufar-dar": "Cufăr dar",
  "ceremonie_set-taiere-tort": "Set tăiere tort",
  "ceremonie_lumanari-biserica": "Lumânări biserică",
  "ceremonie_trusou-botez": "Trusou botez",
  "ceremonie_cutie-amintiri-botez": "Cutie amintiri botez",
  "ceremonie_cruciulite-botez": "Cruciuțe/broșe botez",

  "home_lumanari-parfumate": "Lumânări parfumate",
  "home_difuzoare-parfum-camera": "Difuzoare & parfumuri cameră",
  "home_ceramica-lut": "Obiecte ceramică / lut",
  "home_textile-decor": "Textile decorative",
  "home_lemn-decor": "Obiecte din lemn",
  "home_imprimare-3d": "Obiecte print 3D",
  "home_decor-perete": "Decor de perete",

  "bijuterii_bratari": "Brățări",
  "bijuterii_coliere": "Coliere",
  "bijuterii_cercei": "Cercei",
  "bijuterii_seturi": "Seturi bijuterii",
  "bijuterii_accesorii-mireasa_coronita": "Accesorii mireasă: coroniță",
  "bijuterii_accesorii-mireasa_agrafa": "Accesorii mireasă: agrafă",
  "bijuterii_papioane": "Papioane",
  "bijuterii_butoni": "Butoni",
  "bijuterii_brose": "Broșe",

  "marturii_nunta": "Mărturii nuntă",
  "marturii_botez": "Mărturii botez",
  "marturii_corporate": "Mărturii corporate",
  "marturii_mini-plante": "Mini-plante / suculente",
  "marturii_miere": "Miere artizanală",
  "marturii_dulceturi": "Dulcețuri & gemuri",
  "marturii_biscuiti": "Biscuiți / cookies",
  "marturii_magneti": "Magneți personalizați",
  "marturii_mini-lumanari": "Mini-lumânări",
  "marturii_obiecte-gravate": "Obiecte gravate",

  "cadouri_pentru-miri": "Cadouri pentru miri",
  "cadouri_pentru-nasi": "Cadouri pentru nași",
  "cadouri_pentru-parinti": "Cadouri pentru părinți",
  "cadouri_botez": "Cadouri botez",
  "cadouri_cutii-cadou": "Cutii cadou",
  "cadouri_cosuri-cadou": "Coșuri cadou",
  "cadouri_portrete-ilustrate": "Portrete ilustrate",
  "cadouri_portrete-pictate": "Portrete pictate",
  "cadouri_caricaturi": "Caricaturi",
  "cadouri_albume-foto": "Albume foto",
  "cadouri_scrapbook": "Scrapbook",
  "cadouri_rame-foto": "Rame foto",
  "cadouri_tablou-amintire": "Tablou amintire",
  "cadouri_puzzle-personalizat": "Puzzle personalizat",
  "cadouri_harta-stelara": "Hartă stelară",
  "cadouri_harta-razuibila": "Hartă răzuibilă",
  "cadouri_boxa-muzicala": "Boxă muzicală personalizată",
  "cadouri_obiecte-cu-nume": "Obiecte cu nume/mesaj",

  "arta_tablouri": "Tablouri",
  "arta_ilustratii-digitale": "Ilustrații digitale",
  "arta_pe-lemn": "Artă pe lemn",
  "arta_pe-sticla": "Artă pe sticlă",
  "arta_macrame": "Macramé",
  "arta_rasina-epoxidica": "Rășină epoxidică",
  "arta_quilling": "Quilling",
  "arta_flori-de-hartie": "Flori din hârtie",

  "textile_rochii-ceremonie-copii": "Rochii ceremonie copii",
  "textile_body-personalizat-bebe": "Body personalizat bebe",
  "textile_hainute-tematice": "Hăinuțe tematice",
  "textile_paturi-personalizate": "Pături personalizate",
  "textile_seturi-bebe": "Seturi bebe personalizate",
  "textile_personalizare-broderie": "Personalizare textile – broderie",
  "textile_personalizare-imprimare": "Personalizare textile – imprimare",

  "party_figurine-tort": "Figurine tort",
  "party_cake-toppers": "Cake toppers",
  "party_standuri-prajituri": "Standuri prăjituri",
  "party_toppers-cupcakes": "Topper-e cupcakes",
  "party_borcanase-dulciuri": "Borcanase dulciuri",
  "party_cutiute-dulciuri": "Căsuțe dulciuri",
  "party_baloane-party": "Baloane (petrecere)",
  "party_confetti": "Confetti",
  "party_bannere": "Bannere",
  "party_seturi-petreceri": "Seturi petreceri",

  alte: "Altele",
};

const FALLBACK_CATEGORY_GROUP_LABELS = {
  decor: "Decor pentru evenimente",
  papetarie: "Papetărie & personalizări",
  ceremonie: "Ceremonie & ritualuri",
  home: "Home & lifestyle handmade",
  bijuterii: "Bijuterii & accesorii",
  marturii: "Mărturii & mini-cadou",
  cadouri: "Cadouri & personalizate",
  arta: "Artă & artizanat",
  textile: "Textile & croitorie",
  party: "Candy bar & party",
  alte: "Altele",
};

const FALLBACK_CATEGORIES_DETAILED = Object.entries(
  FALLBACK_CATEGORY_LABELS
).map(([key, label]) => {
  const group = key.split("_")[0] || "alte";
  return {
    key,
    label,
    group,
    groupLabel: FALLBACK_CATEGORY_GROUP_LABELS[group] || "Altele",
  };
});

export const FALLBACK_CATEGORIES = Object.keys(FALLBACK_CATEGORY_LABELS);

/* ========= Helpers URL + cache-buster ========= */
const BACKEND_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const isHttp = (u = "") => /^https?:\/\//i.test(u);
const isDataOrBlob = (u = "") => /^(data|blob):/i.test(u);

export const resolveFileUrl = (u) => {
  if (!u) return "";
  if (isHttp(u) || isDataOrBlob(u)) return u;

  const path = u.startsWith("/") ? u : `/${u}`;
  return BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
};

export const withCache = (url, t) =>
  !url || !isHttp(url)
    ? url
    : url.includes("?")
    ? `${url}&t=${t}`
    : `${url}?t=${t}`;

/* ================== Session cache ================== */
const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed?.t) return null;
    if (Date.now() - parsed.t > CACHE_TTL_MS) return null;

    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        t: Date.now(),
        ...value,
      })
    );
  } catch {
    // ignore
  }
}

/* ===== debounce util ===== */
export function useDebouncedCallback(fn, delay = 600) {
  const fnRef = useRef(fn);
  const tRef = useRef(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const call = useCallback(
    (...args) => {
      if (tRef.current) clearTimeout(tRef.current);
      tRef.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay]
  );

  useEffect(
    () => () => {
      if (tRef.current) clearTimeout(tRef.current);
    },
    []
  );

  return call;
}

/* ====== hook: județe din API ====== */
function useRoCounties() {
  const [list, setList] = useState([]);
  const [all, setAll] = useState({
    code: "RO-ALL",
    name: "Toată țara",
  });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setErr("");

        const d = await api("/api/geo/ro/counties", {
          method: "GET",
        });

        if (!alive) return;

        const items = Array.isArray(d?.items) ? d.items : [];
        items.sort((a, b) => a.name.localeCompare(b.name, "ro"));

        setList(items);

        if (d?.all) setAll(d.all);
      } catch (e) {
        if (!alive) return;

        setErr(e?.message || "Nu am putut încărca județele.");
        setList([{ code: "B", name: "București" }]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const suggestions = useMemo(
    () => [all.name, ...list.map((c) => c.name)],
    [list, all]
  );

  return {
    suggestions,
    all,
    loading,
    err,
  };
}

/* ===== Utils ===== */
const normalizePhone = (v) => {
  const raw = String(v || "").replace(/\s+/g, "");

  if (/^0?7\d{8}$/.test(raw)) {
    return `+4${raw.startsWith("0") ? raw.slice(1) : raw}`;
  }

  if (/^\+?4?07\d{8}$/.test(raw)) {
    return raw.startsWith("+") ? raw : `+${raw}`;
  }

  return v || "";
};

/* ===== Form produs gol ===== */
const EMPTY_PROD_FORM = {
  title: "",
  description: "",
  price: "",
  images: [],
  category: "",
  color: "",
  availability: "READY",
  leadTimeDays: "",
  readyQty: "",
  nextShipDate: "",
  acceptsCustom: false,
  isHidden: false,
  isActive: true,

  materialMain: "",
  technique: "",
  styleTags: "",
  occasionTags: "",
  dimensions: "",
  careInstructions: "",
  specialNotes: "",
};

export default function useProfilMagazin(slug, opts = {}) {
  const meFromProps = opts.me ?? null;
  const requestIdRef = useRef(0);

  const [sellerData, setSellerData] = useState(null);
  const [products, setProducts] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState(0);

  const [me, setMe] = useState(meFromProps);
  const [isOwner, setIsOwner] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  const [favorites, setFavorites] = useState(() => new Set());

  const [categories, setCategories] = useState(FALLBACK_CATEGORIES_DETAILED);
  const categoriesLoadedRef = useRef(false);

  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [savingProd, setSavingProd] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [prodForm, setProdForm] = useState(EMPTY_PROD_FORM);

  const [editInfo, setEditInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSavedAt, setInfoSavedAt] = useState(null);
  const [infoErr, setInfoErr] = useState("");
  const [infoDraft, setInfoDraft] = useState({
    address: "",
    phone: "",
    email: "",
    deliveryArr: [],
    leadTimes: "",
  });

  const serviceId =
    sellerData?.serviceId ||
    sellerData?.service?.id ||
    sellerData?.profile?.serviceId ||
    sellerData?.id ||
    null;

  const {
    suggestions: countySuggestions,
    all: allCountry,
    loading: countiesLoading,
    err: countiesErr,
  } = useRoCounties();

  useEffect(() => {
    setMe(meFromProps);
  }, [meFromProps]);

  const saveProfilePart = useCallback(
    async (patch) => {
      if (!isOwner || !serviceId) return;

      setSavingInfo(true);
      setInfoErr("");

      try {
        await api(
          `/api/vendors/vendor-services/${encodeURIComponent(
            serviceId
          )}/profile`,
          {
            method: "PUT",
            body: {
              ...(patch.address !== undefined
                ? { address: patch.address || null }
                : {}),
              ...(patch.phone !== undefined
                ? { phone: normalizePhone(patch.phone) || null }
                : {}),
              ...(patch.email !== undefined
                ? { email: patch.email || null }
                : {}),
              ...(patch.deliveryArr !== undefined
                ? { delivery: patch.deliveryArr || [] }
                : {}),
            },
          }
        );

        setSellerData((s) =>
          s
            ? {
                ...s,
                address:
                  patch.address !== undefined ? patch.address || "" : s.address,
                phone:
                  patch.phone !== undefined
                    ? normalizePhone(patch.phone)
                    : s.phone,
                publicEmail:
                  patch.email !== undefined ? patch.email || "" : s.publicEmail,
                delivery:
                  patch.deliveryArr !== undefined
                    ? patch.deliveryArr || []
                    : s.delivery,
              }
            : s
        );

        setInfoSavedAt(Date.now());
      } catch (e) {
        setInfoErr(e?.message || "Nu am putut salva datele.");
      } finally {
        setSavingInfo(false);
      }
    },
    [isOwner, serviceId]
  );

  const saveLeadTimes = useCallback(
    async (nextLeadTimes) => {
      if (!isOwner || !serviceId) return;

      setSavingInfo(true);
      setInfoErr("");

      try {
        const meServices = await api(
          "/api/vendors/me/services?includeProfile=1",
          {
            method: "GET",
          }
        );

        const items = Array.isArray(meServices?.items) ? meServices.items : [];
        const mine = items.find((x) => x.id === serviceId);

        const merged = {
          ...(mine?.attributes || {}),
          leadTimes: nextLeadTimes || "",
        };

        await api(`/api/vendors/me/services/${encodeURIComponent(serviceId)}`, {
          method: "PATCH",
          body: { attributes: merged },
        });

        setSellerData((s) =>
          s ? { ...s, leadTimes: nextLeadTimes || "" } : s
        );

        setInfoSavedAt(Date.now());
      } catch (e) {
        setInfoErr(e?.message || "Nu am putut salva termenele de execuție.");
      } finally {
        setSavingInfo(false);
      }
    },
    [isOwner, serviceId]
  );

  const debouncedAutoSave = useDebouncedCallback((draft) => {
    saveProfilePart({
      address: draft.address,
      phone: draft.phone,
      email: draft.email,
      deliveryArr: draft.deliveryArr,
    });

    saveLeadTimes(draft.leadTimes);
  }, 600);

  const onCountiesChange = (arr) => {
    const clean = Array.isArray(arr) ? arr.filter(Boolean) : [];

    if (clean.includes(allCountry.name)) {
      const one = [allCountry.name];

      setInfoDraft((d) => ({
        ...d,
        deliveryArr: one,
      }));

      debouncedAutoSave({
        ...infoDraft,
        deliveryArr: one,
      });

      return;
    }

    const uniq = [...new Set(clean)]
      .filter((n) => n !== allCountry.name)
      .sort((a, b) => a.localeCompare(b, "ro"));

    setInfoDraft((d) => ({
      ...d,
      deliveryArr: uniq,
    }));

    debouncedAutoSave({
      ...infoDraft,
      deliveryArr: uniq,
    });
  };

  const loadCategoriesOnce = useCallback(async () => {
    if (categoriesLoadedRef.current) return;

    const catCached = readCache("pm:categories");

    if (catCached?.categories?.length) {
      setCategories(catCached.categories);
      categoriesLoadedRef.current = true;
      return;
    }

    try {
      const det = await api("/api/public/categories/detailed");

      if (Array.isArray(det) && det.length && typeof det[0] === "object") {
        setCategories(det);
        writeCache("pm:categories", { categories: det });
        categoriesLoadedRef.current = true;
        return;
      }

      const list = await api("/api/public/categories");

      if (Array.isArray(list) && list.length) {
        if (typeof list[0] === "string") {
          const detFromSimple = list.map((key) => ({
            key,
            label: FALLBACK_CATEGORY_LABELS[key] || key,
            group: key.split("_")[0] || "alte",
            groupLabel:
              FALLBACK_CATEGORY_GROUP_LABELS[key.split("_")[0]] || "Altele",
          }));

          setCategories(detFromSimple);
          writeCache("pm:categories", {
            categories: detFromSimple,
          });
        } else {
          setCategories(list);
          writeCache("pm:categories", {
            categories: list,
          });
        }

        categoriesLoadedRef.current = true;
        return;
      }

      setCategories(FALLBACK_CATEGORIES_DETAILED);
      writeCache("pm:categories", {
        categories: FALLBACK_CATEGORIES_DETAILED,
      });
      categoriesLoadedRef.current = true;
    } catch {
      setCategories(FALLBACK_CATEGORIES_DETAILED);
      writeCache("pm:categories", {
        categories: FALLBACK_CATEGORIES_DETAILED,
      });
      categoriesLoadedRef.current = true;
    }
  }, []);

  const fetchEverything = useCallback(async () => {
    if (!slug) return;

    const requestId = ++requestIdRef.current;
    const currentSlug = slug;
    const currentCacheKey = `pm:${currentSlug}`;

    const isCurrent = () => requestIdRef.current === requestId;

    setLoading(true);
    setErr(null);
    setNeedsOnboarding(false);

    setSellerData(null);
    setProducts([]);
    setReviews([]);
    setRating(0);
    setIsOwner(false);
    setFavorites(new Set());

    const cached = readCache(currentCacheKey);

    if (cached?.sellerData && isCurrent()) {
      setSellerData(cached.sellerData);
      setProducts(Array.isArray(cached.products) ? cached.products : []);
      setRating(Number(cached.rating || 0));
    }

    try {
      await loadCategoriesOnce();

      if (!isCurrent()) return;

      let meNow = meFromProps;

      if (!meFromProps) {
        try {
          const d = await api("/api/auth/me");

          if (!isCurrent()) return;

          meNow = d?.user || null;
          setMe(meNow);
        } catch {
          if (!isCurrent()) return;

          meNow = null;
          setMe(null);
        }
      }

      let shop;

      try {
        shop = await api(`/api/public/store/${encodeURIComponent(currentSlug)}`);
      } catch (e) {
        if (!isCurrent()) return;

        if ([404, 400].includes(e?.status)) {
          setErr("Magazinul nu a fost găsit.");
          setSellerData(null);
          setProducts([]);
          setReviews([]);
          setRating(0);
          setLoading(false);
          return;
        }

        throw e;
      }

      if (!isCurrent()) return;

      setSellerData(shop);

      const owner =
        !!meNow &&
        !!shop?.userId &&
        (meNow.id === shop.userId || meNow.sub === shop.userId);

      setIsOwner(owner);
      setLoading(false);

      writeCache(currentCacheKey, {
        sellerData: shop,
        products: [],
        rating: 0,
      });

      const productsPromise = (async () => {
        try {
          const productsPath = owner
            ? `/api/vendors/store/${encodeURIComponent(currentSlug)}/products`
            : `/api/public/store/${encodeURIComponent(currentSlug)}/products`;

          const resp = await api(productsPath);

          if (!isCurrent()) return;

          const itemsRaw = Array.isArray(resp?.items)
            ? resp.items
            : Array.isArray(resp)
            ? resp
            : [];

          setProducts(itemsRaw);

          writeCache(currentCacheKey, {
            sellerData: shop,
            products: itemsRaw,
            rating: Number(rating || 0),
          });
        } catch {
          if (!isCurrent()) return;
          setProducts([]);
        }
      })();

      const favoritesPromise = (async () => {
        if (!meNow) return;

        try {
          const fav = await api("/api/vendors/favorites");

          if (!isCurrent()) return;

          const ids = new Set(
            (Array.isArray(fav?.items) ? fav.items : []).map(
              (x) => x.productId
            )
          );

          setFavorites(ids);
        } catch {
          // ignore
        }
      })();

      const ratingPromise = (async () => {
        try {
          const avg = await api(
            `/api/public/store/${encodeURIComponent(
              currentSlug
            )}/reviews/average`
          );

          if (!isCurrent()) return;

          const nextRating = Number(avg?.average || 0);

          setRating(nextRating);
          setReviews([]);

          const latestCache = readCache(currentCacheKey);

          writeCache(currentCacheKey, {
            sellerData: shop,
            products: Array.isArray(latestCache?.products)
              ? latestCache.products
              : [],
            rating: nextRating,
          });
        } catch {
          if (!isCurrent()) return;

          setRating(0);
          setReviews([]);
        }
      })();

      Promise.allSettled([
        productsPromise,
        favoritesPromise,
        ratingPromise,
      ]).catch(() => {});
    } catch (error) {
      if (!isCurrent()) return;

      console.error("Eroare încărcare profil magazin:", error);

      setErr("Nu am putut încărca magazinul.");
      setSellerData(null);
      setProducts([]);
      setReviews([]);
      setRating(0);
      setLoading(false);
    }
  }, [slug, meFromProps, loadCategoriesOnce, rating]);

  useEffect(() => {
    fetchEverything();

    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchEverything]);

  useEffect(() => {
    if (!sellerData) return;

    const deliveryArr = Array.isArray(sellerData.delivery)
      ? sellerData.delivery
      : [];

    setInfoDraft({
      address: sellerData.address || "",
      phone: sellerData.phone || "",
      email: sellerData.publicEmail || "",
      deliveryArr,
      leadTimes: sellerData.leadTimes || "",
    });
  }, [sellerData]);

  const cacheT = useMemo(
    () =>
      sellerData?.updatedAt
        ? new Date(sellerData.updatedAt).getTime()
        : Date.now(),
    [sellerData?.updatedAt]
  );

  const productsCacheTRef = useRef(Date.now());

  useEffect(() => {
    productsCacheTRef.current = Date.now();
  }, [products]);

  const viewMode = isOwner ? "vendor" : me ? "user" : "guest";

  async function uploadFile(file) {
    const fd = new FormData();
    fd.append("file", file);

    const { url } = await api("/api/upload", {
      method: "POST",
      body: fd,
    });

    return url;
  }

  const onChangeInfoDraft = (patch) => {
    setInfoDraft((d) => {
      const next = {
        ...d,
        ...patch,
      };

      debouncedAutoSave(next);

      return next;
    });
  };

  const saveInfoNow = useCallback(async () => {
    const d = infoDraft;

    await Promise.all([
      saveProfilePart({
        address: d.address,
        phone: d.phone,
        email: d.email,
        deliveryArr: d.deliveryArr,
      }),
      saveLeadTimes(d.leadTimes),
    ]);

    setEditInfo(false);
  }, [infoDraft, saveProfilePart, saveLeadTimes]);

  const openNewProduct = () => {
    if (!isOwner) return;

    setEditingProduct(null);
    setProdForm(EMPTY_PROD_FORM);
    setProdModalOpen(true);
  };

  const dateOnlyToISO = (yyyyMmDd) => {
    if (!yyyyMmDd) return null;

    const [y, m, d] = String(yyyyMmDd).split("-").map(Number);

    if (!y || !m || !d) return null;

    const dt = new Date(y, m - 1, d, 12, 0, 0);
    return dt.toISOString();
  };

  const onSaveProduct = async (e) => {
    e.preventDefault();

    if (!isOwner) return;

    const title = (prodForm.title || "").trim();
    const description = (prodForm.description || "").trim();
    const price = Number(prodForm.price);
    const category = (prodForm.category || "").trim();
    const images = Array.isArray(prodForm.images) ? prodForm.images : [];
    const color = (prodForm.color || "").trim() || null;

    const materialMain = (prodForm.materialMain || "").trim() || null;
    const technique = (prodForm.technique || "").trim() || null;
    const styleTags = (prodForm.styleTags || "").trim();
    const occasionTags = (prodForm.occasionTags || "").trim();
    const dimensions = (prodForm.dimensions || "").trim() || null;
    const careInstructions = (prodForm.careInstructions || "").trim() || null;
    const specialNotes = (prodForm.specialNotes || "").trim() || null;

    if (!title) return alert("Te rog adaugă un titlu.");
    if (!Number.isFinite(price) || price < 0) return alert("Preț invalid.");
    if (!category) return alert("Selectează categoria produsului.");

    try {
      setSavingProd(true);

      const basePayload = {
        title,
        description,
        price,
        images,
        category,
        color,
        acceptsCustom: !!prodForm.acceptsCustom,
        isHidden: !!prodForm.isHidden,
        isActive: prodForm.isActive !== false,

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
        if (prodForm.readyQty !== "" && prodForm.readyQty !== undefined) {
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

      if (editingProduct && (editingProduct.id || editingProduct._id)) {
        const id = editingProduct.id || editingProduct._id;

        await api(`/api/vendors/products/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: payload,
        });
      } else {
        await api(`/api/vendors/store/${encodeURIComponent(slug)}/products`, {
          method: "POST",
          body: payload,
        });
      }

      setProdModalOpen(false);
      setEditingProduct(null);
      setProdForm(EMPTY_PROD_FORM);

      fetchEverything();
    } catch (error) {
      console.error("Eroare la salvarea produsului:", error);
      alert(error?.message || "Eroare la salvarea produsului.");
    } finally {
      setSavingProd(false);
    }
  };

  return {
    sellerData,
    products,
    reviews,
    rating,
    me,
    isOwner,
    viewMode,
    categories,
    favorites,
    loading,
    err,
    needsOnboarding,
    cacheT,
    productsCacheT: productsCacheTRef.current,

    editInfo,
    setEditInfo,
    savingInfo,
    infoSavedAt,
    infoErr,
    infoDraft,
    setInfoDraft,
    onChangeInfoDraft,
    countySuggestions,
    countiesLoading,
    countiesErr,
    onCountiesChange,
    saveInfoNow,

    prodModalOpen,
    setProdModalOpen,
    savingProd,
    editingProduct,
    setEditingProduct,
    prodForm,
    setProdForm,

    fetchEverything,
    uploadFile,
    openNewProduct,
    onSaveProduct,
  };
}