// server/routes/productAiRoutes.js

import { Router } from "express";
import { authRequired } from "../api/auth.js";

import { CATEGORY_SET } from "../constants/categories.js";
import { COLORS_DETAILED } from "../constants/colors.js";
import { MATERIALS_DETAILED } from "../constants/materials.js";

import {
  analyzeProductImagesWithAi,
} from "../lib/productAI.js";

import {
  vendorAccessRequired,
  getOwnedProductsServiceBySlug,
} from "../lib/vendorProductAccess.js";

const router = Router();

/* =========================================================
   Helpers generale
========================================================= */

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function makeSchemaKey(label) {
  return normalizeToken(label)
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function getSchemaFields(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.fields)) {
    return value.fields;
  }

  return [];
}

function normalizeProductImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((image) => String(image || "").trim())
    .filter(
      (url) =>
        /^https?:\/\//i.test(url) ||
        url.startsWith("/")
    )
    .slice(0, 12);
}

function normalizeOptionImageUrl(value) {
  const url = String(value || "").trim();

  if (!url) {
    return null;
  }

  if (
    /^https?:\/\//i.test(url) ||
    url.startsWith("/")
  ) {
    return url;
  }

  return null;
}

/* =========================================================
   Normalizare optionsSchema
========================================================= */

function normalizeOptionsSchema(value) {
  const fields = getSchemaFields(value);
  const usedFields = new Set();

  return fields
    .map((field) => {
      const label = String(
        field?.label || ""
      ).trim();

      const key = String(
        field?.key ||
          makeSchemaKey(label)
      ).trim();

      if (
        !label ||
        !key ||
        usedFields.has(key)
      ) {
        return null;
      }

      usedFields.add(key);

      const rawOptions =
        Array.isArray(field?.options)
          ? field.options
          : Array.isArray(field?.values)
            ? field.values
            : [];

      const usedOptions = new Set();

      const options = rawOptions
        .map((item) => {
          /*
           * Variantă simplă:
           * "Alb"
           */
          if (typeof item === "string") {
            const text = item.trim();

            if (!text) {
              return null;
            }

            const dedupeKey =
              normalizeToken(text);

            if (
              usedOptions.has(dedupeKey)
            ) {
              return null;
            }

            usedOptions.add(dedupeKey);

            return text;
          }

          /*
           * Variantă complexă:
           * {
           *   value: "white",
           *   label: "Alb",
           *   colorHex: "#ffffff",
           *   imageUrl: "/uploads/...",
           *   imageIndex: 0
           * }
           */
          if (
            !item ||
            typeof item !== "object"
          ) {
            return null;
          }

          const optionValue = String(
            item.value ||
              item.key ||
              item.label ||
              ""
          ).trim();

          const optionLabel = String(
            item.label ||
              item.value ||
              item.key ||
              ""
          ).trim();

          if (
            !optionValue ||
            !optionLabel
          ) {
            return null;
          }

          const dedupeKey =
            normalizeToken(optionValue);

          if (
            usedOptions.has(dedupeKey)
          ) {
            return null;
          }

          usedOptions.add(dedupeKey);

          return {
            value: optionValue,
            label: optionLabel,

            colorHex: item.colorHex
              ? String(
                  item.colorHex
                ).slice(0, 16)
              : null,

            imageUrl:
              normalizeOptionImageUrl(
                item.imageUrl
              ),

            imageIndex:
              Number.isInteger(
                item.imageIndex
              ) &&
              item.imageIndex >= 0
                ? item.imageIndex
                : null,

            disabled:
              !!item.disabled,
          };
        })
        .filter(Boolean)
        .slice(0, 50);

      return {
        key,
        label,
        type: "select",

        required:
          field?.required !== false,

        options,

        sellerCanAddValues:
          field?.sellerCanAddValues !==
          false,

        source:
          field?.source === "ai"
            ? "ai"
            : "seller",
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

/* =========================================================
   Helpers pentru constante
========================================================= */

function getCatalogKey(item) {
  return (
    item?.key ||
    item?.value ||
    null
  );
}

function getCatalogLabel(item) {
  return (
    item?.label ||
    item?.name ||
    getCatalogKey(item)
  );
}

function getCatalogHex(item) {
  return (
    item?.hex ||
    item?.hexCode ||
    item?.colorHex ||
    null
  );
}

function findCatalogItem(
  value,
  catalog
) {
  const needle =
    normalizeToken(value);

  if (!needle) {
    return null;
  }

  return (
    catalog.find((item) => {
      const candidates = [
        item?.key,
        item?.value,
        item?.label,
        item?.name,

        ...(Array.isArray(
          item?.aliases
        )
          ? item.aliases
          : []),
      ];

      return candidates.some(
        (candidate) =>
          normalizeToken(
            candidate
          ) === needle
      );
    }) || null
  );
}

/* =========================================================
   Normalizare răspuns AI
========================================================= */

function normalizeProductAiAnalysis(
  raw
) {
  const rawColors =
    Array.isArray(raw?.colors)
      ? raw.colors
      : Array.isArray(
          raw?.detectedColors
        )
        ? raw.detectedColors
        : [];

  const colors = Array.from(
    new Set(
      rawColors
        .map((item) => {
          const value =
            typeof item === "string"
              ? item
              : item?.key ||
                item?.value ||
                item?.label;

          const found =
            findCatalogItem(
              value,
              COLORS_DETAILED
            );

          return getCatalogKey(
            found
          );
        })
        .filter(Boolean)
    )
  );

  const materialFound =
    findCatalogItem(
      raw?.materialMain ||
        raw?.material,
      MATERIALS_DETAILED
    );

  const materialMain =
    getCatalogKey(
      materialFound
    );

  const categoryValue =
    String(
      raw?.category || ""
    ).trim();

  const category =
    categoryValue &&
    CATEGORY_SET.has(
      categoryValue
    )
      ? categoryValue
      : null;

  const rawConfidence =
    Number(raw?.confidence);

  const confidence =
    Number.isFinite(
      rawConfidence
    )
      ? Math.max(
          0,
          Math.min(
            1,
            rawConfidence
          )
        )
      : null;

  const imageGroups =
    Array.isArray(
      raw?.imageGroups
    )
      ? raw.imageGroups
          .map((group) => {
            const colorFound =
              findCatalogItem(
                group?.color,
                COLORS_DETAILED
              );

            const color =
              getCatalogKey(
                colorFound
              );

            const imageIndexes =
              Array.isArray(
                group?.imageIndexes
              )
                ? group.imageIndexes
                    .map(Number)
                    .filter(
                      (index) =>
                        Number.isInteger(
                          index
                        ) &&
                        index >= 0 &&
                        index < 12
                    )
                : [];

            return {
              color,
              imageIndexes,
            };
          })
          .filter(
            (group) =>
              group.color
          )
      : [];

  return {
    category,
    colors,
    materialMain,
    imageGroups,
    confidence,
  };
}

/* =========================================================
   Combinare AI + opțiuni introduse de vânzător
========================================================= */

function mergeAiAndSellerOptions({
  aiAnalysis,
  sellerOptions = [],
  images = [],
}) {
  const fields = [];

  const colors =
    Array.isArray(
      aiAnalysis?.colors
    )
      ? aiAnalysis.colors
      : [];

  /*
   * Dacă există mai multe culori,
   * generăm automat opțiunea "Culoare".
   *
   * Dacă există o singură culoare,
   * ea devine doar culoarea principală
   * a produsului.
   */
  if (colors.length > 1) {
    const options = colors
      .map((key) => {
        const color =
          COLORS_DETAILED.find(
            (item) =>
              getCatalogKey(item) ===
              key
          );

        if (!color) {
          return null;
        }

        const imageGroup =
          Array.isArray(
            aiAnalysis?.imageGroups
          )
            ? aiAnalysis.imageGroups.find(
                (group) =>
                  group.color === key
              )
            : null;

        const imageIndex =
          imageGroup?.imageIndexes?.find(
            (index) =>
              Number.isInteger(index) &&
              index >= 0 &&
              index < images.length
          ) ?? null;

        return {
          value: key,

          label:
            getCatalogLabel(
              color
            ),

          colorHex:
            getCatalogHex(
              color
            ),

          imageIndex,

          imageUrl:
            Number.isInteger(
              imageIndex
            )
              ? images[imageIndex] ||
                null
              : null,

          disabled: false,
        };
      })
      .filter(Boolean);

    if (options.length > 1) {
      fields.push({
        key: "color",
        label: "Culoare",
        type: "select",
        required: true,
        options,
        sellerCanAddValues: true,
        source: "ai",
      });
    }
  }

  /*
   * Opțiunile introduse manual de vânzător
   * au prioritate față de AI.
   */
  for (const field of sellerOptions) {
    if (!field?.key) {
      continue;
    }

    const existingIndex =
      fields.findIndex(
        (existing) =>
          existing.key ===
          field.key
      );

    if (existingIndex >= 0) {
      fields[existingIndex] = {
        ...field,
        source: "seller",
      };
    } else {
      fields.push({
        ...field,
        source: "seller",
      });
    }
  }

  return normalizeOptionsSchema(
    fields
  );
}

/* =========================================================
   Handler analiză AI
========================================================= */

async function analyzeProductVariants(
  req,
  res
) {
  try {
    const slug = String(
      req.params.slug || ""
    )
      .trim()
      .toLowerCase();

    const access =
      await getOwnedProductsServiceBySlug(
        slug,
        req.user.sub
      );

    if (access.error) {
      return res
        .status(access.status)
        .json({
          error: access.error,
        });
    }

    const images =
      normalizeProductImages(
        req.body?.images
      );

    if (!images.length) {
      return res.status(400).json({
        error: "images_required",

        message:
          "Adaugă cel puțin o imagine înainte de analiza AI.",
      });
    }

    const sellerOptions =
      normalizeOptionsSchema(
        req.body?.sellerOptions ||
          []
      );

    const title = String(
      req.body?.title || ""
    ).trim();

    const description = String(
      req.body?.description || ""
    ).trim();

    const rawAnalysis =
      await analyzeProductImagesWithAi({
        images,
        title,
        description,

        catalog: {
          categories:
            Array.from(
              CATEGORY_SET
            ),

          colors:
            COLORS_DETAILED.map(
              (item) => ({
                key:
                  getCatalogKey(
                    item
                  ),

                label:
                  getCatalogLabel(
                    item
                  ),
              })
            ),

          materials:
            MATERIALS_DETAILED.map(
              (item) => ({
                key:
                  getCatalogKey(
                    item
                  ),

                label:
                  getCatalogLabel(
                    item
                  ),
              })
            ),
        },
      });

    const normalized =
      normalizeProductAiAnalysis(
        rawAnalysis
      );

    const optionsSchema =
      mergeAiAndSellerOptions({
        aiAnalysis: normalized,
        sellerOptions,
        images,
      });

    const hasOptions =
      optionsSchema.length > 0;

    return res.json({
      ok: true,

      /*
       * Valori directe pentru formular.
       */
      category:
        normalized.category,

      materialMain:
        normalized.materialMain,

      primaryColor:
        normalized.colors[0] ||
        null,

      /*
       * Analiza completă.
       */
      visionAnalysis:
        normalized,

      /*
       * Schema de comandă sugerată.
       */
      orderAnalysis: {
        orderMode: hasOptions
          ? "OPTIONS"
          : "READY_TO_BUY",

        optionsSchema,
      },

      generatedFields: [
        ...(normalized.category
          ? ["category"]
          : []),

        ...(normalized.materialMain
          ? ["materialMain"]
          : []),

        ...(normalized.colors.length
          ? ["color"]
          : []),

        ...(hasOptions
          ? [
              "optionsSchema",
              "orderMode",
            ]
          : []),
      ],

      confidence:
        normalized.confidence,

      version:
        "product-variants-v1",
    });
  } catch (error) {
    console.error(
      "analyzeProductVariants error:",
      error
    );

    return res.status(500).json({
      error:
        "ai_analysis_failed",

      message:
        "Nu am putut analiza imaginile produsului.",
    });
  }
}

/* =========================================================
   Routes
========================================================= */

function registerAiRoutes(prefix) {
  router.post(
    `/${prefix}/store/:slug/products/analyze`,
    authRequired,
    vendorAccessRequired,
    analyzeProductVariants
  );
}

registerAiRoutes("vendors");
registerAiRoutes("vendor");

export default router;