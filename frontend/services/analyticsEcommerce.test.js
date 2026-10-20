// services/analyticsEcommerce.test.js
// Rulare: node --test services/analyticsEcommerce.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEcommercePayload,
  buildItem,
  buildItems,
  buildPurchasePayload,
  getUserRoleLabel,
  isInternalRole,
  isProductionHost,
  resolveUnitPrice,
} from "./analyticsEcommerce.js";

test("preț unitar: prețul final afișat are prioritate față de cenți", () => {
  assert.equal(resolveUnitPrice({ price: 89.9, priceCents: 12000 }), 89.9);
  assert.equal(resolveUnitPrice({ finalPriceCents: 7550 }), 75.5);
  assert.equal(resolveUnitPrice({ priceCents: 1000 }), 10);
  assert.equal(resolveUnitPrice({ product: { price: 42 } }), 42); // rând de coș
  assert.equal(resolveUnitPrice({}), 0);
  assert.equal(resolveUnitPrice(null), 0);
});

test("item din pagina de produs: item_id = Product.id (= g:id din feed)", () => {
  const item = buildItem(
    { id: "prod_1", title: "Lumânare", price: 50, storeName: "Atelier A", category: "decor" },
    { quantity: 2 }
  );
  assert.deepEqual(item, {
    item_id: "prod_1",
    item_name: "Lumânare",
    item_brand: "Atelier A",
    item_category: "decor",
    price: 50,
    quantity: 2,
  });
});

test("rând de coș personalizat -> item_variant fără textul personalizării", () => {
  const item = buildItem({
    productId: "prod_2",
    qty: 3,
    configurationKey: "{\"customAnswers\":{\"nume\":\"Ana\"}}",
    customAnswers: { nume: "Ana" },
    product: { title: "Cană", price: 30, vendorName: "Atelier B" },
  });

  assert.equal(item.item_id, "prod_2");
  assert.equal(item.item_variant, "personalizat");
  assert.equal(item.quantity, 3);
  assert.equal(item.price, 30);
  assert.ok(!JSON.stringify(item).includes("Ana"), "nu trimitem date personale");
});

test("rând de coș standard (READY_TO_BUY) -> fără item_variant", () => {
  const item = buildItem({ productId: "p", qty: 1, configurationKey: "default", product: { price: 5 } });
  assert.equal(item.item_variant, undefined);
});

test("fără id -> item ignorat; cantitate invalidă -> 1", () => {
  assert.equal(buildItem({ title: "x" }), null);
  assert.equal(buildItem({ id: "a", qty: 0 }).quantity, 1);
  assert.equal(buildItem({ id: "a", qty: "abc" }).quantity, 1);
});

test("comandă cu mai mulți vânzători: toate produsele, value = suma", () => {
  const items = buildItems([
    { productId: "a1", title: "A1", price: 100, qty: 1, vendorName: "Atelier A" },
    { productId: "b1", title: "B1", price: 80, qty: 2, vendorName: "Atelier B" },
  ]);
  const payload = buildEcommercePayload({ items });

  assert.equal(payload.currency, "RON");
  assert.equal(payload.value, 260);
  assert.deepEqual(payload.items.map((i) => i.item_brand), ["Atelier A", "Atelier B"]);
  assert.deepEqual(payload.items.map((i) => i.index), [0, 1]);
});

test("value explicit (total cu transport) are prioritate față de suma itemilor", () => {
  const payload = buildEcommercePayload({
    value: 275,
    items: buildItems([{ productId: "a", price: 260, qty: 1 }]),
  });
  assert.equal(payload.value, 275);
});

test("purchase: transaction_id = Order.id, value = Order.total, shipping separat", () => {
  const payload = buildPurchasePayload({
    id: "ord_123",
    total: 275,
    shippingTotal: 15,
    currency: "RON",
    items: [
      { productId: "a1", title: "A1", price: 100, qty: 1 },
      { productId: "b1", title: "B1", price: 80, qty: 2 },
    ],
  });

  assert.equal(payload.transaction_id, "ord_123");
  assert.equal(payload.value, 275);
  assert.equal(payload.shipping, 15);
  assert.equal(payload.items.length, 2);
});

test("purchase invalid (fără id / total <= 0) -> null, nu se raportează", () => {
  assert.equal(buildPurchasePayload({ total: 10 }), null);
  assert.equal(buildPurchasePayload({ id: "o", total: 0 }), null);
  assert.equal(buildPurchasePayload({ id: "o", total: "x" }), null);
});

test("domeniu de producție și roluri interne", () => {
  assert.equal(isProductionHost("artfest.ro"), true);
  assert.equal(isProductionHost("www.artfest.ro"), true);
  assert.equal(isProductionHost("localhost"), false);
  assert.equal(isProductionHost("artfest-git-main.vercel.app"), false);

  assert.equal(isInternalRole("ADMIN"), true);
  assert.equal(isInternalRole("vendor"), true);
  assert.equal(isInternalRole("USER"), false);
  assert.equal(isInternalRole("INFLUENCER"), false);
  assert.equal(isInternalRole(undefined), false);

  assert.equal(getUserRoleLabel({ role: "USER" }), "customer");
  assert.equal(getUserRoleLabel(null), "guest");
});
