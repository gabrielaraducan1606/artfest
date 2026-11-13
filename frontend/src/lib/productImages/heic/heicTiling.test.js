// Rulare: node --test src/lib/productImages/heic/heicTiling.test.js
//
// Logica pură a conversiei HEIC în browser (fără browser): dimensiuni, planul de
// tile-uri (grile reale de telefon), bugetul de memorie pe dispozitiv, culori
// Display P3 -> sRGB și integrarea în pregătire + coadă (conversie injectată).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";

import {
  convertDisplayP3ToSrgbInPlace,
  deviceDecodeBudgetBytes,
  fullFrameDecodeBytes,
  heicDecodePlan,
  heicOutputSize,
  heicTilePlan,
  isDisplayP3Profile,
} from "./heicTiling.js";
import { heicFatalMessage, prepareProductImage } from "../prepareProductImage.js";
import { createProductImageQueue } from "../productImageQueue.js";

const MB = 1024 * 1024;

test("dimensiuni: Samsung 50 MP / iPhone 48 MP / 24 MP / 12 MP -> max 2400 px, proporții păstrate; fără mărire", () => {
  assert.deepEqual(heicOutputSize(8160, 6120).width, 2400);
  assert.equal(heicOutputSize(8160, 6120).height, 1800);
  assert.deepEqual([heicOutputSize(8064, 6048).width, heicOutputSize(8064, 6048).height], [2400, 1800]);
  assert.deepEqual([heicOutputSize(4284, 5712).width, heicOutputSize(4284, 5712).height], [1800, 2400], "portret");
  assert.deepEqual([heicOutputSize(4000, 3000).width, heicOutputSize(4000, 3000).height], [2400, 1800]);
  assert.deepEqual([heicOutputSize(1280, 720).width, heicOutputSize(1280, 720).height], [1280, 720]);
});

function assertPlanCovers(plan, outWidth, outHeight, columns, rows) {
  // pe fiecare rând de tile-uri lățimile se adună exact la lățimea finală, fără goluri / suprapuneri
  for (let ty = 0; ty < rows; ty += 1) {
    const row = plan.filter((p) => p.ty === ty).sort((a, b) => a.dx - b.dx);
    assert.equal(row[0].dx, 0);
    for (let i = 1; i < row.length; i += 1) assert.equal(row[i].dx, row[i - 1].dx + row[i - 1].dw, `rând ${ty}, tile ${i}`);
    assert.equal(row.at(-1).dx + row.at(-1).dw, outWidth);
  }
  for (let tx = 0; tx < columns; tx += 1) {
    const col = plan.filter((p) => p.tx === tx).sort((a, b) => a.dy - b.dy);
    for (let i = 1; i < col.length; i += 1) assert.equal(col[i].dy, col[i - 1].dy + col[i - 1].dh);
    assert.equal(col.at(-1).dy + col.at(-1).dh, outHeight);
  }
}

test("plan de tile-uri: grilă Samsung 50 MP (16x12 de 512 px, ultima coloană parțială) acoperă exact imaginea finală", () => {
  const out = heicOutputSize(8160, 6120);
  const plan = heicTilePlan({ imageWidth: 8160, imageHeight: 6120, tileWidth: 512, tileHeight: 512, columns: 16, rows: 12, outWidth: out.width, outHeight: out.height });
  assert.equal(plan.length, 16 * 12);
  const lastCol = plan.find((p) => p.tx === 15 && p.ty === 0);
  assert.equal(lastCol.sw, 8160 - 15 * 512, "tile-ul de la margine folosește doar partea din imagine");
  const lastRow = plan.find((p) => p.tx === 0 && p.ty === 11);
  assert.equal(lastRow.sh, 6120 - 11 * 512);
  assertPlanCovers(plan, out.width, out.height, 16, 12);
});

test("plan de tile-uri: grilă DECUPATĂ (C022: 2x2 de 1280x720 pentru o imagine de 1440x960)", () => {
  const plan = heicTilePlan({ imageWidth: 1440, imageHeight: 960, tileWidth: 1280, tileHeight: 720, columns: 2, rows: 2, outWidth: 1440, outHeight: 960 });
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((p) => [p.sw, p.sh]), [[1280, 720], [160, 720], [1280, 240], [160, 240]]);
  assertPlanCovers(plan, 1440, 960, 2, 2);
});

test("memorie pe telefon: grilele de orice mărime (50 MP) se decodează pe tile-uri; imaginile NE-grilă doar dacă încap", () => {
  const phone = deviceDecodeBudgetBytes({ deviceMemoryGB: 4, mobile: true }); // 256 MB
  const unknownPhone = deviceDecodeBudgetBytes({ mobile: true }); // 160 MB
  const lowEnd = deviceDecodeBudgetBytes({ deviceMemoryGB: 1, mobile: true }); // 96 MB minim
  assert.equal(phone, 256 * MB);
  assert.equal(unknownPhone, 160 * MB);
  assert.equal(lowEnd, 96 * MB);
  assert.equal(deviceDecodeBudgetBytes({ deviceMemoryGB: 8, mobile: true }), 256 * MB, "telefon: plafon prudent 256 MB");
  assert.equal(deviceDecodeBudgetBytes({ deviceMemoryGB: 8, mobile: false }), 480 * MB);

  const samsung50 = { width: 8160, height: 6120, columns: 16, rows: 12, tileWidth: 512, tileHeight: 512 };
  assert.deepEqual(heicDecodePlan({ ...samsung50, budgetBytes: lowEnd }), { ok: true, mode: "tiles" }, "~2,6 MB per tile");

  const single45 = { width: 8256, height: 5504, columns: 1, rows: 1, tileWidth: 8256, tileHeight: 5504 };
  assert.deepEqual(heicDecodePlan({ ...single45, budgetBytes: unknownPhone }), { ok: false, reason: "too_large_for_device" });
  assert.deepEqual(heicDecodePlan({ ...single45, budgetBytes: 480 * MB }), { ok: true, mode: "full" }, "desktop");

  const single12 = { width: 4000, height: 3000, columns: 1, rows: 1, tileWidth: 4000, tileHeight: 3000 };
  assert.deepEqual(heicDecodePlan({ ...single12, budgetBytes: unknownPhone }), { ok: true, mode: "full" });
  assert.equal(fullFrameDecodeBytes(4000, 3000), 120_000_000);

  assert.deepEqual(heicDecodePlan({ width: 0, height: 0, columns: 0, rows: 0, budgetBytes: phone }), { ok: false, reason: "invalid" });
});

test("profil Display P3: nclx 12 sau ICC „Display P3”; sRGB / lipsă -> nu", () => {
  assert.equal(isDisplayP3Profile({ nclxPrimaries: 12 }), true);
  assert.equal(isDisplayP3Profile({ nclxPrimaries: 1 }), false, "BT.709 / sRGB");
  const icc = new TextEncoder().encode("....desc....Display P3....");
  assert.equal(isDisplayP3Profile({ iccBytes: icc }), true);
  assert.equal(isDisplayP3Profile({ iccBytes: new TextEncoder().encode("sRGB IEC61966-2.1") }), false);
  assert.equal(isDisplayP3Profile({}), false);
});

test("Display P3 -> sRGB: aceeași conversie ca pe server (200,100,100 -> ~215,93,97); alb / negru / gri neschimbate", () => {
  const px = new Uint8ClampedArray([200, 100, 100, 255, 255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255]);
  convertDisplayP3ToSrgbInPlace(px);
  assert.ok(px[0] >= 212 && px[0] <= 218 && px[1] >= 90 && px[1] <= 96 && px[2] >= 94 && px[2] <= 100, `${px[0]},${px[1]},${px[2]}`);
  assert.deepEqual([...px.slice(4, 8)], [255, 255, 255, 255]);
  assert.deepEqual([...px.slice(8, 12)], [0, 0, 0, 255]);
  assert.ok(Math.abs(px[12] - 128) <= 1 && Math.abs(px[13] - 128) <= 1 && Math.abs(px[14] - 128) <= 1, "griul rămâne gri");
});

/* ---------------- integrare: pregătire + coadă (conversie injectată, fără browser) ---------------- */

const heicFile = (name = "20261112_091459.heic") => new File([new Uint8Array(64)], name, { type: "image/heic" });

test("pregătire HEIC: browserul fără decodor nativ -> conversie locală, etapa „optimizing”, JPEG rezultat", async () => {
  const stages = [];
  const converted = new File([new Uint8Array(10)], "20261112_091459.jpg", { type: "image/jpeg" });
  const result = await prepareProductImage(heicFile(), {
    kind: "heic",
    onStage: (s) => stages.push(s),
    convertHeic: async () => ({ file: converted, width: 2400, height: 1800 }),
  });
  assert.equal(result.processed, true);
  assert.equal(result.via, "heic-browser");
  assert.equal(result.file, converted);
  assert.deepEqual(stages, ["optimizing"]);
});

test("pregătire HEIC: deteriorat / prea mare pentru dispozitiv -> mesaj clar (fără upload); browser nesuportat -> server", async () => {
  const fail = (code, extra = {}) => async () => {
    throw Object.assign(new Error(code), { code, ...extra });
  };
  const corrupt = await prepareProductImage(heicFile(), { kind: "heic", convertHeic: fail("heic_corrupt") });
  assert.match(corrupt.fatalMessage, /deteriorată/);

  const big = await prepareProductImage(heicFile(), { kind: "heic", convertHeic: fail("too_large_for_device", { sourceWidth: 8256, sourceHeight: 5504 }) });
  assert.match(big.fatalMessage, /\(45 MP\) este prea mare pentru memoria acestui dispozitiv/);

  const unsupported = await prepareProductImage(heicFile(), { kind: "heic", convertHeic: fail("unsupported") });
  assert.equal(unsupported.fatalMessage, undefined);
  assert.equal(unsupported.via, "server");
  assert.equal(heicFatalMessage({ code: "timeout" }), "", "timpul depășit nu e definitiv: serverul încearcă (doar ≤ 16 MP)");
});

test("coada: etapa „Se optimizează” + progres pe tile-uri; refuzul definitiv din pregătire NU ajunge la server", async () => {
  const uploads = [];
  const stagesSeen = [];
  const queue = createProductImageQueue({
    createPreview: () => "",
    revokePreview: () => {},
    readHead: async () => Uint8Array.from([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0]),
    upload: async (file) => {
      uploads.push(file.name);
      return { url: `https://cdn/${file.name}` };
    },
    prepare: async (file, { onStage, onProgress }) => {
      onStage("optimizing");
      onProgress(3, 12);
      stagesSeen.push(queue.getSnapshot().items.find((i) => i.name === file.name)?.stage);
      if (file.name.startsWith("stricat")) return { file, processed: false, fatalMessage: "„stricat.heic” pare deteriorată…" };
      return { file: new File([new Uint8Array(4)], file.name.replace(/heic$/, "jpg"), { type: "image/jpeg" }), processed: true };
    },
  });

  await queue.addFiles([heicFile("bun.heic"), heicFile("stricat.heic")]);
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setImmediate(r));

  const [ok, bad] = queue.getSnapshot().items;
  assert.deepEqual(stagesSeen, ["optimizing", "optimizing"]);
  assert.equal(ok.status, "done");
  assert.equal(bad.status, "error");
  assert.equal(bad.retryable, false);
  assert.match(bad.error, /deteriorată/);
  assert.deepEqual(uploads, ["bun.jpg"], "doar JPEG-ul convertit a fost trimis; cel deteriorat nu");
  queue.destroy();
});
