// server/routes/adminVendorAcceptancesRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";

const router = Router();

/**
 * GET /api/admin/vendor-acceptances
 *
 * Returnează, per vendor:
 * - dacă are acceptate documentele speciale (din VendorAcceptance):
 *   - VENDOR_TERMS          (Acord Master vânzători)
 *   - SHIPPING_ADDENDUM     (Anexa de curierat Sameday)
 *   - RETURNS_POLICY_ACK    (Politica de retur pentru vânzători)
 * - dacă a acceptat declarația de conformitate a produselor:
 *   - VendorProductDeclaration (relația `productDeclaration`)
 * - Info de curierat din VendorService.attributes (doar informativ):
 *   - attributes.courierEnabled
 *   - attributes.courierAddendumAccepted + meta (version, acceptedAt)
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
              document: true, // VENDOR_TERMS / SHIPPING_ADDENDUM / RETURNS_POLICY_ACK
              version: true,
              acceptedAt: true,
            },
          },
          // declarația de produse (1–1)
          productDeclaration: {
            select: {
              version: true,
              acceptedAt: true,
            },
          },
          // servicii ale vendorului – info de curierat din profil (doar informativ)
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

        // cele 3 acorduri legale principale
        const vendorTerms = getLast("VENDOR_TERMS");
        const shipping = getLast("SHIPPING_ADDENDUM");
        const returns = getLast("RETURNS_POLICY_ACK");

        const prodDecl = v.productDeclaration || null;

        // Info de curierat din VendorService.attributes (legacy / informativ)
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

          // Acord Master vânzători (VendorAcceptance)
          vendorTermsAccepted: !!vendorTerms,
          vendorTermsVersion: vendorTerms?.version ?? null,
          vendorTermsAcceptedAt: vendorTerms?.acceptedAt ?? null,

          // Anexa de curierat (VendorAcceptance)
          shippingAccepted: !!shipping,
          shippingVersion: shipping?.version ?? null,
          shippingAcceptedAt: shipping?.acceptedAt ?? null,

          // Politica de retur (VendorAcceptance)
          returnsAccepted: !!returns,
          returnsVersion: returns?.version ?? null,
          returnsAcceptedAt: returns?.acceptedAt ?? null,

          // Declarație produse (VendorProductDeclaration)
          productDeclarationAccepted: !!prodDecl,
          productDeclarationVersion: prodDecl?.version ?? null,
          productDeclarationAcceptedAt: prodDecl?.acceptedAt ?? null,

          // Curierat – doar informativ, din VendorService.attributes
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
