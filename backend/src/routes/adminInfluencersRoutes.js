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

import {
  getInfluencerConfirmedTotals,
} from "../services/influencerEarnings.js";

import {
  getSignedDownloadUrl,
} from "../services/r2Storage.js";

import {
  computeCollaborationState,
  validateCollaborationExtension,
} from "../services/influencerCollaboration.js";

const router = Router();

const {
  R2_ACCOUNT_ID,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
} = process.env;

/*
 * Identic ca logică cu keyFromPublicUrl din influencerFilesRoutes.js -
 * extrage cheia R2 dintr-un URL public existent, fără să atingă
 * fișierul.
 */
function keyFromPublicUrl(url) {
  const base = R2_PUBLIC_BASE_URL
    ? R2_PUBLIC_BASE_URL.replace(/\/+$/, "")
    : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  if (!url || !url.startsWith(`${base}/`)) return null;

  return url.slice(base.length + 1);
}

const APP_URL = (
  process.env.APP_URL ||
  process.env.FRONTEND_URL ||
  "https://www.artfest.ro"
).replace(/\/+$/, "");

/* =========================================================
   CONSTANTE REMUNERAȚIE
========================================================= */

const INFLUENCER_COMMISSION_TERMS_VERSION =
  "1.0";

const MIN_INFLUENCER_COMMISSION_BPS =
  1;

/**
 * 10000 BPS = 100% din comisionul Artfest.
 *
 * Nu înseamnă 100% din valoarea comenzii.
 */
const MAX_INFLUENCER_COMMISSION_BPS =
  10000;

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
   VALIDATION - INVITAȚIE
========================================================= */

/*
 * Standardizare Prenume/Nume (2026-09-11): modalul „Invită influencer”
 * trimite acum firstName/lastName. InfluencerInvite NU are coloane
 * separate în schema (doar `name`, legacy) - NU modificăm Prisma aici,
 * doar construim `name = firstName + " " + lastName` la salvare (vezi
 * raportul de standardizare). Acceptăm și shape-ul legacy `{ name }`
 * pentru compatibilitate cu apeluri existente (ex. resendInvite din
 * frontend, care retrimite cu `{ name: item.name, email }` neschimbat).
 */
const InvitePayloadSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional(),

    lastName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional(),

    name: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .optional(),

    email: z
      .string()
      .trim()
      .email()
      .max(320),
  })
  .refine(
    (data) =>
      Boolean(data.name?.trim()) ||
      Boolean(
        data.firstName?.trim() &&
          data.lastName?.trim()
      ),
    {
      message:
        "Completează prenumele și numele (sau numele complet).",
    }
  );

/*
 * Split best-effort al `name`-ului legacy - folosit DOAR pentru
 * salutul din emailul de invitație atunci când nu avem firstName
 * explicit (retrimitere/editare unei invitații vechi care are doar
 * `name`). Nu modifică nimic în baza de date.
 */
function deriveFirstName(fullName) {
  const trimmed = String(fullName || "").trim();

  if (!trimmed) {
    return "";
  }

  return trimmed.split(/\s+/)[0] || "";
}

/* =========================================================
   VALIDATION - REMUNERAȚIE

   Frontendul poate trimite:

   {
     commissionPercent: 20
   }

   sau:

   {
     commissionBps: 2000
   }

   Recomand frontend:
   commissionPercent: 20
========================================================= */

const CommissionAgreementPayloadSchema =
  z
    .object({
      commissionPercent:
        z
          .coerce
          .number()
          .positive()
          .max(100)
          .optional(),

      commissionBps:
        z
          .coerce
          .number()
          .int()
          .min(
            MIN_INFLUENCER_COMMISSION_BPS
          )
          .max(
            MAX_INFLUENCER_COMMISSION_BPS
          )
          .optional(),
    })
    .refine(
      (data) =>
        data.commissionPercent !==
          undefined ||
        data.commissionBps !==
          undefined,
      {
        message:
          "commissionPercent sau commissionBps este obligatoriu.",
      }
    );

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
   COMMISSION HELPERS
========================================================= */

function bpsToPercent(
  value
) {
  const bps =
    Number(
      value || 0
    );

  return Number(
    (
      bps /
      100
    ).toFixed(2)
  );
}

function percentToBps(
  value
) {
  const percent =
    Number(value);

  return Math.round(
    percent *
      100
  );
}

function resolveCommissionBps(
  payload
) {
  if (
    payload.commissionBps !==
    undefined
  ) {
    return Number(
      payload.commissionBps
    );
  }

  return percentToBps(
    payload.commissionPercent
  );
}

function buildCommissionAgreementText({
  commissionBps,
}) {
  const percent =
    bpsToPercent(
      commissionBps
    );

  return [
    `Artfest îți propune o remunerație de ${percent}% din comisionul Artfest`,
    "aferent comenzilor eligibile atribuite colaborării tale.",
    "",
    "Remunerația nu reprezintă un procent din valoarea totală a comenzii.",
    "Ea se calculează exclusiv din comisionul Artfest rezultat pentru vânzările eligibile.",
    "",
    "Noua remunerație devine activă numai după acceptarea ta.",
  ].join(" ");
}

function serializeCommissionAgreement(
  agreement
) {
  if (!agreement) {
    return null;
  }

  return {
    id:
      agreement.id,

    commissionBps:
      agreement.commissionBps,

    commissionPercent:
      bpsToPercent(
        agreement.commissionBps
      ),

    status:
      agreement.status,

    agreementText:
      agreement.agreementText,

    termsVersion:
      agreement.termsVersion,

    proposedAt:
      agreement.proposedAt,

    acceptedAt:
      agreement.acceptedAt,

    declinedAt:
      agreement.declinedAt,

    supersededAt:
      agreement.supersededAt,

    createdAt:
      agreement.createdAt,

    updatedAt:
      agreement.updatedAt,
  };
}

/* =========================================================
   GENERARE REFERRAL CODE INTERN
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
            gt:
              new Date(),
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
========================================================= */

async function sendInviteEmail({
  invite,
  inviteUrl,
  firstName,
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

      firstName:
        firstName ||
        deriveFirstName(
          invite.name
        ),

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

   Pentru PROFILE returnăm:
   - remunerația activă/acceptată
   - ultima propunere PENDING
   - ultimul acord acceptat
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

                commissionAgreements: {
                  orderBy: {
                    proposedAt:
                      "desc",
                  },

                  take: 10,

                  select: {
                    id: true,
                    commissionBps: true,
                    status: true,
                    agreementText: true,
                    termsVersion: true,
                    proposedAt: true,
                    acceptedAt: true,
                    declinedAt: true,
                    supersededAt: true,
                    createdAt: true,
                    updatedAt: true,
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

      /*
       * Agregate REALE de comenzi/vânzări/câștig, ACEEAȘI sursă
       * folosită de dashboardul influencerului (services/
       * influencerEarnings.js) - nu recalculăm separat aici.
       */
      const confirmedTotalsByInfluencerId = new Map(
        await Promise.all(
          profiles.map(async (profile) => [
            profile.id,
            await getInfluencerConfirmedTotals(profile.id),
          ])
        )
      );

      const profileItems =
        profiles.map(
          (profile) => {
            const earningTotals =
              confirmedTotalsByInfluencerId.get(
                profile.id
              ) || {
                ordersCount: 0,
                salesAmount: 0,
                confirmedEarningsAmount: 0,
              };

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

            const pendingAgreement =
              profile.commissionAgreements.find(
                (agreement) =>
                  agreement.status ===
                  "PENDING"
              ) ||
              null;

            const acceptedAgreement =
              profile.commissionAgreements.find(
                (agreement) =>
                  agreement.status ===
                  "ACCEPTED"
              ) ||
              null;

            const activeCommissionBps =
              Number(
                profile.commissionBps ||
                  0
              );

            const activeCommissionPercent =
              bpsToPercent(
                activeCommissionBps
              );

            /*
             * Perioada de colaborare (Admin -> Influenceri): AICI se
             * calculează, o singură dată, cu EXACT helperul comun
             * (services/influencerCollaboration.js) folosit și de
             * dashboardul influencerului (GET /api/influencer/me) -
             * frontendul Admin doar afișează, nu recalculează. Vezi
             * audit-ul din acel fișier: collaborationStart =
             * InfluencerProfile.createdAt (momentul activării, câmp
             * sigur), fără date inventate. profile.status (real,
             * ex. DISABLED) NU este suprascris de calculul de
             * perioadă.
             */
            const collaboration =
              computeCollaborationState(
                {
                  activatedAt:
                    profile.createdAt,
                  status:
                    profile.status,
                  commissionBps:
                    activeCommissionBps,
                  collaborationEndOverride:
                    profile.collaborationEndOverride,
                }
              );

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

              /*
               * Aditiv - standardizare Prenume/Nume: numele PERSOANEI
               * (User.firstName/lastName), distinct de `name` de mai
               * sus (care rămâne identitatea afișată în listă/header,
               * neschimbată) și de `displayName` (profilul public al
               * influencerului, poate fi diferit).
               */
              firstName:
                profile.user
                  ?.firstName ||
                null,

              lastName:
                profile.user
                  ?.lastName ||
                null,

              displayName:
                profile.displayName ||
                null,

              email:
                profile.user
                  ?.email ||
                "",

              status:
                profile.status,

              /**
               * Remunerația ACTIVĂ.
               * Este cea acceptată.
               */
              commissionBps:
                activeCommissionBps,

              commissionSharePercent:
                activeCommissionPercent,

              platformCommissionSharePercent:
                activeCommissionPercent,

              commissionConfigured:
                activeCommissionBps >
                0,

              /**
               * Propunerea care așteaptă
               * răspunsul influencerului.
               */
              pendingCommissionAgreement:
                serializeCommissionAgreement(
                  pendingAgreement
                ),

              pendingCommissionBps:
                pendingAgreement
                  ?.commissionBps ??
                null,

              pendingCommissionPercent:
                pendingAgreement
                  ? bpsToPercent(
                      pendingAgreement.commissionBps
                    )
                  : null,

              hasPendingCommissionAgreement:
                Boolean(
                  pendingAgreement
                ),

              /**
               * Ultimul acord acceptat.
               */
              acceptedCommissionAgreement:
                serializeCommissionAgreement(
                  acceptedAgreement
                ),

              commissionAgreementStatus:
                pendingAgreement
                  ? "PENDING"
                  : activeCommissionBps >
                      0
                    ? "ACCEPTED"
                    : null,

              clicks:
                profile._count
                  ?.clicks ||
                0,

              ordersCount:
                earningTotals.ordersCount,

              salesAmount:
                earningTotals.salesAmount,

              earningsAmount:
                earningTotals.confirmedEarningsAmount,

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

              /*
               * Aditiv - vezi comentariul de mai sus. Shape identic
               * cu `collaboration` din GET /api/influencer/me
               * (services/influencerCollaboration.js).
               */
              collaboration,
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

            /*
             * InfluencerInvite nu are firstName/lastName separat
             * (legacy, doar `name`) - null explicit, ca shape-ul să
             * rămână consistent cu PROFILE pentru frontend.
             */
            firstName:
              null,

            lastName:
              null,

            email:
              invite.email,

            status:
              inviteStatus(
                invite
              ),

            /**
             * Invite commissionBps este păstrat
             * pentru compatibilitate.
             *
             * Noul flux contractual începe
             * după activarea contului.
             */
            commissionBps:
              invite.commissionBps,

            commissionSharePercent:
              0,

            platformCommissionSharePercent:
              0,

            commissionConfigured:
              false,

            /*
             * Invitațiile nu au încă un InfluencerProfile (nu s-au
             * activat) - nu există dată de activare, deci nu inventăm
             * o perioadă de colaborare pentru ele.
             */
            collaboration:
              null,

            pendingCommissionAgreement:
              null,

            pendingCommissionBps:
              null,

            pendingCommissionPercent:
              null,

            hasPendingCommissionAgreement:
              false,

            acceptedCommissionAgreement:
              null,

            commissionAgreementStatus:
              null,

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

            /**
             * Tokenul brut nu este salvat.
             * Linkul nu poate fi reconstruit
             * după refresh.
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

          commissionConfigured:
            profileItems.filter(
              (item) =>
                item.commissionConfigured
            ).length,

          commissionPending:
            profileItems.filter(
              (item) =>
                item
                  .hasPendingCommissionAgreement
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
   POST /api/admin/influencers/:id/commission-agreement

   Adminul PROPUNE remunerația.

   IMPORTANT:
   NU modificăm aici InfluencerProfile.commissionBps.

   Exemplu body:

   {
     "commissionPercent": 20
   }

   Creează:
   commissionBps = 2000
   status = PENDING

   Dacă exista deja o propunere PENDING,
   ea devine SUPERSEDED.
========================================================= */

router.post(
  "/:id/commission-agreement",
  authRequired,
  adminOnly,
  async (
    req,
    res
  ) => {
    try {
      const influencerId =
        String(
          req.params.id ||
            ""
        ).trim();

      if (!influencerId) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "influencer_id_required",
          });
      }

      const parsed =
        CommissionAgreementPayloadSchema.safeParse(
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
              "invalid_commission_payload",

            details:
              parsed.error.flatten(),
          });
      }

      const commissionBps =
        resolveCommissionBps(
          parsed.data
        );

      if (
        !Number.isInteger(
          commissionBps
        ) ||
        commissionBps <
          MIN_INFLUENCER_COMMISSION_BPS ||
        commissionBps >
          MAX_INFLUENCER_COMMISSION_BPS
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_commission_bps",

            message:
              "Remunerația trebuie să fie între 0,01% și 100% din comisionul Artfest.",
          });
      }

      const influencer =
        await prisma.influencerProfile.findUnique(
          {
            where: {
              id:
                influencerId,
            },

            select: {
              id: true,
              userId: true,
              displayName: true,
              commissionBps: true,
              status: true,

              user: {
                select: {
                  email: true,
                  name: true,
                },
              },
            },
          }
        );

      if (!influencer) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "influencer_not_found",
          });
      }

      if (
        influencer.status !==
        "ACTIVE"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "influencer_not_active",

            message:
              "Remunerația poate fi propusă doar unui influencer activ.",
          });
      }

      /**
       * Dacă exact aceeași remunerație
       * este deja activă și nu există
       * o schimbare reală, nu creăm
       * inutil un acord nou.
       */
      if (
        Number(
          influencer.commissionBps ||
            0
        ) ===
          commissionBps
      ) {
        const existingPending =
          await prisma.influencerCommissionAgreement.findFirst(
            {
              where: {
                influencerId,
                status:
                  "PENDING",
              },

              orderBy: {
                proposedAt:
                  "desc",
              },

              select: {
                id: true,
              },
            }
          );

        if (!existingPending) {
          return res
            .status(409)
            .json({
              ok: false,

              error:
                "commission_already_active",

              message:
                "Această remunerație este deja activă pentru influencer.",
            });
        }
      }

      const agreementText =
        buildCommissionAgreementText({
          commissionBps,
        });

      const now =
        new Date();

      const agreement =
        await prisma.$transaction(
          async (tx) => {
            /**
             * O singură propunere PENDING
             * trebuie să fie activă.
             *
             * Dacă adminul schimbă propunerea
             * înainte de răspuns, cea veche
             * este marcată SUPERSEDED.
             */
            await tx.influencerCommissionAgreement.updateMany(
              {
                where: {
                  influencerId,

                  status:
                    "PENDING",
                },

                data: {
                  status:
                    "SUPERSEDED",

                  supersededAt:
                    now,
                },
              }
            );

            const created =
              await tx.influencerCommissionAgreement.create(
                {
                  data: {
                    influencerId,

                    commissionBps,

                    status:
                      "PENDING",

                    agreementText,

                    termsVersion:
                      INFLUENCER_COMMISSION_TERMS_VERSION,

                    proposedByUserId:
                      req.adminUser.id,

                    proposedAt:
                      now,
                  },

                  select: {
                    id: true,
                    influencerId: true,
                    commissionBps: true,
                    status: true,
                    agreementText: true,
                    termsVersion: true,
                    proposedAt: true,
                    acceptedAt: true,
                    declinedAt: true,
                    supersededAt: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                }
              );

            /**
             * Notificăm influencerul.
             *
             * Nu este critică pentru calcul,
             * dar îl ajută să vadă imediat
             * propunerea în cont.
             */
            await tx.notification.create({
              data: {
                userId:
                  influencer.userId,

                type:
                  "system",

                title:
                  "Ai primit o propunere de remunerare",

                body:
                  `Artfest îți propune o remunerație de ${bpsToPercent(
                    commissionBps
                  )}% din comisionul Artfest. Intră în dashboard pentru a o accepta sau refuza.`,

                link:
                  "/influencer",

                meta: {
                  influencerId:
                    influencer.id,

                  commissionAgreementId:
                    created.id,

                  commissionBps,

                  commissionPercent:
                    bpsToPercent(
                      commissionBps
                    ),

                  termsVersion:
                    INFLUENCER_COMMISSION_TERMS_VERSION,
                },

                dedupeKey:
                  `influencer_commission_proposal:${created.id}`,
              },
            });

            return created;
          }
        );

      return res
        .status(201)
        .json({
          ok: true,

          message:
            "Propunerea de remunerare a fost trimisă influencerului.",

          influencer: {
            id:
              influencer.id,

            name:
              influencer.displayName ||
              influencer.user
                ?.name ||
              influencer.user
                ?.email ||
              "Influencer",

            activeCommissionBps:
              Number(
                influencer.commissionBps ||
                  0
              ),

            activeCommissionPercent:
              bpsToPercent(
                influencer.commissionBps
              ),
          },

          agreement:
            serializeCommissionAgreement(
              agreement
            ),
        });
    } catch (error) {
      console.error(
        "[adminInfluencers] POST /:id/commission-agreement error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "commission_agreement_create_failed",
        });
    }
  }
);

/* =========================================================
   DELETE /api/admin/influencers/:id/commission-agreement/:agreementId

   Adminul poate retrage DOAR o propunere PENDING.

   Nu poate șterge un acord ACCEPTED.
   Îl marcăm SUPERSEDED pentru audit.
========================================================= */

router.delete(
  "/:id/commission-agreement/:agreementId",
  authRequired,
  adminOnly,
  async (
    req,
    res
  ) => {
    try {
      const influencerId =
        String(
          req.params.id ||
            ""
        ).trim();

      const agreementId =
        String(
          req.params.agreementId ||
            ""
        ).trim();

      if (
        !influencerId ||
        !agreementId
      ) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "invalid_agreement_reference",
          });
      }

      const agreement =
        await prisma.influencerCommissionAgreement.findFirst(
          {
            where: {
              id:
                agreementId,

              influencerId,
            },

            select: {
              id: true,
              status: true,
            },
          }
        );

      if (!agreement) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "commission_agreement_not_found",
          });
      }

      if (
        agreement.status !==
        "PENDING"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "commission_agreement_not_pending",

            message:
              "Doar o propunere aflată în așteptare poate fi retrasă.",
          });
      }

      const updated =
        await prisma.influencerCommissionAgreement.update(
          {
            where: {
              id:
                agreementId,
            },

            data: {
              status:
                "SUPERSEDED",

              supersededAt:
                new Date(),
            },

            select: {
              id: true,
              commissionBps: true,
              status: true,
              agreementText: true,
              termsVersion: true,
              proposedAt: true,
              acceptedAt: true,
              declinedAt: true,
              supersededAt: true,
              createdAt: true,
              updatedAt: true,
            },
          }
        );

      return res.json({
        ok: true,

        message:
          "Propunerea de remunerare a fost retrasă.",

        agreement:
          serializeCommissionAgreement(
            updated
          ),
      });
    } catch (error) {
      console.error(
        "[adminInfluencers] DELETE commission agreement error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "commission_agreement_cancel_failed",
        });
    }
  }
);

/* =========================================================
   POST /api/admin/influencers/invite
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

      const firstName =
        parsed.data.firstName?.trim() ||
        "";

      const lastName =
        parsed.data.lastName?.trim() ||
        "";

      const name =
        firstName && lastName
          ? `${firstName} ${lastName}`.trim()
          : parsed.data.name?.trim() ||
            "";

      const email =
        parsed.data.email
          .trim()
          .toLowerCase();

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

      const referralCode =
        await generateUniqueReferralCode(
          name
        );

      const rawToken =
        createInviteToken();

      const tokenHash =
        sha256(
          rawToken
        );

      const expiresAt =
        createExpiresAt();

      const invite =
        await prisma.influencerInvite.create(
          {
            data: {
              name,
              email,

              referralCode,

              /**
               * Legacy / compatibilitate.
               *
               * Remunerația contractuală
               * va fi stabilită DUPĂ
               * activarea profilului.
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
          firstName:
            firstName ||
            deriveFirstName(name),
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

      const firstName =
        parsed.data.firstName?.trim() ||
        "";

      const lastName =
        parsed.data.lastName?.trim() ||
        "";

      const name =
        firstName && lastName
          ? `${firstName} ${lastName}`.trim()
          : parsed.data.name?.trim() ||
            "";

      const email =
        parsed.data.email
          .trim()
          .toLowerCase();

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
          firstName:
            firstName ||
            deriveFirstName(name),
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
   GET /api/admin/influencers/:id/files

   Read-only - adminul vede documentele influencerului pentru
   colaborare/documentare, dar NU poate încărca/șterge de aici
   (fluxul de upload rămâne exclusiv al influencerului, prin
   influencerFilesRoutes.js).
========================================================= */

router.get(
  "/:id/files",
  authRequired,
  adminOnly,
  async (req, res) => {
    try {
      const influencerId = String(req.params.id || "").trim();

      if (!influencerId) {
        return res.status(400).json({
          ok: false,
          error: "influencer_id_required",
        });
      }

      const influencer = await prisma.influencerProfile.findUnique({
        where: { id: influencerId },
        select: { id: true },
      });

      if (!influencer) {
        return res.status(404).json({
          ok: false,
          error: "influencer_not_found",
        });
      }

      const items = await prisma.influencerFile.findMany({
        where: { influencerId },
        orderBy: { createdAt: "desc" },
      });

      /*
       * fileUrl e URL-ul public permanent din R2 - nu-l expunem în
       * listă, la fel ca în influencerFilesRoutes.js. Adminul cere un
       * URL semnat, temporar, prin GET /:id/files/:fileId/download.
       */
      return res.json({
        ok: true,
        items: items.map(({ fileUrl, ...rest }) => rest),
      });
    } catch (error) {
      console.error(
        "[adminInfluencersRoutes] GET /:id/files error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "admin_influencer_files_load_failed",
      });
    }
  }
);

/* =========================================================
   GET /api/admin/influencers/:id/files/:fileId/download

   Adminul poate deschide documentele UNUI influencer specific -
   verificăm explicit că fileId aparține chiar influencerId-ului din
   URL (nu doar că fileId există undeva în DB).
========================================================= */

router.get(
  "/:id/files/:fileId/download",
  authRequired,
  adminOnly,
  async (req, res) => {
    try {
      const influencerId = String(req.params.id || "").trim();
      const fileId = String(req.params.fileId || "").trim();

      if (!influencerId || !fileId) {
        return res.status(400).json({
          ok: false,
          error: "influencer_id_and_file_id_required",
        });
      }

      const file = await prisma.influencerFile.findUnique({
        where: { id: fileId },
      });

      if (!file || file.influencerId !== influencerId) {
        return res.status(404).json({
          ok: false,
          error: "influencer_file_not_found",
        });
      }

      const key = keyFromPublicUrl(file.fileUrl);

      if (!key) {
        return res.status(500).json({
          ok: false,
          error: "influencer_file_key_unresolvable",
        });
      }

      const url = await getSignedDownloadUrl({
        key,
        filename: file.originalFilename,
      });

      return res.json({ ok: true, url, expiresInSeconds: 300 });
    } catch (error) {
      console.error(
        "[adminInfluencersRoutes] GET /:id/files/:fileId/download error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "admin_influencer_file_download_failed",
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
  (
    _req,
    res
  ) => {
    return res.json({
      ok: true,

      module:
        "admin-influencers",

      commissionAgreements:
        true,
    });
  }
);

/* =========================================================
   PATCH /api/admin/influencers/:id/collaboration

   "Prelungește colaborarea" - setează InfluencerProfile.
   collaborationEndOverride (migrare
   20260922120000_add_influencer_collaboration_end_override).

   NU atinge status sau commissionBps - vezi
   services/influencerCollaboration.js (sursă unică de calcul):
     - dacă profile.status === DISABLED, statusul de colaborare
       rămâne DISABLED indiferent de noua dată (nu se reactivează
       automat);
     - dacă profile.status === ACTIVE și noua dată e în viitor,
       statusul de colaborare revine ACTIVE (chiar dacă era
       EXPIRED) - nu e un status stocat separat, e derivat.

   Body: { collaborationEnd: "<ISO date>" }.
   Regula secțiunii 5: noua dată trebuie să fie ulterioară
   collaborationEnd-ului CURENT (implicit sau dintr-un override
   anterior), nu doar ulterioară datei de start - acțiunea este
   explicit o PRELUNGIRE, nu o scurtare.
========================================================= */

const CollaborationExtensionSchema = z.object({
  collaborationEnd: z
    .string()
    .trim()
    .min(1),
});

router.patch(
  "/:id/collaboration",
  authRequired,
  adminOnly,
  async (req, res) => {
    try {
      const profileId = String(req.params.id || "").trim();

      if (!profileId) {
        return res.status(400).json({ ok: false, error: "profile_id_required" });
      }

      const parsed = CollaborationExtensionSchema.safeParse(req.body);

      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }

      const profile = await prisma.influencerProfile.findUnique({
        where: { id: profileId },
        select: {
          id: true,
          createdAt: true,
          status: true,
          commissionBps: true,
          collaborationEndOverride: true,
        },
      });

      if (!profile) {
        return res.status(404).json({ ok: false, error: "influencer_not_found" });
      }

      /*
       * Starea CURENTĂ (înainte de prelungire) - de aici citim
       * collaborationEnd-ul față de care se validează noua dată
       * (secțiunea 5: de la end-ul curent, nu de la createdAt).
       */
      const currentState = computeCollaborationState({
        activatedAt: profile.createdAt,
        status: profile.status,
        commissionBps: profile.commissionBps,
        collaborationEndOverride: profile.collaborationEndOverride,
      });

      const validation = validateCollaborationExtension({
        collaborationEnd: parsed.data.collaborationEnd,
        collaborationStart: currentState.collaborationStart,
        currentCollaborationEnd: currentState.collaborationEnd,
      });

      if (!validation.valid) {
        return res.status(400).json({
          ok: false,
          error: validation.code,
        });
      }

      const updated = await prisma.influencerProfile.update({
        where: { id: profileId },
        data: { collaborationEndOverride: validation.date },
        select: {
          id: true,
          createdAt: true,
          status: true,
          commissionBps: true,
          collaborationEndOverride: true,
        },
      });

      const collaboration = computeCollaborationState({
        activatedAt: updated.createdAt,
        status: updated.status,
        commissionBps: updated.commissionBps,
        collaborationEndOverride: updated.collaborationEndOverride,
      });

      /*
       * Nu există niciun mecanism generic de audit/activity log în
       * acest backend (verificat: niciun model Prisma de tip
       * AuditLog/ActivityLog și nicio rută care scrie așa ceva) -
       * per cerință, NU s-a creat unul acum. Rămâne doar acest log
       * de proces (nu e persistat în DB).
       */
      console.log(
        "[adminInfluencers] collaboration extended",
        {
          influencerId: profileId,
          adminId: req.adminUser?.id || null,
          previousCollaborationEnd: currentState.collaborationEnd,
          newCollaborationEnd: collaboration.collaborationEnd,
          at: new Date(),
        }
      );

      return res.json({
        ok: true,
        collaboration,
      });
    } catch (error) {
      console.error(
        "[adminInfluencers] PATCH /:id/collaboration error:",
        error
      );

      return res.status(500).json({ ok: false, error: "collaboration_update_failed" });
    }
  }
);

export default router;