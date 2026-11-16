// Rulare: node --test src/lib/productImages/directImageUpload.test.js
//
// Upload direct în R2 din browser: alegerea căii (direct / rută veche),
// revenirea controlată fără dubluri, reluarea confirmării cu ACEEAȘI
// încărcare. Cereri, PUT și XHR simulate - fără rețea.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DirectUploadFallback,
  isBrowserEncoded,
  isDirectImageUploadEnabled,
  markBrowserEncoded,
  uploadImageDirect,
} from "./directImageUpload.js";
import { uploadProductImage } from "./uploadProductImage.js";
import { isRetryableUploadError } from "./productImageRules.js";

const FINAL = "https://media.test/products/u1/3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b.jpg";
const SERVER_URL = "https://media.test/products/u1/1731740000000-0-poza.jpg";

const encodedFile = () => markBrowserEncoded(new Blob([new Uint8Array(2048)], { type: "image/jpeg" }));

/** Backend + R2 simulate: răspunsuri programabile, apelurile înregistrate. */
function fakeBackend({ intent = [], complete = [], put = [] } = {}) {
  const calls = [];
  let n = 0;
  const next = (list, fallback) => (list.length ? list.shift() : fallback);
  return {
    calls,
    post: async (endpoint, body) => {
      calls.push({ endpoint, body });
      if (endpoint.endsWith("/intent")) {
        n += 1;
        return next(intent, { ok: true, status: 200, data: { uploadId: `id-${n}`, uploadUrl: `https://r2.test/staging/${n}`, headers: { "Content-Type": "image/jpeg" } } });
      }
      return next(complete, { ok: true, status: 200, data: { url: FINAL } });
    },
    put: async (_file, { uploadUrl }) => {
      calls.push({ endpoint: "PUT", uploadUrl });
      return next(put, { ok: true });
    },
  };
}

/** XHR minimal pentru ruta veche (POST multipart). */
function serverXHR(log) {
  return class {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = "";
    }
    open(method, url) {
      log.push({ method, url });
    }
    setRequestHeader() {}
    getResponseHeader() {
      return null;
    }
    abort() {}
    send() {
      queueMicrotask(() => {
        this.status = 200;
        this.responseText = JSON.stringify({ url: SERVER_URL });
        this.onload?.();
      });
    }
  };
}

test("comutatorul din frontend e OPRIT implicit", () => {
  assert.equal(isDirectImageUploadEnabled({}), false);
  assert.equal(isDirectImageUploadEnabled(undefined), false);
  assert.equal(isDirectImageUploadEnabled({ VITE_DIRECT_IMAGE_UPLOAD: "1" }), true);
});

test("doar fișierele produse de optimizarea din browser sunt marcate", () => {
  const raw = new Blob([new Uint8Array(10)]);
  assert.equal(isBrowserEncoded(raw), false);
  assert.equal(isBrowserEncoded(encodedFile()), true);
});

test("direct: intenție -> PUT în R2 -> confirmare; scopul și mărimea trimise", async () => {
  const backend = fakeBackend();
  const file = encodedFile();
  const result = await uploadImageDirect(file, { purpose: "product", post: backend.post, put: backend.put });
  assert.equal(result.url, FINAL);
  assert.deepEqual(
    backend.calls.map((c) => c.endpoint),
    ["/api/upload/direct/intent", "PUT", "/api/upload/direct/complete"]
  );
  assert.deepEqual(backend.calls[0].body, { purpose: "product", contentType: "image/jpeg", size: 2048 });
  assert.deepEqual(backend.calls[2].body, { purpose: "product", uploadId: "id-1" });
});

test("PUT eșuat (CORS / rețea) -> revenire pe ruta veche, fără confirmare", async () => {
  const backend = fakeBackend({ put: [{ ok: false, reason: "network" }] });
  await assert.rejects(
    uploadImageDirect(encodedFile(), { purpose: "product", post: backend.post, put: backend.put }),
    (e) => e instanceof DirectUploadFallback
  );
  assert.equal(backend.calls.some((c) => c.endpoint.endsWith("/complete")), false);
});

test("sistem oprit pe server / fișier care cere procesare -> revenire pe ruta veche", async () => {
  const off = fakeBackend({ intent: [{ ok: false, status: 404, data: { error: "direct_upload_disabled", fallback: true } }] });
  await assert.rejects(uploadImageDirect(encodedFile(), { purpose: "product", post: off.post, put: off.put }), DirectUploadFallback);
  assert.equal(off.calls.length, 1);

  const needs = fakeBackend({ complete: [{ ok: false, status: 422, data: { error: "direct_upload_needs_processing", fallback: true } }] });
  await assert.rejects(uploadImageDirect(encodedFile(), { purpose: "product", post: needs.post, put: needs.put }), DirectUploadFallback);
});

test("confirmare eșuată temporar -> reîncercarea confirmă ACEEAȘI încărcare (fără al doilea PUT)", async () => {
  const backend = fakeBackend({ complete: [{ ok: false, status: 503, data: { error: "storage_unavailable" }, retryAfterSeconds: 3 }] });
  const file = encodedFile();
  const first = await uploadImageDirect(file, { purpose: "product", post: backend.post, put: backend.put }).catch((e) => e);
  assert.equal(first.directFallback, undefined, "fără ruta veche după un PUT reușit");
  assert.equal(isRetryableUploadError(first), true);
  assert.equal(first.retryAfterSeconds, 3);

  const before = backend.calls.length;
  const second = await uploadImageDirect(file, { purpose: "product", post: backend.post, put: backend.put });
  assert.equal(second.url, FINAL);
  assert.deepEqual(backend.calls.slice(before), [{ endpoint: "/api/upload/direct/complete", body: { purpose: "product", uploadId: "id-1" } }]);
});

test("reluare: încărcarea expirată (upload_not_found) -> încărcare nouă", async () => {
  const backend = fakeBackend({
    complete: [
      { ok: false, status: 503, data: {} },
      { ok: false, status: 404, data: { error: "upload_not_found" } },
    ],
  });
  const file = encodedFile();
  await uploadImageDirect(file, { purpose: "product", post: backend.post, put: backend.put }).catch(() => {});
  const result = await uploadImageDirect(file, { purpose: "product", post: backend.post, put: backend.put });
  assert.equal(result.url, FINAL);
  assert.equal(backend.calls.filter((c) => c.endpoint.endsWith("/intent")).length, 2);
});

test("limita pe utilizator (429) e o eroare temporară, nu revenire pe ruta veche", async () => {
  const backend = fakeBackend({ intent: [{ ok: false, status: 429, data: { error: "too_many_uploads", message: "Prea multe" }, retryAfterSeconds: 60 }] });
  const error = await uploadImageDirect(encodedFile(), { purpose: "product", post: backend.post, put: backend.put }).catch((e) => e);
  assert.equal(error.directFallback, undefined);
  assert.equal(error.status, 429);
  assert.equal(error.message, "Prea multe");
});

test("uploadProductImage: comutator oprit sau fișier neoptimizat -> ruta veche", async () => {
  const direct = async () => assert.fail("nu trebuia apelat direct");
  for (const [file, enabled] of [
    [encodedFile(), false],
    [new Blob([new Uint8Array(10)], { type: "image/jpeg" }), true],
  ]) {
    const log = [];
    const result = await uploadProductImage(file, { directEnabled: enabled, direct, XHR: serverXHR(log) });
    assert.equal(result.url, SERVER_URL);
    assert.equal(log[0].method, "POST");
    assert.match(log[0].url, /\/api\/upload\/products$/);
  }
});

test("uploadProductImage: activ -> direct; scopul după endpoint (produs / recepția Târgului)", async () => {
  const seen = [];
  const direct = async (_file, { purpose }) => {
    seen.push(purpose);
    return { url: FINAL, data: {} };
  };
  const XHR = serverXHR([]);
  assert.equal((await uploadProductImage(encodedFile(), { directEnabled: true, direct, XHR })).url, FINAL);
  await uploadProductImage(encodedFile(), {
    directEnabled: true,
    direct,
    XHR,
    endpoint: "/api/admin/artfest-fair/inventory/photos",
    fieldName: "files",
  });
  assert.deepEqual(seen, ["product", "fair-reception"]);

  // endpoint fără scop direct -> ruta veche
  const log = [];
  await uploadProductImage(encodedFile(), { directEnabled: true, direct, XHR: serverXHR(log), endpoint: "/api/upload/support" });
  assert.equal(log.length, 1);
});

test("uploadProductImage: revenire controlată -> O SINGURĂ încărcare pe ruta veche; eroare temporară -> fără ruta veche", async () => {
  const log = [];
  const fallback = async () => {
    throw new DirectUploadFallback("put_network");
  };
  const result = await uploadProductImage(encodedFile(), { directEnabled: true, direct: fallback, XHR: serverXHR(log) });
  assert.equal(result.url, SERVER_URL);
  assert.equal(log.length, 1);

  const log2 = [];
  const busy = async () => {
    throw Object.assign(new Error("busy"), { kind: "http", status: 503 });
  };
  await assert.rejects(uploadProductImage(encodedFile(), { directEnabled: true, direct: busy, XHR: serverXHR(log2) }), {
    status: 503,
  });
  assert.equal(log2.length, 0);
});
