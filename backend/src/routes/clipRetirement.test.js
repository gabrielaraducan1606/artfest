// src/routes/clipRetirement.test.js
//
// Retragerea căutării CLIP (modelul ocupă ~650 MB RAM - peste instanța
// Render de 512 MB):
//  - POST /api/public/products/search-by-image -> 410, fără să citească fișierul
//    și fără să încarce modelul;
//  - la pornire (toate rutele importate) biblioteca @huggingface/transformers /
//    onnxruntime NU se mai încarcă;
//  - imageToEmbedding fără CLIP_MODEL_ENABLED=1 -> embedding gol, model neatins;
//  - căutarea vizuală prin Asistentul AI (/api/assistant/products/search-by-image)
//    funcționează ca înainte;
//  - celelalte rute publice de produse rămân montate.
//
// Rulare: node --experimental-test-module-mocks --test src/routes/clipRetirement.test.js

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5/test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
delete process.env.CLIP_MODEL_ENABLED;

import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import sharp from "sharp";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const servers = [];
const restores = [];
let assistantCalls = [];

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

let publicUrl;
let assistantUrl;
let publicRouter;
let embeddings;

before(async () => {
  // serviciul AI simulat (fără OpenAI); ruta reală a asistentului rămâne neschimbată
  restores.push(
    mock.module("./assistantRoutes/assistant/assitantRoutes.service.js", {
      namedExports: {
        searchByImage: async ({ file }) => {
          assistantCalls.push(file?.mimetype);
          return { type: "image", products: [{ id: "p1" }], message: "Am analizat fotografia și am găsit produse asemănătoare." };
        },
        searchByText: async () => ({}),
        recommendGifts: async () => ({}),
        searchByBudget: async () => ({}),
        refineProductSearch: async () => ({}),
        getSavedProductSearch: async () => ({}),
      },
    })
  );

  publicRouter = (await import("./publicProductRoutes.js")).default;
  const publicApp = express();
  publicApp.use("/api/public", publicRouter);
  publicUrl = await listen(publicApp);

  const { default: assistantProductsRouter } = await import("./assistantRoutes/assistant/assistantProductsRoutes.js");
  const assistantApp = express();
  assistantApp.use("/api/assistant/products", assistantProductsRouter);
  assistantUrl = await listen(assistantApp);

  embeddings = await import("../lib/embeddings.js");
});

after(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  restores.forEach((r) => r.restore());
});

const photo = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 120, b: 60 } } }).jpeg().toBuffer();

async function postImage(url, buffer) {
  const body = new FormData();
  body.append("image", new Blob([buffer], { type: "image/jpeg" }), "poza.jpg");
  const res = await fetch(url, { method: "POST", body });
  return { status: res.status, body: await res.json() };
}

test("ruta veche CLIP -> 410 cu mesaj care trimite la Asistent; modelul NU se încarcă", async () => {
  const res = await postImage(`${publicUrl}/api/public/products/search-by-image`, await photo());
  assert.equal(res.status, 410);
  assert.equal(res.body.error, "IMAGE_SEARCH_RETIRED");
  assert.match(res.body.message, /Asistentul Artfest/);
  assert.equal(res.body.replacement, "/api/assistant/products/search-by-image");
  assert.equal(embeddings.clipModelLoadAttempts(), 0);

  // și fără fișier
  const empty = await fetch(`${publicUrl}/api/public/products/search-by-image`, { method: "POST" });
  assert.equal(empty.status, 410);
});

test("ruta 410 nu mai are upload / procesare: un singur handler, fără multer", () => {
  const layer = publicRouter.stack.find((l) => l.route?.path === "/products/search-by-image");
  assert.ok(layer, "ruta există (410), nu 404");
  assert.equal(layer.route.stack.length, 1);
  assert.equal(layer.route.methods.post, true);
});

test("celelalte rute publice de produse rămân montate", () => {
  const paths = publicRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  for (const expected of ["GET /products", "GET /products/:id"]) {
    assert.ok(paths.includes(expected), `${expected} lipsește din ${paths.join(", ")}`);
  }
});

test("imageToEmbedding fără CLIP_MODEL_ENABLED=1 -> embedding gol, fără decodare și fără model", async () => {
  assert.equal(embeddings.clipModelEnabled({}), false);
  assert.equal(embeddings.clipModelEnabled({ CLIP_MODEL_ENABLED: "1" }), true);
  const emb = await embeddings.imageToEmbedding(await photo());
  assert.equal(emb.length, 512);
  assert.ok(emb.every((v) => v === 0));
  assert.equal(embeddings.clipModelLoadAttempts(), 0);
});

test("căutarea vizuală prin Asistentul AI funcționează ca înainte (independent de CLIP)", async () => {
  assistantCalls = [];
  const res = await postImage(`${assistantUrl}/api/assistant/products/search-by-image`, await photo());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.type, "image");
  assert.deepEqual(res.body.products, [{ id: "p1" }]);
  assert.deepEqual(assistantCalls, ["image/jpeg"]);

  const missing = await fetch(`${assistantUrl}/api/assistant/products/search-by-image`, { method: "POST" });
  assert.equal(missing.status, 400);
  assert.equal(embeddings.clipModelLoadAttempts(), 0);
});

test("la pornire (TOATE rutele + serviciul real al asistentului) @huggingface/transformers și onnxruntime NU se încarcă", () => {
  // proces Node separat, fără mock-uri: înregistrează fiecare modul rezolvat
  const script = `
    import { registerHooks } from "node:module";
    import { readdirSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    import path from "node:path";
    const seen = new Set();
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (/@huggingface\\/transformers|@xenova\\/transformers|onnxruntime/.test(specifier)) seen.add(specifier);
        return nextResolve(specifier, context);
      },
    });
    const dirs = ["src/routes", "src/routes/assistantRoutes", "src/routes/assistantRoutes/assistant", "src/jobs"];
    let loaded = 0;
    for (const dir of dirs) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".js") || name.includes(".test.")) continue;
        try { await import(pathToFileURL(path.resolve(dir, name)).href); loaded += 1; } catch {}
      }
    }
    console.log(JSON.stringify({ loaded, transformers: [...seen] }));
    process.exit(0);
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: backendDir,
    env: { ...process.env, CLIP_MODEL_ENABLED: "", NODE_ENV: "test" },
    encoding: "utf8",
    timeout: 120_000,
  });
  const line = out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  const result = JSON.parse(line);
  assert.ok(result.loaded > 100, `module încărcate: ${result.loaded}`);
  assert.deepEqual(result.transformers, [], "biblioteca CLIP nu se încarcă la pornire");
});
