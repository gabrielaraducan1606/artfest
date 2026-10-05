// backend/scripts/migrateVendorCampaignsToCollections.mjs
//
// FAZA 1 - migrare de DATE VendorCampaign -> VendorCollection (idempotentă).
// Logica și regulile: src/services/vendorCampaignMigration.js.
//
// GARANȚII:
//  - Implicit DRY-RUN: doar citiri, afișează planul (JSON pe stdout).
//  - Scrie DOAR cu --apply; refuză --apply dacă NODE_ENV=production.
//  - NU se conectează înainte ca --expect-host să se potrivească cu gazda din
//    DATABASE_URL (protecție împotriva rulării pe baza greșită).
//  - NU modifică / șterge VendorCampaign, VendorCampaignProduct,
//    VendorCampaignCreative sau comenzile (Shipment.campaignId rămâne).
//  - Necesită migrația Prisma 20261002180000_add_vendor_collection_campaign_fields
//    aplicată pe aceeași bază (coloana legacyCampaignId).
//
// Utilizare (din backend/):
//   Doar arată ținta, FĂRĂ conexiune:
//     node scripts/migrateVendorCampaignsToCollections.mjs --print-target-only
//   Plan (dry-run, read-only):
//     node scripts/migrateVendorCampaignsToCollections.mjs --expect-host=<gazda>
//   Plan cu detalii pe campanie:
//     node scripts/migrateVendorCampaignsToCollections.mjs --expect-host=<gazda> --details
//   Aplicare (DOAR DEV):
//     node scripts/migrateVendorCampaignsToCollections.mjs --expect-host=<gazda> --apply

import dotenv from "dotenv";

dotenv.config({ quiet: true });

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

function describeTarget() {
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    return { host: url.hostname, database: url.pathname.replace(/^\//, "") };
  } catch {
    return null;
  }
}

const target = describeTarget();

if (!target) {
  console.error("DATABASE_URL lipsește sau nu e un URL valid. Nu se face nicio conexiune.");
  process.exit(2);
}

if (flag("--print-target-only")) {
  console.log(JSON.stringify({ target }, null, 2));
  process.exit(0);
}

const expectHost = option("--expect-host");

if (!expectHost || expectHost !== target.host) {
  console.error(
    `Refuz conexiunea: --expect-host=${expectHost || "(lipsă)"} nu se potrivește cu gazda din DATABASE_URL (${target.host}).`
  );
  process.exit(2);
}

const apply = flag("--apply");

if (apply && process.env.NODE_ENV === "production") {
  console.error("Refuz --apply cu NODE_ENV=production. Migrarea se rulează doar pe DEV în FAZA 1.");
  process.exit(2);
}

const { prisma } = await import("../src/db.js");
const migration = await import("../src/services/vendorCampaignMigration.js");

try {
  const input = await migration.loadCampaignMigrationInput(prisma);
  const plan = migration.planCampaignMigration(input);

  const summary = {
    target,
    mode: apply ? "APPLY" : "DRY_RUN",
    totalCampaigns: plan.totalCampaigns,
    toCreate: plan.toCreate,
    alreadyMigrated: plan.alreadyMigrated,
    allOwnProducts: plan.allOwnProducts,
    selectedProducts: plan.selectedProducts,
    itemsToCreate: plan.itemsToCreate,
    slugCollisions: plan.slugCollisions,
    warnings: plan.warnings,
    ...(flag("--details") ? { actions: plan.actions } : {}),
  };

  if (apply) {
    summary.applied = await migration.applyCampaignMigration({ db: prisma, plan });
  }

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
} catch (error) {
  console.error("[migrateVendorCampaignsToCollections] eroare:", error?.message || error);
  process.exit(1);
}
