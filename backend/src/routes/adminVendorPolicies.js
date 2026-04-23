import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";

const router = Router();

const ACCEPTED_VENDOR_DOCS = [
  "VENDOR_TERMS",
  "RETURNS_POLICY_ACK",
];

const INFO_VENDOR_DOCS = [
  "SHIPPING_ADDENDUM",
  "VENDOR_PRIVACY_NOTICE",
];

/**
 * GET /api/admin/vendor-acceptances
 *
 * Returnează, per vendor:
 * - acceptări reale:
 *   - VENDOR_TERMS
 *   - RETURNS_POLICY_ACK
 * - documente informative active:
 *   - SHIPPING_ADDENDUM
 *   - VENDOR_PRIVACY_NOTICE
 * - declarație produse:
 *   - VendorProductDeclaration
 *
 * ⚠️ Protejat: doar ADMIN.
 */
router.get(
  "/vendor-acceptances",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      if (req.user.role !== "ADMIN") {
        return res.status(403).json({ error: "forbidden" });
      }

      const [vendors, activePolicies] = await Promise.all([
        prisma.vendor.findMany({
          select: {
            id: true,
            displayName: true,
            email: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                email: true,
              },
            },
            VendorAcceptance: {
              where: {
                document: { in: ACCEPTED_VENDOR_DOCS },
              },
              select: {
                document: true,
                version: true,
                acceptedAt: true,
              },
            },
            productDeclaration: {
              select: {
                version: true,
                acceptedAt: true,
              },
            },
            services: {
              select: {
                id: true,
                attributes: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 500,
        }),

        prisma.vendorPolicy.findMany({
          where: {
            isActive: true,
            document: { in: [...ACCEPTED_VENDOR_DOCS, ...INFO_VENDOR_DOCS] },
          },
          orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
          select: {
            document: true,
            title: true,
            url: true,
            version: true,
            isRequired: true,
            publishedAt: true,
          },
        }),
      ]);

      const latestPolicyByDoc = new Map();
      for (const p of activePolicies) {
        if (!latestPolicyByDoc.has(p.document)) {
          latestPolicyByDoc.set(p.document, p);
        }
      }

      const rows = vendors.map((v) => {
        const getLastAcceptance = (doc) =>
          v.VendorAcceptance
            .filter((a) => a.document === doc)
            .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime())[0] ||
          null;

        const vendorTerms = getLastAcceptance("VENDOR_TERMS");
        const returns = getLastAcceptance("RETURNS_POLICY_ACK");

        const shippingPolicy = latestPolicyByDoc.get("SHIPPING_ADDENDUM") || null;
        const privacyPolicy =
          latestPolicyByDoc.get("VENDOR_PRIVACY_NOTICE") || null;

        const prodDecl = v.productDeclaration || null;

        const courierServices = (v.services || []).map((s) => {
          const attrs = s.attributes || {};
          return {
            id: s.id,
            courierEnabled: !!attrs.courierEnabled,
            courierAddendumAccepted: !!attrs.courierAddendumAccepted,
            courierAddendumVersion: attrs.courierAddendumVersion || null,
            courierAddendumAcceptedAt: attrs.courierAddendumAcceptedAt
              ? new Date(attrs.courierAddendumAcceptedAt)
              : null,
          };
        });

        const wantsCourier = courierServices.some((s) => s.courierEnabled);
        const courierAddendumToggleAccepted = courierServices.some(
          (s) => s.courierAddendumAccepted
        );

        const courierSample =
          courierServices.find(
            (s) => s.courierEnabled || s.courierAddendumAccepted
          ) || null;

        return {
          vendorId: v.id,
          vendorName: v.displayName || "",
          vendorEmail: v.email || "",
          userId: v.user?.id || null,
          userEmail: v.user?.email || null,
          createdAt: v.createdAt,

          vendorTermsAccepted: !!vendorTerms,
          vendorTermsVersion:
            vendorTerms?.version ??
            latestPolicyByDoc.get("VENDOR_TERMS")?.version ??
            null,
          vendorTermsAcceptedAt: vendorTerms?.acceptedAt ?? null,

          returnsAccepted: !!returns,
          returnsVersion:
            returns?.version ??
            latestPolicyByDoc.get("RETURNS_POLICY_ACK")?.version ??
            null,
          returnsAcceptedAt: returns?.acceptedAt ?? null,

          shippingPolicyTitle: shippingPolicy?.title ?? "Politica de livrare",
          shippingPolicyUrl: shippingPolicy?.url ?? null,
          shippingPolicyVersion: shippingPolicy?.version ?? null,
          shippingPolicyRequired: !!shippingPolicy?.isRequired,
          shippingPolicyPublishedAt: shippingPolicy?.publishedAt ?? null,

          privacyPolicyTitle:
            privacyPolicy?.title ?? "Nota de informare GDPR pentru vendori",
          privacyPolicyUrl: privacyPolicy?.url ?? null,
          privacyPolicyVersion: privacyPolicy?.version ?? null,
          privacyPolicyRequired: !!privacyPolicy?.isRequired,
          privacyPolicyPublishedAt: privacyPolicy?.publishedAt ?? null,

          productDeclarationAccepted: !!prodDecl,
          productDeclarationVersion: prodDecl?.version ?? null,
          productDeclarationAcceptedAt: prodDecl?.acceptedAt ?? null,

          wantsCourier,
          courierAddendumToggleAccepted,
          courierServicesCount: courierServices.length,
          courierSample,
        };
      });

      return res.json({ agreements: rows });
    } catch (e) {
      console.error("admin vendor-acceptances error:", e);
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;