// backend/scripts/seedVendorPolicies.js
import { prisma } from "../src/db.js";
import { loadLegalDoc, defaultPublicUrlForType } from "../src/lib/legal.js";

/**
 * Mapare VendorDoc (DB) -> legal loader type (filesystem)
 */
const VENDOR_DOC_TO_LEGAL_TYPE = {
  VENDOR_TERMS: "vendor_terms",
  SHIPPING_ADDENDUM: "shipping_addendum",
  RETURNS_POLICY_ACK: "returns_policy_ack",
  PRODUCTS_ADDENDUM: "products_addendum",
};

async function upsertPolicy({
  document,
  version,
  title,
  url,
  checksum,
  isRequired,
  publishedAt,
  isActive = true,
}) {
  await prisma.vendorPolicy.upsert({
    where: { document_version: { document, version } },
    create: {
      document,
      version,
      title,
      url,
      checksum: checksum || null,
      isRequired: !!isRequired,
      isActive: !!isActive,
      publishedAt: publishedAt || new Date(),
    },
    update: {
      title,
      url,
      checksum: checksum || null,
      isRequired: !!isRequired,
      isActive: !!isActive,
      publishedAt: publishedAt || new Date(),
    },
  });

  if (isActive) {
    await prisma.vendorPolicy.updateMany({
      where: {
        document,
        isActive: true,
        NOT: { version },
      },
      data: { isActive: false },
    });
  }
}

async function main() {
  const requiredDocs = new Set([
    "VENDOR_TERMS",
    "RETURNS_POLICY_ACK",
    "VENDOR_PRIVACY_NOTICE",
  ]);

  const now = new Date();

  for (const [document, legalType] of Object.entries(VENDOR_DOC_TO_LEGAL_TYPE)) {
    const d = loadLegalDoc(legalType);

    const version = String(d.semver || d.version);
    const url = defaultPublicUrlForType(legalType);
    const title = d.title || document;
    const checksum = d.checksum || null;

    await upsertPolicy({
      document,
      version,
      title,
      url,
      checksum,
      isRequired: requiredDocs.has(document),
      publishedAt: now,
      isActive: true,
    });

    console.log(
      `✅ VendorPolicy seeded: ${document} v${version} (${url}) required=${requiredDocs.has(
        document
      )}`
    );
  }

  console.log("🎉 Done.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });