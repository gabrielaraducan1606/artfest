// src/ai/manifests/catalogProducts.manifest.js

export const CATALOG_PRODUCTS_MANIFEST = {
  id: "catalog-products",

  title:
    "Administrare produse catalog",

  audience: [
    "VENDOR",
    "ADMIN",
  ],

  available: true,

  status: "ACTIVE",

  tags: [
    "catalog",
    "produse",
    "bulk",
    "activare",
    "dezactivare",
    "pret",
    "categorie",
    "duplicare produs",
  ],

  aliases: [
    "cum administrez produsele",
    "schimb pretul la mai multe produse",
    "activez mai multe produse odata",
    "duplic un produs",
  ],

  uiLocations: [
    {
      audience: "VENDOR",
      path: "/vendor/catalog",
    },
  ],

  capabilities: {
    bulkActivateDeactivate: { available: true },
    bulkDelete: { available: true },
    bulkPrice: { available: true },
    bulkCategory: { available: true },
    duplicateProduct: { available: true },
    bulkVariants: { available: false, status: "PLANNED" },
  },

  limitations: [
    "Modificarea în masă a variantelor nu este disponibilă încă - variantele se editează per produs.",
  ],

  unavailableFeatures: [
    "Editare în masă a variantelor de produs",
  ],

  faq: [],

  notes:
    "Sursă: vendorCatalogProductsRoutes.js + acest manifest. Verificat 2026-08-24.",

  basePath:
    "/api/vendor/catalog/products",

  description:
    "Permite vânzătorului să vadă și să administreze produsele din toate magazinele sale.",

  features: {
    listProducts: true,

    searchProducts: true,

    filterByStatus: true,

    filterByOrderMode: true,

    bulkActivate: true,

    bulkDeactivate: true,

    bulkDelete: true,

    bulkPrice: true,

    bulkCategory: true,

    duplicateProduct: true,

    /*
     * Variantele sunt structurate.
     * Modificarea bulk a variantelor
     * o vom face separat.
     */
    bulkVariants: false,
  },

  endpoints: {
    list: {
      method: "GET",

      path: "/",

      purpose:
        "Returnează produsele vendorului din toate magazinele sale.",
    },

    bulkStatus: {
      method: "PATCH",

      path:
        "/bulk-status",

      purpose:
        "Activează sau dezactivează mai multe produse ale vendorului.",
    },

    bulkDelete: {
      method: "DELETE",

      path:
        "/bulk",

      purpose:
        "Șterge mai multe produse ale vendorului.",
    },

    bulkPrice: {
      method: "PATCH",

      path:
        "/bulk-price",

      purpose:
        "Setează același preț pentru mai multe produse.",
    },

    bulkCategory: {
      method: "PATCH",

      path:
        "/bulk-category",

      purpose:
        "Schimbă categoria mai multor produse.",
    },

    duplicate: {
      method: "POST",

      path:
        "/:productId/duplicate",

      purpose:
        "Creează o copie inactivă a unui produs al vendorului, păstrând datele, imaginile, variantele și personalizarea.",
    },
  },
};

export function getCatalogProductsRoute(
  key
) {
  const endpoint =
    CATALOG_PRODUCTS_MANIFEST
      .endpoints[key];

  if (!endpoint) {
    throw new Error(
      `Unknown catalog products route: ${key}`
    );
  }

  return endpoint.path;
}

export function getCatalogProductsFullRoute(
  key
) {
  const endpoint =
    CATALOG_PRODUCTS_MANIFEST
      .endpoints[key];

  if (!endpoint) {
    throw new Error(
      `Unknown catalog products route: ${key}`
    );
  }

  const base =
    String(
      CATALOG_PRODUCTS_MANIFEST
        .basePath || ""
    ).replace(
      /\/+$/,
      ""
    );

  const path =
    endpoint.path === "/"
      ? ""
      : endpoint.path;

  return `${base}${path}`;
}