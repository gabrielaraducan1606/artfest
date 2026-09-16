// backend/src/routes/influencerRoutes.js

import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { z } from "zod";

import { prisma } from "../db.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import { loadLegalDoc } from "../lib/legal.js";
import {
  authRequired,
  enforceTokenVersion,
  signToken,
} from "../api/auth.js";

import {
  getInfluencerConfirmedTotals,
  getInfluencerEstimatedEarnings,
  getInfluencerAttributedTotals,
  listInfluencerAttributedOrders,
} from "../services/influencerEarnings.js";

import {
  getInfluencerTermsStatus,
  INFLUENCER_TERMS_CONSENT_DOCUMENT,
} from "../services/influencerTermsStatus.js";

import {
  normalizeIban,
  isValidIbanFormat,
  normalizeCountryCode,
  computeIsComplete,
  resolveVerificationTransition,
  hasAnyRelevantFieldChanged,
  serializePayoutProfileFull,
  serializePayoutProfileSummary,
} from "../services/influencerPayoutProfile.js";

import {
  getNewProductsToday,
  getNewVendorsToday,
} from "../services/influencerGeneratedContent.js";

const router = Router();

/* =========================================================
   CONFIG
========================================================= */

const EMAIL_OTP_TTL_MIN = Number(
  process.env.EMAIL_OTP_TTL_MIN || 10
);

const EMAIL_OTP_PEPPER =
  process.env.EMAIL_OTP_PEPPER || "";

/* =========================================================
   HELPERS
========================================================= */

function normalizeEmail(value = "") {
  return String(value)
    .trim()
    .toLowerCase();
}

function sha256(value = "") {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function hashInviteToken(token) {
  return sha256(token);
}

function randomOtp6() {
  const n = crypto.randomInt(
    0,
    1000000
  );

  return String(n).padStart(
    6,
    "0"
  );
}

function hashOtp(
  email,
  code
) {
  return sha256(
    `${normalizeEmail(
      email
    )}:${String(
      code
    ).trim()}:${EMAIL_OTP_PEPPER}`
  );
}

function getReqIp(req) {
  const ipHeader = String(
    req.headers[
      "x-forwarded-for"
    ] || ""
  );

  return (
    ipHeader
      .split(",")[0]
      .trim() ||
    req.socket
      ?.remoteAddress ||
    null
  );
}

function getReqUa(req) {
  return (
    req.get(
      "user-agent"
    ) ||
    null
  );
}

function hashRequestIp(
  req
) {
  const ip =
    getReqIp(
      req
    );

  if (!ip) {
    return null;
  }

  return sha256(
    ip
  );
}

function truncateUserAgent(
  value
) {
  if (!value) {
    return null;
  }

  return String(
    value
  ).slice(
    0,
    500
  );
}
/**
 * commissionBps este folosit de acum
 * ca procent din COMISIONUL ARTFEST
 * alocat influencerului.
 *
 * Exemple:
 * 2500 bps = 25%
 * 3000 bps = 30%
 *
 * 0 = remunerația nu este încă setată.
 */
function bpsToPercent(
  value
) {
  return (
    Number(
      value || 0
    ) / 100
  );
}

function passwordStrengthScore(
  password = ""
) {
  const value =
    String(password);

  const length =
    value.length >= 8
      ? 1
      : 0;

  const lower =
    /[a-z]/.test(
      value
    )
      ? 1
      : 0;

  const upper =
    /[A-Z]/.test(
      value
    )
      ? 1
      : 0;

  const digit =
    /\d/.test(
      value
    )
      ? 1
      : 0;

  const symbol =
    /[^A-Za-z0-9]/.test(
      value
    )
      ? 1
      : 0;

  return (
    length +
    lower +
    upper +
    digit +
    symbol
  );
}

function invitationState(
  invite
) {
  if (!invite) {
    return "INVALID";
  }

  if (invite.usedAt) {
    return "USED";
  }

  if (
    new Date(
      invite.expiresAt
    ).getTime() <=
    Date.now()
  ) {
    return "EXPIRED";
  }

  return "VALID";
}

async function findInviteByRawToken(
  rawToken
) {
  if (
    !rawToken ||
    typeof rawToken !==
      "string"
  ) {
    return null;
  }

  const tokenHash =
    hashInviteToken(
      rawToken
    );

  return prisma.influencerInvite.findUnique(
    {
      where: {
        tokenHash,
      },
    }
  );
}

function mapConsentDocument(
  type
) {
  if (
    type === "tos"
  ) {
    return "TOS";
  }

  if (
    type ===
    "privacy_ack"
  ) {
    return "PRIVACY_ACK";
  }

  if (
    type ===
    "influencer_terms"
  ) {
    return "INFLUENCER_TERMS";
  }

  return "MARKETING_EMAIL_OPTIN";
}

/* =========================================================
   VALIDATION
========================================================= */

const ConsentSchema =
  z.object({
    type: z.enum([
      "tos",
      "privacy_ack",
      "influencer_terms",
      "marketing_email_optin",
    ]),

    version: z
      .string()
      .trim()
      .optional(),

    checksum: z
      .string()
      .trim()
      .optional()
      .nullable(),
  });

const RegisterInfluencerSchema =
  z.object({
    token: z
      .string()
      .trim()
      .min(20),

    /*
     * Standardizare Prenume/Nume (2026-09-11) - influencerul confirmă/
     * corectează prenumele și numele la crearea contului, chiar dacă
     * invitația avea deja un `name` precompletat (best-effort split pe
     * frontend). User.firstName/lastName devin sursa reală.
     */
    firstName: z
      .string()
      .trim()
      .min(
        1,
        "Introdu prenumele."
      )
      .max(80),

    lastName: z
      .string()
      .trim()
      .min(
        1,
        "Introdu numele."
      )
      .max(80),

    password: z
      .string()
      .min(
        8,
        "Parola trebuie să aibă minimum 8 caractere."
      ),

    confirmPassword: z
      .string()
      .min(1),

    consents: z
      .array(
        ConsentSchema
      )
      .optional()
      .default([]),
  });

const AcceptExistingSchema =
  z.object({
    token: z
      .string()
      .trim()
      .min(20),
  });

/* =========================================================
   GET /api/influencer/invite?token=...

   Verifică invitația înainte să afișăm
   formularul de creare cont.

   IMPORTANT:
   Nu expunem:
   - referralCode
   - commissionBps
   - remunerația

   Acestea sunt detalii interne.
========================================================= */

router.get(
  "/invite",
  async (
    req,
    res
  ) => {
    try {
      const rawToken =
        typeof req.query
          ?.token ===
        "string"
          ? req.query.token.trim()
          : "";

      if (!rawToken) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "token_required",
          });
      }

      const invite =
        await findInviteByRawToken(
          rawToken
        );

      const state =
        invitationState(
          invite
        );

      if (
        state ===
        "INVALID"
      ) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "invalid_invitation",

            message:
              "Invitația nu este validă.",
          });
      }

      if (
        state === "USED"
      ) {
        return res
          .status(410)
          .json({
            ok: false,

            error:
              "invitation_already_used",

            message:
              "Această invitație a fost deja folosită.",
          });
      }

      if (
        state ===
        "EXPIRED"
      ) {
        return res
          .status(410)
          .json({
            ok: false,

            error:
              "invitation_expired",

            message:
              "Această invitație a expirat.",
          });
      }

      const email =
        normalizeEmail(
          invite.email
        );

      const existingUser =
        await prisma.user.findUnique({
          where: {
            email,
          },

          select: {
            id: true,

            role: true,

            emailVerifiedAt:
              true,

            influencerProfile: {
              select: {
                id: true,
              },
            },
          },
        });

      return res.json({
        ok: true,

        invite: {
          name:
            invite.name ||
            "",

          email,

          expiresAt:
            invite.expiresAt,

          accountExists:
            !!existingUser,

          existingRole:
            existingUser
              ?.role ||
            null,

          alreadyInfluencer:
            !!existingUser
              ?.influencerProfile,
        },
      });
    } catch (
      error
    ) {
      console.error(
        "[influencerRoutes] GET /invite error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "invite_validation_failed",
        });
    }
  }
);

/* =========================================================
   POST /api/influencer/register

   Creează un CONT NOU de influencer.

   IMPORTANT:
   - frontendul NU poate trimite role
   - frontendul NU poate trimite remunerația
   - frontendul NU poate trimite referralCode
   - referralCode vine exclusiv din invitație
   - remunerația pornește NESATATĂ = 0
========================================================= */

router.post(
  "/register",
  async (
    req,
    res
  ) => {
    try {
      const parsed =
        RegisterInfluencerSchema.safeParse(
          req.body ||
            {}
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

      const {
        token,
        password,
        confirmPassword,
        consents = [],
      } = parsed.data;

      const firstName =
        parsed.data.firstName.trim();

      const lastName =
        parsed.data.lastName.trim();

      if (
        password !==
        confirmPassword
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "passwords_do_not_match",

            message:
              "Parolele nu coincid.",
          });
      }

      if (
        passwordStrengthScore(
          password
        ) < 3
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "weak_password",

            message:
              "Alege o parolă mai puternică.",
          });
      }

      const hasTosConsent =
        consents.some(
          (item) =>
            item?.type ===
            "tos"
        );

      const hasPrivacyConsent =
        consents.some(
          (item) =>
            item?.type ===
            "privacy_ack"
        );

      const hasInfluencerTermsConsent =
        consents.some(
          (item) =>
            item?.type ===
            "influencer_terms"
        );

      const hasMarketingConsent =
        consents.some(
          (item) =>
            item?.type ===
            "marketing_email_optin"
        );

      if (
        !hasTosConsent ||
        !hasPrivacyConsent
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "mandatory_consents_required",

            message:
              "Termenii și Condițiile, Politica de confidențialitate și Acordul Programului de Influenceri trebuie acceptate.",
          });
      }

      /*
       * Acordul influencerului
       * este obligatoriu separat.
       */
      if (
        !hasInfluencerTermsConsent
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "influencer_terms_required",

            message:
              "Trebuie să accepți Acordul privind Programul de Influenceri Artfest.",
          });
      }

      const invite =
        await findInviteByRawToken(
          token
        );

      const state =
        invitationState(
          invite
        );

      if (
        state ===
        "INVALID"
      ) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "invalid_invitation",
          });
      }

      if (
        state === "USED"
      ) {
        return res
          .status(410)
          .json({
            ok: false,

            error:
              "invitation_already_used",
          });
      }

      if (
        state ===
        "EXPIRED"
      ) {
        return res
          .status(410)
          .json({
            ok: false,

            error:
              "invitation_expired",
          });
      }

      const email =
        normalizeEmail(
          invite.email
        );

      /*
       * Dacă există deja cont cu acest
       * email NU îi schimbăm parola și
       * NU îi schimbăm rolul aici.
       *
       * Se autentifică și acceptă
       * prin /accept-existing.
       */

      const existingUser =
        await prisma.user.findUnique({
          where: {
            email,
          },

          select: {
            id: true,

            role: true,

            influencerProfile: {
              select: {
                id: true,
              },
            },
          },
        });

      if (
        existingUser
      ) {
        if (
          existingUser
            .influencerProfile
        ) {
          return res
            .status(409)
            .json({
              ok: false,

              error:
                "already_influencer",

              requiresLogin:
                true,
            });
        }

        return res
          .status(409)
          .json({
            ok: false,

            error:
              "account_already_exists",

            requiresLogin:
              true,

            message:
              "Există deja un cont Artfest cu acest email. Conectează-te în contul existent pentru a accepta invitația.",
          });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const reqIp =
        getReqIp(
          req
        );

      const reqUa =
        getReqUa(
          req
        );

      const created =
        await prisma.$transaction(
          async (
            tx
          ) => {
            /*
             * Recitim invitația în tranzacție
             * pentru a evita folosirea ei
             * simultan de două ori.
             */

            const freshInvite =
              await tx.influencerInvite.findUnique(
                {
                  where: {
                    id:
                      invite.id,
                  },
                }
              );

            if (
              !freshInvite ||
              freshInvite.usedAt ||
              new Date(
                freshInvite.expiresAt
              ).getTime() <=
                Date.now()
            ) {
              const error =
                new Error(
                  "invitation_unavailable"
                );

              error.code =
                "INVITATION_UNAVAILABLE";

              throw error;
            }

            /*
             * Referral code-ul este intern,
             * dar trebuie să rămână unic.
             */

            const existingProfile =
              await tx.influencerProfile.findUnique(
                {
                  where: {
                    referralCode:
                      freshInvite.referralCode,
                  },

                  select: {
                    id: true,
                  },
                }
              );

            if (
              existingProfile
            ) {
              const error =
                new Error(
                  "referral_code_taken"
                );

              error.code =
                "REFERRAL_CODE_TAKEN";

              throw error;
            }

            /*
             * Standardizare Prenume/Nume: User.firstName/lastName sunt
             * sursa reală (introduse/corectate de influencer la
             * creare, nu doar precompletate din invitație). `name`
             * legacy rămâne derivat din ele, pentru compatibilitate cu
             * restul aplicației care încă îl citește.
             */
            const fullName =
              `${firstName} ${lastName}`.trim();

            const user =
              await tx.user.create({
                data: {
                  email,

                  passwordHash,

                  firstName,

                  lastName,

                  name:
                    fullName ||
                    null,

                  role:
                    "INFLUENCER",

                  /*
                   * Rămâne neverificat până la OTP,
                   * identic cu signup-ul normal.
                   */
                  emailVerifiedAt:
                    null,

                  lastPasswordChangeAt:
                    new Date(),

                  marketingOptIn:
                    hasMarketingConsent,
                },

                select: {
                  id: true,
                  email: true,
                  role: true,
                  name: true,
                  firstName: true,
                  lastName: true,
                },
              });

            const profile =
              await tx.influencerProfile.create(
                {
                  data: {
                    userId:
                      user.id,

                    /*
                     * Valoare inițială pentru profilul PUBLIC de
                     * influencer - editabilă separat ulterior din
                     * Setări -> „Profil public influencer”, NU e
                     * același lucru cu User.firstName/lastName de mai
                     * sus (vezi raportul de standardizare).
                     */
                    displayName:
                      fullName ||
                      null,

                    /*
                     * Referral-ul rămâne intern
                     * și este folosit pentru
                     * linkul personal de tracking.
                     */
                    referralCode:
                      freshInvite.referralCode,

                    /*
                     * IMPORTANT:
                     * Nu copiem commissionBps
                     * din invitațiile vechi.
                     *
                     * 0 = remunerație nesetată.
                     */
                    commissionBps:
                      0,

                    status:
                      "ACTIVE",
                  },

                  select: {
                    id: true,
                  },
                }
              );

            /* ===============================================
               CONSENTS
            =============================================== */

            for (
              const consent of
              consents
            ) {
              await tx.userConsent.create(
                {
                  data: {
                    userId:
                      user.id,

                    document:
                      mapConsentDocument(
                        consent.type
                      ),

                    version:
                      consent.version ||
                      "1.0.0",

                    checksum:
                      consent.checksum ||
                      null,

                    ip:
                      reqIp ||
                      "",

                    ua:
                      reqUa ||
                      "",
                  },
                }
              );
            }

            /* ===============================================
               MARKETING
            =============================================== */

            if (
              hasMarketingConsent
            ) {
              await tx.newsletterSubscriber.upsert(
                {
                  where: {
                    email,
                  },

                  update: {
                    status:
                      "SUBSCRIBED",

                    unsubscribedAt:
                      null,

                    userId:
                      user.id,

                    source:
                      "OTHER",

                    sourceLabel:
                      "Influencer registration",

                    notes:
                      "Created from influencer invitation",
                  },

                  create: {
                    email,

                    status:
                      "SUBSCRIBED",

                    userId:
                      user.id,

                    source:
                      "OTHER",

                    sourceLabel:
                      "Influencer registration",

                    notes:
                      "Created from influencer invitation",
                  },
                }
              );
            }

            /* ===============================================
               INVITAȚIE FOLOSITĂ
            =============================================== */

            await tx.influencerInvite.update(
              {
                where: {
                  id:
                    freshInvite.id,
                },

                data: {
                  usedAt:
                    new Date(),

                  acceptedUserId:
                    user.id,
                },
              }
            );

            return {
              user,
              profile,
            };
          }
        );

      /* =====================================================
         VERIFICARE EMAIL
      ===================================================== */

      await prisma.emailVerificationToken.deleteMany(
        {
          where: {
            userId:
              created.user.id,

            purpose:
              "verify_email",

            usedAt:
              null,
          },
        }
      );

      const otp =
        randomOtp6();

      const otpHash =
        hashOtp(
          email,
          otp
        );

      const expiresAt =
        new Date(
          Date.now() +
            EMAIL_OTP_TTL_MIN *
              60 *
              1000
        );

      await prisma.emailVerificationToken.create(
        {
          data: {
            userId:
              created.user.id,

            tokenHash:
              otpHash,

            expiresAt,

            intent:
              "USER",

            purpose:
              "verify_email",
          },
        }
      );

      try {
        await sendVerificationEmail({
          to: email,

          code:
            otp,

          ttlMin:
            EMAIL_OTP_TTL_MIN,

          userId:
            created.user.id,
        });
      } catch (
        error
      ) {
        console.error(
          "[influencerRoutes] sendVerificationEmail failed:",
          error
        );
      }

      if (
        process.env
          .NODE_ENV !==
        "production"
      ) {
        console.log(
          "[DEV influencer verify code]",
          otp,
          "for",
          email
        );
      }

      return res
        .status(201)
        .json({
          ok: true,

          status:
            "pending_verification",

          next:
            `/verify-email?email=${encodeURIComponent(
              email
            )}`,

          user: {
            id:
              created.user.id,

            email:
              created.user.email,

            role:
              created.user.role,

            name:
              created.user.name,
          },

          /*
           * Nu expunem referralCode
           * și remunerația aici.
           */
          influencer: {
            id:
              created.profile.id,
          },
        });
    } catch (
      error
    ) {
      if (
        error?.code ===
        "INVITATION_UNAVAILABLE"
      ) {
        return res
          .status(410)
          .json({
            ok: false,

            error:
              "invitation_unavailable",
          });
      }

      if (
        error?.code ===
        "REFERRAL_CODE_TAKEN"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "referral_code_already_exists",
          });
      }

      if (
        error?.code ===
        "P2002"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "influencer_registration_conflict",
          });
      }

      console.error(
        "[influencerRoutes] POST /register error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_registration_failed",
        });
    }
  }
);

/* =========================================================
   POST /api/influencer/accept-existing

   Pentru situația:
   - influencerul are deja cont Artfest
   - se autentifică normal
   - acceptă invitația pe contul existent

   IMPORTANT:
   Nu transformăm VENDOR sau ADMIN în
   INFLUENCER, deoarece User are momentan
   un singur câmp role.
========================================================= */

router.post(
  "/accept-existing",
  authRequired,
  enforceTokenVersion,
  async (
    req,
    res
  ) => {
    try {
      const parsed =
        AcceptExistingSchema.safeParse(
          req.body ||
            {}
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
          });
      }

      const invite =
        await findInviteByRawToken(
          parsed.data
            .token
        );

      const state =
        invitationState(
          invite
        );

      if (
        state ===
        "INVALID"
      ) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "invalid_invitation",
          });
      }

      if (
        state === "USED"
      ) {
        return res
          .status(410)
          .json({
            ok: false,

            error:
              "invitation_already_used",
          });
      }

      if (
        state ===
        "EXPIRED"
      ) {
        return res
          .status(410)
          .json({
            ok: false,

            error:
              "invitation_expired",
          });
      }

      const userId =
        req.user?.sub;

      if (!userId) {
        return res
          .status(401)
          .json({
            ok: false,

            error:
              "unauthorized",
          });
      }

      const user =
        await prisma.user.findUnique({
          where: {
            id:
              userId,
          },

          select: {
            id: true,
            email: true,
            role: true,
            tokenVersion:
              true,

            influencerProfile: {
              select: {
                id: true,
              },
            },
          },
        });

      if (!user) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "user_not_found",
          });
      }

      /*
       * Invitația trebuie acceptată
       * exact de contul cu emailul
       * invitat.
       */

      if (
        normalizeEmail(
          user.email
        ) !==
        normalizeEmail(
          invite.email
        )
      ) {
        return res
          .status(403)
          .json({
            ok: false,

            error:
              "invitation_email_mismatch",

            message:
              "Invitația aparține unui alt email.",
          });
      }

      if (
        user.influencerProfile
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "already_influencer",
          });
      }

      /*
       * Momentan User are un singur rol.
       *
       * Nu transformăm automat:
       * VENDOR -> INFLUENCER
       * ADMIN  -> INFLUENCER
       */

      if (
        user.role !==
        "USER"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "role_incompatible",

            currentRole:
              user.role,

            message:
              "Acest cont are deja un alt rol în Artfest.",
          });
      }

      const result =
        await prisma.$transaction(
          async (
            tx
          ) => {
            /*
             * Recitim invitația în tranzacție
             * pentru a evita acceptarea
             * simultană.
             */

            const freshInvite =
              await tx.influencerInvite.findUnique(
                {
                  where: {
                    id:
                      invite.id,
                  },
                }
              );

            if (
              !freshInvite ||
              freshInvite.usedAt ||
              new Date(
                freshInvite.expiresAt
              ).getTime() <=
                Date.now()
            ) {
              const error =
                new Error(
                  "invitation_unavailable"
                );

              error.code =
                "INVITATION_UNAVAILABLE";

              throw error;
            }

            /*
             * Referral code intern.
             * Trebuie să fie unic.
             */

            const existingProfile =
              await tx.influencerProfile.findUnique(
                {
                  where: {
                    referralCode:
                      freshInvite.referralCode,
                  },

                  select: {
                    id: true,
                  },
                }
              );

            if (
              existingProfile
            ) {
              const error =
                new Error(
                  "referral_code_taken"
                );

              error.code =
                "REFERRAL_CODE_TAKEN";

              throw error;
            }

            /*
             * Creăm profilul influencerului.
             */

            const profile =
              await tx.influencerProfile.create(
                {
                  data: {
                    userId:
                      user.id,

                    displayName:
                      freshInvite.name ||
                      user.email,

                    /*
                     * Intern, pentru tracking.
                     */
                    referralCode:
                      freshInvite.referralCode,

                    /*
                     * Nu copiem valoarea veche
                     * din invitație.
                     *
                     * 0 = remunerație nesetată.
                     */
                    commissionBps:
                      0,

                    status:
                      "ACTIVE",
                  },

                  select: {
                    id: true,

                    userId:
                      true,

                    displayName:
                      true,

                    status:
                      true,
                  },
                }
              );

            /*
             * Schimbăm rolul userului.
             */

            const updatedUser =
              await tx.user.update({
                where: {
                  id:
                    user.id,
                },

                data: {
                  role:
                    "INFLUENCER",
                },

                select: {
                  id: true,
                  email: true,
                  name: true,
                  role: true,

                  tokenVersion:
                    true,
                },
              });

            /*
             * FIX: versiunea/checksum-ul NU mai sunt hardcodate -
             * citite dinamic din același document legal (sursa
             * canonică, legal/manifest.yml prin loadLegalDoc) care
             * alimentează și /api/legal (folosit de /register prin
             * consimțămintele trimise de client). Înainte, orice
             * acceptare prin acest flux înregistra mereu "1.0.0",
             * indiferent de versiunea reală curentă a documentului.
             */
            const influencerTermsDoc =
              loadLegalDoc(
                "influencer_terms"
              );

            await tx.userConsent.create(
              {
                data: {
                  userId:
                    user.id,

                  document:
                    "INFLUENCER_TERMS",

                  version:
                    influencerTermsDoc.policyVersion,

                  checksum:
                    influencerTermsDoc.checksum,

                  ip:
                    getReqIp(
                      req
                    ) ||
                    "",

                  ua:
                    getReqUa(
                      req
                    ) ||
                    "",
                },
              }
            );

            /*
             * Marcăm invitația ca folosită.
             */

            await tx.influencerInvite.update(
              {
                where: {
                  id:
                    freshInvite.id,
                },

                data: {
                  usedAt:
                    new Date(),

                  acceptedUserId:
                    user.id,
                },
              }
            );

            return {
              profile,
              updatedUser,
            };
          }
        );

      /*
       * Loginul inițial a creat JWT
       * când userul avea role=USER.
       *
       * După schimbarea rolului trebuie
       * emis imediat un JWT nou.
       */

      const jwt =
        signToken({
          sub:
            result
              .updatedUser
              .id,

          role:
            result
              .updatedUser
              .role,

          tv:
            result
              .updatedUser
              .tokenVersion,
        });

      /*
       * Aceeași logică secure/sameSite
       * folosită în authRoutes.
       */

      const forwardedProtocol =
        String(
          req.headers[
            "x-forwarded-proto"
          ] || ""
        ).toLowerCase();

      const secure =
        forwardedProtocol ===
          "https" ||
        !!req.secure;

      res.cookie(
        "token",
        jwt,
        {
          httpOnly:
            true,

          secure,

          sameSite:
            secure
              ? "None"
              : "Lax",

          path: "/",

          maxAge:
            7 *
            24 *
            60 *
            60 *
            1000,
        }
      );

      return res.json({
        ok: true,

        user: {
          id:
            result
              .updatedUser
              .id,

          email:
            result
              .updatedUser
              .email,

          name:
            result
              .updatedUser
              .name,

          role:
            result
              .updatedUser
              .role,
        },

        /*
         * Nu expunem referralCode
         * și remunerația.
         */
        influencer: {
          id:
            result
              .profile
              .id,

          displayName:
            result
              .profile
              .displayName,

          status:
            result
              .profile
              .status,
        },

        next:
          "/influencer",
      });
    } catch (
      error
    ) {
      if (
        error?.code ===
        "INVITATION_UNAVAILABLE"
      ) {
        return res
          .status(410)
          .json({
            ok: false,

            error:
              "invitation_unavailable",
          });
      }

      if (
        error?.code ===
        "REFERRAL_CODE_TAKEN"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "referral_code_already_exists",
          });
      }

      if (
        error?.code ===
        "P2002"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "influencer_profile_conflict",
          });
      }

      console.error(
        "[influencerRoutes] POST /accept-existing error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_accept_failed",
        });
    }
  }
);

/* =========================================================
   GET /api/influencer/me

   Dashboard influencer.

   referralCode:
   - nu este afișat ca "cod influencer"
   - este trimis doar pentru construirea
     linkului personal de tracking.

   commissionBps:
   - reprezintă procentul DIN COMISIONUL ARTFEST
   - 2500 = 25%
   - 3000 = 30%
   - 0 = nesetat
========================================================= */

router.get(
  "/me",
  authRequired,
  enforceTokenVersion,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user?.sub;

      if (!userId) {
        return res
          .status(401)
          .json({
            ok: false,

            error:
              "unauthorized",
          });
      }

      const user =
        await prisma.user.findUnique({
          where: {
            id:
              userId,
          },

          select: {
            id: true,
            email: true,
            name: true,
            firstName:
              true,
            lastName:
              true,
            avatarUrl:
              true,
            role: true,

            influencerProfile: {
              select: {
                id: true,

                displayName:
                  true,

                /*
                 * Folosit intern de frontend
                 * doar pentru linkul referral.
                 */
                referralCode:
                  true,

                commissionBps:
                  true,

                status:
                  true,

                instagramUrl:
                  true,

                tiktokUrl:
                  true,

                facebookUrl:
                  true,

                websiteUrl:
                  true,

                createdAt:
                  true,

                updatedAt:
                  true,

                _count: {
                  select: {
                    clicks:
                      true,
                  },
                },
              },
            },
          },
        });

      if (!user) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "user_not_found",
          });
      }

      if (
        user.role !==
          "INFLUENCER" ||
        !user.influencerProfile
      ) {
        return res
          .status(403)
          .json({
            ok: false,

            error:
              "influencer_required",
          });
      }

      const profile =
        user.influencerProfile;

      const displayName =
        profile.displayName ||
        user.name ||
        [
          user.firstName,
          user.lastName,
        ]
          .filter(
            Boolean
          )
          .join(" ")
          .trim() ||
        user.email;

      /*
       * commissionBps este interpretat
       * ca procent din comisionul Artfest.
       *
       * 2500 -> 25%
       */
      const platformCommissionSharePercent =
        bpsToPercent(
          profile.commissionBps
        );

      const commissionConfigured =
        Number(
          profile.commissionBps ||
            0
        ) > 0;

      /*
       * Agregate REALE (nu mai placeholder) - "confirmat" din
       * ledger-ul InfluencerEarningEntry, "estimat" calculat live
       * pe shipment-urile atribuite care încă n-au ajuns la
       * DELIVERED/IN_TRANSIT. Vezi services/influencerEarnings.js -
       * ACEEAȘI sursă folosită și de GET /orders și de admin.
       */
      const [
        confirmedTotals,
        estimatedEarningsAmount,
        attributedTotals,
        termsStatus,
        payoutProfileRow,
      ] = await Promise.all([
        getInfluencerConfirmedTotals(profile.id),
        getInfluencerEstimatedEarnings(profile.id),
        getInfluencerAttributedTotals(profile.id),
        getInfluencerTermsStatus(userId),
        prisma.influencerPayoutProfile.findUnique({
          where: { influencerId: profile.id },
        }),
      ]);

      return res.json({
        ok: true,

        /*
         * Aditiv - nu rupe shape-ul existent al /me. Vezi
         * services/influencerTermsStatus.js (sursă unică, folosită
         * și de enforceInfluencerTermsGate și de
         * POST /terms/accept).
         */
        terms: termsStatus,

        /*
         * Aditiv - shape MINIM, fără IBAN/taxId/adresă (vezi
         * services/influencerPayoutProfile.js). Detaliile complete
         * vin STRICT din GET /payout-profile.
         */
        payoutProfile: serializePayoutProfileSummary(payoutProfileRow),

        user: {
          id:
            user.id,

          email:
            user.email,

          name:
            displayName,

          firstName:
            user.firstName,

          lastName:
            user.lastName,

          avatarUrl:
            user.avatarUrl,

          role:
            user.role,
        },

        profile: {
          id:
            profile.id,

          displayName,

          /*
           * Nu este prezentat utilizatorului
           * ca "cod".
           *
           * Dashboardul îl folosește doar
           * pentru:
           * /?ref=...
           */
          referralCode:
            profile.referralCode,

          /*
           * Valoarea brută rămâne disponibilă
           * pentru backend/admin.
           */
          commissionBps:
            profile.commissionBps,

          /*
           * Contractul folosit acum de
           * InfluencerDashboardPage.jsx.
           */
          commissionConfigured,

          platformCommissionSharePercent,

          status:
            profile.status,

          clicks:
            profile._count
              ?.clicks ||
            0,

          /*
           * "Comenzi"/"Vânzări generate" trebuie să reflecte
           * atribuirea (?ref=/cod de influencer) de la plasarea
           * comenzii, nu doar shipment-urile deja confirmate
           * (DELIVERED/IN_TRANSIT) - vezi getInfluencerAttributedTotals.
           * "Câștig confirmat"/"estimat" rămân neschimbate mai jos.
           */
          ordersCount:
            attributedTotals.ordersCount,

          salesAmount:
            attributedTotals.salesAmount,

          /*
           * Păstrat pentru compatibilitate cu ce citea deja
           * dashboardul - egal cu confirmedEarningsAmount.
           */
          earningsAmount:
            confirmedTotals.confirmedEarningsAmount,

          confirmedEarningsAmount:
            confirmedTotals.confirmedEarningsAmount,

          estimatedEarningsAmount,

          instagramUrl:
            profile.instagramUrl,

          tiktokUrl:
            profile.tiktokUrl,

          facebookUrl:
            profile.facebookUrl,

          websiteUrl:
            profile.websiteUrl,

          createdAt:
            profile.createdAt,

          updatedAt:
            profile.updatedAt,
        },
      });
    } catch (
      error
    ) {
      console.error(
        "[influencerRoutes] GET /me error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "influencer_me_failed",
        });
    }
  }
);

/* =========================================================
   POST /api/influencer/terms/accept

   Acceptă versiunea CURENTĂ a Acordului Programului de Influenceri
   (influencer_terms). Fără body cu versiune trimisă de client -
   serverul citește versiunea/checksum-ul din documentul legal
   curent (aceeași sursă canonică folosită de
   enforceInfluencerTermsGate și de GET /me).

   Idempotent: UserConsent are @@unique([userId, document, version])
   - upsert-ul NU creează un duplicat dacă influencerul a acceptat
   deja EXACT această versiune (retry sigur); reaccept-ul pe același
   rând actualizează givenAt/checksum/ip/ua (vezi audit 2026-09-11 -
   un `update: {}` no-op lăsa `givenAt` blocat pe prima acceptare,
   ceea ce putea face statusul să pară în continuare "outdated" în
   raport cu o acceptare mai veche a altei versiuni).

   NU necesită enforceInfluencerTermsGate (ar bloca exact endpointul
   care rezolvă blocarea).

   NU șterge/modifică acceptările altor versiuni (V1 rămâne în
   istoric, ca rând separat în UserConsent) - se creează/actualizează
   strict rândul versiunii curente.
========================================================= */

router.post(
  "/terms/accept",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        return res
          .status(401)
          .json({ ok: false, error: "unauthorized" });
      }

      const influencer =
        await prisma.influencerProfile.findUnique({
          where: { userId },
          select: { id: true },
        });

      if (!influencer) {
        return res.status(403).json({
          ok: false,
          error: "influencer_required",
        });
      }

      const currentDoc = loadLegalDoc(
        "influencer_terms"
      );

      await prisma.userConsent.upsert({
        where: {
          userId_document_version: {
            userId,
            document:
              INFLUENCER_TERMS_CONSENT_DOCUMENT,
            version: currentDoc.policyVersion,
          },
        },

        /*
         * Reaccept pe EXACT aceeași versiune: nu duplicăm
         * (unique userId+document+version), dar înregistrăm
         * corect acest reaccept - altfel `givenAt` rămânea
         * blocat pe prima acceptare a acestei versiuni, iar
         * orice logică ce se uita la "cea mai recentă
         * acceptare" putea alege greșit o acceptare mai veche
         * a altei versiuni.
         */
        update: {
          givenAt: new Date(),
          checksum: currentDoc.checksum,
          ip: getReqIp(req) || "",
          ua: getReqUa(req) || "",
        },

        create: {
          userId,
          document:
            INFLUENCER_TERMS_CONSENT_DOCUMENT,
          version: currentDoc.policyVersion,
          checksum: currentDoc.checksum,
          ip: getReqIp(req) || "",
          ua: getReqUa(req) || "",
        },
      });

      const termsStatus =
        await getInfluencerTermsStatus(userId);

      return res.json({
        ok: true,
        terms: termsStatus,
      });
    } catch (error) {
      console.error(
        "[influencerRoutes] POST /terms/accept error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_terms_accept_failed",
      });
    }
  }
);

/* =========================================================
   PAYOUT PROFILE (date de plată / fiscale ale influencerului)

   NU integrează Stripe, NU efectuează plăți - doar profilul de
   date (beneficiar/IBAN/date fiscale) folosit ULTERIOR, într-o
   etapă separată, pentru a efectua plăți.
========================================================= */

const PayoutBeneficiaryTypeSchema = z.enum([
  "INDIVIDUAL",
  "PFA",
  "COMPANY",
  "OTHER",
]);

const NullableTrimmedString = (max) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional();

const PatchPayoutProfileSchema = z.object({
  beneficiaryType: z
    .union([PayoutBeneficiaryTypeSchema, z.null()])
    .optional(),

  beneficiaryName: NullableTrimmedString(200),
  iban: NullableTrimmedString(50),
  bankName: NullableTrimmedString(200),
  countryCode: NullableTrimmedString(2),

  fiscalName: NullableTrimmedString(200),
  taxId: NullableTrimmedString(50),
  registrationNumber: NullableTrimmedString(50),
  fiscalAddress: NullableTrimmedString(300),
  city: NullableTrimmedString(120),
  postalCode: NullableTrimmedString(20),
});

async function requireInfluencerForPayoutProfile(req, res) {
  const userId = req.user?.sub;

  if (!userId) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }

  const influencer = await prisma.influencerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!influencer) {
    res.status(403).json({ ok: false, error: "influencer_required" });
    return null;
  }

  return influencer;
}

/* =========================================================
   PATCH /api/influencer/profile

   Profilul PUBLIC de influencer (displayName + linkuri social) -
   SEPARAT de:
   - User.name/firstName/lastName (rămân editabile doar din
     PATCH /api/account/me/profile, tab „Profil” general);
   - InfluencerPayoutProfile (date fiscale/IBAN, editabile doar din
     PATCH /payout-profile mai jos).

   influencerId rezolvat STRICT din req.user.sub, via
   requireInfluencerForPayoutProfile (același helper ca la
   payout-profile) - clientul nu poate trimite influencerId.
========================================================= */

const NullableUrlString = (max) =>
  z
    .union([
      z
        .string()
        .trim()
        .max(max)
        .refine((value) => value === "" || /^https?:\/\//i.test(value), {
          message: "Linkul trebuie să înceapă cu http:// sau https://.",
        }),
      z.null(),
    ])
    .optional();

const PatchInfluencerProfileSchema = z.object({
  displayName: NullableTrimmedString(160),
  instagramUrl: NullableUrlString(300),
  tiktokUrl: NullableUrlString(300),
  facebookUrl: NullableUrlString(300),
  websiteUrl: NullableUrlString(300),
});

router.patch(
  "/profile",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer = await requireInfluencerForPayoutProfile(req, res);
      if (!influencer) return;

      const parsed = PatchInfluencerProfileSchema.safeParse(req.body || {});

      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }

      const input = parsed.data;
      const patch = {};

      if (input.displayName !== undefined) {
        patch.displayName = input.displayName || null;
      }

      if (input.instagramUrl !== undefined) {
        patch.instagramUrl = input.instagramUrl || null;
      }

      if (input.tiktokUrl !== undefined) {
        patch.tiktokUrl = input.tiktokUrl || null;
      }

      if (input.facebookUrl !== undefined) {
        patch.facebookUrl = input.facebookUrl || null;
      }

      if (input.websiteUrl !== undefined) {
        patch.websiteUrl = input.websiteUrl || null;
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({
          ok: false,
          error: "nothing_to_update",
          message: "Nu ai modificat niciun câmp.",
        });
      }

      const updated = await prisma.influencerProfile.update({
        where: { id: influencer.id },
        data: patch,
        select: {
          id: true,
          displayName: true,
          instagramUrl: true,
          tiktokUrl: true,
          facebookUrl: true,
          websiteUrl: true,
          updatedAt: true,
        },
      });

      return res.json({ ok: true, profile: updated });
    } catch (error) {
      console.error(
        "[influencerRoutes] PATCH /profile error:",
        error?.message || error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_profile_update_failed",
      });
    }
  }
);

/* =========================================================
   GET /api/influencer/payout-profile

   Shape COMPLET (IBAN/taxId/adresă incluse) - vizibil DOAR
   influencerului proprietar. Dacă profilul nu există încă,
   întoarce un shape gol coerent (exists:false), nu 404.
========================================================= */

router.get(
  "/payout-profile",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer = await requireInfluencerForPayoutProfile(req, res);
      if (!influencer) return;

      const row = await prisma.influencerPayoutProfile.findUnique({
        where: { influencerId: influencer.id },
      });

      return res.json({
        ok: true,
        payoutProfile: serializePayoutProfileFull(row),
      });
    } catch (error) {
      console.error(
        "[influencerRoutes] GET /payout-profile error:",
        error?.message || error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_payout_profile_load_failed",
      });
    }
  }
);

/* =========================================================
   PATCH /api/influencer/payout-profile

   Upsert. isComplete/verificationStatus/verifiedAt NU pot fi
   trimise de client - calculate strict server-side, din valorile
   FINALE (rând existent + modificări acceptate).
========================================================= */

router.patch(
  "/payout-profile",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer = await requireInfluencerForPayoutProfile(req, res);
      if (!influencer) return;

      const parsed = PatchPayoutProfileSchema.safeParse(req.body || {});

      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }

      const input = parsed.data;

      const existing = await prisma.influencerPayoutProfile.findUnique({
        where: { influencerId: influencer.id },
      });

      /* =====================================================
         NORMALIZARE - doar câmpurile efectiv trimise (PATCH
         parțial: `undefined` = neschimbat).
      ===================================================== */

      const patch = {};

      if (input.beneficiaryType !== undefined) {
        patch.beneficiaryType = input.beneficiaryType || null;
      }

      if (input.beneficiaryName !== undefined) {
        patch.beneficiaryName = input.beneficiaryName || null;
      }

      if (input.iban !== undefined) {
        const normalizedIban = input.iban
          ? normalizeIban(input.iban)
          : null;

        if (normalizedIban && !isValidIbanFormat(normalizedIban)) {
          return res.status(400).json({
            ok: false,
            error: "invalid_iban_format",
            message:
              "IBAN-ul nu are un format valid. Verifică și încearcă din nou.",
          });
        }

        patch.iban = normalizedIban;
      }

      if (input.bankName !== undefined) {
        patch.bankName = input.bankName || null;
      }

      if (input.countryCode !== undefined) {
        patch.countryCode = input.countryCode
          ? normalizeCountryCode(input.countryCode)
          : "RO";
      }

      if (input.fiscalName !== undefined) {
        patch.fiscalName = input.fiscalName || null;
      }

      if (input.taxId !== undefined) {
        patch.taxId = input.taxId
          ? input.taxId.replace(/\s+/g, "").toUpperCase()
          : null;
      }

      if (input.registrationNumber !== undefined) {
        patch.registrationNumber = input.registrationNumber || null;
      }

      if (input.fiscalAddress !== undefined) {
        patch.fiscalAddress = input.fiscalAddress || null;
      }

      if (input.city !== undefined) {
        patch.city = input.city || null;
      }

      if (input.postalCode !== undefined) {
        patch.postalCode = input.postalCode || null;
      }

      /* =====================================================
         MERGE (rând existent + patch) - baza pentru
         isComplete/verificationStatus, NICIODATĂ valorile brute
         trimise de client.
      ===================================================== */

      const merged = {
        beneficiaryType:
          patch.beneficiaryType !== undefined
            ? patch.beneficiaryType
            : existing?.beneficiaryType ?? null,

        beneficiaryName:
          patch.beneficiaryName !== undefined
            ? patch.beneficiaryName
            : existing?.beneficiaryName ?? null,

        iban: patch.iban !== undefined ? patch.iban : existing?.iban ?? null,

        bankName:
          patch.bankName !== undefined
            ? patch.bankName
            : existing?.bankName ?? null,

        countryCode:
          patch.countryCode !== undefined
            ? patch.countryCode
            : existing?.countryCode ?? "RO",

        fiscalName:
          patch.fiscalName !== undefined
            ? patch.fiscalName
            : existing?.fiscalName ?? null,

        taxId: patch.taxId !== undefined ? patch.taxId : existing?.taxId ?? null,

        registrationNumber:
          patch.registrationNumber !== undefined
            ? patch.registrationNumber
            : existing?.registrationNumber ?? null,

        fiscalAddress:
          patch.fiscalAddress !== undefined
            ? patch.fiscalAddress
            : existing?.fiscalAddress ?? null,

        city: patch.city !== undefined ? patch.city : existing?.city ?? null,

        postalCode:
          patch.postalCode !== undefined
            ? patch.postalCode
            : existing?.postalCode ?? null,
      };

      const isComplete = computeIsComplete(merged);

      const hasRelevantChange = hasAnyRelevantFieldChanged(
        existing,
        merged
      );

      const { verificationStatus, verifiedAt } =
        resolveVerificationTransition({
          wasStatus: existing?.verificationStatus || "INCOMPLETE",
          wasVerifiedAt: existing?.verifiedAt || null,
          isComplete,
          hasRelevantChange,
        });

      const row = await prisma.influencerPayoutProfile.upsert({
        where: { influencerId: influencer.id },

        update: {
          ...merged,
          isComplete,
          verificationStatus,
          verifiedAt,
        },

        create: {
          influencerId: influencer.id,
          ...merged,
          isComplete,
          verificationStatus,
          verifiedAt,
        },
      });

      return res.json({
        ok: true,
        payoutProfile: serializePayoutProfileFull(row),
      });
    } catch (error) {
      console.error(
        "[influencerRoutes] PATCH /payout-profile error:",
        error?.message || error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_payout_profile_save_failed",
      });
    }
  }
);

/* =========================================================
   GET /api/influencer/orders

   Lista comenzilor/shipment-urilor atribuite influencerului
   autentificat - paginată, FĂRĂ nicio dată personală despre
   client (nume/email/telefon/adresă).
========================================================= */

router.get(
  "/orders",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        return res
          .status(401)
          .json({ ok: false, error: "unauthorized" });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },

        select: {
          id: true,
          role: true,

          influencerProfile: {
            select: { id: true },
          },
        },
      });

      if (
        !user ||
        user.role !== "INFLUENCER" ||
        !user.influencerProfile
      ) {
        return res
          .status(403)
          .json({ ok: false, error: "influencer_required" });
      }

      const take = Math.min(
        50,
        Math.max(
          1,
          Number(req.query?.take) || 20
        )
      );

      const skip = Math.max(
        0,
        Number(req.query?.skip) || 0
      );

      const { items, total } =
        await listInfluencerAttributedOrders({
          influencerId: user.influencerProfile.id,
          take,
          skip,
        });

      return res.json({
        ok: true,
        items,
        total,
        take,
        skip,
      });
    } catch (error) {
      console.error(
        "[influencerRoutes] GET /orders error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_orders_load_failed",
      });
    }
  }
);

/* =========================================================
   GET /api/influencer/resources

   Materiale de promovare (InfluencerResource) - doar cele
   PUBLISHED, publicate deja și neexpirate. Nu trimitem
   niciodată DRAFT-uri către influenceri.
========================================================= */

/*
 * Regula de vizibilitate pentru influenceri - IDENTICĂ peste tot
 * (listă, download, marcare "am postat"), ca să nu existe
 * divergențe între ce vede influencerul și ce acceptă backendul.
 */
function isInfluencerResourceVisible(
  resource,
  now = new Date()
) {
  return Boolean(
    resource &&
      resource.status === "PUBLISHED" &&
      resource.publishedAt &&
      new Date(resource.publishedAt) <= now &&
      (!resource.expiresAt ||
        new Date(resource.expiresAt) > now)
  );
}

/*
 * Exportată - reutilizată și de copilotRouter.js (asistentul AI,
 * rol INFLUENCER), ca să nu existe o a doua implementare a acestei
 * verificări (activ + status ACTIVE).
 */
export async function requireActiveInfluencer(userId) {
  if (!userId) {
    return {
      error: {
        status: 401,
        body: { ok: false, error: "unauthorized" },
      },
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },

    select: {
      id: true,
      role: true,

      influencerProfile: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (
    !user ||
    user.role !== "INFLUENCER" ||
    !user.influencerProfile
  ) {
    return {
      error: {
        status: 403,
        body: { ok: false, error: "influencer_required" },
      },
    };
  }

  if (user.influencerProfile.status !== "ACTIVE") {
    return {
      error: {
        status: 403,
        body: { ok: false, error: "influencer_not_active" },
      },
    };
  }

  return { influencerId: user.influencerProfile.id };
}

/*
 * Bundle-ul complet de resurse pentru un influencer (items PUBLISHED
 * neexpirate + activitatea proprie + generatedContent) - extras din
 * handler-ul GET /resources ca funcție reutilizabilă, ca să nu
 * duplicăm acest query în influencerAssistantContext.js /
 * influencerAssistantCommands.js (asistentul AI pentru influenceri).
 * Comportamentul rutei HTTP rămâne identic - doar am mutat codul.
 */
export async function getInfluencerResourcesBundle(influencerId) {
  const now = new Date();

  const [items, newProductsToday, newVendorsToday] =
    await Promise.all([
      prisma.influencerResource.findMany({
        where: {
          status: "PUBLISHED",

          publishedAt: {
            lte: now,
          },

          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },

        orderBy: [
          { publishedAt: "desc" },
          { createdAt: "desc" },
        ],
      }),

      getNewProductsToday(),
      getNewVendorsToday(),
    ]);

  /*
   * Activitatea proprie a influencerului (postedCount/
   * lastPostedAt) - NU expunem niciodată activitatea altor
   * influenceri.
   */
  const activities =
    items.length
      ? await prisma.influencerResourceActivity.findMany({
          where: {
            influencerId,

            resourceId: {
              in: items.map(
                (item) => item.id
              ),
            },
          },

          select: {
            resourceId: true,
            lastPostedAt: true,
            postedCount: true,
          },
        })
      : [];

  const activityByResourceId = new Map(
    activities.map((activity) => [
      activity.resourceId,
      activity,
    ])
  );

  const itemsWithActivity = items.map(
    (item) => ({
      ...item,

      activity: {
        lastPostedAt:
          activityByResourceId.get(item.id)
            ?.lastPostedAt || null,

        postedCount:
          activityByResourceId.get(item.id)
            ?.postedCount || 0,
      },
    })
  );

  return {
    items: itemsWithActivity,

    generatedContent: {
      newProductsToday,
      newVendorsToday,
    },
  };
}

router.get(
  "/resources",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const auth = await requireActiveInfluencer(
        req.user?.sub
      );

      if (auth.error) {
        return res
          .status(auth.error.status)
          .json(auth.error.body);
      }

      const { influencerId } = auth;

      const bundle = await getInfluencerResourcesBundle(
        influencerId
      );

      return res.json({
        ok: true,
        items: bundle.items,
        generatedContent: bundle.generatedContent,
      });
    } catch (error) {
      console.error(
        "[influencerRoutes] GET /resources error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_resources_load_failed",
      });
    }
  }
);

/* =========================================================
   POST /api/influencer/resources/:id/posted

   Marchează (repetabil) că influencerul a postat despre o
   resursă. UPSERT pe @@unique([influencerId, resourceId]).
========================================================= */

router.post(
  "/resources/:id/posted",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const auth = await requireActiveInfluencer(
        req.user?.sub
      );

      if (auth.error) {
        return res
          .status(auth.error.status)
          .json(auth.error.body);
      }

      const { influencerId } = auth;

      const resourceId = String(
        req.params.id || ""
      ).trim();

      if (!resourceId) {
        return res.status(400).json({
          ok: false,
          error: "resource_id_required",
        });
      }

      const resource = await prisma.influencerResource.findUnique({
        where: { id: resourceId },
      });

      if (!resource) {
        return res.status(404).json({
          ok: false,
          error: "influencer_resource_not_found",
        });
      }

      if (!isInfluencerResourceVisible(resource)) {
        return res.status(404).json({
          ok: false,
          error: "influencer_resource_not_available",
        });
      }

      const now = new Date();

      const activity =
        await prisma.influencerResourceActivity.upsert({
          where: {
            influencerId_resourceId: {
              influencerId,
              resourceId,
            },
          },

          update: {
            lastPostedAt: now,

            postedCount: {
              increment: 1,
            },
          },

          create: {
            influencerId,
            resourceId,

            lastPostedAt: now,
            postedCount: 1,
          },

          select: {
            id: true,
            lastPostedAt: true,
            postedCount: true,
          },
        });

      return res.json({
        ok: true,
        activity,
      });
    } catch (error) {
      console.error(
        "[influencerRoutes] POST /resources/:id/posted error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_resource_mark_posted_failed",
      });
    }
  }
);

/* =========================================================
   GET /api/influencer/resources/:id/download

   Proxy server-side către mediaUrl - NU trimitem mediaUrl-ul
   R2 direct clientului (evită problema de CORS pe media.artfest.ro,
   fără să atingem configurarea R2/CDN).
========================================================= */

const RESOURCE_MEDIA_EXTENSION_BY_CONTENT_TYPE = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function resourceMediaExtension(contentType, fallbackUrl) {
  const mime = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (RESOURCE_MEDIA_EXTENSION_BY_CONTENT_TYPE[mime]) {
    return RESOURCE_MEDIA_EXTENSION_BY_CONTENT_TYPE[mime];
  }

  const match = String(fallbackUrl || "").match(
    /\.([a-z0-9]+)(?:\?|$)/i
  );

  return match ? match[1].toLowerCase() : "bin";
}

function stripDiacritics(value) {
  let result = "";

  for (const ch of String(value || "").normalize("NFD")) {
    const code = ch.codePointAt(0);

    /*
     * Interval Unicode "Combining Diacritical Marks"
     * (0x0300-0x036F) - identic ca scop cu
     * normalizeReferralCode() de mai sus in
     * adminInfluencersRoutes.js, doar scris fara
     * literal de regex ca sa evitam orice ambiguitate
     * de encoding.
     */
    if (code >= 0x0300 && code <= 0x036f) {
      continue;
    }

    result += ch;
  }

  return result;
}

function slugifyResourceTitle(value) {
  const slug = stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "resursa";
}

function resourceDateKey(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "necunoscut";
  }

  const pad = (n) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1
  )}-${pad(date.getDate())}`;
}

function buildResourceDownloadFilename(
  resource,
  extension
) {
  const isProductOfDayImage =
    resource.type === "PRODUCT_OF_DAY" &&
    resource.mediaType === "IMAGE";

  if (isProductOfDayImage) {
    return `produsul-zilei-${resourceDateKey(
      resource.publishedAt || resource.createdAt
    )}.${extension}`;
  }

  return `resursa-${slugifyResourceTitle(
    resource.title
  )}.${extension}`;
}

router.get(
  "/resources/:id/download",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const auth = await requireActiveInfluencer(
        req.user?.sub
      );

      if (auth.error) {
        return res
          .status(auth.error.status)
          .json(auth.error.body);
      }

      const id = String(req.params.id || "").trim();

      if (!id) {
        return res.status(400).json({
          ok: false,
          error: "resource_id_required",
        });
      }

      /*
       * IMPORTANT: mediaUrl vine STRICT din DB, după id - nu
       * acceptăm niciun URL trimis de frontend.
       */
      const resource = await prisma.influencerResource.findUnique({
        where: { id },
      });

      if (!resource) {
        return res.status(404).json({
          ok: false,
          error: "influencer_resource_not_found",
        });
      }

      if (!isInfluencerResourceVisible(resource)) {
        return res.status(404).json({
          ok: false,
          error: "influencer_resource_not_available",
        });
      }

      if (!resource.mediaUrl) {
        return res.status(400).json({
          ok: false,
          error: "no_media",
          message:
            "Această resursă nu are un fișier media.",
        });
      }

      let upstream;

      try {
        upstream = await fetch(resource.mediaUrl);
      } catch (fetchError) {
        console.error(
          "[influencerRoutes] GET /resources/:id/download fetch error:",
          fetchError
        );

        return res.status(502).json({
          ok: false,
          error: "media_fetch_failed",
          message: "Nu am putut descărca fișierul.",
        });
      }

      if (!upstream.ok) {
        return res.status(502).json({
          ok: false,
          error: "media_fetch_failed",
          message: "Nu am putut descărca fișierul.",
        });
      }

      const contentType =
        upstream.headers.get("content-type") ||
        (resource.mediaType === "VIDEO"
          ? "video/mp4"
          : "image/jpeg");

      const arrayBuffer = await upstream.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const extension = resourceMediaExtension(
        contentType,
        resource.mediaUrl
      );

      const filename = buildResourceDownloadFilename(
        resource,
        extension
      );

      res.setHeader("Content-Type", contentType);

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      res.setHeader(
        "Content-Length",
        String(buffer.length)
      );

      return res.status(200).send(buffer);
    } catch (error) {
      console.error(
        "[influencerRoutes] GET /resources/:id/download error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_resource_download_failed",
      });
    }
  }
);

/* =========================================================
   GET /api/influencer/commission-agreement

   Returnează propunerea PENDING curentă
   pentru influencerul autentificat.

   IMPORTANT:
   - commissionBps reprezintă procent
     din comisionul Artfest
   - nu modificăm commissionBps activ aici
========================================================= */

router.get(
  "/commission-agreement",
  authRequired,
  enforceTokenVersion,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user?.sub;

      if (!userId) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "unauthorized",
          });
      }

      const user =
        await prisma.user.findUnique(
          {
            where: {
              id:
                userId,
            },

            select: {
              id: true,
              role: true,

              influencerProfile: {
                select: {
                  id: true,
                  status: true,
                  commissionBps:
                    true,
                },
              },
            },
          }
        );

      if (!user) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "user_not_found",
          });
      }

      if (
        user.role !==
          "INFLUENCER" ||
        !user.influencerProfile
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "influencer_required",
          });
      }

      const agreement =
        await prisma.influencerCommissionAgreement.findFirst(
          {
            where: {
              influencerId:
                user.influencerProfile.id,

              status:
                "PENDING",
            },

            orderBy: {
              proposedAt:
                "desc",
            },

            select: {
              id: true,
              influencerId:
                true,
              commissionBps:
                true,
              status: true,
              agreementText:
                true,
              termsVersion:
                true,
              proposedAt:
                true,
              createdAt:
                true,
              updatedAt:
                true,
            },
          }
        );

      return res.json({
        ok: true,

        agreement,

        pendingAgreement:
          agreement,

        currentCommission: {
          commissionBps:
            user
              .influencerProfile
              .commissionBps,

          percent:
            bpsToPercent(
              user
                .influencerProfile
                .commissionBps
            ),
        },
      });
    } catch (
      error
    ) {
      console.error(
        "[influencerRoutes] GET /commission-agreement error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "commission_agreement_load_failed",
        });
    }
  }
);

/* =========================================================
   POST /api/influencer/commission-agreement/:id/accept

   Influencerul acceptă remunerația.

   Efect:
   1. agreement -> ACCEPTED
   2. acceptedAt -> now
   3. audit IP + user-agent
   4. InfluencerProfile.commissionBps
      devine valoarea acceptată

   IMPORTANT:
   Schimbarea remunerației active se face
   NUMAI aici, după acceptarea influencerului.
========================================================= */

router.post(
  "/commission-agreement/:id/accept",
  authRequired,
  enforceTokenVersion,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user?.sub;

      const agreementId =
        String(
          req.params.id ||
            ""
        ).trim();

      if (!userId) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "unauthorized",
          });
      }

      if (!agreementId) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "commission_agreement_id_required",
          });
      }

      const user =
        await prisma.user.findUnique(
          {
            where: {
              id:
                userId,
            },

            select: {
              id: true,
              role: true,

              influencerProfile: {
                select: {
                  id: true,
                  commissionBps:
                    true,
                },
              },
            },
          }
        );

      if (!user) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "user_not_found",
          });
      }

      if (
        user.role !==
          "INFLUENCER" ||
        !user.influencerProfile
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "influencer_required",
          });
      }

      const result =
        await prisma.$transaction(
          async (
            tx
          ) => {
            const agreement =
              await tx.influencerCommissionAgreement.findUnique(
                {
                  where: {
                    id:
                      agreementId,
                  },
                }
              );

            if (!agreement) {
              const error =
                new Error(
                  "commission_agreement_not_found"
                );

              error.code =
                "COMMISSION_AGREEMENT_NOT_FOUND";

              throw error;
            }

            if (
              agreement
                .influencerId !==
              user
                .influencerProfile
                .id
            ) {
              const error =
                new Error(
                  "commission_agreement_forbidden"
                );

              error.code =
                "COMMISSION_AGREEMENT_FORBIDDEN";

              throw error;
            }

            if (
              agreement.status !==
              "PENDING"
            ) {
              const error =
                new Error(
                  "commission_agreement_not_pending"
                );

              error.code =
                "COMMISSION_AGREEMENT_NOT_PENDING";

              error.currentStatus =
                agreement.status;

              throw error;
            }

            /*
             * Protecție suplimentară:
             * remunerația trebuie să fie
             * între 1% și 100% din comisionul Artfest.
             */

            const commissionBps =
              Number(
                agreement.commissionBps ||
                  0
              );

            if (
              !Number.isInteger(
                commissionBps
              ) ||
              commissionBps <=
                0 ||
              commissionBps >
                10000
            ) {
              const error =
                new Error(
                  "invalid_commission_bps"
                );

              error.code =
                "INVALID_COMMISSION_BPS";

              throw error;
            }

            const now =
              new Date();

            /*
             * Orice altă propunere PENDING
             * pentru acest influencer devine SUPERSEDED.
             *
             * În mod normal adminul deja face asta,
             * dar păstrăm protecția și aici.
             */

            await tx.influencerCommissionAgreement.updateMany(
              {
                where: {
                  influencerId:
                    user
                      .influencerProfile
                      .id,

                  status:
                    "PENDING",

                  id: {
                    not:
                      agreement.id,
                  },
                },

                data: {
                  status:
                    "SUPERSEDED",

                  supersededAt:
                    now,
                },
              }
            );

            const acceptedAgreement =
              await tx.influencerCommissionAgreement.update(
                {
                  where: {
                    id:
                      agreement.id,
                  },

                  data: {
                    status:
                      "ACCEPTED",

                    acceptedAt:
                      now,

                    declinedAt:
                      null,

                    supersededAt:
                      null,

                    acceptedIpHash:
                      hashRequestIp(
                        req
                      ),

                    acceptedUserAgent:
                      truncateUserAgent(
                        getReqUa(
                          req
                        )
                      ),
                  },

                  select: {
                    id: true,
                    commissionBps:
                      true,
                    status: true,
                    agreementText:
                      true,
                    termsVersion:
                      true,
                    proposedAt:
                      true,
                    acceptedAt:
                      true,
                    createdAt:
                      true,
                    updatedAt:
                      true,
                  },
                }
              );

            /*
             * ACUM devine remunerația activă.
             */

            const profile =
              await tx.influencerProfile.update(
                {
                  where: {
                    id:
                      user
                        .influencerProfile
                        .id,
                  },

                  data: {
                    commissionBps:
                      acceptedAgreement
                        .commissionBps,
                  },

                  select: {
                    id: true,
                    commissionBps:
                      true,
                    updatedAt:
                      true,
                  },
                }
              );

            return {
              agreement:
                acceptedAgreement,

              profile,
            };
          }
        );

      return res.json({
        ok: true,

        agreement:
          result.agreement,

        remuneration: {
          commissionBps:
            result.profile
              .commissionBps,

          percent:
            bpsToPercent(
              result.profile
                .commissionBps
            ),
        },

        message:
          "Remunerația a fost acceptată și este acum activă.",
      });
    } catch (
      error
    ) {
      if (
        error?.code ===
        "COMMISSION_AGREEMENT_NOT_FOUND"
      ) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "commission_agreement_not_found",
          });
      }

      if (
        error?.code ===
        "COMMISSION_AGREEMENT_FORBIDDEN"
      ) {
        return res
          .status(403)
          .json({
            ok: false,

            error:
              "commission_agreement_forbidden",
          });
      }

      if (
        error?.code ===
        "COMMISSION_AGREEMENT_NOT_PENDING"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "commission_agreement_not_pending",

            currentStatus:
              error.currentStatus,
          });
      }

      if (
        error?.code ===
        "INVALID_COMMISSION_BPS"
      ) {
        return res
          .status(409)
          .json({
            ok: false,

            error:
              "invalid_commission_bps",
          });
      }

      console.error(
        "[influencerRoutes] POST /commission-agreement/:id/accept error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "commission_agreement_accept_failed",
        });
    }
  }
);

/* =========================================================
   POST /api/influencer/commission-agreement/:id/decline

   Refuzarea propunerii NU schimbă
   remunerația activă din InfluencerProfile.

   Dacă influencerul avea deja 20% și refuză
   o propunere de 30%, rămâne cu 20%.
========================================================= */

router.post(
  "/commission-agreement/:id/decline",
  authRequired,
  enforceTokenVersion,
  async (
    req,
    res
  ) => {
    try {
      const userId =
        req.user?.sub;

      const agreementId =
        String(
          req.params.id ||
            ""
        ).trim();

      if (!userId) {
        return res
          .status(401)
          .json({
            ok: false,
            error:
              "unauthorized",
          });
      }

      if (!agreementId) {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "commission_agreement_id_required",
          });
      }

      const user =
        await prisma.user.findUnique(
          {
            where: {
              id:
                userId,
            },

            select: {
              id: true,
              role: true,

              influencerProfile: {
                select: {
                  id: true,
                  commissionBps:
                    true,
                },
              },
            },
          }
        );

      if (!user) {
        return res
          .status(404)
          .json({
            ok: false,
            error:
              "user_not_found",
          });
      }

      if (
        user.role !==
          "INFLUENCER" ||
        !user.influencerProfile
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error:
              "influencer_required",
          });
      }

      const agreement =
        await prisma.influencerCommissionAgreement.findUnique(
          {
            where: {
              id:
                agreementId,
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
        agreement
          .influencerId !==
        user
          .influencerProfile
          .id
      ) {
        return res
          .status(403)
          .json({
            ok: false,

            error:
              "commission_agreement_forbidden",
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

            currentStatus:
              agreement.status,
          });
      }

      const declinedAgreement =
        await prisma.influencerCommissionAgreement.update(
          {
            where: {
              id:
                agreement.id,
            },

            data: {
              status:
                "DECLINED",

              declinedAt:
                new Date(),

              acceptedAt:
                null,

              supersededAt:
                null,
            },

            select: {
              id: true,
              commissionBps:
                true,
              status: true,
              agreementText:
                true,
              termsVersion:
                true,
              proposedAt:
                true,
              declinedAt:
                true,
              createdAt:
                true,
              updatedAt:
                true,
            },
          }
        );

      return res.json({
        ok: true,

        agreement:
          declinedAgreement,

        currentRemuneration: {
          commissionBps:
            user
              .influencerProfile
              .commissionBps,

          percent:
            bpsToPercent(
              user
                .influencerProfile
                .commissionBps
            ),
        },

        message:
          "Propunerea de remunerație a fost refuzată.",
      });
    } catch (
      error
    ) {
      console.error(
        "[influencerRoutes] POST /commission-agreement/:id/decline error:",
        error
      );

      return res
        .status(500)
        .json({
          ok: false,

          error:
            "commission_agreement_decline_failed",
        });
    }
  }
);

export default router;