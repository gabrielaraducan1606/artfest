// src/lib/productCreateRequest.test.js
//
// Cheia operațiunii de creare (idempotență) și mesajele erorilor de salvare,
// comune pentru ProductModal, Catalog și Smart Listing.
// Rulare: node --test src/lib/productCreateRequest.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearCreateOperationKey,
  describeProductSaveError,
  getCreateOperationKey,
  idempotencyHeaders,
  isModerationQueued,
  productSaveErrorText,
} from "./productCreateRequest.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
}
const apiError = (status, data) => Object.assign(new Error(data?.message || data?.error || `Request failed (${status})`), { status, data });

test("aceeași cheie la reîncercări și după reîncărcare (aceeași stocare); alta după creare confirmată", () => {
  const storage = memoryStorage();
  const first = getCreateOperationKey(storage, "modal:u1:magazin");
  assert.match(first, /^[A-Za-z0-9_-]{16,100}$/);
  assert.equal(getCreateOperationKey(storage, "modal:u1:magazin"), first);
  clearCreateOperationKey(storage, "modal:u1:magazin");
  assert.notEqual(getCreateOperationKey(storage, "modal:u1:magazin"), first);
});

test("formulare / ciorne diferite -> chei diferite (produse legitime asemănătoare)", () => {
  const storage = memoryStorage();
  assert.notEqual(getCreateOperationKey(storage, "smart:u1:m:ciorna-a"), getCreateOperationKey(storage, "smart:u1:m:ciorna-b"));
});

test("cheie veche (peste 7 zile) sau coruptă -> cheie nouă; fără stocare -> tot o cheie validă", () => {
  const storage = memoryStorage();
  const old = getCreateOperationKey(storage, "s", Date.now() - 8 * 24 * 3600 * 1000);
  assert.notEqual(getCreateOperationKey(storage, "s"), old);
  storage.setItem("artfest-product-create-op:x", "{nu e json");
  assert.match(getCreateOperationKey(storage, "x"), /^op_/);
  const broken = { getItem() { throw new Error("blocat"); }, setItem() { throw new Error("blocat"); } };
  assert.match(getCreateOperationKey(broken, "y"), /^op_/);
});

test("header doar când există cheie", () => {
  assert.deepEqual(idempotencyHeaders("op_x"), { "Idempotency-Key": "op_x" });
  assert.deepEqual(idempotencyHeaders(null), {});
});

test("erorile de salvare: categorii separate, fără coduri tehnice", () => {
  assert.equal(describeProductSaveError(apiError(400, { error: "invalid_title", message: "Titlul e obligatoriu." })).kind, "validation");
  assert.equal(describeProductSaveError(apiError(400, { error: "invalid_product_images", message: "Unele fotografii nu sunt ale tale." })).kind, "upload");
  assert.equal(describeProductSaveError(new TypeError("Failed to fetch")).kind, "ambiguous");
  assert.equal(describeProductSaveError(apiError(504, "<html>")).kind, "ambiguous");
  assert.equal(describeProductSaveError(apiError(409, { error: "idempotency_key_reused", productId: "p1" })).kind, "conflict");
  assert.equal(describeProductSaveError(apiError(409, { error: "gpsr_confirmation_required", message: "Confirmă GPSR." })).kind, "validation");
  const server = describeProductSaveError(apiError(500, { error: "server_error", diagnosticId: "PX1" }));
  assert.equal(server.kind, "server");
  assert.doesNotMatch(server.message, /server_error/);
  assert.match(productSaveErrorText(apiError(500, { error: "server_error", diagnosticId: "PX1" })), /Cod de diagnostic: PX1/);
  // validare fără mesaj: codul apare doar ca referință, mesajul e în română
  assert.match(describeProductSaveError(apiError(400, { error: "ceva_nou" })).message, /Verifică datele produsului/);
});

test("„în curs de verificare” doar pentru moderarea pusă în coadă", () => {
  assert.equal(isModerationQueued({ moderationQueued: true, moderationStatus: "PENDING" }), true);
  assert.equal(isModerationQueued({ moderationStatus: "PENDING" }), false);
  assert.equal(isModerationQueued({ moderationQueued: true, moderationStatus: "APPROVED" }), false);
});
