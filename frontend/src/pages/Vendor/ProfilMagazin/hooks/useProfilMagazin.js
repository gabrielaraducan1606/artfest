/// client/src/pages/Vendor/ProfilMagazin/hooks/useProfilMagazin.js

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "../../../../lib/api.js";

/* ================= Fallback categorii ================= */

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
    groupLabel:
      FALLBACK_CATEGORY_GROUP_LABELS[group] || "Altele",
  };
});

export const FALLBACK_CATEGORIES = Object.keys(
  FALLBACK_CATEGORY_LABELS
);

/* ================= URL helpers ================= */

const BACKEND_BASE = (
  import.meta.env.VITE_API_URL || ""
).replace(/\/+$/, "");

const isHttp = (value = "") =>
  /^https?:\/\//i.test(value);

const isDataOrBlob = (value = "") =>
  /^(data|blob):/i.test(value);

export const resolveFileUrl = (value) => {
  if (!value) return "";

  if (isHttp(value) || isDataOrBlob(value)) {
    return value;
  }

  const path = value.startsWith("/")
    ? value
    : `/${value}`;

  return BACKEND_BASE
    ? `${BACKEND_BASE}${path}`
    : path;
};

export const withCache = (url, timestamp) => {
  if (!url || !isHttp(url)) {
    return url;
  }

  return url.includes("?")
    ? `${url}&t=${timestamp}`
    : `${url}?t=${timestamp}`;
};

/* ================= Session cache ================= */

const CACHE_TTL_MS = 5 * 60 * 1000;

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);

    if (!parsed?.t) {
      return null;
    }

    if (Date.now() - parsed.t > CACHE_TTL_MS) {
      return null;
    }

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
    // Cache indisponibil.
  }
}

/* ================= Debounce ================= */

export function useDebouncedCallback(fn, delay = 600) {
  const fnRef = useRef(fn);
  const timeoutRef = useRef(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const call = useCallback(
    (...args) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        fnRef.current(...args);
      }, delay);
    },
    [delay]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return call;
}

/* ================= Utils ================= */

const normalizePhone = (value) => {
  const raw = String(value || "").replace(/\s+/g, "");

  if (/^0?7\d{8}$/.test(raw)) {
    return `+4${raw.startsWith("0") ? raw.slice(1) : raw}`;
  }

  if (/^\+?4?07\d{8}$/.test(raw)) {
    return raw.startsWith("+") ? raw : `+${raw}`;
  }

  return value || "";
};

function normalizeSellerTypeForProfile(shop) {
  const sellerType =
    shop?.sellerType ||
    shop?.vendor?.sellerType ||
    shop?.vendor?.billing?.sellerType ||
    shop?.billing?.sellerType ||
    shop?.profile?.service?.vendor?.billing?.sellerType ||
    "";

  const sellerTypeLabel =
    shop?.sellerTypeLabel ||
    (sellerType === "independent_creator"
      ? "Creator independent la început de drum"
      : sellerType === "verified_business"
        ? "Business verificat"
        : "");

  return {
    ...shop,
    sellerType,
    sellerTypeLabel,
  };
}

function normalizeObject(value) {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? value
    : null;
}

function normalizeStringArray(value, max = 50) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

function normalizeSchemaArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultQuoteSchema() {
  return [
    {
      key: "description",
      label: "Descriere cerere",
      type: "textarea",
      required: true,
    },
    {
      key: "inspirationImages",
      label: "Poze inspirație",
      type: "file",
      required: false,
    },
  ];
}

function normalizeProductOrderMode(value) {
  const mode = String(value || "READY_TO_BUY")
    .trim()
    .toUpperCase();

  if (mode === "DIRECT") {
    return "READY_TO_BUY";
  }

  if (mode === "CUSTOMIZABLE") {
    return "OPTIONS";
  }

  if (
    ["READY_TO_BUY", "OPTIONS", "QUOTE_ONLY"].includes(
      mode
    )
  ) {
    return mode;
  }

  return "READY_TO_BUY";
}

/* ================= Form produs gol ================= */

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

  orderMode: "READY_TO_BUY",
  optionsSchema: [],
  customSchema: [],
  quoteSchema: [],

  aiVisionAnalysis: null,
  aiOrderAnalysis: null,
  aiGeneratedFields: [],
  aiSourceImages: [],
  aiAnalysisVersion: null,
  aiConfidence: null,
  aiAnalyzedAt: null,
  aiManuallyEdited: false,

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
  const [needsOnboarding, setNeedsOnboarding] =
    useState(false);

  const [favorites, setFavorites] = useState(
    () => new Set()
  );

  const [categories, setCategories] = useState(
    FALLBACK_CATEGORIES_DETAILED
  );

  const categoriesLoadedRef = useRef(false);

  const [prodModalOpen, setProdModalOpen] =
    useState(false);

  const [savingProd, setSavingProd] =
    useState(false);

  const [editingProduct, setEditingProduct] =
    useState(null);

  const [prodForm, setProdForm] = useState(
    EMPTY_PROD_FORM
  );

  const [editInfo, setEditInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoSavedAt, setInfoSavedAt] = useState(null);
  const [infoErr, setInfoErr] = useState("");

  const [infoDraft, setInfoDraft] = useState({
    address: "",
    phone: "",
    email: "",
  });

  const serviceId =
    sellerData?.serviceId ||
    sellerData?.service?.id ||
    sellerData?.profile?.serviceId ||
    sellerData?.id ||
    null;

  useEffect(() => {
    setMe(meFromProps);
  }, [meFromProps]);

  /* ================= Profil magazin ================= */

  const saveProfilePart = useCallback(
    async (patch) => {
      if (!isOwner || !serviceId) {
        return;
      }

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
                ? {
                    address: patch.address || null,
                  }
                : {}),

              ...(patch.phone !== undefined
                ? {
                    phone:
                      normalizePhone(patch.phone) || null,
                  }
                : {}),

              ...(patch.email !== undefined
                ? {
                    email: patch.email || null,
                  }
                : {}),
            },
          }
        );

        setSellerData((current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,

            address:
              patch.address !== undefined
                ? patch.address || ""
                : current.address,

            phone:
              patch.phone !== undefined
                ? normalizePhone(patch.phone)
                : current.phone,

            publicEmail:
              patch.email !== undefined
                ? patch.email || ""
                : current.publicEmail,
          };
        });

        setInfoSavedAt(Date.now());
      } catch (error) {
        setInfoErr(
          error?.message ||
            "Nu am putut salva datele."
        );
      } finally {
        setSavingInfo(false);
      }
    },
    [isOwner, serviceId]
  );

  const debouncedAutoSave = useDebouncedCallback(
    (draft) => {
      saveProfilePart({
        address: draft.address,
        phone: draft.phone,
        email: draft.email,
      });
    },
    600
  );

  /* ================= Categorii ================= */

  const loadCategoriesOnce = useCallback(async () => {
    if (categoriesLoadedRef.current) {
      return;
    }

    const cached = readCache("pm:categories");

    if (cached?.categories?.length) {
      setCategories(cached.categories);
      categoriesLoadedRef.current = true;
      return;
    }

    try {
      const detailed = await api(
        "/api/public/categories/detailed"
      );

      if (
        Array.isArray(detailed) &&
        detailed.length &&
        typeof detailed[0] === "object"
      ) {
        setCategories(detailed);

        writeCache("pm:categories", {
          categories: detailed,
        });

        categoriesLoadedRef.current = true;
        return;
      }

      const list = await api("/api/public/categories");

      if (Array.isArray(list) && list.length) {
        if (typeof list[0] === "string") {
          const detailedFromSimple = list.map((key) => {
            const group = key.split("_")[0] || "alte";

            return {
              key,
              label:
                FALLBACK_CATEGORY_LABELS[key] || key,
              group,
              groupLabel:
                FALLBACK_CATEGORY_GROUP_LABELS[group] ||
                "Altele",
            };
          });

          setCategories(detailedFromSimple);

          writeCache("pm:categories", {
            categories: detailedFromSimple,
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

  /* ================= Încărcare magazin ================= */

  const fetchEverything = useCallback(async () => {
    if (!slug) {
      return;
    }

    const requestId = ++requestIdRef.current;
    const currentSlug = slug;
    const cacheKey = `pm:v12:${currentSlug}`;

    const isCurrent = () =>
      requestIdRef.current === requestId;

    const cached = readCache(cacheKey);

    setLoading(true);
    setErr(null);
    setNeedsOnboarding(false);
    setReviews([]);
    setFavorites(new Set());

    try {
      loadCategoriesOnce();

      if (!isCurrent()) {
        return;
      }

      let meNow = meFromProps;

      if (!meFromProps) {
        try {
          const authResponse = await api("/api/auth/me");

          if (!isCurrent()) {
            return;
          }

          meNow = authResponse?.user || null;
          setMe(meNow);
        } catch {
          if (!isCurrent()) {
            return;
          }

          meNow = null;
          setMe(null);
        }
      }

      let normalizedShop = null;
      let itemsRaw = [];
      let ownerFromPrivateRoute = false;

      try {
        const initial = await api(
          `/api/public/store/${encodeURIComponent(
            currentSlug
          )}/initial`
        );

        if (!isCurrent()) {
          return;
        }

        if (Array.isArray(initial)) {
          throw { status: 404 };
        }

        normalizedShop =
          normalizeSellerTypeForProfile(
            initial?.shop || null
          );

        itemsRaw = Array.isArray(initial?.products)
          ? initial.products
          : [];
      } catch (publicError) {
        if (!isCurrent()) {
          return;
        }

        if (![404, 400].includes(publicError?.status)) {
          throw publicError;
        }

        try {
          const shop = await api(
            `/api/public/store/${encodeURIComponent(
              currentSlug
            )}`
          );

          if (!isCurrent()) {
            return;
          }

          normalizedShop =
            normalizeSellerTypeForProfile(shop);

          const productsResponse = await api(
            `/api/public/store/${encodeURIComponent(
              currentSlug
            )}/products`
          );

          if (!isCurrent()) {
            return;
          }

          itemsRaw = Array.isArray(
            productsResponse?.items
          )
            ? productsResponse.items
            : Array.isArray(productsResponse)
              ? productsResponse
              : [];
        } catch {
          if (meNow) {
            try {
              const shop = await api(
                `/api/vendors/store/${encodeURIComponent(
                  currentSlug
                )}`
              );

              if (!isCurrent()) {
                return;
              }

              ownerFromPrivateRoute = true;

              normalizedShop =
                normalizeSellerTypeForProfile(shop);

              const productsResponse = await api(
                `/api/vendors/store/${encodeURIComponent(
                  currentSlug
                )}/products`
              );

              if (!isCurrent()) {
                return;
              }

              itemsRaw = Array.isArray(
                productsResponse?.items
              )
                ? productsResponse.items
                : Array.isArray(productsResponse)
                  ? productsResponse
                  : [];
            } catch {
              setErr("Magazinul nu a fost găsit.");
              setSellerData(null);
              setProducts([]);
              setReviews([]);
              setRating(0);
              setLoading(false);
              return;
            }
          } else {
            setErr("Magazinul nu a fost găsit.");
            setSellerData(null);
            setProducts([]);
            setReviews([]);
            setRating(0);
            setLoading(false);
            return;
          }
        }
      }

      if (!isCurrent()) {
        return;
      }

      const owner =
        ownerFromPrivateRoute ||
        (!!meNow &&
          !!normalizedShop?.userId &&
          (meNow.id === normalizedShop.userId ||
            meNow.sub === normalizedShop.userId));

      if (owner && !normalizedShop.sellerType) {
        try {
          const billingResponse = await api(
            "/api/vendors/me/billing",
            {
              method: "GET",
            }
          );

          const billing =
            billingResponse?.billing || {};

          const sellerType =
            billing.sellerType ||
            billing.vendorType ||
            billing.accountType ||
            "";

          normalizedShop =
            normalizeSellerTypeForProfile({
              ...normalizedShop,
              sellerType,

              sellerTypeLabel:
                sellerType === "independent_creator"
                  ? "Creator independent la început de drum"
                  : sellerType === "verified_business"
                    ? "Business verificat"
                    : "",
            });
        } catch {
          // Billing indisponibil.
        }
      }

      if (owner) {
        try {
          const privateProductsResponse = await api(
            `/api/vendors/store/${encodeURIComponent(
              currentSlug
            )}/products`
          );

          if (!isCurrent()) {
            return;
          }

          itemsRaw = Array.isArray(
            privateProductsResponse?.items
          )
            ? privateProductsResponse.items
            : Array.isArray(privateProductsResponse)
              ? privateProductsResponse
              : [];
        } catch (error) {
          console.warn(
            "Nu am putut încărca produsele owner:",
            error
          );
        }
      }

      setSellerData(normalizedShop);
      setProducts(itemsRaw);
      setIsOwner(owner);
      setLoading(false);

      writeCache(cacheKey, {
        sellerData: normalizedShop,
        products: itemsRaw,
        rating: Number(cached?.rating || 0),
      });

      const favoritesPromise = (async () => {
        if (!meNow) {
          return;
        }

        try {
          const favoritesResponse = await api(
            "/api/vendors/favorites"
          );

          if (!isCurrent()) {
            return;
          }

          const ids = new Set(
            (
              Array.isArray(favoritesResponse?.items)
                ? favoritesResponse.items
                : []
            ).map((item) => item.productId)
          );

          setFavorites(ids);
        } catch {
          // Favorites indisponibile.
        }
      })();

      const ratingPromise = (async () => {
        try {
          const averageResponse = await api(
            `/api/public/store/${encodeURIComponent(
              currentSlug
            )}/reviews/average`
          );

          if (!isCurrent()) {
            return;
          }

          const nextRating = Number(
            averageResponse?.average || 0
          );

          setRating(nextRating);
          setReviews([]);

          const latestCache = readCache(cacheKey);

          writeCache(cacheKey, {
            sellerData: normalizedShop,

            products: Array.isArray(
              latestCache?.products
            )
              ? latestCache.products
              : itemsRaw,

            rating: nextRating,
          });
        } catch {
          if (!isCurrent()) {
            return;
          }

          setRating(0);
          setReviews([]);
        }
      })();

      Promise.allSettled([
        favoritesPromise,
        ratingPromise,
      ]).catch(() => {});
    } catch (error) {
      if (!isCurrent()) {
        return;
      }

      console.error(
        "Eroare încărcare profil magazin:",
        error
      );

      setErr("Nu am putut încărca magazinul.");
      setSellerData(null);
      setProducts([]);
      setReviews([]);
      setRating(0);
      setLoading(false);
    }
  }, [slug, meFromProps, loadCategoriesOnce]);

  useEffect(() => {
    fetchEverything();

    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchEverything]);

  useEffect(() => {
    if (!sellerData) {
      return;
    }

    setInfoDraft({
      address: sellerData.address || "",
      phone: sellerData.phone || "",
      email: sellerData.publicEmail || "",
    });
  }, [sellerData]);

  const cacheT = useMemo(() => {
    return sellerData?.updatedAt
      ? new Date(sellerData.updatedAt).getTime()
      : Date.now();
  }, [sellerData?.updatedAt]);

  const productsCacheTRef = useRef(Date.now());

  useEffect(() => {
    productsCacheTRef.current = Date.now();
  }, [products]);

  const viewMode = isOwner
    ? "vendor"
    : me
      ? "user"
      : "guest";

  /* ================= Upload ================= */

  async function uploadFile(file) {
    const formData = new FormData();
    formData.append("file", file);

    const { url } = await api("/api/upload", {
      method: "POST",
      body: formData,
    });

    return url;
  }

  /* ================= Profil editare ================= */

  const onChangeInfoDraft = (patch) => {
    setInfoDraft((current) => {
      const next = {
        ...current,
        ...patch,
      };

          debouncedAutoSave(next);

      return next;
    });
  };

  const saveInfoNow = useCallback(async () => {
    const currentDraft = infoDraft;

    await saveProfilePart({
      address: currentDraft.address,
      phone: currentDraft.phone,
      email: currentDraft.email,
    });

    setEditInfo(false);
  }, [infoDraft, saveProfilePart]);

  const openNewProduct = () => {
    if (!isOwner) {
      return;
    }

    setEditingProduct(null);
    setProdForm({
      ...EMPTY_PROD_FORM,
    });
    setProdModalOpen(true);
  };

  const dateOnlyToISO = (yyyyMmDd) => {
    if (!yyyyMmDd) {
      return null;
    }

    const [year, month, day] = String(yyyyMmDd)
      .split("-")
      .map(Number);

    if (!year || !month || !day) {
      return null;
    }

    const date = new Date(
      year,
      month - 1,
      day,
      12,
      0,
      0
    );

    return date.toISOString();
  };

  /* ================= Salvare produs ================= */

  const onSaveProduct = async (event) => {
    event.preventDefault();

    if (!isOwner) {
      return;
    }

    const title = String(
      prodForm.title || ""
    ).trim();

    const description = String(
      prodForm.description || ""
    ).trim();

    const category = String(
      prodForm.category || ""
    ).trim();

    const images = Array.isArray(
      prodForm.images
    )
      ? prodForm.images
      : [];

    const color =
      String(prodForm.color || "").trim() ||
      null;

    const orderMode =
      normalizeProductOrderMode(
        prodForm.orderMode
      );

    const rawPrice = Number(
      prodForm.price
    );

    const price =
      orderMode === "QUOTE_ONLY"
        ? 0
        : rawPrice;

    const optionsSchema =
      normalizeSchemaArray(
        prodForm.optionsSchema
      );

    const customSchema =
      normalizeSchemaArray(
        prodForm.customSchema
      );

    const rawQuoteSchema =
      normalizeSchemaArray(
        prodForm.quoteSchema
      );

    const quoteSchema =
      orderMode === "QUOTE_ONLY"
        ? rawQuoteSchema.length
          ? rawQuoteSchema
          : defaultQuoteSchema()
        : [];

    const aiVisionAnalysis =
      normalizeObject(
        prodForm.aiVisionAnalysis
      );

    const aiOrderAnalysis =
      normalizeObject(
        prodForm.aiOrderAnalysis
      );

    const aiGeneratedFields =
      normalizeStringArray(
        prodForm.aiGeneratedFields
      );

    const aiSourceImages =
      normalizeStringArray(
        prodForm.aiSourceImages
      );

    const aiAnalysisVersion =
      prodForm.aiAnalysisVersion
        ? String(
            prodForm.aiAnalysisVersion
          )
            .trim()
            .slice(0, 80)
        : null;

    const rawAiConfidence =
      prodForm.aiConfidence;

    const parsedAiConfidence =
      rawAiConfidence === null ||
      rawAiConfidence === undefined ||
      rawAiConfidence === ""
        ? null
        : Number(rawAiConfidence);

    const aiConfidence =
      Number.isFinite(
        parsedAiConfidence
      )
        ? Math.max(
            0,
            Math.min(
              1,
              parsedAiConfidence
            )
          )
        : null;

    const aiAnalyzedAt =
      prodForm.aiAnalyzedAt || null;

    const aiManuallyEdited =
      prodForm.aiManuallyEdited === true;

    const materialMain =
      String(
        prodForm.materialMain || ""
      ).trim() || null;

    const technique =
      String(
        prodForm.technique || ""
      ).trim() || null;

    const styleTags = String(
      prodForm.styleTags || ""
    ).trim();

    const occasionTags = String(
      prodForm.occasionTags || ""
    ).trim();

    const dimensions =
      String(
        prodForm.dimensions || ""
      ).trim() || null;

    const careInstructions =
      String(
        prodForm.careInstructions || ""
      ).trim() || null;

    const specialNotes =
      String(
        prodForm.specialNotes || ""
      ).trim() || null;

    /* ================= Validări ================= */

    if (!title) {
      alert(
        "Te rog adaugă un titlu."
      );
      return;
    }

    if (!images.length) {
      alert(
        "Te rog adaugă cel puțin o imagine."
      );
      return;
    }

    if (
      orderMode !== "QUOTE_ONLY" &&
      (
        !Number.isFinite(rawPrice) ||
        rawPrice <= 0
      )
    ) {
      alert("Preț invalid.");
      return;
    }

    if (!category) {
      alert(
        "Selectează categoria produsului."
      );
      return;
    }

    if (
      orderMode === "OPTIONS" &&
      !optionsSchema.length &&
      !customSchema.length
    ) {
      alert(
        "Adaugă cel puțin o variantă sau un câmp de personalizare."
      );
      return;
    }

    const defaultAvailability =
      orderMode === "READY_TO_BUY"
        ? "READY"
        : "MADE_TO_ORDER";

    const availability = String(
      prodForm.availability ||
        defaultAvailability
    )
      .trim()
      .toUpperCase();

    const payload = {
      title,
      description,
      price,
      images,
      category,
      color,

      orderMode,

      optionsSchema:
        orderMode === "OPTIONS"
          ? optionsSchema
          : [],

      customSchema:
        orderMode === "OPTIONS"
          ? customSchema
          : [],

      quoteSchema,

      acceptsCustom:
        orderMode === "OPTIONS" ||
        orderMode === "QUOTE_ONLY" ||
        prodForm.acceptsCustom === true,

      aiVisionAnalysis,
      aiOrderAnalysis,
      aiGeneratedFields,
      aiSourceImages,
      aiAnalysisVersion,
      aiConfidence,
      aiAnalyzedAt,
      aiManuallyEdited,

      isHidden:
        prodForm.isHidden === true,

      isActive:
        prodForm.isActive !== false,

      materialMain,
      technique,
      styleTags,
      occasionTags,
      dimensions,
      careInstructions,
      specialNotes,

      availability,
      leadTimeDays: null,
      readyQty: null,
      nextShipDate: null,
    };

    /* ================= Disponibilitate ================= */

    if (
      availability === "MADE_TO_ORDER"
    ) {
      const leadTimeDays = Number(
        prodForm.leadTimeDays
      );

      if (
        !Number.isFinite(
          leadTimeDays
        ) ||
        leadTimeDays <= 0
      ) {
        alert(
          "Completează timpul estimat de realizare."
        );
        return;
      }

      payload.leadTimeDays =
        Math.floor(
          leadTimeDays
        );

      payload.readyQty = 0;
    }

    if (availability === "READY") {
      if (
        prodForm.readyQty !== "" &&
        prodForm.readyQty !== undefined &&
        prodForm.readyQty !== null
      ) {
        const readyQty = Number(
          prodForm.readyQty
        );

        payload.readyQty =
          Number.isFinite(readyQty) &&
          readyQty >= 0
            ? Math.floor(
                readyQty
              )
            : 0;
      } else {
        payload.readyQty = null;
      }

      payload.leadTimeDays = null;
      payload.nextShipDate = null;
    }

    if (
      availability === "PREORDER"
    ) {
      payload.readyQty = 0;
      payload.leadTimeDays = null;

      payload.nextShipDate =
        prodForm.nextShipDate
          ? dateOnlyToISO(
              prodForm.nextShipDate
            )
          : null;

      if (!payload.nextShipDate) {
        alert(
          "Selectează data estimată pentru precomandă."
        );
        return;
      }
    }

    if (
      availability === "SOLD_OUT"
    ) {
      payload.readyQty = 0;
      payload.leadTimeDays = null;
      payload.nextShipDate = null;
    }

    try {
      setSavingProd(true);

      if (
        editingProduct &&
        (
          editingProduct.id ||
          editingProduct._id
        )
      ) {
        const productId =
          editingProduct.id ||
          editingProduct._id;

        await api(
          `/api/vendors/products/${encodeURIComponent(
            productId
          )}`,
          {
            method: "PUT",
            body: payload,
          }
        );
      } else {
        await api(
          `/api/vendors/store/${encodeURIComponent(
            slug
          )}/products`,
          {
            method: "POST",
            body: payload,
          }
        );
      }

      setProdModalOpen(false);
      setEditingProduct(null);

      setProdForm({
        ...EMPTY_PROD_FORM,
      });

      await fetchEverything();
    } catch (error) {
      console.error(
        "Eroare la salvarea produsului:",
        error
      );

      alert(
        error?.message ||
          "Eroare la salvarea produsului."
      );

      throw error;
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

    productsCacheT:
      productsCacheTRef.current,

    editInfo,
    setEditInfo,
    savingInfo,
    infoSavedAt,
    infoErr,
    infoDraft,
    setInfoDraft,
    onChangeInfoDraft,
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