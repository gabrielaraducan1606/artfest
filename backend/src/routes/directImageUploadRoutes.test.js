// Rulare: node --test src/routes/directImageUploadRoutes.test.js
//
// Rutele /api/upload/direct: comutator (oprit -> 404 fără autentificare),
// autentificare, rolul din BAZA DE DATE (nu din token), cont blocat,
// răspunsurile intent/complete. R2 și DB simulate - fără rețea.

import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import sharp from "sharp";

process.env.JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const { createDirectImageUploadRouter } = await import("./directImageUploadRoutes.js");

const ID = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";
const users = {
  vendor1: { id: "vendor1", role: "VENDOR", locked: false },
  admin1: { id: "admin1", role: "ADMIN", locked: false },
  locked1: { id: "locked1", role: "VENDOR", locked: true },
  // tokenul spune ADMIN, baza de date spune USER
  user1: { id: "user1", role: "USER", locked: false },
};
const db = { user: { findUnique: async ({ where }) => users[where.id] || null } };

function fakeDeps() {
  const objects = new Map();
  return {
    objects,
    bucket: "b",
    newId: () => ID,
    now: () => 0,
    publicUrl: (key) => `https://cdn.test/${key}`,
    presign: async (command) => `https://r2.test/${command.input.Key}?sig=1`,
    send: async (command) => {
      const name = command.constructor.name;
      const key = command.input.Key;
      if (name === "HeadObjectCommand") {
        if (!objects.has(key)) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return { ContentLength: objects.get(key).length };
      }
      if (name === "GetObjectCommand") return { Body: objects.get(key) };
      if (name === "PutObjectCommand") return objects.set(key, Buffer.from(command.input.Body)), {};
      if (name === "DeleteObjectCommand") return objects.delete(key), {};
      throw new Error(name);
    },
  };
}

async function withServer(env, fn, deps = fakeDeps()) {
  const app = express();
  app.use(express.json());
  app.use("/api/upload/direct", createDirectImageUploadRouter({ env, db, deps }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/upload/direct`;
  try {
    await fn({
      deps,
      post: async (path, body, sub, role = "VENDOR") => {
        const headers = { "Content-Type": "application/json" };
        if (sub) headers.Authorization = `Bearer ${jwt.sign({ sub, role }, process.env.JWT_SECRET)}`;
        const res = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
        return { status: res.status, data: await res.json(), retryAfter: res.headers.get("retry-after") };
      },
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const intentBody = { purpose: "product", contentType: "image/jpeg", size: 50_000 };

test("comutator oprit: 404 direct_upload_disabled (fallback), chiar și fără autentificare", async () => {
  await withServer({}, async ({ post }) => {
    const res = await post("/intent", intentBody, null);
    assert.equal(res.status, 404);
    assert.deepEqual(res.data, { error: "direct_upload_disabled", fallback: true });
  });
});

test("activ: fără token -> 401; cont blocat -> 403; rol din DB, nu din token", async () => {
  await withServer({ DIRECT_IMAGE_UPLOAD_ENABLED: "1" }, async ({ post }) => {
    assert.equal((await post("/intent", intentBody, null)).status, 401);
    assert.equal((await post("/intent", intentBody, "locked1")).status, 403);
    assert.equal((await post("/intent", intentBody, "user1", "ADMIN")).status, 403);
    assert.equal((await post("/intent", intentBody, "ghost")).status, 401);
    assert.equal((await post("/intent", { ...intentBody, purpose: "fair-reception" }, "vendor1", "ADMIN")).status, 403);
  });
});

test("activ: intent -> URL semnat; complete -> URL definitiv în formatul rutei vechi", async () => {
  await withServer({ DIRECT_IMAGE_UPLOAD_ENABLED: "1" }, async ({ post, deps }) => {
    const intent = await post("/intent", intentBody, "vendor1");
    assert.equal(intent.status, 200);
    assert.equal(intent.data.uploadId, ID);
    assert.match(intent.data.uploadUrl, /^https:\/\/r2\.test\/staging\/direct-images\/product\/vendor1\//);

    // „browserul” urcă fișierul în R2
    const body = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#c87828" } }).jpeg().toBuffer();
    deps.objects.set(`staging/direct-images/product/vendor1/${ID}.jpg`, body);

    // alt vânzător nu îl poate confirma
    users.vendor2 = { id: "vendor2", role: "VENDOR", locked: false };
    const stolen = await post("/complete", { purpose: "product", uploadId: ID }, "vendor2");
    assert.equal(stolen.status, 404);

    const done = await post("/complete", { purpose: "product", uploadId: ID }, "vendor1");
    assert.equal(done.status, 200);
    assert.equal(done.data.url, `https://cdn.test/products/vendor1/${ID}.jpg`);
    assert.deepEqual(done.data.urls, [done.data.url]);
    assert.equal(done.data.items[0].url, done.data.url);
  });
});

test("activ: fișier care cere procesare -> 422 cu fallback: true", async () => {
  await withServer({ DIRECT_IMAGE_UPLOAD_ENABLED: "1" }, async ({ post, deps }) => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).png().toBuffer();
    deps.objects.set(`staging/direct-images/product/vendor1/${ID}.jpg`, Buffer.concat([png, Buffer.alloc(200)]));
    const res = await post("/complete", { purpose: "product", uploadId: ID }, "vendor1");
    assert.equal(res.status, 422);
    assert.equal(res.data.fallback, true);
  });
});

test("activ: eroare R2 -> 503 + Retry-After (reîncercare, nu fallback)", async () => {
  const deps = fakeDeps();
  deps.send = async () => {
    throw Object.assign(new Error("boom"), { $metadata: { httpStatusCode: 500 } });
  };
  await withServer(
    { DIRECT_IMAGE_UPLOAD_ENABLED: "1" },
    async ({ post }) => {
      const res = await post("/complete", { purpose: "product", uploadId: ID }, "vendor1");
      assert.equal(res.status, 503);
      assert.equal(res.retryAfter, "3");
      assert.equal(res.data.fallback, undefined);
    },
    deps
  );
});
