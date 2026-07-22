// backend/src/routes/vendor/vendorQuotesRoutes.js

import {
  Router,
} from "express";

import {
  prisma,
} from "../../../db.js";

import {
  authRequired,
  enforceTokenVersion,
} from "../../../api/auth.js";

import {
  vendorAccessRequired,
} from "../../../lib/vendorProductAccess.js";

import {
  createUserNotification,
} from "../../../services/notifications.js";

import {
  moderateMarketplaceMessage,
} from "../../../services/marketplaceMessageModeration.js";

const router =
  Router();

/* =========================================================
   Protecție rute vendor
========================================================= */

router.use(
  authRequired,
  enforceTokenVersion,
  vendorAccessRequired
);

/* =========================================================
   Constante
========================================================= */

const TERMINAL_QUOTE_STATUSES =
  new Set([
    "ACCEPTED",
    "REJECTED",
    "CANCELLED",
    "EXPIRED",
  ]);

const OFFER_MUTABLE_QUOTE_STATUSES =
  new Set([
    "SUBMITTED",
    "IN_DISCUSSION",
    "OFFER_SENT",
  ]);

/* =========================================================
   Helpers
========================================================= */

async function getCurrentVendor(
  req
) {
  /*
   * vendorAccessRequired nu setează întotdeauna
   * req.meVendor dacă userul are deja role=VENDOR,
   * așa că facem fallback după userId.
   */

  if (
    req.meVendor?.id
  ) {
    return req.meVendor;
  }

  return prisma.vendor.findUnique({
    where: {
      userId:
        req.user.sub,
    },

    select: {
      id:
        true,

      userId:
        true,

      displayName:
        true,
    },
  });
}

/* =========================================================
   Helpers numerice
========================================================= */

function parsePositiveInteger(
  value
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(
      number
    ) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

function parseNonNegativeMoney(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    ) ||
    number < 0
  ) {
    return null;
  }

  /*
   * Rotunjire defensivă la
   * două zecimale.
   */
  return Math.round(
    number * 100
  ) / 100;
}

function parseOptionalPositiveInteger(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  return parsePositiveInteger(
    value
  );
}

function parseOptionalDate(
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

function normalizeCurrency(
  value
) {
  const currency =
    String(
      value ||
        "RON"
    )
      .trim()
      .toUpperCase();

  if (
    !/^[A-Z]{3}$/.test(
      currency
    )
  ) {
    return null;
  }

  return currency;
}

function decimalToNumber(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

/* =========================================================
   Serializare ofertă
========================================================= */

function serializeQuoteOffer(
  offer
) {
  if (!offer) {
    return null;
  }

  return {
    id:
      offer.id,

    quoteRequestId:
      offer.quoteRequestId,

    status:
      offer.status,

    items:
      Array.isArray(
        offer.items
      )
        ? offer.items
        : offer.items ||
          [],

    subtotal:
      decimalToNumber(
        offer.subtotal
      ),

    shippingTotal:
      decimalToNumber(
        offer.shippingTotal
      ),

    total:
      decimalToNumber(
        offer.total
      ),

    currency:
      offer.currency,

    productionDays:
      offer.productionDays,

    estimatedDelivery:
      offer.estimatedDelivery,

    validUntil:
      offer.validUntil,

    notes:
      offer.notes,

    createdAt:
      offer.createdAt,

    updatedAt:
      offer.updatedAt,
  };
}

/* =========================================================
   Serializare cerere vendor
========================================================= */

function serializeVendorQuote(
  quote
) {
  const customerName =
    [
      quote.user
        ?.firstName,

      quote.user
        ?.lastName,
    ]
      .filter(
        Boolean
      )
      .join(
        " "
      )
      .trim();

  return {
    id:
      quote.id,

    quoteRequestId:
      quote.id,

    status:
      quote.status,

    source:
      quote.source,

    quantity:
      quote.quantity,

    requestData:
      quote.requestData ||
      {},

    quoteSchemaAnswers:
      quote.quoteSchemaAnswers ||
      {},

    eventDate:
      quote.eventDate,

    deliveryDeadline:
      quote.deliveryDeadline,

    budgetMin:
      quote.budgetMin,

    budgetMax:
      quote.budgetMax,

    createdAt:
      quote.createdAt,

    updatedAt:
      quote.updatedAt,

    threadId:
      quote.threadId ||
      null,

    orderId:
      quote.orderId ||
      null,

    customerName:
      customerName ||
      "Client",

    product:
      quote.product
        ? {
            id:
              quote.product.id,

            title:
              quote.product.title,

            images:
              quote.product.images ||
              [],

            orderMode:
              quote.product.orderMode,

            quoteSchema:
              quote.product.quoteSchema ||
              [],
          }
        : null,

    store:
      quote.service
        ? {
            id:
              quote.service.id,

            title:
              quote.service.title,

            displayName:
              quote.service.profile
                ?.displayName ||
              quote.service.title ||
              null,

            slug:
              quote.service.profile
                ?.slug ||
              null,

            logoUrl:
              quote.service.profile
                ?.logoUrl ||
              null,
          }
        : null,

    offers:
      Array.isArray(
        quote.offers
      )
        ? quote.offers.map(
            serializeQuoteOffer
          )
        : [],
  };
}

/* =========================================================
   Helper — verificare cerere vendor
========================================================= */

async function findVendorQuote({
  quoteId,
  vendorId,
  include = {},
}) {
  return prisma.quoteRequest.findFirst({
    where: {
      id:
        quoteId,

      vendorId,
    },

    include,
  });
}

/* =========================================================
   Helper — moderare text ofertă
========================================================= */

async function moderateOfferNotes(
  notes
) {
  const normalized =
    String(
      notes ||
        ""
    ).trim();

  if (!normalized) {
    return {
      allowed:
        true,

      notes:
        null,
    };
  }

  const moderation =
    await moderateMarketplaceMessage({
      text:
        normalized,

      senderType:
        "VENDOR",
    });

  if (
    !moderation.allowed
  ) {
    return {
      allowed:
        false,

      reason:
        moderation.reason ||
        "not_allowed",

      notes:
        normalized,
    };
  }

  return {
    allowed:
      true,

    notes:
      normalized,
  };
}

/* =========================================================
   GET /api/vendor/quotes

   Lista cererilor primite de vendor.
========================================================= */

router.get(
  "/",

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getCurrentVendor(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",

            message:
              "Profilul de vânzător nu a fost găsit.",
          });
      }

      const quotes =
        await prisma.quoteRequest.findMany({
          where: {
            vendorId:
              vendor.id,
          },

          orderBy: {
            updatedAt:
              "desc",
          },

          include: {
            user: {
              select: {
                id:
                  true,

                firstName:
                  true,

                lastName:
                  true,
              },
            },

            product: {
              select: {
                id:
                  true,

                title:
                  true,

                images:
                  true,

                orderMode:
                  true,

                quoteSchema:
                  true,
              },
            },

            service: {
              select: {
                id:
                  true,

                title:
                  true,

                profile: {
                  select: {
                    displayName:
                      true,

                    slug:
                      true,

                    logoUrl:
                      true,
                  },
                },
              },
            },

            offers: {
              orderBy: {
                createdAt:
                  "desc",
              },
            },
          },
        });

      return res.json({
        items:
          quotes.map(
            serializeVendorQuote
          ),
      });
    } catch (
      error
    ) {
      console.error(
        "GET /api/vendor/quotes failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_quotes_read_failed",

          message:
            "Nu am putut încărca cererile de ofertă.",
        });
    }
  }
);

/* =========================================================
   GET /api/vendor/quotes/:id/offers

   Lista ofertelor pentru o cerere.
========================================================= */

router.get(
  "/:id/offers",

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getCurrentVendor(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",

            message:
              "Profilul de vânzător nu a fost găsit.",
          });
      }

      const quoteId =
        String(
          req.params.id ||
            ""
        ).trim();

      if (!quoteId) {
        return res
          .status(400)
          .json({
            error:
              "quote_id_required",

            message:
              "ID-ul cererii de ofertă lipsește.",
          });
      }

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              quoteId,

            vendorId:
              vendor.id,
          },

          select: {
            id:
              true,
          },
        });

      if (!quote) {
        return res
          .status(404)
          .json({
            error:
              "quote_request_not_found",

            message:
              "Cererea de ofertă nu a fost găsită.",
          });
      }

      const offers =
        await prisma.quoteOffer.findMany({
          where: {
            quoteRequestId:
              quote.id,
          },

          orderBy: {
            createdAt:
              "desc",
          },
        });

      return res.json({
        items:
          offers.map(
            serializeQuoteOffer
          ),
      });
    } catch (
      error
    ) {
      console.error(
        "GET /api/vendor/quotes/:id/offers failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_quote_offers_read_failed",

          message:
            "Nu am putut încărca ofertele.",
        });
    }
  }
);

/* =========================================================
   POST /api/vendor/quotes/:id/offers

   Vendorul trimite o ofertă structurată.

   Acceptă două formate:

   1. Formatul simplu folosit momentan de frontend:
      {
        quantity,
        unitPrice,
        shippingPrice,
        currency,
        productionDays,
        validUntil,
        notes
      }

   2. Format avansat:
      {
        items: [...],
        shippingTotal,
        currency,
        productionDays,
        estimatedDelivery,
        validUntil,
        notes
      }

   Totalurile sunt calculate pe server.
========================================================= */

router.post(
  "/:id/offers",

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getCurrentVendor(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",

            message:
              "Profilul de vânzător nu a fost găsit.",
          });
      }

      const quoteId =
        String(
          req.params.id ||
            ""
        ).trim();

      if (!quoteId) {
        return res
          .status(400)
          .json({
            error:
              "quote_id_required",

            message:
              "ID-ul cererii de ofertă lipsește.",
          });
      }

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              quoteId,

            vendorId:
              vendor.id,
          },

          select: {
            id:
              true,

            userId:
              true,

            vendorId:
              true,

            productId:
              true,

            quantity:
              true,

            status:
              true,

            orderId:
              true,

            threadId:
              true,

            product: {
              select: {
                id:
                  true,

                title:
                  true,

                images:
                  true,
              },
            },
          },
        });

      if (!quote) {
        return res
          .status(404)
          .json({
            error:
              "quote_request_not_found",

            message:
              "Cererea de ofertă nu a fost găsită.",
          });
      }

      if (
        quote.orderId ||
        TERMINAL_QUOTE_STATUSES.has(
          quote.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "quote_closed",

            message:
              "Această cerere de ofertă este închisă și nu mai poate primi oferte.",
          });
      }

      if (
        !OFFER_MUTABLE_QUOTE_STATUSES.has(
          quote.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "quote_not_ready_for_offer",

            message:
              "Cererea nu este într-o stare care permite trimiterea unei oferte.",
          });
      }

      const currency =
        normalizeCurrency(
          req.body?.currency
        );

      if (!currency) {
        return res
          .status(400)
          .json({
            error:
              "invalid_currency",

            message:
              "Moneda ofertei nu este validă.",
          });
      }

      const productionDays =
        parseOptionalPositiveInteger(
          req.body
            ?.productionDays
        );

      if (
        req.body
          ?.productionDays !==
          null &&
        req.body
          ?.productionDays !==
          undefined &&
        req.body
          ?.productionDays !==
          "" &&
        productionDays ===
          null
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_production_days",

            message:
              "Numărul de zile de producție nu este valid.",
          });
      }

      const estimatedDelivery =
        parseOptionalDate(
          req.body
            ?.estimatedDelivery
        );

      if (
        req.body
          ?.estimatedDelivery &&
        !estimatedDelivery
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_estimated_delivery",

            message:
              "Data estimată de livrare nu este validă.",
          });
      }

      const validUntil =
        parseOptionalDate(
          req.body
            ?.validUntil
        );

      if (
        req.body
          ?.validUntil &&
        !validUntil
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_valid_until",

            message:
              "Data de expirare a ofertei nu este validă.",
          });
      }

      if (
        validUntil &&
        validUntil.getTime() <=
          Date.now()
      ) {
        return res
          .status(400)
          .json({
            error:
              "offer_expiry_in_past",

            message:
              "Data de valabilitate a ofertei trebuie să fie în viitor.",
          });
      }

      const moderatedNotes =
        await moderateOfferNotes(
          req.body?.notes
        );
if (
  !moderatedNotes.allowed
) {
  const technicalReasons =
    new Set([
      "text_moderation_failed",
      "text_moderation_invalid_response",
      "text_moderation_ambiguous_response",
    ]);

  const isTechnicalError =
    technicalReasons.has(
      moderatedNotes.reason
    );

  return res
    .status(
      isTechnicalError
        ? 503
        : 422
    )
    .json({
      error:
        isTechnicalError
          ? "moderation_unavailable"
          : "offer_notes_blocked",

      reason:
        moderatedNotes.reason ||
        "not_allowed",

      message:
        isTechnicalError
          ? "Detaliile ofertei nu au putut fi verificate momentan. Încearcă din nou peste câteva secunde."
          : "Detaliile ofertei nu pot conține sau sugera date de contact, comunicare ori plată în afara platformei.",
    });
}

      let items =
        [];

      let subtotal =
        0;

      /*
       * ===================================================
       * FORMAT AVANSAT — items[]
       * ===================================================
       */

      if (
        Array.isArray(
          req.body?.items
        ) &&
        req.body.items.length >
          0
      ) {
        for (
          const rawItem
          of req.body.items
        ) {
          const quantity =
            parsePositiveInteger(
              rawItem
                ?.quantity
            );

          const unitPrice =
            parseNonNegativeMoney(
              rawItem
                ?.unitPrice
            );

          if (
            quantity ===
              null ||
            unitPrice ===
              null
          ) {
            return res
              .status(400)
              .json({
                error:
                  "invalid_offer_item",

                message:
                  "Unul dintre produsele ofertei are cantitatea sau prețul invalid.",
              });
          }

          const lineTotal =
            Math.round(
              quantity *
                unitPrice *
                100
            ) /
            100;

          items.push({
            productId:
              rawItem
                ?.productId ||
              quote.productId ||
              null,

            title:
              String(
                rawItem
                  ?.title ||
                  quote.product
                    ?.title ||
                  "Produs"
              ).trim(),

            quantity,

            unitPrice,

            lineTotal,
          });

          subtotal +=
            lineTotal;
        }
      } else {
        /*
         * =================================================
         * FORMAT SIMPLU — quantity + unitPrice
         * =================================================
         */

        const quantity =
          parsePositiveInteger(
            req.body
              ?.quantity ??
              quote.quantity
          );

        const unitPrice =
          parseNonNegativeMoney(
            req.body
              ?.unitPrice
          );

        if (
          quantity ===
          null
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_quantity",

              message:
                "Cantitatea ofertei trebuie să fie un număr întreg mai mare decât 0.",
            });
        }

        if (
          unitPrice ===
          null
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_unit_price",

              message:
                "Prețul unitar nu este valid.",
            });
        }

        const lineTotal =
          Math.round(
            quantity *
              unitPrice *
              100
          ) /
          100;

        items = [
          {
            productId:
              quote.productId ||
              null,

            title:
              quote.product
                ?.title ||
              "Produs",

            quantity,

            unitPrice,

            lineTotal,
          },
        ];

        subtotal =
          lineTotal;
      }

      subtotal =
        Math.round(
          subtotal *
            100
        ) /
        100;

      const shippingTotal =
        parseNonNegativeMoney(
          req.body
            ?.shippingTotal ??
            req.body
              ?.shippingPrice ??
            0
        );

      if (
        shippingTotal ===
        null
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_shipping_total",

            message:
              "Costul transportului nu este valid.",
          });
      }

      const total =
        Math.round(
          (
            subtotal +
            shippingTotal
          ) *
            100
        ) /
        100;

      /*
       * Creăm oferta și supersedăm
       * orice ofertă SENT anterioară.
       */

      const offer =
        await prisma.$transaction(
          async (
            tx
          ) => {
            await tx.quoteOffer.updateMany({
              where: {
                quoteRequestId:
                  quote.id,

                status:
                  "SENT",
              },

              data: {
                status:
                  "SUPERSEDED",
              },
            });

            const created =
              await tx.quoteOffer.create({
                data: {
                  quoteRequestId:
                    quote.id,

                  status:
                    "SENT",

                  items,

                  subtotal,

                  shippingTotal,

                  total,

                  currency,

                  productionDays,

                  estimatedDelivery,

                  validUntil,

                  notes:
                    moderatedNotes.notes,
                },
              });

            await tx.quoteRequest.update({
              where: {
                id:
                  quote.id,
              },

              data: {
                status:
                  "OFFER_SENT",
              },
            });

            if (
              quote.threadId
            ) {
              await tx.messageThread.updateMany({
                where: {
                  id:
                    quote.threadId,
                },

                data: {
                  leadStatus:
                    "OFFER_SENT",
                },
              });
            }

            return created;
          }
        );

      /*
       * Notificăm clientul.
       */

      try {
        await createUserNotification(
          quote.userId,
          {
            type:
              "message",

            title:
              "Ai primit o ofertă nouă",

            body:
              `Vânzătorul ți-a trimis o ofertă de ${total.toFixed(
                2
              )} ${currency}.`,

            link:
              `/?assistant=quote&quoteId=${quote.id}`,
          }
        );
      } catch (
        notificationError
      ) {
        console.error(
          "Quote offer user notification failed:",
          notificationError
        );
      }

      return res
        .status(201)
        .json({
          ok:
            true,

          offer:
            serializeQuoteOffer(
              offer
            ),
        });
    } catch (
      error
    ) {
      console.error(
        "POST /api/vendor/quotes/:id/offers failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_quote_offer_create_failed",

          message:
            "Oferta nu a putut fi trimisă.",
        });
    }
  }
);

/* =========================================================
   POST /api/vendor/quotes/:id/offers/:offerId/withdraw

   În schema actuală nu există WITHDRAWN.
   Folosim SUPERSEDED pentru oferta retrasă.
========================================================= */

router.post(
  "/:id/offers/:offerId/withdraw",

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getCurrentVendor(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",

            message:
              "Profilul de vânzător nu a fost găsit.",
          });
      }

      const quoteId =
        String(
          req.params.id ||
            ""
        ).trim();

      const offerId =
        String(
          req.params.offerId ||
            ""
        ).trim();

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              quoteId,

            vendorId:
              vendor.id,
          },

          select: {
            id:
              true,

            status:
              true,

            orderId:
              true,

            userId:
              true,

            threadId:
              true,
          },
        });

      if (!quote) {
        return res
          .status(404)
          .json({
            error:
              "quote_request_not_found",

            message:
              "Cererea de ofertă nu a fost găsită.",
          });
      }

      if (
        quote.orderId ||
        quote.status ===
          "ACCEPTED"
      ) {
        return res
          .status(409)
          .json({
            error:
              "accepted_quote_cannot_change",

            message:
              "Oferta nu mai poate fi retrasă deoarece cererea a fost deja acceptată.",
          });
      }

      const offer =
        await prisma.quoteOffer.findFirst({
          where: {
            id:
              offerId,

            quoteRequestId:
              quote.id,
          },
        });

      if (!offer) {
        return res
          .status(404)
          .json({
            error:
              "quote_offer_not_found",

            message:
              "Oferta nu a fost găsită.",
          });
      }

      if (
        offer.status !==
        "SENT"
      ) {
        return res
          .status(409)
          .json({
            error:
              "offer_not_withdrawable",

            message:
              "Doar o ofertă activă poate fi retrasă.",
          });
      }

      const result =
        await prisma.$transaction(
          async (
            tx
          ) => {
            const updatedOffer =
              await tx.quoteOffer.update({
                where: {
                  id:
                    offer.id,
                },

                data: {
                  status:
                    "SUPERSEDED",
                },
              });

            /*
             * Verificăm dacă mai există
             * vreo ofertă activă.
             */

            const remainingActiveOffers =
              await tx.quoteOffer.count({
                where: {
                  quoteRequestId:
                    quote.id,

                  status:
                    "SENT",
                },
              });

            if (
              remainingActiveOffers ===
              0
            ) {
              await tx.quoteRequest.update({
                where: {
                  id:
                    quote.id,
                },

                data: {
                  status:
                    "IN_DISCUSSION",
                },
              });

              if (
                quote.threadId
              ) {
                await tx.messageThread.updateMany({
                  where: {
                    id:
                      quote.threadId,
                  },

                  data: {
                    leadStatus:
                      "IN_DISCUSSION",
                  },
                });
              }
            }

            return updatedOffer;
          }
        );

      try {
        await createUserNotification(
          quote.userId,
          {
            type:
              "message",

            title:
              "Oferta a fost actualizată",

            body:
              "Vânzătorul a retras oferta trimisă anterior.",

            link:
              `/?assistant=quote&quoteId=${quote.id}`,
          }
        );
      } catch (
        notificationError
      ) {
        console.error(
          "Withdraw offer notification failed:",
          notificationError
        );
      }

      return res.json({
        ok:
          true,

        offer:
          serializeQuoteOffer(
            result
          ),
      });
    } catch (
      error
    ) {
      console.error(
        "POST /api/vendor/quotes/:id/offers/:offerId/withdraw failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_quote_offer_withdraw_failed",

          message:
            "Oferta nu a putut fi retrasă.",
        });
    }
  }
);

/* =========================================================
   POST /api/vendor/quotes/:id/reject

   Vendorul refuză cererea.
========================================================= */

router.post(
  "/:id/reject",

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getCurrentVendor(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",

            message:
              "Profilul de vânzător nu a fost găsit.",
          });
      }

      const quoteId =
        String(
          req.params.id ||
            ""
        ).trim();

      const reason =
        String(
          req.body?.reason ||
            ""
        ).trim();

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              quoteId,

            vendorId:
              vendor.id,
          },

          select: {
            id:
              true,

            userId:
              true,

            status:
              true,

            orderId:
              true,

            threadId:
              true,
          },
        });

      if (!quote) {
        return res
          .status(404)
          .json({
            error:
              "quote_request_not_found",

            message:
              "Cererea de ofertă nu a fost găsită.",
          });
      }

      if (
        quote.orderId ||
        quote.status ===
          "ACCEPTED"
      ) {
        return res
          .status(409)
          .json({
            error:
              "accepted_quote_cannot_be_rejected",

            message:
              "Cererea nu poate fi refuzată deoarece a fost deja acceptată și asociată unei comenzi.",
          });
      }

      if (
        [
          "REJECTED",
          "CANCELLED",
          "EXPIRED",
        ].includes(
          quote.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "quote_already_closed",

            message:
              "Cererea de ofertă este deja închisă.",
          });
      }

      /*
       * Motivul refuzului este text
       * vizibil clientului, deci îl moderăm.
       */

      if (reason) {
        const moderation =
          await moderateMarketplaceMessage({
            text:
              reason,

            senderType:
              "VENDOR",
          });

        if (
  !moderation.allowed
) {
  const technicalReasons =
    new Set([
      "text_moderation_failed",
      "text_moderation_invalid_response",
      "text_moderation_ambiguous_response",
    ]);

  const isTechnicalError =
    technicalReasons.has(
      moderation.reason
    );

  return res
    .status(
      isTechnicalError
        ? 503
        : 422
    )
    .json({
      error:
        isTechnicalError
          ? "moderation_unavailable"
          : "reject_reason_blocked",

      reason:
        moderation.reason ||
        "not_allowed",

      detections:
        moderation.detections ||
        [],

      message:
        isTechnicalError
          ? "Motivul refuzului nu a putut fi verificat momentan. Încearcă din nou peste câteva secunde."
          : "Motivul refuzului nu poate conține sau sugera date de contact, comunicare ori plată în afara platformei.",
    });
}
      }

      await prisma.$transaction(
        async (
          tx
        ) => {
          /*
           * Închidem toate ofertele
           * active.
           */

          await tx.quoteOffer.updateMany({
            where: {
              quoteRequestId:
                quote.id,

              status:
                "SENT",
            },

            data: {
              status:
                "REJECTED",
            },
          });

          await tx.quoteRequest.update({
            where: {
              id:
                quote.id,
            },

            data: {
              status:
                "REJECTED",
            },
          });

          if (
            quote.threadId
          ) {
            await tx.messageThread.updateMany({
              where: {
                id:
                  quote.threadId,
              },

              data: {
                leadStatus:
                  "LOST",
              },
            });
          }
        }
      );

      try {
        await createUserNotification(
          quote.userId,
          {
            type:
              "message",

            title:
              "Cererea de ofertă a fost refuzată",

            body:
              reason ||
              "Vânzătorul nu poate accepta momentan această cerere.",

            link:
              `/?assistant=quote&quoteId=${quote.id}`,
          }
        );
      } catch (
        notificationError
      ) {
        console.error(
          "Reject quote notification failed:",
          notificationError
        );
      }

      return res.json({
        ok:
          true,

        status:
          "REJECTED",
      });
    } catch (
      error
    ) {
      console.error(
        "POST /api/vendor/quotes/:id/reject failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_quote_reject_failed",

          message:
            "Cererea de ofertă nu a putut fi refuzată.",
        });
    }
  }
);

/* =========================================================
   GET /api/vendor/quotes/:id

   Detaliile unei cereri.
========================================================= */

router.get(
  "/:id",

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getCurrentVendor(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const quoteId =
        String(
          req.params.id ||
            ""
        ).trim();

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              quoteId,

            vendorId:
              vendor.id,
          },

          include: {
            user: {
              select: {
                id:
                  true,

                firstName:
                  true,

                lastName:
                  true,
              },
            },

            product: {
              select: {
                id:
                  true,

                title:
                  true,

                images:
                  true,

                orderMode:
                  true,

                quoteSchema:
                  true,
              },
            },

            service: {
              select: {
                id:
                  true,

                title:
                  true,

                profile: {
                  select: {
                    displayName:
                      true,

                    slug:
                      true,

                    logoUrl:
                      true,
                  },
                },
              },
            },

            offers: {
              orderBy: {
                createdAt:
                  "desc",
              },
            },
          },
        });

      if (!quote) {
        return res
          .status(404)
          .json({
            error:
              "quote_request_not_found",

            message:
              "Cererea de ofertă nu a fost găsită.",
          });
      }

      return res.json(
        serializeVendorQuote(
          quote
        )
      );
    } catch (
      error
    ) {
      console.error(
        "GET /api/vendor/quotes/:id failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_quote_read_failed",

          message:
            "Nu am putut încărca cererea de ofertă.",
        });
    }
  }
);

/* =========================================================
   GET /api/vendor/quotes/:id/messages

   Istoric conversație.
========================================================= */

router.get(
  "/:id/messages",

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getCurrentVendor(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const quoteId =
        String(
          req.params.id ||
            ""
        ).trim();

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              quoteId,

            vendorId:
              vendor.id,
          },

          select: {
            id:
              true,

            threadId:
              true,
          },
        });

      if (
        !quote ||
        !quote.threadId
      ) {
        return res
          .status(404)
          .json({
            error:
              "quote_thread_not_found",

            message:
              "Conversația nu a fost găsită.",
          });
      }

      const messages =
        await prisma.message.findMany({
          where: {
            threadId:
              quote.threadId,

            deletedByVendorAt:
              null,
          },

          orderBy: {
            createdAt:
              "asc",
          },

          select: {
            id:
              true,

            body:
              true,

            createdAt:
              true,

            authorType:
              true,

            authorName:
              true,

            attachments: {
              select: {
                id:
                  true,

                filename:
                  true,

                url:
                  true,

                mime:
                  true,

                size:
                  true,
              },
            },
          },
        });

      return res.json({
        items:
          messages.map(
            (
              message
            ) => ({
              id:
                message.id,

              from:
                message.authorType ===
                "VENDOR"
                  ? "me"
                  : "them",

              senderRole:
                message.authorType,

              body:
                message.body,

              createdAt:
                message.createdAt,

              authorName:
                message.authorType ===
                "VENDOR"
                  ? null
                  : message.authorName,

              attachments:
                (
                  message.attachments ||
                  []
                ).map(
                  (
                    attachment
                  ) => ({
                    id:
                      attachment.id,

                    name:
                      attachment.filename,

                    url:
                      attachment.url,

                    mime:
                      attachment.mime,

                    size:
                      attachment.size,
                  })
                ),
            })
          ),
      });
    } catch (
      error
    ) {
      console.error(
        "GET /api/vendor/quotes/:id/messages failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_quote_messages_read_failed",

          message:
            "Nu am putut încărca mesajele.",
        });
    }
  }
);

/* =========================================================
   POST /api/vendor/quotes/:id/messages

   Vendorul trimite mesaj clientului.
========================================================= */

router.post(
  "/:id/messages",

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getCurrentVendor(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const quoteId =
        String(
          req.params.id ||
            ""
        ).trim();

      const body =
        String(
          req.body?.body ||
            ""
        ).trim();

      if (!body) {
        return res
          .status(400)
          .json({
            error:
              "message_required",

            message:
              "Mesajul nu poate fi gol.",
          });
      }

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              quoteId,

            vendorId:
              vendor.id,

            status: {
              notIn: [
                "CANCELLED",
                "REJECTED",
                "EXPIRED",
              ],
            },
          },

          select: {
            id:
              true,

            userId:
              true,

            vendorId:
              true,

            threadId:
              true,

            status:
              true,

            product: {
              select: {
                title:
                  true,
              },
            },
          },
        });

      if (
        !quote ||
        !quote.threadId
      ) {
        return res
          .status(404)
          .json({
            error:
              "quote_request_not_found",

            message:
              "Cererea de ofertă nu a fost găsită.",
          });
      }

      /*
       * O ofertă acceptată poate avea
       * conversație în continuare doar dacă
       * dorești acest comportament.
       *
       * Pentru moment permitem conversația,
       * dar NU schimbăm statusul ACCEPTED.
       */

      const moderation =
        await moderateMarketplaceMessage({
          text:
            body,

          senderType:
            "VENDOR",
        });

     if (
  !moderation.allowed
) {
  const technicalReasons =
    new Set([
      "text_moderation_failed",
      "text_moderation_invalid_response",
      "text_moderation_ambiguous_response",
    ]);

  const isTechnicalError =
    technicalReasons.has(
      moderation.reason
    );

  return res
    .status(
      isTechnicalError
        ? 503
        : 422
    )
    .json({
      error:
        isTechnicalError
          ? "moderation_unavailable"
          : "message_blocked",

      reason:
        moderation.reason ||
        "not_allowed",

      detections:
        moderation.detections ||
        [],

      message:
        isTechnicalError
          ? "Mesajul nu a putut fi verificat momentan și nu a fost trimis. Încearcă din nou peste câteva secunde."
          : "Mesajul nu poate fi trimis deoarece conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
    });
}
      const message =
        await prisma.$transaction(
          async (
            tx
          ) => {
            const created =
              await tx.message.create({
                data: {
                  threadId:
                    quote.threadId,

                  vendorId:
                    vendor.id,

                  authorType:
                    "VENDOR",

                  body,
                },

                select: {
                  id:
                    true,

                  body:
                    true,

                  createdAt:
                    true,
                },
              });

            await tx.messageThread.update({
              where: {
                id:
                  quote.threadId,
              },

             data: {
  lastMsg: created.body,

  lastAt: created.createdAt,

  vendorLastReadAt: new Date(),

  userLastReadAt: null,

  /*
   * Nu suprascriem starea
   * comercială dacă oferta
   * a fost trimisă sau acceptată.
   */
  ...(
    [
      "SUBMITTED",
      "IN_DISCUSSION",
    ].includes(
      quote.status
    )
      ? {
          leadStatus:
            "IN_DISCUSSION",
        }
      : {}
  ),
},
            });

            if (
              [
                "SUBMITTED",
                "IN_DISCUSSION",
              ].includes(
                quote.status
              )
            ) {
              await tx.quoteRequest.update({
                where: {
                  id:
                    quote.id,
                },

                data: {
                  status:
                    "IN_DISCUSSION",
                },
              });
            }

            return created;
          }
        );

      try {
        await createUserNotification(
          quote.userId,
          {
            type:
              "message",

            title:
              "Mesaj nou într-o cerere de ofertă",

            body:
              message.body.slice(
                0,
                140
              ),

            link:
              `/?assistant=quote&quoteId=${quote.id}`,
          }
        );
      } catch (
        notificationError
      ) {
        console.error(
          "Quote user notification failed:",
          notificationError
        );
      }

      return res
        .status(201)
        .json({
          ok:
            true,

          id:
            message.id,

          createdAt:
            message.createdAt,
        });
    } catch (
      error
    ) {
      console.error(
        "POST /api/vendor/quotes/:id/messages failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_quote_message_send_failed",

          message:
            "Mesajul nu a putut fi trimis.",
        });
    }
  }
);

/* =========================================================
   PATCH /api/vendor/quotes/:id/read

   Marchează conversația citită de vendor.
========================================================= */

router.patch(
  "/:id/read",

  async (
    req,
    res
  ) => {
    try {
      const vendor =
        await getCurrentVendor(
          req
        );

      if (!vendor) {
        return res
          .status(404)
          .json({
            error:
              "vendor_not_found",
          });
      }

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              String(
                req.params.id ||
                  ""
              ),

            vendorId:
              vendor.id,
          },

          select: {
            threadId:
              true,
          },
        });

      if (
        !quote ||
        !quote.threadId
      ) {
        return res
          .status(404)
          .json({
            error:
              "quote_request_not_found",
          });
      }

      await prisma.messageThread.update({
        where: {
          id:
            quote.threadId,
        },

        data: {
          vendorLastReadAt:
            new Date(),
        },
      });

      return res.json({
        ok:
          true,
      });
    } catch (
      error
    ) {
      console.error(
        "PATCH /api/vendor/quotes/:id/read failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_quote_mark_read_failed",
        });
    }
  }
);

export default router;