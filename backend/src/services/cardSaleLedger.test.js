// backend/src/services/cardSaleLedger.test.js
//
// Teste deterministe (fără Stripe/DB reale) pentru distribuția ledger-ului
// CARD pe shipment-uri OUTBOUND.
//
// Rulare: node --test src/services/cardSaleLedger.test.js

import { test, mock } from "node:test";
import assert from "node:assert/strict";

import {
  allocateCentsByWeights,
  buildCardSaleAllocation,
  buildCardSaleEntryMeta,
  planCardSaleEntries,
  upsertCardSaleEntries,
} from "./cardSaleLedger.js";

const sumCents = (arr) => arr.reduce((t, v) => t + Math.round(v * 100), 0);

/* =========================================================
   allocateCentsByWeights
========================================================= */

test("exemplul din cerință: total 2,41 cu ponderi 1,21/1,21 -> 1,21 + 1,20", () => {
  assert.deepEqual(allocateCentsByWeights(241, [121, 121]), [121, 120]);
});

test("suma alocată e MEREU exact totalul (fuzz determinist)", () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let i = 0; i < 2000; i += 1) {
    const n = 1 + Math.floor(rnd() * 6);
    const weights = Array.from({ length: n }, () => Math.floor(rnd() * 5000));
    const total = Math.floor(rnd() * 100000);
    const out = allocateCentsByWeights(total, weights);

    assert.equal(out.length, n);
    assert.equal(out.reduce((a, b) => a + b, 0), total);
    assert.ok(out.every((v) => v >= 0), `negativ: ${out} (total ${total}, ponderi ${weights})`);
  }
});

test("ponderi nule -> împărțire egală, tot exact", () => {
  const out = allocateCentsByWeights(100, [0, 0, 0]);
  assert.equal(out.reduce((a, b) => a + b, 0), 100);
});

test("un singur shipment primește tot totalul", () => {
  assert.deepEqual(allocateCentsByWeights(241, [999]), [241]);
});

/* =========================================================
   buildCardSaleAllocation
========================================================= */

function payoutFor({ itemsNetExVat, commissionNet, shippingGross = 0 }) {
  return {
    vendorId: "v1",
    itemsGross: itemsNetExVat,
    itemsNetExVat,
    itemsVat: 0,
    shippingGross,
    shippingNetExVat: shippingGross,
    shippingVat: 0,
    gross: itemsNetExVat + shippingGross,
    commissionNet,
    commissionAmount: commissionNet,
    platformSubsidyAmount: 0,
    commissionBase: itemsNetExVat,
    stripeFeeAllocated: 1.5,
    vendorPayoutNet: itemsNetExVat + shippingGross - 1.5,
    commissionBps: 1200,
    planCode: "basic",
    planName: "Basic",
  };
}

test("C. rotunjire: agregat 2,41 vs per-shipment 1,21+1,21 -> ultimul absoarbe, total = computeOrderSplits", () => {
  const rows = buildCardSaleAllocation({
    payout: payoutFor({ itemsNetExVat: 20.1, commissionNet: 2.41 }),
    shipments: [
      { id: "s1", shippingGross: 0, earning: { itemsNet: 10.05, commissionNet: 1.21 } },
      { id: "s2", shippingGross: 0, earning: { itemsNet: 10.05, commissionNet: 1.21 } },
    ],
  });

  assert.deepEqual(rows.map((r) => r.commissionNet), [1.21, 1.2]);
  assert.equal(sumCents(rows.map((r) => r.commissionNet)), 241);
  assert.equal(sumCents(rows.map((r) => r.itemsNet)), 2010);
  assert.equal(rows[1].isLast, true);
});

test("D. own-sale: per-shipment (5%) diferă de computeOrderSplits (plan 12%) -> totalul rămâne cel din computeOrderSplits", () => {
  // s1 ar avea 0,50 (5%) în logica COD, s2 1,21 (12%). computeOrderSplits
  // nu aplică override-ul: total 2,41. Ledger-ul respectă totalul.
  const rows = buildCardSaleAllocation({
    payout: payoutFor({ itemsNetExVat: 20.1, commissionNet: 2.41 }),
    shipments: [
      { id: "s1", shippingGross: 0, earning: { itemsNet: 10.05, commissionNet: 0.5 } },
      { id: "s2", shippingGross: 0, earning: { itemsNet: 10.05, commissionNet: 1.21 } },
    ],
  });

  assert.equal(sumCents(rows.map((r) => r.commissionNet)), 241);
  assert.deepEqual(rows.map((r) => r.commissionNet), [0.7, 1.71]);
  // COD-ul calculat rămâne doar informativ în meta
  assert.equal(rows[0].computedCommissionNet, 0.5);
});

test("comision 0 pe toate ponderile -> cade pe ponderea itemilor, tot exact", () => {
  const rows = buildCardSaleAllocation({
    payout: payoutFor({ itemsNetExVat: 20, commissionNet: 1 }),
    shipments: [
      { id: "s1", shippingGross: 0, earning: { itemsNet: 10, commissionNet: 0 } },
      { id: "s2", shippingGross: 0, earning: { itemsNet: 10, commissionNet: 0 } },
    ],
  });
  assert.equal(sumCents(rows.map((r) => r.commissionNet)), 100);
});

test("A. un singur shipment: rândul preia exact totalul vendorului", () => {
  const rows = buildCardSaleAllocation({
    payout: payoutFor({ itemsNetExVat: 20.1, commissionNet: 2.41, shippingGross: 15 }),
    shipments: [{ id: "s1", shippingGross: 15, earning: { itemsNet: 20.1, commissionNet: 2.42 } }],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].commissionNet, 2.41);
  assert.equal(rows[0].itemsNet, 20.1);
  assert.equal(rows[0].shippingNetExVat, 15);
  // semantica COD pe rândul legat de shipment: vendorNet = itemsNet - comision
  assert.equal(rows[0].vendorNet, 17.69);
});

test("fără shipment-uri OUTBOUND -> eroare, nu rând orfan", () => {
  assert.throws(
    () => buildCardSaleAllocation({ payout: payoutFor({ itemsNetExVat: 1, commissionNet: 0 }), shipments: [] }),
    /card_sale_no_outbound_shipments/
  );
});

/* =========================================================
   DB: planCardSaleEntries / upsertCardSaleEntries (DB fals)
========================================================= */

function makeFakeDb({ shipments = [], entries = [] } = {}) {
  let seq = 0;
  const db = {
    __entries: entries,
    __shipmentQueries: [],
    __createFailuresOnce: new Set(),

    shipment: {
      findMany: async ({ where }) => {
        db.__shipmentQueries.push(where);
        return shipments
          .filter(
            (s) =>
              s.orderId === where.orderId &&
              s.vendorId === where.vendorId &&
              s.direction === where.direction
          )
          .map((s) => ({ id: s.id, price: s.price }));
      },
    },

    vendorEarningEntry: {
      findUnique: async ({ where }) =>
        entries.find((e) => e.shipmentId === where.shipmentId) || null,

      create: async ({ data }) => {
        if (db.__createFailuresOnce.has(data.shipmentId)) {
          db.__createFailuresOnce.delete(data.shipmentId);
          // cursă: ensureSaleLedgerEntry a creat rândul între timp
          entries.push({ id: `race_${++seq}`, type: "SALE", payoutId: null, meta: { source: "shipment_status_fulfilled" }, ...data, stripeTransferId: null });
          const error = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        if (entries.some((e) => e.shipmentId && e.shipmentId === data.shipmentId)) {
          const error = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        const row = { id: `e_${++seq}`, payoutId: null, ...data };
        entries.push(row);
        return { ...row };
      },

      update: async ({ where, data }) => {
        const row = entries.find((e) => e.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
    },
  };
  return db;
}

const twoShipments = () => [
  { id: "s1", orderId: "o1", vendorId: "v1", direction: "OUTBOUND", price: 0 },
  { id: "s2", orderId: "o1", vendorId: "v1", direction: "OUTBOUND", price: 0 },
  { id: "r1", orderId: "o1", vendorId: "v1", direction: "RETURN", price: 0 },
  { id: "x1", orderId: "o1", vendorId: "v2", direction: "OUTBOUND", price: 0 },
];

test("H. RETURN (și alt vendor) nu sunt niciodată planificate ca SALE", async () => {
  const db = makeFakeDb({ shipments: twoShipments() });
  const computed = [];

  const allocation = await planCardSaleEntries({
    db,
    orderId: "o1",
    vendorId: "v1",
    payout: payoutFor({ itemsNetExVat: 20.1, commissionNet: 2.41 }),
    computeEarning: async ({ shipmentId }) => {
      computed.push(shipmentId);
      return { itemsNet: 10.05, commissionNet: 1.21 };
    },
  });

  assert.deepEqual(allocation.map((r) => r.shipmentId), ["s1", "s2"]);
  assert.deepEqual(computed, ["s1", "s2"]); // niciun calcul pentru RETURN
  assert.equal(db.__shipmentQueries[0].direction, "OUTBOUND");
});

test("vendor fără shipment OUTBOUND -> vendor_outbound_shipments_missing (înainte de orice transfer)", async () => {
  const db = makeFakeDb({
    shipments: [{ id: "r1", orderId: "o1", vendorId: "v1", direction: "RETURN", price: 0 }],
  });

  await assert.rejects(
    planCardSaleEntries({
      db,
      orderId: "o1",
      vendorId: "v1",
      payout: payoutFor({ itemsNetExVat: 1, commissionNet: 0 }),
      computeEarning: async () => ({}),
    }),
    /vendor_outbound_shipments_missing:v1/
  );
});

async function runUpsert(db, allocation) {
  const payout = payoutFor({ itemsNetExVat: 20.1, commissionNet: 2.41 });

  return upsertCardSaleEntries({
    db,
    orderId: "o1",
    vendorId: "v1",
    allocation,
    transferId: "tr_1",
    currency: "RON",
    buildMeta: (row) =>
      buildCardSaleEntryMeta({
        payout,
        row,
        orderId: "o1",
        paymentIntentId: "pi_1",
        chargeId: "ch_1",
        feeTotal: 1.5,
      }),
  });
}

function twoRowAllocation() {
  return buildCardSaleAllocation({
    payout: payoutFor({ itemsNetExVat: 20.1, commissionNet: 2.41 }),
    shipments: [
      { id: "s1", shippingGross: 0, earning: { itemsNet: 10.05, commissionNet: 1.21 } },
      { id: "s2", shippingGross: 0, earning: { itemsNet: 10.05, commissionNet: 1.21 } },
    ],
  });
}

test("B. două shipment-uri -> două SALE, același stripeTransferId, total exact", async () => {
  const db = makeFakeDb();
  const results = await runUpsert(db, twoRowAllocation());

  assert.deepEqual(results.map((r) => r.action), ["created", "created"]);
  assert.equal(db.__entries.length, 2);
  assert.ok(db.__entries.every((e) => e.type === "SALE" && e.stripeTransferId === "tr_1"));
  assert.deepEqual(db.__entries.map((e) => e.shipmentId), ["s1", "s2"]);
  assert.equal(sumCents(db.__entries.map((e) => e.commissionNet)), 241);
});

test("E. retry: a doua rulare actualizează, nu creează (număr rânduri neschimbat)", async () => {
  const db = makeFakeDb();
  await runUpsert(db, twoRowAllocation());
  const results = await runUpsert(db, twoRowAllocation());

  assert.deepEqual(results.map((r) => r.action), ["updated", "updated"]);
  assert.equal(db.__entries.length, 2);
  assert.equal(sumCents(db.__entries.map((e) => e.commissionNet)), 241);
});

test("F. SALE creat înainte de webhook (ensureSaleLedgerEntry) -> webhook-ul îl actualizează, nu duplică", async () => {
  const db = makeFakeDb({
    entries: [
      {
        id: "pre_1",
        vendorId: "v1",
        orderId: "o1",
        shipmentId: "s1",
        type: "SALE",
        payoutId: null,
        stripeTransferId: null,
        itemsNet: 10.05,
        commissionNet: 1.21, // COD-style
        vendorNet: 8.84,
        meta: { source: "shipment_status_fulfilled", vatStatus: null },
      },
    ],
  });

  const results = await runUpsert(db, twoRowAllocation());

  assert.deepEqual(results.map((r) => r.action), ["updated", "created"]);
  assert.equal(db.__entries.length, 2);

  const pre = db.__entries.find((e) => e.id === "pre_1");
  assert.equal(pre.stripeTransferId, "tr_1");
  assert.equal(pre.meta.source, "shipment_status_fulfilled"); // proveniența se păstrează
  assert.equal(pre.meta.paymentIntentId, "pi_1");
  assert.equal(sumCents(db.__entries.map((e) => e.commissionNet)), 241); // total = computeOrderSplits
});

test("F'. cursă: create -> P2002 (ensureSaleLedgerEntry a câștigat) -> update, tot un singur rând", async () => {
  const db = makeFakeDb();
  db.__createFailuresOnce.add("s1");

  const results = await runUpsert(db, twoRowAllocation());

  assert.equal(db.__entries.filter((e) => e.shipmentId === "s1").length, 1);
  assert.equal(results[0].action, "updated");
  assert.equal(db.__entries.find((e) => e.shipmentId === "s1").stripeTransferId, "tr_1");
});

test("rând deja facturat (payoutId) -> primește doar datele Stripe, sumele rămân neschimbate", async () => {
  const db = makeFakeDb({
    entries: [
      {
        id: "inv_1",
        vendorId: "v1",
        orderId: "o1",
        shipmentId: "s1",
        type: "SALE",
        payoutId: "payout_9",
        stripeTransferId: null,
        itemsNet: 10.05,
        commissionNet: 1.21,
        vendorNet: 8.84,
        meta: { source: "shipment_status_fulfilled" },
      },
    ],
  });

  const results = await runUpsert(db, twoRowAllocation());
  const row = db.__entries.find((e) => e.id === "inv_1");

  assert.equal(results[0].action, "updated_stripe_only");
  assert.equal(row.commissionNet, 1.21);
  assert.equal(row.stripeTransferId, "tr_1");
});

/* =========================================================
   computeEarning aruncă -> NU blochează planificarea (=> transferul)
========================================================= */

test("computeEarning aruncă pe TOATE shipment-urile: plan reușește, total exact, fallback marcat, eroarea e logată", async () => {
  const db = makeFakeDb({ shipments: twoShipments() });
  const errorLog = mock.method(console, "error", () => {});

  try {
    const allocation = await planCardSaleEntries({
      db,
      orderId: "o1",
      vendorId: "v1",
      payout: payoutFor({ itemsNetExVat: 20.1, commissionNet: 2.41 }),
      computeEarning: async () => {
        throw new Error("simulated_db_blip");
      },
    });

    assert.deepEqual(allocation.map((r) => r.shipmentId), ["s1", "s2"]);
    assert.equal(sumCents(allocation.map((r) => r.commissionNet)), 241);
    assert.equal(sumCents(allocation.map((r) => r.itemsNet)), 2010);
    assert.ok(allocation.every((r) => r.earningUnavailable === true));
    assert.ok(allocation.every((r) => r.computedCommissionNet === null));

    // logat clar, per shipment, cu contextul necesar debugging-ului
    assert.equal(errorLog.mock.callCount(), 2);
    const [message, context] = errorLog.mock.calls[0].arguments;
    assert.match(message, /computeVendorEarningForShipment a eșuat/);
    assert.match(message, /transferul Stripe NU este blocat/);
    assert.equal(context.orderId, "o1");
    assert.equal(context.vendorId, "v1");
    assert.equal(context.shipmentId, "s1");
    assert.equal(context.error, "simulated_db_blip");
  } finally {
    errorLog.mock.restore();
  }
});

test("computeEarning aruncă doar pe UN shipment: toate cad pe fallback (fără ponderi mixte), total exact", async () => {
  const db = makeFakeDb({ shipments: twoShipments() });
  const errorLog = mock.method(console, "error", () => {});

  try {
    const allocation = await planCardSaleEntries({
      db,
      orderId: "o1",
      vendorId: "v1",
      payout: payoutFor({ itemsNetExVat: 20.1, commissionNet: 2.41 }),
      computeEarning: async ({ shipmentId }) => {
        if (shipmentId === "s2") throw new Error("boom");
        return { itemsNet: 10.05, commissionNet: 1.21 };
      },
    });

    assert.equal(sumCents(allocation.map((r) => r.commissionNet)), 241);
    // NU 2,41 / 0,00 (ponderi mixte) - distribuție egală, ultimul absoarbe reziduul
    assert.deepEqual(allocation.map((r) => r.commissionNet), [1.21, 1.2]);
    assert.ok(allocation.every((r) => r.earningUnavailable === true));
    assert.equal(errorLog.mock.callCount(), 1);
  } finally {
    errorLog.mock.restore();
  }
});

test("fallback pe transport: shipment-urile cu transport diferit se împart proporțional cu transportul", async () => {
  const db = makeFakeDb({
    shipments: [
      { id: "s1", orderId: "o1", vendorId: "v1", direction: "OUTBOUND", price: 30 },
      { id: "s2", orderId: "o1", vendorId: "v1", direction: "OUTBOUND", price: 10 },
    ],
  });
  const errorLog = mock.method(console, "error", () => {});

  try {
    const allocation = await planCardSaleEntries({
      db,
      orderId: "o1",
      vendorId: "v1",
      payout: { ...payoutFor({ itemsNetExVat: 20, commissionNet: 4, shippingGross: 40 }) },
      computeEarning: async () => {
        throw new Error("boom");
      },
    });

    assert.deepEqual(allocation.map((r) => r.commissionNet), [3, 1]);
    assert.equal(sumCents(allocation.map((r) => r.commissionNet)), 400);
  } finally {
    errorLog.mock.restore();
  }
});

test("alte erori NU sunt mascate: eșecul încărcării shipment-urilor se propagă", async () => {
  const db = makeFakeDb({ shipments: twoShipments() });
  db.shipment.findMany = async () => {
    throw new Error("shipments_query_failed");
  };
  const errorLog = mock.method(console, "error", () => {});

  try {
    await assert.rejects(
      planCardSaleEntries({
        db,
        orderId: "o1",
        vendorId: "v1",
        payout: payoutFor({ itemsNetExVat: 20.1, commissionNet: 2.41 }),
        computeEarning: async () => ({ itemsNet: 1, commissionNet: 1 }),
      }),
      /shipments_query_failed/
    );
    assert.equal(errorLog.mock.callCount(), 0, "nimic prins/logat de catch-ul computeEarning");
  } finally {
    errorLog.mock.restore();
  }
});

test("eroare în alocare (nu în computeEarning) se propagă: fără shipment-uri OUTBOUND rămâne eroare", async () => {
  const db = makeFakeDb({ shipments: [] });

  await assert.rejects(
    planCardSaleEntries({
      db,
      orderId: "o1",
      vendorId: "v1",
      payout: payoutFor({ itemsNetExVat: 1, commissionNet: 0 }),
      computeEarning: async () => {
        throw new Error("nu ar trebui apelat");
      },
    }),
    /vendor_outbound_shipments_missing:v1/
  );
});
