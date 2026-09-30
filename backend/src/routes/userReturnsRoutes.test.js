// src/routes/userReturnsRoutes.test.js
//
// Teste deterministe pentru POST /api/user/returns (endpointul care
// lipsea; ReturnRequestModal îl apela și primea 404). Folosește modelele
// existente ReturnRequest / ReturnRequestItem. FĂRĂ DB real.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/userReturnsRoutes.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";

let server;
let baseUrl;
let orderRow;
let previousItems;
let createdReturns;
let notifications;
let userNotifications;
let products;
let emails;

const fakeDb = {
  product: {
    findMany: async ({ where }) => products.filter((p) => where.id.in.includes(p.id)),
  },
  user: {
    findMany: async () => [{ id: "admin-1" }],
    findUnique: async () => ({ email: "client@example.com", firstName: "Ana" }),
  },
  vendor: {
    findUnique: async () => ({ displayName: "Atelier", email: "vendor@example.com", user: null }),
  },
  order: {
    findFirst: async ({ where }) => {
      if (!orderRow || where.userId !== orderRow.userId) return null;
      return JSON.parse(JSON.stringify(orderRow));
    },
  },
  returnRequestItem: {
    findMany: async () => previousItems,
  },
  returnRequest: {
    create: async ({ data }) => {
      const row = { id: "rr-1", status: "NEW", createdAt: new Date("2026-09-20T10:00:00Z"), ...data };
      createdReturns.push(row);
      return row;
    },
  },
};

let restoreAll;

before(async () => {
  const mocks = [
    mock.module("../db.js", { namedExports: { prisma: fakeDb } }),
    mock.module("../api/auth.js", {
      namedExports: {
        authRequired: (req, _res, next) => {
          req.user = { sub: "user-1" };
          next();
        },
        enforceTokenVersion: (_req, _res, next) => next(),
      },
    }),
    mock.module("../services/notifications.js", {
      namedExports: {
        createVendorNotification: async (vendorId, data) => {
          notifications.push({ vendorId, data });
          return {};
        },
        createUserNotification: async (userId, data) => {
          userNotifications.push({ userId, data });
          return {};
        },
      },
    }),
  ];

  mocks.push(
    mock.module("../lib/mailer.js", {
      namedExports: {
        sendVendorReturnRequestedEmail: async (args) => emails.push({ kind: "vendor", ...args }),
        sendReturnRequestReceivedEmail: async (args) => emails.push({ kind: "client", ...args }),
        sendReturnStatusEmail: async (args) => emails.push({ kind: "status", ...args }),
      },
    })
  );

  restoreAll = () => mocks.forEach((m) => m.restore());

  const mod = await import(`./userReturnsRoutes.js?t=${Date.now()}`);

  const app = express();
  app.use(express.json());
  app.use("/api/user/returns", mod.default);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restoreAll?.();
});

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  createdReturns = [];
  notifications = [];
  userNotifications = [];
  emails = [];
  previousItems = [];
  products = [
    {
      id: "prod-1",
      optionsSchema: [{ key: "marime", label: "Mărime", options: ["S", "M"] }],
      customSchema: [
        { key: "nume", label: "Nume gravat", type: "text" },
        { key: "culoare", label: "Culoare", options: ["Roșu", "Alb"] },
      ],
      repeatedGroups: [],
    },
  ];
  orderRow = {
    id: "order-1",
    orderNumber: "AF-1001",
    userId: "user-1",
    shipments: [
      {
        id: "ship-1",
        vendorId: "vendor-1",
        status: "DELIVERED",
        direction: "OUTBOUND",
        deliveredAt: daysAgo(3),
        updatedAt: daysAgo(3),
        items: [
          { id: "item-1", productId: "prod-1", title: "Lumânare", qty: 2, price: "49.90" },
        ],
      },
    ],
  };
});

function payload(overrides = {}) {
  return {
    orderId: "order-1",
    shipmentId: "ship-1",
    vendorId: "client-sent-vendor-ignored",
    items: [{ orderItemId: "item-1", qty: 1 }],
    reasonCode: "CHANGED_MIND",
    reasonText: null,
    faultParty: "UNKNOWN",
    resolutionWanted: "REFUND",
    notesUser: null,
    photos: [],
    policyAck: { accepted: true, key: "returns_policy_ack", version: 1 },
    ...overrides,
  };
}

async function post(body) {
  const res = await fetch(`${baseUrl}/api/user/returns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("cerere validă: 201, ReturnRequest + items create, vendorId din shipment (nu din client), vendor notificat", async () => {
  const { status, body } = await post(payload());

  assert.equal(status, 201);
  assert.equal(body.ok, true);
  assert.equal(body.returnRequestId, "rr-1");

  assert.equal(createdReturns.length, 1);
  const row = createdReturns[0];
  assert.equal(row.userId, "user-1");
  assert.equal(row.orderId, "order-1");
  assert.equal(row.originalShipmentId, "ship-1");
  assert.equal(row.vendorId, "vendor-1");
  assert.equal(row.reasonCode, "CHANGED_MIND");
  assert.equal(row.items.create.length, 1);
  assert.deepEqual(row.items.create[0], {
    shipmentItemId: "item-1",
    productId: "prod-1",
    title: "Lumânare",
    qty: 1,
    price: "49.90",
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].vendorId, "vendor-1");
});

test("email vânzător la cerere nouă: comandă, produse, motiv, CTA - fără adresa clientului / adresa de retur", async () => {
  orderRow.shippingAddress = { name: "Ana Pop", street: "Str. Secretă 9", city: "Cluj", email: "ana@example.com" };

  await post(payload());

  const vendorEmail = emails.find((e) => e.kind === "vendor");
  assert.equal(vendorEmail.to, "vendor@example.com");
  assert.equal(vendorEmail.orderNumber, "AF-1001");
  assert.deepEqual(vendorEmail.items, [{ title: "Lumânare", qty: 1 }]);
  assert.equal(vendorEmail.reasonLabel, "M-am răzgândit");
  assert.equal(vendorEmail.link, "/vendor/orders/order-1");
  assert.doesNotMatch(JSON.stringify(vendorEmail), /Str. Secretă|Cluj/);

  const clientEmail = emails.find((e) => e.kind === "client");
  assert.equal(clientEmail.to, "client@example.com");
  assert.doesNotMatch(JSON.stringify(clientEmail), /adres/i);
});

test("politica de retur: versiunea confirmată de client e păstrată în meta notificării (audit)", async () => {
  await post(payload({ policyAck: { accepted: true, key: "returns_policy_ack", version: 2, acceptedAt: "2026-09-28T10:00:00Z" } }));

  assert.deepEqual(notifications[0].data.meta.policyAck, {
    key: "returns_policy_ack",
    version: 2,
    acceptedAt: "2026-09-28T10:00:00Z",
  });
});

test("comanda altui user -> 404, nimic creat", async () => {
  orderRow.userId = "user-2";

  const { status, body } = await post(payload());

  assert.equal(status, 404);
  assert.equal(body.error, "not_found");
  assert.equal(createdReturns.length, 0);
});

test("livrare nelivrată -> 409 not_delivered", async () => {
  orderRow.shipments[0].status = "IN_TRANSIT";

  const { status, body } = await post(payload());

  assert.equal(status, 409);
  assert.equal(body.error, "not_delivered");
});

test("produs din altă livrare -> 400 item_not_in_shipment", async () => {
  const { status, body } = await post(
    payload({ items: [{ orderItemId: "item-X", qty: 1 }] })
  );

  assert.equal(status, 400);
  assert.equal(body.error, "item_not_in_shipment");
});

test("cantitate peste cea cumpărată (incl. cereri anterioare) -> 409", async () => {
  previousItems = [{ shipmentItemId: "item-1", qty: 1 }];

  const { status, body } = await post(
    payload({ items: [{ orderItemId: "item-1", qty: 2 }] })
  );

  assert.equal(status, 409);
  assert.equal(body.error, "quantity_exceeds_purchased");
  assert.equal(createdReturns.length, 0);
});

test("după fereastra de 14 zile: răzgândire respinsă, neconformitate (cu foto) acceptată", async () => {
  orderRow.shipments[0].deliveredAt = daysAgo(30);

  const late = await post(payload({ reasonCode: "CHANGED_MIND" }));
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "return_window_expired");

  const defect = await post(
    payload({
      reasonCode: "DEFECT",
      photos: ["https://cdn.example.com/p1.jpg"],
    })
  );
  assert.equal(defect.status, 201);
});

test("neconformitate fără poze -> 400 photos_required", async () => {
  const { status, body } = await post(payload({ reasonCode: "DEFECT", photos: [] }));

  assert.equal(status, 400);
  assert.equal(body.error, "photos_required");
});

test("motiv 'Alt motiv' fără text -> 400", async () => {
  const { status, body } = await post(payload({ reasonCode: "OTHER", reasonText: "  " }));

  assert.equal(status, 400);
  assert.equal(body.error, "reason_text_required");
});

test("produs personalizat (nume gravat) + retragere fără motiv -> 409, fără formulare de tip «interzis»", async () => {
  orderRow.shipments[0].items[0].customAnswers = { nume: "Ana" };

  for (const reasonCode of ["CHANGED_MIND", "NO_LONGER_WANTED", "SIZE_COLOR"]) {
    const { status, body } = await post(payload({ reasonCode }));
    assert.equal(status, 409, reasonCode);
    assert.equal(body.error, "personalized_withdrawal_excluded");
    assert.match(body.message, /Poți solicita în continuare soluționarea/);
    assert.doesNotMatch(body.message, /interzis/i);
  }

  const other = await post(payload({ reasonCode: "OTHER_WITHDRAWAL", reasonText: "Nu îmi mai trebuie" }));
  assert.equal(other.status, 409);

  assert.equal(createdReturns.length, 0);
});

test("produs personalizat + neconformitate (defect, personalizare greșită, lipsă elemente) -> 201", async () => {
  orderRow.shipments[0].items[0].customAnswers = { nume: "Ana" };

  for (const reasonCode of ["DEFECT", "PERSONALIZATION_MISMATCH", "MISSING_PARTS", "DAMAGED"]) {
    const { status } = await post(payload({ reasonCode, photos: ["https://cdn.example.com/p.jpg"] }));
    assert.equal(status, 201, reasonCode);
  }

  const other = await post(payload({ reasonCode: "OTHER_CONFORMITY", reasonText: "Gravura e ștearsă" }));
  assert.equal(other.status, 201);
});

test("culoare / mărime aleasă din listă NU face produsul personalizat -> retragerea e permisă", async () => {
  orderRow.shipments[0].items[0].selectedOptions = { marime: "M" };
  orderRow.shipments[0].items[0].customAnswers = { culoare: "Roșu" };

  const { status, body } = await post(payload({ reasonCode: "CHANGED_MIND" }));

  assert.equal(status, 201);
  assert.equal(body.review, undefined);
  assert.equal(userNotifications.length, 0);
});

test("personalizare neclară (produs șters) + retragere -> NU e respinsă, merge la verificare admin", async () => {
  orderRow.shipments[0].items[0].customAnswers = { nume: "Ana" };
  products = [];

  const { status, body } = await post(payload({ reasonCode: "CHANGED_MIND" }));

  assert.equal(status, 201);
  assert.equal(body.review, "UNCLEAR");
  assert.equal(createdReturns.length, 1);
  assert.equal(userNotifications.length, 1);
  assert.equal(userNotifications[0].userId, "admin-1");
  assert.equal(userNotifications[0].data.meta.kind, "return_personalization_review");
  assert.equal(notifications[0].data.meta.personalizationReview, true);
});

test("comandă din ofertă, fără date de personalizare -> verificare, nu respingere", async () => {
  orderRow.quoteRequest = { id: "q-1" };

  const { status, body } = await post(payload({ reasonCode: "CHANGED_MIND" }));

  assert.equal(status, 201);
  assert.equal(body.review, "UNCLEAR");
});

test("retragere după 14 zile -> 409 chiar și cu motivul nou NO_LONGER_WANTED; neconformitatea nouă trece", async () => {
  orderRow.shipments[0].deliveredAt = daysAgo(30);

  const late = await post(payload({ reasonCode: "NO_LONGER_WANTED" }));
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "return_window_expired");

  const missing = await post(payload({ reasonCode: "MISSING_PARTS", photos: ["https://cdn.example.com/p.jpg"] }));
  assert.equal(missing.status, 201);
});

test("motiv necunoscut -> 400 invalid_payload", async () => {
  const { status, body } = await post(payload({ reasonCode: "NU_EXISTA" }));

  assert.equal(status, 400);
  assert.equal(body.error, "invalid_payload");
});

test("fără acceptarea politicii (policyAck.accepted != true) -> 400 invalid_payload", async () => {
  const { status, body } = await post(payload({ policyAck: { accepted: false } }));

  assert.equal(status, 400);
  assert.equal(body.error, "invalid_payload");
});
