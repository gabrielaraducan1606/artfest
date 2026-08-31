// src/routes/customerRequestsRoutes.js

import { Router } from "express";

import { prisma } from "../db.js";

import {
  authRequired,
  optionalAuth,
} from "../api/auth.js";

import {
  openai,
} from "../lib/openai.js";

import {
  CATEGORIES,
} from "../constants/categories.js";

import {
  moderateMarketplaceMessage,
} from "../services/marketplaceMessageModeration.js";

const router = Router();

/* =========================================================
   CONSTANTE
========================================================= */

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

const VALID_BUDGET_TYPES =
  new Set([
    "TOTAL",
    "PER_ITEM",
  ]);

const PUBLIC_STATUSES =
  new Set([
    "OPEN",
    "ACCEPTED",
    "CLOSED",
    "EXPIRED",
  ]);

/* =========================================================
   HELPERS GENERALI
========================================================= */

function cleanString(
  value,
  maxLength = 5000
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .trim()
    .slice(
      0,
      maxLength
    );
}

function optionalString(
  value,
  maxLength = 5000
) {
  const cleaned =
    cleanString(
      value,
      maxLength
    );

  return (
    cleaned ||
    null
  );
}

function optionalPositiveInt(
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
    !Number.isInteger(
      number
    ) ||
    number < 0
  ) {
    return null;
  }

  return number;
}

function parseDate(
  value
) {
  if (!value) {
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

function slugifyCity(
  value
) {
  const city =
    cleanString(
      value,
      120
    );

  if (!city) {
    return null;
  }

  return city
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    )
    .slice(
      0,
      64
    );
}

function normalizeImages(
  value
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return value
    .map(
      (item) =>
        cleanString(
          item,
          2000
        )
    )
    .filter(Boolean)
    .slice(
      0,
      10
    );
}

/* =========================================================
   HELPERS OFERTE CERERI PUBLICE
========================================================= */

function requiredPositiveInt(
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

function optionalNonNegativeInt(
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
    !Number.isInteger(
      number
    ) ||
    number < 0
  ) {
    return null;
  }

  return number;
}

async function getVendorForUser(
  userId
) {
  if (!userId) {
    return null;
  }

  return prisma.vendor.findUnique({
    where: {
      userId,
    },

    select: {
      id: true,
      userId: true,
      displayName: true,
      logoUrl: true,
      isActive: true,
    },
  });
}

function serializeCustomerRequestOffer(
  offer
) {
  if (!offer) {
    return null;
  }

  return {
    id:
      offer.id,

    requestId:
      offer.requestId,

    vendorId:
      offer.vendorId,

    status:
      offer.status,

    unitPriceCents:
      offer.unitPriceCents,

    totalPriceCents:
      offer.totalPriceCents,

    shippingCents:
      offer.shippingCents,

    currency:
      offer.currency,

    productionDays:
      offer.productionDays,

    estimatedDelivery:
      offer.estimatedDelivery,

    message:
      offer.message,

    images:
      offer.images ||
      [],

    validUntil:
      offer.validUntil,

    createdAt:
      offer.createdAt,

    updatedAt:
      offer.updatedAt,

    vendor:
      offer.vendor
        ? {
            id:
              offer.vendor.id,

            displayName:
              offer.vendor
                .displayName,

            logoUrl:
              offer.vendor
                .logoUrl ||
              null,
          }
        : null,
  };
}

/* =========================================================
   MODERARE MARKETPLACE
========================================================= */

const MODERATION_TECHNICAL_REASONS =
  new Set([
    "text_moderation_failed",
    "text_moderation_invalid_response",
    "text_moderation_ambiguous_response",
  ]);

async function moderateCustomerRequestText({
  title = "",
  description = "",
  message = "",
}) {
  const moderationText =
    [
      cleanString(
        title,
        180
      ),

      cleanString(
        description,
        5000
      ),

      cleanString(
        message,
        4000
      ),
    ]
      .filter(Boolean)
      .join("\n")
      .trim();

  if (!moderationText) {
    return {
      allowed: true,
      reason: null,
      detections: [],
    };
  }

  return moderateMarketplaceMessage({
    text:
      moderationText,

    senderType:
      "USER",
  });
}

function sendModerationResponse(
  res,
  moderation,
  {
    technicalMessage =
      "Cererea nu a putut fi verificată momentan. Încearcă din nou peste câteva secunde.",

    blockedMessage =
      "Cererea nu poate fi publicată deoarece conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
  } = {}
) {
  const isTechnicalError =
    MODERATION_TECHNICAL_REASONS.has(
      moderation?.reason
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
          : "customer_request_blocked",

      reason:
        moderation?.reason ||
        "not_allowed",

      detections:
        moderation?.detections ||
        [],

      message:
        isTechnicalError
          ? technicalMessage
          : blockedMessage,
    });
}

/* =========================================================
   HELPERS AI
========================================================= */

function safeJsonParse(
  text
) {
  let raw =
    String(
      text || ""
    ).trim();

  raw = raw
    .replace(
      /^```json/i,
      ""
    )
    .replace(
      /^```/i,
      ""
    )
    .replace(
      /```$/i,
      ""
    )
    .trim();

  try {
    return JSON.parse(
      raw
    );
  } catch {
    // încercăm să extragem obiectul JSON
  }

  const start =
    raw.indexOf("{");

  const end =
    raw.lastIndexOf("}");

  if (
    start >= 0 &&
    end > start
  ) {
    try {
      return JSON.parse(
        raw.slice(
          start,
          end + 1
        )
      );
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeImageModerationResult(
  value
) {
  const detected =
    Boolean(
      value?.phoneNumberDetected
    );

  return {
    allowed:
      !detected,

    phoneNumberDetected:
      detected,

    confidence:
      ["low", "medium", "high"]
        .includes(
          String(
            value?.confidence ||
              ""
          ).toLowerCase()
        )
        ? String(
            value.confidence
          ).toLowerCase()
        : "low",
  };
}

function cleanQuestions(
  value
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return value
    .map(
      (item) =>
        String(
          item || ""
        )
          .trim()
          .slice(
            0,
            300
          )
    )
    .filter(Boolean)
    .slice(
      0,
      4
    );
}

function normalizeAiNumber(
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

  return number;
}

function normalizeAiQuantity(
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
    !Number.isInteger(
      number
    ) ||
    number < 1
  ) {
    return null;
  }

  return number;
}

function normalizeAiDate(
  value
) {
  const text =
    String(
      value || ""
    ).trim();

  if (!text) {
    return null;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      text
    )
  ) {
    return null;
  }

  const date =
    new Date(
      `${text}T12:00:00`
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return text;
}

/* =========================================================
   USER DISPLAY
========================================================= */

function getDisplayName(
  user
) {
  if (!user) {
    return "Client Artfest";
  }

  if (
    cleanString(
      user.name
    )
  ) {
    return cleanString(
      user.name,
      160
    );
  }

  const fullName = [
    cleanString(
      user.firstName,
      80
    ),

    cleanString(
      user.lastName,
      80
    ),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    fullName ||
    "Client Artfest"
  );
}

/* =========================================================
   SERIALIZARE
========================================================= */

function serializeRequest(
  request
) {
  if (!request) {
    return null;
  }

  const user =
    request.user ||
    null;

  return {
    id:
      request.id,

    title:
      request.title,

    description:
      request.description,

    category:
      request.category,

    quantity:
      request.quantity,

    budgetMinCents:
      request.budgetMinCents,

    budgetMaxCents:
      request.budgetMaxCents,

    budgetType:
      request.budgetType,

    currency:
      request.currency,

    deliveryDeadline:
      request.deliveryDeadline,

    city:
      request.city,

    images:
      request.images ||
      [],

    details:
      request.details ||
      null,

    status:
      request.status,

    expiresAt:
      request.expiresAt,

    acceptedOfferId:
      request.acceptedOfferId,

    createdAt:
      request.createdAt,

    updatedAt:
      request.updatedAt,

    offersCount:
      request._count
        ?.offers ??
      0,

    user:
      user
        ? {
            id:
              user.id,

            name:
              getDisplayName(
                user
              ),

            avatarUrl:
              user.avatarUrl ||
              null,

            city:
              user.city ||
              null,
          }
        : null,
  };
}

/* =========================================================
   INCLUDE PUBLIC

   Nu trimitem email / telefon.
========================================================= */

const publicRequestInclude = {
  user: {
    select: {
      id: true,

      name: true,

      firstName: true,

      lastName: true,

      avatarUrl: true,

      city: true,
    },
  },

  _count: {
    select: {
      offers: true,
    },
  },
};

/* =========================================================
   GET /api/customer-requests
========================================================= */

router.get(
  "/",
  async (
    req,
    res
  ) => {
    try {
      const requestedLimit =
        Number(
          req.query.limit
        );

      const limit =
        Number.isInteger(
          requestedLimit
        ) &&
        requestedLimit > 0
          ? Math.min(
              requestedLimit,
              MAX_LIMIT
            )
          : DEFAULT_LIMIT;

      const requestedPage =
        Number(
          req.query.page
        );

      const page =
        Number.isInteger(
          requestedPage
        ) &&
        requestedPage > 0
          ? requestedPage
          : 1;

      const category =
        optionalString(
          req.query
            .category,
          64
        );

      const city =
        optionalString(
          req.query.city,
          120
        );

      const rawStatus =
        cleanString(
          req.query.status ||
            "OPEN",
          30
        ).toUpperCase();

      const status =
        PUBLIC_STATUSES.has(
          rawStatus
        )
          ? rawStatus
          : "OPEN";

      const where = {
        status,
      };

      if (category) {
        where.category =
          category;
      }

      if (city) {
        where.citySlug =
          slugifyCity(
            city
          );
      }

      if (
        status ===
        "OPEN"
      ) {
        where.AND = [
          {
            OR: [
              {
                expiresAt:
                  null,
              },

              {
                expiresAt: {
                  gt:
                    new Date(),
                },
              },
            ],
          },
        ];
      }

      const [
        requests,
        total,
      ] =
        await Promise.all([
          prisma
            .customerRequest
            .findMany({
              where,

              include:
                publicRequestInclude,

              orderBy: {
                createdAt:
                  "desc",
              },

              skip:
                (page - 1) *
                limit,

              take:
                limit,
            }),

          prisma
            .customerRequest
            .count({
              where,
            }),
        ]);

      return res.json({
        ok: true,

        items:
          requests.map(
            serializeRequest
          ),

        pagination: {
          page,

          limit,

          total,

          pages:
            Math.ceil(
              total /
                limit
            ),

          hasMore:
            page *
              limit <
            total,
        },
      });
    } catch (error) {
      console.error(
        "[customer-requests] list failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "customer_requests_list_failed",

          message:
            "Cererile nu au putut fi încărcate.",
        });
    }
  }
);
/* =========================================================
   POST /api/customer-requests/:id/offers

   Doar vendorii activi pot trimite ofertă.
   Un vendor poate avea o singură ofertă per cerere.

   ✅ După trimiterea ofertei:
   clientul primește notificare.
========================================================= */

router.post(
  "/:id/offers",
  authRequired,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user?.id ||
        req.user?.sub;

      if (!userId) {
        return res
          .status(401)
          .json({
            error:
              "unauthorized",

            message:
              "Trebuie să fii autentificat.",
          });
      }

      const requestId =
        cleanString(
          req.params.id,
          100
        );

      if (!requestId) {
        return res
          .status(400)
          .json({
            error:
              "invalid_request_id",

            message:
              "Cererea nu este validă.",
          });
      }

      /* =====================================================
         VERIFICĂM VENDORUL
      ===================================================== */

      const vendor =
        await getVendorForUser(
          userId
        );

      if (
        !vendor ||
        !vendor.isActive
      ) {
        return res
          .status(403)
          .json({
            error:
              "vendor_required",

            message:
              "Doar vânzătorii Artfest pot trimite oferte.",
          });
      }

      /* =====================================================
         CEREREA
      ===================================================== */

      const customerRequest =
        await prisma
          .customerRequest
          .findUnique({
            where: {
              id:
                requestId,
            },

            select: {
              id: true,
              userId: true,
              title: true,
              quantity: true,
              status: true,
              expiresAt: true,
              currency: true,
            },
          });

      if (!customerRequest) {
        return res
          .status(404)
          .json({
            error:
              "customer_request_not_found",

            message:
              "Cererea nu există.",
          });
      }

      /* =====================================================
         DOAR CERERI DESCHISE
      ===================================================== */

      if (
        customerRequest.status !==
        "OPEN"
      ) {
        return res
          .status(409)
          .json({
            error:
              "customer_request_not_open",

            message:
              "Această cerere nu mai primește oferte.",
          });
      }

      /* =====================================================
         VERIFICĂM EXPIRAREA
      ===================================================== */

      if (
        customerRequest.expiresAt &&
        customerRequest.expiresAt <
          new Date()
      ) {
        return res
          .status(409)
          .json({
            error:
              "customer_request_expired",

            message:
              "Această cerere a expirat și nu mai primește oferte.",
          });
      }

      /* =====================================================
         NU POATE OFERTA PROPRIA CERERE
      ===================================================== */

      if (
        String(
          customerRequest.userId
        ) ===
        String(
          userId
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              "cannot_offer_own_request",

            message:
              "Nu poți trimite o ofertă propriei tale cereri.",
          });
      }

      /* =====================================================
         DATE OFERTĂ
      ===================================================== */

      const unitPriceCents =
        requiredPositiveInt(
          req.body
            ?.unitPriceCents
        );

      const shippingCentsRaw =
        optionalNonNegativeInt(
          req.body
            ?.shippingCents
        );

      const shippingCents =
        shippingCentsRaw ??
        0;

      const productionDays =
        requiredPositiveInt(
          req.body
            ?.productionDays
        );

      const message =
        optionalString(
          req.body?.message,
          3000
        );

      const images =
        normalizeImages(
          req.body?.images
        );

      const validUntil =
        req.body?.validUntil
          ? parseDate(
              req.body
                .validUntil
            )
          : null;

      const explicitTotalPriceCents =
        optionalNonNegativeInt(
          req.body
            ?.totalPriceCents
        );

      /* =====================================================
         VALIDARE PREȚ
      ===================================================== */

      if (!unitPriceCents) {
        return res
          .status(400)
          .json({
            error:
              "invalid_unit_price",

            message:
              "Prețul pe bucată trebuie să fie mai mare decât 0.",
          });
      }

      /* =====================================================
         VALIDARE ZILE PRODUCȚIE
      ===================================================== */

      if (!productionDays) {
        return res
          .status(400)
          .json({
            error:
              "invalid_production_days",

            message:
              "Numărul de zile de producție trebuie să fie mai mare decât 0.",
          });
      }

      /* =====================================================
         VALIDARE TRANSPORT
      ===================================================== */

      if (
        req.body
          ?.shippingCents !==
          undefined &&
        req.body
          ?.shippingCents !==
          null &&
        req.body
          ?.shippingCents !==
          "" &&
        shippingCentsRaw ===
          null
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_shipping_price",

            message:
              "Costul transportului nu este valid.",
          });
      }

      /* =====================================================
         VALIDARE TOTAL
      ===================================================== */

      if (
        req.body
          ?.totalPriceCents !==
          undefined &&
        req.body
          ?.totalPriceCents !==
          null &&
        req.body
          ?.totalPriceCents !==
          "" &&
        explicitTotalPriceCents ===
          null
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_total_price",

            message:
              "Prețul total nu este valid.",
          });
      }

      /* =====================================================
         VALIDARE VALABILITATE
      ===================================================== */

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
              "Data de valabilitate a ofertei nu este validă.",
          });
      }

      if (
        validUntil &&
        validUntil <
          new Date()
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_valid_until",

            message:
              "Valabilitatea ofertei trebuie să fie în viitor.",
          });
      }

      /* =====================================================
         MODERARE MESAJ VENDOR
      ===================================================== */

      if (message) {
        const moderation =
          await moderateMarketplaceMessage({
            text:
              message,

            senderType:
              "VENDOR",
          });

        if (
          !moderation.allowed
        ) {
          const isTechnicalError =
            MODERATION_TECHNICAL_REASONS.has(
              moderation?.reason
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
                  : "customer_request_offer_blocked",

              reason:
                moderation?.reason ||
                "not_allowed",

              detections:
                moderation?.detections ||
                [],

              message:
                isTechnicalError
                  ? "Oferta nu a putut fi verificată momentan. Încearcă din nou peste câteva secunde."
                  : "Oferta nu poate fi trimisă deoarece mesajul conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
            });
        }
      }

      /* =====================================================
         TOTAL

         Dacă avem cantitate:
         cantitate * preț/buc + transport

         Dacă nu avem cantitate:
         folosim totalPriceCents dacă frontend-ul îl trimite.
      ===================================================== */

      let totalPriceCents =
        explicitTotalPriceCents;

      if (
        customerRequest
          .quantity &&
        Number.isInteger(
          customerRequest
            .quantity
        ) &&
        customerRequest
          .quantity >
          0
      ) {
        totalPriceCents =
          (
            customerRequest
              .quantity *
            unitPriceCents
          ) +
          shippingCents;
      }

      /* =====================================================
         ESTIMARE LIVRARE
      ===================================================== */

      const estimatedDelivery =
        new Date();

      estimatedDelivery.setDate(
        estimatedDelivery
          .getDate() +
          productionDays
      );

      /* =====================================================
         VERIFICĂM DACĂ VENDORUL ARE DEJA OFERTĂ
      ===================================================== */

      const existingOffer =
        await prisma
          .customerRequestOffer
          .findUnique({
            where: {
              requestId_vendorId: {
                requestId,

                vendorId:
                  vendor.id,
              },
            },

            select: {
              id: true,
              status: true,
            },
          });

      if (existingOffer) {
        return res
          .status(409)
          .json({
            error:
              "offer_already_exists",

            offerId:
              existingOffer.id,

            message:
              "Ai trimis deja o ofertă pentru această cerere.",
          });
      }

      /* =====================================================
         CREARE OFERTĂ
      ===================================================== */

      const offer =
        await prisma
          .customerRequestOffer
          .create({
            data: {
              requestId,

              vendorId:
                vendor.id,

              status:
                "SENT",

              unitPriceCents,

              totalPriceCents,

              shippingCents,

              currency:
                customerRequest
                  .currency ||
                "RON",

              productionDays,

              estimatedDelivery,

              message,

              images,

              validUntil,
            },

            include: {
              vendor: {
                select: {
                  id: true,

                  displayName:
                    true,

                  logoUrl:
                    true,
                },
              },
            },
          });

      /* =====================================================
         NOTIFICARE CLIENT
      ===================================================== */

      try {
        const vendorName =
          offer.vendor
            ?.displayName ||
          vendor.displayName ||
          "Un creator Artfest";

        const requestTitle =
          customerRequest.title ||
          "cererea ta";

        await prisma
          .notification
          .create({
            data: {
              userId:
                customerRequest
                  .userId,

              vendorId:
                null,

              type:
                "message",

              title:
                "Ai primit o ofertă nouă 🎉",

              body:
                `${vendorName} a răspuns la cererea „${requestTitle}”. ` +
                `Intră pentru a vedea oferta și detaliile propuse.`,

              link:
                `/cereri/${customerRequest.id}`,

              dedupeKey:
                `customer_request_offer:${customerRequest.userId}:${offer.id}`,

              meta: {
                kind:
                  "customer_request_offer_created",

                requestId:
                  customerRequest.id,

                offerId:
                  offer.id,

                vendorId:
                  vendor.id,
              },
            },
          });
      } catch (
        notificationError
      ) {
        /*
         * IMPORTANT:
         * oferta a fost deja creată.
         * Dacă notificarea eșuează,
         * nu vrem să raportăm vendorului
         * că oferta nu a fost trimisă.
         */
        if (
          notificationError?.code !==
          "P2002"
        ) {
          console.error(
            "[customer-requests] offer notification failed:",
            notificationError
          );
        }
      }

      /* =====================================================
         RESPONSE
      ===================================================== */

      return res
        .status(201)
        .json({
          ok: true,

          message:
            "Oferta a fost trimisă clientului.",

          offer:
            serializeCustomerRequestOffer(
              offer
            ),
        });
    } catch (error) {
      console.error(
        "[customer-requests] create offer failed:",
        error
      );

      /* =====================================================
         CONSTRAINT DUPLICATE
      ===================================================== */

      if (
        error?.code ===
        "P2002"
      ) {
        return res
          .status(409)
          .json({
            error:
              "offer_already_exists",

            message:
              "Ai trimis deja o ofertă pentru această cerere.",
          });
      }

      return res
        .status(500)
        .json({
          error:
            "customer_request_offer_create_failed",

          message:
            "Oferta nu a putut fi trimisă. Încearcă din nou.",
        });
    }
  }
);

/* =========================================================
   POST
   /api/customer-requests/:requestId/offers/:offerId/continue

   Clientul alege o ofertă publică și continuă
   procesul în asistentul AI existent.

   Creează:
   - MessageThread
   - QuoteRequest CUSTOM
   - QuoteOffer SENT

   NU creează încă Order.
   Comanda se creează ulterior prin flow-ul existent
   din assistantQuotesRoutes.
========================================================= */

router.post(
  "/:requestId/offers/:offerId/continue",
  authRequired,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user?.id ||
        req.user?.sub ||
        null;

      if (!userId) {
        return res
          .status(401)
          .json({
            error:
              "unauthorized",

            message:
              "Trebuie să fii autentificat.",
          });
      }

      const requestId =
        cleanString(
          req.params
            .requestId,
          100
        );

      const offerId =
        cleanString(
          req.params
            .offerId,
          100
        );

      if (
        !requestId ||
        !offerId
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_request_or_offer",

            message:
              "Cererea sau oferta nu este validă.",
          });
      }

      /* =====================================================
         ÎNCĂRCĂM OFERTA + CEREREA
      ===================================================== */

      const offer =
        await prisma
          .customerRequestOffer
          .findFirst({
            where: {
              id:
                offerId,

              requestId,
            },

            include: {
              vendor: {
                select: {
                  id: true,

                  displayName:
                    true,

                  isActive:
                    true,

                  logoUrl:
                    true,
                },
              },

              request: {
                select: {
                  id: true,

                  userId:
                    true,

                  title:
                    true,

                  description:
                    true,

                  quantity:
                    true,

                  budgetMinCents:
                    true,

                  budgetMaxCents:
                    true,

                  budgetType:
                    true,

                  currency:
                    true,

                  deliveryDeadline:
                    true,

                  city:
                    true,

                  images:
                    true,

                  details:
                    true,

                  status:
                    true,

                  acceptedOfferId:
                    true,

                  user: {
                    select: {
                      id: true,

                      name: true,

                      firstName:
                        true,

                      lastName:
                        true,
                    },
                  },
                },
              },
            },
          });

      if (
        !offer ||
        !offer.request
      ) {
        return res
          .status(404)
          .json({
            error:
              "customer_request_offer_not_found",

            message:
              "Oferta nu a fost găsită.",
          });
      }

      const customerRequest =
        offer.request;

      /* =====================================================
         DOAR PROPRIETARUL CERERII POATE CONTINUA
      ===================================================== */

      if (
        String(
          customerRequest
            .userId
        ) !==
        String(
          userId
        )
      ) {
        return res
          .status(403)
          .json({
            error:
              "not_request_owner",

            message:
              "Doar persoana care a publicat cererea poate continua cu această ofertă.",
          });
      }

      /* =====================================================
         VALIDĂM CEREREA
      ===================================================== */

      if (
        customerRequest
          .status !==
        "OPEN"
      ) {
        return res
          .status(409)
          .json({
            error:
              "customer_request_not_open",

            message:
              "Această cerere nu mai poate primi o ofertă nouă.",
          });
      }

      if (
        customerRequest
          .acceptedOfferId
      ) {
        return res
          .status(409)
          .json({
            error:
              "customer_request_already_accepted",

            message:
              "Ai ales deja o ofertă pentru această cerere.",
          });
      }

      /* =====================================================
         VALIDĂM OFERTA
      ===================================================== */

      if (
        offer.status !==
        "SENT"
      ) {
        return res
          .status(409)
          .json({
            error:
              "offer_not_available",

            message:
              "Această ofertă nu mai poate fi continuată.",
          });
      }

      if (
        !offer.vendor ||
        !offer.vendor
          .isActive
      ) {
        return res
          .status(409)
          .json({
            error:
              "vendor_not_available",

            message:
              "Vânzătorul nu mai este disponibil.",
          });
      }

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
              "Această ofertă a expirat.",
          });
      }

      /* =====================================================
         PREȚURI

         CustomerRequestOffer = CENTS
         QuoteOffer           = LEI
      ===================================================== */

      const unitPriceCents =
        Number(
          offer.unitPriceCents ||
            0
        );

      const shippingCents =
        Number(
          offer.shippingCents ||
            0
        );

      const totalPriceCents =
        Number(
          offer.totalPriceCents ||
            0
        );

      if (
        !Number.isFinite(
          unitPriceCents
        ) ||
        unitPriceCents <= 0
      ) {
        return res
          .status(409)
          .json({
            error:
              "invalid_offer_price",

            message:
              "Oferta nu are un preț valid.",
          });
      }

      const quantity =
        Number(
          customerRequest
            .quantity
        );

      /*
       * Flow-ul actual de acceptare din Assistant
       * are nevoie de cantitate pentru ShipmentItem.
       *
       * Nu inventăm 1 bucată.
       */
      if (
        !Number.isInteger(
          quantity
        ) ||
        quantity <= 0
      ) {
        return res
          .status(409)
          .json({
            error:
              "quantity_required_for_checkout",

            message:
              "Pentru a continua cu oferta trebuie completată cantitatea în cerere.",
          });
      }

      const unitPrice =
        Math.round(
          (
            unitPriceCents /
            100
          ) *
            100
        ) /
        100;

      const shippingTotal =
        Math.round(
          (
            Math.max(
              0,
              shippingCents
            ) /
            100
          ) *
            100
        ) /
        100;

      const calculatedSubtotal =
        Math.round(
          (
            unitPrice *
            quantity
          ) *
            100
        ) /
        100;

      /*
       * Totalul din oferta publică este sursa
       * de adevăr dacă există.
       */
      const total =
        totalPriceCents > 0
          ? Math.round(
              (
                totalPriceCents /
                100
              ) *
                100
            ) /
            100
          : Math.round(
              (
                calculatedSubtotal +
                shippingTotal
              ) *
                100
            ) /
            100;

      /*
       * QuoteOffer cere subtotal separat.
       */
      const subtotal =
        Math.max(
          0,
          Math.round(
            (
              total -
              shippingTotal
            ) *
              100
          ) /
            100
        );

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
              "Oferta nu are un total valid.",
          });
      }

      const currency =
        cleanString(
          offer.currency ||
            customerRequest
              .currency ||
            "RON",
          10
        ).toUpperCase();

      /* =====================================================
         GĂSIM UN SERVICE ACTIV AL VENDORULUI

         Nu este obligatoriu pentru QuoteRequest,
         dar este util pentru magazin / Shipment.
      ===================================================== */

      const vendorService =
        await prisma
          .vendorService
          .findFirst({
            where: {
              vendorId:
                offer.vendorId,

              isActive:
                true,
            },

            orderBy: {
              updatedAt:
                "desc",
            },

            select: {
              id: true,
            },
          });

      const serviceId =
        vendorService?.id ||
        null;

      /* =====================================================
         IDEMPOTENȚĂ

         Dacă utilizatorul apasă de două ori butonul,
         nu creăm două QuoteRequest-uri.

         Folosim internalNote pe MessageThread
         ca marker tehnic.
      ===================================================== */

      const bridgeKey =
        `customer-request-offer:${offer.id}`;

      const existingBridge =
        await prisma
          .messageThread
          .findFirst({
            // Pin explicit pe "query": relația `offers` are aici
            // orderBy+take(1) nested (top-1-per-grup) - zona
            // documentată ca posibil diferită sub strategia "join"
            // (LATERAL+LIMIT). Nu am verificat echivalența, deci
            // păstrăm comportamentul actual în mod explicit.
            relationLoadStrategy: "query",

            where: {
              userId,

              vendorId:
                offer.vendorId,

              internalNote:
                bridgeKey,
            },

            select: {
              id: true,

              quoteRequest: {
                select: {
                  id: true,

                  offers: {
                    orderBy: {
                      createdAt:
                        "desc",
                    },

                    take:
                      1,

                    select: {
                      id:
                        true,
                    },
                  },
                },
              },
            },
          });

      if (
        existingBridge
          ?.quoteRequest
          ?.id
      ) {
        return res.json({
          ok:
            true,

          reused:
            true,

          quoteId:
            existingBridge
              .quoteRequest
              .id,

          offerId:
            existingBridge
              .quoteRequest
              .offers?.[0]
              ?.id ||
            null,

          threadId:
            existingBridge.id,
        });
      }

      /* =====================================================
         DATE PENTRU ASSISTANT
      ===================================================== */

      const customerName =
        getDisplayName(
          customerRequest.user
        );

      const requestData = {
        source:
          "CUSTOMER_REQUEST",

        customerRequestId:
          customerRequest.id,

        customerRequestOfferId:
          offer.id,

        title:
          customerRequest.title,

        description:
          customerRequest.description,

        city:
          customerRequest.city ||
          null,

        images:
          customerRequest.images ||
          [],

        offerImages:
          offer.images ||
          [],

        offerMessage:
          offer.message ||
          null,
      };

      /*
       * IMPORTANT:
       *
       * QuoteOffer.items folosește valori în LEI,
       * exact ca flow-ul existent al Assistantului.
       */
      const quoteItems = [
        {
          productId:
            null,

          title:
            customerRequest.title ||
            "Produs personalizat",

          quantity,

          unitPrice,

          originalUnitPrice:
            unitPrice,

          selectedOptions:
            {},

          customAnswers:
            customerRequest
              .details &&
            typeof customerRequest
              .details ===
              "object" &&
            !Array.isArray(
              customerRequest
                .details
            )
              ? customerRequest
                  .details
              : {},

          configurationKey:
            `customer-request:${customerRequest.id}`
              .slice(
                0,
                64
              ),
        },
      ];

      const threadText =
        `Ofertă pentru cererea „${customerRequest.title}”`;

      /* =====================================================
         CREARE ATOMICĂ BRIDGE
      ===================================================== */

      const result =
        await prisma
          .$transaction(
            async (
              tx
            ) => {
              /* -------------------------------
                 THREAD
              ------------------------------- */

              const thread =
                await tx
                  .messageThread
                  .create({
                    data: {
                      type:
                        "CUSTOMER",

                      vendorId:
                        offer.vendorId,

                      serviceId,

                      userId,

                      contactName:
                        customerName ||
                        null,

                      /*
                       * Nu expunem date de contact
                       * în conversație.
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
                        "IN_DISCUSSION",

                      lastMsg:
                        threadText,

                      lastAt:
                        new Date(),

                      internalNote:
                        bridgeKey,
                    },

                    select: {
                      id:
                        true,
                    },
                  });

              /* -------------------------------
                 QUOTE REQUEST
              ------------------------------- */

              const quoteRequest =
                await tx
                  .quoteRequest
                  .create({
                    data: {
                      userId,

                      vendorId:
                        offer.vendorId,

                      serviceId,

                      productId:
                        null,

                      threadId:
                        thread.id,

                      source:
                        "CUSTOM",

                      status:
                        "OFFER_SENT",

                      quantity,

                      requestData,

                      quoteSchemaAnswers:
                        {},

                      eventDate:
                        null,

                      deliveryDeadline:
                        customerRequest
                          .deliveryDeadline ||
                        null,

                      budgetMin:
                        customerRequest
                          .budgetMinCents !=
                        null
                          ? Math.round(
                              customerRequest
                                .budgetMinCents /
                                100
                            )
                          : null,

                      budgetMax:
                        customerRequest
                          .budgetMaxCents !=
                        null
                          ? Math.round(
                              customerRequest
                                .budgetMaxCents /
                                100
                            )
                          : null,
                    },

                    select: {
                      id:
                        true,
                    },
                  });

              /* -------------------------------
                 QUOTE OFFER
              ------------------------------- */

              const quoteOffer =
                await tx
                  .quoteOffer
                  .create({
                    data: {
                      quoteRequestId:
                        quoteRequest.id,

                      status:
                        "SENT",

                      items:
                        quoteItems,

                      subtotal,

                      shippingTotal,

                      total,

                      currency,

                      productionDays:
                        offer.productionDays ||
                        null,

                      estimatedDelivery:
                        offer.estimatedDelivery ||
                        null,

                      validUntil:
                        offer.validUntil ||
                        null,

                      notes:
                        offer.message ||
                        null,
                    },

                    select: {
                      id:
                        true,
                    },
                  });

              /* -------------------------------
                 MESAJ INIȚIAL VENDOR

                 Oferta apare și ca început
                 al conversației.
              ------------------------------- */

              await tx
                .message
                .create({
                  data: {
                    threadId:
                      thread.id,

                    vendorId:
                      offer.vendorId,

                    senderVendorId:
                      offer.vendorId,

                    authorType:
                      "VENDOR",

                    authorUserId:
                      null,

                    authorName:
                      offer.vendor
                        ?.displayName ||
                      "Creator Artfest",

                    body:
                      offer.message ||
                      `Am trimis o ofertă pentru cererea „${customerRequest.title}”.`,
                  },
                });

              return {
                quoteId:
                  quoteRequest.id,

                offerId:
                  quoteOffer.id,

                threadId:
                  thread.id,
              };
            }
          );

      return res
        .status(201)
        .json({
          ok:
            true,

          reused:
            false,

          quoteId:
            result.quoteId,

          offerId:
            result.offerId,

          threadId:
            result.threadId,
        });
    } catch (error) {
      console.error(
        "[customer-requests] continue offer failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "customer_request_offer_continue_failed",

          message:
            "Oferta nu a putut fi deschisă în asistent. Încearcă din nou.",
        });
    }
  }
);

router.get(
  "/:id",
  optionalAuth,
  async (
    req,
    res
  ) => {
    try {
      const id =
        cleanString(
          req.params.id,
          100
        );

      if (!id) {
        return res
          .status(400)
          .json({
            error:
              "invalid_request_id",
          });
      }

      /*
       * Ruta rămâne publică.
       *
       * Dacă există utilizator autentificat,
       * auth middleware-ul tău poate avea deja
       * req.user populat.
       *
       * Dacă nu există, tratăm request-ul ca guest.
       */
      const currentUserId =
        req.user?.id ||
        req.user?.sub ||
        null;

      /* =====================================================
         CEREREA
      ===================================================== */

      const request =
        await prisma
          .customerRequest
          .findUnique({
            where: {
              id,
            },

            include: {
              ...publicRequestInclude,
            },
          });

      if (!request) {
        return res
          .status(404)
          .json({
            error:
              "customer_request_not_found",

            message:
              "Cererea nu există.",
          });
      }

      if (
        request.status ===
        "CANCELLED"
      ) {
        return res
          .status(404)
          .json({
            error:
              "customer_request_not_found",

            message:
              "Cererea nu mai este disponibilă.",
          });
      }

      const serialized =
        serializeRequest(
          request
        );

      /* =====================================================
         DEFAULT:
         NU EXPUNEM OFERTELE PUBLIC
      ===================================================== */

      serialized.offers = [];
      serialized.myOffer = null;

      /* =====================================================
         GUEST / USER NECONECTAT
      ===================================================== */

      if (!currentUserId) {
        return res.json({
          ok: true,

          request:
            serialized,
        });
      }

      /* =====================================================
         OWNER CERERE

         Proprietarul vede toate ofertele.
      ===================================================== */

      const isOwner =
        String(
          request.userId
        ) ===
        String(
          currentUserId
        );

      if (isOwner) {
        const offers =
          await prisma
            .customerRequestOffer
            .findMany({
              where: {
                requestId:
                  request.id,
              },

              include: {
                vendor: {
                  select: {
                    id: true,
                    displayName:
                      true,
                    logoUrl:
                      true,
                  },
                },
              },

              orderBy: {
                createdAt:
                  "desc",
              },
            });

        serialized.offers =
          offers.map(
            serializeCustomerRequestOffer
          );

        return res.json({
          ok: true,

          request:
            serialized,
        });
      }

      /* =====================================================
         VENDOR

         Dacă utilizatorul este vendor,
         îi returnăm DOAR oferta lui.
      ===================================================== */

      const vendor =
        await getVendorForUser(
          currentUserId
        );

      if (vendor) {
        const myOffer =
          await prisma
            .customerRequestOffer
            .findUnique({
              where: {
                requestId_vendorId: {
                  requestId:
                    request.id,

                  vendorId:
                    vendor.id,
                },
              },

              include: {
                vendor: {
                  select: {
                    id: true,
                    displayName:
                      true,
                    logoUrl:
                      true,
                  },
                },
              },
            });

        serialized.myOffer =
          serializeCustomerRequestOffer(
            myOffer
          );
      }

      /* =====================================================
         ALT USER

         Nu vede ofertele.
      ===================================================== */

      return res.json({
        ok: true,

        request:
          serialized,
      });
    } catch (error) {
      console.error(
        "[customer-requests] get failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "customer_request_get_failed",

          message:
            "Cererea nu a putut fi încărcată.",
        });
    }
  }
);

/* =========================================================
   POST /api/customer-requests/moderate-image

   Verifică EXCLUSIV dacă imaginea conține
   un număr de telefon vizibil.

   Nu blocăm:
   - logo
   - email
   - URL
   - watermark
   - username social media
   - text decorativ
========================================================= */

router.post(
  "/moderate-image",
  authRequired,
  async (
    req,
    res
  ) => {
    try {
      const image =
        cleanString(
          req.body?.image,
          15_000_000
        );

      if (!image) {
        return res
          .status(400)
          .json({
            error:
              "image_required",

            message:
              "Imaginea lipsește.",
          });
      }

      /*
       * Acceptăm momentan:
       *
       * - data:image/...
       * - URL https
       *
       * Frontend-ul poate transforma File-ul
       * într-un data URL înainte de request.
       */
      const isDataImage =
        /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(
          image
        );

      const isHttpsImage =
        /^https:\/\//i.test(
          image
        );

      if (
        !isDataImage &&
        !isHttpsImage
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_image",

            message:
              "Imaginea nu are un format valid.",
          });
      }

      const response =
        await openai
          .responses
          .create({
            model:
              "gpt-4.1",

            text: {
              format: {
                type:
                  "json_object",
              },
            },

            input: [
              {
                role:
                  "user",

                content: [
                  {
                    type:
                      "input_text",

                    text: `
Analizează această imagine pentru Artfest.

Trebuie să verifici UN SINGUR LUCRU:

Există în imagine un NUMĂR DE TELEFON vizibil sau suficient de lizibil încât un utilizator să îl poată folosi?

Exemple care TREBUIE detectate:

0722 123 456
0722123456
+40 722 123 456
0040 722 123 456
07xx xxx xxx
numere scrise cu spații, puncte sau cratime

IMPORTANT:

- Detectează doar numere de telefon.
- NU bloca logo-uri.
- NU bloca nume de firme.
- NU bloca URL-uri.
- NU bloca email-uri.
- NU bloca watermark-uri.
- NU bloca username-uri Instagram/Facebook/TikTok.
- NU bloca text decorativ.
- NU considera prețurile, datele calendaristice sau codurile de produs drept numere de telefon.
- Dacă nu ești suficient de sigur că este număr de telefon, răspunde false.
- Nu reproduce în răspuns numărul detectat.
- Returnează EXCLUSIV JSON valid.

Schema exactă:

{
  "phoneNumberDetected": false,
  "confidence": "low"
}

confidence poate fi doar:

"low"
"medium"
"high"
`,
                  },

                  {
                    type:
                      "input_image",

                    image_url:
                      image,
                  },
                ],
              },
            ],
          });

      const parsed =
        safeJsonParse(
          response.output_text
        );

      if (!parsed) {
        console.error(
          "[customer-requests] image moderation invalid AI response:",
          response.output_text
        );

        return res
          .status(503)
          .json({
            error:
              "image_moderation_unavailable",

            message:
              "Imaginea nu a putut fi verificată momentan. Încearcă din nou.",
          });
      }

      const result =
        normalizeImageModerationResult(
          parsed
        );

      /*
       * Ca să reducem false-positive-urile:
       *
       * blocăm doar dacă AI spune că a detectat
       * număr de telefon și confidence nu este low.
       */
      const blocked =
        result.phoneNumberDetected &&
        (
          result.confidence ===
            "medium" ||
          result.confidence ===
            "high"
        );

      if (blocked) {
        return res
          .status(422)
          .json({
            allowed:
              false,

            error:
              "phone_number_in_image",

            reason:
              "phone_number_detected",

            message:
              "Imaginea pare să conțină un număr de telefon. Pentru siguranța utilizatorilor, încarcă o variantă fără date de contact.",
          });
      }

      return res.json({
        allowed:
          true,

        phoneNumberDetected:
          false,
      });
    } catch (error) {
      console.error(
        "[customer-requests] image moderation failed:",
        error
      );

      return res
        .status(503)
        .json({
          error:
            "image_moderation_unavailable",

          message:
            "Imaginea nu a putut fi verificată momentan. Încearcă din nou peste câteva secunde.",
        });
    }
  }
);

/* =========================================================
   POST /api/customer-requests/analyze
========================================================= */

router.post(
  "/analyze",
  authRequired,
  async (
    req,
    res
  ) => {
    try {
      const message =
        cleanString(
          req.body
            ?.message,
          4000
        );

      if (
        message.length <
        5
      ) {
        return res
          .status(400)
          .json({
            error:
              "message_required",

            message:
              "Spune-mi ce cauți.",
          });
      }

      const moderation =
        await moderateCustomerRequestText({
          message,
        });

      if (
        !moderation.allowed
      ) {
        return sendModerationResponse(
          res,
          moderation,
          {
            blockedMessage:
              "Mesajul nu poate fi analizat deoarece conține sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
          }
        );
      }

      const categoriesText =
        Array.isArray(
          CATEGORIES
        )
          ? CATEGORIES.join(
              ", "
            )
          : "";

      const response =
        await openai
          .responses
          .create({
            model:
              "gpt-4.1",

            text: {
              format: {
                type:
                  "json_object",
              },
            },

            input: [
              {
                role:
                  "user",

                content: [
                  {
                    type:
                      "input_text",

                    text: `
Ești asistentul AI Artfest pentru clienți.

Artfest este un marketplace pentru produse handmade, produse personalizate și servicii pentru evenimente.

Clientul îți spune liber ce caută, exact cum ar scrie într-un grup de Facebook.

Trebuie să transformi mesajul într-o CERERE DE OFERTĂ clară și structurată pentru creatorii Artfest.

MESAJUL CLIENTULUI:

${message}

REGULI:

- Scrie exclusiv în limba română.
- Returnează EXCLUSIV JSON valid, fără markdown.
- Nu inventa informații.
- Nu inventa buget.
- Nu inventa cantitate.
- Nu inventa localitate.
- Nu inventa termen de livrare.
- Nu include și nu reproduce numere de telefon, adrese de email, username-uri de social media sau alte date de contact.
- Nu sugera mutarea conversației, comenzii sau plății în afara Artfest.
- Dacă o informație nu există, folosește null sau "".

TITLU:

- Titlul trebuie să fie natural.
- Maximum 180 caractere.
- Titlul trebuie să înceapă natural cu ceva precum:
  "Caut..."
  "Am nevoie de..."
  "Doresc..."
- Nu transforma titlul într-o reclamă.

DESCRIERE:

- Reformulează mesajul într-o descriere clară și ușor de înțeles de creatori.
- Păstrează toate cerințele clientului.
- Nu adăuga cerințe inventate.
- Poți îmbunătăți exprimarea.
- Maximum câteva paragrafe scurte.

CANTITATE:

- quantity trebuie să fie număr întreg pozitiv.
- Dacă utilizatorul nu spune cantitatea, folosește null.

BUGET:

budgetType poate fi:

"PER_ITEM"
dacă utilizatorul spune:
"lei bucata",
"per bucată",
"pentru fiecare",
etc.

"TOTAL"
dacă spune:
"buget total",
"am X lei pentru toate",
etc.

null dacă nu se poate deduce.

budgetMin și budgetMax sunt exprimate în LEI.

Exemple:

"maximum 8 lei bucata"
=> budgetMin = null
=> budgetMax = 8
=> budgetType = "PER_ITEM"

"între 5 și 8 lei bucata"
=> budgetMin = 5
=> budgetMax = 8
=> budgetType = "PER_ITEM"

"am buget 700 lei pentru toate"
=> budgetMin = null
=> budgetMax = 700
=> budgetType = "TOTAL"

DATA:

deliveryDeadline trebuie să fie:

YYYY-MM-DD

sau null.

Data curentă este:

${new Date()
  .toISOString()
  .slice(0, 10)}

Dacă utilizatorul spune o dată clară și viitoare, o poți interpreta.

Dacă utilizatorul spune doar:

"până pe 10 septembrie"

poți folosi următoarea dată de 10 septembrie care este în viitor.

Dacă data este ambiguă, folosește null și adaugă o întrebare în questions.

LOCALITATE:

city trebuie să fie exact localitatea menționată sau "".

CATEGORIE:

Alege DOAR una dintre categoriile Artfest:

${categoriesText}

Dacă nu poți identifica o categorie potrivită și lista conține "alte", folosește "alte".

Dacă nu există "alte", folosește "".

ÎNTREBĂRI:

questions trebuie să conțină DOAR întrebări utile pentru informațiile importante care lipsesc.

Maximum 4 întrebări.

SCHEMA EXACTĂ:

{
  "title": "",
  "description": "",
  "category": "",
  "quantity": null,
  "budgetMin": null,
  "budgetMax": null,
  "budgetType": null,
  "deliveryDeadline": null,
  "city": "",
  "questions": []
}
`,
                  },
                ],
              },
            ],
          });

      const parsed =
        safeJsonParse(
          response.output_text
        );

      if (!parsed) {
        return res
          .status(500)
          .json({
            error:
              "invalid_ai_json",

            message:
              "AI-ul nu a returnat un răspuns valid.",
          });
      }

      const title =
        cleanString(
          parsed.title,
          180
        );

      const description =
        cleanString(
          parsed.description,
          5000
        );

      const rawCategory =
        cleanString(
          parsed.category,
          64
        );

      let category =
        "";

      if (
        Array.isArray(
          CATEGORIES
        ) &&
        CATEGORIES.includes(
          rawCategory
        )
      ) {
        category =
          rawCategory;
      } else if (
        Array.isArray(
          CATEGORIES
        ) &&
        CATEGORIES.includes(
          "alte"
        )
      ) {
        category =
          "alte";
      }

      const quantity =
        normalizeAiQuantity(
          parsed.quantity
        );

      const budgetMin =
        normalizeAiNumber(
          parsed.budgetMin
        );

      const budgetMax =
        normalizeAiNumber(
          parsed.budgetMax
        );

      const rawBudgetType =
        cleanString(
          parsed.budgetType,
          30
        ).toUpperCase();

      const budgetType =
        VALID_BUDGET_TYPES.has(
          rawBudgetType
        )
          ? rawBudgetType
          : null;

      const deliveryDeadline =
        normalizeAiDate(
          parsed.deliveryDeadline
        );

      const city =
        cleanString(
          parsed.city,
          120
        );

      const questions =
        cleanQuestions(
          parsed.questions
        );

      return res.json({
        ok: true,

        title,

        description,

        category,

        quantity,

        budgetMin,

        budgetMax,

        budgetType,

        deliveryDeadline,

        city,

        questions,
      });
    } catch (error) {
      console.error(
        "[customer-requests] AI analyze failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "customer_request_ai_failed",

          message:
            error?.message ||
            "Nu am putut pregăti cererea cu AI.",
        });
    }
  }
);

/* =========================================================
   POST /api/customer-requests
========================================================= */

router.post(
  "/",
  authRequired,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user?.id ||
        req.user?.sub;

      if (!userId) {
        return res
          .status(401)
          .json({
            error:
              "unauthorized",
          });
      }

      const title =
        cleanString(
          req.body
            ?.title,
          180
        );

      const description =
        cleanString(
          req.body
            ?.description,
          5000
        );

      const category =
        optionalString(
          req.body
            ?.category,
          64
        );

      const quantity =
        optionalPositiveInt(
          req.body
            ?.quantity
        );

      const budgetMinCents =
        optionalPositiveInt(
          req.body
            ?.budgetMinCents
        );

      const budgetMaxCents =
        optionalPositiveInt(
          req.body
            ?.budgetMaxCents
        );

      const rawBudgetType =
        cleanString(
          req.body
            ?.budgetType,
          30
        ).toUpperCase();

      const budgetType =
        rawBudgetType &&
        VALID_BUDGET_TYPES.has(
          rawBudgetType
        )
          ? rawBudgetType
          : null;

      const currency =
        cleanString(
          req.body
            ?.currency ||
            "RON",
          10
        ).toUpperCase();

      const deliveryDeadline =
        parseDate(
          req.body
            ?.deliveryDeadline
        );

      const city =
        optionalString(
          req.body
            ?.city,
          120
        );

      const citySlug =
        city
          ? slugifyCity(
              city
            )
          : null;

      const images =
        normalizeImages(
          req.body
            ?.images
        );

      const details =
        req.body
            ?.details &&
        typeof req.body
            .details ===
          "object" &&
        !Array.isArray(
          req.body.details
        )
          ? req.body
              .details
          : null;

      const expiresAt =
        parseDate(
          req.body
            ?.expiresAt
        );

      if (
        title.length <
        5
      ) {
        return res
          .status(400)
          .json({
            error:
              "title_required",

            message:
              "Spune pe scurt ce cauți.",
          });
      }

      if (
        description.length <
        10
      ) {
        return res
          .status(400)
          .json({
            error:
              "description_required",

            message:
              "Adaugă câteva detalii despre ce cauți.",
          });
      }

      if (
        quantity !==
          null &&
        quantity < 1
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

      if (
        budgetMinCents !==
          null &&
        budgetMaxCents !==
          null &&
        budgetMinCents >
          budgetMaxCents
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_budget_range",

            message:
              "Bugetul minim nu poate fi mai mare decât bugetul maxim.",
          });
      }

      if (
        deliveryDeadline &&
        deliveryDeadline <
          new Date()
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_delivery_deadline",

            message:
              "Termenul de livrare trebuie să fie în viitor.",
          });
      }

      const moderation =
        await moderateCustomerRequestText({
          title,
          description,
        });

      if (
        !moderation.allowed
      ) {
        return sendModerationResponse(
          res,
          moderation
        );
      }

      let finalExpiresAt =
        expiresAt;

      if (
        !finalExpiresAt
      ) {
        finalExpiresAt =
          new Date();

        finalExpiresAt
          .setDate(
            finalExpiresAt
              .getDate() +
              30
          );
      }

      if (
        finalExpiresAt <
        new Date()
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_expiration",

            message:
              "Data expirării trebuie să fie în viitor.",
          });
      }

      const created =
        await prisma
          .customerRequest
          .create({
            data: {
              userId,

              title,

              description,

              category,

              quantity,

              budgetMinCents,

              budgetMaxCents,

              budgetType,

              currency,

              deliveryDeadline,

              city,

              citySlug,

              images,

              details,

              status:
                "OPEN",

              expiresAt:
                finalExpiresAt,
            },

            include:
              publicRequestInclude,
          });

      return res
        .status(201)
        .json({
          ok: true,

          request:
            serializeRequest(
              created
            ),
        });
    } catch (error) {
      console.error(
        "[customer-requests] create failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "customer_request_create_failed",

          message:
            "Cererea nu a putut fi publicată. Te rog să încerci din nou.",
        });
    }
  }
);

/* =========================================================
   PATCH /api/customer-requests/:id
========================================================= */

router.patch(
  "/:id",
  authRequired,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user?.id ||
        req.user?.sub;

      const id =
        cleanString(
          req.params.id,
          100
        );

      if (!userId) {
        return res
          .status(401)
          .json({
            error:
              "unauthorized",
          });
      }

      if (!id) {
        return res
          .status(400)
          .json({
            error:
              "invalid_request_id",
          });
      }

      const existing =
        await prisma
          .customerRequest
          .findFirst({
            where: {
              id,
              userId,
            },
          });

      if (!existing) {
        return res
          .status(404)
          .json({
            error:
              "customer_request_not_found",

            message:
              "Cererea nu a fost găsită sau nu ai acces la ea.",
          });
      }

      if (
        existing.status !==
        "OPEN"
      ) {
        return res
          .status(409)
          .json({
            error:
              "customer_request_not_editable",

            message:
              "Cererea poate fi modificată doar cât timp este deschisă.",
          });
      }

      const hasOwn =
        (key) =>
          Object.prototype
            .hasOwnProperty
            .call(
              req.body || {},
              key
            );

      const title =
        hasOwn("title")
          ? cleanString(
              req.body?.title,
              180
            )
          : existing.title;

      const description =
        hasOwn(
          "description"
        )
          ? cleanString(
              req.body
                ?.description,
              5000
            )
          : existing.description;

      const category =
        hasOwn("category")
          ? optionalString(
              req.body?.category,
              64
            )
          : existing.category;

      const quantity =
        hasOwn("quantity")
          ? optionalPositiveInt(
              req.body?.quantity
            )
          : existing.quantity;

      const budgetMinCents =
        hasOwn(
          "budgetMinCents"
        )
          ? optionalPositiveInt(
              req.body
                ?.budgetMinCents
            )
          : existing
              .budgetMinCents;

      const budgetMaxCents =
        hasOwn(
          "budgetMaxCents"
        )
          ? optionalPositiveInt(
              req.body
                ?.budgetMaxCents
            )
          : existing
              .budgetMaxCents;

      let budgetType =
        existing
          .budgetType;

      if (
        hasOwn(
          "budgetType"
        )
      ) {
        const rawBudgetType =
          cleanString(
            req.body
              ?.budgetType,
            30
          ).toUpperCase();

        budgetType =
          rawBudgetType &&
          VALID_BUDGET_TYPES.has(
            rawBudgetType
          )
            ? rawBudgetType
            : null;
      }

      const currency =
        hasOwn("currency")
          ? cleanString(
              req.body
                ?.currency ||
                "RON",
              10
            ).toUpperCase()
          : existing.currency;

      let deliveryDeadline =
        existing
          .deliveryDeadline;

      if (
        hasOwn(
          "deliveryDeadline"
        )
      ) {
        deliveryDeadline =
          req.body
            ?.deliveryDeadline
            ? parseDate(
                req.body
                  .deliveryDeadline
              )
            : null;

        if (
          req.body
            ?.deliveryDeadline &&
          !deliveryDeadline
        ) {
          return res
            .status(400)
            .json({
              error:
                "invalid_delivery_deadline",

              message:
                "Termenul de livrare nu este valid.",
            });
        }
      }

      const city =
        hasOwn("city")
          ? optionalString(
              req.body?.city,
              120
            )
          : existing.city;

      const citySlug =
        city
          ? slugifyCity(
              city
            )
          : null;

      const images =
        hasOwn("images")
          ? normalizeImages(
              req.body?.images
            )
          : existing.images;

      const details =
        hasOwn("details")
          ? (
              req.body?.details &&
              typeof req.body
                .details ===
                "object" &&
              !Array.isArray(
                req.body.details
              )
                ? req.body
                    .details
                : null
            )
          : existing.details;

      if (
        title.length <
        5
      ) {
        return res
          .status(400)
          .json({
            error:
              "title_required",

            message:
              "Spune pe scurt ce cauți.",
          });
      }

      if (
        description.length <
        10
      ) {
        return res
          .status(400)
          .json({
            error:
              "description_required",

            message:
              "Adaugă câteva detalii despre ce cauți.",
          });
      }

      if (
        quantity !==
          null &&
        quantity < 1
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

      if (
        budgetMinCents !==
          null &&
        budgetMaxCents !==
          null &&
        budgetMinCents >
          budgetMaxCents
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_budget_range",

            message:
              "Bugetul minim nu poate fi mai mare decât bugetul maxim.",
          });
      }

      if (
        deliveryDeadline &&
        deliveryDeadline <
          new Date()
      ) {
        return res
          .status(400)
          .json({
            error:
              "invalid_delivery_deadline",

            message:
              "Termenul de livrare trebuie să fie în viitor.",
          });
      }

      const moderation =
        await moderateCustomerRequestText({
          title,
          description,
        });

      if (
        !moderation.allowed
      ) {
        return sendModerationResponse(
          res,
          moderation,
          {
            blockedMessage:
              "Modificările nu pot fi salvate deoarece conțin sau sugerează date de contact, comunicare, comandă ori plată în afara platformei.",
          }
        );
      }

      const updated =
        await prisma
          .customerRequest
          .update({
            where: {
              id,
            },

            data: {
              title,
              description,
              category,
              quantity,
              budgetMinCents,
              budgetMaxCents,
              budgetType,
              currency,
              deliveryDeadline,
              city,
              citySlug,
              images,
              details,
            },

            include:
              publicRequestInclude,
          });

      return res.json({
        ok: true,

        request:
          serializeRequest(
            updated
          ),
      });
    } catch (error) {
      console.error(
        "[customer-requests] update failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "customer_request_update_failed",

          message:
            "Cererea nu a putut fi modificată.",
        });
    }
  }
);

/* =========================================================
   DELETE /api/customer-requests/:id
========================================================= */

router.delete(
  "/:id",
  authRequired,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user?.id ||
        req.user?.sub;

      const id =
        cleanString(
          req.params.id,
          100
        );

      if (!userId) {
        return res
          .status(401)
          .json({
            error:
              "unauthorized",
          });
      }

      if (!id) {
        return res
          .status(400)
          .json({
            error:
              "invalid_request_id",
          });
      }

      const existing =
        await prisma
          .customerRequest
          .findFirst({
            where: {
              id,
              userId,
            },

            select: {
              id: true,
              status: true,
            },
          });

      if (!existing) {
        return res
          .status(404)
          .json({
            error:
              "customer_request_not_found",

            message:
              "Cererea nu a fost găsită sau nu ai acces la ea.",
          });
      }

      if (
        existing.status ===
        "CANCELLED"
      ) {
        return res.json({
          ok: true,

          alreadyDeleted:
            true,
        });
      }

      if (
        existing.status ===
        "ACCEPTED"
      ) {
        return res
          .status(409)
          .json({
            error:
              "accepted_request_cannot_be_deleted",

            message:
              "O cerere cu ofertă acceptată nu mai poate fi ștearsă.",
          });
      }

      await prisma
        .customerRequest
        .update({
          where: {
            id,
          },

          data: {
            status:
              "CANCELLED",
          },
        });

      return res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        "[customer-requests] delete failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "customer_request_delete_failed",

          message:
            "Cererea nu a putut fi ștearsă.",
        });
    }
  }
);

export default router;