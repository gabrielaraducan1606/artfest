// backend/src/services/heicDecodeWorker.js
//
// Worker (worker_threads) pentru decodarea UNEI fotografii HEIC/HEIF.
// De ce separat: libheif rulează în WebAssembly, iar memoria WASM NU se mai
// eliberează în proces după decodare (măsurat: o fotografie de 45 MP lasă
// procesul la ~665 MB după GC). Worker-ul e oprit după fiecare fotografie, iar
// memoria lui se eliberează odată cu el - serverul principal rămâne mic.
//
// Intrare (workerData): { buffer: ArrayBuffer, maxPixels: number }
// Ieșire (postMessage):
//   { ok: true, width, height, data: ArrayBuffer (RGBA) }
//   { ok: false, unavailable: true }            - heic-decode nu e instalat
//   { ok: false, tooLarge: true, width, height } - peste plafon, NEDECODAT
//   { ok: false, message }                      - fișier corupt / nesuportat

import { parentPort, workerData } from "node:worker_threads";

let decoder = null;
try {
  const mod = await import("heic-decode");
  decoder = mod.default || mod;
} catch (error) {
  parentPort.postMessage({ ok: false, unavailable: true, message: error?.code || error?.message || "heic-decode lipsă" });
}

if (decoder) {
  let images = null;
  try {
    // `all`: citește containerul și dimensiunile FĂRĂ să aloce pixelii
    images = await decoder.all({ buffer: new Uint8Array(workerData.buffer) });
    const first = images[0];
    const width = Number(first?.width);
    const height = Number(first?.height);

    if (!width || !height) {
      parentPort.postMessage({ ok: false, message: "HEIC fără imagine principală" });
    } else if (width * height > workerData.maxPixels) {
      // plafonul se verifică ÎNAINTE de alocarea width*height*4 octeți
      parentPort.postMessage({ ok: false, tooLarge: true, width, height });
    } else {
      const image = await first.decode();
      // Uint8ClampedArray nou, cu buffer propriu -> transferat fără copie
      const data = image.data.buffer;
      parentPort.postMessage({ ok: true, width: image.width, height: image.height, data }, [data]);
    }
  } catch (error) {
    parentPort.postMessage({ ok: false, message: error?.message || "HEIC corupt" });
  } finally {
    try {
      images?.dispose?.();
    } catch {
      /* worker-ul se oprește oricum */
    }
  }
}
