// src/pages/Vendor/ProfilMagazin/utils/productFormFromApi.js
//
// Produsul din GET /api/vendors/products/:id -> formularul editorului. Mutată (nu
// copiată) din productEditing.js, fără dependențe de interfață, ca s-o folosească la fel
// ProductModal, „Modificări solicitate” și editarea din Smart Listing.

import { shippingFormFromProduct } from "../../../../utils/productShippingForm.js";

export function productFormFromApi(full) {
  return {
    id: full.id || full._id || "",
    title: full.title || "",
    description: full.description || "",
    price:
      typeof full.price === "number"
        ? full.price
        : Number.isFinite(full.priceCents)
        ? full.priceCents / 100
        : 0,
    images: Array.isArray(full.images) ? full.images : [],
    videoUrl: full.videoUrl || null,
    videoMuted: !!full.videoMuted,
    category: full.category || "",
    // absent în API => absent în formular (backend-ul păstrează lista)
    ...(Array.isArray(full.additionalCategories)
      ? { additionalCategories: full.additionalCategories }
      : {}),
    aiSuggestedCategory: "",
    aiSuggestedAdditionalCategories: [],
    currency: full.currency || "RON",
    isActive: full.isActive !== false,
    availability: (full.availability || "READY").toUpperCase(),
    leadTimeDays: Number.isFinite(Number(full.leadTimeDays))
      ? String(Number(full.leadTimeDays))
      : "",
    readyQty:
      full.readyQty === null || full.readyQty === undefined
        ? ""
        : Number.isFinite(Number(full.readyQty))
        ? String(Number(full.readyQty))
        : "",
    nextShipDate: full.nextShipDate
      ? String(full.nextShipDate).slice(0, 10)
      : "",
    acceptsCustom: !!full.acceptsCustom,
    isHidden: !!full.isHidden,
    color: full.color || "",
    materialMain: full.materialMain || "",
    technique: full.technique || "",
    styleTags: Array.isArray(full.styleTags)
      ? full.styleTags.join(", ")
      : full.styleTags || "",
    occasionTags: Array.isArray(full.occasionTags)
      ? full.occasionTags.join(", ")
      : full.occasionTags || "",
    dimensions: full.dimensions || "",
    // profil logistic (produsul ambalat) - Livrare și colet
    ...shippingFormFromProduct(full),
    careInstructions: full.careInstructions || "",
    specialNotes: full.specialNotes || "",

    isOwnManufacturer:
      full.isOwnManufacturer === true || full.isOwnManufacturer === false
        ? full.isOwnManufacturer
        : null,
    manufacturerName: full.manufacturerName || "",
    manufacturerAddress: full.manufacturerAddress || "",
    manufacturerEmail: full.manufacturerEmail || "",
    manufacturerInEU:
      full.manufacturerInEU === true || full.manufacturerInEU === false
        ? full.manufacturerInEU
        : null,
    responsiblePersonName: full.responsiblePersonName || "",
    responsiblePersonAddress: full.responsiblePersonAddress || "",
    responsiblePersonEmail: full.responsiblePersonEmail || "",
    safetyWarnings:
      full.safetyWarnings === null || full.safetyWarnings === undefined
        ? null
        : full.safetyWarnings,
    isForChildren:
      full.isForChildren === true || full.isForChildren === false
        ? full.isForChildren
        : null,

    orderMode: full.orderMode || "READY_TO_BUY",

    optionsSchema: Array.isArray(full.optionsSchema) ? full.optionsSchema : [],
    customSchema: Array.isArray(full.customSchema) ? full.customSchema : [],
    repeatedGroups: Array.isArray(full.repeatedGroups) ? full.repeatedGroups : [],
    quoteSchema: Array.isArray(full.quoteSchema) ? full.quoteSchema : [],
  };
}
