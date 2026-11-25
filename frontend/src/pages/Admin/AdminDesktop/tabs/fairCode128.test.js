// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/fairCode128.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCode128Image, decodeCode128Runs, lineToRuns } from "./fairCode128.js";

// lățimile (în module) produse de bwip-js - biblioteca care tipărește etichetele (bwipjs.raw("code128", text)[0].sbs)
const BWIP = {
  AF7K3M9QXT: [2,1,1,2,1,4,1,1,1,3,2,3,1,3,2,3,1,1,3,1,2,1,3,1,1,1,2,3,3,1,2,2,1,1,3,2,1,1,3,1,2,3,3,2,1,1,2,2,2,1,1,3,3,1,3,3,1,1,2,1,2,1,3,3,1,1,2,3,1,3,1,1,2,3,3,1,1,1,2],
  // cu trecere în setul C (perechi de cifre)
  AF23456789: [2,1,1,2,1,4,1,1,1,3,2,3,1,3,2,3,1,1,1,1,3,1,4,1,3,1,2,1,3,1,1,1,3,1,2,3,1,4,1,1,2,2,2,1,2,1,4,1,3,1,1,1,4,1,2,3,3,1,1,1,2],
  AFKC3JRXD6: [2,1,1,2,1,4,1,1,1,3,2,3,1,3,2,3,1,1,1,1,2,3,3,1,1,3,1,3,2,1,2,2,1,1,3,2,1,1,2,1,3,3,2,3,1,1,3,1,3,3,1,1,2,1,1,1,2,3,1,3,2,2,3,1,1,2,1,3,2,2,1,2,2,3,3,1,1,1,2],
};

// cod de bare „tipărit”: zonă liberă albă + bare, cu `px` pixeli pe modul
function runsWithQuietZone(sbs, px = 3) {
  return [12 * px, ...sbs.map((w) => w * px), 12 * px];
}

// imagine RGBA: barele pe toată înălțimea, opțional rotită cu 90°
function barcodeImage(sbs, { px = 3, height = 60, vertical = false, noise = 0 } = {}) {
  const runs = runsWithQuietZone(sbs, px);
  const width = runs.reduce((a, b) => a + b, 0);
  const line = [];
  runs.forEach((w, i) => {
    for (let k = 0; k < w; k += 1) line.push(i % 2 === 1 ? 20 : 235); // primul run = alb
  });
  const [W, H] = vertical ? [height, width] : [width, height];
  const data = new Uint8ClampedArray(W * H * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * noise;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = Math.max(0, Math.min(255, line[vertical ? y : x] + rnd()));
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

test("Code128: decodează exact codurile tipărite de bwip-js (seturile B și C)", () => {
  for (const [text, sbs] of Object.entries(BWIP)) {
    assert.equal(decodeCode128Runs(runsWithQuietZone(sbs, 1), false), text);
    assert.equal(decodeCode128Runs(runsWithQuietZone(sbs, 4), false), text);
  }
});

test("Code128: imagine orizontală, verticală (rotită 90°), întoarsă (180°), cu zgomot", () => {
  const sbs = BWIP.AF7K3M9QXT;
  assert.equal(decodeCode128Image(barcodeImage(sbs)), "AF7K3M9QXT");
  assert.equal(decodeCode128Image(barcodeImage(sbs, { vertical: true })), "AF7K3M9QXT");
  assert.equal(decodeCode128Image(barcodeImage([...sbs].reverse())), "AF7K3M9QXT");
  assert.equal(decodeCode128Image(barcodeImage(sbs, { px: 2, noise: 60 })), "AF7K3M9QXT");
});

test("Code128: suma de control greșită / cod incomplet / fără cod => nimic (fără citiri false)", () => {
  const broken = BWIP.AF7K3M9QXT.slice();
  // un simbol de date înlocuit cu altul valid => suma de control nu mai corespunde
  broken.splice(6, 6, 2, 2, 2, 1, 2, 2);
  assert.equal(decodeCode128Runs(runsWithQuietZone(broken, 2), false), null);
  assert.equal(decodeCode128Runs(runsWithQuietZone(BWIP.AF7K3M9QXT.slice(0, 40), 2), false), null);
  const blank = { data: new Uint8ClampedArray(200 * 50 * 4).fill(240), width: 200, height: 50 };
  assert.equal(decodeCode128Image(blank), null);
  assert.equal(lineToRuns(new Float32Array(100).fill(128)), null);
  assert.equal(decodeCode128Image(null), null);
});
