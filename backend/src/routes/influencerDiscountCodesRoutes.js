// backend/src/routes/influencerDiscountCodesRoutes.js

import { Router } from "express";
import { z } from "zod";

import { prisma } from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
} from "../api/auth.js";

const router = Router();

/* =========================================================
   CONFIG

   Pentru moment:
   - influencerul poate crea singur codul;
   - maximum 5%;
   - codul se aplică doar unei colecții proprii;
   - reducerea este suportată 100% de Artfest.
========================================================= */

const MAX_INFLUENCER_DISCOUNT_PERCENT = 5;

const MAX_CODE_LENGTH = 32;
const MAX_NAME_LENGTH = 160;

const MAX_USAGE_LIMIT = 10_000;
const MAX_USAGE_PER_USER = 10;

/* =========================================================
   HELPERS
========================================================= */

function normalizeString(value = "") {
  return String(value || "").trim();
}

function normalizeCode(value = "") {
  return normalizeString(value)
    .toUpperCase()
    .replace(/\s+/g, "");
}

function parseNullableDate(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

function serializeDiscountCode(
  discountCode
) {
  if (!discountCode) {
    return null;
  }

  return {
    id:
      discountCode.id,

    code:
      discountCode.code,

    name:
      discountCode.name,

    description:
      discountCode.description,

    ownerType:
      discountCode.ownerType,

    scope:
      discountCode.scope,

    discountType:
      discountCode.discountType,

    discountPercent:
      discountCode.discountPercent,

    currency:
      discountCode.currency,

    minimumOrderCents:
      discountCode.minimumOrderCents,

    maxDiscountCents:
      discountCode.maxDiscountCents,

    fundingSource:
      discountCode.fundingSource,

    status:
      discountCode.status,

    isActive:
      discountCode.isActive,

    startsAt:
      discountCode.startsAt,

    endsAt:
      discountCode.endsAt,

    usageLimit:
      discountCode.usageLimit,

    usageLimitPerUser:
      discountCode.usageLimitPerUser,

    usedCount:
      discountCode.usedCount,

    createdAt:
      discountCode.createdAt,

    updatedAt:
      discountCode.updatedAt,

    influencerCollectionId:
      discountCode.influencerCollectionId,

    collection:
      discountCode
        .influencerCollection
        ? {
            id:
              discountCode
                .influencerCollection
                .id,

            title:
              discountCode
                .influencerCollection
                .title,

            slug:
              discountCode
                .influencerCollection
                .slug,

            isActive:
              discountCode
                .influencerCollection
                .isActive,
          }
        : null,

    redemptionsCount:
      Number(
        discountCode
          ?._count
          ?.redemptions ||
          0
      ),
  };
}

/* =========================================================
   INFLUENCER AUTH HELPERS
========================================================= */

async function getInfluencerByUserId(
  userId
) {
  if (!userId) {
    return null;
  }

  return prisma.influencerProfile.findUnique({
    where: {
      userId,
    },

    select: {
      id: true,
      userId: true,
      displayName: true,
      referralCode: true,
      status: true,
    },
  });
}

async function requireInfluencer(
  req,
  res
) {
  const userId =
    req.user?.sub;

  if (!userId) {
    res.status(401).json({
      ok: false,
      error:
        "unauthorized",
      message:
        "Trebuie să fii autentificat.",
    });

    return null;
  }

  const influencer =
    await getInfluencerByUserId(
      userId
    );

  if (!influencer) {
    res.status(403).json({
      ok: false,
      error:
        "influencer_required",
      message:
        "Este necesar un cont de influencer.",
    });

    return null;
  }

  if (
    influencer.status !==
    "ACTIVE"
  ) {
    res.status(403).json({
      ok: false,
      error:
        "influencer_disabled",
      message:
        "Contul de influencer nu este activ.",
    });

    return null;
  }

  return influencer;
}

/* =========================================================
   COLLECTION OWNERSHIP

   Codurile influencerilor se aplică doar colecțiilor lor.
========================================================= */

async function getOwnedCollection(
  collectionId,
  influencerId
) {
  if (
    !collectionId ||
    !influencerId
  ) {
    return null;
  }

  return prisma.influencerCollection.findFirst({
    where: {
      id:
        collectionId,

      influencerId,
    },

    select: {
      id: true,
      title: true,
      slug: true,
      isActive: true,
    },
  });
}

/* =========================================================
   DISCOUNT CODE OWNERSHIP
========================================================= */

async function getOwnedDiscountCode(
  discountCodeId,
  influencerId
) {
  if (
    !discountCodeId ||
    !influencerId
  ) {
    return null;
  }

  return prisma.discountCode.findFirst({
    where: {
      id:
        discountCodeId,

      influencerId,

      ownerType:
        "INFLUENCER",
    },

    include: {
      influencerCollection: {
        select: {
          id: true,
          title: true,
          slug: true,
          isActive: true,
        },
      },

      _count: {
        select: {
          redemptions:
            true,
        },
      },
    },
  });
}

/* =========================================================
   VALIDATION SCHEMAS
========================================================= */

const CreateDiscountCodeSchema =
  z.object({
    code: z
      .string()
      .trim()
      .min(
        3,
        "Codul trebuie să aibă minimum 3 caractere."
      )
      .max(
        MAX_CODE_LENGTH
      ),

    name: z
      .string()
      .trim()
      .max(
        MAX_NAME_LENGTH
      )
      .optional()
      .nullable(),

    description: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .nullable(),

    influencerCollectionId:
      z
        .string()
        .trim()
        .min(1),

    discountPercent: z
      .coerce
      .number()
      .int()
      .min(1)
      .max(
        MAX_INFLUENCER_DISCOUNT_PERCENT
      ),

    startsAt: z
      .union([
        z.string(),
        z.date(),
        z.null(),
      ])
      .optional(),

    endsAt: z
      .union([
        z.string(),
        z.date(),
        z.null(),
      ])
      .optional(),

    usageLimit: z
      .union([
        z.coerce
          .number()
          .int()
          .min(1)
          .max(
            MAX_USAGE_LIMIT
          ),
        z.null(),
      ])
      .optional(),

    usageLimitPerUser:
      z
        .union([
          z.coerce
            .number()
            .int()
            .min(1)
            .max(
              MAX_USAGE_PER_USER
            ),
          z.null(),
        ])
        .optional(),

    minimumOrderCents:
      z
        .union([
          z.coerce
            .number()
            .int()
            .min(0),
          z.null(),
        ])
        .optional(),

    maxDiscountCents:
      z
        .union([
          z.coerce
            .number()
            .int()
            .min(1),
          z.null(),
        ])
        .optional(),
  });

const UpdateDiscountCodeSchema =
  z.object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(
        MAX_CODE_LENGTH
      )
      .optional(),

    name: z
      .string()
      .trim()
      .max(
        MAX_NAME_LENGTH
      )
      .nullable()
      .optional(),

    description: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional(),

    influencerCollectionId:
      z
        .string()
        .trim()
        .min(1)
        .optional(),

    discountPercent: z
      .coerce
      .number()
      .int()
      .min(1)
      .max(
        MAX_INFLUENCER_DISCOUNT_PERCENT
      )
      .optional(),

    startsAt: z
      .union([
        z.string(),
        z.date(),
        z.null(),
      ])
      .optional(),

    endsAt: z
      .union([
        z.string(),
        z.date(),
        z.null(),
      ])
      .optional(),

    usageLimit: z
      .union([
        z.coerce
          .number()
          .int()
          .min(1)
          .max(
            MAX_USAGE_LIMIT
          ),
        z.null(),
      ])
      .optional(),

    usageLimitPerUser:
      z
        .union([
          z.coerce
            .number()
            .int()
            .min(1)
            .max(
              MAX_USAGE_PER_USER
            ),
          z.null(),
        ])
        .optional(),

    minimumOrderCents:
      z
        .union([
          z.coerce
            .number()
            .int()
            .min(0),
          z.null(),
        ])
        .optional(),

    maxDiscountCents:
      z
        .union([
          z.coerce
            .number()
            .int()
            .min(1),
          z.null(),
        ])
        .optional(),
  });

/* =========================================================
   COMMON INCLUDE
========================================================= */

const discountCodeInclude = {
  influencerCollection: {
    select: {
      id: true,
      title: true,
      slug: true,
      isActive: true,
    },
  },

  _count: {
    select: {
      redemptions:
        true,
    },
  },
};

/* =========================================================
   GET /api/influencer/discount-codes

   Lista codurilor influencerului.
========================================================= */

router.get(
  "/",

  authRequired,
  enforceTokenVersion,

  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const discountCodes =
        await prisma.discountCode.findMany({
          where: {
            influencerId:
              influencer.id,

            ownerType:
              "INFLUENCER",
          },

          include:
            discountCodeInclude,

          orderBy: {
            createdAt:
              "desc",
          },
        });

      return res.json({
        ok: true,

        maxDiscountPercent:
          MAX_INFLUENCER_DISCOUNT_PERCENT,

        discountCodes:
          discountCodes.map(
            serializeDiscountCode
          ),
      });
    } catch (error) {
      console.error(
        "[influencerDiscountCodes] GET / error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_discount_codes_load_failed",

          message:
            "Nu am putut încărca codurile de reducere.",
        });
    }
  }
);

/* =========================================================
   GET /api/influencer/discount-codes/:id
========================================================= */

router.get(
  "/:id",

  authRequired,
  enforceTokenVersion,

  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const discountCode =
        await getOwnedDiscountCode(
          req.params.id,
          influencer.id
        );

      if (!discountCode) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "discount_code_not_found",

            message:
              "Codul de reducere nu a fost găsit.",
          });
      }

      return res.json({
        ok: true,

        maxDiscountPercent:
          MAX_INFLUENCER_DISCOUNT_PERCENT,

        discountCode:
          serializeDiscountCode(
            discountCode
          ),
      });
    } catch (error) {
      console.error(
        "[influencerDiscountCodes] GET /:id error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_discount_code_load_failed",

          message:
            "Nu am putut încărca codul de reducere.",
        });
    }
  }
);

/* =========================================================
   POST /api/influencer/discount-codes

   Influencerul poate crea singur codul.

   Backendul FORȚEAZĂ:
   ownerType = INFLUENCER
   scope = INFLUENCER_COLLECTION
   type = PERCENT
   funding = PLATFORM
   max = 5%
========================================================= */

router.post(
  "/",

  authRequired,
  enforceTokenVersion,

  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const parsed =
        CreateDiscountCodeSchema.safeParse(
          req.body || {}
        );

      if (
        !parsed.success
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_payload",

            message:
              `Verifică datele introduse. Reducerea maximă permisă este ${MAX_INFLUENCER_DISCOUNT_PERCENT}%.`,

            details:
              parsed.error.flatten(),
          });
      }

      const input =
        parsed.data;

      /* =====================================================
         CODE
      ===================================================== */

      const code =
        normalizeCode(
          input.code
        );

      if (
        !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(
          code
        )
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_discount_code",

            message:
              "Codul poate conține doar litere, cifre, _ și -. Minimum 3 caractere.",
          });
      }

      const existingCode =
        await prisma.discountCode.findUnique({
          where: {
            code,
          },

          select: {
            id: true,
          },
        });

      if (existingCode) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "discount_code_already_exists",

            message:
              "Acest cod este deja folosit. Alege alt cod.",
          });
      }

      /* =====================================================
         COLLECTION OWNERSHIP
      ===================================================== */

      const collection =
        await getOwnedCollection(
          input.influencerCollectionId,
          influencer.id
        );

      if (!collection) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "collection_not_found",

            message:
              "Colecția selectată nu a fost găsită.",
          });
      }

      /* =====================================================
         DATES
      ===================================================== */

      const startsAt =
        input.startsAt ===
          undefined
          ? null
          : parseNullableDate(
              input.startsAt
            );

      const endsAt =
        input.endsAt ===
          undefined
          ? null
          : parseNullableDate(
              input.endsAt
            );

      if (
        input.startsAt &&
        !startsAt
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_start_date",

            message:
              "Data de început nu este validă.",
          });
      }

      if (
        input.endsAt &&
        !endsAt
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_end_date",

            message:
              "Data de expirare nu este validă.",
          });
      }

      if (
        startsAt &&
        endsAt &&
        endsAt <= startsAt
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_date_range",

            message:
              "Data de expirare trebuie să fie după data de început.",
          });
      }

      /* =====================================================
         CREATE

         IMPORTANT:
         ignorăm orice ownerType/funding/scope venit din frontend.
      ===================================================== */

      const discountCode =
        await prisma.discountCode.create({
          data: {
            code,

            name:
              normalizeString(
                input.name
              ) ||
              null,

            description:
              normalizeString(
                input.description
              ) ||
              null,

            ownerType:
              "INFLUENCER",

            influencerId:
              influencer.id,

            vendorId:
              null,

            scope:
              "INFLUENCER_COLLECTION",

            influencerCollectionId:
              collection.id,

            discountType:
              "PERCENT",

            discountPercent:
              input.discountPercent,

            discountAmountCents:
              null,

            currency:
              "RON",

            minimumOrderCents:
              input.minimumOrderCents ??
              null,

            maxDiscountCents:
              input.maxDiscountCents ??
              null,

            /*
             * Reducerea este suportată integral de Artfest.
             */
            fundingSource:
              "PLATFORM",

            platformFundingBps:
              10000,

            vendorFundingBps:
              0,

            status:
              "ACTIVE",

            isActive:
              true,

            startsAt,

            endsAt,

            usageLimit:
              input.usageLimit ??
              null,

            usageLimitPerUser:
              input.usageLimitPerUser ??
              1,

            usedCount:
              0,

            createdByUserId:
              influencer.userId,
          },

          include:
            discountCodeInclude,
        });

      return res
        .status(201)
        .json({
          ok: true,

          message:
            "Codul de reducere a fost creat.",

          maxDiscountPercent:
            MAX_INFLUENCER_DISCOUNT_PERCENT,

          discountCode:
            serializeDiscountCode(
              discountCode
            ),
        });
    } catch (error) {
      console.error(
        "[influencerDiscountCodes] POST / error:",
        error
      );

      /*
       * Protecție suplimentară pentru unique code,
       * inclusiv în cazul unui race condition.
       */
      if (
        error?.code ===
        "P2002"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "discount_code_already_exists",

            message:
              "Acest cod este deja folosit. Alege alt cod.",
          });
      }

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_discount_code_create_failed",

          message:
            "Nu am putut crea codul de reducere.",
        });
    }
  }
);

/* =========================================================
   PATCH /api/influencer/discount-codes/:id

   Influencerul poate modifica doar câmpurile permise.
   Nu poate schimba:
   - ownerType
   - fundingSource
   - platformFundingBps
   - vendorFundingBps
   - scope
   - influencerId
   - vendorId
========================================================= */

router.patch(
  "/:id",

  authRequired,
  enforceTokenVersion,

  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const current =
        await getOwnedDiscountCode(
          req.params.id,
          influencer.id
        );

      if (!current) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "discount_code_not_found",

            message:
              "Codul de reducere nu a fost găsit.",
          });
      }

      const parsed =
        UpdateDiscountCodeSchema.safeParse(
          req.body || {}
        );

      if (
        !parsed.success
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_payload",

            message:
              `Verifică datele. Reducerea maximă permisă este ${MAX_INFLUENCER_DISCOUNT_PERCENT}%.`,

            details:
              parsed.error.flatten(),
          });
      }

      const input =
        parsed.data;

      const updateData =
        {};

      /* =====================================================
         CODE
      ===================================================== */

      if (
        input.code !==
        undefined
      ) {
        const nextCode =
          normalizeCode(
            input.code
          );

        if (
          !/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(
            nextCode
          )
        ) {
          return res
            .status(400)
            .json({
              ok: false,

              error:
                "invalid_discount_code",

              message:
                "Codul poate conține doar litere, cifre, _ și -.",
            });
        }

        const conflict =
          await prisma.discountCode.findFirst({
            where: {
              code:
                nextCode,

              id: {
                not:
                  current.id,
              },
            },

            select: {
              id: true,
            },
          });

        if (conflict) {
          return res
            .status(409)
            .json({
              ok: false,

              error:
                "discount_code_already_exists",

              message:
                "Acest cod este deja folosit.",
            });
        }

        updateData.code =
          nextCode;
      }

      /* =====================================================
         NAME / DESCRIPTION
      ===================================================== */

      if (
        input.name !==
        undefined
      ) {
        updateData.name =
          normalizeString(
            input.name
          ) ||
          null;
      }

      if (
        input.description !==
        undefined
      ) {
        updateData.description =
          normalizeString(
            input.description
          ) ||
          null;
      }

      /* =====================================================
         DISCOUNT %
      ===================================================== */

      if (
        input.discountPercent !==
        undefined
      ) {
        updateData.discountPercent =
          input.discountPercent;
      }

      /* =====================================================
         COLLECTION
      ===================================================== */

      if (
        input.influencerCollectionId !==
        undefined
      ) {
        const collection =
          await getOwnedCollection(
            input.influencerCollectionId,
            influencer.id
          );

        if (!collection) {
          return res
            .status(404)
            .json({
              ok: false,

              error:
                "collection_not_found",

              message:
                "Colecția selectată nu a fost găsită.",
            });
        }

        updateData.influencerCollectionId =
          collection.id;
      }

      /* =====================================================
         DATES

         Dacă un câmp nu este trimis, păstrăm valoarea actuală.
      ===================================================== */

      let nextStartsAt =
        current.startsAt;

      let nextEndsAt =
        current.endsAt;

      if (
        input.startsAt !==
        undefined
      ) {
        nextStartsAt =
          parseNullableDate(
            input.startsAt
          );

        if (
          input.startsAt &&
          !nextStartsAt
        ) {
          return res
            .status(400)
            .json({
              ok: false,

              error:
                "invalid_start_date",

              message:
                "Data de început nu este validă.",
            });
        }

        updateData.startsAt =
          nextStartsAt;
      }

      if (
        input.endsAt !==
        undefined
      ) {
        nextEndsAt =
          parseNullableDate(
            input.endsAt
          );

        if (
          input.endsAt &&
          !nextEndsAt
        ) {
          return res
            .status(400)
            .json({
              ok: false,

              error:
                "invalid_end_date",

              message:
                "Data de expirare nu este validă.",
            });
        }

        updateData.endsAt =
          nextEndsAt;
      }

      if (
        nextStartsAt &&
        nextEndsAt &&
        nextEndsAt <=
          nextStartsAt
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_date_range",

            message:
              "Data de expirare trebuie să fie după data de început.",
          });
      }

      /* =====================================================
         LIMITS
      ===================================================== */

      if (
        input.usageLimit !==
        undefined
      ) {
        /*
         * Nu permitem scăderea limitei sub numărul
         * de utilizări deja consumate.
         */
        if (
          input.usageLimit !==
            null &&
          input.usageLimit <
            current.usedCount
        ) {
          return res
            .status(400)
            .json({
              ok: false,

              error:
                "usage_limit_below_used_count",

              message:
                `Codul a fost deja folosit de ${current.usedCount} ori. Limita nu poate fi mai mică decât acest număr.`,
            });
        }

        updateData.usageLimit =
          input.usageLimit;
      }

      if (
        input.usageLimitPerUser !==
        undefined
      ) {
        updateData.usageLimitPerUser =
          input.usageLimitPerUser;
      }

      if (
        input.minimumOrderCents !==
        undefined
      ) {
        updateData.minimumOrderCents =
          input.minimumOrderCents;
      }

      if (
        input.maxDiscountCents !==
        undefined
      ) {
        updateData.maxDiscountCents =
          input.maxDiscountCents;
      }

      /* =====================================================
         UPDATE

         Nu punem niciodată aici câmpurile financiare sensibile.
      ===================================================== */

      const updated =
        await prisma.discountCode.update({
          where: {
            id:
              current.id,
          },

          data:
            updateData,

          include:
            discountCodeInclude,
        });

      return res.json({
        ok: true,

        message:
          "Codul de reducere a fost actualizat.",

        maxDiscountPercent:
          MAX_INFLUENCER_DISCOUNT_PERCENT,

        discountCode:
          serializeDiscountCode(
            updated
          ),
      });
    } catch (error) {
      console.error(
        "[influencerDiscountCodes] PATCH /:id error:",
        error
      );

      if (
        error?.code ===
        "P2002"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "discount_code_already_exists",

            message:
              "Acest cod este deja folosit.",
          });
      }

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_discount_code_update_failed",

          message:
            "Nu am putut actualiza codul de reducere.",
        });
    }
  }
);

/* =========================================================
   PATCH /api/influencer/discount-codes/:id/toggle

   Activează / dezactivează.
========================================================= */

router.patch(
  "/:id/toggle",

  authRequired,
  enforceTokenVersion,

  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const current =
        await getOwnedDiscountCode(
          req.params.id,
          influencer.id
        );

      if (!current) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "discount_code_not_found",

            message:
              "Codul de reducere nu a fost găsit.",
          });
      }

      /*
       * Dacă expirarea a trecut, nu îl lăsăm să fie
       * reactivat fără ca influencerul să schimbe întâi perioada.
       */
      if (
        !current.isActive &&
        current.endsAt &&
        current.endsAt.getTime() <
          Date.now()
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "discount_code_expired",

            message:
              "Codul este expirat. Modifică data de expirare înainte să îl reactivezi.",
          });
      }

      /*
       * Dacă limita totală a fost atinsă,
       * nu îl permitem să redevină activ.
       */
      if (
        !current.isActive &&
        current.usageLimit !==
          null &&
        current.usageLimit !==
          undefined &&
        current.usedCount >=
          current.usageLimit
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "discount_code_usage_limit_reached",

            message:
              "Codul și-a atins limita de utilizări. Mărește limita înainte să îl reactivezi.",
          });
      }

      const nextActive =
        !current.isActive;

      const updated =
        await prisma.discountCode.update({
          where: {
            id:
              current.id,
          },

          data: {
            isActive:
              nextActive,

            status:
              nextActive
                ? "ACTIVE"
                : "DISABLED",
          },

          include:
            discountCodeInclude,
        });

      return res.json({
        ok: true,

        message:
          nextActive
            ? "Codul de reducere a fost activat."
            : "Codul de reducere a fost dezactivat.",

        discountCode:
          serializeDiscountCode(
            updated
          ),
      });
    } catch (error) {
      console.error(
        "[influencerDiscountCodes] PATCH /:id/toggle error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_discount_code_toggle_failed",

          message:
            "Nu am putut modifica statusul codului.",
        });
    }
  }
);

/* =========================================================
   DELETE /api/influencer/discount-codes/:id

   IMPORTANT:
   Nu ștergem un cod care a fost deja folosit,
   deoarece vrem să păstrăm istoricul financiar.
========================================================= */

router.delete(
  "/:id",

  authRequired,
  enforceTokenVersion,

  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const current =
        await getOwnedDiscountCode(
          req.params.id,
          influencer.id
        );

      if (!current) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "discount_code_not_found",

            message:
              "Codul de reducere nu a fost găsit.",
          });
      }

      const redemptionsCount =
        Number(
          current
            ?._count
            ?.redemptions ||
            0
        );

      if (
        redemptionsCount > 0 ||
        current.usedCount > 0
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "discount_code_has_redemptions",

            message:
              "Acest cod a fost deja folosit și nu mai poate fi șters. Îl poți dezactiva pentru a păstra istoricul comenzilor.",
          });
      }

      await prisma.discountCode.delete({
        where: {
          id:
            current.id,
        },
      });

      return res.json({
        ok: true,

        message:
          "Codul de reducere a fost șters.",
      });
    } catch (error) {
      console.error(
        "[influencerDiscountCodes] DELETE /:id error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_discount_code_delete_failed",

          message:
            "Nu am putut șterge codul de reducere.",
        });
    }
  }
);

export default router;