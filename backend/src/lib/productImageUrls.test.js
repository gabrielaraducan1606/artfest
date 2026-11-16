// Rulare: node --test src/lib/productImageUrls.test.js
//
// URL-urile de imagine acceptate la salvarea unui produs de către vânzător:
// existente pe produs, încărcate de el în R2, folosite deja pe produsele lui.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkVendorProductImageUrls,
  enforceVendorProductImageUrls,
  isOwnUploadedProductImageUrl,
  productImageUrlCheckMode,
} from "./productImageUrls.js";

const publicUrl = (key) => `https://media.test/${key}`;
const mine = (name) => `https://media.test/products/u1/${name}`;

test("fișierele mele din products/<userId>/ (ruta veche și uploadul direct)", () => {
  assert.equal(isOwnUploadedProductImageUrl(mine("1731740000000-0-poza.jpg"), "u1", { publicUrl }), true);
  assert.equal(isOwnUploadedProductImageUrl(mine("3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b.jpg"), "u1", { publicUrl }), true);
});

test("refuzate: alt utilizator, prefix păcălit, alt folder, extern, căi relative, parametri", () => {
  for (const url of [
    "https://media.test/products/u2/a.jpg",
    "https://media.test/products/u10/a.jpg",
    "https://media.test/products/u1",
    "https://media.test/avatars/u1/a.jpg",
    "https://media.test/artfest-fair-reception/u1/a.jpg",
    "https://evil.test/products/u1/a.jpg",
    "https://media.test.evil.test/products/u1/a.jpg",
    mine("../u2/a.jpg"),
    mine("a.jpg?x=1"),
    mine("a.jpg#x"),
    mine("a b.jpg"),
    mine("..\\u2\\a.jpg"),
    "/products/u1/a.jpg",
    null,
  ]) {
    assert.equal(isOwnUploadedProductImageUrl(url, "u1", { publicUrl }), false, String(url));
  }
  assert.equal(isOwnUploadedProductImageUrl(mine("a.jpg"), "", { publicUrl }), false);
});

test("fotografiile EXISTENTE pe produs rămân valabile (import, Admin, versiuni vechi)", async () => {
  const existing = ["https://cdn.shop-extern.test/x.jpg", "https://media.test/products/admin9/y.jpg"];
  const result = await checkVendorProductImageUrls({
    images: [existing[1], mine("nou.jpg"), existing[0]],
    userId: "u1",
    existingImages: existing,
    publicUrl,
  });
  assert.deepEqual(result, { ok: true });
});

test("URL nou străin -> refuzat; folosit deja pe alt produs al ACELUIAȘI vânzător -> acceptat", async () => {
  const shared = "https://cdn.shop-extern.test/importat.jpg";
  const queries = [];
  const db = {
    product: {
      findMany: async (args) => {
        queries.push(args);
        return [{ images: [shared, "https://media.test/products/u1/alta.jpg"] }];
      },
    },
  };

  const ok = await checkVendorProductImageUrls({ images: [mine("a.jpg"), shared], userId: "u1", vendorId: "v1", db, publicUrl });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(queries[0].where, { service: { vendorId: "v1" }, images: { hasSome: [shared] } });

  const bad = await checkVendorProductImageUrls({
    images: [mine("a.jpg"), "https://media.test/products/u2/furata.jpg"],
    userId: "u1",
    vendorId: "v1",
    db,
    publicUrl,
  });
  assert.deepEqual(bad, { ok: false, rejected: ["https://media.test/products/u2/furata.jpg"] });
});

test("fără URL-uri necunoscute nu se interoghează baza de date", async () => {
  const db = { product: { findMany: async () => assert.fail("nu trebuia interogat") } };
  assert.deepEqual(await checkVendorProductImageUrls({ images: [mine("a.jpg")], userId: "u1", vendorId: "v1", db, publicUrl }), {
    ok: true,
  });
});

test("enforce: 400 invalid_product_images; modul log: doar log, salvarea continuă", async () => {
  const res = {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const warnings = [];
  const logger = { warn: (...args) => warnings.push(args) };
  const input = { images: ["https://evil.test/a.jpg"], userId: "u1", publicUrl };

  assert.equal(productImageUrlCheckMode({}), "enforce");
  assert.equal(await enforceVendorProductImageUrls(res, input, { env: {}, logger }), false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_product_images");
  assert.deepEqual(warnings[0][1].origini, ["https://evil.test"]);

  const res2 = { status: () => assert.fail("nu trebuia blocat") };
  assert.equal(await enforceVendorProductImageUrls(res2, input, { env: { PRODUCT_IMAGE_URL_CHECK: "log" }, logger }), true);
});

test("modul log: nici o eroare a verificării (DB căzut) nu blochează salvarea; enforce -> 503", async () => {
  const db = { product: { findMany: async () => { throw new Error("db down"); } } };
  const input = { images: ["https://evil.test/a.jpg"], userId: "u1", vendorId: "v1", db, publicUrl };
  const logger = { warn() {}, error() {} };
  const blocked = { status: () => assert.fail("nu trebuia blocat") };
  assert.equal(await enforceVendorProductImageUrls(blocked, input, { env: { PRODUCT_IMAGE_URL_CHECK: "log" }, logger }), true);

  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  assert.equal(await enforceVendorProductImageUrls(res, input, { env: {}, logger }), false);
  assert.equal(res.code, 503);
});

test("cheile temporare (staging/) nu pot fi salvate pe un produs", async () => {
  const staging = "https://media.test/staging/direct-images/product/u1/3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b.jpg";
  assert.equal(isOwnUploadedProductImageUrl(staging, "u1", { publicUrl }), false);
  const db = { product: { findMany: async () => [] } };
  assert.deepEqual(await checkVendorProductImageUrls({ images: [staging], userId: "u1", vendorId: "v1", db, publicUrl }), {
    ok: false,
    rejected: [staging],
  });
});
