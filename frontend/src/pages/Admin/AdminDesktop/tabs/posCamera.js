// src/pages/Admin/AdminDesktop/tabs/posCamera.js
//
// Camera telefonului în POS-ul Târgului („Scanează cu camera”):
//  - pornirea camerei (preferă camera din spate, cu alternative) și oprirea
//    TUTUROR fluxurilor la închidere;
//  - erorile clare (permisiune, lipsă cameră, cameră ocupată, browser incompatibil);
//  - detectorul de cadre: QR prin biblioteca existentă din proiect (qr-scanner,
//    folosită și la Recepție: BarcodeDetector unde există, altfel worker propriu,
//    inclusiv pe iPhone / Safari) + Code128 prin BarcodeDetector, dacă browserul
//    îl suportă, altfel prin decodorul JS (fairCode128.js).
// Codul citit trece apoi prin EXACT aceeași normalizare / validare / adăugare în
// coș ca scannerul USB (AdminFairPosPanel -> classifyScan + lookup).

import { decodeCode128Image } from "./fairCode128.js";

export const CAMERA_MESSAGES = Object.freeze({
  insecure: "Camera funcționează doar pe o conexiune securizată (HTTPS).",
  unsupported:
    "Browserul acesta nu permite accesul la cameră. Folosește Chrome (Android) sau Safari (iPhone) actualizat ori câmpul de cod.",
  denied:
    "Accesul la cameră a fost refuzat. Permite camera pentru acest site (pe iPhone: Setări → Safari → Cameră), apoi apasă „Reîncearcă”.",
  no_camera: "Nu am găsit nicio cameră pe acest dispozitiv. Folosește câmpul de cod sau scannerul.",
  busy: "Camera e folosită de altă aplicație sau de alt tab. Închide-o acolo, apoi apasă „Reîncearcă”.",
  load_failed: "Scannerul nu s-a putut încărca. Reîncarcă pagina și încearcă din nou.",
  unavailable: "Camera nu poate fi pornită acum. Apasă „Reîncearcă” sau folosește câmpul de cod.",
});

/** Eroarea de la getUserMedia / încărcarea scannerului -> cheia mesajului. */
export function cameraFailureReason(error, { secure = true, hasMediaDevices = true } = {}) {
  if (!secure) return "insecure";
  if (!hasMediaDevices) return "unsupported";
  const message = String(error?.message || "");
  if (/dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(message)) {
    return "load_failed";
  }
  const name = String(error?.name || error || "");
  if (/NotAllowed|PermissionDenied|Security/i.test(name)) return "denied";
  if (/NotFound|DevicesNotFound|Overconstrained/i.test(name)) return "no_camera";
  if (/NotReadable|TrackStart|Abort/i.test(name)) return "busy";
  // doar eroarea explicită a browserului; un TypeError din cod NU înseamnă „browser incompatibil”
  if (/NotSupported/i.test(name)) return "unsupported";
  return "unavailable";
}

/*
 * Constrângerile încercate, în ordine: camera din spate obligatoriu, apoi
 * preferată, apoi orice cameră (laptop, tabletă fără cameră spate).
 * Rezoluție mare (ideal 1920×1080): barele codului Code128 sunt subțiri.
 */
export function cameraConstraintsChain() {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  return [
    { audio: false, video: { ...size, facingMode: { exact: "environment" } } },
    { audio: false, video: { ...size, facingMode: { ideal: "environment" } } },
    { audio: false, video: true },
  ];
}

// erori după care NU mai încercăm altă constrângere (aceeași cauză ar reapărea)
export function isFinalCameraError(error) {
  return /NotAllowed|PermissionDenied|Security|NotReadable|TrackStart|Abort/i.test(String(error?.name || ""));
}

/** Pornește camera: camera din spate dacă există, altfel prima disponibilă. */
export async function openCameraStream(mediaDevices = globalThis.navigator?.mediaDevices) {
  let lastError = null;
  for (const constraints of cameraConstraintsChain()) {
    try {
      return await mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (isFinalCameraError(error)) throw error;
    }
  }
  throw lastError || new Error("NotFoundError");
}

/** Oprește toate pistele (camera se stinge imediat, inclusiv indicatorul din browser). */
export function stopMediaStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks?.() || []) {
    try {
      track.stop();
    } catch {
      /* deja oprită */
    }
  }
}

/*
 * Detectorul pentru un cadru (canvas): întoarce textul citit sau null.
 *  - QR: qr-scanner (createQrEngine: BarcodeDetector nativ unde există, altfel worker JS);
 *  - Code128: BarcodeDetector nativ dacă suportă „code_128”, altfel decodorul JS.
 * Nu ne bazăm exclusiv pe BarcodeDetector: pe iPhone / Safari lipsește sau nu are Code128.
 */
export async function createFrameDetector() {
  const { default: QrScanner } = await import("qr-scanner");
  const qrEngine = await QrScanner.createQrEngine();
  let native128 = null;
  try {
    const Detector = globalThis.BarcodeDetector;
    if (Detector && (await Detector.getSupportedFormats?.())?.includes("code_128")) {
      native128 = new Detector({ formats: ["code_128"] });
    }
  } catch {
    native128 = null;
  }

  async function detect(canvas) {
    try {
      const result = await QrScanner.scanImage(canvas, {
        qrEngine,
        canvas: null,
        returnDetailedScanResult: true,
        alsoTryWithoutScanRegion: true,
      });
      if (result?.data) return { text: result.data, format: "qr" };
    } catch {
      /* niciun QR în cadru */
    }
    if (native128) {
      try {
        const found = await native128.detect(canvas);
        if (found?.[0]?.rawValue) return { text: found[0].rawValue, format: "code128" };
      } catch {
        /* cadru ilizibil */
      }
      return null;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const text = decodeCode128Image(ctx.getImageData(0, 0, canvas.width, canvas.height));
    return text ? { text, format: "code128" } : null;
  }

  function close() {
    if (typeof Worker !== "undefined" && qrEngine instanceof Worker) qrEngine.terminate();
  }

  return { detect, close, engine: native128 ? "native-code128" : "js-code128" };
}

/*
 * Ce face fereastra cu rezultatul unei citiri (POS -> scanFromCamera):
 *  - "added":  produs adăugat -> camera se oprește, fereastra se închide;
 *  - "continue": QR de promovare / cod care nu e de produs -> mesaj, scanarea continuă;
 *  - "retry":  cod necunoscut / nerecepționat / fără stoc / eroare de conexiune ->
 *              mesaj, scanarea se oprește până la „Reîncearcă” (fără cereri repetate).
 */
// handoff: POS continuă în altă fereastră (fișa de recepție pentru un produs nerecepționat sau
// „Cod negăsit” cu „Adaugă produs într-un magazin”) -> camera se închide, ca la „added”.
export function cameraResultAction(outcome) {
  if (outcome?.ok || outcome?.handoff) return "added";
  if (outcome?.continueScanning) return "continue";
  return "retry";
}
