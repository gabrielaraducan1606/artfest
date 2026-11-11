// backend/src/integrations/adapters/woocommerce/mapper.js
//
// Răspunsurile REST WooCommerce (wc/v3) -> forma comună (core/normalize.js).
//
// Stocul în WooCommerce:
//   produs:   manage_stock true/false, stock_quantity (poate fi negativ cu
//             backorders), stock_status instock/outofstock/onbackorder,
//             backorders no/notify/yes;
//   variație: manage_stock true (stoc propriu) / "parent" (folosește stocul
//             produsului părinte) / false (neurmărit, doar stock_status).
// Atributele cu variation: true sunt axele variantelor; o variație cu
// option "" acceptă ORICE valoare pentru acel atribut (nu e o combinație
// concretă - importul cere confirmare, nu inventează combinații).
// Personalizări: add-on-urile oficiale „WooCommerce Product Add-Ons”
// (meta _product_addons) de tip text / textarea / fișier.
// Greutate / dimensiuni: weight și dimensions.{length,width,height} sunt
// text, în unitățile din setările magazinului (woocommerce_weight_unit /
// woocommerce_dimension_unit, citite de adaptor) - NU presupunem kg / cm.
// O variație fără valori proprii le primește în API pe ale părintelui.

import { moneyToCents, normalizeShippingMeasures, slugKey } from "../../core/normalize.js";

const STOCK_STATUSES = new Set(["instock", "outofstock", "onbackorder"]);
const BACKORDERS = new Set(["no", "notify", "yes"]);

// tipuri de add-on (WooCommerce Product Add-Ons) -> câmp de personalizare Artfest
const ADDON_TYPES = {
  custom_text: "text",
  custom_textarea: "textarea",
  file_upload: "file",
};

// chei meta ale altor pluginuri de opțiuni: doar avertizare (nu le interpretăm)
const OTHER_ADDON_META = /^(_?tmcp|_?tm_meta|_?thwepo|_?wapf|_?ppom|_?yith_wapo|_?wcpa)/i;

function mapStock(source) {
  const managed = source?.manage_stock === true;
  const quantity = managed && Number.isFinite(Number(source?.stock_quantity)) ? Math.trunc(Number(source.stock_quantity)) : null;
  return {
    managed,
    quantity,
    status: STOCK_STATUSES.has(source?.stock_status) ? source.stock_status : "instock",
    backorders: BACKORDERS.has(source?.backorders) ? source.backorders : "no",
  };
}

function mapShipping(source, units) {
  return normalizeShippingMeasures({
    weight: source?.weight,
    weightUnit: units?.weight,
    length: source?.dimensions?.length,
    width: source?.dimensions?.width,
    height: source?.dimensions?.height,
    dimensionUnit: units?.dimension,
  });
}

function attributeKey(attr) {
  // atributele globale au slug (pa_culoare) / id > 0; cele locale doar nume
  return slugKey(attr?.slug || attr?.name || "");
}

function mapAttributes(product) {
  return (Array.isArray(product?.attributes) ? product.attributes : [])
    .map((attr) => ({
      id: Number(attr?.id) || 0,
      key: attributeKey(attr),
      name: String(attr?.name || "").trim(),
      options: (Array.isArray(attr?.options) ? attr.options : []).map((o) => String(o).trim()).filter(Boolean),
      variation: attr?.variation === true,
    }))
    .filter((attr) => attr.key && attr.name);
}

function mapPersonalization(product) {
  const fields = [];
  const unsupported = [];

  for (const meta of Array.isArray(product?.meta_data) ? product.meta_data : []) {
    const key = String(meta?.key || "");
    if (key === "_product_addons" && Array.isArray(meta.value)) {
      for (const addon of meta.value) {
        const type = ADDON_TYPES[addon?.type];
        const label = String(addon?.name || addon?.title_format || "").trim();
        if (type && label) {
          fields.push({
            key: slugKey(label) || `camp_${fields.length + 1}`,
            label,
            type,
            required: Boolean(Number(addon?.required)),
            source: "woocommerce_product_addons",
          });
        } else if (label) {
          unsupported.push(label);
        }
      }
    } else if (OTHER_ADDON_META.test(key)) {
      unsupported.push(key);
    }
  }

  return { fields, unsupported: [...new Set(unsupported)] };
}

/**
 * @param {Object} product    produsul WooCommerce (GET /products/:id)
 * @param {Object[]} variations variațiile (GET /products/:id/variations), pentru produse variabile
 * @param {{ weight: string|null, dimension: string|null }|null} [units]  unitățile magazinului (null = necunoscute)
 * @returns {import("../../core/normalize.js").ExternalProduct}
 */
export function mapWooProduct(product, variations = [], units = null) {
  const attributes = mapAttributes(product);
  const byId = new Map(attributes.filter((a) => a.id > 0).map((a) => [a.id, a]));
  const byName = new Map(attributes.map((a) => [a.name.toLowerCase(), a]));
  const { fields, unsupported } = mapPersonalization(product);

  const type = ["simple", "variable"].includes(product?.type) ? product.type : "other";
  const parentSku = product?.sku ? String(product.sku).trim() : null;

  return {
    externalId: String(product.id),
    type,
    name: String(product?.name || "").trim(),
    descriptionHtml: String(product?.description || ""),
    shortDescriptionHtml: String(product?.short_description || ""),
    sku: product?.sku ? String(product.sku).trim() : null,
    status: product?.status || null,
    priceCents: moneyToCents(product?.regular_price) ?? moneyToCents(product?.price),
    salePriceCents: moneyToCents(product?.sale_price),
    images: (Array.isArray(product?.images) ? product.images : []).map((img) => img?.src).filter(Boolean),
    categories: (Array.isArray(product?.categories) ? product.categories : []).map((c) => c?.name).filter(Boolean),
    attributes: attributes.map(({ id, ...rest }) => rest),
    personalizationFields: fields,
    unsupportedAddons: unsupported,
    stock: mapStock(product),
    shipping: mapShipping(product, units),
    variations:
      type === "variable"
        ? variations.map((variation) => {
            const rawSku = variation?.sku ? String(variation.sku).trim() : null;
            // o variație fără SKU propriu primește în API SKU-ul părintelui;
            // SKU-urile sunt unice în WooCommerce, deci egalitatea = moștenit
            const skuInherited = Boolean(rawSku && parentSku && rawSku === parentSku);
            return {
              externalId: String(variation.id),
              sku: skuInherited ? null : rawSku,
              skuInherited,
              priceCents: moneyToCents(variation?.regular_price) ?? moneyToCents(variation?.price),
              salePriceCents: moneyToCents(variation?.sale_price),
              image: variation?.image?.src || null,
              attributes: (Array.isArray(variation?.attributes) ? variation.attributes : []).map((attr) => {
                const parent = (Number(attr?.id) > 0 && byId.get(Number(attr.id))) || byName.get(String(attr?.name || "").toLowerCase());
                return {
                  key: parent?.key || attributeKey(attr),
                  name: parent?.name || String(attr?.name || ""),
                  option: String(attr?.option || "").trim(),
                };
              }),
              stockManagedAt: variation?.manage_stock === "parent" ? "PARENT" : variation?.manage_stock === true ? "VARIANT" : "NONE",
              stock: mapStock(variation),
              shipping: mapShipping(variation, units),
            };
          })
        : [],
    modifiedAt: product?.date_modified_gmt ? `${product.date_modified_gmt}Z` : product?.date_modified || null,
  };
}

/** Stocul unei unități (produs sau variație) din răspunsul WooCommerce. */
export function mapWooStock(resource) {
  return {
    ...mapStock(resource),
    modifiedAt: resource?.date_modified_gmt ? `${resource.date_modified_gmt}Z` : resource?.date_modified || null,
  };
}
