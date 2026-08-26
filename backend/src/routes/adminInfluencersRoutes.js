import { Router } from "express";
import {
  createHash,
  randomBytes,
} from "crypto";
import { z } from "zod";

import { prisma } from "../db.js";
import {
  authRequired,
} from "../api/auth.js";

import {
  sendInfluencerInviteEmail,
} from "../lib/mailer.js";

const router = Router();

const APP_URL = (
  process.env.APP_URL ||
  process.env.FRONTEND_URL ||
  "https://artfest.ro"
).replace(/\/+$/, "");

/* =========================================================
   ADMIN GUARD
========================================================= */

function adminOnly(
  req,
  res,
  next
) {
  if (!req.user?.sub) {
    return res
      .status(401)
      .json({
        ok: false,
        error:
          "unauthorized",
      });
  }

  prisma.user
    .findUnique({
      where: {
        id:
          req.user.sub,
      },

      select: {
        id: true,
        role: true,
        email: true,
      },
    })
    .then((user) => {
      if (!user) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "user_not_found",
          });
      }

      if (
        user.role !==
        "ADMIN"
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "forbidden",
          });
      }

      req.adminUser =
        user;

      next();
    })
    .catch((error) => {
      console.error(
        "[adminInfluencers] adminOnly error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,
          error:
            "admin_check_failed",
        });
    });
}

/* =========================================================
   VALIDATION
========================================================= */

const CreateInviteSchema =
  z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(160),

    email: z
      .string()
      .trim()
      .email()
      .max(320),

    code: z
      .string()
      .trim()
      .min(2)
      .max(80),

    commissionPercent:
      z.coerce
        .number()
        .min(0)
        .max(100),
  });

/* =========================================================
   HELPERS
========================================================= */

function normalizeReferralCode(
  value = ""
) {
  return String(value)
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim()
    .replace(
      /[^a-z0-9]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}

function sha256(
  value
) {
  return createHash(
    "sha256"
  )
    .update(value)
    .digest("hex");
}

function createInviteToken() {
  return randomBytes(
    32
  ).toString("hex");
}

function percentToBps(
  percent
) {
  return Math.round(
    Number(percent) *
      100
  );
}

function bpsToPercent(
  bps
) {
  return (
    Number(
      bps ||
        0
    ) / 100
  );
}

function inviteStatus(
  invite
) {
  if (invite.usedAt) {
    return "ACCEPTED";
  }

  if (
    new Date(
      invite.expiresAt
    ).getTime() <=
    Date.now()
  ) {
    return "EXPIRED";
  }

  return "INVITED";
}

/* =========================================================
   GET /api/admin/influencers
========================================================= */

router.get(
  "/",
  authRequired,
  adminOnly,
  async (
    _req,
    res
  ) => {
    try {
      const [
        profiles,
        invites,
      ] =
        await Promise.all([
          prisma.influencerProfile.findMany(
            {
              orderBy: {
                createdAt:
                  "desc",
              },

              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    name: true,
                    firstName:
                      true,
                    lastName:
                      true,
                    status: true,
                    lastLoginAt:
                      true,
                    createdAt:
                      true,
                  },
                },

                _count: {
                  select: {
                    clicks:
                      true,
                  },
                },
              },
            }
          ),

          prisma.influencerInvite.findMany(
            {
              where: {
                usedAt:
                  null,
              },

              orderBy: {
                createdAt:
                  "desc",
              },
            }
          ),
        ]);

      const profileItems =
        profiles.map(
          (profile) => {
            const fallbackName =
              [
                profile.user
                  ?.firstName,

                profile.user
                  ?.lastName,
              ]
                .filter(
                  Boolean
                )
                .join(" ")
                .trim();

            return {
              id:
                profile.id,

              type:
                "PROFILE",

              userId:
                profile.userId,

              name:
                profile.displayName ||
                profile.user
                  ?.name ||
                fallbackName ||
                profile.user
                  ?.email ||
                "Influencer",

              email:
                profile.user
                  ?.email ||
                "",

              status:
                profile.status,

              code:
                profile.referralCode,

              referralCode:
                profile.referralCode,

              commissionBps:
                profile.commissionBps,

              commissionPercent:
                bpsToPercent(
                  profile.commissionBps
                ),

              clicks:
                profile._count
                  ?.clicks ||
                0,

              /*
               * Trackingul comenzilor
               * îl legăm ulterior.
               */
              ordersCount:
                0,

              salesAmount:
                0,

              instagramUrl:
                profile.instagramUrl,

              tiktokUrl:
                profile.tiktokUrl,

              facebookUrl:
                profile.facebookUrl,

              websiteUrl:
                profile.websiteUrl,

              notes:
                profile.notes,

              lastLoginAt:
                profile.user
                  ?.lastLoginAt ||
                null,

              createdAt:
                profile.createdAt,

              updatedAt:
                profile.updatedAt,
            };
          }
        );

      const inviteItems =
        invites.map(
          (invite) => ({
            id:
              invite.id,

            type:
              "INVITE",

            userId:
              null,

            name:
              invite.name ||
              invite.email,

            email:
              invite.email,

            status:
              inviteStatus(
                invite
              ),

            code:
              invite.referralCode,

            referralCode:
              invite.referralCode,

            commissionBps:
              invite.commissionBps,

            commissionPercent:
              bpsToPercent(
                invite.commissionBps
              ),

            clicks:
              0,

            ordersCount:
              0,

            salesAmount:
              0,

            expiresAt:
              invite.expiresAt,

            usedAt:
              invite.usedAt,

            /*
             * Tokenul brut NU este salvat
             * în baza de date.
             *
             * Din acest motiv linkul vechi
             * nu poate fi reconstruit după
             * refresh.
             */
            inviteUrl:
              null,

            createdAt:
              invite.createdAt,

            updatedAt:
              invite.updatedAt,
          })
        );

      const items = [
        ...profileItems,
        ...inviteItems,
      ].sort(
        (
          a,
          b
        ) => {
          const aTime =
            new Date(
              a.createdAt ||
                0
            ).getTime();

          const bTime =
            new Date(
              b.createdAt ||
                0
            ).getTime();

          return (
            bTime -
            aTime
          );
        }
      );

      return res.json({
        ok: true,

        items,

        totals: {
          total:
            items.length,

          active:
            profileItems.filter(
              (item) =>
                item.status ===
                "ACTIVE"
            ).length,

          invited:
            inviteItems.filter(
              (item) =>
                item.status ===
                "INVITED"
            ).length,

          expired:
            inviteItems.filter(
              (item) =>
                item.status ===
                "EXPIRED"
            ).length,

          clicks:
            profileItems.reduce(
              (
                sum,
                item
              ) =>
                sum +
                Number(
                  item.clicks ||
                    0
                ),
              0
            ),
        },
      });
    } catch (error) {
      console.error(
        "[adminInfluencers] GET / error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencers_load_failed",
        });
    }
  }
);

/* =========================================================
   POST /api/admin/influencers/invite

   Creează invitația + trimite emailul automat.
========================================================= */

router.post(
  "/invite",
  authRequired,
  adminOnly,
  async (
    req,
    res
  ) => {
    try {
      const parsed =
        CreateInviteSchema.safeParse(
          req.body
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

            details:
              parsed.error.flatten(),
          });
      }

      const name =
        parsed.data.name.trim();

      const email =
        parsed.data.email
          .trim()
          .toLowerCase();

      const referralCode =
        normalizeReferralCode(
          parsed.data.code
        );

      const commissionPercent =
        Number(
          parsed.data
            .commissionPercent
        );

      const commissionBps =
        percentToBps(
          commissionPercent
        );

      if (
        !referralCode ||
        referralCode.length <
          2
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_referral_code",
          });
      }

      /* -----------------------------------------------------
         CODE DUPLICATE
      ----------------------------------------------------- */

      const [
        existingProfileCode,
        existingInviteCode,
      ] =
        await Promise.all([
          prisma.influencerProfile.findUnique(
            {
              where: {
                referralCode,
              },

              select: {
                id: true,
              },
            }
          ),

          prisma.influencerInvite.findUnique(
            {
              where: {
                referralCode,
              },

              select: {
                id: true,
                usedAt:
                  true,
                expiresAt:
                  true,
              },
            }
          ),
        ]);

      if (
        existingProfileCode ||
        existingInviteCode
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "referral_code_already_exists",
          });
      }

      /* -----------------------------------------------------
         ALREADY INFLUENCER
      ----------------------------------------------------- */

      const existingInfluencerUser =
        await prisma.user.findUnique(
          {
            where: {
              email,
            },

            select: {
              id: true,
              role: true,

              influencerProfile:
                {
                  select: {
                    id: true,
                  },
                },
            },
          }
        );

      if (
        existingInfluencerUser
          ?.influencerProfile
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "email_already_influencer",
          });
      }

      /* -----------------------------------------------------
         ACTIVE INVITE
      ----------------------------------------------------- */

      const activeInviteForEmail =
        await prisma.influencerInvite.findFirst(
          {
            where: {
              email,

              usedAt:
                null,

              expiresAt:
                {
                  gt:
                    new Date(),
                },
            },

            select: {
              id: true,
            },
          }
        );

      if (
        activeInviteForEmail
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "email_already_invited",
          });
      }

      /* -----------------------------------------------------
         TOKEN
      ----------------------------------------------------- */

      const rawToken =
        createInviteToken();

      const tokenHash =
        sha256(
          rawToken
        );

      const expiresAt =
        new Date(
          Date.now() +
            7 *
              24 *
              60 *
              60 *
              1000
        );

      /* -----------------------------------------------------
         CREATE INVITE
      ----------------------------------------------------- */

      const invite =
        await prisma.influencerInvite.create(
          {
            data: {
              name,
              email,
              referralCode,
              commissionBps,
              tokenHash,
              expiresAt,

              createdByUserId:
                req.adminUser
                  .id,
            },

            select: {
              id: true,
              name: true,
              email: true,
              referralCode:
                true,
              commissionBps:
                true,
              expiresAt:
                true,
              createdAt:
                true,
            },
          }
        );

      /* -----------------------------------------------------
         URL
      ----------------------------------------------------- */

      const inviteUrl =
        `${APP_URL}/influencer/register?token=${encodeURIComponent(
          rawToken
        )}`;

      /* -----------------------------------------------------
         SEND EMAIL

         Emailul NU trebuie să anuleze invitația
         dacă providerul are o problemă.
      ----------------------------------------------------- */

      let emailSent =
        false;

      let emailError =
        null;

      try {
        await sendInfluencerInviteEmail(
          {
            to:
              invite.email,

            name:
              invite.name,

            inviteUrl,

            referralCode:
              invite.referralCode,

            commissionPercent:
              bpsToPercent(
                invite.commissionBps
              ),

            expiresAt:
              invite.expiresAt,
          }
        );

        emailSent =
          true;
      } catch (mailError) {
        console.error(
          "[adminInfluencers] influencer invitation email failed:",
          mailError
        );

        emailError =
          "email_send_failed";
      }

      /* -----------------------------------------------------
         RESPONSE
      ----------------------------------------------------- */

      return res
        .status(201)
        .json({
          ok: true,

          invite: {
            id:
              invite.id,

            name:
              invite.name,

            email:
              invite.email,

            code:
              invite.referralCode,

            referralCode:
              invite.referralCode,

            commissionBps:
              invite.commissionBps,

            commissionPercent:
              bpsToPercent(
                invite.commissionBps
              ),

            expiresAt:
              invite.expiresAt,

            createdAt:
              invite.createdAt,

            inviteUrl,

            emailSent,
          },

          inviteUrl,

          emailSent,

          emailError,
        });
    } catch (error) {
      console.error(
        "[adminInfluencers] POST /invite error:",
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
              "influencer_invite_conflict",
          });
      }

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_invite_create_failed",
        });
    }
  }
);

export default router;