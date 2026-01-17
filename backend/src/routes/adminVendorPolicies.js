import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";

const router = Router();

/**
 * GET /api/admin/vendor-acceptances
 *
 * Returnează, per vendor:
 * - acceptări documente (VendorAcceptance):
 *   - VENDOR_TERMS
 *   - SHIPPING_ADDENDUM
 *   - RETURNS_POLICY_ACK
 *   - PRODUCTS_ADDENDUM (✅ nou)
 * - declarație produse:
 *   - VendorProductDeclaration
 * - Info de curierat din VendorService.attributes (informativ)
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

      const vendors = await prisma.vendor.findMany({
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
      });

      const rows = vendors.map((v) => {
        const getLast = (doc) =>
          v.VendorAcceptance
            .filter((a) => a.document === doc)
            .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime())[0] ||
          null;

        const vendorTerms = getLast("VENDOR_TERMS");
        const shipping = getLast("SHIPPING_ADDENDUM");
        const returns = getLast("RETURNS_POLICY_ACK");

        // ✅ NOU: Anexa Produse
        const productsAddendum = getLast("PRODUCTS_ADDENDUM");

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
          vendorTermsVersion: vendorTerms?.version ?? null,
          vendorTermsAcceptedAt: vendorTerms?.acceptedAt ?? null,

          shippingAccepted: !!shipping,
          shippingVersion: shipping?.version ?? null,
          shippingAcceptedAt: shipping?.acceptedAt ?? null,

          returnsAccepted: !!returns,
          returnsVersion: returns?.version ?? null,
          returnsAcceptedAt: returns?.acceptedAt ?? null,

          // ✅ NOU: Anexa Produse
          productsAddendumAccepted: !!productsAddendum,
          productsAddendumVersion: productsAddendum?.version ?? null,
          productsAddendumAcceptedAt: productsAddendum?.acceptedAt ?? null,

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
