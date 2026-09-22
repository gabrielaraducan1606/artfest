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

const fakeDb = {
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
      },
    }),
  ];

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
  previousItems = [];
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

test("fără acceptarea politicii (policyAck.accepted != true) -> 400 invalid_payload", async () => {
  const { status, body } = await post(payload({ policyAck: { accepted: false } }));

  assert.equal(status, 400);
  assert.equal(body.error, "invalid_payload");
});
