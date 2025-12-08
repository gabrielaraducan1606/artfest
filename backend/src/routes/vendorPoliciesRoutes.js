import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";

const router = Router();

/**
 * GET /api/admin/vendor-acceptances
 *
 * Returnează, per vendor:
 * - dacă are acceptate documentele speciale:
 *   - VENDOR_TERMS
 *   - SHIPPING_ADDENDUM
 *   - RETURNS_POLICY_ACK
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
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      });

      const rows = vendors.map((v) => {
        const getLast = (doc) =>
          v.VendorAcceptance
            .filter((a) => a.document === doc)
            .sort(
              (a, b) =>
                b.acceptedAt.getTime() - a.acceptedAt.getTime()
            )[0] || null;

        const vendorTerms = getLast("VENDOR_TERMS");
        const shipping = getLast("SHIPPING_ADDENDUM");
        const returns = getLast("RETURNS_POLICY_ACK");

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
