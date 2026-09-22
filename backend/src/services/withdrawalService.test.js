// src/services/withdrawalService.test.js
//
// Teste deterministe pentru funcția online de retragere (WithdrawalRequest
// existent, fără schimbări de schemă). FĂRĂ DB real, FĂRĂ email real.
//
// Rulare: node --experimental-test-module-mocks --test src/services/withdrawalService.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

let created;
let updates;
let existingForTx;
let sentToClient;
let sentToVendors;
let vendorNotifications;
let mailBehavior;
let lastFindFirstWhere;

const fakeDb = {
  order: {
    findFirst: async ({ where }) => {
      lastFindFirstWhere = where;
      return { id: "order-1" };
    },
  },
  withdrawalRequest: {
    update: async ({ where, data }) => {
      updates.push({ where, data });
      return {};
    },
  },
  $transaction: async (fn) =>
    fn({
      withdrawalRequest: {
        findMany: async () => existingForTx,
        create: async ({ data }) => {
          const row = { id: "wd-1", status: "SUBMITTED", ...data };
          created.push(row);
          return row;
        },
      },
    }),
};

let svc;
let restoreAll;

before(async () => {
  const mocks = [
    mock.module("../db.js", { namedExports: { prisma: fakeDb } }),
    mock.module("./notifications.js", {
      namedExports: {
        createVendorNotification: async (vendorId, data) => {
          vendorNotifications.push({ vendorId, data });
          return {};
        },
      },
    }),
    mock.module("../lib/mailer.js", {
      namedExports: {
        sendWithdrawalConfirmationEmail: async (args) => {
          if (mailBehavior.confirmation === "throw") {
            throw new Error("smtp_down");
          }
          sentToClient.push(args);
        },
        sendWithdrawalForwardedToVendorEmail: async (args) => {
          sentToVendors.push(args);
        },
      },
    }),
  ];

  restoreAll = () => mocks.forEach((m) => m.restore());
  svc = await import("./withdrawalService.js");
});

after(() => restoreAll?.());

beforeEach(() => {
  created = [];
  updates = [];
  existingForTx = [];
  sentToClient = [];
  sentToVendors = [];
  vendorNotifications = [];
  mailBehavior = { confirmation: "ok" };
  lastFindFirstWhere = null;
});

function makeOrder({ traderB = "PROFESSIONAL", customerType = "PF", status = "PAID", withdrawalRequests = [] } = {}) {
  return {
    id: "order-1",
    orderNumber: "AF-1001",
    status,
    customerType,
    customerName: "Ana Popescu",
    customerEmail: "ana@example.com",
    shippingAddress: {},
    shipments: [
      {
        id: "ship-A",
        vendorId: "vendor-A",
        status: "DELIVERED",
        direction: "OUTBOUND",
        deliveredAt: new Date(),
        vendor: {
          id: "vendor-A",
          displayName: "Atelier A",
          email: "a@example.com",
          user: { email: "a-user@example.com" },
          billing: { traderStatus: "PROFESSIONAL" },
        },
        items: [{ title: "Lumânare", qty: 2 }],
      },
      {
        id: "ship-B",
        vendorId: "vendor-B",
        status: "PENDING",
        direction: "OUTBOUND",
        deliveredAt: null,
        vendor: {
          id: "vendor-B",
          displayName: "Atelier B",
          email: null,
          user: { email: "b-user@example.com" },
          billing: { traderStatus: traderB },
        },
        items: [{ title: "Ceramică", qty: 1 }],
      },
    ],
    withdrawalRequests,
  };
}

const base = {
  clientName: "Ana Popescu",
  contactEmail: "Ana@Example.com",
  shipmentIds: [],
  confirmed: true,
  ip: "1.2.3.4",
  userAgent: "test-agent",
};

test("întreaga comandă: salvată cu shipmentIds gol, confirmare trimisă, ambii vendori notificați", async () => {
  const result = await svc.submitWithdrawal({ order: makeOrder(), ...base, userId: "user-1" });

  assert.equal(created.length, 1);
  assert.deepEqual(created[0].shipmentIds, []);
  assert.equal(created[0].contactEmail, "ana@example.com");
  assert.equal(created[0].userId, "user-1");
  assert.equal(created[0].ip, "1.2.3.4");
  assert.match(created[0].declarationText, /Comanda #AF-1001, pentru întreaga Comandă/);
  assert.match(created[0].declarationText, /ana@example\.com/);

  assert.equal(sentToClient.length, 1);
  assert.equal(result.confirmationSent, true);
  assert.equal(vendorNotifications.length, 2);
  assert.equal(sentToVendors.length, 2);
  assert.equal(result.forwardedToVendor, true);
  assert.equal(result.status, "FORWARDED_TO_VENDOR");

  const forward = updates.find((u) => u.data.status === "FORWARDED_TO_VENDOR");
  assert.deepEqual(forward.data.notifiedVendorIds.sort(), ["vendor-A", "vendor-B"]);
  assert.ok(updates.some((u) => u.data.confirmationSentAt instanceof Date));
});

test("retragere parțială: doar livrarea aleasă, doar acel vendor notificat", async () => {
  const result = await svc.submitWithdrawal({
    order: makeOrder(),
    ...base,
    shipmentIds: ["ship-A"],
  });

  assert.deepEqual(created[0].shipmentIds, ["ship-A"]);
  assert.match(created[0].declarationText, /numai pentru: Atelier A \(Lumânare x2\)/);
  assert.equal(vendorNotifications.length, 1);
  assert.equal(vendorNotifications[0].vendorId, "vendor-A");
  assert.deepEqual(result.shipmentIds, ["ship-A"]);
});

test("guest: userId rămâne null", async () => {
  await svc.submitWithdrawal({ order: makeOrder(), ...base, userId: null });
  assert.equal(created[0].userId, null);
});

test("a doua declarație pe aceleași livrări e refuzată (already_submitted), fără duplicat", async () => {
  existingForTx = [{ shipmentIds: [] }];

  await assert.rejects(
    svc.submitWithdrawal({ order: makeOrder(), ...base }),
    (error) => error.status === 409 && error.code === "already_submitted"
  );
  assert.equal(created.length, 0);
});

test("eligibilitate: livrare deja acoperită de o declarație existentă nu mai e eligibilă", () => {
  const order = makeOrder({
    withdrawalRequests: [{ id: "wd-0", shipmentIds: ["ship-A"], status: "SUBMITTED", submittedAt: new Date() }],
  });
  const { shipments, eligible } = svc.evaluateWithdrawalEligibility(order);

  assert.equal(shipments.find((s) => s.id === "ship-A").reason, "already_submitted");
  assert.equal(shipments.find((s) => s.id === "ship-B").eligible, true);
  assert.equal(eligible, true);
});

test("vânzător NON_PROFESSIONAL: exclus din implicit; cerut explicit -> 409 non_professional_seller", async () => {
  const order = makeOrder({ traderB: "NON_PROFESSIONAL" });

  await svc.submitWithdrawal({ order, ...base });
  // implicit: doar ship-A (nu întreaga comandă, deci listă explicită)
  assert.deepEqual(created[0].shipmentIds, ["ship-A"]);
  assert.equal(vendorNotifications.length, 1);

  await assert.rejects(
    svc.submitWithdrawal({ order, ...base, shipmentIds: ["ship-B"] }),
    (error) => error.status === 409 && error.code === "non_professional_seller"
  );
});

test("traderStatus necunoscut (NULL) se tratează ca aplicabil", () => {
  const order = makeOrder({ traderB: null });
  const { shipments } = svc.evaluateWithdrawalEligibility(order);
  assert.equal(shipments.find((s) => s.id === "ship-B").eligible, true);
});

test("client persoană juridică -> not_consumer", async () => {
  await assert.rejects(
    svc.submitWithdrawal({ order: makeOrder({ customerType: "PJ" }), ...base }),
    (error) => error.status === 409 && error.code === "not_consumer"
  );
  assert.equal(created.length, 0);
});

test("comandă anulată -> order_cancelled", async () => {
  await assert.rejects(
    svc.submitWithdrawal({ order: makeOrder({ status: "CANCELLED" }), ...base }),
    (error) => error.code === "order_cancelled"
  );
});

test("fără pasul de confirmare (confirmed != true) -> 400, nimic salvat", async () => {
  await assert.rejects(
    svc.submitWithdrawal({ order: makeOrder(), ...base, confirmed: false }),
    (error) => error.status === 400 && error.code === "confirmation_required"
  );
  assert.equal(created.length, 0);
});

test("e-mail/nume invalide -> 400", async () => {
  await assert.rejects(
    svc.submitWithdrawal({ order: makeOrder(), ...base, contactEmail: "nu-e-email" }),
    (error) => error.code === "contact_email_invalid"
  );
  await assert.rejects(
    svc.submitWithdrawal({ order: makeOrder(), ...base, clientName: " " }),
    (error) => error.code === "client_name_invalid"
  );
});

test("livrare străină comenzii -> 400 shipment_not_in_order", async () => {
  await assert.rejects(
    svc.submitWithdrawal({ order: makeOrder(), ...base, shipmentIds: ["ship-X"] }),
    (error) => error.status === 400 && error.code === "shipment_not_in_order"
  );
});

test("eșec email de confirmare: declarația rămâne salvată, confirmationSent=false, confirmationSentAt nesetat", async () => {
  mailBehavior.confirmation = "throw";

  const result = await svc.submitWithdrawal({ order: makeOrder(), ...base });

  assert.equal(created.length, 1);
  assert.equal(result.confirmationSent, false);
  assert.equal(
    updates.some((u) => "confirmationSentAt" in u.data),
    false
  );
  // vendorii tot sunt notificați
  assert.equal(result.forwardedToVendor, true);
});

test("guest: tokenul e căutat prin hash sha256 (guestAccessTokenHash), nu în clar", async () => {
  await svc.findGuestOrderForWithdrawal({ reference: "order-1", token: "abc123" });

  assert.equal(lastFindFirstWhere.isGuestOrder, true);
  assert.equal(lastFindFirstWhere.userId, null);
  assert.equal(lastFindFirstWhere.guestAccessTokenHash, svc.hashGuestToken("abc123"));
  assert.notEqual(lastFindFirstWhere.guestAccessTokenHash, "abc123");
  assert.equal(svc.hashGuestToken("abc123").length, 64);

  lastFindFirstWhere = null;
  assert.equal(await svc.findGuestOrderForWithdrawal({ reference: "order-1", token: "" }), null);
  assert.equal(lastFindFirstWhere, null, "fără token nu se interoghează DB");
});

test("payload de status: prefill din comandă + declarații existente", () => {
  const payload = svc.buildWithdrawalStatusPayload(
    makeOrder({
      withdrawalRequests: [{ id: "wd-0", shipmentIds: [], status: "SUBMITTED", submittedAt: new Date() }],
    })
  );

  assert.equal(payload.prefill.clientName, "Ana Popescu");
  assert.equal(payload.prefill.contactEmail, "ana@example.com");
  assert.equal(payload.eligible, false);
  assert.equal(payload.existing.length, 1);
  assert.equal(payload.periodDays, 14);
});
