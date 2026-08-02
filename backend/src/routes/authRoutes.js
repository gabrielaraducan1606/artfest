// src/routes/authRoutes.js

/**
 * Rute de autentificare / cont utilizator.
 *
 * Prefix: /api/auth/*
 */

import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { z } from "zod";

import { prisma } from "../db.js";

import {
  sendVerificationEmail,
} from "../lib/mailer.js";

import {
  signToken,
  authRequired,
  enforceTokenVersion,
} from "../api/auth.js";

import {
  ensureBasicSubscriptionForVendor,
} from "./subscriptionRoutes.js";

import googleAuthRoutes from "./authGoogleRoutes.js";
import forgotPassword from "./forgot-passwordRoutes.js";
import resetPassword from "./resetPassword.js";

const router = Router();

/* =========================================================
 * Configurare generală
 * ========================================================= */

const LOGIN_WINDOW_MINUTES =
  Number(
    process.env.LOGIN_WINDOW_MINUTES ||
      10
  );

const LOGIN_MAX_ATTEMPTS_PER_WINDOW =
  Number(
    process.env
      .LOGIN_MAX_ATTEMPTS_PER_WINDOW ||
      8
  );

/* =========================================================
 * Helpers generale
 * ========================================================= */

const sha256 = (value) =>
  crypto
    .createHash("sha256")
    .update(value, "utf8")
    .digest("hex");

const normalizeEmail = (
  value = ""
) =>
  String(value)
    .trim()
    .toLowerCase();

const getIdemKey = (req) =>
  req.headers[
    "idempotency-key"
  ] || null;

function getReqIp(req) {
  const ipHeader =
    String(
      req.headers[
        "x-forwarded-for"
      ] || ""
    );

  return (
    ipHeader
      .split(",")[0]
      .trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

function getReqUa(req) {
  return (
    req.get("user-agent") ||
    null
  );
}

/**
 * Cookie options trebuie să fie identice
 * atât la setare, cât și la ștergere.
 */
function isSecureReq(req) {
  const forwardedProtocol =
    String(
      req.headers[
        "x-forwarded-proto"
      ] || ""
    ).toLowerCase();

  if (
    forwardedProtocol ===
    "https"
  ) {
    return true;
  }

  return !!req.secure;
}

function cookieOpts(
  req,
  maxAge
) {
  const secure =
    isSecureReq(req);

  return {
    httpOnly: true,
    secure,

    sameSite: secure
      ? "None"
      : "Lax",

    path: "/",

    ...(typeof maxAge ===
    "number"
      ? {
          maxAge,
        }
      : {}),
  };
}

/* =========================================================
 * OTP verificare email
 * ========================================================= */

const EMAIL_OTP_TTL_MIN =
  Number(
    process.env
      .EMAIL_OTP_TTL_MIN ||
      10
  );

const EMAIL_OTP_MAX_ATTEMPTS =
  Number(
    process.env
      .EMAIL_OTP_MAX_ATTEMPTS ||
      6
  );

const EMAIL_OTP_LOCK_MIN =
  Number(
    process.env
      .EMAIL_OTP_LOCK_MIN ||
      15
  );

const EMAIL_OTP_PEPPER =
  process.env.EMAIL_OTP_PEPPER ||
  "";

function randomOtp6() {
  const number =
    crypto.randomInt(
      0,
      1000000
    );

  return String(number).padStart(
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

/* =========================================================
 * Scheme Zod
 * ========================================================= */

const ConsentSchema = z.object({
  type: z.enum([
    "tos",
    "privacy_ack",
    "marketing_email_optin",
    "vendor_terms",
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

const SignupSchema = z.object({
  email: z
    .string()
    .email()
    .transform(normalizeEmail),

  password: z
    .string()
    .min(
      8,
      "Parola minim 8 caractere"
    ),

  name: z
    .string()
    .trim()
    .optional(),

  firstName: z
    .string()
    .trim()
    .optional(),

  lastName: z
    .string()
    .trim()
    .optional(),

  asVendor: z
    .boolean()
    .optional()
    .default(false),

  entitySelfDeclared: z
    .boolean()
    .optional()
    .default(false),

  entityMeta: z
    .object({
      pageUrl: z
        .string()
        .trim()
        .optional(),

      referrer: z
        .string()
        .trim()
        .optional()
        .nullable(),
    })
    .optional(),

  consents: z
    .array(ConsentSchema)
    .optional()
    .default([]),

  noExternalLinks: z
    .boolean()
    .optional(),

  ref: z
    .string()
    .trim()
    .optional()
    .nullable(),
});

const LoginSchema = z.object({
  email: z
    .string()
    .email()
    .transform(normalizeEmail),

  password: z
    .string()
    .min(1),

  remember: z
    .boolean()
    .optional(),
});

const VerifyEmailSchema =
  z.object({
    email: z
      .string()
      .email()
      .transform(
        normalizeEmail
      ),

    code: z
      .string()
      .regex(/^\d{6}$/),
  });

/* =========================================================
 * Idempotency
 * ========================================================= */

async function idemFind(key) {
  if (!key) {
    return null;
  }

  try {
    return await prisma.requestLog.findUnique({
      where: {
        idempotencyKey:
          String(key),
      },
    });
  } catch {
    return null;
  }
}

async function idemSave(
  key,
  responseJson
) {
  if (!key) {
    return;
  }

  try {
    await prisma.requestLog.create({
      data: {
        idempotencyKey:
          String(key),

        responseJson,
      },
    });
  } catch {
    // Ignore duplicate or logging errors.
  }
}

/* =========================================================
 * Audit login
 * ========================================================= */

async function logLoginAttempt(
  req,
  {
    userId,
    email,
    success,
  }
) {
  try {
    await prisma.loginAttempt.create({
      data: {
        userId:
          userId || null,

        email:
          email || null,

        success:
          !!success,

        ip:
          getReqIp(req),

        userAgent:
          getReqUa(req),
      },
    });
  } catch (error) {
    console.error(
      "Failed to log login attempt:",
      error
    );
  }
}

/* =========================================================
 * POST /api/auth/signup
 * ========================================================= */

router.post(
  "/signup",
  async (req, res) => {
    try {
      const parsed =
        SignupSchema.safeParse(
          req.body || {}
        );

      if (!parsed.success) {
        return res.status(400).json({
          error:
            "invalid_payload",

          details:
            parsed.error.flatten(),
        });
      }

      const {
        email,
        password,
        name,
        firstName,
        lastName,
        asVendor,
        entitySelfDeclared,
        entityMeta,
        consents = [],
        ref,
      } = parsed.data;

      const hasMarketingOptIn =
        consents.some(
          (consent) =>
            consent?.type ===
            "marketing_email_optin"
        );

      const hasVendorTermsConsent =
        consents.some(
          (consent) =>
            consent?.type ===
            "vendor_terms"
        );

      const hasTosConsent =
        consents.some(
          (consent) =>
            consent?.type ===
            "tos"
        );

      const hasPrivacyConsent =
        consents.some(
          (consent) =>
            consent?.type ===
            "privacy_ack"
        );

      /*
       * Consimțămintele generale sunt
       * obligatorii și sunt validate și
       * în backend, nu doar în frontend.
       */
      if (
        !hasTosConsent ||
        !hasPrivacyConsent
      ) {
        return res.status(400).json({
          error:
            "mandatory_consents_required",

          message:
            "Termenii și Condițiile și Politica de confidențialitate trebuie acceptate.",
        });
      }

      /*
       * Declarația fiscală este obligatorie
       * pentru furnizori.
       */
      if (
        asVendor &&
        !entitySelfDeclared
      ) {
        return res.status(400).json({
          error:
            "vendor_declaration_required",

          message:
            "Declarația privind responsabilitatea fiscală și legalitatea activității este obligatorie.",
        });
      }

      if (
        asVendor &&
        !hasVendorTermsConsent
      ) {
        return res.status(400).json({
          error:
            "vendor_terms_required",

          message:
            "Acordul Master pentru Vânzători este obligatoriu.",
        });
      }

      const idemKey =
        getIdemKey(req);

      const previousRequest =
        await idemFind(
          idemKey
        );

      if (previousRequest) {
        return res
          .status(200)
          .json(
            previousRequest.responseJson
          );
      }

      const existingUser =
        await prisma.user.findUnique({
          where: {
            email,
          },

          select: {
            id: true,
            emailVerifiedAt:
              true,
          },
        });

      if (existingUser) {
        const unverified =
          !existingUser.emailVerifiedAt;

        return res.status(409).json({
          error: unverified
            ? "email_exists_unverified"
            : "email_deja_folosit",

          message: unverified
            ? "Există deja un cont cu acest email, dar nu este confirmat."
            : "Acest email este deja folosit.",
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const reqIp =
        getReqIp(req);

      const reqUa =
        getReqUa(req);

      const created =
        await prisma.$transaction(
          async (tx) => {
            const user =
              await tx.user.create({
                data: {
                  email,
                  passwordHash,

                  name:
                    name ??
                    (
                      [
                        firstName,
                        lastName,
                      ]
                        .filter(
                          Boolean
                        )
                        .join(" ")
                        .trim() ||
                      null
                    ),

                  firstName:
                    firstName ||
                    null,

                  lastName:
                    lastName ||
                    null,

                  role:
                    asVendor
                      ? "VENDOR"
                      : "USER",

                  emailVerifiedAt:
                    null,

                  lastPasswordChangeAt:
                    new Date(),

                  marketingOptIn:
                    hasMarketingOptIn,
                },

                select: {
                  id: true,
                  email: true,
                  role: true,
                  name: true,
                },
              });

            /*
             * Salvăm consimțămintele generale.
             * vendor_terms se salvează separat
             * în VendorAcceptance.
             */
            for (
              const consent
              of consents
            ) {
              if (
                !consent?.type ||
                consent.type ===
                  "vendor_terms"
              ) {
                continue;
              }

              let document;

              if (
                consent.type ===
                "tos"
              ) {
                document =
                  "TOS";
              } else if (
                consent.type ===
                "privacy_ack"
              ) {
                document =
                  "PRIVACY_ACK";
              } else if (
                consent.type ===
                "marketing_email_optin"
              ) {
                document =
                  "MARKETING_EMAIL_OPTIN";
              } else {
                continue;
              }

              await tx.userConsent.create({
                data: {
                  userId:
                    user.id,

                  document,

                  version:
                    consent.version ||
                    "1.0.0",

                  checksum:
                    consent.checksum ||
                    null,

                  ip:
                    reqIp,

                  ua:
                    reqUa,
                },
              });
            }

            if (
              hasMarketingOptIn
            ) {
              await tx.newsletterSubscriber.upsert({
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
                    "Register form opt-in",

                  notes:
                    "Created automatically from signup marketing opt-in",
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
                    "Register form opt-in",

                  notes:
                    "Created automatically from signup marketing opt-in",
                },
              });
            }

            let vendorId =
              null;

            if (asVendor) {
              const vendor =
                await tx.vendor.create({
                  data: {
                    userId:
                      user.id,

                    isActive:
                      false,

                    displayName:
                      "",

                    entitySelfDeclared:
                      true,

                    entitySelfDeclaredAt:
                      new Date(),

                    entitySelfDeclaredIp:
                      reqIp,

                    entitySelfDeclaredUa:
                      reqUa,

                    entitySelfDeclaredMeta:
                      entityMeta ??
                      null,
                  },
                });

              vendorId =
                vendor.id;

              const vendorTermsConsent =
                consents.find(
                  (consent) =>
                    consent?.type ===
                    "vendor_terms"
                );

              if (
                vendorTermsConsent
              ) {
                await tx.vendorAcceptance.create({
                  data: {
                    vendorId:
                      vendor.id,

                    userId:
                      user.id,

                    document:
                      "VENDOR_TERMS",

                    version:
                      vendorTermsConsent.version ||
                      "1.0.0",

                    checksum:
                      vendorTermsConsent.checksum ||
                      null,

                    acceptedAt:
                      new Date(),

                    ip:
                      reqIp,

                    ua:
                      reqUa,

                    source:
                      "register",
                  },
                });
              }

              const referralCode =
                ref ||
                req.query?.ref ||
                null;

              if (referralCode) {
                const ambassador =
                  await tx.ambassadorProfile.findUnique({
                    where: {
                      referralCode,
                    },
                  });

                if (
                  ambassador &&
                  ambassador.vendorId !==
                    vendor.id
                ) {
                  const existingReferral =
                    await tx.ambassadorReferral.findUnique({
                      where: {
                        invitedVendorId:
                          vendor.id,
                      },
                    });

                  if (
                    !existingReferral
                  ) {
                    await tx.ambassadorReferral.create({
                      data: {
                        ambassadorId:
                          ambassador.id,

                        invitedVendorId:
                          vendor.id,

                        invitedUserId:
                          user.id,

                        status:
                          "CONVERTED",

                        convertedAt:
                          new Date(),
                      },
                    });

                    await tx.ambassadorProfile.update({
                      where: {
                        id:
                          ambassador.id,
                      },

                      data: {
                        invitedCount: {
                          increment:
                            1,
                        },
                      },
                    });
                  }
                }
              }
            }

            return {
              ...user,
              vendorId,
            };
          }
        );

      /*
       * Activăm planul Basic pentru vendor.
       */
      if (created.vendorId) {
        try {
          await ensureBasicSubscriptionForVendor(
            created.vendorId
          );
        } catch (error) {
          console.error(
            "AUTO BASIC SUBSCRIPTION FAILED:",
            error
          );
        }
      }

      /*
       * Generăm codul OTP pentru verificarea emailului.
       */
      await prisma.emailVerificationToken.deleteMany({
        where: {
          userId:
            created.id,

          purpose:
            "verify_email",

          usedAt:
            null,
        },
      });

      const otp =
        randomOtp6();

      const tokenHash =
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

      await prisma.emailVerificationToken.create({
        data: {
          userId:
            created.id,

          tokenHash,

          expiresAt,

          intent:
            asVendor
              ? "VENDOR"
              : "USER",

          purpose:
            "verify_email",
        },
      });

      try {
        await sendVerificationEmail({
          to:
            email,

          code:
            otp,

          ttlMin:
            EMAIL_OTP_TTL_MIN,

          userId:
            created.id,
        });
      } catch (error) {
        console.error(
          "sendVerificationEmail failed:",
          error
        );
      }

      if (
        process.env.NODE_ENV !==
        "production"
      ) {
        console.log(
          "[DEV verify code]",
          otp,
          "for",
          email
        );
      }

      const responseJson = {
        status:
          "pending_verification",

        next:
          `/verify-email?email=${encodeURIComponent(
            email
          )}`,

        asVendorIntent:
          !!asVendor,
      };

      if (idemKey) {
        await idemSave(
          idemKey,
          responseJson
        );
      }

      return res
        .status(200)
        .json(
          responseJson
        );
    } catch (error) {
      if (
        error?.code ===
        "P2002"
      ) {
        return res.status(409).json({
          error:
            "email_deja_folosit",
        });
      }

      console.error(
        "SIGNUP error:",
        error
      );

      return res.status(500).json({
        error:
          "signup_failed",
      });
    }
  }
);

/* =========================================================
 * POST /api/auth/verify-email
 * ========================================================= */

router.post(
  "/verify-email",
  async (req, res) => {
    try {
      const parsed =
        VerifyEmailSchema.safeParse(
          req.body || {}
        );

      if (!parsed.success) {
        return res.status(400).json({
          message:
            "Email sau cod invalid.",
        });
      }

      const {
        email,
        code,
      } = parsed.data;

      const user =
        await prisma.user.findUnique({
          where: {
            email,
          },

          select: {
            id: true,
            role: true,

            tokenVersion:
              true,

            emailVerifiedAt:
              true,

            locked:
              true,
          },
        });

      if (!user) {
        return res.status(400).json({
          message:
            "Cod invalid sau expirat.",
        });
      }

      if (user.locked) {
        return res.status(403).json({
          message:
            "Contul este blocat.",
        });
      }

      /*
       * Dacă este deja verificat, îl autentificăm.
       */
      if (
        user.emailVerifiedAt
      ) {
        const jwt =
          signToken({
            sub:
              user.id,

            role:
              user.role,

            tv:
              user.tokenVersion,
          });

        res.cookie(
          "token",
          jwt,
          cookieOpts(
            req,
            7 *
              24 *
              60 *
              60 *
              1000
          )
        );

        let next =
          "/desktop-user";

        if (
          user.role ===
          "ADMIN"
        ) {
          next =
            "/admin";
        } else if (
          user.role ===
          "VENDOR"
        ) {
          next =
            "/desktop";
        }

        return res.json({
          ok: true,
          next,
        });
      }

      const record =
        await prisma.emailVerificationToken.findFirst({
          where: {
            userId:
              user.id,

            purpose:
              "verify_email",

            usedAt:
              null,
          },

          orderBy: {
            createdAt:
              "desc",
          },
        });

      if (!record) {
        return res.status(400).json({
          message:
            "Cod invalid sau expirat.",
        });
      }

      if (
        record.expiresAt.getTime() <
        Date.now()
      ) {
        return res.status(400).json({
          message:
            "Cod expirat. Cere unul nou.",
        });
      }

      if (
        record.lockedUntil &&
        record.lockedUntil.getTime() >
          Date.now()
      ) {
        return res.status(429).json({
          message:
            "Prea multe încercări. Încearcă mai târziu.",
        });
      }

      const computedHash =
        hashOtp(
          email,
          code
        );

      if (
        computedHash !==
        record.tokenHash
      ) {
        const nextAttempts =
          (
            record.attempts ||
            0
          ) + 1;

        const updateData = {
          attempts:
            nextAttempts,
        };

        if (
          nextAttempts >=
          EMAIL_OTP_MAX_ATTEMPTS
        ) {
          updateData.lockedUntil =
            new Date(
              Date.now() +
                EMAIL_OTP_LOCK_MIN *
                  60 *
                  1000
            );
        }

        await prisma.emailVerificationToken.update({
          where: {
            id:
              record.id,
          },

          data:
            updateData,
        });

        return res.status(400).json({
          message:
            "Cod invalid sau expirat.",
        });
      }

      const userUpdateData = {
        emailVerifiedAt:
          new Date(),
      };

      if (
        record.intent ===
        "VENDOR"
      ) {
        userUpdateData.role =
          "VENDOR";
      }

      await prisma.$transaction([
        prisma.emailVerificationToken.update({
          where: {
            id:
              record.id,
          },

          data: {
            usedAt:
              new Date(),
          },
        }),

        prisma.user.update({
          where: {
            id:
              user.id,
          },

          data:
            userUpdateData,
        }),
      ]);

      const updatedUser =
        await prisma.user.findUnique({
          where: {
            id:
              user.id,
          },
        });

      if (updatedUser) {
        const jwt =
          signToken({
            sub:
              updatedUser.id,

            role:
              updatedUser.role,

            tv:
              updatedUser.tokenVersion,
          });

        res.cookie(
          "token",
          jwt,
          cookieOpts(
            req,
            7 *
              24 *
              60 *
              60 *
              1000
          )
        );
      }

      let next =
        "/desktop-user";

      if (
        updatedUser?.role ===
        "ADMIN"
      ) {
        next =
          "/admin";
      } else if (
        record.intent ===
        "VENDOR"
      ) {
        next =
          "/onboarding";
      } else if (
        updatedUser?.role ===
        "VENDOR"
      ) {
        next =
          "/desktop";
      }

      return res.json({
        ok: true,
        next,
      });
    } catch (error) {
      console.error(
        "VERIFY error:",
        error
      );

      return res.status(500).json({
        message:
          "verify_failed",
      });
    }
  }
);

/* =========================================================
 * POST /api/auth/resend-verification
 * ========================================================= */

router.post(
  "/resend-verification",
  async (req, res) => {
    try {
      const email =
        normalizeEmail(
          req.body?.email ||
            ""
        );

      /*
       * Nu dezvăluim dacă emailul există.
       */
      if (!email) {
        return res.json({
          ok: true,
        });
      }

      const user =
        await prisma.user.findUnique({
          where: {
            email,
          },

          select: {
            id: true,

            emailVerifiedAt:
              true,
          },
        });

      if (
        !user ||
        user.emailVerifiedAt
      ) {
        return res.json({
          ok: true,
        });
      }

      const lastToken =
        await prisma.emailVerificationToken.findFirst({
          where: {
            userId:
              user.id,

            purpose:
              "verify_email",
          },

          orderBy: {
            createdAt:
              "desc",
          },

          select: {
            intent:
              true,
          },
        });

      const intent =
        lastToken?.intent ||
        "USER";

      await prisma.emailVerificationToken.deleteMany({
        where: {
          userId:
            user.id,

          purpose:
            "verify_email",

          usedAt:
            null,
        },
      });

      const otp =
        randomOtp6();

      const tokenHash =
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

      await prisma.emailVerificationToken.create({
        data: {
          userId:
            user.id,

          tokenHash,

          expiresAt,

          intent,

          purpose:
            "verify_email",
        },
      });

      await sendVerificationEmail({
        to:
          email,

        code:
          otp,

        ttlMin:
          EMAIL_OTP_TTL_MIN,

        userId:
          user.id,
      });

      if (
        process.env.NODE_ENV !==
        "production"
      ) {
        console.log(
          "[DEV resend verify code]",
          otp,
          "for",
          email
        );
      }

      return res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        "RESEND error:",
        error
      );

      return res.status(500).json({
        ok: false,
      });
    }
  }
);

/* =========================================================
 * Rute Google
 *
 * POST   /api/auth/google
 * GET    /api/auth/methods
 * POST   /api/auth/google/connect
 * DELETE /api/auth/google/disconnect
 * ========================================================= */

router.use(
  googleAuthRoutes
);

/* =========================================================
 * POST /api/auth/login
 * ========================================================= */

router.post(
  "/login",
  async (req, res) => {
    try {
      const parsed =
        LoginSchema.safeParse(
          req.body || {}
        );

      if (!parsed.success) {
        return res.status(400).json({
          error:
            "invalid_payload",

          message:
            "Te rugăm să completezi e-mailul și parola.",
        });
      }

      const {
        email,
        password,
        remember,
      } = parsed.data;

      let user =
        await prisma.user.findUnique({
          where: {
            email,
          },
        });

      if (!user) {
        await logLoginAttempt(
          req,
          {
            userId:
              null,

            email,

            success:
              false,
          }
        );

        return res.status(404).json({
          error:
            "user_not_found",

          message:
            "Nu există niciun cont cu acest e-mail.",
        });
      }

      if (user.locked) {
        await logLoginAttempt(
          req,
          {
            userId:
              user.id,

            email,

            success:
              false,
          }
        );

        return res.status(403).json({
          error:
            "account_locked",

          message:
            "Contul este blocat.",
        });
      }

      if (
        !user.emailVerifiedAt
      ) {
        await logLoginAttempt(
          req,
          {
            userId:
              user.id,

            email,

            success:
              false,
          }
        );

        return res.status(403).json({
          error:
            "email_not_verified",

          message:
            "Te rugăm să îți confirmi adresa de email înainte de a te conecta.",
        });
      }

      /*
       * Rate limiting per email.
       */
      try {
        const windowStart =
          new Date(
            Date.now() -
              LOGIN_WINDOW_MINUTES *
                60 *
                1000
          );

        const recentFailures =
          await prisma.loginAttempt.count({
            where: {
              email,

              success:
                false,

              createdAt: {
                gte:
                  windowStart,
              },
            },
          });

        if (
          recentFailures >=
          LOGIN_MAX_ATTEMPTS_PER_WINDOW
        ) {
          await logLoginAttempt(
            req,
            {
              userId:
                user.id,

              email,

              success:
                false,
            }
          );

          return res.status(429).json({
            error:
              "too_many_attempts",

            message:
              "Prea multe încercări de conectare. Te rugăm să încerci mai târziu.",
          });
        }
      } catch (error) {
        console.error(
          "LOGIN rate-limit check failed:",
          error
        );
      }

      /*
       * Conturile create exclusiv cu Google
       * nu au passwordHash.
       */
      if (!user.passwordHash) {
        await logLoginAttempt(
          req,
          {
            userId:
              user.id,

            email,

            success:
              false,
          }
        );

        return res.status(400).json({
          error:
            "password_login_unavailable",

          message:
            "Acest cont folosește autentificarea cu Google. Continuă cu Google sau setează o parolă.",
        });
      }

      const passwordMatches =
        await bcrypt.compare(
          password,
          user.passwordHash
        );

      if (!passwordMatches) {
        const historyLimit =
          Number(
            process.env
              .PASSWORD_HISTORY_LIMIT ||
              5
          );

        if (
          historyLimit > 0
        ) {
          const history =
            await prisma.passwordHistory.findMany({
              where: {
                userId:
                  user.id,
              },

              orderBy: {
                createdAt:
                  "desc",
              },

              take:
                historyLimit,

              select: {
                passwordHash:
                  true,
              },
            });

          for (
            const item
            of history
          ) {
            const matchesOldPassword =
              await bcrypt.compare(
                password,
                item.passwordHash
              );

            if (
              matchesOldPassword
            ) {
              await logLoginAttempt(
                req,
                {
                  userId:
                    user.id,

                  email,

                  success:
                    false,
                }
              );

              return res.status(401).json({
                error:
                  "old_password_used",

                message:
                  "Această parolă a fost folosită anterior și a fost înlocuită. Folosește parola nouă sau resetează-ți parola.",
              });
            }
          }
        }

        await logLoginAttempt(
          req,
          {
            userId:
              user.id,

            email,

            success:
              false,
          }
        );

        return res.status(401).json({
          error:
            "wrong_password",

          message:
            "Parola este incorectă. Încearcă din nou sau resetează-ți parola.",
        });
      }

      await logLoginAttempt(
        req,
        {
          userId:
            user.id,

          email,

          success:
            true,
        }
      );

      user =
        await prisma.user.update({
          where: {
            id:
              user.id,
          },

          data: {
            lastLoginAt:
              new Date(),
          },
        });

      const jwt =
        signToken({
          sub:
            user.id,

          role:
            user.role,

          tv:
            user.tokenVersion,
        });

      const maxAge =
        remember
          ? 30 *
            24 *
            60 *
            60 *
            1000
          : undefined;

      res.cookie(
        "token",
        jwt,
        cookieOpts(
          req,
          maxAge
        )
      );

      const displayName =
        user.name ||
        [
          user.firstName,
          user.lastName,
        ]
          .filter(Boolean)
          .join(" ") ||
        "";

      let next =
        "/desktop-user";

      if (
        user.role ===
        "ADMIN"
      ) {
        next =
          "/admin";
      } else if (
        user.role ===
        "VENDOR"
      ) {
        next =
          "/desktop";
      }

      return res.json({
        ok: true,
        next,

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
      });
    } catch (error) {
      console.error(
        "LOGIN error:",
        error
      );

      return res.status(500).json({
        error:
          "login_failed",
      });
    }
  }
);

/* =========================================================
 * GET /api/auth/me
 * ========================================================= */

router.get(
  "/me",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const me =
        await prisma.user.findUnique({
          where: {
            id:
              req.user.sub,
          },

          select: {
            id: true,
            email: true,

            firstName:
              true,

            lastName:
              true,

            name:
              true,

            avatarUrl:
              true,

            role:
              true,

            vendor: {
              select: {
                id:
                  true,

                displayName:
                  true,
              },
            },
          },
        });

      if (!me) {
        res.clearCookie(
          "token",
          cookieOpts(req)
        );

        return res.status(401).json({
          error:
            "user_not_found",
        });
      }

      const displayName =
        me.name ||
        [
          me.firstName,
          me.lastName,
        ]
          .filter(Boolean)
          .join(" ") ||
        "";

      return res.json({
        user: {
          ...me,
          name:
            displayName,
        },
      });
    } catch (error) {
      console.error(
        "ME route error:",
        error
      );

      return res.status(500).json({
        error:
          "me_failed",
      });
    }
  }
);

/* =========================================================
 * GET /api/auth/exists
 * ========================================================= */

router.get(
  "/exists",
  async (req, res) => {
    try {
      const email =
        normalizeEmail(
          req.query.email ||
            ""
        );

      if (!email) {
        return res.json({
          exists:
            false,
        });
      }

      const user =
        await prisma.user.findUnique({
          where: {
            email,
          },

          select: {
            id:
              true,
          },
        });

      return res.json({
        exists:
          !!user,
      });
    } catch {
      return res.json({
        exists:
          false,
      });
    }
  }
);

/* =========================================================
 * POST /api/auth/logout
 * ========================================================= */

router.post(
  "/logout",
  (req, res) => {
    res.clearCookie(
      "token",
      cookieOpts(req)
    );

    return res.json({
      ok: true,
    });
  }
);

/* =========================================================
 * Parolă uitată / resetare
 * ========================================================= */

router.post(
  "/forgot-password",
  forgotPassword
);

router.post(
  "/reset-password",
  resetPassword
);

export default router;