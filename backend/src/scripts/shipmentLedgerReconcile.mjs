// src/scripts/shipmentLedgerReconcile.mjs
//
// Reconcilierea manuală a ledger-ului de vânzare (services/shipmentLedgerReconcile.js).
// IMPLICIT DOAR RAPORT (nicio scriere). Fără Stripe / SmartBill / Sameday.
//
// Rulare (din backend/):
//   node src/scripts/shipmentLedgerReconcile.mjs [--days=30] [--limit=200]
//   node src/scripts/shipmentLedgerReconcile.mjs --execute --confirm-host=<host din DATABASE_URL>
//
// --execute reface DOAR intrările clasificate „repair” (COD / CARD offline,
// influencer / referral lipsă), idempotent; restul rămân în raport.

import "dotenv/config";
import { prisma } from "../db.js";
import { reconcileShipmentLedgers } from "../services/shipmentLedgerReconcile.js";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const execute = process.argv.includes("--execute");

let host = "";
try {
  host = new URL(process.env.DATABASE_URL || "").hostname;
} catch {
  host = "";
}

if (execute && (!host || arg("confirm-host") !== host)) {
  console.error(`--execute cere --confirm-host=${host || "<host>"} (baza pe care se scrie).`);
  process.exit(1);
}

try {
  const r = await reconcileShipmentLedgers({
    dryRun: !execute,
    lookbackDays: arg("days") ?? 30,
    limit: arg("limit") ?? 200,
  });
  console.log(`baza: ${host || "?"} | ${r.dryRun ? "RAPORT (fără scrieri)" : "REPARARE"} | din ${r.since}`);
  console.log(`scanate ${r.scanned} | de refăcut ${r.repairable} | refăcute ${r.repaired} | doar raportate ${r.reported} | eșuate ${r.failed}`);
  for (const it of r.items) {
    const res = it.result ? ` -> ${it.result.ok ? "ok" : "EȘUAT"} (${it.result.reason})` : "";
    console.log(`${it.action.padEnd(7)} ${it.shipmentId} ${it.status.padEnd(10)} lipsă=${it.missing.join("+")} (${it.reason})${res}`);
  }
} finally {
  await prisma.$disconnect();
}
