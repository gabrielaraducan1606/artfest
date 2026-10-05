// backend/src/services/vendorCampaignMigration.js
//
// Consolidare VendorCampaign -> VendorCollection („Colecții” unice) - FAZA 1:
// migrare de DATE, idempotentă. Fiecare VendorCampaign devine o VendorCollection:
//
//   name               -> title (max 160)
//   slug               -> slug (păstrat; la coliziune: "<slug>-colectie[-<id>]")
//   isActive, discountPercent, startsAt, endsAt, visits, createdAt -> copiate
//   scope ALL_PRODUCTS      -> allOwnProducts = true (fără listă fixă)
//   scope SELECTED_PRODUCTS -> VendorCollectionItem (doar produsele vendorului)
//   id                 -> legacyCampaignId (idempotență + redirect /c/:slug)
//
// NU se ating: VendorCampaign / VendorCampaignProduct / VendorCampaignCreative
// (rămân legacy, read-only), Shipment.campaignId / campaignCommissionBps
// (istoric, refund). Creative-urile NU se migrează (decizie explicită).
// NU se modifică pricing-ul (FAZA 2).
//
// Idempotență: o campanie cu o colecție având legacyCampaignId = campaign.id e
// sărită complet (nu suprascriem eventuale editări făcute după migrare).

const TITLE_MAX = 160; // VendorCollection.title VarChar(160)
const SLUG_MAX = 180; // VendorCollection.slug VarChar(180)
const MAX_DISCOUNT_PERCENT = 50; // MAX_TOTAL_DISCOUNT_PERCENT (vendorDiscountCodesRoutes.js)
const COLLISION_SUFFIX = "-colectie";

export const CAMPAIGN_MIGRATION_SELECT = {
  id: true,
  vendorId: true,
  name: true,
  slug: true,
  isActive: true,
  scope: true,
  discountPercent: true,
  platformFundingBps: true,
  vendorFundingBps: true,
  fundingSource: true,
  startsAt: true,
  endsAt: true,
  visits: true,
  createdAt: true,
  products: {
    select: {
      productId: true,
      createdAt: true,
      product: { select: { id: true, service: { select: { vendorId: true } } } },
    },
  },
  _count: { select: { creatives: true } },
};

function clampDiscount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_DISCOUNT_PERCENT, Math.max(0, Math.round(n)));
}

function uniqueSlug(baseSlug, campaignId, taken) {
  const base = String(baseSlug || "").slice(0, SLUG_MAX) || `colectie-${String(campaignId).slice(0, 8)}`;
  if (!taken.has(base)) return { slug: base, collided: false };

  const withSuffix = `${base.slice(0, SLUG_MAX - COLLISION_SUFFIX.length)}${COLLISION_SUFFIX}`;
  if (!taken.has(withSuffix)) return { slug: withSuffix, collided: true };

  const idPart = `-${String(campaignId).replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
  const withId = `${base.slice(0, SLUG_MAX - COLLISION_SUFFIX.length - idPart.length)}${COLLISION_SUFFIX}${idPart}`;
  return { slug: withId, collided: true };
}

/**
 * Plan PUR (fără DB): ce s-ar crea, ce s-ar sări, coliziuni, avertismente.
 *
 * @param {object} params
 * @param {Array} params.campaigns - VendorCampaign cu CAMPAIGN_MIGRATION_SELECT
 * @param {Array<{id, slug, legacyCampaignId}>} params.existingCollections
 */
export function planCampaignMigration({ campaigns = [], existingCollections = [] }) {
  const migratedByCampaignId = new Map(
    existingCollections
      .filter((c) => c.legacyCampaignId)
      .map((c) => [String(c.legacyCampaignId), c])
  );

  // slug-urile ocupate: colecțiile existente + cele planificate în această rulare
  const takenSlugs = new Set(existingCollections.map((c) => c.slug));

  const ordered = [...campaigns].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id))
  );

  const actions = [];

  for (const campaign of ordered) {
    const already = migratedByCampaignId.get(String(campaign.id));

    if (already) {
      actions.push({
        action: "SKIP_ALREADY_MIGRATED",
        campaignId: campaign.id,
        campaignSlug: campaign.slug,
        collectionId: already.id,
        collectionSlug: already.slug,
      });
      continue;
    }

    const warnings = [];
    const { slug, collided } = uniqueSlug(campaign.slug, campaign.id, takenSlugs);
    takenSlugs.add(slug);

    if (collided) {
      warnings.push(`SLUG_COLLISION: "${campaign.slug}" e ocupat de o colecție; colecția primește "${slug}" (redirect /c/:slug prin legacyCampaignId)`);
    }

    const allOwnProducts = campaign.scope === "ALL_PRODUCTS";

    // SELECTED_PRODUCTS -> doar produsele proprii ale vendorului (campaniile erau own-only)
    const items = [];
    if (!allOwnProducts) {
      const sorted = [...(campaign.products || [])].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.productId).localeCompare(String(b.productId))
      );

      for (const row of sorted) {
        const ownerId = row.product?.service?.vendorId;
        if (!row.product) {
          warnings.push(`PRODUCT_MISSING: ${row.productId} nu mai există - sărit`);
          continue;
        }
        if (String(ownerId) !== String(campaign.vendorId)) {
          warnings.push(`PRODUCT_NOT_OWNED: ${row.productId} nu aparține vendorului campaniei - sărit`);
          continue;
        }
        items.push({ productId: row.productId, position: items.length });
      }

      if (!items.length) {
        warnings.push("SELECTED_PRODUCTS_EMPTY: campanie SELECTED_PRODUCTS fără produse migrabile - colecția va fi goală");
      }
    }

    const discountPercent = clampDiscount(campaign.discountPercent);
    if (discountPercent !== Number(campaign.discountPercent || 0)) {
      warnings.push(`DISCOUNT_CLAMPED: ${campaign.discountPercent}% -> ${discountPercent}%`);
    }

    const fundingIsVendorOnly =
      !campaign.fundingSource ||
      (campaign.fundingSource === "VENDOR" && !Number(campaign.platformFundingBps || 0));
    if (discountPercent > 0 && !fundingIsVendorOnly) {
      warnings.push(
        `FUNDING_NOT_VENDOR: campania avea finanțare ${campaign.fundingSource} (platform ${Number(campaign.platformFundingBps || 0)} bps); colecția tratează reducerea ca finanțată de owner, doar pe produse proprii`
      );
    }

    const creativesCount = Number(campaign._count?.creatives || 0);
    if (creativesCount) {
      warnings.push(`CREATIVES_NOT_MIGRATED: ${creativesCount} creative rămân doar pe VendorCampaign (legacy)`);
    }

    actions.push({
      action: "CREATE",
      campaignId: campaign.id,
      campaignSlug: campaign.slug,
      collection: {
        vendorId: campaign.vendorId,
        title: String(campaign.name || "Colecție").slice(0, TITLE_MAX),
        slug,
        description: null,
        coverImage: null,
        isActive: Boolean(campaign.isActive),
        sort: "curated",
        visits: Number(campaign.visits || 0),
        discountPercent,
        startsAt: campaign.startsAt || null,
        endsAt: campaign.endsAt || null,
        allOwnProducts,
        legacyCampaignId: campaign.id,
        createdAt: campaign.createdAt,
      },
      items,
      slugCollision: collided,
      warnings,
    });
  }

  const creates = actions.filter((a) => a.action === "CREATE");

  return {
    totalCampaigns: campaigns.length,
    toCreate: creates.length,
    alreadyMigrated: actions.length - creates.length,
    slugCollisions: creates.filter((a) => a.slugCollision).map((a) => ({ campaignSlug: a.campaignSlug, collectionSlug: a.collection.slug })),
    allOwnProducts: creates.filter((a) => a.collection.allOwnProducts).length,
    selectedProducts: creates.filter((a) => !a.collection.allOwnProducts).length,
    itemsToCreate: creates.reduce((n, a) => n + a.items.length, 0),
    warnings: creates.flatMap((a) => a.warnings.map((w) => `${a.campaignSlug}: ${w}`)),
    actions,
  };
}

/** Citiri pentru plan (read-only). */
export async function loadCampaignMigrationInput(db) {
  const [campaigns, existingCollections] = await Promise.all([
    db.vendorCampaign.findMany({ select: CAMPAIGN_MIGRATION_SELECT, orderBy: { createdAt: "asc" } }),
    db.vendorCollection.findMany({ select: { id: true, slug: true, legacyCampaignId: true } }),
  ]);
  return { campaigns, existingCollections };
}

/**
 * Aplică planul: o tranzacție per campanie, cu re-verificare a idempotenței
 * în tranzacție (rulări concurente / repetate nu dublează nimic).
 * Nu modifică / șterge nimic din VendorCampaign.
 */
export async function applyCampaignMigration({ db, plan }) {
  const results = [];

  for (const action of plan.actions) {
    if (action.action !== "CREATE") {
      results.push({ campaignId: action.campaignId, result: "SKIPPED", collectionId: action.collectionId });
      continue;
    }

    const outcome = await db.$transaction(async (tx) => {
      const existing = await tx.vendorCollection.findUnique({
        where: { legacyCampaignId: action.campaignId },
        select: { id: true },
      });

      if (existing) return { result: "SKIPPED", collectionId: existing.id };

      const collection = await tx.vendorCollection.create({ data: action.collection, select: { id: true, slug: true } });

      if (action.items.length) {
        await tx.vendorCollectionItem.createMany({
          data: action.items.map((item) => ({ collectionId: collection.id, productId: item.productId, position: item.position })),
          skipDuplicates: true,
        });
      }

      return { result: "CREATED", collectionId: collection.id, slug: collection.slug, items: action.items.length };
    });

    results.push({ campaignId: action.campaignId, ...outcome });
  }

  return {
    created: results.filter((r) => r.result === "CREATED").length,
    skipped: results.filter((r) => r.result === "SKIPPED").length,
    results,
  };
}
