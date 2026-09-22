// src/services/legacyCardLedgerReport.test.js
//
// Teste pentru raportul READ-ONLY al ledger-ului CARD legacy. Fără DB real.
// Rulare: node --test src/services/legacyCardLedgerReport.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LEGACY_CATEGORIES,
  buildLegacyCardLedgerReport,
  classifyLegacyCardLedger,
  payoutBillingState,
} from "./legacyCardLedgerReport.js";

/* ---------- fixtures ---------- */

const T = (over = {}) => ({
  id: "T1", orderId: "o1", vendorId: "v1", shipmentId: null, type: "SALE",
  commissionNet: 1.21, itemsNet: 10.05, vendorNet: 8.84, stripeTransferId: "tr_1", payoutId: null,
  ...over,
});
const S = (over = {}) => ({
  id: "S1", orderId: "o1", vendorId: "v1", shipmentId: "s1", type: "SALE",
  commissionNet: 1.21, itemsNet: 10.05, vendorNet: 8.84, stripeTransferId: null, payoutId: null,
  ...over,
});
const R = (over = {}) => ({
  id: "R1", orderId: "o1", vendorId: "v1", shipmentId: null, type: "REFUND",
  commissionNet: -1.21, itemsNet: -10.05, vendorNet: -8.84, payoutId: null,
  meta: { refShipmentId: "s1" }, ...over,
});
const ship = (status = "PENDING", id = "s1") => ({
  id, orderId: "o1", vendorId: "v1", status, direction: "OUTBOUND",
});

const classify = (args) => classifyLegacyCardLedger(args);

/* ---------- categorii ---------- */

test("LEGACY_ONLY: T singur, comandă neanulată -> istoric corect", () => {
  const r = classify({ entries: [T()], shipments: [ship()], order: { status: "PAID" } });
  assert.equal(r.category, "LEGACY_ONLY");
  assert.equal(r.assessment, "HISTORY_OK");
  assert.equal(r.amounts.excessCommission, 0);
  assert.equal(r.amounts.netCommission, 1.21);
});

test("LEGACY_DOUBLE_SALE: T + S, fără refund -> exces = Σ S, necesită recovery", () => {
  const r = classify({ entries: [T(), S()], shipments: [ship("DELIVERED")], order: { status: "PAID" } });
  assert.equal(r.category, "LEGACY_DOUBLE_SALE");
  assert.equal(r.assessment, "NEEDS_RECOVERY");
  assert.equal(r.amounts.netCommission, 2.42);
  assert.equal(r.amounts.expectedCommission, 1.21);
  assert.equal(r.amounts.excessCommission, 1.21);
  assert.deepEqual(r.legacySaleIds, ["T1"]);
  assert.deepEqual(r.shipmentSaleIds, ["S1"]);
  assert.deepEqual(r.saleShipmentIds, ["s1"]);
  assert.match(r.reason, /de două ori/);
  assert.equal(r.flags.allOutboundShipmentsHaveSale, true);
});

test("LEGACY_DOUBLE_SALE cu livrare parțială (2 livrări, doar una are S): exces = Σ S, flag-urile o arată", () => {
  const r = classify({
    entries: [T({ commissionNet: 2.42 }), S()],
    shipments: [ship("DELIVERED", "s1"), ship("PENDING", "s2")], order: { status: "PAID" },
  });
  assert.equal(r.category, "LEGACY_DOUBLE_SALE");
  assert.equal(r.amounts.excessCommission, 1.21);
  assert.equal(r.flags.allOutboundShipmentsHaveSale, false);
  assert.equal(r.flags.amountMismatch, true);
  assert.ok(r.notes.some((n) => /livrare parțială/.test(n)));
});

test("LEGACY_DOUBLE_SALE_REFUNDED: T + S + REFUND(S) pe comandă returnată -> rămâne T", () => {
  const r = classify({ entries: [T(), S(), R()], shipments: [ship("RETURNED")], order: { status: "PAID" } });
  assert.equal(r.category, "LEGACY_DOUBLE_SALE_REFUNDED");
  assert.equal(r.assessment, "NEEDS_RECOVERY");
  assert.equal(r.amounts.netCommission, 1.21);
  assert.equal(r.amounts.excessCommission, 1.21);
  assert.deepEqual(r.refundIds, ["R1"]);
  assert.match(r.reason, /SALE-ul legacy T1/);
});

test("LEGACY_CANCELLED_UNREVERSED: T singur pe comandă anulată, fără refund", () => {
  const r = classify({ entries: [T()], shipments: [ship("REFUSED")], order: { status: "CANCELLED" } });
  assert.equal(r.category, "LEGACY_CANCELLED_UNREVERSED");
  assert.equal(r.assessment, "NEEDS_RECOVERY");
  assert.equal(r.amounts.excessCommission, 1.21);
});

test("LEGACY_CANCELLED_UNREVERSED: T + S pe comandă returnată, fără refund", () => {
  const r = classify({ entries: [T(), S()], shipments: [ship("RETURNED")], order: { status: "PAID" } });
  assert.equal(r.category, "LEGACY_CANCELLED_UNREVERSED");
  assert.equal(r.amounts.excessCommission, 2.42);
});

test("LEGACY_REVERSED_OK: T neutralizat prin refund cu refSaleEntryId (fix-ul de fallback)", () => {
  const r = classify({
    entries: [T(), R({ meta: { refShipmentId: "s1", refSaleEntryId: "T1" } })],
    shipments: [ship("REFUSED")], order: { status: "CANCELLED" },
  });
  assert.equal(r.category, "LEGACY_REVERSED_OK");
  assert.equal(r.assessment, "HISTORY_OK");
  assert.equal(r.amounts.netCommission, 0);
});

test("LEGACY_REVERSED_OK: T + S + refund(S) + refund(T) -> net zero", () => {
  const r = classify({
    entries: [T(), S(), R(), R({ id: "R2", meta: { refShipmentId: "s1", refSaleEntryId: "T1" } })],
    shipments: [ship("RETURNED")], order: { status: "PAID" },
  });
  assert.equal(r.category, "LEGACY_REVERSED_OK");
  assert.equal(r.amounts.excessCommission, 0);
});

test("LEGACY_AMBIGUOUS_MULTI_SHIPMENT: T singur, vendor cu 2 livrări, comandă activă -> necesită verificare", () => {
  const r = classify({
    entries: [T({ commissionNet: 2.42 })],
    shipments: [ship("PENDING", "s1"), ship("PENDING", "s2")], order: { status: "PAID" },
  });
  assert.equal(r.category, "LEGACY_AMBIGUOUS_MULTI_SHIPMENT");
  assert.equal(r.underlying, "LEGACY_ONLY");
  assert.equal(r.assessment, "NEEDS_VERIFICATION");
  assert.equal(r.amounts.excessCommission, 0);
  assert.equal(r.flags.ambiguousShipments, true);
});

test("LEGACY_AMBIGUOUS_MULTI_SHIPMENT: aceeași pereche pe comandă anulată -> recovery", () => {
  const r = classify({
    entries: [T({ commissionNet: 2.42 })],
    shipments: [ship("REFUSED", "s1"), ship("REFUSED", "s2")], order: { status: "CANCELLED" },
  });
  assert.equal(r.category, "LEGACY_AMBIGUOUS_MULTI_SHIPMENT");
  assert.equal(r.underlying, "LEGACY_CANCELLED_UNREVERSED");
  assert.equal(r.assessment, "NEEDS_RECOVERY");
  assert.equal(r.amounts.excessCommission, 2.42);
  assert.deepEqual(r.outboundShipments.map((s) => s.id), ["s1", "s2"]);
});

test("MULTIPLE_LEGACY_ROWS: reluare -> exces = T-urile în plus", () => {
  const r = classify({ entries: [T(), T({ id: "T2" })], shipments: [ship()], order: { status: "PAID" } });
  assert.equal(r.category, "MULTIPLE_LEGACY_ROWS");
  assert.equal(r.assessment, "NEEDS_RECOVERY");
  assert.equal(r.amounts.excessCommission, 1.21);
  assert.deepEqual(r.legacySaleIds, ["T1", "T2"]);
});

test("LEGACY_NO_SHIPMENT: T fără nicio livrare OUTBOUND -> verificare; pe comandă anulată -> recovery", () => {
  const active = classify({ entries: [T()], shipments: [], order: { status: "PAID" } });
  assert.equal(active.category, "LEGACY_NO_SHIPMENT");
  assert.equal(active.assessment, "NEEDS_VERIFICATION");

  const cancelled = classify({ entries: [T()], shipments: [], order: { status: "CANCELLED" } });
  assert.equal(cancelled.category, "LEGACY_NO_SHIPMENT");
  assert.equal(cancelled.assessment, "NEEDS_RECOVERY");
  assert.equal(cancelled.amounts.excessCommission, 1.21);
});

test("LEGACY_OVER_REVERSED: refund mai mare decât SALE-ul contabilizat -> verificare (exces negativ)", () => {
  const r = classify({
    entries: [T(), R({ id: "R1", meta: { refShipmentId: "s1" }, commissionNet: -2.0 })],
    shipments: [ship("PENDING")], order: { status: "PAID" },
  });
  assert.equal(r.category, "LEGACY_OVER_REVERSED");
  assert.equal(r.assessment, "NEEDS_VERIFICATION");
  assert.ok(r.amounts.netCommission < 0, "comisionul net e negativ");
  assert.match(r.reason, /reversat în plus|sub cel așteptat/);
});

test("toate categoriile din LEGACY_CATEGORIES sunt acoperite de teste (lista e completă)", () => {
  assert.deepEqual([...LEGACY_CATEGORIES].sort(), [
    "LEGACY_AMBIGUOUS_MULTI_SHIPMENT", "LEGACY_CANCELLED_UNREVERSED", "LEGACY_DOUBLE_SALE",
    "LEGACY_DOUBLE_SALE_REFUNDED", "LEGACY_NO_SHIPMENT", "LEGACY_ONLY", "LEGACY_OVER_REVERSED",
    "LEGACY_REVERSED_OK", "MULTIPLE_LEGACY_ROWS",
  ]);
});

/* ---------- facturare (payout / factură) ---------- */

test("payoutBillingState: emis / plătit / anulat / negăsit", () => {
  assert.equal(payoutBillingState(null), "PAYOUT_NOT_FOUND");
  assert.equal(payoutBillingState({ status: "UNPAID", invoice: { status: "UNPAID" } }), "ISSUED");
  assert.equal(payoutBillingState({ status: "OVERDUE", invoice: null }), "ISSUED");
  assert.equal(payoutBillingState({ status: "UNPAID", invoice: { status: "PAID" } }), "PAID");
  assert.equal(payoutBillingState({ status: "PAID", invoice: null }), "PAID");
  assert.equal(payoutBillingState({ status: "UNPAID", paidAt: new Date(), invoice: null }), "PAID");
  assert.equal(payoutBillingState({ status: "CANCELLED", invoice: null }), "CANCELLED");
});

test("facturare pe pereche: emisă, plătită, mixtă, negăsită, nefacturată", () => {
  const payoutsById = new Map([
    ["p_issued", { id: "p_issued", status: "UNPAID", invoiceId: "i1", invoice: { number: "AF-1", status: "UNPAID" } }],
    ["p_paid", { id: "p_paid", status: "PAID", paidAt: new Date(), invoiceId: "i2", invoice: { number: "AF-2", status: "PAID" } }],
  ]);
  const base = { shipments: [ship("DELIVERED")], order: { status: "PAID" }, payoutsById };

  const none = classify({ ...base, entries: [T(), S()] });
  assert.equal(none.billing.overall, "NOT_BILLED");
  assert.equal(none.billing.entriesWithPayoutId, 0);

  const issued = classify({ ...base, entries: [T({ payoutId: "p_issued" }), S({ payoutId: "p_issued" })] });
  assert.equal(issued.billing.overall, "ISSUED_ONLY");
  assert.equal(issued.billing.entriesWithPayoutId, 2);
  assert.deepEqual(issued.billing.payoutIds, ["p_issued"]);
  assert.equal(issued.billing.entries[0].invoiceNumber, "AF-1");
  assert.equal(issued.billing.entries[0].invoiceStatus, "UNPAID");
  assert.equal(issued.billing.entries[0].hasInvoice, true);

  const paid = classify({ ...base, entries: [T({ payoutId: "p_paid" }), S()] });
  assert.equal(paid.billing.overall, "PAID");

  const mixed = classify({ ...base, entries: [T({ payoutId: "p_paid" }), S({ payoutId: "p_issued" })] });
  assert.equal(mixed.billing.overall, "MIXED");

  const missing = classify({ ...base, entries: [T({ payoutId: "p_gone" }), S()] });
  assert.equal(missing.billing.overall, "PAYOUT_NOT_FOUND");
  assert.ok(missing.notes.some((n) => /fără payout/.test(n)));
});

test("payoutId fără payout face un caz 'istoric corect' să ceară verificare", () => {
  const r = classify({
    entries: [T({ payoutId: "p_gone" })], shipments: [ship()], order: { status: "PAID" },
  });
  assert.equal(r.category, "LEGACY_ONLY");
  assert.equal(r.assessment, "NEEDS_VERIFICATION");
});

/* ---------- raport complet, agregate, read-only ---------- */

function makeFakeDb(store, calls) {
  const matchWhere = (row, w = {}) => {
    if (w.type && row.type !== w.type) return false;
    if (w.shipmentId === null && row.shipmentId != null) return false;
    if (w.stripeTransferId?.not === null && !row.stripeTransferId) return false;
    if (w.orderId?.not === null && row.orderId == null) return false;
    if (w.orderId?.in && !w.orderId.in.includes(row.orderId)) return false;
    if (w.id?.in && !w.id.in.includes(row.id)) return false;
    return true;
  };
  const model = (name) => ({
    findMany: async (args) => {
      calls.push([name, "findMany"]);
      return store[name].filter((row) => matchWhere(row, args.where));
    },
  });
  return {
    vendorEarningEntry: model("vendorEarningEntry"),
    shipment: model("shipment"),
    order: model("order"),
    vendorPayout: model("vendorPayout"),
  };
}

test("raport complet: agregate pe categorie (comenzi, SALE, sume, payoutId, facturare, evaluare) + STRICT read-only", async () => {
  const calls = [];
  const order = (id, status = "PAID") => ({ id, orderNumber: `AF-${id}`, status });
  const sh = (orderId, vendorId, id, status = "PENDING") => ({ id, orderId, vendorId, status, direction: "OUTBOUND" });

  const store = {
    vendorEarningEntry: [
      // o1/v1: LEGACY_ONLY
      T({ id: "T_o1", orderId: "o1", vendorId: "v1" }),
      // o2/v1: LEGACY_DOUBLE_SALE, facturat și plătit
      T({ id: "T_o2", orderId: "o2", vendorId: "v1", payoutId: "p_paid" }),
      S({ id: "S_o2", orderId: "o2", vendorId: "v1", shipmentId: "s_o2", payoutId: "p_paid" }),
      // o3/v1: CANCELLED_UNREVERSED, nefacturat
      T({ id: "T_o3", orderId: "o3", vendorId: "v1", itemsNet: 20, commissionNet: 2.4, vendorNet: 17.6 }),
      // o4/v1: REVERSED_OK
      T({ id: "T_o4", orderId: "o4", vendorId: "v1" }),
      R({ id: "R_o4", orderId: "o4", vendorId: "v1", meta: { refShipmentId: "s_o4", refSaleEntryId: "T_o4" } }),
      // o5/v1: AMBIGUOUS
      T({ id: "T_o5", orderId: "o5", vendorId: "v1" }),
      // o6/v1: DOUBLE_SALE_REFUNDED, facturat emis
      T({ id: "T_o6", orderId: "o6", vendorId: "v1", payoutId: "p_issued" }),
      S({ id: "S_o6", orderId: "o6", vendorId: "v1", shipmentId: "s_o6" }),
      R({ id: "R_o6", orderId: "o6", vendorId: "v1", meta: { refShipmentId: "s_o6" } }),
    ],
    shipment: [
      sh("o1", "v1", "s_o1"), sh("o2", "v1", "s_o2", "DELIVERED"), sh("o3", "v1", "s_o3", "REFUSED"),
      sh("o4", "v1", "s_o4", "REFUSED"), sh("o5", "v1", "s_o5a"), sh("o5", "v1", "s_o5b"),
      sh("o6", "v1", "s_o6", "RETURNED"),
    ],
    order: [order("o1"), order("o2"), order("o3", "CANCELLED"), order("o4", "CANCELLED"), order("o5"), order("o6")],
    vendorPayout: [
      { id: "p_paid", status: "PAID", paidAt: new Date(), invoiceId: "i1", invoice: { number: "AF-10", status: "PAID" } },
      { id: "p_issued", status: "UNPAID", invoiceId: "i2", invoice: { number: "AF-11", status: "UNPAID" } },
    ],
  };
  const db = makeFakeDb(store, calls);

  const report = await buildLegacyCardLedgerReport({ db });

  assert.equal(report.readOnly, true);
  assert.equal(report.totals.orders, 6);
  assert.equal(report.totals.orderVendorPairs, 6);
  assert.equal(report.totals.pairsNeedingRecovery, 3); // o2, o3, o6
  assert.equal(report.totals.pairsNeedingVerification, 1); // o5 (ambiguă, neanulată)

  const c = report.categories;
  assert.equal(c.LEGACY_ONLY.orders, 1);
  assert.equal(c.LEGACY_ONLY.assessmentPairs.HISTORY_OK, 1);

  assert.equal(c.LEGACY_DOUBLE_SALE.orders, 1);
  assert.equal(c.LEGACY_DOUBLE_SALE.saleEntries, 2);
  assert.equal(c.LEGACY_DOUBLE_SALE.legacySaleEntries, 1);
  assert.equal(c.LEGACY_DOUBLE_SALE.shipmentSaleEntries, 1);
  assert.equal(c.LEGACY_DOUBLE_SALE.sales.itemsNet, 20.1);
  assert.equal(c.LEGACY_DOUBLE_SALE.sales.commissionNet, 2.42);
  assert.equal(c.LEGACY_DOUBLE_SALE.sales.vendorNet, 17.68);
  assert.equal(c.LEGACY_DOUBLE_SALE.entriesWithPayoutId, 2);
  assert.equal(c.LEGACY_DOUBLE_SALE.distinctPayouts, 1);
  assert.equal(c.LEGACY_DOUBLE_SALE.billingStatePairs.PAID, 1);
  assert.equal(c.LEGACY_DOUBLE_SALE.excessCommission, 1.21);
  assert.equal(c.LEGACY_DOUBLE_SALE.excessCommissionInBilledPairs, 1.21);
  assert.equal(c.LEGACY_DOUBLE_SALE.assessmentPairs.NEEDS_RECOVERY, 1);

  assert.equal(c.LEGACY_CANCELLED_UNREVERSED.sales.commissionNet, 2.4);
  assert.equal(c.LEGACY_CANCELLED_UNREVERSED.billingStatePairs.NOT_BILLED, 1);
  assert.equal(c.LEGACY_CANCELLED_UNREVERSED.excessCommissionInBilledPairs, 0);

  assert.equal(c.LEGACY_REVERSED_OK.refundEntries, 1);
  assert.equal(c.LEGACY_REVERSED_OK.refunds.commissionNet, -1.21);

  assert.equal(c.LEGACY_AMBIGUOUS_MULTI_SHIPMENT.assessmentPairs.NEEDS_VERIFICATION, 1);

  assert.equal(c.LEGACY_DOUBLE_SALE_REFUNDED.billingStatePairs.ISSUED_ONLY, 1);
  assert.equal(c.LEGACY_DOUBLE_SALE_REFUNDED.refunds.itemsNet, -10.05);
  assert.equal(c.LEGACY_DOUBLE_SALE_REFUNDED.excessCommission, 1.21);

  // toate categoriile apar în ieșire (și cele cu zero)
  for (const name of LEGACY_CATEGORIES) assert.ok(name in c, name);
  assert.equal(c.MULTIPLE_LEGACY_ROWS.orders, 0);

  // total exces = 1.21 (o2) + 2.40 (o3) + 1.21 (o6)
  assert.equal(report.totals.totalExcessCommission, 4.82);

  // detalii: câmpurile cerute pentru cazurile actionable
  const d = report.details.find((x) => x.orderId === "o2");
  assert.equal(d.vendorId, "v1");
  assert.deepEqual(d.legacySaleIds, ["T_o2"]);
  assert.deepEqual(d.shipmentSaleIds, ["S_o2"]);
  assert.deepEqual(d.saleShipmentIds, ["s_o2"]);
  assert.deepEqual(d.billing.payoutIds, ["p_paid"]);
  assert.equal(d.billing.entries[0].invoiceStatus, "PAID");
  assert.equal(d.billing.entries[0].invoiceNumber, "AF-10");
  assert.equal(d.amounts.excessCommission, 1.21);
  assert.ok(d.reason.length > 20);

  const d6 = report.details.find((x) => x.orderId === "o6");
  assert.deepEqual(d6.refundIds, ["R_o6"]);

  // STRICT read-only: doar findMany; nicio metodă de scriere nu există
  assert.ok(calls.length > 0);
  assert.ok(calls.every(([, method]) => method === "findMany"));
  for (const model of Object.values(db)) {
    for (const verb of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
      assert.equal(typeof model[verb], "undefined", verb);
    }
  }
});

test("baza fără nicio intrare legacy: raport gol, fără erori", async () => {
  const calls = [];
  const db = makeFakeDb(
    { vendorEarningEntry: [], shipment: [], order: [], vendorPayout: [] },
    calls
  );
  const report = await buildLegacyCardLedgerReport({ db });
  assert.equal(report.totals.orderVendorPairs, 0);
  assert.equal(report.totals.totalExcessCommission, 0);
  assert.equal(report.details.length, 0);
});

/* ---------- gardurile CLI (ies ÎNAINTE de orice conexiune) ---------- */

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/legacyCardLedgerReport.mjs"
);

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      // gazdă inexistentă (.invalid): dacă vreun cod ar încerca să se conecteze, ar eșua
      DATABASE_URL: "postgresql://user:pw@db.example.invalid:5432/testdb",
      ...env,
    },
  });
}

test("CLI: --print-target-only arată ținta și NU se conectează", () => {
  const r = runCli(["--print-target-only"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.connected, false);
  assert.equal(out.target.host, "db.example.invalid");
  assert.equal(out.target.database, "testdb");
  assert.ok(!r.stdout.includes("pw"), "nu afișează parola");
});

test("CLI: fără --expect-host nu rulează (exit 2, fără conexiune)", () => {
  const r = runCli([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--expect-host/);
});

test("CLI: --expect-host care nu corespunde bazei țintă nu rulează (exit 2, fără conexiune)", () => {
  const r = runCli(["--expect-host=alta.gazda.ro"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /nu corespunde/);
});

test("CLI: DATABASE_URL invalid -> exit 2", () => {
  const r = runCli(["--print-target-only"], { DATABASE_URL: "nu-e-url" });
  assert.equal(r.status, 2);
});
