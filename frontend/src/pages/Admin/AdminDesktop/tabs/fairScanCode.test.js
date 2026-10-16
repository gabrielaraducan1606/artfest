// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/fairScanCode.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraErrorReason, createScanDeduper, extractFairCode } from "./fairScanCode.js";

test("QR cu codul exact AF... => același cod ca scannerul USB", () => {
  assert.deepEqual(extractFairCode("AF7K3M9QXT"), { ok: true, code: "AF7K3M9QXT" });
  // litere mici / cratime / spații (ca textul de sub codul de bare)
  assert.deepEqual(extractFairCode(" af-7k3m-9qxt\n"), { ok: true, code: "AF7K3M9QXT" });
});

test("QR invalid, gol sau care nu e Artfest => motiv clar", () => {
  assert.equal(extractFairCode("").reason, "empty");
  assert.equal(extractFairCode("https://artfest.ro/produs/123").reason, "not_af");
  assert.equal(extractFairCode("BF7K3M9QXT").reason, "not_af");
  assert.equal(extractFairCode("AF123").reason, "invalid");
  // alfabetul codurilor exclude 0/O/1/I/L/U/Y/Z
  assert.equal(extractFairCode("AF0K3M9QXT").reason, "invalid");
});

test("erori cameră: refuzată / inexistentă / indisponibilă / fără HTTPS", () => {
  assert.equal(cameraErrorReason({ name: "NotAllowedError" }), "denied");
  assert.equal(cameraErrorReason({ name: "NotFoundError" }), "no_camera");
  assert.equal(cameraErrorReason("No camera found."), "no_camera");
  assert.equal(cameraErrorReason({ name: "NotReadableError" }), "unavailable");
  assert.equal(cameraErrorReason({ name: "NotAllowedError" }, { secure: false }), "insecure");
  assert.equal(cameraErrorReason(new TypeError("Failed to fetch dynamically imported module: /x.js")), "load_failed");
});

test("scanare repetată accidental: același cod nu se trimite de două ori în fereastră", () => {
  let t = 1000;
  const accept = createScanDeduper(4000, () => t);
  assert.equal(accept("AF7K3M9QXT"), true);
  t += 500;
  assert.equal(accept("AF7K3M9QXT"), false);
  assert.equal(accept("AF22222222"), true);
  t += 5000;
  assert.equal(accept("AF22222222"), true);
});
