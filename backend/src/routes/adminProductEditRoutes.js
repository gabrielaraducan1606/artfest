// src/routes/adminProductsEditRoutes.js

import { Router } from "express";
import { prisma } from "../db.js";

import {
  authRequired,
  requireRole,
} from "../api/auth.js";

const router = Router();

/* =========================================================
   Doar ADMIN
========================================================= */

router.use(
  authRequired,
  requireRole("ADMIN")
);

/* =========================================================
   Helpers
========================================================= */

function normalizeText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

function normalizeNullableText(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text || null;
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function normalizeBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined
  ) {
    return fallback;
  }

  return value === true;
}

function normalizeDateOrNull(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

/* =========================================================
   PATCH /api/admin/products/:id

   Adminul poate corecta produsul unui vendor.

   NU schimbăm:
   - serviceId
   - vendorId
   - owner-ul produsului
   - moderationStatus
   - datele de aprobare

   Acestea rămân exact cum sunt.
========================================================= */

router.patch(
  "/products/:id",
  async (req, res) => {
    const productId =
      normalizeText(
        req.params.id
      );

    if (!productId) {
      return res
        .status(400)
        .json({
          error:
            "product_id_required",

          message:
            "ID-ul produsului lipsește.",
        });
    }

    try {
      /* -------------------------------------------------
         1. Produsul existent
      ------------------------------------------------- */

      const existing =
        await prisma.product.findUnique({
          where: {
            id: productId,
          },

          include: {
            service: {
              include: {
                type: true,

                vendor: {
                  select: {
                    id: true,
                    displayName: true,
                  },
                },

                profile: true,
              },
            },
          },
        });

      if (!existing) {
        return res
          .status(404)
          .json({
            error:
              "product_not_found",

            message:
              "Produsul nu a fost găsit.",
          });
      }

      /*
       * Protecție:
       * endpoint-ul este exclusiv
       * pentru produse.
       */
      if (
        existing.service
          ?.type?.code &&
        existing.service
          .type.code !==
          "products"
      ) {
        return res
          .status(400)
          .json({
            error:
              "not_a_product",

            message:
              "Elementul selectat nu este un produs.",
          });
      }

      const body =
        req.body || {};

      /*
       * Construim explicit obiectul
       * de update.
       *
       * Nu trimitem req.body direct
       * în Prisma.
       */
      const data = {};

      /* =================================================
         TITLU
      ================================================= */

      if (
        body.title !==
        undefined
      ) {
        const title =
          normalizeText(
            body.title
          );

        if (!title) {
          return res
            .status(400)
            .json({
              error:
                "invalid_title",

              message:
                "Titlul produsului este obligatoriu.",
            });
        }

        data.title =
          title;
      }

      /* =================================================
         DESCRIERE
      ================================================= */

      if (
        body.description !==
        undefined
      ) {
        data.description =
          String(
            body.description ||
              ""
          );
      }

      /* =================================================
         PREȚ
      ================================================= */

      if (
        body.price !==
        undefined
      ) {
        const price =
          Number(
            body.price
          );

        /*
         * Pentru QUOTE_ONLY
         * permitem preț 0.
         */
        const requestedMode =
          body.orderMode !==
          undefined
            ? String(
                body.orderMode
              ).toUpperCase()
            : String(
                existing.orderMode ||
                  "DIRECT"
              ).toUpperCase();

        if (
          requestedMode !==
            "QUOTE_ONLY" &&
          (
            !Number.isFinite(
              price
            ) ||
            price < 0
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_price",

              message:
                "Prețul produsului nu este valid.",
            });
        }

        data.priceCents =
          requestedMode ===
          "QUOTE_ONLY"
            ? 0
            : Math.round(
                price * 100
              );
      }

      /* =================================================
         MONEDĂ
      ================================================= */

      if (
        body.currency !==
        undefined
      ) {
        data.currency =
          normalizeText(
            body.currency ||
              "RON"
          ).toUpperCase() ||
          "RON";
      }

      /* =================================================
         IMAGINI
      ================================================= */

      if (
        body.images !==
        undefined
      ) {
        if (
          !Array.isArray(
            body.images
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_images",

              message:
                "Lista de imagini nu este validă.",
            });
        }

        const images =
          body.images
            .map((image) =>
              normalizeText(
                image
              )
            )
            .filter(Boolean);

        if (
          images.length === 0
        ) {
          return res
            .status(400)
            .json({
              error:
                "product_image_required",

              message:
                "Produsul trebuie să aibă cel puțin o imagine.",
            });
        }

        data.images =
          images.slice(
            0,
            10
          );
      }

      /* =================================================
         CATEGORIE
      ================================================= */

      if (
        body.category !==
        undefined
      ) {
        data.category =
          normalizeNullableText(
            body.category
          );
      }

      /* =================================================
         CULOARE / MATERIAL / TEHNICĂ ETC.
      ================================================= */

      if (
        body.color !==
        undefined
      ) {
        data.color =
          normalizeNullableText(
            body.color
          );
      }

      if (
        body.materialMain !==
        undefined
      ) {
        data.materialMain =
          normalizeNullableText(
            body.materialMain
          );
      }

      if (
        body.technique !==
        undefined
      ) {
        data.technique =
          normalizeNullableText(
            body.technique
          );
      }

      if (
  body.styleTags !==
  undefined
) {
  data.styleTags =
    Array.isArray(
      body.styleTags
    )
      ? body.styleTags
          .map((tag) =>
            String(
              tag || ""
            ).trim()
          )
          .filter(Boolean)
      : String(
          body.styleTags ||
            ""
        )
          .split(",")
          .map((tag) =>
            tag.trim()
          )
          .filter(Boolean);
}

if (
  body.occasionTags !==
  undefined
) {
  data.occasionTags =
    Array.isArray(
      body.occasionTags
    )
      ? body.occasionTags
          .map((tag) =>
            String(
              tag || ""
            ).trim()
          )
          .filter(Boolean)
      : String(
          body.occasionTags ||
            ""
        )
          .split(",")
          .map((tag) =>
            tag.trim()
          )
          .filter(Boolean);
}

      if (
        body.dimensions !==
        undefined
      ) {
        data.dimensions =
          normalizeNullableText(
            body.dimensions
          );
      }

      if (
        body.careInstructions !==
        undefined
      ) {
        data.careInstructions =
          normalizeNullableText(
            body.careInstructions
          );
      }

      if (
        body.specialNotes !==
        undefined
      ) {
        data.specialNotes =
          normalizeNullableText(
            body.specialNotes
          );
      }

      /* =================================================
         ACTIV / ASCUNS
      ================================================= */

      if (
        body.isActive !==
        undefined
      ) {
        data.isActive =
          normalizeBoolean(
            body.isActive,
            existing.isActive
          );
      }

      if (
        body.isHidden !==
        undefined
      ) {
        data.isHidden =
          normalizeBoolean(
            body.isHidden,
            existing.isHidden
          );
      }

      /* =================================================
         TIP COMANDĂ
      ================================================= */

      let finalOrderMode =
        String(
          existing.orderMode ||
           "DIRECT"
        ).toUpperCase();

      if (
        body.orderMode !==
        undefined
      ) {
        const orderMode =
          normalizeText(
            body.orderMode
          ).toUpperCase();

        const allowedModes = [
          "DIRECT",
          "OPTIONS",
          "QUOTE_ONLY",
        ];

        if (
          !allowedModes.includes(
            orderMode
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_order_mode",

              message:
                "Tipul de comandă nu este valid.",
            });
        }

        finalOrderMode =
          orderMode;

        data.orderMode =
          orderMode;
      }

      /* =================================================
         SCHEME PERSONALIZARE
      ================================================= */

      if (
        body.optionsSchema !==
        undefined
      ) {
        data.optionsSchema =
          normalizeArray(
            body.optionsSchema
          );
      }

      if (
        body.customSchema !==
        undefined
      ) {
        data.customSchema =
          normalizeArray(
            body.customSchema
          );
      }

      if (
        body.repeatedGroups !==
        undefined
      ) {
        data.repeatedGroups =
          normalizeArray(
            body.repeatedGroups
          );
      }

      if (
        body.quoteSchema !==
        undefined
      ) {
        data.quoteSchema =
          normalizeArray(
            body.quoteSchema
          );
      }

      /* =================================================
         REGULI DUPĂ orderMode
      ================================================= */

      if (
        finalOrderMode ===
        "DIRECT"
      ) {
        data.acceptsCustom =
          false;

        data.optionsSchema =
          [];

        data.customSchema =
          [];

        data.repeatedGroups =
          [];

        data.quoteSchema =
          [];
      }

      if (
        finalOrderMode ===
        "OPTIONS"
      ) {
        data.acceptsCustom =
          true;

        /*
         * Cererea de ofertă nu
         * aparține modului OPTIONS.
         */
        data.quoteSchema =
          [];
      }

      if (
        finalOrderMode ===
        "QUOTE_ONLY"
      ) {
        data.acceptsCustom =
          true;

        data.priceCents =
          0;

        data.optionsSchema =
          [];

        data.customSchema =
          [];

        data.repeatedGroups =
          [];
      }

      /*
       * Dacă frontend-ul trimite
       * explicit acceptsCustom,
       * îl respectăm doar dacă
       * modul permite asta.
       */
      if (
        body.acceptsCustom !==
          undefined &&
        finalOrderMode !==
        "DIRECT"
      ) {
        data.acceptsCustom =
          Boolean(
            body.acceptsCustom
          );
      }

      /* =================================================
         DISPONIBILITATE
      ================================================= */

      if (
        body.availability !==
        undefined
      ) {
        const availability =
          normalizeText(
            body.availability
          ).toUpperCase();

        const allowed =
          [
            "READY",
            "MADE_TO_ORDER",
            "PREORDER",
            "SOLD_OUT",
          ];

        if (
          !allowed.includes(
            availability
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_availability",

              message:
                "Disponibilitatea produsului nu este validă.",
            });
        }

        data.availability =
          availability;
      }

      /* =================================================
         TIMP EXECUȚIE
      ================================================= */

      if (
        body.leadTimeDays !==
        undefined
      ) {
        if (
          body.leadTimeDays ===
            null ||
          body.leadTimeDays ===
            ""
        ) {
          data.leadTimeDays =
            null;
        } else {
          const days =
            Number.parseInt(
              body.leadTimeDays,
              10
            );

          if (
            !Number.isFinite(
              days
            ) ||
            days < 1
          ) {
            return res
              .status(400)
              .json({
                error:
                  "invalid_lead_time",

                message:
                  "Timpul de execuție trebuie să fie de minimum o zi.",
              });
          }

          data.leadTimeDays =
            days;
        }
      }

      /* =================================================
         STOC
      ================================================= */

      if (
        body.readyQty !==
        undefined
      ) {
        if (
          body.readyQty ===
            null ||
          body.readyQty === ""
        ) {
          data.readyQty =
            null;
        } else {
          const qty =
            Number.parseInt(
              body.readyQty,
              10
            );

          if (
            !Number.isFinite(
              qty
            ) ||
            qty < 0
          ) {
            return res
              .status(400)
              .json({
                error:
                  "invalid_ready_qty",

                message:
                  "Cantitatea disponibilă nu este validă.",
              });
          }

          data.readyQty =
            qty;
        }
      }

      /* =================================================
         DATA PRECOMANDĂ
      ================================================= */

      if (
        body.nextShipDate !==
        undefined
      ) {
        if (
          body.nextShipDate ===
            null ||
          body.nextShipDate ===
            ""
        ) {
          data.nextShipDate =
            null;
        } else {
          const date =
            normalizeDateOrNull(
              body.nextShipDate
            );

          if (!date) {
            return res
              .status(400)
              .json({
                error:
                  "invalid_next_ship_date",

                message:
                  "Data estimată de livrare nu este validă.",
              });
          }

          data.nextShipDate =
            date;
        }
      }

      /* =================================================
         CURĂȚARE DUPĂ DISPONIBILITATE
      ================================================= */

      const finalAvailability =
        data.availability ||
        existing.availability ||
        "READY";

      if (
        finalAvailability ===
        "READY"
      ) {
        data.leadTimeDays =
          null;

        data.nextShipDate =
          null;
      }

      if (
        finalAvailability ===
        "MADE_TO_ORDER"
      ) {
        data.readyQty =
          null;

        data.nextShipDate =
          null;

        if (
          data.leadTimeDays ==
            null &&
          existing.leadTimeDays ==
            null
        ) {
          data.leadTimeDays =
            1;
        }
      }

      if (
        finalAvailability ===
        "PREORDER"
      ) {
        data.readyQty =
          null;

        data.leadTimeDays =
          null;
      }

      if (
        finalAvailability ===
        "SOLD_OUT"
      ) {
        data.readyQty =
          0;

        data.leadTimeDays =
          null;

        data.nextShipDate =
          null;
      }

      /* =================================================
         Nu avem nimic de modificat
      ================================================= */

      if (
        Object.keys(data)
          .length === 0
      ) {
        return res.json({
          ok: true,

          message:
            "Nu există modificări de salvat.",

          product:
            existing,
        });
      }

      /* =================================================
         UPDATE
      ================================================= */

      const updated =
        await prisma.product.update({
          where: {
            id: productId,
          },

          data,

          include: {
            service: {
              include: {
                type: true,

                vendor: {
                  select: {
                    id: true,
                    displayName: true,
                  },
                },

                profile: true,
              },
            },
          },
        });

      console.info(
        "[ADMIN PRODUCT UPDATE]",
        {
          productId:
            updated.id,

          adminUserId:
            req.user?.sub ||
            null,

          fields:
            Object.keys(data),
        }
      );

      return res.json({
        ok: true,

        message:
          "Produsul a fost actualizat.",

        product: {
          ...updated,

          /*
           * Pentru formularul frontend
           * este mai comod să avem și
           * prețul în lei.
           */
          price:
            Number(
              updated.priceCents ||
                0
            ) / 100,

          ownerVendorId:
            updated.service
              ?.vendorId ||
            null,
        },
      });
    } catch (error) {
      console.error(
        "PATCH /api/admin/products/:id error:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "admin_product_update_failed",

          message:
            "Produsul nu a putut fi actualizat.",
        });
    }
  }
);

export default router;