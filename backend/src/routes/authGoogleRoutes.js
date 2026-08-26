// src/routes/googleAuthRoutes.js

import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";

import { prisma } from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
  signToken,
} from "../api/auth.js";

import {
  ensureBasicSubscriptionForVendor,
} from "./subscriptionRoutes.js";

const router = Router();

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID || "";

const googleClient =
  new OAuth2Client(
    GOOGLE_CLIENT_ID
  );

/* =========================================================
 * Helpers
 * ========================================================= */

function normalizeEmail(
  value = ""
) {
  return String(value)
    .trim()
    .toLowerCase();
}

function getReqIp(req) {
  const forwarded =
    String(
      req.headers[
        "x-forwarded-for"
      ] || ""
    );

  return (
    forwarded
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
      "Failed to log Google login attempt:",
      error
    );
  }
}

/* =========================================================
 * Schemas
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

const GoogleAuthSchema =
  z.object({
    credential: z
      .string()
      .trim()
      .min(1),

    /*
     * login:
     * - autentifică numai un cont existent;
     * - nu creează automat cont nou.
     *
     * register:
     * - permite crearea unui cont nou;
     * - cere consimțămintele obligatorii.
     */
    mode: z
      .enum([
        "login",
        "register",
      ])
      .default("login"),

    remember: z
      .boolean()
      .optional()
      .default(true),

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

    ref: z
      .string()
      .trim()
      .optional()
      .nullable(),
  });

const GoogleCredentialSchema =
  z.object({
    credential: z
      .string()
      .trim()
      .min(1),
  });

/* =========================================================
 * Google credential verification
 * ========================================================= */

async function verifyGoogleCredential(
  credential
) {
  const ticket =
    await googleClient.verifyIdToken({
      idToken: credential,
      audience:
        GOOGLE_CLIENT_ID,
    });

  const payload =
    ticket.getPayload();

  const googleId =
    payload?.sub
      ?.toString()
      .trim() || "";

  const email =
    normalizeEmail(
      payload?.email || ""
    );

  const emailVerified =
    payload?.email_verified ===
    true;

  const firstName =
    payload?.given_name
      ?.toString()
      .trim() || null;

  const lastName =
    payload?.family_name
      ?.toString()
      .trim() || null;

  const displayName =
    payload?.name
      ?.toString()
      .trim() ||
    [firstName, lastName]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    null;

  const avatarUrl =
    payload?.picture
      ?.toString()
      .trim() || null;

  if (
    !googleId ||
    !email ||
    !emailVerified
  ) {
    const error =
      new Error(
        "google_account_unverified"
      );

    error.code =
      "google_account_unverified";

    throw error;
  }

  return {
    googleId,
    email,
    emailVerified,
    firstName,
    lastName,
    displayName,
    avatarUrl,
  };
}

/* =========================================================
 * POST /api/auth/google
 *
 * mode: "login"
 * - autentifică numai un cont existent;
 * - nu creează automat cont.
 *
 * mode: "register"
 * - poate crea un cont nou;
 * - validează consimțămintele obligatorii.
 * ========================================================= */

router.post(
  "/google",
  async (req, res) => {
    try {
      if (!GOOGLE_CLIENT_ID) {
        return res.status(503).json({
          error:
            "google_auth_not_configured",

          message:
            "Autentificarea cu Google nu este configurată momentan.",
        });
      }

      const parsed =
        GoogleAuthSchema.safeParse(
          req.body || {}
        );

      if (!parsed.success) {
        return res.status(400).json({
          error:
            "invalid_google_payload",

          message:
            "Datele primite pentru autentificarea Google sunt invalide.",

          details:
            parsed.error.flatten(),
        });
      }

      const {
        credential,
        mode,
        remember,
        asVendor,
        entitySelfDeclared,
        entityMeta,
        consents = [],
        ref,
      } = parsed.data;

      /*
       * Intenția de vendor este acceptată numai
       * din formularul de înregistrare.
       */
      const wantsVendor =
        mode === "register" &&
        asVendor;

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

      /*
       * Înregistrarea necesită consimțămintele generale.
       * Loginul nu le solicită din nou.
       */
      if (
        mode === "register" &&
        (
          !hasTosConsent ||
          !hasPrivacyConsent
        )
      ) {
        return res.status(400).json({
          error:
            "mandatory_consents_required",

          message:
            "Termenii și Condițiile și Politica de confidențialitate trebuie acceptate.",
        });
      }

      if (
        wantsVendor &&
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
        wantsVendor &&
        !hasVendorTermsConsent
      ) {
        return res.status(400).json({
          error:
            "vendor_terms_required",

          message:
            "Acordul Master pentru Vânzători este obligatoriu.",
        });
      }

      let google;

      try {
        google =
          await verifyGoogleCredential(
            credential
          );
      } catch (verifyError) {
        console.error(
          "Google token verification failed:",
          verifyError?.message ||
            verifyError
        );

        return res.status(401).json({
          error:
            "invalid_google_token",

          message:
            "Autentificarea Google nu a putut fi verificată. Încearcă din nou.",
        });
      }

      const {
        googleId,
        email,
        firstName,
        lastName,
        displayName:
          googleName,
        avatarUrl,
      } = google;

      const reqIp =
        getReqIp(req);

      const reqUa =
        getReqUa(req);

      const now =
        new Date();

      /*
       * 1. Căutăm contul Google în AuthAccount.
       */
      const linkedAuthAccount =
        await prisma.authAccount.findUnique({
          where: {
            provider_providerAccountId:
              {
                provider:
                  "GOOGLE",

                providerAccountId:
                  googleId,
              },
          },

          include: {
            user: {
              include: {
                vendor: {
                  select: {
                    id: true,
                  },
                },

                authAccounts: {
                  where: {
                    provider:
                      "GOOGLE",
                  },
                },
              },
            },
          },
        });

      let existingUser =
        linkedAuthAccount?.user ||
        null;

      /*
       * 2. Compatibilitate cu vechiul User.googleId.
       */
      if (!existingUser) {
        existingUser =
          await prisma.user.findUnique({
            where: {
              googleId,
            },

            include: {
              vendor: {
                select: {
                  id: true,
                },
              },

              authAccounts: {
                where: {
                  provider:
                    "GOOGLE",
                },
              },
            },
          });
      }

      /*
       * 3. Asociere automată numai când emailul
       * Google verificat este identic cu emailul Artfest.
       */
      if (!existingUser) {
        existingUser =
          await prisma.user.findUnique({
            where: {
              email,
            },

            include: {
              vendor: {
                select: {
                  id: true,
                },
              },

              authAccounts: {
                where: {
                  provider:
                    "GOOGLE",
                },
              },
            },
          });
      }

      const isNewUser =
        !existingUser;
/*
 * În fluxul de înregistrare nu asociem automat
 * Google peste un cont Artfest deja existent.
 *
 * Utilizatorul trebuie să intre din fila Login,
 * unde contul Google va fi asociat în siguranță
 * cu utilizatorul existent.
 */
if (
  mode === "register" &&
  existingUser
) {
  return res.status(409).json({
    error:
      "google_email_already_registered",

    message:
      "Există deja un cont Artfest cu această adresă de email. Accesează fila Autentificare și continuă cu Google pentru a intra în contul existent.",
  });
}
      /*
       * Din pagina de login nu permitem crearea
       * automată a unui cont nou.
       */
      if (
        mode === "login" &&
        isNewUser
      ) {
        await logLoginAttempt(
          req,
          {
            userId: null,
            email,
            success: false,
          }
        );

        return res.status(404).json({
          error:
            "google_account_not_registered",

          message:
            "Nu există încă un cont Artfest asociat acestui cont Google. Accesează fila Înregistrare pentru a crea contul.",
        });
      }

      if (
        existingUser?.locked
      ) {
        await logLoginAttempt(
          req,
          {
            userId:
              existingUser.id,

            email,
            success: false,
          }
        );

        return res.status(403).json({
          error:
            "account_locked",

          message:
            "Contul este blocat. Te rugăm să contactezi echipa de suport.",
        });
      }

      const existingGoogleAccount =
        existingUser
          ?.authAccounts?.[0] ||
        null;

      /*
       * Dacă acel cont Artfest este deja conectat
       * cu un alt cont Google, nu îl înlocuim automat.
       */
      if (
        existingGoogleAccount &&
        existingGoogleAccount
          .providerAccountId !==
          googleId
      ) {
        return res.status(409).json({
          error:
            "google_account_conflict",

          message:
            "Acest cont Artfest este deja conectat la un alt cont Google.",
        });
      }

      /*
       * Compatibilitate cu vechiul câmp googleId.
       */
      if (
        existingUser?.googleId &&
        existingUser.googleId !==
          googleId
      ) {
        return res.status(409).json({
          error:
            "google_account_conflict",

          message:
            "Acest cont Artfest este deja asociat unui alt cont Google.",
        });
      }

      const result =
        await prisma.$transaction(
          async (tx) => {
            let user;

            if (existingUser) {
              user =
                await tx.user.update({
                  where: {
                    id:
                      existingUser.id,
                  },

                  data: {
                    /*
                     * Compatibilitate temporară.
                     */
                    googleId,

                    /*
                     * Confirmăm emailul Artfest numai dacă
                     * este identic cu emailul Google.
                     */
                    emailVerifiedAt:
                      existingUser.emailVerifiedAt ||
                      (
                        normalizeEmail(
                          existingUser.email
                        ) === email
                          ? now
                          : null
                      ),

                    firstName:
                      existingUser.firstName ||
                      firstName,

                    lastName:
                      existingUser.lastName ||
                      lastName,

                    name:
                      existingUser.name ||
                      googleName,

                    avatarUrl:
                      existingUser.avatarUrl ||
                      avatarUrl,

                    /*
                     * Marketingul poate fi activat numai
                     * din fluxul de înregistrare.
                     */
                    marketingOptIn:
                      existingUser.marketingOptIn ||
                      (
                        mode ===
                          "register" &&
                        hasMarketingOptIn
                      ),

                    role:
                      wantsVendor
                        ? "VENDOR"
                        : existingUser.role,

                    lastLoginAt:
                      now,
                  },
                });
            } else {
              user =
                await tx.user.create({
                  data: {
                    email,
                    googleId,

                    passwordHash:
                      null,

                    firstName,
                    lastName,

                    name:
                      googleName,

                    avatarUrl,

                    role:
                      wantsVendor
                        ? "VENDOR"
                        : "USER",

                    emailVerifiedAt:
                      now,

                    lastLoginAt:
                      now,

                    marketingOptIn:
                      hasMarketingOptIn,
                  },
                });
            }

            /*
             * Creăm sau actualizăm metoda Google.
             */
            await tx.authAccount.upsert({
              where: {
                provider_providerAccountId:
                  {
                    provider:
                      "GOOGLE",

                    providerAccountId:
                      googleId,
                  },
              },

              update: {
                providerEmail:
                  email,

                emailVerified:
                  true,

                displayName:
                  googleName,

                avatarUrl,

                lastUsedAt:
                  now,
              },

              create: {
                userId:
                  user.id,

                provider:
                  "GOOGLE",

                providerAccountId:
                  googleId,

                providerEmail:
                  email,

                emailVerified:
                  true,

                displayName:
                  googleName,

                avatarUrl,

                lastUsedAt:
                  now,
              },
            });

            /*
             * Consimțămintele se salvează numai
             * din fluxul de înregistrare.
             */
            if (
              mode === "register"
            ) {
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

                const version =
                  consent.version ||
                  "1.0.0";

                await tx.userConsent.upsert({
                  where: {
                    userId_document_version:
                      {
                        userId:
                          user.id,

                        document,
                        version,
                      },
                  },

                  update: {
                    checksum:
                      consent.checksum ||
                      null,

                    ip:
                      reqIp,

                    ua:
                      reqUa,
                  },

                  create: {
                    userId:
                      user.id,

                    document,
                    version,

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
            }

            /*
             * Abonarea la newsletter este procesată
             * numai la înregistrare.
             */
            if (
              mode === "register" &&
              hasMarketingOptIn
            ) {
              await tx.newsletterSubscriber.upsert({
                where: {
                  email:
                    user.email,
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
                    "Google register opt-in",

                  notes:
                    "Subscribed automatically from Google registration.",
                },

                create: {
                  email:
                    user.email,

                  status:
                    "SUBSCRIBED",

                  userId:
                    user.id,

                  source:
                    "OTHER",

                  sourceLabel:
                    "Google register opt-in",

                  notes:
                    "Subscribed automatically from Google registration.",
                },
              });
            }

            let vendorId =
              existingUser
                ?.vendor?.id ||
              null;

            if (wantsVendor) {
              let vendor =
                await tx.vendor.findUnique({
                  where: {
                    userId:
                      user.id,
                  },
                });

              if (!vendor) {
                vendor =
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
                        now,

                      entitySelfDeclaredIp:
                        reqIp,

                      entitySelfDeclaredUa:
                        reqUa,

                      entitySelfDeclaredMeta:
                        entityMeta ??
                        null,
                    },
                  });
              } else {
                vendor =
                  await tx.vendor.update({
                    where: {
                      id:
                        vendor.id,
                    },

                    data: {
                      entitySelfDeclared:
                        true,

                      entitySelfDeclaredAt:
                        vendor
                          .entitySelfDeclaredAt ||
                        now,

                      entitySelfDeclaredIp:
                        vendor
                          .entitySelfDeclaredIp ||
                        reqIp,

                      entitySelfDeclaredUa:
                        vendor
                          .entitySelfDeclaredUa ||
                        reqUa,

                      entitySelfDeclaredMeta:
                        vendor
                          .entitySelfDeclaredMeta ||
                        entityMeta ||
                        undefined,
                    },
                  });
              }

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
                const version =
                  vendorTermsConsent
                    .version ||
                  "1.0.0";

                await tx.vendorAcceptance.upsert({
                  where: {
                    vendorId_document_version:
                      {
                        vendorId:
                          vendor.id,

                        document:
                          "VENDOR_TERMS",

                        version,
                      },
                  },

                  update: {
                    checksum:
                      vendorTermsConsent
                        .checksum ||
                      null,

                    acceptedAt:
                      now,

                    ip:
                      reqIp,

                    ua:
                      reqUa,

                    source:
                      "google_register",
                  },

                  create: {
                    vendorId:
                      vendor.id,

                    userId:
                      user.id,

                    document:
                      "VENDOR_TERMS",

                    version,

                    checksum:
                      vendorTermsConsent
                        .checksum ||
                      null,

                    acceptedAt:
                      now,

                    ip:
                      reqIp,

                    ua:
                      reqUa,

                    source:
                      "google_register",
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
                          now,
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
              user,
              vendorId,
            };
          }
        );

      if (
        result.vendorId
      ) {
        try {
          await ensureBasicSubscriptionForVendor(
            result.vendorId
          );
        } catch (
          subscriptionError
        ) {
          console.error(
            "Google automatic Basic subscription failed:",
            subscriptionError
          );
        }
      }

      await logLoginAttempt(
        req,
        {
          userId:
            result.user.id,

          email:
            result.user.email,

          success:
            true,
        }
      );

      const jwt =
        signToken({
          sub:
            result.user.id,

          role:
            result.user.role,

          tv:
            result.user
              .tokenVersion,
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
        result.user.name ||
        [
          result.user.firstName,
          result.user.lastName,
        ]
          .filter(Boolean)
          .join(" ") ||
        "";

    let next = "/desktop-user";

if (result.user.role === "ADMIN") {
  next = "/admin";
} else if (result.user.role === "VENDOR") {
  const alreadyHadVendor =
    !!existingUser?.vendor?.id;

  next =
    isNewUser || !alreadyHadVendor
      ? "/onboarding"
      : "/desktop";
} else if (
  result.user.role === "INFLUENCER"
) {
  next = "/influencer";
}

      return res.json({
        ok: true,
        next,
        isNewUser,

        asVendorIntent:
          wantsVendor,

        user: {
          id:
            result.user.id,

          email:
            result.user.email,

          name:
            displayName,

          firstName:
            result.user.firstName,

          lastName:
            result.user.lastName,

          avatarUrl:
            result.user.avatarUrl,

          role:
            result.user.role,
        },
      });
    } catch (error) {
      if (
        error?.code ===
        "P2002"
      ) {
        return res.status(409).json({
          error:
            "google_account_conflict",

          message:
            "Contul Google este deja asociat unui alt utilizator.",
        });
      }

      console.error(
        "Google auth error:",
        error
      );

      return res.status(500).json({
        error:
          "google_auth_failed",

        message:
          "Autentificarea cu Google a eșuat. Încearcă din nou.",
      });
    }
  }
);

/* =========================================================
 * GET /api/auth/methods
 * ========================================================= */

router.get(
  "/methods",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const user =
        await prisma.user.findUnique({
          where: {
            id:
              req.user.sub,
          },

          select: {
            passwordHash:
              true,

            authAccounts: {
              where: {
                provider:
                  "GOOGLE",
              },

              select: {
                providerEmail:
                  true,

                connectedAt:
                  true,

                lastUsedAt:
                  true,
              },
            },
          },
        });

      if (!user) {
        return res.status(404).json({
          error:
            "user_not_found",
        });
      }

      const googleAccount =
        user.authAccounts?.[0] ||
        null;

      return res.json({
        passwordEnabled:
          !!user.passwordHash,

        googleConnected:
          !!googleAccount,

        googleEmail:
          googleAccount
            ?.providerEmail ||
          null,

        googleConnectedAt:
          googleAccount
            ?.connectedAt ||
          null,

        googleLastUsedAt:
          googleAccount
            ?.lastUsedAt ||
          null,
      });
    } catch (error) {
      console.error(
        "Auth methods error:",
        error
      );

      return res.status(500).json({
        error:
          "auth_methods_failed",
      });
    }
  }
);

/* =========================================================
 * POST /api/auth/google/connect
 * ========================================================= */

router.post(
  "/google/connect",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      if (!GOOGLE_CLIENT_ID) {
        return res.status(503).json({
          error:
            "google_auth_not_configured",

          message:
            "Autentificarea cu Google nu este configurată momentan.",
        });
      }

      const parsed =
        GoogleCredentialSchema.safeParse(
          req.body || {}
        );

      if (!parsed.success) {
        return res.status(400).json({
          error:
            "invalid_google_payload",

          message:
            "Datele Google lipsesc sau sunt invalide.",
        });
      }

      let google;

      try {
        google =
          await verifyGoogleCredential(
            parsed.data.credential
          );
      } catch {
        return res.status(401).json({
          error:
            "invalid_google_token",

          message:
            "Contul Google nu a putut fi verificat.",
        });
      }

      const now =
        new Date();

      /*
       * Verificăm AuthAccount.
       */
      const accountByGoogleId =
        await prisma.authAccount.findUnique({
          where: {
            provider_providerAccountId:
              {
                provider:
                  "GOOGLE",

                providerAccountId:
                  google.googleId,
              },
          },

          select: {
            userId:
              true,
          },
        });

      if (
        accountByGoogleId &&
        accountByGoogleId.userId !==
          req.user.sub
      ) {
        return res.status(409).json({
          error:
            "google_already_connected",

          message:
            "Acest cont Google este deja conectat unui alt cont Artfest.",
        });
      }

      /*
       * Compatibilitate cu User.googleId.
       */
      const legacyUserByGoogleId =
        await prisma.user.findUnique({
          where: {
            googleId:
              google.googleId,
          },

          select: {
            id: true,
          },
        });

      if (
        legacyUserByGoogleId &&
        legacyUserByGoogleId.id !==
          req.user.sub
      ) {
        return res.status(409).json({
          error:
            "google_already_connected",

          message:
            "Acest cont Google este deja conectat unui alt cont Artfest.",
        });
      }

      /*
       * Un cont Artfest poate avea maximum
       * un cont Google conectat.
       */
      const currentGoogleAccount =
        await prisma.authAccount.findUnique({
          where: {
            userId_provider: {
              userId:
                req.user.sub,

              provider:
                "GOOGLE",
            },
          },
        });

      if (
        currentGoogleAccount &&
        currentGoogleAccount
          .providerAccountId !==
          google.googleId
      ) {
        return res.status(409).json({
          error:
            "different_google_already_connected",

          message:
            "Contul Artfest este deja conectat la un alt cont Google. Deconectează-l mai întâi.",
        });
      }

      const user =
        await prisma.user.findUnique({
          where: {
            id:
              req.user.sub,
          },

          select: {
            id:
              true,
          },
        });

      if (!user) {
        return res.status(404).json({
          error:
            "user_not_found",
        });
      }

      await prisma.$transaction(
        async (tx) => {
          await tx.authAccount.upsert({
            where: {
              provider_providerAccountId:
                {
                  provider:
                    "GOOGLE",

                  providerAccountId:
                    google.googleId,
                },
            },

            update: {
              providerEmail:
                google.email,

              emailVerified:
                true,

              displayName:
                google.displayName,

              avatarUrl:
                google.avatarUrl,

              lastUsedAt:
                now,
            },

            create: {
              userId:
                req.user.sub,

              provider:
                "GOOGLE",

              providerAccountId:
                google.googleId,

              providerEmail:
                google.email,

              emailVerified:
                true,

              displayName:
                google.displayName,

              avatarUrl:
                google.avatarUrl,

              lastUsedAt:
                now,
            },
          });

          /*
           * Păstrăm vechiul googleId sincronizat.
           *
           * Nu modificăm emailVerifiedAt:
           * emailul Google poate fi diferit de
           * emailul contului Artfest.
           */
          await tx.user.update({
            where: {
              id:
                req.user.sub,
            },

            data: {
              googleId:
                google.googleId,
            },
          });
        }
      );

      return res.json({
        ok: true,

        googleConnected:
          true,

        googleEmail:
          google.email,
      });
    } catch (error) {
      if (
        error?.code ===
        "P2002"
      ) {
        return res.status(409).json({
          error:
            "google_account_conflict",

          message:
            "Contul Google este deja conectat unui alt utilizator.",
        });
      }

      console.error(
        "Google connect error:",
        error
      );

      return res.status(500).json({
        error:
          "google_connect_failed",

        message:
          "Contul Google nu a putut fi conectat.",
      });
    }
  }
);

/* =========================================================
 * DELETE /api/auth/google/disconnect
 * ========================================================= */

router.delete(
  "/google/disconnect",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const user =
        await prisma.user.findUnique({
          where: {
            id:
              req.user.sub,
          },

          select: {
            id:
              true,

            passwordHash:
              true,

            authAccounts: {
              where: {
                provider:
                  "GOOGLE",
              },

              select: {
                id:
                  true,
              },
            },
          },
        });

      if (!user) {
        return res.status(404).json({
          error:
            "user_not_found",
        });
      }

      const googleAccount =
        user.authAccounts?.[0] ||
        null;

      if (!googleAccount) {
        return res.json({
          ok: true,

          googleConnected:
            false,
        });
      }

      /*
       * Nu permitem eliminarea ultimei metode
       * de autentificare.
       */
      if (!user.passwordHash) {
        return res.status(400).json({
          error:
            "last_login_method",

          message:
            "Setează mai întâi o parolă Artfest înainte să deconectezi contul Google.",
        });
      }

      await prisma.$transaction([
        prisma.authAccount.delete({
          where: {
            id:
              googleAccount.id,
          },
        }),

        prisma.user.update({
          where: {
            id:
              user.id,
          },

          data: {
            googleId:
              null,
          },
        }),
      ]);

      return res.json({
        ok: true,

        googleConnected:
          false,
      });
    } catch (error) {
      console.error(
        "Google disconnect error:",
        error
      );

      return res.status(500).json({
        error:
          "google_disconnect_failed",

        message:
          "Contul Google nu a putut fi deconectat.",
      });
    }
  }
);

export default router;