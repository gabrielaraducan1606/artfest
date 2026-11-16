// Rulare: node --test src/services/directImageUpload.test.js
//
// Upload direct în R2: intenție (rol, scop, tip, mărime, limită), confirmare
// (proprietar, tip real, dimensiuni, EXIF, integritate, idempotență, ștergerea
// cheii temporare). R2 e SIMULAT în memorie - fără rețea, fără credențiale.

import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  DIRECT_IMAGE_MAX_BYTES,
  DirectUploadError,
  completeDirectUpload,
  createDirectUploadIntent,
  createUserRateLimiter,
  directImageUploadEnabled,
  directUploadKeys,
  verifyDirectImage,
} from "./directImageUpload.js";

const USER = "user_a1";
const OTHER = "user_b2";
const ID = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";

function fakeStorage() {
  const objects = new Map();
  const calls = [];
  const deps = {
    bucket: "bucket-test",
    calls,
    objects,
    newId: () => ID,
    now: () => 0,
    publicUrl: (key) => `https://cdn.test/${key}`,
    presign: async (command, expiresIn) => {
      calls.push({ op: "presign", input: command.input, expiresIn });
      return `https://r2.test/${command.input.Key}?sig=1`;
    },
    send: async (command) => {
      const name = command.constructor.name;
      const { Key } = command.input;
      calls.push({ op: name, key: Key, input: command.input });
      const notFound = () => Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      if (name === "HeadObjectCommand") {
        if (!objects.has(Key)) throw notFound();
        return { ContentLength: objects.get(Key).body.length };
      }
      if (name === "GetObjectCommand") {
        if (!objects.has(Key)) throw Object.assign(notFound(), { name: "NoSuchKey" });
        const max = Number(/bytes=0-(\d+)/.exec(command.input.Range || "")?.[1] ?? Infinity);
        return { Body: objects.get(Key).body.subarray(0, max + 1) };
      }
      if (name === "PutObjectCommand") {
        objects.set(Key, { body: Buffer.from(command.input.Body), contentType: command.input.ContentType, cacheControl: command.input.CacheControl });
        return {};
      }
      if (name === "DeleteObjectCommand") {
        objects.delete(Key);
        return {};
      }
      throw new Error(`neașteptat: ${name}`);
    },
  };
  return deps;
}

const jpeg = (w = 1200, h = 900, opts = {}) => {
  const image = sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg({
    quality: 85,
  });
  return (opts.exif ? image.withExif({ IFD0: { Copyright: "x" } }) : image).toBuffer();
};

async function staged(deps, body, { purpose = "product", userId = USER } = {}) {
  const { stagingKey } = directUploadKeys({ purpose, userId, uploadId: ID });
  deps.objects.set(stagingKey, { body });
  return stagingKey;
}

test("comutatorul e OPRIT implicit", () => {
  assert.equal(directImageUploadEnabled({}), false);
  assert.equal(directImageUploadEnabled({ DIRECT_IMAGE_UPLOAD_ENABLED: "0" }), false);
  assert.equal(directImageUploadEnabled({ DIRECT_IMAGE_UPLOAD_ENABLED: "1" }), true);
});

test("cheile vin doar din server: scop + utilizator + uuid valid", () => {
  const keys = directUploadKeys({ purpose: "product", userId: USER, uploadId: ID });
  assert.equal(keys.stagingKey, `staging/direct-images/product/${USER}/${ID}.jpg`);
  assert.equal(keys.finalKey, `products/${USER}/${ID}.jpg`);
  assert.equal(
    directUploadKeys({ purpose: "fair-reception", userId: USER, uploadId: ID }).finalKey,
    `artfest-fair-reception/${USER}/${ID}.jpg`
  );
  for (const uploadId of ["../x", `${ID}/../../a`, "abc", ""]) {
    assert.throws(() => directUploadKeys({ purpose: "product", userId: USER, uploadId }), { code: "invalid_upload_id" });
  }
  assert.throws(() => directUploadKeys({ purpose: "product", userId: "a/b", uploadId: ID }), { code: "unauthenticated" });
  assert.throws(() => directUploadKeys({ purpose: "__proto__", userId: USER, uploadId: ID }), { code: "invalid_purpose" });
});

test("intenție: URL semnat pe cheia temporară, cu tip și mărime fixate", async () => {
  const deps = fakeStorage();
  const intent = await createDirectUploadIntent(
    { userId: USER, role: "VENDOR", purpose: "product", contentType: "image/jpeg", size: 123456 },
    { deps }
  );
  assert.equal(intent.uploadId, ID);
  assert.equal(intent.method, "PUT");
  assert.deepEqual(intent.headers, { "Content-Type": "image/jpeg" });
  const presign = deps.calls.find((c) => c.op === "presign");
  assert.equal(presign.input.Key, `staging/direct-images/product/${USER}/${ID}.jpg`);
  assert.equal(presign.input.ContentType, "image/jpeg");
  assert.equal(presign.input.ContentLength, 123456);
  assert.equal(presign.expiresIn, 600);
  assert.equal(deps.calls.some((c) => c.op !== "presign"), false, "intenția nu scrie nimic în R2");
});

test("intenție: rol, scop, tip și mărime", async () => {
  const deps = fakeStorage();
  const base = { userId: USER, role: "VENDOR", purpose: "product", contentType: "image/jpeg", size: 5000 };
  await assert.rejects(createDirectUploadIntent({ ...base, role: "USER" }, { deps }), { status: 403 });
  await assert.rejects(createDirectUploadIntent({ ...base, purpose: "fair-reception" }, { deps }), { status: 403 });
  await createDirectUploadIntent({ ...base, role: "ADMIN", purpose: "fair-reception" }, { deps });
  await assert.rejects(createDirectUploadIntent({ ...base, purpose: "avatars" }, { deps }), { code: "invalid_purpose" });
  await assert.rejects(createDirectUploadIntent({ ...base, contentType: "image/png" }, { deps }), (e) => e.fallback === true);
  await assert.rejects(createDirectUploadIntent({ ...base, size: DIRECT_IMAGE_MAX_BYTES + 1 }, { deps }), (e) => e.fallback === true);
  await assert.rejects(createDirectUploadIntent({ ...base, size: 0 }, { deps }), { code: "invalid_size" });
  await assert.rejects(createDirectUploadIntent({ ...base, size: "12.5" }, { deps }), { code: "invalid_size" });
});

test("intenție: limită pe utilizator (429 + Retry-After), separat pe utilizatori", async () => {
  const deps = fakeStorage();
  const limiter = createUserRateLimiter({ max: 2, windowMs: 60_000, now: () => 1000 });
  const base = { role: "VENDOR", purpose: "product", contentType: "image/jpeg", size: 5000 };
  await createDirectUploadIntent({ ...base, userId: USER }, { deps, limiter });
  await createDirectUploadIntent({ ...base, userId: USER }, { deps, limiter });
  await assert.rejects(createDirectUploadIntent({ ...base, userId: USER }, { deps, limiter }), (e) => e.status === 429 && e.retryAfterSeconds > 0);
  await createDirectUploadIntent({ ...base, userId: OTHER }, { deps, limiter });
});

test("confirmare: JPEG curat -> locația definitivă products/<user>/, cheia temporară ștearsă", async () => {
  const deps = fakeStorage();
  const body = await jpeg();
  const stagingKey = await staged(deps, body);
  const result = await completeDirectUpload({ userId: USER, role: "VENDOR", purpose: "product", uploadId: ID }, { deps });
  assert.equal(result.url, `https://cdn.test/products/${USER}/${ID}.jpg`);
  assert.equal(result.width, 1200);
  const saved = deps.objects.get(`products/${USER}/${ID}.jpg`);
  assert.ok(saved.body.equals(body), "se scriu exact octeții verificați");
  assert.equal(saved.contentType, "image/jpeg");
  assert.match(saved.cacheControl, /immutable/);
  assert.equal(deps.objects.has(stagingKey), false);
  // citirea e plafonată (Range), chiar dacă obiectul ar fi înlocuit între HEAD și GET
  assert.equal(deps.calls.find((c) => c.op === "GetObjectCommand").input.Range, `bytes=0-${DIRECT_IMAGE_MAX_BYTES}`);
});

test("confirmare repetată: același URL, fără a doua scriere", async () => {
  const deps = fakeStorage();
  await staged(deps, await jpeg());
  const first = await completeDirectUpload({ userId: USER, role: "VENDOR", purpose: "product", uploadId: ID }, { deps });
  const putsBefore = deps.calls.filter((c) => c.op === "PutObjectCommand").length;
  const second = await completeDirectUpload({ userId: USER, role: "VENDOR", purpose: "product", uploadId: ID }, { deps });
  assert.equal(second.url, first.url);
  assert.equal(deps.calls.filter((c) => c.op === "PutObjectCommand").length, putsBefore);
});

test("alt utilizator NU poate confirma încărcarea mea (cheia vine din contul lui)", async () => {
  const deps = fakeStorage();
  const stagingKey = await staged(deps, await jpeg(), { userId: USER });
  await assert.rejects(
    completeDirectUpload({ userId: OTHER, role: "VENDOR", purpose: "product", uploadId: ID }, { deps }),
    { status: 404, code: "upload_not_found" }
  );
  assert.equal(deps.objects.has(stagingKey), true, "fișierul meu rămâne neatins");
  assert.equal([...deps.objects.keys()].some((k) => k.startsWith("products/")), false);
});

test("Vânzătorul nu poate confirma pe scopul Admin (recepția Târgului)", async () => {
  const deps = fakeStorage();
  await staged(deps, await jpeg(), { purpose: "fair-reception" });
  await assert.rejects(
    completeDirectUpload({ userId: USER, role: "VENDOR", purpose: "fair-reception", uploadId: ID }, { deps }),
    { status: 403 }
  );
  const ok = await completeDirectUpload({ userId: USER, role: "ADMIN", purpose: "fair-reception", uploadId: ID }, { deps });
  assert.equal(ok.url, `https://cdn.test/artfest-fair-reception/${USER}/${ID}.jpg`);
});

test("tipul REAL contează, nu cel declarat: text/HTML numit .jpg -> 415, șters", async () => {
  const deps = fakeStorage();
  const stagingKey = await staged(deps, Buffer.from(`<html><script>alert(1)</script></html>${" ".repeat(400)}`));
  await assert.rejects(
    completeDirectUpload({ userId: USER, role: "VENDOR", purpose: "product", uploadId: ID }, { deps }),
    { status: 415, code: "invalid_image" }
  );
  assert.equal(deps.objects.has(stagingKey), false);
  assert.equal([...deps.objects.keys()].some((k) => k.startsWith("products/")), false);
});

test("JPEG trunchiat / deteriorat -> 415", async () => {
  const deps = fakeStorage();
  const full = await jpeg(1600, 1200);
  await staged(deps, full.subarray(0, Math.floor(full.length / 2)));
  await assert.rejects(
    completeDirectUpload({ userId: USER, role: "VENDOR", purpose: "product", uploadId: ID }, { deps }),
    { status: 415 }
  );
});

test("are nevoie de procesare pe server (EXIF, > 2400 px, PNG) -> 422 fallback, cheia ștearsă", async () => {
  for (const body of [
    await jpeg(800, 600, { exif: true }),
    await jpeg(2401, 1000),
    await sharp({ create: { width: 50, height: 50, channels: 4, background: "#fff" } }).png().toBuffer(),
  ]) {
    const deps = fakeStorage();
    const stagingKey = await staged(deps, body);
    await assert.rejects(
      completeDirectUpload({ userId: USER, role: "VENDOR", purpose: "product", uploadId: ID }, { deps }),
      (e) => e instanceof DirectUploadError && e.status === 422 && e.fallback === true
    );
    assert.equal(deps.objects.has(stagingKey), false, "fără dubluri: ruta veche va crea singura copie");
  }
});

test("mărime peste limită în R2 -> 413, ștearsă; fișier lipsă -> 404", async () => {
  const deps = fakeStorage();
  const stagingKey = await staged(deps, Buffer.alloc(DIRECT_IMAGE_MAX_BYTES + 10, 1));
  await assert.rejects(
    completeDirectUpload({ userId: USER, role: "VENDOR", purpose: "product", uploadId: ID }, { deps }),
    { status: 413 }
  );
  assert.equal(deps.objects.has(stagingKey), false);
  await assert.rejects(
    completeDirectUpload({ userId: USER, role: "VENDOR", purpose: "product", uploadId: ID }, { deps }),
    { status: 404, code: "upload_not_found" }
  );
});

test("verifyDirectImage: 2400 px exact e acceptat", async () => {
  const info = await verifyDirectImage(await jpeg(2400, 1800));
  assert.deepEqual(info, { width: 2400, height: 1800 });
});

test("URL-ul semnat real include content-length + content-type în semnătură, fără sumă de control pe corp gol", async () => {
  const { defaultDirectUploadDeps } = await import("./directImageUpload.js");
  const deps = defaultDirectUploadDeps({
    R2_ACCOUNT_ID: "acc",
    R2_ACCESS_KEY_ID: "AKIDTEST",
    R2_SECRET_ACCESS_KEY: "secret-test",
    R2_BUCKET_NAME: "bucket-test",
  });
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const url = new URL(
    await deps.presign(new PutObjectCommand({ Bucket: "bucket-test", Key: "staging/x.jpg", ContentType: "image/jpeg", ContentLength: 4321 }), 600)
  );
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;content-type;host");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "600");
  assert.equal([...url.searchParams.keys()].some((k) => k.toLowerCase().includes("checksum")), false);
});
