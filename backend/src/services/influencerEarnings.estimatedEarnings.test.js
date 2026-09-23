// src/services/influencerEarnings.estimatedEarnings.test.js
//
// Echivalență VECHI vs NOU pentru getInfluencerEstimatedEarnings()
// (audit performanță 2026-09-23, fix N+1). Teste PURE - `db`,
// `computeEarning`, `getPlan` sunt fake-uri injectate, fără DB real.
//
// `referenceSerialEstimatedEarnings` de mai jos e o RECONSTRUCȚIE
// FIDELĂ a implementării VECHI (bucla `for...await` serială, un
// query "billing"/"plan" simulat per shipment prin fake-uri proprii,
// fără batch/cache) - păstrată STRICT pentru comparație, nu e
// folosită în producție.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getInfluencerEstimatedEarnings,
  mapWithConcurrency,
} from "./influencerEarnings.js";

/* =========================================================
   Fixtures / fake-uri
========================================================= */

function makeShipment(id, vendorId, bps) {
  return { id, vendorId, influencerCommissionBpsSnapshot: bps };
}

/**
 * Fake `computeEarning` determinist: commissionNet = randul din
 * `commissionNetByShipmentId` (Map). Aruncă pentru shipment-urile din
 * `failingShipmentIds` (simulează "shipment fără iteme" din comentariul
 * codului vechi - trebuie sărit, nu trebuie să blocheze restul).
 * Numără apelurile totale + apelurile per shipmentId (pentru
 * verificarea "o singură dată per shipment", nu duplicat).
 */
function makeFakeComputeEarning({
  commissionNetByShipmentId,
  failingShipmentIds = new Set(),
  delayMs = 0,
} = {}) {
  const callsByShipmentId = new Map();
  let totalCalls = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  async function computeEarning({ shipmentId }) {
    totalCalls++;
    callsByShipmentId.set(
      shipmentId,
      (callsByShipmentId.get(shipmentId) || 0) + 1
    );

    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);

    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    inFlight--;

    if (failingShipmentIds.has(shipmentId)) {
      throw new Error("simulated_failure_no_items");
    }

    const commissionNet = commissionNetByShipmentId.get(shipmentId) ?? 0;
    return { commissionNet };
  }

  computeEarning.stats = () => ({
    totalCalls,
    callsByShipmentId,
    maxInFlight,
  });

  return computeEarning;
}

/**
 * Fake `getPlan` determinist, cu numărare de apeluri per vendorId -
 * folosit ca să verificăm explicit că e chemat O SINGURĂ DATĂ per
 * vendor unic (punctul 2 - cache local), indiferent de câte
 * shipment-uri are acel vendor.
 */
function makeFakeGetPlan(planByVendorId = new Map()) {
  const callsByVendorId = new Map();

  async function getPlan(vendorId) {
    callsByVendorId.set(vendorId, (callsByVendorId.get(vendorId) || 0) + 1);
    return planByVendorId.get(vendorId) || { code: "basic", commissionBps: 0 };
  }

  getPlan.stats = () => ({ callsByVendorId });

  return getPlan;
}

/**
 * Fake `db` - doar cele 2 metode folosite de
 * getInfluencerEstimatedEarnings. `vendorBilling.findMany` numără
 * apelurile (punctul 3 - trebuie exact 1 per rulare, nu N).
 */
function makeFakeDb({ shipments, billingRowsByVendorId = new Map() }) {
  let vendorBillingFindManyCalls = 0;

  return {
    shipment: {
      findMany: async () => shipments,
    },
    vendorBilling: {
      findMany: async ({ where }) => {
        vendorBillingFindManyCalls++;
        const ids = where?.vendorId?.in || [];
        return ids
          .filter((id) => billingRowsByVendorId.has(id))
          .map((id) => billingRowsByVendorId.get(id));
      },
    },
    stats: () => ({ vendorBillingFindManyCalls }),
  };
}

/* =========================================================
   Referință VECHE (reconstrucție fidelă a codului dinainte de fix) -
   PĂSTRATĂ STRICT pentru comparație în aceste teste.
========================================================= */

async function referenceSerialEstimatedEarnings({
  shipments,
  computeEarning,
  getPlan,
  billingRowsByVendorId,
}) {
  let estimatedEarningsAmount = 0;

  for (const shipment of shipments) {
    const commissionBpsSnapshot = Number(
      shipment.influencerCommissionBpsSnapshot || 0
    );

    if (!commissionBpsSnapshot) continue;

    try {
      // Comportamentul VECHI: un query "billing" + un query "plan"
      // per shipment (fără batch/cache) - simulate aici direct din
      // fixture, echivalent cu findUnique-urile reale de dinainte.
      const billing = billingRowsByVendorId.get(shipment.vendorId) ?? null;
      const plan = await getPlan(shipment.vendorId);

      const earning = await computeEarning({
        vendorId: shipment.vendorId,
        shipmentId: shipment.id,
        billing,
        plan,
      });

      estimatedEarningsAmount +=
        (Number(earning.commissionNet || 0) * commissionBpsSnapshot) / 10000;
    } catch {
      // identic codului vechi - sărim, nu blocăm restul
    }
  }

  return Math.round(estimatedEarningsAmount * 100) / 100;
}

/* =========================================================
   Rulează AMBELE implementări pe același scenariu și compară
========================================================= */

async function runBoth(scenario) {
  const {
    shipments,
    commissionNetByShipmentId,
    failingShipmentIds,
    billingRowsByVendorId = new Map(),
    planByVendorId = new Map(),
  } = scenario;

  // --- referință (veche, serială) ---
  const refComputeEarning = makeFakeComputeEarning({
    commissionNetByShipmentId,
    failingShipmentIds,
  });
  const refGetPlan = makeFakeGetPlan(planByVendorId);

  const expected = await referenceSerialEstimatedEarnings({
    shipments,
    computeEarning: refComputeEarning,
    getPlan: refGetPlan,
    billingRowsByVendorId,
  });

  // --- implementarea NOUĂ (optimizată) ---
  const newComputeEarning = makeFakeComputeEarning({
    commissionNetByShipmentId,
    failingShipmentIds,
  });
  const newGetPlan = makeFakeGetPlan(planByVendorId);
  const db = makeFakeDb({ shipments, billingRowsByVendorId });

  const actual = await getInfluencerEstimatedEarnings("inf-1", {
    db,
    computeEarning: newComputeEarning,
    getPlan: newGetPlan,
    concurrency: 6,
  });

  return {
    expected,
    actual,
    newComputeEarningStats: newComputeEarning.stats(),
    newGetPlanStats: newGetPlan.stats(),
    dbStats: db.stats(),
  };
}

/* =========================================================
   A. 1 shipment
========================================================= */
test("A. 1 shipment: rezultat identic vechi vs nou", async () => {
  const shipments = [makeShipment("s1", "v1", 2000)];
  const { expected, actual } = await runBoth({
    shipments,
    commissionNetByShipmentId: new Map([["s1", 100]]),
  });

  assert.equal(actual, expected);
  assert.equal(actual, 20); // 100 * 2000/10000 = 20
});

/* =========================================================
   B. 10 shipment-uri, vendori diferiți
========================================================= */
test("B. 10 shipment-uri, vendori diferiți: rezultat identic vechi vs nou", async () => {
  const shipments = Array.from({ length: 10 }, (_, i) =>
    makeShipment(`s${i}`, `v${i}`, 1500 + i * 10)
  );
  const commissionNetByShipmentId = new Map(
    shipments.map((s, i) => [s.id, 50 + i * 3.37])
  );

  const { expected, actual } = await runBoth({
    shipments,
    commissionNetByShipmentId,
  });

  assert.equal(actual, expected);
});

/* =========================================================
   C. 32 shipment-uri (exact scenariul măsurat în audit)
========================================================= */
test("C. 32 shipment-uri, vendori variați: rezultat identic vechi vs nou", async () => {
  const shipments = Array.from({ length: 32 }, (_, i) =>
    makeShipment(`s${i}`, `v${i % 7}`, 1000 + (i % 5) * 200)
  );
  const commissionNetByShipmentId = new Map(
    shipments.map((s, i) => [s.id, (i + 1) * 12.5])
  );

  const { expected, actual, newComputeEarningStats } = await runBoth({
    shipments,
    commissionNetByShipmentId,
  });

  assert.equal(actual, expected);
  // fiecare shipment tot trebuie calculat o dată (niciun duplicat/omis)
  assert.equal(newComputeEarningStats.totalCalls, 32);
});

/* =========================================================
   D. Mai multe shipment-uri de la ACELAȘI vendor - verifică
   explicit că planul e citit O SINGURĂ DATĂ (punctul 2)
========================================================= */
test("D. 8 shipment-uri, același vendor: getPlan chemat o singură dată, rezultat identic", async () => {
  const shipments = Array.from({ length: 8 }, (_, i) =>
    makeShipment(`s${i}`, "vendor-solo", 2500)
  );
  const commissionNetByShipmentId = new Map(
    shipments.map((s, i) => [s.id, 40 + i])
  );

  const { expected, actual, newGetPlanStats } = await runBoth({
    shipments,
    commissionNetByShipmentId,
  });

  assert.equal(actual, expected);
  assert.equal(newGetPlanStats.callsByVendorId.get("vendor-solo"), 1);
  assert.equal(newGetPlanStats.callsByVendorId.size, 1);
});

/* =========================================================
   E. Mai mulți vendori - verifică billing batch (punctul 3):
   findMany chemat o singură dată, indiferent de nr. de shipment-uri
========================================================= */
test("E. 12 shipment-uri, 4 vendori: vendorBilling.findMany chemat o singură dată, rezultat identic", async () => {
  const vendorIds = ["va", "vb", "vc", "vd"];
  const shipments = Array.from({ length: 12 }, (_, i) =>
    makeShipment(`s${i}`, vendorIds[i % vendorIds.length], 1800)
  );
  const commissionNetByShipmentId = new Map(
    shipments.map((s, i) => [s.id, 20 + i * 1.11])
  );

  const billingRowsByVendorId = new Map(
    vendorIds.map((v) => [v, { vendorId: v, vatStatus: "payer", vatRate: 19 }])
  );

  const { expected, actual, newGetPlanStats, dbStats } = await runBoth({
    shipments,
    commissionNetByShipmentId,
    billingRowsByVendorId,
  });

  assert.equal(actual, expected);
  assert.equal(dbStats.vendorBillingFindManyCalls, 1);
  assert.equal(newGetPlanStats.callsByVendorId.size, 4); // o dată per vendor unic
});

/* =========================================================
   F. Vendor cu plan diferit (comision diferit) - verifică
   propagarea corectă a planului specific fiecărui vendor
========================================================= */
test("F. vendori cu planuri/comisioane diferite: rezultat identic vechi vs nou", async () => {
  const shipments = [
    makeShipment("s1", "v-basic", 500),
    makeShipment("s2", "v-premium", 500),
    makeShipment("s3", "v-premium", 500),
  ];

  const planByVendorId = new Map([
    ["v-basic", { code: "basic", commissionBps: 1000 }],
    ["v-premium", { code: "premium", commissionBps: 500 }],
  ]);

  const commissionNetByShipmentId = new Map([
    ["s1", 200],
    ["s2", 300],
    ["s3", 150],
  ]);

  const { expected, actual } = await runBoth({
    shipments,
    commissionNetByShipmentId,
    planByVendorId,
  });

  assert.equal(actual, expected);
});

/* =========================================================
   G. Shipment-uri FĂRĂ billing (vendor fără rând VendorBilling) -
   billingByVendorId.get() -> undefined -> trebuie mapat la `null`,
   identic cu ce ar fi întors findUnique() în codul vechi
========================================================= */
test("G. vendor fără VendorBilling: billing=null propagat identic, rezultat identic", async () => {
  const shipments = [makeShipment("s1", "vendor-no-billing", 2000)];
  const commissionNetByShipmentId = new Map([["s1", 500]]);

  const { expected, actual } = await runBoth({
    shipments,
    commissionNetByShipmentId,
    billingRowsByVendorId: new Map(), // gol - niciun rând
  });

  assert.equal(actual, expected);
});

/* =========================================================
   H. Valori edge: bps=0 (sărit, ca în codul vechi), shipment care
   aruncă (fără iteme), commissionNet=0, sume fracționare
========================================================= */
test("H. edge: bps=0 sărit, shipment care aruncă sărit fără să blocheze restul, rezultat identic", async () => {
  const shipments = [
    makeShipment("s1", "v1", 0), // bps 0 -> sărit (continue, ca în codul vechi)
    makeShipment("s2", "v1", 1234),
    makeShipment("s3", "v2", 1234), // acesta va arunca (fără iteme)
    makeShipment("s4", "v2", 1234),
  ];

  const commissionNetByShipmentId = new Map([
    ["s2", 33.33],
    ["s4", 0], // commissionNet 0 - contribuție 0, dar NU eroare
  ]);

  const failingShipmentIds = new Set(["s3"]);

  const { expected, actual, newComputeEarningStats } = await runBoth({
    shipments,
    commissionNetByShipmentId,
    failingShipmentIds,
  });

  assert.equal(actual, expected);
  // s1 (bps=0) nu ajunge NICIODATĂ la computeEarning (filtrat înainte,
  // identic cu `continue` din codul vechi)
  assert.equal(newComputeEarningStats.callsByShipmentId.has("s1"), false);
  // s3 (aruncă) tot a fost ÎNCERCAT o dată
  assert.equal(newComputeEarningStats.callsByShipmentId.get("s3"), 1);
});

/* =========================================================
   I. Listă goală / fără shipment-uri eligibile -> 0, fără nicio
   interogare de billing/plan (short-circuit)
========================================================= */
test("I. fără shipment-uri pending: rezultat 0, fără query-uri suplimentare", async () => {
  const db = makeFakeDb({ shipments: [], billingRowsByVendorId: new Map() });
  const computeEarning = makeFakeComputeEarning({
    commissionNetByShipmentId: new Map(),
  });
  const getPlan = makeFakeGetPlan();

  const actual = await getInfluencerEstimatedEarnings("inf-1", {
    db,
    computeEarning,
    getPlan,
  });

  assert.equal(actual, 0);
  assert.equal(computeEarning.stats().totalCalls, 0);
  assert.equal(db.stats().vendorBillingFindManyCalls, 0);
});

test("I bis. toate shipment-urile au bps=0: rezultat 0, fără billing/plan interogate", async () => {
  const shipments = [makeShipment("s1", "v1", 0), makeShipment("s2", "v2", 0)];
  const db = makeFakeDb({ shipments, billingRowsByVendorId: new Map() });
  const computeEarning = makeFakeComputeEarning({
    commissionNetByShipmentId: new Map(),
  });
  const getPlan = makeFakeGetPlan();

  const actual = await getInfluencerEstimatedEarnings("inf-1", {
    db,
    computeEarning,
    getPlan,
  });

  assert.equal(actual, 0);
  assert.equal(computeEarning.stats().totalCalls, 0);
  assert.equal(db.stats().vendorBillingFindManyCalls, 0);
});

/* =========================================================
   CONCURENȚĂ LIMITATĂ (punctul 1) - mapWithConcurrency
========================================================= */

test("mapWithConcurrency: nu depășește NICIODATĂ limita, indiferent de câte items sunt", async () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  let inFlight = 0;
  let maxInFlight = 0;

  const results = await mapWithConcurrency(items, 6, async (item) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return item * 2;
  });

  assert.ok(maxInFlight <= 6, `maxInFlight=${maxInFlight} ar trebui <= 6`);
  assert.deepEqual(results, items.map((i) => i * 2));
});

test("mapWithConcurrency: limita mai mare decât nr. de items -> rulează tot, fără eroare", async () => {
  const items = [1, 2, 3];
  const results = await mapWithConcurrency(items, 10, async (i) => i + 1);
  assert.deepEqual(results, [2, 3, 4]);
});

test("mapWithConcurrency: listă goală -> []", async () => {
  const results = await mapWithConcurrency([], 6, async (i) => i);
  assert.deepEqual(results, []);
});

test("getInfluencerEstimatedEarnings: concurența REALĂ folosită de bucla de 32 shipment-uri nu depășește limita", async () => {
  const shipments = Array.from({ length: 32 }, (_, i) =>
    makeShipment(`s${i}`, `v${i % 5}`, 2000)
  );
  const commissionNetByShipmentId = new Map(
    shipments.map((s) => [s.id, 10])
  );

  const computeEarning = makeFakeComputeEarning({
    commissionNetByShipmentId,
    delayMs: 3,
  });
  const getPlan = makeFakeGetPlan();
  const db = makeFakeDb({ shipments, billingRowsByVendorId: new Map() });

  await getInfluencerEstimatedEarnings("inf-1", {
    db,
    computeEarning,
    getPlan,
    concurrency: 6,
  });

  const { maxInFlight, totalCalls } = computeEarning.stats();
  assert.equal(totalCalls, 32);
  assert.ok(maxInFlight <= 6, `maxInFlight=${maxInFlight} ar trebui <= 6`);
  assert.ok(maxInFlight > 1, "ar trebui să ruleze totuși în paralel, nu serial");
});
