// src/routes/publicCampaignRoutes.js

import express from "express";

import {
  prisma,
} from "../db.js";

const router =
  express.Router();

/* =========================================================
   HELPERS
========================================================= */

function normalizeSlug(
  value
) {
  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .slice(
      0,
      160
    );
}

function getMainImage(
  images
) {
  if (
    !Array.isArray(
      images
    )
  ) {
    return "";
  }

  return (
    images.find(
      Boolean
    ) || ""
  );
}

function mapPublicProduct(
  product
) {
  return {
    id:
      product.id,

    title:
      product.title,

    description:
      product.description ||
      "",

    price:
      Number(
        product.priceCents ||
          0
      ) / 100,

    priceCents:
      Number(
        product.priceCents ||
          0
      ),

    currency:
      product.currency ||
      "RON",

    image:
      getMainImage(
        product.images
      ),

    images:
      Array.isArray(
        product.images
      )
        ? product.images
        : [],

    category:
      product.category ||
      "",

    availability:
      product.availability,

    readyQty:
      product.readyQty,

    orderMode:
      product.orderMode,

    acceptsCustom:
      !!product.acceptsCustom,

    store:
      product.service
        ? {
            id:
              product.service.id,

            title:
              product.service.title ||
              product.service
                .profile
                ?.displayName ||
              "",

            slug:
              product.service
                .profile
                ?.slug ||
              null,

            displayName:
              product.service
                .profile
                ?.displayName ||
              product.service.title ||
              "",

            logoUrl:
              product.service
                .profile
                ?.logoUrl ||
              null,

            coverUrl:
              product.service
                .profile
                ?.coverUrl ||
              null,
          }
        : null,
  };
}

/* =========================================================
   GET /:slug

   Exemplu:
   GET /api/public/campaigns/instagram-august-ab12cd

   Returnează:
   - campania;
   - vendorul;
   - magazinele vendorului;
   - produsele eligibile campaniei.

   Nu necesită autentificare.
========================================================= */

router.get(
  "/:slug",

  async (
    req,
    res
  ) => {
    try {
      const slug =
        normalizeSlug(
          req.params?.slug
        );

      if (!slug) {
        return res
          .status(400)
          .json({
            error:
              "campaign_slug_required",

            message:
              "Campania nu a fost specificată.",
          });
      }

      const now =
        new Date();

      /*
       * Căutăm campania după slug.
       *
       * Luăm inclusiv campaniile inactive/expirate
       * ca să putem întoarce un mesaj mai bun.
       */
      const campaign =
        await prisma.vendorCampaign.findUnique({
          where: {
            slug,
          },

          select: {
            id: true,

            vendorId: true,

            name: true,

            slug: true,

            isActive:
              true,

            scope:
              true,

            discountPercent:
              true,

            attributionWindowHours:
              true,

            startsAt:
              true,

            endsAt:
              true,

            createdAt:
              true,

            vendor: {
              select: {
                id: true,

                displayName:
                  true,

                about:
                  true,

                logoUrl:
                  true,

                coverUrl:
                  true,

                city:
                  true,

                website:
                  true,

                isActive:
                  true,

                services: {
                  where: {
                    isActive:
                      true,
                  },

                  select: {
                    id: true,

                    title: true,

                    description:
                      true,

                    profile: {
                      select: {
                        slug: true,

                        displayName:
                          true,

                        logoUrl:
                          true,

                        coverUrl:
                          true,

                        shortDescription:
                          true,

                        about:
                          true,

                        city:
                          true,
                      },
                    },
                  },
                },
              },
            },

            products: {
              select: {
                productId:
                  true,
              },
            },
          },
        });

      if (!campaign) {
        return res
          .status(404)
          .json({
            error:
              "campaign_not_found",

            message:
              "Campania nu există.",
          });
      }

      /*
       * Vendorul trebuie să fie activ.
       */
      if (
        campaign.vendor
          ?.isActive ===
        false
      ) {
        return res
          .status(404)
          .json({
            error:
              "campaign_unavailable",

            message:
              "Această campanie nu mai este disponibilă.",
          });
      }

      /*
       * Campania poate fi oprită manual.
       */
      if (
        !campaign.isActive
      ) {
        return res
          .status(404)
          .json({
            error:
              "campaign_inactive",

            message:
              "Această campanie este momentan oprită.",
          });
      }

      /*
       * Dacă începe în viitor,
       * încă nu este disponibilă.
       */
      if (
        campaign.startsAt &&
        campaign.startsAt >
          now
      ) {
        return res
          .status(404)
          .json({
            error:
              "campaign_not_started",

            message:
              "Această campanie nu a început încă.",
          });
      }

      /*
       * Dacă a expirat.
       */
      if (
        campaign.endsAt &&
        campaign.endsAt <=
          now
      ) {
        return res
          .status(404)
          .json({
            error:
              "campaign_expired",

            message:
              "Această campanie s-a încheiat.",
          });
      }

      const selectedProductIds =
        Array.isArray(
          campaign.products
        )
          ? campaign.products
              .map(
                (item) =>
                  item.productId
              )
              .filter(Boolean)
          : [];

      /*
       * Produsele trebuie:
       * - să fie ale vendorului campaniei;
       * - active;
       * - neascunse;
       * - aprobate.
       */
      const productWhere = {
        isActive:
          true,

        isHidden:
          false,

        moderationStatus:
          "APPROVED",

        service: {
          vendorId:
            campaign.vendorId,

          isActive:
            true,
        },
      };

      /*
       * Pentru SELECTED_PRODUCTS
       * restrângem lista.
       */
      if (
        campaign.scope ===
        "SELECTED_PRODUCTS"
      ) {
        productWhere.id = {
          in:
            selectedProductIds,
        };
      }

      const products =
        await prisma.product.findMany({
          where:
            productWhere,

          orderBy: {
            createdAt:
              "desc",
          },

          select: {
            id: true,

            title: true,

            description:
              true,

            priceCents:
              true,

            currency:
              true,

            images:
              true,

            category:
              true,

            availability:
              true,

            readyQty:
              true,

            orderMode:
              true,

            acceptsCustom:
              true,

            createdAt:
              true,

            service: {
              select: {
                id: true,

                title: true,

                profile: {
                  select: {
                    slug: true,

                    displayName:
                      true,

                    logoUrl:
                      true,

                    coverUrl:
                      true,
                  },
                },
              },
            },
          },
        });

      /*
       * Incrementăm vizita.
       *
       * Este intenționat non-blocking:
       * dacă incrementarea statisticii pică,
       * pagina campaniei trebuie totuși să se încarce.
       */
      prisma.vendorCampaign
        .update({
          where: {
            id:
              campaign.id,
          },

          data: {
            visits: {
              increment:
                1,
            },
          },
        })
        .catch(
          (error) => {
            console.error(
              "[public-campaign] increment visit:",
              error
            );
          }
        );

      return res.json({
        campaign: {
          id:
            campaign.id,

          name:
            campaign.name,

          slug:
            campaign.slug,

          scope:
            campaign.scope,

          discountPercent:
            campaign.discountPercent,

          attributionWindowHours:
            campaign.attributionWindowHours,

          startsAt:
            campaign.startsAt,

          endsAt:
            campaign.endsAt,

          createdAt:
            campaign.createdAt,
        },

        vendor: {
          id:
            campaign.vendor.id,

          displayName:
            campaign.vendor
              .displayName,

          about:
            campaign.vendor
              .about ||
            "",

          logoUrl:
            campaign.vendor
              .logoUrl ||
            null,

          coverUrl:
            campaign.vendor
              .coverUrl ||
            null,

          city:
            campaign.vendor
              .city ||
            null,

          website:
            campaign.vendor
              .website ||
            null,

          services:
            Array.isArray(
              campaign.vendor
                .services
            )
              ? campaign.vendor
                  .services
                  .map(
                    (
                      service
                    ) => ({
                      id:
                        service.id,

                      title:
                        service.title ||
                        service.profile
                          ?.displayName ||
                        "",

                      description:
                        service.description ||
                        "",

                      slug:
                        service.profile
                          ?.slug ||
                        null,

                      displayName:
                        service.profile
                          ?.displayName ||
                        service.title ||
                        "",

                      logoUrl:
                        service.profile
                          ?.logoUrl ||
                        null,

                      coverUrl:
                        service.profile
                          ?.coverUrl ||
                        null,

                      shortDescription:
                        service.profile
                          ?.shortDescription ||
                        "",

                      about:
                        service.profile
                          ?.about ||
                        "",

                      city:
                        service.profile
                          ?.city ||
                        null,
                    })
                  )
              : [],
        },

        products:
          products.map(
            mapPublicProduct
          ),

        meta: {
          productsCount:
            products.length,

          /*
           * Important pentru etapa următoare:
           * frontend-ul va folosi asta
           * ca să știe cât timp poate păstra
           * atribuirea campaniei.
           */
          attributionWindowHours:
            campaign.attributionWindowHours,
        },
      });
    } catch (error) {
      console.error(
        "[public-campaign] load:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "campaign_load_failed",

          message:
            "Campania nu a putut fi încărcată.",
        });
    }
  }
);

export default router;