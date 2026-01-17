// backend/scripts/seedVendorPolicies.js
import { prisma } from "../src/db.js";
import { loadLegalDoc, defaultPublicUrlForType } from "../src/lib/legal.js";

/**
 * Mapare VendorDoc (DB) -> legal loader type (filesystem)
 * Ca să putem lua checksum + title + version din manifest.md
 */
const VENDOR_DOC_TO_LEGAL_TYPE = {
  VENDOR_TERMS: "vendor_terms",
  SHIPPING_ADDENDUM: "shipping_addendum",
  RETURNS_POLICY_ACK: "returns_policy_ack",
  PRODUCTS_ADDENDUM: "products_addendum",
};

/**
 * Helper: upsert + menține o singură versiune activă per document.
 * Dacă ai deja versiunea, doar o actualizează (title/url/checksum/isRequired/isActive/publishedAt).
 */
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
  // 1) upsert pe cheia unică (document, version)
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

  // 2) opțional: dezactivează alte versiuni active pentru același document
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
  // Definești aici care docs sunt required pentru gating
  const requiredDocs = new Set([
    "VENDOR_TERMS",
    "SHIPPING_ADDENDUM",
    "RETURNS_POLICY_ACK",
    "PRODUCTS_ADDENDUM",
  ]);

  const now = new Date();

  for (const [document, legalType] of Object.entries(VENDOR_DOC_TO_LEGAL_TYPE)) {
    // 1) citește din filesystem: title, version, checksum
    const d = loadLegalDoc(legalType); // latest

    // IMPORTANT: version în DB trebuie să fie string (ex "1.0.0")
    // Dacă în manifest/frontmatter ai număr (1,2) îl string-uim.
    const version = String(d.version);

    // 2) url: folosește URL-ul "pretty" din sistemul tău (ex /anexa-expediere)
    const url = defaultPublicUrlForType(legalType);

    // 3) title: din document (templating deja aplicat)
    const title = d.title || document;

    // 4) checksum: din raw md (loadLegalDoc îl calculează)
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
