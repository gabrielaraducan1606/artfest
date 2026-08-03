// backend/src/routes/adminPolicyNotificationsRoutes.js

import { Router } from "express";

import { prisma } from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
} from "../api/auth.js";

import {
  acceptPolicyDocuments,
  archivePolicyNotification,
  buildPolicyGateDocuments,
  getMissingRequiredDocuments,
  getPolicyMappings,
  publishSelectedGateDocuments,
} from "../services/policyService.js";

const router = Router();

/* =========================================================
 * Documente permise în formularul de administrare
 * ========================================================= */

const ALLOWED_DOCS_BY_SCOPE = {
  USERS: [
    "TOS",
    "PRIVACY",
    "COOKIES",
    "RETURNS_POLICY_ACK",
    "MARKETING",
  ],

  VENDORS: [
    "VENDOR_TERMS",
    "VENDOR_PRIVACY_NOTICE",
    "SHIPPING_ADDENDUM",
    "PRODUCTS_ADDENDUM",
    "PRODUCT_DECLARATION",
    "RETURNS_POLICY_ACK",
  ],
};

/*
 * Documentele care pot fi publicate direct din manifest.
 */
const MANIFEST_DOCUMENTS_BY_SCOPE = {
  USERS: [
    "TOS",
    "PRIVACY",
    "COOKIES",
    "RETURNS_POLICY_ACK",
  ],

  VENDORS: [
    "VENDOR_TERMS",
    "SHIPPING_ADDENDUM",
    "PRODUCTS_ADDENDUM",
    "RETURNS_POLICY_ACK",
  ],
};

/* =========================================================
 * Helpers
 * ========================================================= */

function normalizeScope(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeDocumentKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeDocuments(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((item) => {
          if (typeof item === "string") {
            return normalizeDocumentKey(item);
          }

          if (typeof item?.key === "string") {
            return normalizeDocumentKey(item.key);
          }

          if (typeof item?.document === "string") {
            return normalizeDocumentKey(item.document);
          }

          return "";
        })
        .filter(Boolean)
    )
  );
}

function getAuthUserId(req) {
  return (
    req.user?.userId ||
    req.user?.id ||
    req.user?.sub ||
    req.user?.uid ||
    null
  );
}

function getRequestIp(req) {
  const forwarded =
    req.headers["x-forwarded-for"];

  if (
    typeof forwarded === "string" &&
    forwarded.trim()
  ) {
    return forwarded
      .split(",")[0]
      .trim();
  }

  return (
    req.ip ||
    req.socket?.remoteAddress ||
    null
  );
}

function getRequestUa(req) {
  return (
    req.headers["user-agent"] ||
    null
  );
}

function createRouteError(
  status,
  code,
  extra = {}
) {
  const error = new Error(code);

  error.status = status;
  error.code = code;

  Object.assign(error, extra);

  return error;
}

function sendRouteError(
  res,
  error,
  fallbackCode = "internal_error"
) {
  const status =
    Number(error?.status) || 500;

  const code =
    error?.code ||
    error?.message ||
    fallbackCode;

  const body = {
    error: code,
  };

  if (
    Array.isArray(
      error?.invalidDocuments
    )
  ) {
    body.invalidDocuments =
      error.invalidDocuments;
  }

  if (
    Array.isArray(
      error?.missingDocuments
    )
  ) {
    body.missingDocuments =
      error.missingDocuments;
  }

  if (
    Array.isArray(error?.unknownTypes)
  ) {
    body.unknownTypes =
      error.unknownTypes;
  }

  return res.status(status).json(body);
}

async function requireAdmin(req) {
  const authUserId =
    getAuthUserId(req);

  if (!authUserId) {
    throw createRouteError(
      401,
      "unauthorized"
    );
  }

  const currentUser =
    await prisma.user.findUnique({
      where: {
        id: authUserId,
      },

      select: {
        id: true,
        role: true,
        email: true,
      },
    });

  const role = String(
    currentUser?.role || ""
  ).toUpperCase();

  if (
    !currentUser ||
    !["ADMIN", "SUPER_ADMIN"].includes(
      role
    )
  ) {
    throw createRouteError(
      403,
      "forbidden"
    );
  }

  return currentUser;
}

async function getCurrentVendor(
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
    },
  });
}

async function getLatestPolicyGateNotification({
  scope,
  userId,
  vendorId,
}) {
  return prisma.notification.findFirst({
    where: {
      archived: false,

      ...(scope === "USERS"
        ? {
            userId,
          }
        : {
            vendorId,
          }),

      meta: {
        path: ["kind"],
        equals: "POLICY_UPDATE",
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });
}

/* =========================================================
 * Verificare politici pentru documentele care nu provin
 * momentan din manifest
 * ========================================================= */

async function validateNonManifestDocuments({
  scope,
  documents,
}) {
  const manifestDocuments =
    new Set(
      MANIFEST_DOCUMENTS_BY_SCOPE[
        scope
      ] || []
    );

  const specialDocuments =
    new Set([
      "PRODUCT_DECLARATION",
    ]);

  const nonManifestDocuments =
    documents.filter(
      (document) =>
        !manifestDocuments.has(
          document
        ) &&
        !specialDocuments.has(
          document
        )
    );

  if (!nonManifestDocuments.length) {
    return;
  }

  const mappings =
    getPolicyMappings();

  if (scope === "USERS") {
    const dbDocuments =
      nonManifestDocuments
        .map(
          (key) =>
            mappings
              .gateKeyToUserDocument[
              key
            ]
        )
        .filter(Boolean);

    const activePolicies =
      dbDocuments.length
        ? await prisma.userPolicy.findMany({
            where: {
              isActive: true,
              document: {
                in: dbDocuments,
              },
            },

            select: {
              document: true,
            },
          })
        : [];

    const found =
      new Set(
        activePolicies.map(
          (policy) =>
            policy.document
        )
      );

    const missing =
      nonManifestDocuments.filter(
        (key) => {
          const dbDocument =
            mappings
              .gateKeyToUserDocument[
              key
            ];

          return (
            !dbDocument ||
            !found.has(dbDocument)
          );
        }
      );

    if (missing.length) {
      throw createRouteError(
        400,
        "active_policy_missing",
        {
          missingDocuments:
            missing,
        }
      );
    }

    return;
  }

  const dbDocuments =
    nonManifestDocuments
      .map(
        (key) =>
          mappings
            .gateKeyToVendorDocument[
            key
          ]
      )
      .filter(Boolean);

  const activePolicies =
    dbDocuments.length
      ? await prisma.vendorPolicy.findMany({
          where: {
            isActive: true,
            document: {
              in: dbDocuments,
            },
          },

          select: {
            document: true,
          },
        })
      : [];

  const found =
    new Set(
      activePolicies.map(
        (policy) =>
          policy.document
      )
    );

  const missing =
    nonManifestDocuments.filter(
      (key) => {
        const dbDocument =
          mappings
            .gateKeyToVendorDocument[
            key
          ];

        return (
          !dbDocument ||
          !found.has(dbDocument)
        );
      }
    );

  if (missing.length) {
    throw createRouteError(
      400,
      "active_policy_missing",
      {
        missingDocuments: missing,
      }
    );
  }
}

/* =========================================================
 * GET /api/policy-gate?scope=USERS|VENDORS
 * ========================================================= */

router.get(
  "/policy-gate",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const scope =
        normalizeScope(
          req.query?.scope
        );

      const authUserId =
        getAuthUserId(req);

      if (
        !["USERS", "VENDORS"].includes(
          scope
        )
      ) {
        return res.status(400).json({
          error: "invalid_scope",
        });
      }

      if (!authUserId) {
        return res.status(401).json({
          error: "unauthorized",
        });
      }

      let vendor = null;

      if (scope === "VENDORS") {
        vendor =
          await getCurrentVendor(
            authUserId
          );

        if (!vendor) {
          return res.status(403).json({
            error: "vendor_required",
          });
        }
      }

      const notification =
        await getLatestPolicyGateNotification({
          scope,
          userId: authUserId,
          vendorId: vendor?.id,
        });

      if (!notification) {
        return res.json({
          notification: null,
          requiresAction: false,
          documents: [],
        });
      }

      const selectedDocuments =
        normalizeDocuments(
          notification?.meta
            ?.documents
        );

      const documents =
        await buildPolicyGateDocuments({
          scope,
          userId: authUserId,
          vendorId: vendor?.id,
          documentKeys:
            selectedDocuments,
        });

      return res.json({
        notification: {
          id: notification.id,
          title:
            notification.title,
          message:
            notification.body,
          createdAt:
            notification.createdAt,
        },

        requiresAction:
          notification?.meta
            ?.requiresAction === true,

        documents,
      });
    } catch (error) {
      console.error(
        "GET /api/policy-gate error:",
        error
      );

      return sendRouteError(
        res,
        error
      );
    }
  }
);

/* =========================================================
 * POST /api/policy-gate/accept
 * ========================================================= */

router.post(
  "/policy-gate/accept",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const scope =
        normalizeScope(
          req.body?.scope
        );

      const authUserId =
        getAuthUserId(req);

      const requestedDocuments =
        normalizeDocuments(
          req.body?.documents
        );

      const notificationId =
        req.body?.notificationId
          ? String(
              req.body
                .notificationId
            ).trim()
          : null;

      if (
        !["USERS", "VENDORS"].includes(
          scope
        )
      ) {
        return res.status(400).json({
          error: "invalid_scope",
        });
      }

      if (!authUserId) {
        return res.status(401).json({
          error: "unauthorized",
        });
      }

      if (
        !requestedDocuments.length
      ) {
        return res.status(400).json({
          error: "no_documents",
        });
      }

      let vendor = null;

      if (scope === "VENDORS") {
        vendor =
          await getCurrentVendor(
            authUserId
          );

        if (!vendor) {
          return res.status(403).json({
            error: "vendor_required",
          });
        }
      }

      const notification =
        await getLatestPolicyGateNotification({
          scope,
          userId: authUserId,
          vendorId: vendor?.id,
        });

      if (!notification) {
        return res.status(404).json({
          error:
            "notification_not_found",
        });
      }

      /*
       * Nu permitem acceptarea documentelor care
       * nu fac parte din notificarea găsită.
       */
      const allowedDocuments =
        normalizeDocuments(
          notification?.meta
            ?.documents
        );

      const invalidDocuments =
        requestedDocuments.filter(
          (document) =>
            !allowedDocuments.includes(
              document
            )
        );

      if (
        invalidDocuments.length
      ) {
        return res.status(400).json({
          error:
            "invalid_documents",
          invalidDocuments,
        });
      }

      const acceptanceResult =
        await acceptPolicyDocuments({
          scope,
          userId: authUserId,
          vendorId: vendor?.id,
          documentKeys:
            requestedDocuments,
          ip: getRequestIp(req),
          ua: getRequestUa(req),
          source: "policy_gate",
        });

      /*
       * Verificăm toate documentele din notificare,
       * nu doar cele trimise în request.
       *
       * Astfel nu arhivăm notificarea după o acceptare
       * parțială.
       */
      const missingRequired =
        await getMissingRequiredDocuments({
          scope,
          userId: authUserId,
          vendorId: vendor?.id,
          documentKeys:
            allowedDocuments,
        });

      let notificationArchived =
        false;

      if (
        missingRequired.length === 0
      ) {
        await archivePolicyNotification({
          notificationId:
            notificationId ||
            notification.id,
          scope,
          userId: authUserId,
          vendorId: vendor?.id,
        });

        notificationArchived =
          true;
      }

      return res.json({
        ok: true,

        accepted:
          acceptanceResult.accepted,

        remainingRequired:
          missingRequired.map(
            (document) => ({
              key: document.key,
              document:
                document.document,
              version:
                document.version,
            })
          ),

        gateClosed:
          missingRequired.length === 0,

        notificationArchived,
      });
    } catch (error) {
      console.error(
        "POST /api/policy-gate/accept error:",
        error
      );

      return sendRouteError(
        res,
        error
      );
    }
  }
);

/* =========================================================
 * POST /api/admin/policy-notifications/send
 *
 * Compatibil cu frontendul actual.
 *
 * Acum face:
 *
 * 1. publică versiunile curente din manifest;
 * 2. validează politicile care nu provin din manifest;
 * 3. creează campania;
 * 4. creează notificările;
 * 5. nu modifică acceptările vechi.
 * ========================================================= */

router.post(
  "/admin/policy-notifications/send",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const currentUser =
        await requireAdmin(req);

      const scope =
        normalizeScope(
          req.body?.scope
        );

      const documents =
        normalizeDocuments(
          req.body?.documents
        );

      const requiresAction =
        req.body?.requiresAction ===
        true;

      const inApp =
        req.body?.inApp &&
        typeof req.body.inApp ===
          "object"
          ? req.body.inApp
          : {};

      const email =
        req.body?.email &&
        typeof req.body.email ===
          "object"
          ? req.body.email
          : null;

      if (
        !["USERS", "VENDORS"].includes(
          scope
        )
      ) {
        return res.status(400).json({
          error: "invalid_scope",
        });
      }

      if (!documents.length) {
        return res.status(400).json({
          error: "no_documents",
        });
      }

      const invalidDocuments =
        documents.filter(
          (document) =>
            !ALLOWED_DOCS_BY_SCOPE[
              scope
            ]?.includes(document)
        );

      if (
        invalidDocuments.length
      ) {
        return res.status(400).json({
          error:
            "invalid_documents",
          invalidDocuments,
        });
      }

      const title =
        String(
          inApp?.title ||
            "Actualizare documente legale"
        ).trim();

      const message =
        String(
          inApp?.message ||
            "Au fost actualizate documentele legale."
        ).trim();

      if (!title || !message) {
        return res.status(400).json({
          error:
            "notification_content_required",
        });
      }

      /*
       * Publicăm numai documentele care există
       * efectiv în manifest.
       *
       * PRODUCT_DECLARATION este tratată separat.
       * MARKETING și VENDOR_PRIVACY_NOTICE trebuie
       * să aibă deja o politică activă dacă sunt selectate.
       */
      const manifestDocuments =
        documents.filter(
          (document) =>
            MANIFEST_DOCUMENTS_BY_SCOPE[
              scope
            ]?.includes(document)
        );

      const publication =
        manifestDocuments.length
          ? await publishSelectedGateDocuments({
              scope,
              documentKeys:
                manifestDocuments,
              publishedAt:
                new Date(),
            })
          : {
              ok: true,
              requestedTypes: [],
              publishedCount: 0,
              policies: [],
            };

      /*
       * Nu permitem trimiterea unei porți către
       * un document inexistent în DB.
       */
      await validateNonManifestDocuments({
        scope,
        documents,
      });

      const campaign =
        await prisma.policyGateCampaign.create({
          data: {
            scope,
            requiresAction,
            title,
            message,

            sendEmail: !!email,

            emailSubject:
              email?.subject
                ? String(
                    email.subject
                  ).trim()
                : null,

            emailBody:
              email?.body
                ? String(
                    email.body
                  )
                : null,

            documents,

            createdById:
              currentUser.id,
          },
        });

      const targets =
  scope === "USERS"
    ? await prisma.user.findMany({
        /*
         * Documentele generale, precum TOS și Privacy,
         * se aplică atât clienților, cât și vendorilor.
         */
        where: {
          role: {
            in: ["USER", "VENDOR"],
          },
        },

        select: {
          id: true,
          role: true,
        },
      })
    : await prisma.vendor.findMany({
        select: {
          id: true,
          userId: true,
        },
      });

      const notifications =
        targets.map((target) => ({
          userId:
            scope === "USERS"
              ? target.id
              : null,

          vendorId:
            scope === "VENDORS"
              ? target.id
              : null,

          type: "system",

          title,
          body: message,

          link:
            scope === "VENDORS"
              ? "/desktop?policyGate=1&scope=VENDORS"
              : "/cont?policyGate=1&scope=USERS",

          meta: {
  kind: "POLICY_UPDATE",
  scope,
  documents,
  requiresAction,
  campaignId: campaign.id,
  campaignKey: campaign.campaignKey,
  email: !!email,
  createdAt: new Date(),
}
        }));

      if (
        notifications.length
      ) {
        await prisma.notification.createMany({
          data: notifications,
        });
      }

      await prisma.policyGateCampaign.update({
        where: {
          id: campaign.id,
        },

        data: {
          targetCount:
            targets.length,

          createdCount:
            notifications.length,

          /*
           * Emailul real nu este încă pus într-o coadă.
           */
          emailQueued:
            email ? 0 : null,

          emailFailed:
            email ? 0 : null,
        },
      });

      return res.json({
        ok: true,

        campaignId:
          campaign.id,

        scope,
        documents,

        publication: {
          publishedCount:
            publication.publishedCount,

          policies:
            publication.policies,
        },

        targetCount:
          targets.length,

        createdCount:
          notifications.length,

        emailQueued:
          email ? 0 : null,

        emailFailed:
          email ? 0 : null,
      });
    } catch (error) {
      console.error(
        "POST /api/admin/policy-notifications/send error:",
        error
      );

      return sendRouteError(
        res,
        error
      );
    }
  }
);

export default router;