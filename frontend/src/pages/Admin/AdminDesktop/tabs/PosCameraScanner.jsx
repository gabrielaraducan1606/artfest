// src/pages/Admin/AdminDesktop/tabs/PosCameraScanner.jsx
//
// POS -> „Scanează cu camera” (telefon): fereastra cu imaginea camerei. Citește
// QR-ul (codul AF) și codul de bare Code128 de pe eticheta produsului, apoi
// trimite textul citit la POS (onScan), care folosește aceeași normalizare,
// validare și adăugare în coș ca scannerul USB / câmpul de cod.
//  - o citire reușită = o bucată în coș; camera se oprește și fereastra se închide;
//  - cadrele repetate ale aceluiași cod nu se procesează de mai multe ori;
//  - QR de promovare: explicația, scanarea continuă (linkul NU se deschide);
//  - cod necunoscut / fără stoc / eroare: mesajul + „Reîncearcă”;
//  - toate fluxurile camerei se opresc la închidere, la ascunderea paginii și la demontare.

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./AdminFairPos.module.css";
import { createScanDeduper } from "./fairScanCode.js";
import {
  CAMERA_MESSAGES,
  cameraFailureReason,
  cameraResultAction,
  createFrameDetector,
  openCameraStream,
  stopMediaStream,
} from "./posCamera.js";

const FRAME_INTERVAL_MS = 160;
const MAX_FRAME_SIDE = 1280;

export default function PosCameraScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // starea citirii, sincronă (cadrele vin mai repede decât randarea)
  const scanRef = useRef({ busy: false, paused: false, done: false });
  // același text în 3 s = același cod văzut în cadre succesive
  const acceptRef = useRef(createScanDeduper(3000));
  // starting | scanning | checking | paused | error
  const [status, setStatus] = useState("starting");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let stream = null;
    let detector = null;
    let timer = null;
    const canvas = document.createElement("canvas");
    acceptRef.current = createScanDeduper(3000);
    scanRef.current = { busy: false, paused: false, done: false };
    setStatus("starting");

    const stopAll = () => {
      cancelled = true;
      clearTimeout(timer);
      stopMediaStream(stream);
      stream = null;
      const video = videoRef.current;
      if (video) {
        video.pause?.();
        video.srcObject = null;
      }
      detector?.close();
      detector = null;
    };

    async function handle(text) {
      const scan = scanRef.current;
      scan.busy = true;
      setStatus("checking");
      let outcome;
      try {
        outcome = await onScanRef.current(text);
      } catch {
        outcome = { ok: false, message: "Codul nu a putut fi verificat. Apasă „Reîncearcă”." };
      }
      if (cancelled) return;
      const action = cameraResultAction(outcome);
      if (action === "added") {
        scan.done = true;
        stopAll();
        onCloseRef.current({ added: true });
        return;
      }
      setMessage(outcome?.message || "");
      if (action === "continue") {
        scan.busy = false;
        setStatus("scanning");
      } else {
        scan.busy = false;
        scan.paused = true;
        setStatus("paused");
      }
    }

    async function tick() {
      if (cancelled) return;
      const scan = scanRef.current;
      const video = videoRef.current;
      if (!scan.busy && !scan.paused && !scan.done && video && video.readyState >= 2 && video.videoWidth) {
        const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, canvas.width, canvas.height);
        const found = await detector.detect(canvas);
        // același cod din cadrele următoare: ignorat (o citire = o procesare)
        if (!cancelled && found?.text && !scanRef.current.busy && !scanRef.current.paused && acceptRef.current(found.text.trim())) {
          await handle(found.text);
        }
      }
      if (!cancelled) timer = setTimeout(tick, FRAME_INTERVAL_MS);
    }

    async function start() {
      const secure = window.isSecureContext !== false;
      const hasMediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
      if (!secure || !hasMediaDevices) {
        setStatus("error");
        setMessage(CAMERA_MESSAGES[cameraFailureReason(null, { secure, hasMediaDevices })]);
        return;
      }
      try {
        stream = await openCameraStream(navigator.mediaDevices);
        if (cancelled) {
          stopMediaStream(stream);
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play().catch(() => {});
        detector = await createFrameDetector();
        if (cancelled) {
          detector.close();
          return;
        }
        setStatus("scanning");
        timer = setTimeout(tick, FRAME_INTERVAL_MS);
      } catch (error) {
        if (cancelled) return;
        console.warn("[POS] camera:", error?.name || "", error?.message || error);
        stopMediaStream(stream);
        stream = null;
        setStatus("error");
        setMessage(CAMERA_MESSAGES[cameraFailureReason(error, { secure, hasMediaDevices })]);
      }
    }

    // pagina ascunsă (alt tab, ecran blocat, navigare): camera se închide de tot
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        stopAll();
        onCloseRef.current({ added: false });
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", stopAll);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", stopAll);
      stopAll();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setMessage("");
    if (status === "error") {
      setAttempt((n) => n + 1); // repornește camera de la zero
      return;
    }
    // „Reîncearcă” = același cod poate fi citit din nou imediat
    acceptRef.current = createScanDeduper(3000);
    scanRef.current.paused = false;
    setStatus("scanning");
  }, [status]);

  // Escape închide fereastra (tastatură / scanner conectat)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onCloseRef.current({ added: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isError = status === "error";
  return (
    <div className={styles.cameraBackdrop} role="dialog" aria-modal="true" aria-label="Scanează cu camera">
      <div className={styles.cameraBox}>
        <div className={styles.cameraHead}>
          <strong>Scanează codul produsului</strong>
          <button type="button" className={styles.ghostBtn} onClick={() => onCloseRef.current({ added: false })}>
            Închide
          </button>
        </div>
        <div className={styles.cameraView}>
          {/* playsInline + muted: obligatorii pe iPhone ca imaginea să ruleze în pagină */}
          <video ref={videoRef} className={styles.cameraVideo} playsInline muted autoPlay />
          {status === "starting" && <p className={styles.cameraOverlay}>Se pornește camera…</p>}
          {status === "checking" && <p className={styles.cameraOverlay}>Se verifică codul…</p>}
          {status === "scanning" && <div className={styles.cameraFrame} aria-hidden="true" />}
        </div>
        {message ? (
          <p className={isError || status === "paused" ? styles.cameraError : styles.cameraHint} role="alert">
            {message}
          </p>
        ) : (
          (status === "scanning" || status === "starting") && (
            <p className={styles.cameraHint}>
              Încadrează codul QR sau codul de bare de pe eticheta produsului. Produsul se adaugă automat (o bucată).
            </p>
          )
        )}
        {(isError || status === "paused") && (
          <button type="button" className={styles.primaryBtn} onClick={retry}>
            Reîncearcă
          </button>
        )}
      </div>
    </div>
  );
}
