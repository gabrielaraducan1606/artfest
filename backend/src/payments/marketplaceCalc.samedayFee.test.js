// Taxa Stripe și transferul cu transport Sameday prin Artfest (marketplaceCalc.js):
//  - fără transport Artfest -> algoritmul existent (valori de referință fixe);
//  - cu transport Artfest -> invariant în cenți: Σ transferuri + reținerea Artfest = încasat - taxa;
//    nicio parte negativă, determinist. Funcții pure, fără DB.
//
// Rulare: node --experimental-test-module-mocks --test src/payments/marketplaceCalc.samedayFee.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../db.js", { namedExports: { prisma: {} } });
const calc = await import("./marketplaceCalc.js");
const { shippingOwnership, canChangeFulfillment, shippingCostEvidence } = await import("../services/shipping/fulfillment.js");

const c = (x) => Math.round(Number(x) * 100);

test("proprietarul transportului: null și VENDOR_COURIER = vendor; ARTFEST_SAMEDAY = Artfest", () => {
  assert.deepEqual(shippingOwnership({ fulfillment: null }, 15), { fulfillment: null, owner: "VENDOR", vendorShippingGross: 15, artfestShippingGross: 0 });
  assert.deepEqual(shippingOwnership({ fulfillment: "VENDOR_COURIER" }, 15).vendorShippingGross, 15);
  assert.deepEqual(shippingOwnership({ fulfillment: "ARTFEST_SAMEDAY" }, 15), { fulfillment: "ARTFEST_SAMEDAY", owner: "ARTFEST", vendorShippingGross: 0, artfestShippingGross: 15 });
  assert.equal(shippingOwnership({ fulfillment: "altceva" }, 15).owner, "VENDOR");
});

test("modul de livrare nu se mai schimbă după plată", () => {
  assert.equal(canChangeFulfillment({ current: null, next: "ARTFEST_SAMEDAY", orderPaid: false }).ok, true);
  assert.equal(canChangeFulfillment({ current: "VENDOR_COURIER", next: "ARTFEST_SAMEDAY", orderPaid: true }).ok, false);
  assert.equal(canChangeFulfillment({ current: "ARTFEST_SAMEDAY", next: "ARTFEST_SAMEDAY", orderPaid: true }).ok, true);
});

test("evidența costurilor: încasat / estimat / raportat la AWB / final separate; awbCost nu e final", () => {
  const e = shippingCostEvidence({ fulfillment: "ARTFEST_SAMEDAY", price: "15.00" }, { carrierCost: "12.40", carrierCostAwbReported: "12.90" });
  assert.deepEqual(e, { owner: "ARTFEST", collectedCents: 1500, estimatedCostCents: 1240, awbReportedCostCents: 1290, finalCostCents: null, finalCostSource: null, isFinal: false });
  const f = shippingCostEvidence({ price: 15 }, { carrierCostFinal: "13.10", carrierCostFinalSource: "SAMEDAY_INVOICE" });
  assert.equal(f.isFinal, true);
  assert.equal(f.finalCostSource, "SAMEDAY_INVOICE");
});

test("fără transport Artfest: valorile de referință ale algoritmului existent (ultimul vendor absoarbe rotunjirea)", () => {
  const vendors = [
    { vendorId: "a", itemsGross: 10, shippingGross: 5 },
    { vendorId: "b", itemsGross: 20.01, shippingGross: 0 },
    { vendorId: "c", itemsGross: 3.33, shippingGross: 1.5 },
  ];
  const fees = calc.allocateStripeFee({ vendors, feeNet: 1.23 }).map((v) => v.stripeFeeAllocated);
  // a: 1.23*15/39.84 = 0.4631 -> 0.46 ; b: 1.23*20.01/39.84 = 0.6178 -> 0.62 ; c: rest 0.15
  assert.deepEqual(fees, [0.46, 0.62, 0.15]);
  const payouts = calc.computeVendorPayouts({ vendors: calc.allocateStripeFee({ vendors, feeNet: 1.23 }) }).map((p) => p.vendorPayoutNet);
  assert.deepEqual(payouts, [14.54, 19.39, 4.68]);
  assert.deepEqual(calc.summarizeArtfestShipping({ vendors, feeNet: 1.23 }), { artfestShippingGross: 0, artfestStripeFee: 0, artfestRetainedNet: 0 });
});

test("cu transport Artfest: invariant în cenți, Artfest suportă taxa pe transportul lui", () => {
  const vendors = [{ vendorId: "a", itemsGross: 20.1, shippingGross: 0, artfestShippingGross: 15 }];
  const withFee = calc.allocateStripeFee({ vendors, feeNet: 1.5 });
  // vendor 2010/3510*150 = 85.89 -> 86 ; Artfest 64
  assert.equal(withFee[0].stripeFeeAllocated, 0.86);
  const art = calc.summarizeArtfestShipping({ vendors: withFee, feeNet: 1.5 });
  assert.deepEqual(art, { artfestShippingGross: 15, artfestStripeFee: 0.64, artfestRetainedNet: 14.36 });
  const payout = calc.computeVendorPayouts({ vendors: withFee })[0];
  assert.equal(payout.vendorPayoutNet, 19.24);
  assert.equal(c(payout.vendorPayoutNet) + c(art.artfestRetainedNet), 3510 - 150);
});

test("fuzz determinist: 5000 comenzi - invariant exact, nicio parte negativă", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const money = (max) => Math.round(rnd() * max * 100) / 100;
  for (let t = 0; t < 5000; t += 1) {
    const vendors = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({
      vendorId: `v${i}`,
      itemsGross: money(900) || 0.01,
      shippingGross: rnd() < 0.3 ? 0 : money(60),
      ...(rnd() < 0.5 ? { artfestShippingGross: money(40) || 0.01 } : {}),
    }));
    const total = vendors.reduce((s, v) => s + c(v.itemsGross) + c(v.shippingGross) + c(v.artfestShippingGross || 0), 0);
    const fee = Math.min(c(money(25)), total) / 100;
    const withFee = calc.allocateStripeFee({ vendors, feeNet: fee });
    const payouts = calc.computeVendorPayouts({ vendors: withFee });
    const art = calc.summarizeArtfestShipping({ vendors: withFee, feeNet: fee });
    assert.ok(withFee.every((v) => v.stripeFeeAllocated >= 0));
    assert.ok(art.artfestStripeFee >= 0 && art.artfestRetainedNet >= 0);
    if (payouts.every((p) => c(p.gross) >= c(p.stripeFeeAllocated))) {
      assert.equal(payouts.reduce((s, p) => s + c(p.vendorPayoutNet), 0) + c(art.artfestRetainedNet), total - c(fee));
    }
  }
});
