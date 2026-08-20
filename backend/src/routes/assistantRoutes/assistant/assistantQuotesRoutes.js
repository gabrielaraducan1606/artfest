// backend/src/routes/assistant/assistantQuotesRoutes.js

import { Router } from "express";

import { prisma } from "../../../db.js";

import {
  authRequired,
  enforceTokenVersion,
} from "../../../api/auth.js";

import {
  createVendorNotification,
} from "../../../services/notifications.js";

import {
  moderateMarketplaceMessage,
} from "../../../services/marketplaceMessageModeration.js";

import {
  sendOrderConfirmationEmail,
  sendVendorNewOrderEmail,
  sendVendorNewQuoteRequestEmail,
} from "../../../lib/mailer.js";

import {
  createPaymentForOrder,
} from "../../../payments/orchestrator.js";

const router = Router();

/*
 * Pentru cereri de ofertă cerem cont autentificat.
 *
 * Guest poate cumpăra direct în continuare,
 * dar nu poate crea cereri de ofertă.
 */
router.use(
  authRequired,
  enforceTokenVersion
);

/* =========================================================
   Helpers
========================================================= */

function normalizeObject(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  return value;
}

function normalizeQuantity(value) {
  const quantity =
    Number.parseInt(value, 10);

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return null;
  }

  return Math.min(
    quantity,
    100000
  );
}

function serializeQuoteRequest(
  quote
) {
  return {
    id: quote.id,

    status:
      quote.status,

    source:
      quote.source,

    quantity:
      quote.quantity,

    requestData:
      quote.requestData || {},

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
      quote.threadId || null,

    orderId:
      quote.orderId || null,

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
        ? quote.offers
        : [],
  };
}

/* =========================================================
   POST /api/assistant/quotes

   Creează:
   - QuoteRequest
   - MessageThread dedicat

   Pentru moment:
   - PRODUCT = cerere pornită din pagina produsului
========================================================= */

/* =========================================================
   POST /api/assistant/quotes

   Creează:
   - QuoteRequest
   - MessageThread dedicat

   Pentru moment:
   - PRODUCT = cerere pornită din pagina produsului
========================================================= */

/* =========================================================
   POST /api/assistant/quotes

   Creează:
   - QuoteRequest
   - MessageThread dedicat

   Acceptă:
   - PRODUCT = cerere pornită de la produs
   - STORE   = cerere pornită de la magazin
========================================================= */

router.post(
  "/",
  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const {
        productId,
        vendorId,
        serviceId,
        quantity,
        requestData,
        quoteSchemaAnswers,
        eventDate,
        deliveryDeadline,
        budgetMin,
        budgetMax,
      } = req.body || {};

      /* =====================================================
         NORMALIZARE DATE
      ===================================================== */

      const normalizedProductId =
        String(
          productId || ""
        ).trim();

      const normalizedVendorId =
        String(
          vendorId || ""
        ).trim();

      const normalizedServiceId =
        String(
          serviceId || ""
        ).trim();

      if (
        !normalizedProductId &&
        !normalizedVendorId &&
        !normalizedServiceId
      ) {
        return res
          .status(400)
          .json({
            error:
              "quote_target_required",

            message:
              "Trebuie specificat un produs sau un magazin.",
          });
      }

      const normalizedQuantity =
        normalizeQuantity(
          quantity
        );

      if (
        !normalizedQuantity
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_quantity",

            message:
              "Cantitatea trebuie să fie mai mare decât 0.",
          });
      }

      const normalizedRequestData =
        normalizeObject(
          requestData
        );

      const normalizedQuoteAnswers =
        normalizeObject(
          quoteSchemaAnswers
        );

      const initialMessage =
        String(
          normalizedRequestData
            ?.message ||
            ""
        ).trim();

      /* =====================================================
         MODERARE CERERE
      ===================================================== */

      const answerTexts =
        Object.values(
          normalizedQuoteAnswers
        )
          .filter(
            (
              answer
            ) =>
              typeof answer ===
                "string" &&
              answer.trim()
          )
          .map(
            (
              answer
            ) =>
              answer.trim()
          );

      const moderationText =
        [
          initialMessage,
          ...answerTexts,
        ]
          .filter(
            Boolean
          )
          .join(
            "\n"
          );

      if (
        moderationText
      ) {
        const moderation =
          await moderateMarketplaceMessage(
            {
              text:
                moderationText,

              senderType:
                "USER",
            }
          );

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
                  ? "Cererea nu a putut fi verificată momentan și nu a fost trimisă. Încearcă din nou peste câteva secunde."
                  : "Cererea nu poate fi trimisă deoarece conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
            });
        }
      }

      /* =====================================================
         IDENTIFICARE PRODUS / MAGAZIN
      ===================================================== */

      let resolvedProduct =
        null;

      let resolvedService =
        null;

      let resolvedVendorId =
        null;

      let resolvedServiceId =
        null;

      let resolvedProductId =
        null;

      let quoteSource =
        null;

      let targetTitle =
        "magazin";

      /*
       * ============================================
       * FLOW PRODUS
       * ============================================
       */

      if (
        normalizedProductId
      ) {
        resolvedProduct =
          await prisma.product.findFirst(
            {
              where: {
                id:
                  normalizedProductId,

                isActive:
                  true,

                isHidden:
                  false,
              },

              select: {
                id:
                  true,

                title:
                  true,

                orderMode:
                  true,

                quoteSchema:
                  true,

                serviceId:
                  true,

                service: {
                  select: {
                    id:
                      true,

                    vendorId:
                      true,

                    title:
                      true,

                    isActive:
                      true,

                    status:
                      true,

                    profile: {
                      select: {
                        displayName:
                          true,

                        slug:
                          true,
                      },
                    },
                  },
                },
              },
            }
          );

        if (
          !resolvedProduct
        ) {
          return res
            .status(404)
            .json({
              error:
                "product_not_found",

              message:
                "Produsul nu a fost găsit.",
            });
        }

        if (
          !resolvedProduct
            .service ||
          !resolvedProduct
            .service
            .vendorId
        ) {
          return res
            .status(409)
            .json({
              error:
                "vendor_not_available",

              message:
                "Magazinul acestui produs nu este disponibil.",
            });
        }

        if (
          !resolvedProduct
            .service
            .isActive
        ) {
          return res
            .status(409)
            .json({
              error:
                "store_not_active",

              message:
                "Magazinul acestui produs nu este activ.",
            });
        }

        resolvedService =
          resolvedProduct
            .service;

        resolvedVendorId =
          resolvedProduct
            .service
            .vendorId;

        resolvedServiceId =
          resolvedProduct
            .serviceId;

        resolvedProductId =
          resolvedProduct.id;

        quoteSource =
          "PRODUCT";

        targetTitle =
          resolvedProduct.title ||
          "produs";
      } else {
        /*
         * ============================================
         * FLOW MAGAZIN
         * ============================================
         *
         * Dacă frontendul trimite serviceId,
         * folosim exact acel magazin.
         *
         * Dacă trimite doar vendorId,
         * alegem magazinul activ al vendorului.
         */

        resolvedService =
          await prisma.vendorService.findFirst(
            {
              where: {
                ...(normalizedServiceId
                  ? {
                      id:
                        normalizedServiceId,
                    }
                  : {
                      vendorId:
                        normalizedVendorId,
                    }),

                isActive:
                  true,
              },

              orderBy: {
                updatedAt:
                  "desc",
              },

              select: {
                id:
                  true,

                vendorId:
                  true,

                title:
                  true,

                isActive:
                  true,

                status:
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
            }
          );

        if (
          !resolvedService
        ) {
          return res
            .status(404)
            .json({
              error:
                "store_not_found",

              message:
                "Magazinul nu a fost găsit sau nu este activ.",
            });
        }

        /*
         * Dacă au fost trimise și serviceId,
         * și vendorId, verificăm să corespundă.
         */
        if (
          normalizedVendorId &&
          resolvedService
            .vendorId !==
            normalizedVendorId
        ) {
          return res
            .status(409)
            .json({
              error:
                "store_vendor_mismatch",

              message:
                "Magazinul selectat nu aparține vânzătorului indicat.",
            });
        }

        resolvedVendorId =
          resolvedService
            .vendorId;

        resolvedServiceId =
          resolvedService.id;

        resolvedProductId =
          null;

        quoteSource =
          "STORE";

        targetTitle =
          resolvedService
            .profile
            ?.displayName ||
          resolvedService
            .title ||
          "magazin";
      }

      /* =====================================================
         UTILIZATOR
      ===================================================== */

      const user =
        await prisma.user.findUnique(
          {
            where: {
              id:
                userId,
            },

            select: {
              firstName:
                true,

              lastName:
                true,

              email:
                true,
            },
          }
        );

      const contactName =
        [
          user?.firstName,
          user?.lastName,
        ]
          .filter(
            Boolean
          )
          .join(
            " "
          );

      /* =====================================================
         TEXTE THREAD
      ===================================================== */

      const threadLastMessage =
        quoteSource ===
        "PRODUCT"
          ? `Cerere de ofertă pentru ${targetTitle}`
          : `Cerere de ofertă pentru magazinul ${targetTitle}`;

      let firstMessageBody;

      if (
        quoteSource ===
        "PRODUCT"
      ) {
        firstMessageBody =
          initialMessage
            ? `Cerere de ofertă pentru produsul „${targetTitle}”, cantitate ${normalizedQuantity}. Cerințe: ${initialMessage}`
            : `Cerere de ofertă pentru produsul „${targetTitle}”, cantitate ${normalizedQuantity}.`;
      } else {
        firstMessageBody =
          initialMessage
            ? `Cerere de ofertă pentru magazinul „${targetTitle}”, cantitate ${normalizedQuantity}. Cerințe: ${initialMessage}`
            : `Cerere de ofertă pentru magazinul „${targetTitle}”, cantitate ${normalizedQuantity}.`;
      }

      /* =====================================================
         CREARE CERERE + THREAD
      ===================================================== */

      const result =
        await prisma.$transaction(
          async (
            tx
          ) => {
            const quoteRequest =
              await tx.quoteRequest.create(
                {
                  data: {
                    userId,

                    vendorId:
                      resolvedVendorId,

                    serviceId:
                      resolvedServiceId,

                    productId:
                      resolvedProductId,

                    source:
                      quoteSource,

                    status:
                      "SUBMITTED",

                    quantity:
                      normalizedQuantity,

                    requestData:
                      normalizedRequestData,

                    quoteSchemaAnswers:
                      normalizedQuoteAnswers,

                    eventDate:
                      eventDate
                        ? new Date(
                            eventDate
                          )
                        : null,

                    deliveryDeadline:
                      deliveryDeadline
                        ? new Date(
                            deliveryDeadline
                          )
                        : null,

                    budgetMin:
                      Number.isFinite(
                        Number(
                          budgetMin
                        )
                      )
                        ? Math.round(
                            Number(
                              budgetMin
                            )
                          )
                        : null,

                    budgetMax:
                      Number.isFinite(
                        Number(
                          budgetMax
                        )
                      )
                        ? Math.round(
                            Number(
                              budgetMax
                            )
                          )
                        : null,
                  },

                  select: {
                    id:
                      true,
                  },
                }
              );

            const thread =
              await tx.messageThread.create(
                {
                  data: {
                    type:
                      "CUSTOMER",

                    vendorId:
                      resolvedVendorId,

                    serviceId:
                      resolvedServiceId,

                    userId,

                    contactName:
                      contactName ||
                      null,

                    /*
                     * Datele de contact nu sunt
                     * expuse în conversație.
                     */
                    contactEmail:
                      null,

                    contactPhone:
                      null,

                    archived:
                      false,

                    archivedByUser:
                      false,

                    leadStatus:
                      "NEW",

                    lastMsg:
                      threadLastMessage,

                    lastAt:
                      new Date(),
                  },

                  select: {
                    id:
                      true,
                  },
                }
              );

            await tx.quoteRequest.update(
              {
                where: {
                  id:
                    quoteRequest.id,
                },

                data: {
                  threadId:
                    thread.id,
                },
              }
            );

            await tx.message.create(
              {
                data: {
                  threadId:
                    thread.id,

                  vendorId:
                    resolvedVendorId,

                  authorType:
                    "USER",

                  authorUserId:
                    userId,

                  body:
                    firstMessageBody,
                },
              }
            );

            return {
              quoteRequestId:
                quoteRequest.id,

              threadId:
                thread.id,
            };
          }
        );

      /* =====================================================
         NOTIFICARE VENDOR
      ===================================================== */

      try {
        await createVendorNotification(
          resolvedVendorId,
          {
            type:
              "message",

            title:
              "Cerere nouă de ofertă",

            body:
              quoteSource ===
              "PRODUCT"
                ? `${
                    contactName ||
                    "Un client"
                  } solicită o ofertă pentru ${targetTitle}.`
                : `${
                    contactName ||
                    "Un client"
                  } solicită o ofertă de la magazinul ${targetTitle}.`,

            link:
              `/?assistant=vendor-quote&quoteId=${result.quoteRequestId}`,
          }
        );
      } catch (
        notificationError
      ) {
        console.error(
          "Quote vendor notification failed:",
          notificationError
        );
      }
/* =====================================================
   EMAIL VENDOR - CERERE NOUĂ DE OFERTĂ
===================================================== */

try {
  const vendor =
    await prisma.vendor.findUnique({
      where: {
        id: resolvedVendorId,
      },

      select: {
        displayName: true,

        user: {
          select: {
            email: true,
          },
        },

        billing: {
          select: {
            email: true,
            vendorName: true,
          },
        },
      },
    });

  const vendorEmail =
    vendor?.billing?.email ||
    vendor?.user?.email ||
    null;

  const vendorName =
    vendor?.billing?.vendorName ||
    vendor?.displayName ||
    "Vânzător";

  if (vendorEmail) {
    await sendVendorNewQuoteRequestEmail({
      to: vendorEmail,

      vendorName,

      customerName:
        contactName ||
        "Un client",

      quoteId:
        result.quoteRequestId,

      source:
        quoteSource,

      targetTitle,

      quantity:
        normalizedQuantity,

      message:
        initialMessage || null,
    });
  }
} catch (emailError) {
  console.error(
    "Quote vendor email failed:",
    emailError
  );
}
      return res
        .status(201)
        .json({
          ok:
            true,

          id:
            result
              .quoteRequestId,

          quoteRequestId:
            result
              .quoteRequestId,

          threadId:
            result
              .threadId,

          source:
            quoteSource,

          productId:
            resolvedProductId,

          serviceId:
            resolvedServiceId,

          vendorId:
            resolvedVendorId,
        });
    } catch (
      error
    ) {
      console.error(
        "POST /api/assistant/quotes failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "quote_request_create_failed",

          message:
            "Nu am putut crea cererea de ofertă.",
        });
    }
  }
);
/* =========================================================
   GET /api/assistant/quotes/me

   Cererile utilizatorului
========================================================= */

router.get(
  "/me",
  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const quotes =
        await prisma.quoteRequest.findMany(
          {
            where: {
              userId,
            },

            orderBy: {
              updatedAt:
                "desc",
            },

            include: {
              product: {
                select: {
                  id: true,
                  title: true,
                  images: true,
                  orderMode:
                    true,
                },
              },

              service: {
                select: {
                  id: true,
                  title: true,

                  profile: {
                    select: {
                      displayName:
                        true,

                      slug: true,

                      logoUrl:
                        true,
                    },
                  },
                },
              },

              offers: {
                where: {
                  status: {
                    in: [
                      "SENT",
                      "ACCEPTED",
                    ],
                  },
                },

                orderBy: {
                  createdAt:
                    "desc",
                },
              },
            },
          }
        );

      return res.json({
        items:
          quotes.map(
            serializeQuoteRequest
          ),
      });
    } catch (error) {
      console.error(
        "GET /api/assistant/quotes/me failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "quote_requests_read_failed",

          message:
            "Nu am putut încărca cererile de ofertă.",
        });
    }
  }
);

/* =========================================================
   GET /api/assistant/quotes/:id
========================================================= */

router.get(
  "/:id",
  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const quoteId =
        String(
          req.params.id || ""
        ).trim();

      const quote =
        await prisma.quoteRequest.findFirst(
          {
            where: {
              id: quoteId,
              userId,
            },

            include: {
              product: {
                select: {
                  id: true,
                  title: true,
                  images: true,
                  orderMode:
                    true,

                  quoteSchema:
                    true,
                },
              },

              service: {
                select: {
                  id: true,
                  title: true,

                  profile: {
                    select: {
                      displayName:
                        true,

                      slug: true,

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
          }
        );

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
        serializeQuoteRequest(
          quote
        )
      );
    } catch (error) {
      console.error(
        "GET /api/assistant/quotes/:id failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "quote_request_read_failed",

          message:
            "Nu am putut încărca cererea de ofertă.",
        });
    }
  }
);

/* =========================================================
   GET /api/assistant/quotes/:id/messages
========================================================= */

router.get(
  "/:id/messages",
  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const quote =
        await prisma.quoteRequest.findFirst(
          {
            where: {
              id:
                String(
                  req.params.id ||
                    ""
                ),

              userId,
            },

            select: {
  id: true,
  threadId: true,

  thread: {
    select: {
      vendorLastReadAt: true,
      userLastReadAt: true,
    },
  },
},
          }
        );

      if (
        !quote ||
        !quote.threadId
      ) {
        return res
          .status(404)
          .json({
            error:
              "quote_thread_not_found",
          });
      }

      const messages =
        await prisma.message.findMany(
          {
            where: {
              threadId:
                quote.threadId,

              deletedByUserAt:
                null,
            },

            orderBy: {
              createdAt:
                "asc",
            },

            select: {
              id: true,
              body: true,
              createdAt:
                true,

              authorType:
                true,

              authorName:
                true,

              attachments: {
                select: {
                  id: true,
                  filename:
                    true,
                  url: true,
                  mime: true,
                  size: true,
                },
              },
            },
          }
        );

      return res.json({
  items:
    messages.map(
      (message) => ({
        id:
          message.id,

        from:
          message.authorType ===
          "USER"
            ? "me"
            : "them",

        body:
          message.body,

        createdAt:
          message.createdAt,

        readByPeer:
          message.authorType ===
          "USER"
            ? Boolean(
                quote.thread?.vendorLastReadAt &&
                  new Date(
                    quote.thread.vendorLastReadAt
                  ) >=
                    new Date(
                      message.createdAt
                    )
              )
            : Boolean(
                quote.thread?.userLastReadAt &&
                  new Date(
                    quote.thread.userLastReadAt
                  ) >=
                    new Date(
                      message.createdAt
                    )
              ),

        authorName:
          message.authorType ===
          "USER"
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
    } catch (error) {
      console.error(
        "GET quote messages failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "quote_messages_read_failed",
        });
    }
  }
);

/* =========================================================
   POST /api/assistant/quotes/:id/messages
========================================================= */

router.post(
  "/:id/messages",
  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const quoteId =
        String(
          req.params.id || ""
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
        await prisma.quoteRequest.findFirst(
          {
            where: {
              id: quoteId,
              userId,

              status: {
                notIn: [
                  "CANCELLED",
                  "REJECTED",
                  "EXPIRED",
                ],
              },
            },

            select: {
              id: true,
              threadId: true,
              vendorId:
                true,
            },
          }
        );

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

      const moderation =
  await moderateMarketplaceMessage({
    text: body,
    senderType: "USER",
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
          async (tx) => {
            const created =
              await tx.message.create(
                {
                  data: {
                    threadId:
                      quote.threadId,

                    vendorId:
                      quote.vendorId,

                    authorType:
                      "USER",

                    authorUserId:
                      userId,

                    body,
                  },

                  select: {
                    id: true,
                    body: true,
                    createdAt:
                      true,
                  },
                }
              );

            await tx.messageThread.update(
              {
                where: {
                  id:
                    quote.threadId,
                },

                data: {
                  lastMsg:
                    created.body,

                  lastAt:
                    created.createdAt,

                  userLastReadAt:
                    new Date(),

                  leadStatus:
                    "IN_DISCUSSION",
                },
              }
            );

            await tx.quoteRequest.update(
              {
                where: {
                  id:
                    quote.id,
                },

                data: {
                  status:
                    "IN_DISCUSSION",
                },
              }
            );

            return created;
          }
        );

      try {
        await createVendorNotification(
          quote.vendorId,
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
  `/?assistant=vendor-quote&quoteId=${quote.id}`,
          }
        );
      } catch (
        notificationError
      ) {
        console.error(
          "Quote message notification failed:",
          notificationError
        );
      }

      return res
        .status(201)
        .json({
          ok: true,

          id:
            message.id,

          createdAt:
            message.createdAt,
        });
    } catch (error) {
      console.error(
        "POST quote message failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "quote_message_send_failed",

          message:
            "Mesajul nu a putut fi trimis.",
        });
    }
  }
);

/* =========================================================
   PATCH /api/assistant/quotes/:id/read
========================================================= */

router.patch(
  "/:id/read",
  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const quote =
        await prisma.quoteRequest.findFirst(
          {
            where: {
              id:
                String(
                  req.params.id ||
                    ""
                ),

              userId,
            },

            select: {
              threadId:
                true,
            },
          }
        );

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

      await prisma.messageThread.update(
        {
          where: {
            id:
              quote.threadId,
          },

          data: {
            userLastReadAt:
              new Date(),
          },
        }
      );

      return res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        "PATCH quote read failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "quote_mark_read_failed",
        });
    }
  }
);
/* =========================================================
   POST /api/assistant/quotes/:id/offers/:offerId/accept

   Clientul acceptă oferta.

   Se creează atomic:
   - Order
   - Shipment
   - ShipmentItem
   - QuoteOffer ACCEPTED
   - QuoteRequest ACCEPTED + orderId

   Suportă:
   - PF
   - PJ
   - COD
   - CARD
========================================================= */

router.post(
  "/:id/offers/:offerId/accept",

  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const quoteId =
        String(
          req.params.id || ""
        ).trim();

      const offerId =
        String(
          req.params.offerId || ""
        ).trim();

      /*
       * =====================================================
       * DATE CHECKOUT
       * =====================================================
       */

      const shippingAddressInput =
        normalizeObject(
          req.body?.shippingAddress
        );

      const billingAddressInput =
        normalizeObject(
          req.body?.billingAddress
        );

      const contactPersonInput =
        normalizeObject(
          req.body?.contactPerson
        );

      const customerType =
        String(
          req.body?.customerType ||
            "PF"
        )
          .trim()
          .toUpperCase();

      const paymentMethod =
        String(
          req.body?.paymentMethod ||
            "COD"
        )
          .trim()
          .toUpperCase();

      const shipToDifferentAddress =
        req.body
          ?.shipToDifferentAddress ===
        true;

      /*
       * =====================================================
       * VALIDARE DATE GENERALE
       * =====================================================
       */

      if (
        !quoteId ||
        !offerId
      ) {
        return res
          .status(400)
          .json({
            error:
              "missing_quote_or_offer_id",

            message:
              "Cererea sau oferta nu a putut fi identificată.",
          });
      }

      if (
        ![
          "PF",
          "PJ",
        ].includes(
          customerType
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_customer_type",

            message:
              "Tipul clientului nu este valid.",
          });
      }

      if (
        ![
          "COD",
          "CARD",
        ].includes(
          paymentMethod
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_payment_method",

            message:
              "Metoda de plată nu este validă.",
          });
      }

      /*
       * =====================================================
       * DATE LIVRARE
       * =====================================================
       */

      const recipientName =
        String(
          shippingAddressInput
            ?.recipientName ||
            shippingAddressInput
              ?.name ||
            ""
        ).trim();

      const phone =
        String(
          shippingAddressInput
            ?.phone ||
            ""
        ).trim();

      const street =
        String(
          shippingAddressInput
            ?.addressLine1 ||
            shippingAddressInput
              ?.street ||
            ""
        ).trim();

      const city =
        String(
          shippingAddressInput
            ?.city ||
            ""
        ).trim();

      const county =
        String(
          shippingAddressInput
            ?.county ||
            ""
        ).trim();

      const postalCode =
        String(
          shippingAddressInput
            ?.postalCode ||
            ""
        ).trim();

      /*
       * =====================================================
       * VALIDARE PF
       * =====================================================
       */

      if (
        customerType ===
        "PF"
      ) {
        if (
          !recipientName ||
          !phone ||
          !street ||
          !city ||
          !county
        ) {
          return res
            .status(400)
            .json({
              error:
                "shipping_address_incomplete",

              message:
                "Datele de livrare sunt incomplete.",
            });
        }
      }

      /*
       * =====================================================
       * DATE PJ
       * =====================================================
       */

      let companyName =
        "";

      let companyCui =
        "";

      let companyRegCom =
        "";

      let billingCounty =
        "";

      let billingCity =
        "";

      let billingStreet =
        "";

      let billingPostalCode =
        "";

      let contactName =
        "";

      let contactEmail =
        "";

      let contactPhone =
        "";

      if (
        customerType ===
        "PJ"
      ) {
        companyName =
          String(
            billingAddressInput
              ?.companyName ||
              ""
          ).trim();

        companyCui =
          String(
            billingAddressInput
              ?.companyCui ||
              ""
          )
            .trim()
            .toUpperCase();

        companyRegCom =
          String(
            billingAddressInput
              ?.companyRegCom ||
              ""
          ).trim();

        billingCounty =
          String(
            billingAddressInput
              ?.county ||
              ""
          ).trim();

        billingCity =
          String(
            billingAddressInput
              ?.city ||
              ""
          ).trim();

        billingStreet =
          String(
            billingAddressInput
              ?.street ||
              ""
          ).trim();

        billingPostalCode =
          String(
            billingAddressInput
              ?.postalCode ||
              ""
          ).trim();

        contactName =
          String(
            contactPersonInput
              ?.name ||
              [
                contactPersonInput
                  ?.lastName,

                contactPersonInput
                  ?.firstName,
              ]
                .filter(
                  Boolean
                )
                .join(
                  " "
                ) ||
              ""
          ).trim();

        contactEmail =
          String(
            contactPersonInput
              ?.email ||
              ""
          ).trim();

        contactPhone =
          String(
            contactPersonInput
              ?.phone ||
              ""
          ).trim();

        /*
         * Datele firmei și persoana
         * de contact sunt obligatorii.
         */
        if (
          !companyName ||
          !companyCui ||
          !billingCounty ||
          !billingCity ||
          !billingStreet ||
          !contactName ||
          !contactEmail ||
          !contactPhone
        ) {
          return res
            .status(400)
            .json({
              error:
                "company_invalid",

              message:
                "Datele firmei sau ale persoanei de contact sunt incomplete.",
            });
        }

        /*
         * Dacă livrarea este la altă adresă,
         * trebuie completată separat.
         */
        if (
          shipToDifferentAddress &&
          (
            !recipientName ||
            !phone ||
            !street ||
            !city ||
            !county
          )
        ) {
          return res
            .status(400)
            .json({
              error:
                "shipping_address_incomplete",

              message:
                "Adresa separată de livrare este incompletă.",
            });
        }
      }

      /*
       * =====================================================
       * CEREREA DE OFERTĂ
       * =====================================================
       */

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              quoteId,

            userId,
          },

          include: {
            product: {
              select: {
                id:
                  true,

                title:
                  true,
              },
            },

            service: {
              select: {
                id:
                  true,
              },
            },

            offers: {
              where: {
                id:
                  offerId,
              },

              take:
                1,
            },
          },
        });

      if (
        !quote
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
       * Dacă există deja o comandă,
       * nu mai creăm una nouă.
       */
      if (
        quote.orderId
      ) {
        return res.json({
          ok:
            true,

          alreadyAccepted:
            true,

          orderId:
            quote.orderId,
        });
      }

      if (
        [
          "CANCELLED",
          "REJECTED",
          "EXPIRED",
        ].includes(
          quote.status
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              "quote_not_acceptable",

            message:
              "Această cerere de ofertă nu mai poate fi acceptată.",
          });
      }

      const offer =
        Array.isArray(
          quote.offers
        )
          ? quote.offers[0]
          : null;

      if (
        !offer
      ) {
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
              "offer_not_acceptable",

            message:
              "Această ofertă nu mai poate fi acceptată.",
          });
      }

      /*
       * Oferta expirată nu mai
       * poate fi acceptată.
       */
      if (
        offer.validUntil &&
        new Date(
          offer.validUntil
        ).getTime() <=
          Date.now()
      ) {
        return res
          .status(409)
          .json({
            error:
              "offer_expired",

            message:
              "Această ofertă a expirat și nu mai poate fi acceptată.",
          });
      }

      /*
       * =====================================================
       * DATE OFERTĂ + SNAPSHOT PROMOȚIE
       * =====================================================
       */

      const rawOfferItems =
        Array.isArray(
          offer.items
        )
          ? offer.items
          : [];

      if (
        rawOfferItems.length ===
        0
      ) {
        return res
          .status(409)
          .json({
            error:
              "offer_has_no_items",

            message:
              "Oferta nu conține produse valide.",
          });
      }

      const offerItems =
        [];

      for (
        const rawItem of
        rawOfferItems
      ) {
        const quantity =
          Number.parseInt(
            rawItem?.quantity ??
              quote.quantity ??
              0,
            10
          );

        /*
         * Prețul final stabilit
         * în ofertă.
         */
        const finalUnitPrice =
          Number(
            rawItem?.unitPrice ??
              0
          );

        /*
         * Preț înainte de promoție.
         */
        const originalUnitPrice =
          Number(
            rawItem
              ?.originalUnitPrice ??
              finalUnitPrice
          );

        if (
          !Number.isInteger(
            quantity
          ) ||
          quantity <=
            0
        ) {
          return res
            .status(409)
            .json({
              error:
                "invalid_offer_quantity",

              message:
                "Cantitatea din ofertă nu este validă.",
            });
        }

        if (
          !Number.isFinite(
            finalUnitPrice
          ) ||
          finalUnitPrice <=
            0 ||
          !Number.isFinite(
            originalUnitPrice
          ) ||
          originalUnitPrice <
            finalUnitPrice
        ) {
          return res
            .status(409)
            .json({
              error:
                "invalid_offer_price",

              message:
                "Prețul din ofertă nu este valid.",
            });
        }

        const normalizedFinalUnitPrice =
          Math.round(
            finalUnitPrice *
              100
          ) /
          100;

        const normalizedOriginalUnitPrice =
          Math.round(
            originalUnitPrice *
              100
          ) /
          100;

        const finalLineTotal =
          Math.round(
            normalizedFinalUnitPrice *
              quantity *
              100
          ) /
          100;

        const originalLineTotal =
          Math.round(
            normalizedOriginalUnitPrice *
              quantity *
              100
          ) /
          100;

        const calculatedDiscountAmount =
          Math.max(
            0,

            Math.round(
              (
                originalLineTotal -
                finalLineTotal
              ) *
                100
            ) /
              100
          );

        const platformDiscountPercent =
          Number.isFinite(
            Number(
              rawItem
                ?.platformDiscountPercent
            )
          )
            ? Math.max(
                0,

                Math.min(
                  50,

                  Math.round(
                    Number(
                      rawItem
                        .platformDiscountPercent
                    )
                  )
                )
              )
            : 0;

        const vendorDiscountPercent =
          Number.isFinite(
            Number(
              rawItem
                ?.vendorDiscountPercent
            )
          )
            ? Math.max(
                0,

                Math.min(
                  50,

                  Math.round(
                    Number(
                      rawItem
                        .vendorDiscountPercent
                    )
                  )
                )
              )
            : 0;

        let platformDiscountAmount =
          Number.isFinite(
            Number(
              rawItem
                ?.platformDiscountAmount
            )
          )
            ? Math.max(
                0,

                Math.round(
                  Number(
                    rawItem
                      .platformDiscountAmount
                  ) *
                    100
                ) /
                  100
              )
            : 0;

        let vendorDiscountAmount =
          Number.isFinite(
            Number(
              rawItem
                ?.vendorDiscountAmount
            )
          )
            ? Math.max(
                0,

                Math.round(
                  Number(
                    rawItem
                      .vendorDiscountAmount
                  ) *
                    100
                ) /
                  100
              )
            : 0;

        /*
         * Partea Artfest + partea vendorului
         * trebuie să coincidă cu reducerea
         * totală din ofertă.
         */
        const splitDiscountTotal =
          Math.round(
            (
              platformDiscountAmount +
              vendorDiscountAmount
            ) *
              100
          ) /
          100;

        if (
          splitDiscountTotal !==
          calculatedDiscountAmount
        ) {
          const difference =
            Math.round(
              (
                calculatedDiscountAmount -
                splitDiscountTotal
              ) *
                100
            ) /
            100;

          if (
            platformDiscountPercent >
            0
          ) {
            platformDiscountAmount =
              Math.max(
                0,

                Math.round(
                  (
                    platformDiscountAmount +
                    difference
                  ) *
                    100
                ) /
                  100
              );
          } else {
            vendorDiscountAmount =
              Math.max(
                0,

                Math.round(
                  (
                    vendorDiscountAmount +
                    difference
                  ) *
                    100
                ) /
                  100
              );
          }
        }

        offerItems.push({
          productId:
            rawItem?.productId ||
            quote.productId ||
            null,

          title:
            String(
              rawItem?.title ||
                quote.product
                  ?.title ||
                "Produs comandat prin ofertă"
            ).trim(),

          quantity,

          finalUnitPrice:
            normalizedFinalUnitPrice,

          originalUnitPrice:
            normalizedOriginalUnitPrice,

          finalLineTotal,

          originalLineTotal,

          discountAmount:
            calculatedDiscountAmount,

          platformDiscountPercent,

          vendorDiscountPercent,

          platformDiscountAmount,

          vendorDiscountAmount,

          promoCollectionId:
            rawItem
              ?.promoCollectionId ||
            null,

          promoFundingSource:
            rawItem
              ?.promoFundingSource ||
            null,

          homepageFeatureId:
            rawItem
              ?.homepageFeatureId ||
            null,

          discountSource:
            rawItem
              ?.discountSource ||
            null,

          selectedOptions:
            normalizeObject(
              rawItem
                ?.selectedOptions
            ),

          customAnswers: {
            ...normalizeObject(
              rawItem
                ?.customAnswers
            ),

            ...normalizeObject(
              quote
                .quoteSchemaAnswers
            ),
          },

          configurationKey:
            String(
              rawItem
                ?.configurationKey ||
                `quote:${quote.id}:${rawItem?.productId || "custom"}`
            ).slice(
              0,
              64
            ),
        });
      }

      /*
       * =====================================================
       * TOTALURI
       * =====================================================
       */

      const subtotal =
        Math.round(
          offerItems.reduce(
            (
              sum,
              item
            ) =>
              sum +
              item.finalLineTotal,
            0
          ) *
            100
        ) /
        100;

      const shippingTotal =
        Number(
          offer.shippingTotal ??
            offer.shippingPrice ??
            0
        );

      if (
        !Number.isFinite(
          shippingTotal
        ) ||
        shippingTotal <
          0
      ) {
        return res
          .status(409)
          .json({
            error:
              "invalid_shipping_price",

            message:
              "Costul transportului din ofertă nu este valid.",
          });
      }

      const normalizedShippingTotal =
        Math.round(
          shippingTotal *
            100
        ) /
        100;

      const total =
        Math.round(
          (
            subtotal +
            normalizedShippingTotal
          ) *
            100
        ) /
        100;

      if (
        subtotal <= 0 ||
        total <= 0
      ) {
        return res
          .status(409)
          .json({
            error:
              "invalid_offer_total",

            message:
              "Oferta nu are un total valid și nu poate fi transformată în comandă.",
          });
      }

      const currency =
        String(
          offer.currency ||
            "RON"
        )
          .trim()
          .toUpperCase();

      /*
       * =====================================================
       * UTILIZATOR
       * =====================================================
       */

      const user =
        await prisma.user.findUnique({
          where: {
            id:
              userId,
          },

          select: {
            email:
              true,
          },
        });

      /*
       * =====================================================
       * ADRESA FINALĂ DE LIVRARE
       * =====================================================
       */

      const shippingAddress =
        customerType ===
          "PJ" &&
        !shipToDifferentAddress
          ? {
              name:
                contactName,

              email:
                contactEmail ||
                user?.email ||
                "",

              phone:
                contactPhone,

              street:
                billingStreet,

              city:
                billingCity,

              county:
                billingCounty,

              postalCode:
                billingPostalCode,

              companyName,
            }
          : {
              name:
                recipientName,

              email:
                shippingAddressInput
                  ?.email ||
                user?.email ||
                "",

              phone,

              street,

              city,

              county,

              postalCode,
            };

      const billingAddress =
        customerType ===
        "PJ"
          ? {
              companyName,

              companyCui,

              companyRegCom,

              county:
                billingCounty,

              city:
                billingCity,

              street:
                billingStreet,

              postalCode:
                billingPostalCode,
            }
          : null;

      const contactPerson =
        customerType ===
        "PJ"
          ? {
              name:
                contactName,

              email:
                contactEmail,

              phone:
                contactPhone,
            }
          : null;

      function generateOrderNumber() {
        const timestamp =
          Date.now()
            .toString(36)
            .toUpperCase();

        const random =
          Math.random()
            .toString(36)
            .slice(
              2,
              8
            )
            .toUpperCase();

        return `AF-${timestamp}-${random}`
          .slice(
            0,
            32
          );
      }

      /*
       * =====================================================
       * TRANZACȚIE ATOMICĂ
       * =====================================================
       */

      const result =
        await prisma.$transaction(
          async (
            tx
          ) => {
            const lockedQuote =
              await tx.quoteRequest.findUnique({
                where: {
                  id:
                    quote.id,
                },

                select: {
                  id:
                    true,

                  orderId:
                    true,

                  status:
                    true,
                },
              });

            if (
              !lockedQuote
            ) {
              throw new Error(
                "quote_not_found"
              );
            }

            /*
             * Protecție împotriva dublei
             * acceptări.
             */
            if (
              lockedQuote.orderId
            ) {
              return {
                orderId:
                  lockedQuote
                    .orderId,

                alreadyAccepted:
                  true,
              };
            }

            /*
             * Oferta poate trece din SENT
             * în ACCEPTED o singură dată.
             */
            const acceptedOffer =
              await tx.quoteOffer.updateMany({
                where: {
                  id:
                    offer.id,

                  quoteRequestId:
                    quote.id,

                  status:
                    "SENT",
                },

                data: {
                  status:
                    "ACCEPTED",
                },
              });

            if (
              acceptedOffer.count !==
              1
            ) {
              throw new Error(
                "offer_already_changed"
              );
            }

            /*
             * =================================================
             * ORDER
             * =================================================
             */

            const order =
              await tx.order.create({
                data: {
                  orderNumber:
                    generateOrderNumber(),

                  status:
                    "PENDING",

                  currency,

                  subtotal,

                  shippingTotal:
                    normalizedShippingTotal,

                  total,

                  paymentMethod,

                  shippingAddress,

                  billingAddress,

                  customerType,

                  contactPerson,

                  vendorNotes:
                    offer.notes ||
                    "",

                  userId,

                  customerName:
                    shippingAddress
                      ?.name ||
                    recipientName ||
                    contactName ||
                    null,

                  customerEmail:
                    shippingAddress
                      ?.email ||
                    user?.email ||
                    null,

                  customerPhone:
                    shippingAddress
                      ?.phone ||
                    phone ||
                    contactPhone ||
                    null,

                  isGuestOrder:
                    false,
                },
              });

            /*
             * =================================================
             * SHIPMENT + ITEMS
             * =================================================
             */

            const shipment =
              await tx.shipment.create({
                data: {
                  vendorId:
                    quote.vendorId,

                  orderId:
                    order.id,

                  serviceId:
                    quote.serviceId ||
                    null,

                  status:
                    "PENDING",

                  price:
                    normalizedShippingTotal,

                  items: {
                    create:
                      offerItems.map(
                        (
                          item
                        ) => ({
                          productId:
                            item.productId,

                          title:
                            item.title,

                          qty:
                            item.quantity,

                          price:
                            item.finalUnitPrice,

                          originalPrice:
                            item.discountAmount >
                            0
                              ? item.originalUnitPrice
                              : null,

                          discountAmount:
                            item.discountAmount,

                          platformDiscountPercent:
                            item.platformDiscountPercent,

                          vendorDiscountPercent:
                            item.vendorDiscountPercent,

                          platformDiscountAmount:
                            item.platformDiscountAmount,

                          vendorDiscountAmount:
                            item.vendorDiscountAmount,

                          promoCollectionId:
                            item.promoCollectionId,

                          promoFundingSource:
                            item.promoFundingSource,

                          homepageFeatureId:
                            item.homepageFeatureId,

                          discountSource:
                            item.discountSource,

                          customAnswers:
                            item.customAnswers,

                          selectedOptions:
                            item.selectedOptions,

                          configurationKey:
                            item.configurationKey,
                        })
                      ),
                  },
                },

                include: {
                  items:
                    true,
                },
              });

            /*
             * =================================================
             * QUOTE ACCEPTED
             * =================================================
             */

            await tx.quoteRequest.update({
              where: {
                id:
                  quote.id,
              },

              data: {
                status:
                  "ACCEPTED",

                orderId:
                  order.id,
              },
            });

            /*
             * =================================================
             * SINCRONIZARE CERERE PUBLICĂ
             *
             * Pentru QuoteRequest provenit din:
             * CustomerRequest -> CustomerRequestOffer
             * =================================================
             */

            const bridgeCustomerRequestId =
              String(
                quote.requestData
                  ?.customerRequestId ||
                  ""
              ).trim();

            const bridgeCustomerRequestOfferId =
              String(
                quote.requestData
                  ?.customerRequestOfferId ||
                  ""
              ).trim();

            if (
              quote.source ===
                "CUSTOM" &&
              bridgeCustomerRequestId &&
              bridgeCustomerRequestOfferId
            ) {
              const publicRequest =
                await tx.customerRequest.findFirst({
                  where: {
                    id:
                      bridgeCustomerRequestId,

                    userId,
                  },

                  select: {
                    id:
                      true,

                    status:
                      true,

                    acceptedOfferId:
                      true,
                  },
                });

              const publicOffer =
                await tx.customerRequestOffer.findFirst({
                  where: {
                    id:
                      bridgeCustomerRequestOfferId,

                    requestId:
                      bridgeCustomerRequestId,

                    vendorId:
                      quote.vendorId,
                  },

                  select: {
                    id:
                      true,

                    status:
                      true,
                  },
                });

              if (
                !publicRequest ||
                !publicOffer
              ) {
                throw new Error(
                  "customer_request_bridge_not_found"
                );
              }

              if (
                publicOffer.status !==
                  "SENT" &&
                publicOffer.status !==
                  "ACCEPTED"
              ) {
                throw new Error(
                  "customer_request_offer_not_acceptable"
                );
              }

              /*
               * Oferta publică aleasă.
               */
              await tx.customerRequestOffer.update({
                where: {
                  id:
                    publicOffer.id,
                },

                data: {
                  status:
                    "ACCEPTED",
                },
              });

              /*
               * Cererea publică.
               */
              await tx.customerRequest.update({
                where: {
                  id:
                    publicRequest.id,
                },

                data: {
                  status:
                    "ACCEPTED",

                  acceptedOfferId:
                    publicOffer.id,
                },
              });

              /*
               * Restul ofertelor publice.
               */
              await tx.customerRequestOffer.updateMany({
                where: {
                  requestId:
                    publicRequest.id,

                  id: {
                    not:
                      publicOffer.id,
                  },

                  status:
                    "SENT",
                },

                data: {
                  status:
                    "REJECTED",
                },
              });
            }

            /*
             * =================================================
             * RESTUL OFERTELOR DIN QUOTE
             * =================================================
             */

            await tx.quoteOffer.updateMany({
              where: {
                quoteRequestId:
                  quote.id,

                id: {
                  not:
                    offer.id,
                },

                status:
                  "SENT",
              },

              data: {
                status:
                  "SUPERSEDED",
              },
            });

            /*
             * Legăm conversația de comandă.
             */
            if (
              quote.threadId
            ) {
              await tx.messageThread.updateMany({
                where: {
                  id:
                    quote.threadId,
                },

                data: {
                  orderId:
                    order.id,
                },
              });
            }

            return {
              orderId:
                order.id,

              orderNumber:
                order.orderNumber,

              shipmentId:
                shipment.id,

              alreadyAccepted:
                false,
            };
          }
        );

      /*
       * =====================================================
       * EMAILURI COMANDĂ
       * =====================================================
       */

      if (
        !result.alreadyAccepted
      ) {
        const emailItems =
          offerItems.map(
            (
              item
            ) => ({
              title:
                item.title,

              qty:
                item.quantity,

              price:
                item.finalUnitPrice,

              originalPrice:
                item.discountAmount >
                0
                  ? item.originalUnitPrice
                  : null,

              discountAmount:
                item.discountAmount,

              platformDiscountPercent:
                item.platformDiscountPercent,

              vendorDiscountPercent:
                item.vendorDiscountPercent,
            })
          );

        /*
         * EMAIL CLIENT
         */
        try {
          if (
            user?.email
          ) {
            await sendOrderConfirmationEmail({
              to:
                user.email,

              userId,

              order: {
                id:
                  result.orderId,

                orderNumber:
                  result.orderNumber,

                currency,

                subtotal,

                shippingTotal:
                  normalizedShippingTotal,

                total,

                /*
                 * IMPORTANT:
                 * nu mai este hardcodat COD.
                 */
                paymentMethod,

                shippingAddress,

                billingAddress,

                customerType,

                contactPerson,
              },

              items:
                emailItems,
            });
          }
        } catch (
          emailError
        ) {
          console.error(
            "Quote order customer email failed:",
            emailError
          );
        }

        /*
         * EMAIL VENDOR
         */
        try {
          const vendor =
            await prisma.vendor.findUnique({
              where: {
                id:
                  quote.vendorId,
              },

              select: {
                displayName:
                  true,

                user: {
                  select: {
                    email:
                      true,
                  },
                },

                billing: {
                  select: {
                    email:
                      true,

                    vendorName:
                      true,
                  },
                },
              },
            });

          const vendorEmail =
            vendor?.billing
              ?.email ||
            vendor?.user
              ?.email ||
            null;

          const vendorName =
            vendor?.billing
              ?.vendorName ||
            vendor?.displayName ||
            "Vânzător";

          if (
            vendorEmail
          ) {
            await sendVendorNewOrderEmail({
              to:
                vendorEmail,

              vendorName,

              order: {
                id:
                  result.orderId,

                orderNumber:
                  result.orderNumber,

                paymentMethod,
              },

              items:
                emailItems,

              customerName:
                shippingAddress
                  ?.name ||
                recipientName ||
                contactName ||
                "Client",

              total,

              currency,
            });
          }
        } catch (
          emailError
        ) {
          console.error(
            "Quote order vendor email failed:",
            emailError
          );
        }
      }

      /*
       * =====================================================
       * NOTIFICARE VENDOR
       * =====================================================
       */

      if (
        !result.alreadyAccepted
      ) {
        try {
          await createVendorNotification(
            quote.vendorId,
            {
              type:
                "order",

              title:
                "Ofertă acceptată",

              body:
                "Clientul a acceptat oferta. Comanda a fost înregistrată în platformă.",

              link:
                "/vendor/orders",
            }
          );
        } catch (
          notificationError
        ) {
          console.error(
            "Quote accept vendor notification failed:",
            notificationError
          );
        }
      }

      /*
       * =====================================================
       * CARD — INIȚIERE PLATĂ
       * =====================================================
       */

      if (
        paymentMethod ===
          "CARD" &&
        !result.alreadyAccepted
      ) {
        try {
          /*
           * createPaymentForOrder() are nevoie
           * de comanda completă.
           */
          const createdOrder =
            await prisma.order.findUnique({
              where: {
                id:
                  result.orderId,
              },
            });

          if (
            !createdOrder
          ) {
            throw new Error(
              "created_order_not_found"
            );
          }

          const payment =
            await createPaymentForOrder(
              createdOrder
            );

          /*
           * Frontend-ul citește:
           *
           * result.payment.redirectUrl
           */
          return res.json({
            ok:
              true,

            quoteId:
              quote.id,

            offerId:
              offer.id,

            orderId:
              result.orderId,

            orderNumber:
              result.orderNumber,

            shipmentId:
              result.shipmentId ||
              null,

            status:
              "ACCEPTED",

            alreadyAccepted:
              false,

            total:
              Number(
                createdOrder.total
              ),

            subtotal:
              Number(
                createdOrder.subtotal
              ),

            shippingTotal:
              Number(
                createdOrder.shippingTotal
              ),

            currency:
              createdOrder.currency ||
              currency,

            payment,
          });
        } catch (
          paymentError
        ) {
          console.error(
            "Eroare la inițierea plății pentru comanda din ofertă:",
            paymentError
          );

          /*
           * Comanda există deja.
           * Nu spunem că acceptarea a eșuat,
           * ci doar inițierea plății.
           */
          return res
            .status(500)
            .json({
              error:
                "payment_init_failed",

              message:
                "Comanda a fost creată, dar inițierea plății a eșuat.",

              orderId:
                result.orderId,

              orderNumber:
                result.orderNumber,
            });
        }
      }

      /*
       * =====================================================
       * COD — RĂSPUNS NORMAL
       * =====================================================
       */

      return res.json({
        ok:
          true,

        quoteId:
          quote.id,

        offerId:
          offer.id,

        orderId:
          result.orderId,

        orderNumber:
          result.orderNumber ||
          null,

        shipmentId:
          result.shipmentId ||
          null,

        status:
          "ACCEPTED",

        alreadyAccepted:
          result.alreadyAccepted,

        paymentMethod,

        total,

        subtotal,

        shippingTotal:
          normalizedShippingTotal,

        currency,
      });
    } catch (
      error
    ) {
      console.error(
        "POST /api/assistant/quotes/:id/offers/:offerId/accept failed:",
        error
      );

      if (
        error?.message ===
        "offer_already_changed"
      ) {
        return res
          .status(409)
          .json({
            error:
              "offer_already_changed",

            message:
              "Oferta a fost deja acceptată, refuzată sau înlocuită.",
          });
      }

      if (
        error?.message ===
        "quote_not_found"
      ) {
        return res
          .status(404)
          .json({
            error:
              "quote_not_found",

            message:
              "Cererea de ofertă nu mai există.",
          });
      }

      if (
        error?.message ===
        "customer_request_bridge_not_found"
      ) {
        return res
          .status(409)
          .json({
            error:
              "customer_request_bridge_not_found",

            message:
              "Cererea asociată ofertei nu a mai putut fi identificată.",
          });
      }

      if (
        error?.message ===
        "customer_request_offer_not_acceptable"
      ) {
        return res
          .status(409)
          .json({
            error:
              "customer_request_offer_not_acceptable",

            message:
              "Oferta asociată cererii nu mai poate fi acceptată.",
          });
      }

      return res
        .status(500)
        .json({
          error:
            "quote_offer_accept_failed",

          message:
            "Comanda nu a putut fi creată. Oferta nu a fost acceptată.",
        });
    }
  }
);
/* =========================================================
   POST /api/assistant/quotes/:id/offers/:offerId/reject

   Clientul refuză definitiv oferta.
========================================================= */

router.post(
  "/:id/offers/:offerId/reject",

  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const quoteId =
        String(
          req.params.id || ""
        ).trim();

      const offerId =
        String(
          req.params.offerId ||
            ""
        ).trim();

      if (
        !quoteId ||
        !offerId
      ) {
        return res
          .status(400)
          .json({
            error:
              "missing_quote_or_offer_id",

            message:
              "Cererea sau oferta nu a putut fi identificată.",
          });
      }

      const quote =
        await prisma.quoteRequest.findFirst({
          where: {
            id:
              quoteId,

            userId,
          },

          select: {
            id:
              true,

            vendorId:
              true,

            threadId:
              true,

            status:
              true,

            orderId:
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
              "quote_already_accepted",

            message:
              "Oferta nu mai poate fi refuzată deoarece cererea a fost deja acceptată.",
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

          select: {
            id:
              true,

            status:
              true,
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
              "offer_not_rejectable",

            message:
              "Această ofertă nu mai poate fi refuzată.",
          });
      }

      await prisma.$transaction(
        async (tx) => {
          await tx.quoteOffer.update({
            where: {
              id:
                offer.id,
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
                lastAt:
                  new Date(),
              },
            });
          }
        }
      );

      try {
        await createVendorNotification(
          quote.vendorId,
          {
            type:
              "message",

            title:
              "Oferta a fost refuzată",

            body:
              "Clientul a refuzat oferta trimisă.",

            link:
              `/?assistant=vendor-quote&quoteId=${quote.id}`,
          }
        );
      } catch (
        notificationError
      ) {
        console.error(
          "Quote reject vendor notification failed:",
          notificationError
        );
      }

      return res.json({
        ok:
          true,

        quoteId:
          quote.id,

        offerId:
          offer.id,

        status:
          "REJECTED",
      });
    } catch (error) {
      console.error(
        "POST /api/assistant/quotes/:id/offers/:offerId/reject failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "quote_offer_reject_failed",

          message:
            "Oferta nu a putut fi refuzată.",
        });
    }
  }
);

export default router;