// src/pages/Admin/AdminDesktop/tabs/FairCameraScanner.jsx
//
// Scanare cu camera telefonului (recepția Târgului Artfest): camera -> QR ->
// codul AF... -> onCode(code), adică EXACT fluxul câmpului de scanare / al
// scannerului USB. Biblioteca (qr-scanner, ~16 KB gzip) se încarcă doar la
// deschidere; folosește BarcodeDetector unde există, altfel worker-ul propriu
// (iOS Safari, Firefox, Chrome desktop).

import { useEffect, useRef, useState } from "react";
import styles from "./AdminFairReception.module.css";
import { SCAN_MESSAGES, cameraErrorReason, createScanDeduper, extractFairCode } from "./fairScanCode.js";

export default function FairCameraScanner({ onCode, onClose }) {
  const videoRef = useRef(null);
  const scannerRef = useRef(null);
  const doneRef = useRef(false);
  const [status, setStatus] = useState("starting"); // starting | scanning | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const accept = createScanDeduper(4000);

    async function start() {
      if (typeof window !== "undefined" && window.isSecureContext === false) {
        setStatus("error");
        setMessage(SCAN_MESSAGES.insecure);
        return;
      }
      if (!navigator?.mediaDevices?.getUserMedia) {
        setStatus("error");
        setMessage(SCAN_MESSAGES.no_camera);
        return;
      }
      try {
        const { default: QrScanner } = await import("qr-scanner");
        if (cancelled) return;
        const scanner = new QrScanner(
          videoRef.current,
          (result) => {
            if (doneRef.current) return;
            const parsed = extractFairCode(result?.data);
            if (!parsed.ok) {
              // QR greșit: mesaj, camera rămâne deschisă
              if (accept(`invalid:${result?.data}`)) setMessage(SCAN_MESSAGES[parsed.reason]);
              return;
            }
            if (!accept(parsed.code)) return;
            doneRef.current = true;
            scanner.stop();
            onCode(parsed.code);
          },
          {
            returnDetailedScanResult: true,
            preferredCamera: "environment",
            highlightScanRegion: true,
            highlightCodeOutline: true,
            maxScansPerSecond: 8,
            onDecodeError: () => {},
          }
        );
        scannerRef.current = scanner;
        await scanner.start();
        if (!cancelled) setStatus("scanning");
      } catch (error) {
        if (cancelled) return;
        console.warn("[recepție] camera:", error?.name || "", error?.message || error);
        setStatus("error");
        setMessage(SCAN_MESSAGES[cameraErrorReason(error, { secure: window.isSecureContext !== false })]);
      }
    }

    start();
    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        scanner.stop();
        scanner.destroy();
      }
    };
  }, [onCode]);

  return (
    <div className={styles.cameraBackdrop} role="dialog" aria-modal="true" aria-label="Scanează cu camera">
      <div className={styles.cameraBox}>
        <div className={styles.cameraHead}>
          <strong>Scanează QR-ul de pe etichetă</strong>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>
            Închide
          </button>
        </div>
        <div className={styles.cameraView}>
          {/* playsInline + muted: obligatorii pe iOS ca video-ul să ruleze în pagină */}
          <video ref={videoRef} className={styles.cameraVideo} playsInline muted />
          {status === "starting" && <p className={styles.cameraOverlay}>Se pornește camera…</p>}
        </div>
        {message && (
          <p className={status === "error" ? styles.errorText : styles.cameraHint} role="alert">
            {message}
          </p>
        )}
        {status === "scanning" && !message && (
          <p className={styles.cameraHint}>Încadrează codul QR de pe etichetă. Produsul se deschide automat.</p>
        )}
      </div>
    </div>
  );
}
