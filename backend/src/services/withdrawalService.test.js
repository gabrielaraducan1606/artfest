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

/* =========================================================
   PRODUSE PERSONALIZATE - hasCustomItems (audit 2026-09-23,
   punctul 3) - informativ, NU blocant: eligible NU se schimbă.
========================================================= */

function makeOrderWithItems(itemsA, itemsB = [{ title: "Ceramică", qty: 1 }]) {
  const order = makeOrder();
  order.shipments[0].items = itemsA;
  order.shipments[1].items = itemsB;
  return order;
}

test("E. produs cu customAnswers completate -> hasCustomItems=true, eligible neschimbat", () => {
  const order = makeOrderWithItems([
    { title: "Invitație", qty: 1, customAnswers: { text: "Ana & Radu" } },
  ]);

  const { shipments } = svc.evaluateWithdrawalEligibility(order);
  const shipA = shipments.find((s) => s.id === "ship-A");

  assert.equal(shipA.hasCustomItems, true);
  assert.equal(shipA.eligible, true); // NU blocat
});

test("E bis. produs cu selectedOptions completate -> hasCustomItems=true", () => {
  const order = makeOrderWithItems([
    { title: "Tricou", qty: 1, selectedOptions: { size: "M" } },
  ]);

  const { shipments } = svc.evaluateWithdrawalEligibility(order);
  assert.equal(
    shipments.find((s) => s.id === "ship-A").hasCustomItems,
    true
  );
});

test("E ter. configurationKey non-default -> hasCustomItems=true", () => {
  const order = makeOrderWithItems([
    { title: "Vază", qty: 1, configurationKey: "gravat" },
  ]);

  assert.equal(
    svc
      .evaluateWithdrawalEligibility(order)
      .shipments.find((s) => s.id === "ship-A").hasCustomItems,
    true
  );
});

test("produs standard, fără date de personalizare -> hasCustomItems=false", () => {
  const order = makeOrderWithItems([
    { title: "Lumânare", qty: 2, customAnswers: {}, selectedOptions: {} },
  ]);

  assert.equal(
    svc
      .evaluateWithdrawalEligibility(order)
      .shipments.find((s) => s.id === "ship-A").hasCustomItems,
    false
  );
});

test("payload agregat: hasCustomItems=true dacă ORICE shipment eligibil are produse personalizate", () => {
  const order = makeOrderWithItems([
    { title: "Invitație", qty: 1, customAnswers: { text: "x" } },
  ]);

  const payload = svc.buildWithdrawalStatusPayload(order);
  assert.equal(payload.hasCustomItems, true);
});

/* =========================================================
   VENDOR - vizibilitate persistentă (audit 2026-09-23, punctul 4/5)
========================================================= */

test("I. withdrawalRequestsForVendor: vendorul vede declarația 'întreaga comandă' (atinge orice shipment al lui)", () => {
  const order = makeOrder({
    withdrawalRequests: [
      { id: "wd-1", shipmentIds: [], status: "FORWARDED_TO_VENDOR", submittedAt: new Date(), clientName: "Ana", contactEmail: "ana@example.com", declarationText: "text" },
    ],
  });

  const list = svc.withdrawalRequestsForVendor({ order, vendorId: "vendor-A" });
  assert.equal(list.length, 1);
  assert.equal(list[0].coversWholeOrder, true);
});

test("withdrawalRequestsForVendor: declarație parțială pe alt shipment NU apare la acest vendor", () => {
  const order = makeOrder({
    withdrawalRequests: [
      { id: "wd-1", shipmentIds: ["ship-B"], status: "SUBMITTED", submittedAt: new Date(), clientName: "Ana", contactEmail: "a@x.com", declarationText: "t" },
    ],
  });

  const listA = svc.withdrawalRequestsForVendor({ order, vendorId: "vendor-A" });
  const listB = svc.withdrawalRequestsForVendor({ order, vendorId: "vendor-B" });

  assert.equal(listA.length, 0);
  assert.equal(listB.length, 1);
});

test("G. multi-vendor: fiecare vendor vede STRICT declarațiile care ating shipment-ul lui", () => {
  const order = makeOrder({
    withdrawalRequests: [
      { id: "wd-A", shipmentIds: ["ship-A"], status: "SUBMITTED", submittedAt: new Date(), clientName: "Ana", contactEmail: "a@x.com", declarationText: "t" },
      { id: "wd-B", shipmentIds: ["ship-B"], status: "SUBMITTED", submittedAt: new Date(), clientName: "Ana", contactEmail: "a@x.com", declarationText: "t" },
    ],
  });

  const listA = svc.withdrawalRequestsForVendor({ order, vendorId: "vendor-A" });
  const listB = svc.withdrawalRequestsForVendor({ order, vendorId: "vendor-B" });

  assert.deepEqual(listA.map((r) => r.id), ["wd-A"]);
  assert.deepEqual(listB.map((r) => r.id), ["wd-B"]);
});

/* =========================================================
   "Marchează procesată" - closeWithdrawalRequestForVendor
   (audit 2026-09-23, punctul 5)
========================================================= */

function makeCloseFakeDb({ requestRow, updateCalls }) {
  return {
    withdrawalRequest: {
      findUnique: async () => requestRow,
      update: async ({ where, data }) => {
        updateCalls.push({ where, data });
        return { id: where.id, status: data.status };
      },
    },
  };
}

test("J. vendorul CORECT poate marca o cerere ca procesată -> CLOSED", async () => {
  const updateCalls = [];
  const db = makeCloseFakeDb({
    updateCalls,
    requestRow: {
      id: "wd-1",
      orderId: "order-1",
      shipmentIds: ["ship-A"],
      status: "FORWARDED_TO_VENDOR",
      order: {
        shipments: [
          { id: "ship-A", vendorId: "vendor-A" },
          { id: "ship-B", vendorId: "vendor-B" },
        ],
      },
    },
  });

  const result = await svc.closeWithdrawalRequestForVendor({
    withdrawalRequestId: "wd-1",
    vendorId: "vendor-A",
    prisma: db,
  });

  assert.equal(result.status, "CLOSED");
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].data.status, "CLOSED");
});

test("K. vendorul GREȘIT nu poate închide cererea -> 403 not_your_shipment, fără update", async () => {
  const updateCalls = [];
  const db = makeCloseFakeDb({
    updateCalls,
    requestRow: {
      id: "wd-1",
      orderId: "order-1",
      shipmentIds: ["ship-A"],
      status: "FORWARDED_TO_VENDOR",
      order: {
        shipments: [
          { id: "ship-A", vendorId: "vendor-A" },
          { id: "ship-B", vendorId: "vendor-B" },
        ],
      },
    },
  });

  await assert.rejects(
    svc.closeWithdrawalRequestForVendor({
      withdrawalRequestId: "wd-1",
      vendorId: "vendor-B",
      prisma: db,
    }),
    (error) => error.status === 403 && error.code === "not_your_shipment"
  );

  assert.equal(updateCalls.length, 0);
});

test("cerere inexistentă -> 404 not_found", async () => {
  const db = makeCloseFakeDb({ updateCalls: [], requestRow: null });

  await assert.rejects(
    svc.closeWithdrawalRequestForVendor({
      withdrawalRequestId: "wd-x",
      vendorId: "vendor-A",
      prisma: db,
    }),
    (error) => error.status === 404 && error.code === "not_found"
  );
});

test("declarație 'întreaga comandă' - orice vendor cu shipment în comandă poate închide", async () => {
  const updateCalls = [];
  const db = makeCloseFakeDb({
    updateCalls,
    requestRow: {
      id: "wd-1",
      orderId: "order-1",
      shipmentIds: [], // întreaga comandă
      status: "SUBMITTED",
      order: {
        shipments: [
          { id: "ship-A", vendorId: "vendor-A" },
          { id: "ship-B", vendorId: "vendor-B" },
        ],
      },
    },
  });

  await svc.closeWithdrawalRequestForVendor({
    withdrawalRequestId: "wd-1",
    vendorId: "vendor-B",
    prisma: db,
  });

  assert.equal(updateCalls.length, 1);
});

/* =========================================================
   AUTO-CLOSE la anulare (audit 2026-09-23, punctul 6) - DOAR
   cazuri neambigue; multi-vendor ambiguu rămâne manual.
========================================================= */

function makeAutoCloseFakeDb({ orderRow, updateManyResults = {} }) {
  const updateManyCalls = [];
  return {
    db: {
      order: {
        findUnique: async () => orderRow,
      },
      withdrawalRequest: {
        updateMany: async ({ where }) => {
          updateManyCalls.push(where);
          const count = updateManyResults[where.id] ?? 1;
          return { count };
        },
      },
    },
    updateManyCalls,
  };
}

test("L. shipment unic în comandă, declarație 'întreaga comandă' -> auto-close SIGUR", async () => {
  const { db, updateManyCalls } = makeAutoCloseFakeDb({
    orderRow: {
      shipments: [{ id: "ship-A", direction: "OUTBOUND" }],
      withdrawalRequests: [
        { id: "wd-1", shipmentIds: [] },
      ],
    },
  });

  const closed = await svc.autoCloseUnambiguousWithdrawalRequests({
    orderId: "order-1",
    shipmentId: "ship-A",
    prisma: db,
  });

  assert.deepEqual(closed, ["wd-1"]);
  assert.equal(updateManyCalls.length, 1);
});

test("M. multi-vendor, declarație 'întreaga comandă', se anulează DOAR un shipment -> NU auto-close (ambiguu)", async () => {
  const { db, updateManyCalls } = makeAutoCloseFakeDb({
    orderRow: {
      shipments: [
        { id: "ship-A", direction: "OUTBOUND" },
        { id: "ship-B", direction: "OUTBOUND" },
      ],
      withdrawalRequests: [{ id: "wd-1", shipmentIds: [] }],
    },
  });

  const closed = await svc.autoCloseUnambiguousWithdrawalRequests({
    orderId: "order-1",
    shipmentId: "ship-A",
    prisma: db,
  });

  assert.deepEqual(closed, []);
  assert.equal(updateManyCalls.length, 0);
});

test("declarație parțială care acoperă STRICT shipment-ul anulat -> auto-close SIGUR", async () => {
  const { db, updateManyCalls } = makeAutoCloseFakeDb({
    orderRow: {
      shipments: [
        { id: "ship-A", direction: "OUTBOUND" },
        { id: "ship-B", direction: "OUTBOUND" },
      ],
      withdrawalRequests: [{ id: "wd-1", shipmentIds: ["ship-A"] }],
    },
  });

  const closed = await svc.autoCloseUnambiguousWithdrawalRequests({
    orderId: "order-1",
    shipmentId: "ship-A",
    prisma: db,
  });

  assert.deepEqual(closed, ["wd-1"]);
});

test("declarație parțială pe 2 shipment-uri, se anulează doar unul -> NU auto-close (ambiguu)", async () => {
  const { db, updateManyCalls } = makeAutoCloseFakeDb({
    orderRow: {
      shipments: [
        { id: "ship-A", direction: "OUTBOUND" },
        { id: "ship-B", direction: "OUTBOUND" },
      ],
      withdrawalRequests: [{ id: "wd-1", shipmentIds: ["ship-A", "ship-B"] }],
    },
  });

  const closed = await svc.autoCloseUnambiguousWithdrawalRequests({
    orderId: "order-1",
    shipmentId: "ship-A",
    prisma: db,
  });

  assert.deepEqual(closed, []);
  assert.equal(updateManyCalls.length, 0);
});

test("declarație deja CLOSED nu e re-procesată de auto-close", async () => {
  const { db, updateManyCalls } = makeAutoCloseFakeDb({
    orderRow: {
      shipments: [{ id: "ship-A", direction: "OUTBOUND" }],
      // filtrul where:{status:{in:[SUBMITTED,FORWARDED_TO_VENDOR]}} e
      // aplicat de query-ul real Prisma - aici simulăm direct rezultatul
      // (lista goală, ca și cum ar fi fost deja filtrată).
      withdrawalRequests: [],
    },
  });

  const closed = await svc.autoCloseUnambiguousWithdrawalRequests({
    orderId: "order-1",
    shipmentId: "ship-A",
    prisma: db,
  });

  assert.deepEqual(closed, []);
  assert.equal(updateManyCalls.length, 0);
});

test("comandă inexistentă -> [] fără eroare (fail-open, non-blocant)", async () => {
  const closed = await svc.autoCloseUnambiguousWithdrawalRequests({
    orderId: "order-x",
    shipmentId: "ship-A",
    prisma: { order: { findUnique: async () => null } },
  });

  assert.deepEqual(closed, []);
});

/* =========================================================
   STRUCTURAL: WithdrawalRequest NU modifică Order/Shipment/Deposit
   (audit 2026-09-23, punctul 9) - fake db-urile de mai sus NU
   definesc deloc shipment.update/order.update/depositStatus - dacă
   vreo funcție ar încerca să le atingă, testul ar arunca "is not a
   function", nu ar trece silențios.
========================================================= */

test("N. closeWithdrawalRequestForVendor nu atinge Order/Shipment (db fake nu are acele metode)", async () => {
  const updateCalls = [];
  const db = makeCloseFakeDb({
    updateCalls,
    requestRow: {
      id: "wd-1",
      orderId: "order-1",
      shipmentIds: ["ship-A"],
      status: "SUBMITTED",
      order: { shipments: [{ id: "ship-A", vendorId: "vendor-A" }] },
    },
  });
  // db-ul de mai sus NU are shipment/order.update - dacă codul le-ar
  // apela, ar arunca TypeError, nu ar trece testul.
  await svc.closeWithdrawalRequestForVendor({
    withdrawalRequestId: "wd-1",
    vendorId: "vendor-A",
    prisma: db,
  });
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].data.status, "CLOSED");
});

test("O. autoCloseUnambiguousWithdrawalRequests nu atinge Order/Shipment (db fake nu are acele metode)", async () => {
  const { db, updateManyCalls } = makeAutoCloseFakeDb({
    orderRow: {
      shipments: [{ id: "ship-A", direction: "OUTBOUND" }],
      withdrawalRequests: [{ id: "wd-1", shipmentIds: [] }],
    },
  });

  await svc.autoCloseUnambiguousWithdrawalRequests({
    orderId: "order-1",
    shipmentId: "ship-A",
    prisma: db,
  });

  assert.equal(updateManyCalls.length, 1);
});
