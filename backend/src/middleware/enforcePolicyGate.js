import { prisma } from "../db.js";

const USER_DOC_MAP = {
  TOS: "TOS",
  PRIVACY: "PRIVACY_ACK",
  COOKIES: "COOKIES_ACK",
  RETURNS_POLICY_ACK: "RETURNS_POLICY_ACK",
  MARKETING: "MARKETING_EMAIL_OPTIN",
};

async function getCurrentVendor(userId) {
  return prisma.vendor.findUnique({
    where: { userId },
    select: { id: true },
  });
}

export function enforcePolicyGate(scope = "USERS") {
  return async function policyGateMiddleware(req, res, next) {
    try {
      const normalizedScope = String(scope || "").toUpperCase();

      if (!req.user?.id) {
        return res.status(401).json({ error: "unauthorized" });
      }

      if (normalizedScope === "USERS") {
        const activePolicies = await prisma.userPolicy.findMany({
          where: {
            isActive: true,
            isRequired: true,
          },
          select: {
            document: true,
            version: true,
          },
        });

        if (!activePolicies.length) return next();

        const accepted = await prisma.userConsent.findMany({
          where: {
            userId: req.user.id,
            OR: activePolicies.map((p) => ({
              document: p.document,
              version: p.version,
            })),
          },
          select: {
            document: true,
            version: true,
          },
        });

        const acceptedSet = new Set(
          accepted.map((a) => `${a.document}::${a.version}`)
        );

        const missing = activePolicies.filter(
          (p) => !acceptedSet.has(`${p.document}::${p.version}`)
        );

        if (missing.length) {
          return res.status(428).json({
            error: "policy_acceptance_required",
            scope: "USERS",
            missing,
          });
        }

        return next();
      }

      if (normalizedScope === "VENDORS") {
        const vendor = await getCurrentVendor(req.user.id);

        if (!vendor) {
          return res.status(403).json({ error: "vendor_required" });
        }

        const activePolicies = await prisma.vendorPolicy.findMany({
          where: {
            isActive: true,
            isRequired: true,
          },
          select: {
            document: true,
            version: true,
          },
        });

        if (!activePolicies.length) return next();

        const accepted = await prisma.vendorAcceptance.findMany({
          where: {
            vendorId: vendor.id,
            OR: activePolicies.map((p) => ({
              document: p.document,
              version: p.version,
            })),
          },
          select: {
            document: true,
            version: true,
          },
        });

        const acceptedSet = new Set(
          accepted.map((a) => `${a.document}::${a.version}`)
        );

        const missing = activePolicies.filter(
          (p) => !acceptedSet.has(`${p.document}::${p.version}`)
        );

        if (missing.length) {
          return res.status(428).json({
            error: "policy_acceptance_required",
            scope: "VENDORS",
            missing,
          });
        }

        return next();
      }

      return res.status(400).json({ error: "invalid_policy_scope" });
    } catch (e) {
      console.error("enforcePolicyGate error:", e);
      return res.status(500).json({ error: "internal_error" });
    }
  };
}