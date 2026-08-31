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
        error: "unauthorized",
      });
  }

  prisma.user
    .findUnique({
      where: {
        id: req.user.sub,
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
            error: "user_not_found",
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
            error: "forbidden",
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
          error: "admin_check_failed",
        });
    });
}

/* =========================================================
   VALIDATION

   Adminul completează doar:
   - nume
   - email

   Referral code-ul este intern și se generează automat.
========================================================= */

const InvitePayloadSchema =
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

function createExpiresAt() {
  return new Date(
    Date.now() +
      7 *
        24 *
        60 *
        60 *
        1000
  );
}

function buildInviteUrl(
  rawToken
) {
  return `${APP_URL}/influencer/register?token=${encodeURIComponent(
    rawToken
  )}`;
}

/* =========================================================
   GENERARE REFERRAL CODE INTERN

   Nu este cod promoțional.
   Nu este completat de admin.
   Nu este afișat în formularul de invitație.

   Este folosit intern pentru tracking/referral.
========================================================= */

async function generateUniqueReferralCode(
  name = ""
) {
  const base =
    normalizeReferralCode(
      name
    ) ||
    "influencer";

  for (
    let attempt = 0;
    attempt < 20;
    attempt += 1
  ) {
    const suffix =
      randomBytes(3).toString(
        "hex"
      );

    const referralCode =
      `${base}-${suffix}`;

    const [
      existingProfile,
      existingInvite,
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
            },
          }
        ),
      ]);

    if (
      !existingProfile &&
      !existingInvite
    ) {
      return referralCode;
    }
  }

  throw new Error(
    "could_not_generate_unique_referral_code"
  );
}

/* =========================================================
   VALIDATE EMAIL
========================================================= */

async function validateInviteEmail({
  email,
  ignoreInviteId = null,
}) {
  const existingUser =
    await prisma.user.findUnique({
      where: {
        email,
      },

      select: {
        id: true,

        influencerProfile: {
          select: {
            id: true,
          },
        },
      },
    });

  if (
    existingUser
      ?.influencerProfile
  ) {
    return {
      ok: false,
      error:
        "email_already_influencer",
    };
  }

  const activeInvite =
    await prisma.influencerInvite.findFirst(
      {
        where: {
          ...(ignoreInviteId
            ? {
                id: {
                  not:
                    ignoreInviteId,
                },
              }
            : {}),

          email,

          usedAt: null,

          expiresAt: {
            gt: new Date(),
          },
        },

        select: {
          id: true,
        },
      }
    );

  if (activeInvite) {
    return {
      ok: false,
      error:
        "email_already_invited",
    };
  }

  return {
    ok: true,
  };
}

/* =========================================================
   SEND INVITE EMAIL

   Nu trimitem referralCode.
   Influencerul nu are nevoie să îl vadă.
========================================================= */

async function sendInviteEmail({
  invite,
  inviteUrl,
}) {
  let emailSent =
    false;

  let emailError =
    null;

  try {
    await sendInfluencerInviteEmail({
      to:
        invite.email,

      name:
        invite.name,

      inviteUrl,

      expiresAt:
        invite.expiresAt,
    });

    emailSent =
      true;
  } catch (error) {
    console.error(
      "[adminInfluencers] influencer invitation email failed:",
      error
    );

    emailError =
      "email_send_failed";
  }

  return {
    emailSent,
    emailError,
  };
}

/* =========================================================
   GET /api/admin/influencers

   Influenceri activi + invitații neacceptate.
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
                    firstName: true,
                    lastName: true,
                    status: true,
                    lastLoginAt: true,
                    createdAt: true,

                    UserConsent: {
                      where: {
                        document:
                          "INFLUENCER_TERMS",
                      },

                      select: {
                        id: true,
                        document: true,
                        version: true,
                        checksum: true,
                        givenAt: true,
                      },

                      orderBy: {
                        givenAt:
                          "desc",
                      },

                      take: 1,
                    },
                  },
                },

                _count: {
                  select: {
                    clicks: true,
                  },
                },
              },
            }
          ),

          prisma.influencerInvite.findMany(
            {
              where: {
                usedAt: null,
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
                .filter(Boolean)
                .join(" ")
                .trim();

            const influencerTerms =
              profile.user
                ?.UserConsent?.[0] ||
              null;

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

              /*
               * Nu expunem referralCode
               * în tabelul admin.
               */

              commissionBps:
                profile.commissionBps,

              commissionConfigured:
                Number(
                  profile.commissionBps ||
                    0
                ) > 0,

              /*
               * Temporar:
               * tracking-ul de comenzi
               * va fi legat ulterior.
               */

              clicks:
                profile._count
                  ?.clicks ||
                0,

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

              termsAccepted:
                !!influencerTerms,

              termsVersion:
                influencerTerms
                  ?.version ||
                null,

              termsAcceptedAt:
                influencerTerms
                  ?.givenAt ||
                null,

              termsChecksum:
                influencerTerms
                  ?.checksum ||
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

            /*
             * Nu expunem referralCode.
             */

            commissionBps:
              invite.commissionBps,

            commissionConfigured:
              Number(
                invite.commissionBps ||
                  0
              ) > 0,

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

            termsAccepted:
              false,

            termsVersion:
              null,

            termsAcceptedAt:
              null,

            termsChecksum:
              null,

            /*
             * Tokenul brut nu este salvat.
             * Linkul invitației nu poate fi
             * reconstruit după refresh.
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

          termsAccepted:
            profileItems.filter(
              (item) =>
                item.termsAccepted
            ).length,
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

   Creează invitația.

   Adminul trimite:
   {
     name,
     email
   }

   referralCode este generat automat.
   commissionBps = 0 = remunerație nesetată.
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
        InvitePayloadSchema.safeParse(
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

      /* -----------------------------------------------------
         EMAIL
      ----------------------------------------------------- */

      const emailValidation =
        await validateInviteEmail({
          email,
        });

      if (
        !emailValidation.ok
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              emailValidation.error,
          });
      }

      /* -----------------------------------------------------
         REFERRAL INTERN
      ----------------------------------------------------- */

      const referralCode =
        await generateUniqueReferralCode(
          name
        );

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
        createExpiresAt();

      /* -----------------------------------------------------
         CREATE
      ----------------------------------------------------- */

      const invite =
        await prisma.influencerInvite.create(
          {
            data: {
              name,
              email,

              /*
               * Folosit intern pentru tracking.
               */
              referralCode,

              /*
               * 0 = remunerație încă nesetată.
               */
              commissionBps:
                0,

              tokenHash,
              expiresAt,

              createdByUserId:
                req.adminUser.id,
            },

            select: {
              id: true,
              name: true,
              email: true,
              expiresAt: true,
              createdAt: true,
              updatedAt: true,
            },
          }
        );

      const inviteUrl =
        buildInviteUrl(
          rawToken
        );

      const {
        emailSent,
        emailError,
      } =
        await sendInviteEmail({
          invite,
          inviteUrl,
        });

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

            expiresAt:
              invite.expiresAt,

            createdAt:
              invite.createdAt,

            updatedAt:
              invite.updatedAt,

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

/* =========================================================
   PATCH /api/admin/influencers/invite/:id

   Poți edita:
   - numele
   - emailul

   NU schimbăm referralCode-ul intern.

   La editare:
   - regenerăm tokenul;
   - expirarea revine la 7 zile;
   - vechiul link devine invalid;
   - trimitem email nou.
========================================================= */

router.patch(
  "/invite/:id",
  authRequired,
  adminOnly,
  async (
    req,
    res
  ) => {
    try {
      const inviteId =
        String(
          req.params.id ||
            ""
        ).trim();

      if (!inviteId) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invite_id_required",
          });
      }

      const parsed =
        InvitePayloadSchema.safeParse(
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

      const existingInvite =
        await prisma.influencerInvite.findUnique(
          {
            where: {
              id:
                inviteId,
            },

            select: {
              id: true,
              usedAt: true,
              referralCode: true,
            },
          }
        );

      if (
        !existingInvite
      ) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "invite_not_found",
          });
      }

      if (
        existingInvite.usedAt
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "invite_already_used",

            message:
              "Invitația a fost deja acceptată și nu mai poate fi modificată.",
          });
      }

      const name =
        parsed.data.name.trim();

      const email =
        parsed.data.email
          .trim()
          .toLowerCase();

      /* -----------------------------------------------------
         EMAIL
      ----------------------------------------------------- */

      const emailValidation =
        await validateInviteEmail({
          email,

          ignoreInviteId:
            inviteId,
        });

      if (
        !emailValidation.ok
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              emailValidation.error,
          });
      }

      /* -----------------------------------------------------
         TOKEN NOU
      ----------------------------------------------------- */

      const rawToken =
        createInviteToken();

      const tokenHash =
        sha256(
          rawToken
        );

      const expiresAt =
        createExpiresAt();

      const invite =
        await prisma.influencerInvite.update(
          {
            where: {
              id:
                inviteId,
            },

            data: {
              name,
              email,

              /*
               * referralCode rămâne neschimbat.
               */
              tokenHash,
              expiresAt,
            },

            select: {
              id: true,
              name: true,
              email: true,
              expiresAt: true,
              createdAt: true,
              updatedAt: true,
            },
          }
        );

      const inviteUrl =
        buildInviteUrl(
          rawToken
        );

      const {
        emailSent,
        emailError,
      } =
        await sendInviteEmail({
          invite,
          inviteUrl,
        });

      return res.json({
        ok: true,

        invite: {
          id:
            invite.id,

          name:
            invite.name,

          email:
            invite.email,

          expiresAt:
            invite.expiresAt,

          createdAt:
            invite.createdAt,

          updatedAt:
            invite.updatedAt,

          inviteUrl,

          emailSent,
        },

        inviteUrl,

        emailSent,

        emailError,
      });
    } catch (error) {
      console.error(
        "[adminInfluencers] PATCH /invite/:id error:",
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
            "influencer_invite_update_failed",
        });
    }
  }
);

/* =========================================================
   DELETE /api/admin/influencers/invite/:id

   Șterge doar invitațiile neacceptate.
========================================================= */

router.delete(
  "/invite/:id",
  authRequired,
  adminOnly,
  async (
    req,
    res
  ) => {
    try {
      const inviteId =
        String(
          req.params.id ||
            ""
        ).trim();

      if (!inviteId) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invite_id_required",
          });
      }

      const invite =
        await prisma.influencerInvite.findUnique(
          {
            where: {
              id:
                inviteId,
            },

            select: {
              id: true,
              email: true,
              name: true,
              usedAt: true,
            },
          }
        );

      if (!invite) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "invite_not_found",
          });
      }

      if (
        invite.usedAt
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "invite_already_used",

            message:
              "Invitația a fost deja acceptată și nu mai poate fi ștearsă.",
          });
      }

      await prisma.influencerInvite.delete({
        where: {
          id:
            inviteId,
        },
      });

      return res.json({
        ok: true,

        deletedId:
          inviteId,

        deletedInvite: {
          id:
            invite.id,

          name:
            invite.name,

          email:
            invite.email,
        },
      });
    } catch (error) {
      console.error(
        "[adminInfluencers] DELETE /invite/:id error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_invite_delete_failed",
        });
    }
  }
);

/* =========================================================
   TEST
========================================================= */

router.get(
  "/test",
  authRequired,
  adminOnly,
  (_req, res) => {
    return res.json({
      ok: true,
      module:
        "admin-influencers",
    });
  }
);

export default router;