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

async function getAvailableVendorDocs() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT e.enumlabel AS value
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      WHERE t.typname = 'VendorDoc'
      ORDER BY e.enumsortorder ASC
    `;

    return Array.isArray(rows) ? rows.map((r) => String(r.value)) : [];
  } catch (e) {
    console.error("[admin/vendor-acceptances] getAvailableVendorDocs failed:");
    console.error("message:", e?.message);
    console.error("code:", e?.code);
    console.error("meta:", e?.meta);
    return [];
  }
}

function filterExistingDocs(requestedDocs, availableDocs) {
  const available = new Set(availableDocs || []);
  return requestedDocs.filter((doc) => available.has(doc));
}

router.get(
  "/vendor-acceptances",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      if (req.user.role !== "ADMIN") {
        return res.status(403).json({ error: "forbidden" });
      }

      const availableVendorDocs = await getAvailableVendorDocs();

      const acceptedDocsSafe = filterExistingDocs(
        ACCEPTED_VENDOR_DOCS,
        availableVendorDocs
      );

      const infoDocsSafe = filterExistingDocs(
        INFO_VENDOR_DOCS,
        availableVendorDocs
      );

      const allPolicyDocsSafe = [...acceptedDocsSafe, ...infoDocsSafe];

      console.log("[admin/vendor-acceptances] availableVendorDocs:", availableVendorDocs);
      console.log("[admin/vendor-acceptances] acceptedDocsSafe:", acceptedDocsSafe);
      console.log("[admin/vendor-acceptances] infoDocsSafe:", infoDocsSafe);

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
            VendorAcceptance: acceptedDocsSafe.length
              ? {
                  where: {
                    document: { in: acceptedDocsSafe },
                  },
                  select: {
                    document: true,
                    version: true,
                    acceptedAt: true,
                  },
                }
              : {
                  select: {
                    document: true,
                    version: true,
                    acceptedAt: true,
                  },
                  take: 0,
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

        allPolicyDocsSafe.length
          ? prisma.vendorPolicy.findMany({
              where: {
                isActive: true,
                document: { in: allPolicyDocsSafe },
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
            })
          : Promise.resolve([]),
      ]);

      const latestPolicyByDoc = new Map();
      for (const p of activePolicies) {
        if (!latestPolicyByDoc.has(p.document)) {
          latestPolicyByDoc.set(p.document, p);
        }
      }

      const rows = vendors.map((v) => {
        const getLastAcceptance = (doc) =>
          (v.VendorAcceptance || [])
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

          shippingPolicyAvailable: availableVendorDocs.includes("SHIPPING_ADDENDUM"),
          shippingPolicyTitle: shippingPolicy?.title ?? "Politica de livrare",
          shippingPolicyUrl: shippingPolicy?.url ?? null,
          shippingPolicyVersion: shippingPolicy?.version ?? null,
          shippingPolicyRequired: !!shippingPolicy?.isRequired,
          shippingPolicyPublishedAt: shippingPolicy?.publishedAt ?? null,

          privacyPolicyAvailable: availableVendorDocs.includes("VENDOR_PRIVACY_NOTICE"),
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

      return res.json({
        agreements: rows,
        meta: {
          availableVendorDocs,
          acceptedDocsQueried: acceptedDocsSafe,
          infoDocsQueried: infoDocsSafe,
        },
      });
    } catch (e) {
      console.error("admin vendor-acceptances error:");
      console.error("message:", e?.message);
      console.error("code:", e?.code);
      console.error("meta:", e?.meta);
      console.error("stack:", e?.stack);

      return res.status(500).json({
        error: "internal_error",
        message: e?.message || "Unknown server error",
        code: e?.code || null,
        meta: e?.meta || null,
      });
    }
  }
);

export default router;