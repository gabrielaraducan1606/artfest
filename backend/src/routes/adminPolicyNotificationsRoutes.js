import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";

const router = Router();

const DOC_LABELS = {
  TOS: "Termeni și condiții",
  PRIVACY: "Politica de confidențialitate",
  COOKIES: "Politica de Cookie-uri",
  RETURNS_POLICY_ACK: "Politica de retur",
  MARKETING: "Preferințe marketing",

  VENDOR_TERMS: "Acord master vânzători",
  VENDOR_PRIVACY_NOTICE: "Notă GDPR vendori",
  SHIPPING_ADDENDUM: "Politica de livrare",
  PRODUCTS_ADDENDUM: "Anexa produse",
  PRODUCT_DECLARATION: "Declarație produse",
};

const DOC_URLS = {
  TOS: "/legal/tos",
  PRIVACY: "/legal/privacy",
  COOKIES: "/legal/cookies",
  RETURNS_POLICY_ACK: "/politica-retur",
  MARKETING: "/legal/marketing",

  VENDOR_TERMS: "/acord-vanzatori",
  VENDOR_PRIVACY_NOTICE: "/confidentialitate",
  SHIPPING_ADDENDUM: "/anexa-expediere",
  PRODUCTS_ADDENDUM: "/politica-produse",
  PRODUCT_DECLARATION: "/vendor/legal/product-declaration",
};

const USER_DOC_MAP = {
  TOS: "TOS",
  PRIVACY: "PRIVACY_ACK",
  COOKIES: "COOKIES_ACK",
  RETURNS_POLICY_ACK: "RETURNS_POLICY_ACK",
  MARKETING: "MARKETING_EMAIL_OPTIN",
};

const USER_REVERSE_DOC_MAP = {
  TOS: "TOS",
  PRIVACY_ACK: "PRIVACY",
  COOKIES_ACK: "COOKIES",
  RETURNS_POLICY_ACK: "RETURNS_POLICY_ACK",
  MARKETING_EMAIL_OPTIN: "MARKETING",
};

const VENDOR_SPECIAL_DOCS = {
  PRODUCT_DECLARATION: true,
};

const ALLOWED_DOCS_BY_SCOPE = {
  USERS: ["TOS", "PRIVACY", "COOKIES", "RETURNS_POLICY_ACK", "MARKETING"],

  VENDORS: [
    "VENDOR_TERMS",
    "VENDOR_PRIVACY_NOTICE",
    "SHIPPING_ADDENDUM",
    "PRODUCTS_ADDENDUM",
    "PRODUCT_DECLARATION",
    "RETURNS_POLICY_ACK",
  ],
};

function getAuthUserId(req) {
  return req.user?.userId || req.user?.id || req.user?.sub || req.user?.uid || null;
}

function getIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")?.[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

function getUa(req) {
  return req.headers["user-agent"] || null;
}

function normalizeScope(scope) {
  return String(scope || "").toUpperCase();
}

async function getCurrentVendor(req) {
  const userId = getAuthUserId(req);

  if (!userId) {
    console.error("[policy-gate] missing auth user id", {
      reqUser: req.user || null,
    });
    return null;
  }

  return prisma.vendor.findUnique({
    where: { userId },
    select: { id: true, userId: true },
  });
}

async function getLatestPolicyGateNotification({ scope, userId, vendorId }) {
  return prisma.notification.findFirst({
    where: {
      archived: false,
      ...(scope === "USERS" ? { userId } : { vendorId }),
      meta: {
        path: ["kind"],
        equals: "POLICY_UPDATE",
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function buildUserDocuments(notification, userId) {
  const meta = notification?.meta || {};
  const selectedDocs = Array.isArray(meta.documents) ? meta.documents : [];
  const consentDocs = selectedDocs.map((k) => USER_DOC_MAP[k]).filter(Boolean);

  if (!consentDocs.length) return [];

  const activePolicies = await prisma.userPolicy.findMany({
    where: { isActive: true, document: { in: consentDocs } },
    orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
  });

  const latest = new Map();

  for (const p of activePolicies) {
    if (!latest.has(p.document)) latest.set(p.document, p);
  }

  const consents = await prisma.userConsent.findMany({
    where: { userId, document: { in: consentDocs } },
    select: { document: true, version: true },
  });

  const accepted = new Set(consents.map((c) => `${c.document}::${c.version}`));

  return Array.from(latest.values()).map((p) => {
    const key = USER_REVERSE_DOC_MAP[p.document] || p.document;

    return {
      key,
      document: p.document,
      title: p.title || DOC_LABELS[key] || key,
      version: p.version,
      checksum: p.checksum || null,
      url: p.url || DOC_URLS[key] || null,
      required: !!p.isRequired,
      alreadyAccepted: accepted.has(`${p.document}::${p.version}`),
    };
  });
}

async function buildVendorDocuments(notification, vendorId) {
  const meta = notification?.meta || {};
  const selectedDocs = Array.isArray(meta.documents) ? meta.documents : [];
  const normalDocs = selectedDocs.filter((d) => !VENDOR_SPECIAL_DOCS[d]);

  const activePolicies = normalDocs.length
    ? await prisma.vendorPolicy.findMany({
        where: { isActive: true, document: { in: normalDocs } },
        orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
      })
    : [];

  const latest = new Map();

  for (const p of activePolicies) {
    if (!latest.has(p.document)) latest.set(p.document, p);
  }

  const acceptances = normalDocs.length
    ? await prisma.vendorAcceptance.findMany({
        where: { vendorId, document: { in: normalDocs } },
        select: { document: true, version: true },
      })
    : [];

  const accepted = new Set(
    acceptances.map((a) => `${a.document}::${a.version}`)
  );

  const docs = Array.from(latest.values()).map((p) => ({
    key: p.document,
    document: p.document,
    title: p.title || DOC_LABELS[p.document] || p.document,
    version: p.version,
    checksum: p.checksum || null,
    url: p.url || DOC_URLS[p.document] || null,
    required: !!p.isRequired,
    alreadyAccepted: accepted.has(`${p.document}::${p.version}`),
  }));

  if (selectedDocs.includes("PRODUCT_DECLARATION")) {
    const declaration = await prisma.vendorProductDeclaration.findUnique({
      where: { vendorId },
      select: { version: true, acceptedAt: true },
    });

    docs.push({
      key: "PRODUCT_DECLARATION",
      document: "PRODUCT_DECLARATION",
      title: DOC_LABELS.PRODUCT_DECLARATION,
      version: declaration?.version || "1.0.0",
      checksum: null,
      url: DOC_URLS.PRODUCT_DECLARATION,
      required: true,
      alreadyAccepted: !!declaration,
    });
  }

  return docs;
}

router.get("/policy-gate", authRequired, enforceTokenVersion, async (req, res) => {
  try {
    const scope = normalizeScope(req.query.scope);
    const authUserId = getAuthUserId(req);
console.log("[POLICY GATE DEBUG]", {
  scope,
  authUserId,
  reqUser: req.user,
  query: req.query,
});
    if (!["USERS", "VENDORS"].includes(scope)) {
      return res.status(400).json({ error: "invalid_scope" });
    }

    if (!authUserId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    let vendor = null;

    if (scope === "VENDORS") {
      vendor = await getCurrentVendor(req);

      if (!vendor) {
        return res.status(403).json({ error: "vendor_required" });
      }
    }

    const notification = await getLatestPolicyGateNotification({
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

    const documents =
      scope === "USERS"
        ? await buildUserDocuments(notification, authUserId)
        : await buildVendorDocuments(notification, vendor.id);

    return res.json({
      notification: {
        id: notification.id,
        title: notification.title,
        message: notification.body,
        createdAt: notification.createdAt,
      },
      requiresAction: !!notification.meta?.requiresAction,
      documents,
    });
  } catch (e) {
    console.error("policy-gate GET error:", e);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.post(
  "/policy-gate/accept",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const scope = normalizeScope(req.body?.scope);
      const authUserId = getAuthUserId(req);

      const requestedDocuments = Array.isArray(req.body?.documents)
        ? req.body.documents
        : [];

      const notificationId = req.body?.notificationId || null;

      if (!["USERS", "VENDORS"].includes(scope)) {
        return res.status(400).json({ error: "invalid_scope" });
      }

      if (!authUserId) {
        return res.status(401).json({ error: "unauthorized" });
      }

      if (!requestedDocuments.length) {
        return res.status(400).json({ error: "no_documents" });
      }

      const ip = getIp(req);
      const ua = getUa(req);

      let vendor = null;

      if (scope === "VENDORS") {
        vendor = await getCurrentVendor(req);

        if (!vendor) {
          return res.status(403).json({ error: "vendor_required" });
        }
      }

      const notification = await getLatestPolicyGateNotification({
        scope,
        userId: authUserId,
        vendorId: vendor?.id,
      });

      if (!notification) {
        return res.status(404).json({ error: "notification_not_found" });
      }

      const allowedDocuments = Array.isArray(notification?.meta?.documents)
        ? notification.meta.documents
        : [];

      const sanitizedKeys = requestedDocuments
        .map((d) => {
          if (typeof d === "string") return d;
          if (typeof d?.key === "string") return d.key;
          return null;
        })
        .filter(Boolean);

      const invalidDocs = sanitizedKeys.filter(
        (k) => !allowedDocuments.includes(k)
      );

      if (invalidDocs.length) {
        return res.status(400).json({
          error: "invalid_documents",
          invalidDocs,
        });
      }

      if (scope === "USERS") {
        const dbDocuments = sanitizedKeys
          .map((k) => USER_DOC_MAP[k])
          .filter(Boolean);

        const activePolicies = await prisma.userPolicy.findMany({
          where: { isActive: true, document: { in: dbDocuments } },
          orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
        });

        const latest = new Map();

        for (const p of activePolicies) {
          if (!latest.has(p.document)) latest.set(p.document, p);
        }

        for (const policy of latest.values()) {
          await prisma.userConsent.upsert({
            where: {
              userId_document_version: {
                userId: authUserId,
                document: policy.document,
                version: policy.version,
              },
            },
            create: {
              userId: authUserId,
              document: policy.document,
              version: policy.version,
              checksum: policy.checksum || null,
              ip,
              ua,
            },
            update: {
              checksum: policy.checksum || null,
              ip,
              ua,
              givenAt: new Date(),
            },
          });
        }
      }

      if (scope === "VENDORS") {
        const normalDocs = sanitizedKeys.filter(
          (d) => d !== "PRODUCT_DECLARATION"
        );

        const activePolicies = normalDocs.length
          ? await prisma.vendorPolicy.findMany({
              where: { isActive: true, document: { in: normalDocs } },
              orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
            })
          : [];

        const latest = new Map();

        for (const p of activePolicies) {
          if (!latest.has(p.document)) latest.set(p.document, p);
        }

        for (const policy of latest.values()) {
          await prisma.vendorAcceptance.upsert({
            where: {
              vendorId_document_version: {
                vendorId: vendor.id,
                document: policy.document,
                version: policy.version,
              },
            },
            create: {
              vendorId: vendor.id,
              userId: authUserId,
              document: policy.document,
              version: policy.version,
              checksum: policy.checksum || null,
              acceptedAt: new Date(),
              ip,
              ua,
              source: "policy_gate",
            },
            update: {
              acceptedAt: new Date(),
              checksum: policy.checksum || null,
              ip,
              ua,
              source: "policy_gate",
            },
          });
        }

        if (sanitizedKeys.includes("PRODUCT_DECLARATION")) {
          const declarationVersion = "1.0.0";

          await prisma.vendorProductDeclaration.upsert({
            where: { vendorId: vendor.id },
            create: {
              vendorId: vendor.id,
              version: declarationVersion,
              acceptedAt: new Date(),
              ip,
              ua,
              meta: { source: "policy_gate" },
            },
            update: {
              version: declarationVersion,
              acceptedAt: new Date(),
              ip,
              ua,
              meta: { source: "policy_gate" },
            },
          });
        }
      }

      if (notificationId) {
        await prisma.notification.updateMany({
          where: {
            id: notificationId,
            ...(scope === "USERS"
              ? { userId: authUserId }
              : { vendor: { userId: authUserId } }),
          },
          data: {
            readAt: new Date(),
            archived: true,
          },
        });
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error("policy-gate accept error:", e);
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

router.post(
  "/admin/policy-notifications/send",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const authUserId = getAuthUserId(req);

      if (!authUserId) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const currentUser = await prisma.user.findUnique({
        where: { id: authUserId },
        select: { id: true, role: true, email: true },
      });

      const role = String(currentUser?.role || "").toUpperCase();

      if (!currentUser || !["ADMIN", "SUPER_ADMIN"].includes(role)) {
        return res.status(403).json({
          error: "forbidden",
          reqUser: req.user || null,
          authUserId,
          currentUser,
          role,
        });
      }

      const { scope, documents, requiresAction, inApp, email } = req.body || {};

      if (!["USERS", "VENDORS"].includes(scope)) {
        return res.status(400).json({ error: "invalid_scope" });
      }

      if (!Array.isArray(documents) || !documents.length) {
        return res.status(400).json({ error: "no_documents" });
      }

      const invalidDocuments = documents.filter(
        (d) => !ALLOWED_DOCS_BY_SCOPE[scope]?.includes(d)
      );

      if (invalidDocuments.length) {
        return res.status(400).json({
          error: "invalid_documents",
          invalidDocuments,
        });
      }

      const targets =
        scope === "USERS"
          ? await prisma.user.findMany({
              where: { role: "USER" },
              select: { id: true },
            })
          : await prisma.vendor.findMany({
              select: { id: true },
            });

      const notifications = targets.map((t) => ({
        userId: scope === "USERS" ? t.id : null,
        vendorId: scope === "VENDORS" ? t.id : null,
        type: "system",
        title: inApp?.title || "Actualizare documente legale",
        body: inApp?.message || "Au fost actualizate documentele legale.",
     link:
  scope === "VENDORS"
    ? "/desktop?policyGate=1&scope=VENDORS"
    : "/cont?policyGate=1&scope=USERS",
        meta: {
          kind: "POLICY_UPDATE",
          scope,
          documents,
          requiresAction: !!requiresAction,
          email: !!email,
        },
      }));

      if (notifications.length) {
        await prisma.notification.createMany({
          data: notifications,
        });
      }

      return res.json({
        ok: true,
        targetCount: targets.length,
        createdCount: notifications.length,
        emailQueued: email ? 0 : null,
        emailFailed: email ? 0 : null,
      });
    } catch (e) {
      console.error("admin policy notifications send error:", e);
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;