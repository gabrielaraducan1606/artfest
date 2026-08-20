// src/routes/vendorCatalogProductsRoutes.js

import express from "express";

import {
  prisma,
} from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
  requireRole,
} from "../api/auth.js";

import {
  getCatalogProductsRoute,
} from "../ai/manifests/catalogProducts.manifest.js";

const router =
  express.Router();

/* =========================================================
   ACCESS
========================================================= */

const vendorAccess = [
  authRequired,

  enforceTokenVersion,

  requireRole(
    "VENDOR",
    "ADMIN"
  ),
];

router.use(
  ...vendorAccess
);

/* =========================================================
   HELPERS
========================================================= */

function normalizeIds(
  value
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((id) =>
          String(
            id || ""
          ).trim()
        )
        .filter(Boolean)
    )
  ).slice(
    0,
    500
  );
}

/*
 * Produce un WHERE care permite
 * accesul doar la produsele vendorului
 * autentificat.
 */
function ownedProductWhere(
  userId,
  ids = null
) {
  return {
    ...(ids
      ? {
          id: {
            in: ids,
          },
        }
      : {}),

    service: {
      vendor: {
        userId,
      },
    },
  };
}

function getMainImage(
  product
) {
  if (
    !Array.isArray(
      product.images
    )
  ) {
    return "";
  }

  return (
    product.images.find(
      Boolean
    ) || ""
  );
}

function optionValueLabel(
  value
) {
  if (
    typeof value ===
    "string"
  ) {
    return value;
  }

  return String(
    value?.label ||
      value?.name ||
      value?.value ||
      ""
  ).trim();
}

function getOptionsText(
  schema
) {
  if (
    !Array.isArray(
      schema
    )
  ) {
    return [];
  }

  return schema
    .map((option) => {
      const label =
        String(
          option?.label ||
            option?.name ||
            option?.key ||
            ""
        ).trim();

      if (!label) {
        return null;
      }

      const values =
        Array.isArray(
          option?.values
        )
          ? option.values
              .map(
                optionValueLabel
              )
              .filter(Boolean)
          : [];

      return values.length
        ? `${label}: ${values.join(
            ", "
          )}`
        : label;
    })
    .filter(Boolean);
}

function getFieldLabels(
  schema
) {
  if (
    !Array.isArray(
      schema
    )
  ) {
    return [];
  }

  return schema
    .map((field) =>
      String(
        field?.label ||
          field?.name ||
          field?.key ||
          ""
      ).trim()
    )
    .filter(Boolean);
}

function buildVariantsText(
  product
) {
  const parts = [
    ...getOptionsText(
      product.optionsSchema
    ),

    ...getFieldLabels(
      product.customSchema
    ),

    ...getFieldLabels(
      product.quoteSchema
    ),
  ];

  return parts.join(
    " · "
  );
}

function mapCatalogProduct(
  product
) {
  return {
    id:
      product.id,

    serviceId:
      product.serviceId,

    store:
      product.service
        ? {
            id:
              product.service.id,

            title:
              product.service.title,

            slug:
              product.service
                .profile
                ?.slug ||
              null,
          }
        : null,

    title:
      product.title ||
      "",

    image:
      getMainImage(
        product
      ),

    images:
      Array.isArray(
        product.images
      )
        ? product.images
        : [],

    price:
      product.priceCents !==
        null &&
      product.priceCents !==
        undefined
        ? Number(
            product.priceCents
          ) / 100
        : null,

    currency:
      product.currency ||
      "RON",

    stock:
      product.readyQty ??
      null,

    availability:
      product.availability ||
      null,

    orderMode:
      product.orderMode ||
      "DIRECT",

    category:
      product.category ||
      "",

    active:
      !!product.isActive,

    hidden:
      !!product.isHidden,

    moderationStatus:
      product.moderationStatus ||
      null,

    variants:
      buildVariantsText(
        product
      ),

    optionsSchema:
      Array.isArray(
        product.optionsSchema
      )
        ? product.optionsSchema
        : [],

    customSchema:
      Array.isArray(
        product.customSchema
      )
        ? product.customSchema
        : [],

    quoteSchema:
      Array.isArray(
        product.quoteSchema
      )
        ? product.quoteSchema
        : [],

    repeatedGroups:
      Array.isArray(
        product.repeatedGroups
      )
        ? product.repeatedGroups
        : [],

    createdAt:
      product.createdAt,

    updatedAt:
      product.updatedAt,
  };
}

/* =========================================================
   GET /
   LISTARE PRODUSE
========================================================= */

router.get(
  getCatalogProductsRoute(
    "list"
  ),

  async (
    req,
    res
  ) => {
    try {
      const [
        products,
        productStores,
      ] =
        await Promise.all([
          prisma.product.findMany({
            where:
              ownedProductWhere(
                req.user.sub
              ),

            orderBy: {
              createdAt:
                "desc",
            },

            select: {
              id: true,
              serviceId: true,
              title: true,
              priceCents: true,
              currency: true,
              images: true,
              readyQty: true,
              availability: true,
              orderMode: true,
              category: true,
              isActive: true,
              isHidden: true,
              moderationStatus: true,
              optionsSchema: true,
              customSchema: true,
              quoteSchema: true,
              repeatedGroups: true,
              createdAt: true,
              updatedAt: true,

              service: {
                select: {
                  id: true,
                  title: true,

                  profile: {
                    select: {
                      slug: true,
                    },
                  },
                },
              },
            },
          }),

          /*
           * Încărcăm separat magazinele de produse ale
           * vendorului. Astfel putem adăuga primul produs
           * chiar dacă momentan catalogul este gol.
           *
           * IMPORTANT:
           * Modelul Prisma este VendorService,
           * deci folosim prisma.vendorService.
           */
          prisma.vendorService.findMany({
            where: {
              vendor: {
                userId:
                  req.user.sub,
              },

              type: {
                code:
                  "products",
              },
            },

            select: {
              id: true,
              title: true,

              profile: {
                select: {
                  slug: true,
                },
              },
            },
          }),
        ]);

      const items =
        products.map(
          mapCatalogProduct
        );

      const stores =
        productStores
          .map(
            (service) => ({
              id:
                service.id,

              title:
                service.title ||
                "",

              slug:
                service.profile
                  ?.slug ||
                null,
            })
          )
          .filter(
            (store) =>
              !!store.slug
          );

      const defaultStoreSlug =
        stores.length === 1
          ? stores[0].slug
          : null;

      const activeCount =
        items.filter(
          (product) =>
            product.active
        ).length;

      return res.json({
        items,

        total:
          items.length,

        activeCount,

        inactiveCount:
          items.length -
          activeCount,

        stores,

        defaultStoreSlug,
      });
    } catch (error) {
      console.error(
        "[catalog-products] list:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "catalog_products_load_failed",

          message:
            "Produsele nu au putut fi încărcate.",
        });
    }
  }
);

/* =========================================================
   PATCH /bulk-status

   BODY:
   {
     ids: ["id1", "id2"],
     active: true
   }
========================================================= */

router.patch(
  getCatalogProductsRoute(
    "bulkStatus"
  ),

  express.json(),

  async (
    req,
    res
  ) => {
    try {
      const ids =
        normalizeIds(
          req.body?.ids
        );

      const active =
        req.body?.active;

      if (!ids.length) {
        return res
          .status(400)
          .json({
            error:
              "ids_required",

            message:
              "Selectează cel puțin un produs.",
          });
      }

      if (
        typeof active !==
        "boolean"
      ) {
        return res
          .status(400)
          .json({
            error:
              "active_required",

            message:
              "Statusul produsului lipsește.",
          });
      }

      const result =
        await prisma.product.updateMany({
          where:
            ownedProductWhere(
              req.user.sub,
              ids
            ),

          data: {
            isActive:
              active,
          },
        });

      return res.json({
        ok: true,

        updated:
          result.count,

        active,
      });
    } catch (error) {
      console.error(
        "[catalog-products] bulk status:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "bulk_status_failed",

          message:
            "Statusul produselor nu a putut fi modificat.",
        });
    }
  }
);

/* =========================================================
   DELETE /bulk

   BODY:
   {
     ids: ["id1", "id2"]
   }
========================================================= */

router.delete(
  getCatalogProductsRoute(
    "bulkDelete"
  ),

  express.json(),

  async (
    req,
    res
  ) => {
    try {
      const ids =
        normalizeIds(
          req.body?.ids
        );

      if (!ids.length) {
        return res
          .status(400)
          .json({
            error:
              "ids_required",

            message:
              "Selectează cel puțin un produs.",
          });
      }

      const result =
        await prisma.product.deleteMany({
          where:
            ownedProductWhere(
              req.user.sub,
              ids
            ),
        });

      return res.json({
        ok: true,

        deleted:
          result.count,
      });
    } catch (error) {
      console.error(
        "[catalog-products] bulk delete:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "bulk_delete_failed",

          message:
            "Produsele nu au putut fi șterse.",
        });
    }
  }
);

/* =========================================================
   PATCH /bulk-price

   BODY:
   {
     ids: ["id1", "id2"],
     price: 45.50
   }
========================================================= */

router.patch(
  getCatalogProductsRoute(
    "bulkPrice"
  ),

  express.json(),

  async (
    req,
    res
  ) => {
    try {
      const ids =
        normalizeIds(
          req.body?.ids
        );

      const price =
        Number(
          req.body?.price
        );

      if (!ids.length) {
        return res
          .status(400)
          .json({
            error:
              "ids_required",

            message:
              "Selectează cel puțin un produs.",
          });
      }

      if (
        !Number.isFinite(
          price
        ) ||
        price < 0
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_price",

            message:
              "Introdu un preț valid.",
          });
      }

      const priceCents =
        Math.round(
          price * 100
        );

      const result =
        await prisma.product.updateMany({
          where:
            ownedProductWhere(
              req.user.sub,
              ids
            ),

          data: {
            priceCents,
          },
        });

      return res.json({
        ok: true,

        updated:
          result.count,

        price,

        priceCents,
      });
    } catch (error) {
      console.error(
        "[catalog-products] bulk price:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "bulk_price_failed",

          message:
            "Prețul produselor nu a putut fi modificat.",
        });
    }
  }
);

/* =========================================================
   PATCH /bulk-category

   BODY:
   {
     ids: ["id1", "id2"],
     category: "Cadouri"
   }
========================================================= */

router.patch(
  getCatalogProductsRoute(
    "bulkCategory"
  ),

  express.json(),

  async (
    req,
    res
  ) => {
    try {
      const ids =
        normalizeIds(
          req.body?.ids
        );

      const category =
        String(
          req.body?.category ||
            ""
        )
          .trim()
          .slice(
            0,
            150
          );

      if (!ids.length) {
        return res
          .status(400)
          .json({
            error:
              "ids_required",

            message:
              "Selectează cel puțin un produs.",
          });
      }

      if (!category) {
        return res
          .status(400)
          .json({
            error:
              "category_required",

            message:
              "Introdu categoria.",
          });
      }

      const result =
        await prisma.product.updateMany({
          where:
            ownedProductWhere(
              req.user.sub,
              ids
            ),

          data: {
            category,

            /*
             * Categoria modifică
             * informația publică,
             * deci produsul intră
             * din nou în moderare.
             */
            moderationStatus:
              "PENDING",

            moderationMessage:
              null,

            submittedAt:
              new Date(),

            reviewedAt:
              null,

            reviewedByUserId:
              null,

            approvedAt:
              null,
          },
        });

      return res.json({
        ok: true,

        updated:
          result.count,

        category,

        moderationStatus:
          "PENDING",
      });
    } catch (error) {
      console.error(
        "[catalog-products] bulk category:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "bulk_category_failed",

          message:
            "Categoria nu a putut fi modificată.",
        });
    }
  }
);

/* =========================================================
   POST /:productId/duplicate

   Creează o copie a produsului.

   Reguli:
   - produsul trebuie să aparțină vendorului;
   - copia rămâne în același magazin;
   - păstrează imaginile;
   - păstrează variantele;
   - păstrează personalizarea;
   - copia este INACTIVĂ;
   - copia intră în moderare.
========================================================= */

router.post(
  getCatalogProductsRoute(
    "duplicate"
  ),

  async (
    req,
    res
  ) => {
    try {
      const productId =
        String(
          req.params
            ?.productId ||
            ""
        ).trim();

      if (!productId) {
        return res
          .status(400)
          .json({
            error:
              "product_id_required",

            message:
              "Produsul nu a fost specificat.",
          });
      }

      /*
       * Încărcăm produsul numai dacă
       * aparține vendorului autentificat.
       */
      const source =
        await prisma.product.findFirst({
          where: {
            id:
              productId,

            service: {
              vendor: {
                userId:
                  req.user.sub,
              },
            },
          },

          select: {
            id: true,

            serviceId: true,

            title: true,

            description: true,

            priceCents: true,

            currency: true,

            images: true,

            category: true,

            color: true,

            materialMain:
              true,

            technique:
              true,

            styleTags:
              true,

            occasionTags:
              true,

            dimensions:
              true,

            careInstructions:
              true,

            specialNotes:
              true,

            availability:
              true,

            readyQty:
              true,

            leadTimeDays:
              true,

            nextShipDate:
              true,

            acceptsCustom:
              true,

            orderMode:
              true,

            optionsSchema:
              true,

            customSchema:
              true,

            repeatedGroups:
              true,

            quoteSchema:
              true,
          },
        });

      if (!source) {
        return res
          .status(404)
          .json({
            error:
              "product_not_found",

            message:
              "Produsul nu a fost găsit sau nu îți aparține.",
          });
      }

      const baseTitle =
        String(
          source.title ||
            "Produs"
        ).trim();

      /*
       * Păstrăm o limită rezonabilă
       * pentru titlul copiei.
       */
      const duplicatedTitle =
        `${baseTitle} - copie`
          .slice(
            0,
            250
          );

      const duplicated =
        await prisma.product.create({
          data: {
            /*
             * Același magazin.
             */
            serviceId:
              source.serviceId,

            title:
              duplicatedTitle,

            description:
              source.description,

            priceCents:
              source.priceCents,

            currency:
              source.currency ||
              "RON",

            images:
              Array.isArray(
                source.images
              )
                ? source.images
                : [],

            category:
              source.category,

            color:
              source.color,

            materialMain:
              source.materialMain,

            technique:
              source.technique,

            styleTags:
              Array.isArray(
                source.styleTags
              )
                ? source.styleTags
                : [],

            occasionTags:
              Array.isArray(
                source.occasionTags
              )
                ? source.occasionTags
                : [],

            dimensions:
              source.dimensions,

            careInstructions:
              source.careInstructions,

            specialNotes:
              source.specialNotes,

            availability:
              source.availability,

            readyQty:
              source.readyQty,

            leadTimeDays:
              source.leadTimeDays,

            nextShipDate:
              source.nextShipDate,

            acceptsCustom:
              !!source.acceptsCustom,

            orderMode:
              source.orderMode,

            /*
             * Copiem structurile JSON.
             */
            optionsSchema:
              source.optionsSchema,

            customSchema:
              source.customSchema,

            repeatedGroups:
              source.repeatedGroups,

            quoteSchema:
              source.quoteSchema,

            /*
             * Copia NU este publicată automat.
             */
            isActive:
              false,

            isHidden:
              false,

            /*
             * Copia intră în moderare.
             */
            moderationStatus:
              "PENDING",

            moderationMessage:
              null,

            submittedAt:
              new Date(),

            reviewedAt:
              null,

            reviewedByUserId:
              null,

            approvedAt:
              null,
          },
        });

      return res
        .status(201)
        .json({
          ok: true,

          message:
            "Produsul a fost duplicat. Copia este momentan inactivă.",

          product: {
            id:
              duplicated.id,

            title:
              duplicated.title,

            serviceId:
              duplicated.serviceId,

            isActive:
              duplicated.isActive,

            moderationStatus:
              duplicated.moderationStatus,
          },
        });
    } catch (error) {
      console.error(
        "[catalog-products] duplicate:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "product_duplicate_failed",

          message:
            "Produsul nu a putut fi duplicat.",
        });
    }
  }
);

export default router;