import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import styles from "./CatalogProduse.module.css";
import CatalogImports from "./imports/CatalogImports.jsx";
/*
 * ProductModal (vechiul editor, cu propriul <Modal>) rămâne intact
 * ca fallback - nu mai e montat de mai jos (înlocuit de
 * VendorProductWizard mode="edit", care reutilizează STRICT
 * aceleași componente prin useProductEditorController) - fișierul
 * lui NU a fost șters, doar dezactivat aici.
 */
import VendorProductWizard from "../../../components/AIAssistant/VendorAIAssistant/components/VendorProductWizard.jsx";
import {
  fetchProductEditDraft,
  buildProductSavePayload,
} from "../../../components/AIAssistant/VendorAIAssistant/services/productEditMapping.js";
import CampaignsTab from "./VendorCampaigns/CampaignsTab.jsx";
import {
  useAnnounceCurrentEntity,
  useAnnouncePageType,
} from "../../../components/AIAssistant/CurrentEntityContext.jsx";
/* =========================================================
   LABELURI MOD COMANDĂ
========================================================= */

const ORDER_MODE_LABEL = {
  DIRECT:
    "Cumpărare directă",

  READY_TO_BUY:
    "Cumpărare directă",

  OPTIONS:
    "Opțiuni",

  CUSTOMIZABLE:
    "Personalizabil",

  QUOTE_ONLY:
    "Cerere ofertă",
};

/* =========================================================
   SURSE IMPORT
========================================================= */

const IMPORT_SOURCES = [
  {
    key: "excel",

    title:
      "Excel / CSV",

    description:
      "Încarcă un fișier cu produsele tale și verifică datele înainte de import.",

    icon: "📊",
  },

  {
    key: "easysales",

    title:
      "EasySales",

    description:
      "Importă produsele existente din EasySales și păstrează informațiile importante.",

    icon: "🔄",
  },

  {
    key: "shopify",

    title:
      "Shopify",

    description:
      "Conectează magazinul Shopify și adu produsele în catalogul Artfest.",

    icon: "🛍️",
  },

  {
    key: "woocommerce",

    title:
      "WooCommerce",

    description:
      "Importă produsele din magazinul tău WooCommerce.",

    icon: "🌐",
  },
];

/* =========================================================
   COMPONENTĂ
========================================================= */

export default function CatalogProdusePage() {
  const navigate =
    useNavigate();

  /* =======================================================
     TAB
  ======================================================= */
const [searchParams, setSearchParams] =
  useSearchParams();
  const tabFromUrl =
  searchParams.get("tab");

const [
  activeTab,
  setActiveTab,
] = useState(
  tabFromUrl === "campaigns" ||
  tabFromUrl === "imports"
    ? tabFromUrl
    : "products"
);

useEffect(() => {
  const tab =
    searchParams.get("tab");

  if (
    tab === "products" ||
    tab === "imports" ||
    tab === "campaigns"
  ) {
    setActiveTab(tab);
  }
}, [searchParams]);

function changeTab(tab) {
  setActiveTab(tab);

  setSearchParams(
    (current) => {
      const next =
        new URLSearchParams(current);

      next.set("tab", tab);

      return next;
    },
    {
      replace: true,
    }
  );
}
  /*
   * /vendor/catalog e O SINGURĂ rută cu tab-uri ținute în state
   * React (NU în URL) - vezi derivePageContext.js, care nu poate
   * distinge tab-urile din pathname. Anunțăm explicit pageType-ul
   * DOAR pentru tab-ul Importuri (singurul cu manifest propriu,
   * catalog-imports); pe "products"/"campaigns" lăsăm pageType-ul
   * derivat din URL (PRODUCT_CATALOG) să rămână.
   */
  useAnnouncePageType(
    activeTab === "imports" ? "CATALOG_IMPORT" : null
  );

  /* =======================================================
     FILTRE PRODUSE
  ======================================================= */

  const [
    query,
    setQuery,
  ] = useState("");

  const [
    selectedIds,
    setSelectedIds,
  ] = useState([]);

  const [
    statusFilter,
    setStatusFilter,
  ] = useState(
    "all"
  );

  const [
    orderModeFilter,
    setOrderModeFilter,
  ] = useState(
    "all"
  );

  /* =======================================================
     PRODUSE REALE
  ======================================================= */

  const [
    products,
    setProducts,
  ] = useState([]);
const [
  productStores,
  setProductStores,
] = useState([]);

const [
  defaultStoreSlug,
  setDefaultStoreSlug,
] = useState("");
  const [
    productsLoading,
    setProductsLoading,
  ] = useState(true);

  const [
    productsError,
    setProductsError,
  ] = useState("");


  /* =======================================================
     MODALE
  ======================================================= */


  const [
    showAiModal,
    setShowAiModal,
  ] = useState(false);

  const [
    openProductMenuId,
    setOpenProductMenuId,
  ] = useState(null);

  const [
    editProductOpen,
    setEditProductOpen,
  ] = useState(false);

  const [
    editingProduct,
    setEditingProduct,
  ] = useState(null);

  /*
   * /vendor/catalog nu are id de produs în URL (produsul se
   * editează într-un modal) - anunțăm entitatea DOAR cât timp
   * modalul de editare e deschis, ca un mesaj precum "schimbă
   * prețul la 45 lei" să rezolve produsul fără să-l mai numească.
   */
  useAnnounceCurrentEntity(
    editProductOpen && editingProduct
      ? {
          type: "PRODUCT",

          id:
            editingProduct.id ||
            editingProduct._id,

          name: editingProduct.title || "",
        }
      : null
  );

  const [
    savingProduct,
    setSavingProduct,
  ] = useState(false);

  /*
   * Guard sincron pentru double-submit la salvarea din
   * VendorProductWizard (mode="edit") - verificat ÎNAINTE de orice
   * await, ca să nu depindă de timing-ul re-render-ului React pe
   * `savingProduct` (care e suficient pentru UI, dar nu garantează
   * că un al doilea click chiar nu apucă să pornească un al doilea
   * fetch înainte ca butonul să devină disabled).
   */
  const savingEditRef = useRef(false);

  const [
    editSaveError,
    setEditSaveError,
  ] = useState("");

  const [
    editSaveSuccess,
    setEditSaveSuccess,
  ] = useState(null);

  const [
    productCategories,
    setProductCategories,
  ] = useState([]);

  const [
    prodForm,
    setProdForm,
  ] = useState({
    id: "",
    title: "",
    description: "",
    price: "",
    currency: "RON",
    images: [],
    videoUrl: null,
    videoMuted: false,
    category: "",
    color: "",
    isActive: true,
    isHidden: false,
    availability: "READY",
    leadTimeDays: "",
    readyQty: "",
    nextShipDate: "",
    acceptsCustom: false,
    orderMode: "READY_TO_BUY",
    optionsSchema: [],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
    materialMain: "",
    technique: "",
    styleTags: "",
    occasionTags: "",
    dimensions: "",
    careInstructions: "",
    specialNotes: "",
    aiVisionAnalysis: null,
    aiOrderAnalysis: null,
    aiGeneratedFields: [],
    aiSourceImages: [],
    aiAnalysisVersion: null,
    aiConfidence: null,
    aiAnalyzedAt: null,
    aiManuallyEdited: false,
  });

  const [
    aiPrompt,
    setAiPrompt,
  ] = useState("");


  /* =======================================================
     ÎNCĂRCARE PRODUSE
  ======================================================= */

  async function loadProducts() {
    setProductsLoading(
      true
    );

    setProductsError(
      ""
    );

    try {
      const response =
        await fetch(
          "/api/vendor/catalog/products",
          {
            method:
              "GET",

            credentials:
              "include",

            headers: {
              Accept:
                "application/json",
            },
          }
        );

      let data = null;

      try {
        data =
          await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(
          data?.message ||
            data?.error ||
            "Nu am putut încărca produsele."
        );
      }

      const items =
        Array.isArray(
          data?.items
        )
          ? data.items
          : [];

      setProducts(
        items
      );
const stores =
  Array.isArray(
    data?.stores
  )
    ? data.stores
    : [];

setProductStores(
  stores
);

setDefaultStoreSlug(
  data?.defaultStoreSlug ||
  (
    stores.length === 1
      ? stores[0]?.slug || ""
      : ""
  )
);
      /*
       * Dacă reîncărcăm produsele,
       * eliminăm selecțiile vechi.
       */
      setSelectedIds(
        []
      );
    } catch (error) {
      console.error(
        "[CatalogProduse] loadProducts:",
        error
      );

      setProducts([]);

      setProductsError(
        error?.message ||
          "Nu am putut încărca produsele."
      );
    } finally {
      setProductsLoading(
        false
      );
    }
  }

  /* =======================================================
     ÎNCĂRCARE INIȚIALĂ
  ======================================================= */

  useEffect(() => {
    loadProducts();
  }, []);

  /* =======================================================
     PRODUSE FILTRATE
  ======================================================= */

  const filteredProducts =
    useMemo(() => {
      return products.filter(
        (product) => {
          const q =
            query
              .trim()
              .toLowerCase();

          const matchesQuery =
            !q ||
            String(
              product.title ||
                ""
            )
              .toLowerCase()
              .includes(q) ||
            String(
              product.variants ||
                ""
            )
              .toLowerCase()
              .includes(q) ||
            String(
              product.category ||
                ""
            )
              .toLowerCase()
              .includes(q) ||
            String(
              product.store
                ?.title ||
                ""
            )
              .toLowerCase()
              .includes(q);

          const matchesStatus =
            statusFilter ===
              "all" ||
            (
              statusFilter ===
                "active" &&
              product.active
            ) ||
            (
              statusFilter ===
                "inactive" &&
              !product.active
            );

          const matchesOrderMode =
            orderModeFilter ===
              "all" ||
            product.orderMode ===
              orderModeFilter ||
            (
              orderModeFilter ===
                "DIRECT" &&
              product.orderMode ===
                "READY_TO_BUY"
            );

          return (
            matchesQuery &&
            matchesStatus &&
            matchesOrderMode
          );
        }
      );
    }, [
      products,
      query,
      statusFilter,
      orderModeFilter,
    ]);

  /* =======================================================
     SELECȚIE
  ======================================================= */

  const allVisibleSelected =
    filteredProducts.length >
      0 &&
    filteredProducts.every(
      (product) =>
        selectedIds.includes(
          product.id
        )
    );

  function toggleSelected(
    id
  ) {
    setSelectedIds(
      (prev) =>
        prev.includes(id)
          ? prev.filter(
              (item) =>
                item !== id
            )
          : [
              ...prev,
              id,
            ]
    );
  }

  function toggleSelectAllVisible() {
    if (
      allVisibleSelected
    ) {
      setSelectedIds(
        (prev) =>
          prev.filter(
            (id) =>
              !filteredProducts.some(
                (
                  product
                ) =>
                  product.id ===
                  id
              )
          )
      );

      return;
    }

    setSelectedIds(
      (prev) => [
        ...new Set([
          ...prev,

          ...filteredProducts.map(
            (
              product
            ) =>
              product.id
          ),
        ]),
      ]
    );
  }

  /* =======================================================
     BULK ACTIONS
     Momentan doar UI/local.
     Le conectăm la backend în pasul următor.
  ======================================================= */
async function catalogRequest(
  path,
  options = {}
) {
  const response =
    await fetch(
      `/api/vendor/catalog/products${path}`,
      {
        credentials:
          "include",

        headers: {
          "Content-Type":
            "application/json",

          ...(options.headers ||
            {}),
        },

        ...options,
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error =
      new Error(
        data?.message ||
          data?.error ||
          "Operațiunea nu a putut fi efectuată."
      );

    error.data =
      data;

    throw error;
  }

  return data;
}

async function updateSelectedProducts(
  active
) {
  if (
    !selectedIds.length
  ) {
    return;
  }

  try {
    await catalogRequest(
      "/bulk-status",
      {
        method: "PATCH",

        body:
          JSON.stringify({
            ids:
              selectedIds,

            active,
          }),
      }
    );

    await loadProducts();

    setSelectedIds(
      []
    );
  } catch (error) {
    console.error(
      "[CatalogProduse] bulk status:",
      error
    );

    alert(
      error?.message ||
        "Statusul produselor nu a putut fi modificat."
    );
  }
}

async function deleteSelectedProducts() {
  if (
    !selectedIds.length
  ) {
    return;
  }

  const confirmed =
    window.confirm(
      `Sigur vrei să ștergi definitiv ${selectedIds.length} produse?`
    );

  if (!confirmed) {
    return;
  }

  try {
    await catalogRequest(
      "/bulk",
      {
        method:
          "DELETE",

        body:
          JSON.stringify({
            ids:
              selectedIds,
          }),
      }
    );

    await loadProducts();

    setSelectedIds(
      []
    );
  } catch (error) {
    console.error(
      "[CatalogProduse] bulk delete:",
      error
    );

    alert(
      error?.message ||
        "Produsele nu au putut fi șterse."
    );
  }
}

async function changeSelectedPrice() {
  const value =
    window.prompt(
      "Care este noul preț pentru produsele selectate? Exemplu: 45.50"
    );

  if (
    value === null
  ) {
    return;
  }

  const normalized =
    String(value)
      .trim()
      .replace(
        ",",
        "."
      );

  const price =
    Number(
      normalized
    );

  if (
    !Number.isFinite(
      price
    ) ||
    price < 0
  ) {
    alert(
      "Introdu un preț valid."
    );

    return;
  }

  try {
    await catalogRequest(
      "/bulk-price",
      {
        method:
          "PATCH",

        body:
          JSON.stringify({
            ids:
              selectedIds,

            price,
          }),
      }
    );

    await loadProducts();

    setSelectedIds(
      []
    );
  } catch (error) {
    console.error(
      "[CatalogProduse] bulk price:",
      error
    );

    alert(
      error?.message ||
        "Prețul nu a putut fi modificat."
    );
  }
}

async function changeSelectedCategory() {
  const value =
    window.prompt(
      "Scrie noua categorie pentru produsele selectate:"
    );

  if (
    value === null
  ) {
    return;
  }

  const category =
    value.trim();

  if (!category) {
    alert(
      "Categoria nu poate fi goală."
    );

    return;
  }

  try {
    await catalogRequest(
      "/bulk-category",
      {
        method:
          "PATCH",

        body:
          JSON.stringify({
            ids:
              selectedIds,

            category,
          }),
      }
    );

    await loadProducts();

    setSelectedIds(
      []
    );

    alert(
      "Categoria a fost modificată. Produsele pot intra din nou în verificare."
    );
  } catch (error) {
    console.error(
      "[CatalogProduse] bulk category:",
      error
    );

    alert(
      error?.message ||
        "Categoria nu a putut fi modificată."
    );
  }
}

async function handleBulkAction(
  action
) {
  if (
    !selectedIds.length
  ) {
    alert(
      "Selectează cel puțin un produs."
    );

    return;
  }

  if (
    action ===
    "activate"
  ) {
    await updateSelectedProducts(
      true
    );

    return;
  }

  if (
    action ===
    "deactivate"
  ) {
    await updateSelectedProducts(
      false
    );

    return;
  }

  if (
    action ===
    "delete"
  ) {
    await deleteSelectedProducts();

    return;
  }

  if (
    action ===
    "price"
  ) {
    await changeSelectedPrice();

    return;
  }

  if (
    action ===
    "category"
  ) {
    await changeSelectedCategory();

    return;
  }

  if (
    action ===
    "variants"
  ) {
    alert(
      "Variantele au o structură mai complexă. Le vom modifica prin editorul de produs sau prin AI, ca să nu stricăm opțiunile existente."
    );

    return;
  }
}

/* =======================================================
   ACȚIUNI INDIVIDUALE PRODUS
======================================================= */

function viewProduct(product) {
  if (!product?.id) {
    return;
  }

  setOpenProductMenuId(null);

  navigate(
    `/produs/${encodeURIComponent(product.id)}`
  );
}

async function toggleProductStatus(
  product
) {
  if (!product?.id) {
    return;
  }

  try {
    await catalogRequest(
      "/bulk-status",
      {
        method: "PATCH",

        body: JSON.stringify({
          ids: [
            product.id,
          ],

          active:
            !product.active,
        }),
      }
    );

    setOpenProductMenuId(
      null
    );

    await loadProducts();
  } catch (error) {
    console.error(
      "[CatalogProduse] product status:",
      error
    );

    alert(
      error?.message ||
        "Statusul produsului nu a putut fi modificat."
    );
  }
}

async function deleteProduct(
  product
) {
  if (!product?.id) {
    return;
  }

  const confirmed =
    window.confirm(
      `Sigur vrei să ștergi produsul „${product.title || "Produs"}”?`
    );

  if (!confirmed) {
    return;
  }

  try {
    await catalogRequest(
      "/bulk",
      {
        method: "DELETE",

        body: JSON.stringify({
          ids: [
            product.id,
          ],
        }),
      }
    );

    setOpenProductMenuId(
      null
    );

    await loadProducts();
  } catch (error) {
    console.error(
      "[CatalogProduse] delete product:",
      error
    );

    alert(
      error?.message ||
        "Produsul nu a putut fi șters."
    );
  }
}

async function duplicateProduct(
  product
) {
  if (!product?.id) {
    return;
  }

  const confirmed =
    window.confirm(
      `Vrei să duplici produsul „${product.title || "Produs"}”?`
    );

  if (!confirmed) {
    return;
  }

  try {
    const result =
      await catalogRequest(
        `/${encodeURIComponent(
          product.id
        )}/duplicate`,
        {
          method:
            "POST",
        }
      );

    setOpenProductMenuId(
      null
    );

    await loadProducts();

    alert(
      result?.message ||
        "Produsul a fost duplicat."
    );
  } catch (error) {
    console.error(
      "[CatalogProduse] duplicate product:",
      error
    );

    alert(
      error?.message ||
        "Produsul nu a putut fi duplicat."
    );
  }
}

  /* =======================================================
     AI CATALOG
  ======================================================= */

  function handleAiPreview() {
    if (
      !aiPrompt.trim()
    ) {
      alert(
        "Scrie mai întâi ce vrei să modifici."
      );

      return;
    }

    alert(
      `AI va analiza cererea:\n\n"${aiPrompt}"\n\nÎn backend vom genera mai întâi un preview, fără să modificăm direct produsele.`
    );
  }


  /* =======================================================
     EDITARE PRODUS CU PRODUCT MODAL
  ======================================================= */

  async function loadProductCategories() {
    if (productCategories.length) {
      return productCategories;
    }

    const endpoints = [
      "/api/public/categories/detailed",
      "/api/public/categories",
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        const items = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
            ? data.items
            : Array.isArray(data?.categories)
              ? data.categories
              : [];

        if (items.length) {
          setProductCategories(items);
          return items;
        }
      } catch (error) {
        console.warn(
          `[CatalogProduse] categories ${endpoint}:`,
          error
        );
      }
    }

    return [];
  }
async function openNewProduct() {
  try {
    await loadProductCategories();

    /*
     * null = ProductModal știe că este produs nou,
     * nu editare.
     */
    setEditingProduct(null);

    setProdForm({
      id: "",
      title: "",
      description: "",
      price: "",
      currency: "RON",

      images: [],
      videoUrl: null,
      videoMuted: false,

      category: "",
      color: "",

      isActive: true,
      isHidden: false,

      availability: "",
      leadTimeDays: "",
      readyQty: "",
      nextShipDate: "",

      acceptsCustom: null,

      orderMode: "READY_TO_BUY",

      optionsSchema: [],
      customSchema: [],
      repeatedGroups: [],
      quoteSchema: [],

      materialMain: "",
      technique: "",
      styleTags: "",
      occasionTags: "",
      dimensions: "",
      careInstructions: "",
      specialNotes: "",

      aiVisionAnalysis: null,
      aiOrderAnalysis: null,
      aiGeneratedFields: [],
      aiSourceImages: [],
      aiAnalysisVersion: null,
      aiConfidence: null,
      aiAnalyzedAt: null,
      aiManuallyEdited: false,
    });

    setEditProductOpen(true);
  } catch (error) {
    console.error(
      "[CatalogProduse] openNewProduct:",
      error
    );

    alert(
      error?.message ||
        "Nu am putut deschide formularul pentru produs."
    );
  }
}

  async function openEditProduct(product) {
    const id = product?.id || product?._id;

    if (!id) {
      return;
    }

    try {
      const [{ full, draft }] = await Promise.all([
        fetchProductEditDraft(id),
        loadProductCategories(),
      ]);

      setProdForm(draft);

      setEditingProduct(full);
      setEditProductOpen(true);

      /*
       * Sesiune nouă de editare - fără eroare/succes rămase dintr-o
       * încercare anterioară pe alt produs.
       */
      setEditSaveError("");
      setEditSaveSuccess(null);
    } catch (error) {
      console.error(
        "[CatalogProduse] openEditProduct:",
        error
      );

      alert(
        error?.message ||
          "Nu am putut încărca produsul pentru editare."
      );
    }
  }

  function closeEditProduct() {
    if (savingProduct) {
      return;
    }

    setEditProductOpen(false);
    setEditingProduct(null);
  }

  /*
   * Neapelată de mai jos de când editarea a fost mutată pe
   * VendorProductWizard (mode="edit") / handleSaveProductFromWizard -
   * păstrată intenționat, NEȘTEARSĂ, ca revenirea la <ProductModal>
   * să fie un revert de o linie (schimbă onSave înapoi pe aceasta),
   * fără să reconstruim payload-ul de la zero.
   */
  // eslint-disable-next-line no-unused-vars
 async function handleSaveProduct(event) {
  event?.preventDefault?.();

  const id =
    editingProduct?.id ||
    editingProduct?._id ||
    prodForm.id;

  const isEditing = !!id;

  if (savingProduct) {
    return;
  }

  const title = String(
    prodForm.title || ""
  ).trim();

  const description =
    prodForm.description || "";

  const numericPrice = Number(
    String(
      prodForm.price ?? ""
    ).replace(",", ".")
  );

  if (!title) {
    alert(
      "Titlul produsului este obligatoriu."
    );
    return;
  }

  /*
   * QUOTE_ONLY poate avea preț 0.
   */
  if (
    prodForm.orderMode !== "QUOTE_ONLY" &&
    (
      !Number.isFinite(
        numericPrice
      ) ||
      numericPrice < 0
    )
  ) {
    alert(
      "Introdu un preț valid."
    );
    return;
  }

  const payload = buildProductSavePayload(
    prodForm,
    { title, description, numericPrice }
  );

  try {
    setSavingProduct(true);

    let url = "";
    let method = "";

    /*
     * EDITARE
     */
    if (isEditing) {
      url =
        `/api/vendors/products/${encodeURIComponent(
          id
        )}`;

      method =
        "PUT";
    } else {
      /*
       * PRODUS NOU
       */
      let storeSlug =
        defaultStoreSlug;

      /*
       * Fallback:
       * dacă avem deja produse,
       * putem lua slug-ul din ele.
       */
      if (!storeSlug) {
        storeSlug =
          products.find(
            (product) =>
              product?.store
                ?.slug
          )?.store?.slug ||
          "";
      }

      /*
       * Dacă există un singur store
       * în lista returnată de backend,
       * îl folosim.
       */
      if (
        !storeSlug &&
        productStores.length ===
          1
      ) {
        storeSlug =
          productStores[0]
            ?.slug ||
          "";
      }

      /*
       * Dacă sunt mai multe magazine,
       * momentan nu alegem unul automat.
       */
      if (
        !storeSlug &&
        productStores.length >
          1
      ) {
        throw new Error(
          "Ai mai multe magazine. Momentan trebuie să alegem magazinul în care va fi adăugat produsul."
        );
      }

      if (!storeSlug) {
        throw new Error(
          "Nu am găsit magazinul în care să adăugăm produsul."
        );
      }

      url =
        `/api/vendors/store/${encodeURIComponent(
          storeSlug
        )}/products`;

      method =
        "POST";
    }

    const response =
      await fetch(
        url,
        {
          method,

          credentials:
            "include",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json",
          },

          body:
            JSON.stringify(
              payload
            ),
        }
      );

    let saved = null;

    try {
      saved =
        await response.json();
    } catch {
      saved = null;
    }

    if (!response.ok) {
      throw new Error(
        saved?.message ||
          saved?.error ||
          "Nu am putut salva produsul."
      );
    }

    /*
     * Notificăm restul aplicației.
     */
    try {
      window.dispatchEvent(
        new CustomEvent(
          "vendor:productUpdated",
          {
            detail: {
              product:
                saved,
            },
          }
        )
      );
    } catch {
      // noop
    }

    setEditProductOpen(
      false
    );

    setEditingProduct(
      null
    );

    await loadProducts();

    return saved;
  } catch (error) {
    console.error(
      "[CatalogProduse] save product:",
      error
    );

    alert(
      error?.message ||
        "Nu am putut salva produsul."
    );

    /*
     * ProductModal trebuie să știe
     * că salvarea NU a reușit.
     */
    throw error;
  } finally {
    setSavingProduct(
      false
    );
  }
}

/*
 * Salvare din VendorProductWizard (mode="edit") - editare STRICT
 * (fără crearea unui produs nou aici). Diferă de handleSaveProduct
 * (calea veche, ProductModal) prin:
 * - guard sincron de double-submit (savingEditRef, verificat înainte
 *   de orice await);
 * - draftul (prodForm) nu e atins la eșec, ca vendorul să poată
 *   apăsa direct "Reîncearcă" din wizard fără să reintroducă nimic;
 * - actualizare LOCALĂ a listei de produse, fără loadProducts() (nu
 *   mai facem reload complet al catalogului);
 * - erori/succes expuse prin stare (editSaveError/editSaveSuccess),
 *   citite direct de VendorProductWizard.
 */
async function handleSaveProductFromWizard(event) {
  event?.preventDefault?.();

  if (savingEditRef.current) {
    return false;
  }

  const id =
    editingProduct?.id ||
    editingProduct?._id ||
    prodForm.id;

  if (!id) {
    setEditSaveError(
      "Produsul nu a fost identificat."
    );

    return false;
  }

  const title = String(
    prodForm.title || ""
  ).trim();

  const description =
    prodForm.description || "";

  const numericPrice = Number(
    String(
      prodForm.price ?? ""
    ).replace(",", ".")
  );

  if (!title) {
    setEditSaveError(
      "Titlul produsului este obligatoriu."
    );

    return false;
  }

  if (
    prodForm.orderMode !== "QUOTE_ONLY" &&
    (
      !Number.isFinite(
        numericPrice
      ) ||
      numericPrice < 0
    )
  ) {
    setEditSaveError(
      "Introdu un preț valid."
    );

    return false;
  }

  savingEditRef.current = true;
  setSavingProduct(true);
  setEditSaveError("");

  try {
    const payload = buildProductSavePayload(
      prodForm,
      { title, description, numericPrice }
    );

    const response = await fetch(
      `/api/vendors/products/${encodeURIComponent(id)}`,
      {
        method: "PUT",

        credentials: "include",

        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },

        body: JSON.stringify(payload),
      }
    );

    let saved = null;

    try {
      saved = await response.json();
    } catch {
      saved = null;
    }

    if (!response.ok) {
      throw new Error(
        saved?.message ||
          saved?.error ||
          "Nu am putut salva produsul."
      );
    }

    setProducts((current) =>
      current.map((product) =>
        (product.id || product._id) === id
          ? { ...product, ...saved }
          : product
      )
    );

    try {
      window.dispatchEvent(
        new CustomEvent(
          "vendor:productUpdated",
          {
            detail: {
              product: saved,
            },
          }
        )
      );
    } catch {
      // noop
    }

    /*
     * Păstrăm editingProduct la zi (nu-l ștergem, nu închidem
     * editorul) - vendorul poate continua să editeze imediat după
     * salvare, iar noul snapshot devine baseline pentru dirty state.
     */
    setEditingProduct(saved);

    setEditSaveSuccess({
      productId: id,
      title: saved?.title || title,
    });

    return true;
  } catch (error) {
    console.error(
      "[CatalogProduse] save product (wizard):",
      error
    );

    setEditSaveError(
      error?.message ||
        "Nu am putut salva produsul."
    );

    return false;
  } finally {
    setSavingProduct(false);
    savingEditRef.current = false;
  }
}


  /* =======================================================
     TAB PRODUSE
  ======================================================= */

  function renderProductsTab() {
    if (
      productsLoading
    ) {
      return (
        <section
          className={
            styles.tableCard
          }
        >
          <div
            className={
              styles.emptyState
            }
          >
            <div>
              <strong>
                Se încarcă produsele...
              </strong>

              <p>
                Pregătim catalogul magazinului tău.
              </p>
            </div>
          </div>
        </section>
      );
    }

    if (
      productsError
    ) {
      return (
        <section
          className={
            styles.tableCard
          }
        >
          <div
            className={
              styles.emptyState
            }
          >
            <div>
              <strong>
                Nu am putut încărca produsele.
              </strong>

              <p>
                {
                  productsError
                }
              </p>

              <button
                type="button"
                className={
                  styles.secondaryBtn
                }
                onClick={
                  loadProducts
                }
              >
                Încearcă din nou
              </button>
            </div>
          </div>
        </section>
      );
    }

    return (
      <>
        <section
          className={
            styles.toolbar
          }
        >
          <div
            className={
              styles.searchWrap
            }
          >
            <input
              className={
                styles.searchInput
              }
              value={
                query
              }
              onChange={(
                event
              ) =>
                setQuery(
                  event.target
                    .value
                )
              }
              placeholder="Caută produs, aromă, culoare, categorie..."
            />
          </div>

          <select
            className={
              styles.select
            }
            value={
              statusFilter
            }
            onChange={(
              event
            ) =>
              setStatusFilter(
                event.target
                  .value
              )
            }
          >
            <option
              value="all"
            >
              Toate statusurile
            </option>

            <option
              value="active"
            >
              Active
            </option>

            <option
              value="inactive"
            >
              Inactive
            </option>
          </select>

          <select
            className={
              styles.select
            }
            value={
              orderModeFilter
            }
            onChange={(
              event
            ) =>
              setOrderModeFilter(
                event.target
                  .value
              )
            }
          >
            <option
              value="all"
            >
              Toate modurile
            </option>

            <option
              value="DIRECT"
            >
              Cumpărare directă
            </option>

            <option
              value="OPTIONS"
            >
              Opțiuni
            </option>

            <option
              value="CUSTOMIZABLE"
            >
              Personalizabile
            </option>

            <option
              value="QUOTE_ONLY"
            >
              Cerere ofertă
            </option>
          </select>

          <button
  type="button"
  className={styles.aiBtn}
  disabled
  title="Disponibil în curând"
>
  ✨ Modifică prin AI
</button>
        </section>

        {selectedIds.length >
          0 && (
          <section
            className={
              styles.bulkBar
            }
          >
            <div
              className={
                styles.bulkCount
              }
            >
              <strong>
                {
                  selectedIds.length
                }
              </strong>{" "}
              produse selectate
            </div>

            <div
              className={
                styles.bulkActions
              }
            >
              <button
                type="button"
                onClick={() =>
                  handleBulkAction(
                    "activate"
                  )
                }
              >
                Activează
              </button>

              <button
                type="button"
                onClick={() =>
                  handleBulkAction(
                    "deactivate"
                  )
                }
              >
                Dezactivează
              </button>

              <button
                type="button"
                onClick={() =>
                  handleBulkAction(
                    "price"
                  )
                }
              >
                Modifică preț
              </button>

              <button
                type="button"
                onClick={() =>
                  handleBulkAction(
                    "category"
                  )
                }
              >
                Schimbă categoria
              </button>

              <button
                type="button"
                onClick={() =>
                  handleBulkAction(
                    "variants"
                  )
                }
              >
                Modifică variante
              </button>

              <button
                type="button"
                className={
                  styles.dangerBtn
                }
                onClick={() =>
                  handleBulkAction(
                    "delete"
                  )
                }
              >
                Șterge
              </button>

              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    []
                  )
                }
              >
                Anulează
              </button>
            </div>
          </section>
        )}

        <section
          className={
            styles.tableCard
          }
        >
          <div
            className={
              styles.tableHeaderInfo
            }
          >
            <div>
              <strong>
                {
                  filteredProducts.length
                }
              </strong>{" "}
              produse
            </div>

            <span>
              {
                products.filter(
                  (product) =>
                    product.active
                ).length
              }{" "}
              active
            </span>
          </div>

          <div
            className={
              styles.tableScroll
            }
          >
            <table
              className={
                styles.table
              }
            >
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        allVisibleSelected
                      }
                      onChange={
                        toggleSelectAllVisible
                      }
                    />
                  </th>

                  <th>
                    Produs
                  </th>

                  <th>
                    Preț
                  </th>

                  <th>
                    Stoc
                  </th>

                  <th>
                    Mod comandă
                  </th>

                  <th>
                    Variante / câmpuri
                  </th>

                  <th>
                    Status
                  </th>

                  <th>
                    Acțiuni
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map(
                  (
                    product
                  ) => (
                    <tr
                      key={
                        product.id
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={
                            selectedIds.includes(
                              product.id
                            )
                          }
                          onChange={() =>
                            toggleSelected(
                              product.id
                            )
                          }
                        />
                      </td>

                      <td>
                        <div
                          className={
                            styles.productCell
                          }
                        >
                          <div
                            className={
                              styles.productImage
                            }
                          >
                            {product.image ? (
                              <img
                                src={
                                  product.image
                                }
                                alt={
                                  product.title
                                }
                              />
                            ) : (
                              <span>
                                📦
                              </span>
                            )}
                          </div>

                          <div
                            className={
                              styles.productInfo
                            }
                          >
                            <strong>
                              {
                                product.title
                              }
                            </strong>

                            <span>
                              {
                                product.category ||
                                "Fără categorie"
                              }
                            </span>

                            {product
                              .store
                              ?.title && (
                              <span>
                                Magazin:{" "}
                                {
                                  product
                                    .store
                                    .title
                                }
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td>
                        {product.orderMode ===
                          "QUOTE_ONLY" &&
                        (!product.price ||
                          product.price <=
                            0) ? (
                          <span
                            className={
                              styles.warningBadge
                            }
                            title="Pentru ca acest produs cu cerere de ofertă să poată fi trimis corect către Google, adaugă un preț orientativ."
                          >
                            Fără preț orientativ
                          </span>
                        ) : product.price !==
                            null &&
                          product.price !==
                            undefined
                          ? `${product.price} lei`
                          : "La ofertă"}
                      </td>

                      <td>
                        {
                          product.stock ??
                          "—"
                        }
                      </td>

                      <td>
                        <span
                          className={
                            styles.modeBadge
                          }
                        >
                          {ORDER_MODE_LABEL[
                            product
                              .orderMode
                          ] ||
                            product.orderMode ||
                            "—"}
                        </span>
                      </td>

                      <td>
                        <div
                          className={
                            styles.variantsText
                          }
                        >
                          {
                            product.variants ||
                            "—"
                          }
                        </div>
                      </td>

                      <td>
                        <span
                          className={
                            product.active
                              ? styles.activeBadge
                              : styles.inactiveBadge
                          }
                        >
                          {product.active
                            ? "Activ"
                            : "Inactiv"}
                        </span>
                      </td>

                      <td>
                        <div
                          className={
                            styles.rowActions
                          }
                        >
                          <button
                            type="button"
                            className={
                              styles.linkBtn
                            }
                            onClick={() => {
                              setOpenProductMenuId(
                                null
                              );

                              openEditProduct(
                                product
                              );
                            }}
                          >
                            Editează
                          </button>

                          <div
                            className={
                              styles.productMenuWrap
                            }
                          >
                            <button
                              type="button"
                              className={
                                styles.moreBtn
                              }
                              onClick={() =>
                                setOpenProductMenuId(
                                  (current) =>
                                    current ===
                                    product.id
                                      ? null
                                      : product.id
                                )
                              }
                              aria-label="Mai multe acțiuni"
                              aria-expanded={
                                openProductMenuId ===
                                product.id
                              }
                            >
                              ⋯
                            </button>

                            {openProductMenuId ===
                              product.id && (
                              <div
                                className={
                                  styles.productMenu
                                }
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    viewProduct(
                                      product
                                    )
                                  }
                                >
                                  👁 Vezi produsul
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    duplicateProduct(
                                      product
                                    )
                                  }
                                >
                                  ⧉ Duplică produsul
                                </button>

                                <div
                                  className={
                                    styles.productMenuDivider
                                  }
                                />

                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleProductStatus(
                                      product
                                    )
                                  }
                                >
                                  {product.active
                                    ? "⏸ Dezactivează"
                                    : "▶ Activează"}
                                </button>

                                <div
                                  className={
                                    styles.productMenuDivider
                                  }
                                />

                                <button
                                  type="button"
                                  className={
                                    styles.productMenuDanger
                                  }
                                  onClick={() =>
                                    deleteProduct(
                                      product
                                    )
                                  }
                                >
                                  🗑 Șterge produsul
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                )}

                {!filteredProducts.length && (
                  <tr>
                    <td
                      colSpan={
                        8
                      }
                      className={
                        styles.emptyState
                      }
                    >
                      <div>
                        <strong>
                          Nu am găsit produse.
                        </strong>

                        <p>
                          {products.length
                            ? "Încearcă alte filtre."
                            : "Nu ai încă produse în catalog. Poți adăuga unul nou sau poți importa produse din Excel."}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }


  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <div
      className={
        styles.page
      }
    >
      <header
        className={
          styles.header
        }
      >
        <div>
          <button
            type="button"
            className={
              styles.backBtn
            }
            onClick={() =>
              navigate(-1)
            }
          >
            ← Înapoi
          </button>

          <h1
            className={
              styles.title
            }
          >
            Catalog produse
          </h1>

          <p
            className={
              styles.subtitle
            }
          >
            Administrează produsele,
            importurile și campaniile
            magazinului tău dintr-un singur
            loc.
          </p>
        </div>

       <div className={styles.headerActions}>
  {activeTab === "products" && (
    <button
      type="button"
      className={styles.primaryBtn}
      onClick={openNewProduct}
    >
      + Adaugă produs
    </button>
  )}
</div>
      </header>

      <nav
        className={
          styles.tabs
        }
      >
        <button
          type="button"
          className={
            activeTab ===
            "products"
              ? styles.activeTab
              : styles.tab
          }
          onClick={() =>
  changeTab("imports")
}
        >
          Produse
        </button>

        <button
          type="button"
          className={
            activeTab ===
            "imports"
              ? styles.activeTab
              : styles.tab
          }
          onClick={() =>
            setActiveTab(
              "imports"
            )
          }
        >
          Importuri
        </button>

        <button
  type="button"
  className={
    activeTab === "campaigns"
      ? styles.activeTab
      : styles.tab
  }
  onClick={() =>
  changeTab("campaigns")
}
>
  Campanii
</button>
      </nav>

      {activeTab ===
        "products" &&
        renderProductsTab()}

      {activeTab ===
        "imports" && (
        <CatalogImports />
      )}

      {activeTab === "campaigns" && (
  <CampaignsTab products={products} />
)}


      {/* ===================================================
          MODAL AI
      =================================================== */}

      {showAiModal && (
        <div
          className={
            styles.modalOverlay
          }
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowAiModal(
                false
              );
            }
          }}
        >
          <div
            className={
              styles.modalSmall
            }
          >
            <div
              className={
                styles.modalHeader
              }
            >
              <div>
                <h2>
                  ✨ Modifică prin AI
                </h2>

                <p>
                  Spune ce vrei să schimbi
                  în catalog. Modificările
                  vor avea preview înainte
                  de aplicare.
                </p>
              </div>

              <button
                type="button"
                className={
                  styles.closeBtn
                }
                onClick={() =>
                  setShowAiModal(
                    false
                  )
                }
              >
                ×
              </button>
            </div>

            <textarea
              className={
                styles.aiTextarea
              }
              value={
                aiPrompt
              }
              onChange={(
                event
              ) =>
                setAiPrompt(
                  event.target
                    .value
                )
              }
              placeholder='Ex: „Înlocuiește aroma Vanilie cu Bumbac în toate odorizantele.”'
              rows={
                6
              }
            />

            <div
              className={
                styles.aiExamples
              }
            >
              <span>
                Exemple:
              </span>

              <button
                type="button"
                onClick={() =>
                  setAiPrompt(
                    "Mărește prețul tuturor cănilor cu 5 lei."
                  )
                }
              >
                Mărește prețurile
              </button>

              <button
                type="button"
                onClick={() =>
                  setAiPrompt(
                    "Înlocuiește aroma Vanilie cu Bumbac în toate odorizantele."
                  )
                }
              >
                Înlocuiește variantă
              </button>

              <button
                type="button"
                onClick={() =>
                  setAiPrompt(
                    "Dezactivează toate produsele fără stoc."
                  )
                }
              >
                Dezactivează fără stoc
              </button>
            </div>

            <div
              className={
                styles.modalActions
              }
            >
              <button
                type="button"
                className={
                  styles.secondaryBtn
                }
                onClick={() =>
                  setShowAiModal(
                    false
                  )
                }
              >
                Anulează
              </button>

              <button
                type="button"
                className={
                  styles.primaryBtn
                }
                onClick={
                  handleAiPreview
                }
              >
                Previzualizează
              </button>
            </div>
          </div>
        </div>
      )}
     {editProductOpen && (
  <VendorProductWizard
    mode="edit"
    editingProduct={
      editingProduct
    }
    draft={
      prodForm
    }
    setDraft={
      setProdForm
    }
    categories={
      productCategories
    }
    onSave={
      handleSaveProductFromWizard
    }
    saving={
      savingProduct
    }
    saveError={
      editSaveError
    }
    saveSuccess={
      editSaveSuccess
    }
    onClose={
      closeEditProduct
    }
    storeSlug={
      editingProduct
        ?.service
        ?.profile
        ?.slug ||
      editingProduct
        ?.store
        ?.slug ||
      defaultStoreSlug ||
      productStores[0]?.slug ||
      ""
    }
  />
)}
    </div>
  );
}