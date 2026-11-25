// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/posCamera.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_MESSAGES,
  cameraConstraintsChain,
  cameraFailureReason,
  cameraResultAction,
  openCameraStream,
  stopMediaStream,
} from "./posCamera.js";

const err = (name, message = "") => Object.assign(new Error(message), { name });

test("camera: mesaje clare pentru fiecare eroare (permisiune, lipsă, ocupată, incompatibil, HTTP)", () => {
  assert.equal(cameraFailureReason(err("NotAllowedError")), "denied");
  assert.equal(cameraFailureReason(err("SecurityError")), "denied");
  assert.equal(cameraFailureReason(err("NotFoundError")), "no_camera");
  assert.equal(cameraFailureReason(err("OverconstrainedError")), "no_camera");
  assert.equal(cameraFailureReason(err("NotReadableError")), "busy");
  assert.equal(cameraFailureReason(err("AbortError")), "busy");
  assert.equal(cameraFailureReason(null, { hasMediaDevices: false }), "unsupported");
  assert.equal(cameraFailureReason(err("NotAllowedError"), { secure: false }), "insecure");
  assert.equal(cameraFailureReason(err("TypeError", "Failed to fetch dynamically imported module")), "load_failed");
  assert.equal(cameraFailureReason(err("Ceva")), "unavailable");
  for (const key of ["denied", "no_camera", "busy", "unsupported", "insecure", "load_failed", "unavailable"]) {
    assert.ok(CAMERA_MESSAGES[key], key);
  }
  assert.match(CAMERA_MESSAGES.denied, /refuzat/);
  assert.match(CAMERA_MESSAGES.busy, /folosită de altă aplicație/);
});

test("camera: preferă camera din spate, apoi orice cameră", () => {
  const chain = cameraConstraintsChain();
  assert.deepEqual(chain[0].video.facingMode, { exact: "environment" });
  assert.deepEqual(chain[1].video.facingMode, { ideal: "environment" });
  assert.equal(chain[2].video, true);
  assert.ok(chain.every((c) => c.audio === false));
});

test("camera: fără cameră în spate => alternativa; permisiune refuzată => fără alte încercări", async () => {
  const calls = [];
  const stream = { id: "s" };
  const fallback = {
    getUserMedia: async (c) => {
      calls.push(c);
      if (c.video?.facingMode) throw err("OverconstrainedError");
      return stream;
    },
  };
  assert.equal(await openCameraStream(fallback), stream);
  assert.equal(calls.length, 3);

  let denied = 0;
  await assert.rejects(
    openCameraStream({ getUserMedia: async () => { denied += 1; throw err("NotAllowedError"); } }),
    { name: "NotAllowedError" }
  );
  assert.equal(denied, 1);
  let busy = 0;
  await assert.rejects(openCameraStream({ getUserMedia: async () => { busy += 1; throw err("NotReadableError"); } }), { name: "NotReadableError" });
  assert.equal(busy, 1);
});

test("camera: oprirea fluxului oprește toate pistele", () => {
  const stopped = [];
  const tracks = [{ stop: () => stopped.push("video") }, { stop: () => stopped.push("audio") }];
  stopMediaStream({ getTracks: () => tracks });
  assert.deepEqual(stopped, ["video", "audio"]);
  stopMediaStream(null); // fără flux: nimic de oprit
});

test("camera: ce face fereastra după o citire", () => {
  assert.equal(cameraResultAction({ ok: true, title: "Spiriduș" }), "added");
  assert.equal(cameraResultAction({ ok: false, continueScanning: true, message: "QR de promovare" }), "continue");
  assert.equal(cameraResultAction({ ok: false, message: "Cod negăsit" }), "retry");
  assert.equal(cameraResultAction(undefined), "retry");
});
