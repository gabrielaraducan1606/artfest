// backend/scripts/legacyCardLedgerReport.mjs
//
// RAPORT READ-ONLY: comenzi CARD legacy cu SALE dublu / nereversat.
//
// GARANȚII:
//  - NU modifică baza de date: clientul e învelit într-un obiect care expune
//    DOAR findMany pe vendorEarningEntry, shipment, order și vendorPayout.
//  - NU se conectează la nicio bază înainte ca --expect-host să se potrivească
//    cu gazda din DATABASE_URL (protecție împotriva rulării pe baza greșită).
//  - Nu scrie fișiere; rezultatul e JSON pe stdout.
//
// Utilizare (din backend/):
//   Doar arată ținta, FĂRĂ conexiune:
//     node scripts/legacyCardLedgerReport.mjs --print-target-only
//   Sumar:
//     node scripts/legacyCardLedgerReport.mjs --expect-host=<gazda>
//   + detalii pentru cazurile care cer verificare/recovery:
//     node scripts/legacyCardLedgerReport.mjs --expect-host=<gazda> --details --only-actionable
//   + toate perechile: --details ;  filtru categorie: --category=LEGACY_DOUBLE_SALE
//
// DATABASE_URL: dacă e deja setat în mediu, are prioritate (dotenv nu
// suprascrie); altfel se citește din backend/.env.
//
// Categoriile, criteriul și formula excesului: src/services/legacyCardLedgerReport.js
// Scriptul NU propune și NU aplică recovery.

import dotenv from "dotenv";

// fără override: o variabilă deja setată în shell câștigă; quiet = dotenv nu
// scrie bannerul pe stdout (ar strica JSON-ul rezultat)
dotenv.config({ quiet: true });

function describeTarget() {
  const raw = process.env.DATABASE_URL || "";

  try {
    const url = new URL(raw);
    return {
      host: url.hostname,
      port: url.port || "default",
      database: url.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
};

const target = describeTarget();

if (!target) {
  console.error("DATABASE_URL lipsește sau nu e un URL valid. Nu se face nicio conexiune.");
  process.exit(2);
}

console.error(
  `[legacyCardLedgerReport] țintă: host=${target.host} port=${target.port} database=${target.database} (doar citire)`
);

if (flag("--print-target-only")) {
  console.log(JSON.stringify({ target, connected: false }, null, 2));
  process.exit(0);
}

const expectedHost = option("--expect-host");

if (!expectedHost) {
  console.error(
    "Lipsește --expect-host=<gazda>. Din siguranță, raportul nu rulează fără a confirma explicit baza țintă."
  );
  process.exit(2);
}

if (expectedHost !== target.host) {
  console.error(
    `--expect-host (${expectedHost}) nu corespunde gazdei din DATABASE_URL (${target.host}). Nu se face nicio conexiune.`
  );
  process.exit(2);
}

// Importuri făcute DUPĂ verificări: nimic nu atinge DB-ul înainte de garde.
const { prisma } = await import("../src/db.js");
const { buildLegacyCardLedgerReport } = await import(
  "../src/services/legacyCardLedgerReport.js"
);

const readOnlyDb = {
  vendorEarningEntry: { findMany: (a) => prisma.vendorEarningEntry.findMany(a) },
  shipment: { findMany: (a) => prisma.shipment.findMany(a) },
  order: { findMany: (a) => prisma.order.findMany(a) },
  vendorPayout: { findMany: (a) => prisma.vendorPayout.findMany(a) },
};

try {
  const report = await buildLegacyCardLedgerReport({ db: readOnlyDb });

  const output = {
    readOnly: report.readOnly,
    target,
    criteria: report.criteria,
    excessFormula: report.excessFormula,
    totals: report.totals,
    categories: report.categories,
  };

  if (flag("--details")) {
    const category = option("--category");
    let details = report.details;

    if (flag("--only-actionable")) {
      details = details.filter((d) => d.assessment !== "HISTORY_OK");
    }

    if (category) {
      details = details.filter((d) => d.category === category);
    }

    output.details = details;
  }

  console.log(JSON.stringify(output, null, 2));
} finally {
  await prisma.$disconnect();
}
