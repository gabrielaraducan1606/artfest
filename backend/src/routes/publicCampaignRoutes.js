// src/routes/publicCampaignRoutes.js

import express from "express";

import {
  prisma,
} from "../db.js";

import {
  signCampaignAttributionToken,
} from "../services/campaignAttributionToken.js";

import {
  getPromotionPricingForProducts,
  applyPromotionPricingToProduct,
  campaignToPromotion,
} from "../services/productPromotionPrice.js";

import {
  resolveVendorCampaignAttributions,
} from "../services/campaignAttribution.js";

const router =
  express.Router();

/* =========================================================
   HELPERS
========================================================= */

/*
 * GET nu poate trimite un body JSON, așa că atribuirea de
 * campanie vine ca query string (JSON encodat) - la fel ca la
 * GET /checkout/summary și GET /cart. Parsare defensivă -
 * orice eșec => fără atribuire, niciodată eroare.
 */
function parseCampaignAttributionQuery(raw) {
  if (!raw || typeof raw !== "string") return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

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

    /*
     * Preț - aceeași sursă de adevăr ca homepage/profil
     * magazin/coș/checkout: getPromotionPricingForProducts +
     * applyPromotionPricingToProduct (productPromotionPrice.js).
     * product.priceCents e deja prețul FINAL (după reducere,
     * dacă există) - vezi apelul applyPromotionPricingToProduct
     * mai jos, înainte de mapPublicProduct.
     */
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

    finalPriceCents:
      product.finalPriceCents ??
      Number(
        product.priceCents ||
          0
      ),

    originalPriceCents:
      product.originalPriceCents ??
      null,

    hasDiscount:
      !!product.hasDiscount,

    discountPercent:
      Number(
        product.totalDiscountPercent ||
          product.discountPercent ||
          0
      ),

    totalDiscountPercent:
      Number(
        product.totalDiscountPercent ||
          0
      ),

    promoLabel:
      product.promoLabel ||
      null,

    discount:
      product.discount ||
      null,

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

isActive:
  product.isActive !== false,

isHidden:
  !!product.isHidden,

moderationStatus:
  product.moderationStatus ||
  "APPROVED",

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
   GET /store/:storeSlug

   Exemplu:
   GET /api/public/campaigns/store/atelierul-meu
     ?campaignAttribution={"<vendorId>":"<token>"}

   NU e un endpoint de descoperire - nu returnează "toate
   campaniile active" ale vendorului. Returnează DOAR campania
   pentru care vizitatorul curent are o atribuire VALIDĂ pentru
   ACEST vendor (token semnat, revalidat fresh din DB: campanie
   activă, vendor activ, în interval) - cel mult 1 element în
   `items`. Fără atribuire validă => `items: []`.

   IMPORTANT:
   - nu incrementează visits (asta se face doar la accesarea
     directă a /:slug);
   - nu expune statistici private;
   - nu necesită autentificare;
   - validarea atribuirii e strict server-side, niciodată doar
     pe baza a ce trimite clientul fără verificare.
========================================================= */

router.get(
  "/store/:storeSlug",

  async (
    req,
    res
  ) => {
    try {
      const storeSlug =
        normalizeSlug(
          req.params?.storeSlug
        );

      if (!storeSlug) {
        return res
          .status(400)
          .json({
            error:
              "store_slug_required",

            message:
              "Magazinul nu a fost specificat.",
          });
      }

      /*
       * Identificăm magazinul după slug-ul
       * profilului public.
       */
    const service =
  await prisma.vendorService.findFirst({
    where: {
      isActive: true,

      profile: {
        is: {
          slug: storeSlug,
        },
      },
    },

    select: {
      id: true,
      vendorId: true,
      title: true,

      profile: {
        select: {
          slug: true,
          displayName: true,
          logoUrl: true,
          coverUrl: true,
        },
      },

      vendor: {
        select: {
          id: true,
          isActive: true,
        },
      },
    },
  });

      if (
        !service ||
        !service.vendorId ||
        service.vendor
          ?.isActive ===
          false
      ) {
        return res
          .status(404)
          .json({
            error:
              "store_not_found",

            message:
              "Magazinul nu a fost găsit.",
          });
      }

      /*
       * REGULĂ: profilul public NU e loc de descoperire pentru
       * campanii - nu afișăm "toate campaniile active" ale
       * vendorului către orice vizitator. Afișăm DOAR campania
       * pentru care vizitatorul are o atribuire VALIDĂ, server-
       * side (nu doar pentru că există ceva în localStorage).
       *
       * Fără token pentru acest vendor => fără campanie afișată,
       * fără niciun query suplimentar către VendorCampaign.
       */
      const campaignAttributionQuery =
        parseCampaignAttributionQuery(
          req.query?.campaignAttribution
        );

      const attributionsByVendorId =
        await resolveVendorCampaignAttributions({
          vendorIds: [
            service.vendorId,
          ],

          tokensByVendorId:
            campaignAttributionQuery,
        });

      const attribution =
        attributionsByVendorId.get(
          service.vendorId
        );

      const items = [];

      if (attribution) {
        /*
         * resolveVendorCampaignAttributions a revalidat deja
         * fresh din DB (campanie activă, vendor activ, în
         * interval de valabilitate) - mai citim aici doar
         * câmpurile necesare pentru cardul din profil.
         */
        const campaign =
          await prisma.vendorCampaign.findUnique({
            where: {
              id:
                attribution.campaignId,
            },

            select: {
              id:
                true,

              name:
                true,

              slug:
                true,

              scope:
                true,

              discountPercent:
                true,

              startsAt:
                true,

              endsAt:
                true,

              createdAt:
                true,

              products: {
                select: {
                  productId:
                    true,
                },
              },
            },
          });

        if (campaign) {
          const selectedIds =
            Array.isArray(
              campaign.products
            )
              ? campaign.products
                  .map(
                    (item) =>
                      item.productId
                  )
                  .filter(
                    Boolean
                  )
              : [];

          const productsCount =
            campaign.scope ===
            "SELECTED_PRODUCTS"
              ? selectedIds.length
              : await prisma.product.count(
                  {
                    where: {
                      isActive:
                        true,

                      isHidden:
                        false,

                      moderationStatus:
                        "APPROVED",

                      service: {
                        vendorId:
                          service.vendorId,

                        isActive:
                          true,
                      },
                    },
                  }
                );

          items.push({
            id:
              campaign.id,

            name:
              campaign.name,

            slug:
              campaign.slug,

            publicPath:
              `/c/${campaign.slug}`,

            scope:
              campaign.scope,

            discountPercent:
              campaign.discountPercent,

            productsCount,

            startsAt:
              campaign.startsAt,

            endsAt:
              campaign.endsAt,

            createdAt:
              campaign.createdAt,
          });
        }
      }

      return res.json({
        store: {
          id:
            service.id,

          slug:
            service.profile
              ?.slug ||
            storeSlug,

          name:
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
        },

        items,

        total:
          items.length,
      });
    } catch (error) {
      console.error(
        "[public-campaigns] store list:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "store_campaigns_load_failed",

          message:
            "Colecțiile magazinului nu au putut fi încărcate.",
        });
    }
  }
);

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
            id:
              true,

            vendorId:
              true,

            name:
              true,

            slug:
              true,

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
                id:
                  true,

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
                    id:
                      true,

                    title:
                      true,

                    description:
                      true,

                    profile: {
                      select: {
                        slug:
                          true,

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
            id:
              true,

            title:
              true,

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

isActive:
  true,

isHidden:
  true,

moderationStatus:
  true,

createdAt:
  true,

            service: {
              select: {
                id:
                  true,

                title:
                  true,

                profile: {
                  select: {
                    slug:
                      true,

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
       * Preț - reutilizăm EXACT engine-ul folosit de
       * homepage/profil magazin/coș/checkout
       * (getPromotionPricingForProducts), nu recalculăm
       * separat aici.
       *
       * Toate produsele din `products` sunt deja filtrate mai
       * sus prin `productWhere` să respecte scope-ul campaniei
       * (ALL_PRODUCTS sau doar `selectedProductIds` pentru
       * SELECTED_PRODUCTS) - deci fiecare produs de aici e deja
       * eligibil, fără filtrare suplimentară.
       */
      const campaignPromotion =
        campaignToPromotion({
          discountPercent:
            campaign.discountPercent,
          campaignName:
            campaign.name,
        });

      const campaignPromotionsByProductId =
        new Map();

      if (campaignPromotion) {
        for (
          const product of
          products
        ) {
          campaignPromotionsByProductId.set(
            product.id,
            campaignPromotion
          );
        }
      }

      const pricingByProductId =
        await getPromotionPricingForProducts(
          products,
          {
            campaignPromotionsByProductId,
          }
        );

      const pricedProducts =
        products.map(
          (product) =>
            applyPromotionPricingToProduct(
              product,
              pricingByProductId.get(
                product.id
              )
            )
        );

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

      /*
       * Token de atribuire - dovedește la checkout că
       * link-ul a fost chiar accesat prin acest server,
       * pentru ACEST vendor/campanie. Checkout-ul îl
       * revalidează oricum fresh din DB, tokenul doar
       * previne ca un client să pretindă o atribuire
       * fără să fi accesat vreodată link-ul.
       */
      const attributionToken =
        signCampaignAttributionToken({
          campaignId: campaign.id,
          vendorId: campaign.vendorId,
          slug: campaign.slug,
          attributionWindowHours:
            campaign.attributionWindowHours,
        });

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

          attributionToken,
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
          pricedProducts.map(
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