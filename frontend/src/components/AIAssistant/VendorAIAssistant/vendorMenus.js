// src/components/AIAssistant/Vendor/vendorMenus.js

import {
  ShoppingBagIcon,
} from "../Products/ProductsIcons.jsx";

import {
  PersonalizationIcon,
} from "../Personalization/PersonalizationIcons.jsx";

import {
  OrdersIcon,
} from "../Orders/OrderIcons.jsx";

import {
  SupportIcon,
} from "../Support/SupportIcons.jsx";

import {
  VendorProductsIcon,
  VendorStoreIcon,
  VendorPriceIcon,
  VendorEditIcon,
  VendorAddIcon,
} from "./VendorIcons.jsx";

/* =========================================================
   ID-urile meniurilor
========================================================= */

export const VENDOR_MENU_IDS = {
  ROOT: "vendor-root",
  PRODUCTS: "vendor-products",
  STORE: "vendor-store",
};

/* =========================================================
   ID-urile acțiunilor
========================================================= */

export const VENDOR_ACTION_IDS = {
  PRODUCTS_MENU:
    "vendor-products-menu",

  ADD_PRODUCT:
    "vendor-product-add",

  ADD_PRODUCTS_BATCH:
    "vendor-products-batch-add",

  EDIT_PRODUCT:
    "vendor-product-edit",

  PRICE_STOCK:
    "vendor-product-price-stock",

  PRODUCT_HELP:
    "vendor-product-help",

  RECEIVED_QUOTES:
    "vendor-received-quotes",

  SHOPPING:
    "vendor-shopping",

  ORDERS:
    "vendor-orders",

  STORE:
    "vendor-store-menu",

  SUPPORT:
    "vendor-support",
};

/* =========================================================
   Meniul principal al vânzătorului
========================================================= */

export const VENDOR_ROOT_ACTIONS = [
  {
    id:
      VENDOR_ACTION_IDS.PRODUCTS_MENU,

    title:
      "Produsele mele",

    description:
      "Adaugă, editează și actualizează produsele magazinului.",

    icon:
      VendorProductsIcon,
  },

  {
    id:
      VENDOR_ACTION_IDS.RECEIVED_QUOTES,

    title:
      "Cereri primite",

    description:
      "Vezi cererile de ofertă primite de la clienți.",

    icon:
      PersonalizationIcon,
  },

  {
    id:
      VENDOR_ACTION_IDS.ORDERS,

    title:
      "Comenzile magazinului",

    description:
      "Vezi comenzile și actualizează starea acestora.",

    icon:
      OrdersIcon,
  },

  {
    id:
      VENDOR_ACTION_IDS.STORE,

    title:
      "Magazinul meu",

    description:
      "Administrează profilul și setările magazinului.",

    icon:
      VendorStoreIcon,
  },

  {
    id:
      VENDOR_ACTION_IDS.SHOPPING,

    title:
      "Cumpărături",

    description:
      "Caută produse și idei în marketplace.",

    icon:
      ShoppingBagIcon,
  },

  {
    id:
      VENDOR_ACTION_IDS.SUPPORT,

    title:
      "Ajutor",

    description:
      "Primește ajutor sau discută cu echipa Artfest.",

    icon:
      SupportIcon,
  },
];

/* =========================================================
   Submeniul Produse
========================================================= */

export const VENDOR_PRODUCT_ACTIONS = [
  {
    id:
      VENDOR_ACTION_IDS.ADD_PRODUCT,

    title:
      "Adaugă produs cu AI",

    description:
      "Încarcă pozele, iar asistentul pregătește produsul.",

    icon:
      VendorAddIcon,
  },
{
  id:
    VENDOR_ACTION_IDS.ADD_PRODUCTS_BATCH,

  title:
    "Adaugă mai multe produse cu AI",

  description:
    "Încarcă toate fotografiile, iar AI-ul le grupează în produse diferite.",

  icon:
    VendorAddIcon,
},
  {
    id:
      VENDOR_ACTION_IDS.EDIT_PRODUCT,

    title:
      "Editează un produs",

    description:
      "Alege produsul și spune ce dorești să modifici.",

    icon:
      VendorEditIcon,
  },

  {
    id:
      VENDOR_ACTION_IDS.PRICE_STOCK,

    title:
      "Preț și stoc",

    description:
      "Actualizează rapid prețul sau disponibilitatea.",

    icon:
      VendorPriceIcon,
  },

  {
    id:
      VENDOR_ACTION_IDS.PRODUCT_HELP,

    title:
      "Vreau ajutor de la Artfest",

    description:
      "Trimite pozele și informațiile, iar noi te ajutăm.",

    icon:
      SupportIcon,
  },
];

/* =========================================================
   Toate meniurile asistentului vendor
========================================================= */

export const VENDOR_MENUS = {
  [VENDOR_MENU_IDS.ROOT]: {
    title:
      "Administrare magazin",

    actions:
      VENDOR_ROOT_ACTIONS,

    parent:
      null,
  },

  [VENDOR_MENU_IDS.PRODUCTS]: {
    title:
      "Produsele mele",

    actions:
      VENDOR_PRODUCT_ACTIONS,

    parent:
      VENDOR_MENU_IDS.ROOT,
  },

  [VENDOR_MENU_IDS.STORE]: {
    title:
      "Magazinul meu",

    actions: [],

    parent:
      VENDOR_MENU_IDS.ROOT,
  },
};

/* =========================================================
   Helper
========================================================= */

export function getVendorMenu(
  menuId
) {
  return (
    VENDOR_MENUS[menuId] ||
    VENDOR_MENUS[
      VENDOR_MENU_IDS.ROOT
    ]
  );
}