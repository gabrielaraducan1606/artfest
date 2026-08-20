// src/ai/manifests/vendorCampaigns.manifest.js

export const VENDOR_CAMPAIGNS_MANIFEST = {
  id: "vendor-campaigns",

  title:
    "Campanii proprii ale vânzătorilor",

  audience: [
    "VENDOR",
    "ADMIN",
  ],

  available: true,

  basePath:
    "/api/vendor/campaigns",

  description:
    "Permite vânzătorilor să își creeze campanii cu link propriu, reducere opțională pentru client și comision Artfest redus pentru comenzile atribuite campaniei.",

  features: {
    createCampaign: true,
    listCampaigns: true,
    editCampaign: true,
    deleteCampaign: true,
    activateCampaign: true,
    deactivateCampaign: true,

    allProductsScope: true,
    selectedProductsScope: true,

    customPublicLink: true,
    campaignDiscount: true,
    reducedArtfestCommission: true,

    campaignAnalytics: true,

    promotionalCreatives: true,
    aiCreativeGeneration: false,
  },

  rules: {
    commissionControlledByPlatform: true,

    defaultCommissionBps:
      600,

    standardCommissionBps:
      1200,

    allowedDiscountPercents: [
      0,
      5,
      10,
      15,
    ],

    defaultAttributionWindowHours:
      168,
  },

  endpoints: {
    list: {
      method:
        "GET",

      path:
        "/",

      purpose:
        "Returnează campaniile vendorului autentificat.",
    },

    create: {
      method:
        "POST",

      path:
        "/",

      purpose:
        "Creează o campanie nouă pentru vendor.",
    },

    detail: {
      method:
        "GET",

      path:
        "/:campaignId",

      purpose:
        "Returnează detaliile unei campanii.",
    },

    update: {
      method:
        "PATCH",

      path:
        "/:campaignId",

      purpose:
        "Modifică numele, reducerea, scope-ul sau perioada unei campanii.",
    },

    status: {
      method:
        "PATCH",

      path:
        "/:campaignId/status",

      purpose:
        "Activează sau dezactivează campania.",
    },

    delete: {
      method:
        "DELETE",

      path:
        "/:campaignId",

      purpose:
        "Șterge campania vendorului.",
    },

    products: {
      method:
        "PUT",

      path:
        "/:campaignId/products",

      purpose:
        "Setează produsele incluse într-o campanie de tip SELECTED_PRODUCTS.",
    },

    creatives: {
      method:
        "GET",

      path:
        "/:campaignId/creatives",

      purpose:
        "Returnează materialele promoționale asociate campaniei.",
    },

    generateCreatives: {
      method:
        "POST",

      path:
        "/:campaignId/creatives/generate",

      purpose:
        "Generează materiale promoționale pentru campanie.",

      available:
        false,

      status:
        "PLANNED",
    },
  },
};

export function getVendorCampaignRoute(
  key
) {
  const endpoint =
    VENDOR_CAMPAIGNS_MANIFEST
      .endpoints[key];

  if (!endpoint) {
    throw new Error(
      `Unknown vendor campaign route: ${key}`
    );
  }

  return endpoint.path;
}