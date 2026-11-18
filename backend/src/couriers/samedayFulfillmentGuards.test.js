// Etapa 3 - protecțiile operaționale pentru „Sameday prin Artfest” (Shipment.fulfillment):
//  - AWB: DOAR după plata online confirmată; comenzile vechi (null) și curierul
//    magazinului nu primesc blocajul nou;
//  - expediere manuală (alt curier) refuzată pentru ARTFEST_SAMEDAY, permisă în rest.
// DB simulată, fără rețea: contul Artfest lipsește, deci niciun apel la curier.
//
// Rulare: node --experimental-test-module-mocks --test src/couriers/samedayFulfillmentGuards.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../db.js", { namedExports: { prisma: {} } });
const { buildAwbPlan } = await import("./awb/awbService.js");
const { assertManualShipmentAllowed } = await import("./manualShipment.js");

const ORDER = {
  id: "o1",
  orderNumber: "AF-1",
  status: "PENDING",
  currency: "RON",
  userId: "u1",
  isGuestOrder: false,
  stripeCheckoutSessionId: "cs_1",
  stripePaymentIntentId: "pi_1",
  shippingAddress: { name: "Ana Pop", phone: "0722000000", county: "Cluj", city: "Cluj-Napoca", street: "Str. Test 1", postalCode: "400000" },
  contactPerson: null,
  customerName: "Ana Pop",
  customerPhone: "0722000000",
  customerEmail: "ana@t.ro",
};

function shipment({ fulfillment = undefined, paymentMethod = "CARD", paidAt = new Date() } = {}) {
  return {
    id: "sh1",
    orderId: "o1",
    vendorId: "v1",
    direction: "OUTBOUND",
    status: "PENDING",
    method: "COURIER",
    price: "18.90",
    awb: null,
    manualShipment: null,
    depositStatus: null,
    recipientOverride: null,
    ...(fulfillment !== undefined ? { fulfillment } : {}),
    order: { ...ORDER, paymentMethod, paidAt },
    items: [{ price: "100.00", qty: 1 }],
    delivery: null,
    returnRequest: null,
  };
}

// DB: doar expedierea; tot restul lipsește (fără cont Artfest -> fără apel la curier)
function dbFor(sh) {
  return new Proxy(
    {},
    {
      get(_t, model) {
        if (model === "then") return undefined;
        if (model === "shipment") return { findFirst: async () => sh, findUnique: async () => sh };
        return new Proxy({}, { get: (_m, op) => async () => (op === "findMany" ? [] : op === "count" ? 0 : null) });
      },
    }
  );
}
const blockerCodes = async (sh) => (await buildAwbPlan({ vendorId: "v1", shipmentId: "sh1" }, dbFor(sh))).preview.blockers.map((b) => b.code);

test("AWB Sameday prin Artfest: blocat până la plata online confirmată", async () => {
  assert.ok((await blockerCodes(shipment({ fulfillment: "ARTFEST_SAMEDAY", paidAt: null }))).includes("sameday_payment_required"));
  assert.ok((await blockerCodes(shipment({ fulfillment: "ARTFEST_SAMEDAY", paymentMethod: "COD", paidAt: null }))).includes("sameday_payment_required"));
  assert.ok(!(await blockerCodes(shipment({ fulfillment: "ARTFEST_SAMEDAY" }))).includes("sameday_payment_required"));
});

test("AWB comenzi vechi (fulfillment null / lipsă) și curierul magazinului: fără blocajul nou (ramburs neplătit, ca înainte)", async () => {
  for (const fulfillment of [undefined, null, "VENDOR_COURIER"]) {
    const codes = await blockerCodes(shipment({ fulfillment, paymentMethod: "COD", paidAt: null }));
    assert.ok(!codes.includes("sameday_payment_required"), String(fulfillment));
  }
});

test("expediere manuală cu alt curier: refuzată pentru Sameday prin Artfest, permisă pentru curierul magazinului / comenzi vechi", async () => {
  const db = { courierAwb: { findUnique: async () => null } };
  await assert.rejects(assertManualShipmentAllowed(db, shipment({ fulfillment: "ARTFEST_SAMEDAY" })), (e) => e.code === "sameday_artfest_delivery" && e.httpStatus === 409);
  await assert.doesNotReject(assertManualShipmentAllowed(db, shipment({ fulfillment: "VENDOR_COURIER", paymentMethod: "COD", paidAt: null })));
  await assert.doesNotReject(assertManualShipmentAllowed(db, shipment({ paymentMethod: "COD", paidAt: null })));
});
