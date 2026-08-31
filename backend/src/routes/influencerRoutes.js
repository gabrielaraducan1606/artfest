// backend/src/routes/influencerRoutes.js

import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { z } from "zod";

import { prisma } from "../db.js";
import { sendVerificationEmail } from "../lib/mailer.js";
import {
  authRequired,
  enforceTokenVersion,
  signToken,
} from "../api/auth.js";

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

            const user =
              await tx.user.create({
                data: {
                  email,

                  passwordHash,

                  name:
                    freshInvite.name ||
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
                },
              });

            const profile =
              await tx.influencerProfile.create(
                {
                  data: {
                    userId:
                      user.id,

                    displayName:
                      freshInvite.name ||
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
             * Păstrăm comportamentul existent
             * pentru acceptarea acordului
             * în fluxul de cont existent.
             */

            await tx.userConsent.create(
              {
                data: {
                  userId:
                    user.id,

                  document:
                    "INFLUENCER_TERMS",

                  version:
                    "1.0.0",

                  checksum:
                    null,

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

      return res.json({
        ok: true,

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
           * Le conectăm ulterior la
           * atribuirea reală a comenzilor.
           */
          ordersCount:
            0,

          salesAmount:
            0,

          earningsAmount:
            0,

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

export default router;