// backend/scripts/generateFeedTitles.mjs
//
// Generează Product.feedTitle (titlul pentru feed-ul Google Merchant
// Center) cu OpenAI, DOAR din datele produsului (services/feedTitleService.js).
//
// GARANȚII:
//  - Implicit DRY-RUN: NU scrie în baza de date; afișează titlu actual ->
//    feedTitle propus (JSON pe stdout sau în --out <fișier>).
//  - NU se conectează la nicio bază înainte ca --expect-host să se potrivească
//    cu gazda din DATABASE_URL (protecție împotriva rulării pe baza greșită).
//  - --apply scrie DOAR feedTitle / feedTitleGeneratedAt / feedTitleInputHash
//    (cere migrarea 20261008120000_add_product_feed_title aplicată). Titlul de
//    pe site (title) NU e atins.
//
// Utilizare (din backend/):
//   node scripts/generateFeedTitles.mjs --expect-host <host> [--limit N] [--out f.json]
//   node scripts/generateFeedTitles.mjs --expect-host <host> --apply [--only-missing]
//   node scripts/generateFeedTitles.mjs --expect-host <host> --apply --from f.json
//     (scrie exact titlurile aprobate din simulare; sare produsele modificate)

import fs from "node:fs";
import "dotenv/config";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const expectHost = option("--expect-host");
const apply = flag("--apply");
const onlyMissing = flag("--only-missing");
const limit = Number(option("--limit")) || null;
const outFile = option("--out");
// --from <fișier.json> (cu --apply): scrie EXACT titlurile aprobate dintr-o
// simulare anterioară, fără apeluri AI; produsele modificate între timp
// (hash diferit) sunt sărite.
const fromFile = option("--from");

const host = (process.env.DATABASE_URL || "").match(/@([^/:?]+)/)?.[1] || null;

if (!expectHost || host !== expectHost) {
  console.error(`Refuz: --expect-host (${expectHost || "lipsă"}) nu se potrivește cu DATABASE_URL (${host}).`);
  process.exit(1);
}

const { prisma } = await import("../src/db.js");
const {
  buildFeedTitleFacts,
  feedTitleInputHash,
  findSimilarSiblings,
  generateFeedTitle,
  FEED_TITLE_VERSION,
} = await import("../src/services/feedTitleService.js");

if (fromFile) {
  if (!apply) {
    console.error("--from se folosește doar împreună cu --apply.");
    process.exit(1);
  }

  const approved = JSON.parse(fs.readFileSync(fromFile, "utf8"));
  if (approved.host !== host) {
    console.error(`Refuz: fișierul e pentru ${approved.host}, baza curentă e ${host}.`);
    process.exit(1);
  }

  let written = 0;
  let skipped = 0;
  for (const row of approved.results || []) {
    if (!row.feedTitle || !row.inputHash) continue;

    const current = await prisma.product.findUnique({
      where: { id: row.id },
      select: {
        id: true, title: true, description: true, category: true, color: true, materialMain: true,
        technique: true, dimensions: true, occasionTags: true, styleTags: true, acceptsCustom: true, orderMode: true,
      },
    });
    const currentHash = current ? feedTitleInputHash(buildFeedTitleFacts(current)) : null;

    if (currentHash !== row.inputHash) {
      skipped += 1;
      console.error(`  skip (modificat după simulare) ${row.title}`);
      continue;
    }

    await prisma.product.update({
      where: { id: row.id },
      data: { feedTitle: row.feedTitle, feedTitleGeneratedAt: new Date(), feedTitleInputHash: row.inputHash },
    });
    written += 1;
  }

  console.error(`[feed-title] --from ${fromFile}: ${written} scrise, ${skipped} sărite`);
  await prisma.$disconnect();
  process.exit(0);
}

const products = await prisma.product.findMany({
  select: {
    id: true,
    serviceId: true,
    title: true,
    description: true,
    category: true,
    color: true,
    materialMain: true,
    technique: true,
    dimensions: true,
    occasionTags: true,
    styleTags: true,
    acceptsCustom: true,
    orderMode: true,
    ...(onlyMissing ? { feedTitle: true } : {}),
  },
  orderBy: { createdAt: "asc" },
});

const targets = (onlyMissing ? products.filter((p) => !p.feedTitle) : products).slice(0, limit || undefined);
console.error(`[feed-title] ${host} · ${targets.length} produse · ${apply ? "APPLY" : "DRY-RUN"} · ${FEED_TITLE_VERSION}`);

const results = [];
for (const product of targets) {
  const siblings = findSimilarSiblings(product, products);
  const generated = await generateFeedTitle(product, { siblings });

  results.push({
    id: product.id,
    title: product.title,
    feedTitle: generated.feedTitle,
    length: generated.feedTitle?.length ?? null,
    siblings: siblings.map((s) => s.title),
    used: generated.used || [],
    problems: generated.problems || [],
    error: generated.error || null,
    inputHash: generated.inputHash || null,
  });

  if (apply && generated.feedTitle) {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        feedTitle: generated.feedTitle,
        feedTitleGeneratedAt: new Date(),
        feedTitleInputHash: generated.inputHash,
      },
    });
  }

  console.error(`  ${generated.feedTitle ? "ok " : "ERR"} ${product.title}  ->  ${generated.feedTitle || generated.error}`);
}

const json = JSON.stringify({ host, apply, version: FEED_TITLE_VERSION, results }, null, 2);
if (outFile) fs.writeFileSync(outFile, json);
else console.log(json);

await prisma.$disconnect();
process.exit(0);
