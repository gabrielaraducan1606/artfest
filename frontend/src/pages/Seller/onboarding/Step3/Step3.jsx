// src/pages/Seller/onboarding/Steps/Step3.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../../../components/services/api";
import useDraft from "../../../../components/utils/useDraft";
import styles from "./Step3.module.css";

const EMAIL_RGX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ✅ Backend absolut, pentru când pdfUrl e relativ (/storage/... sau /uploads/...)
const BACKEND_BASE = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/+$/, "");
const resolveFileUrl = (u) => (u ? (u.startsWith("http") ? u : `${BACKEND_BASE}${u}`) : null);

// 🔧 Normalizare tolerantă: /uploads -> /storage și taie domeniul dacă vine absolut
const normalizeContractPath = (u) => {
  if (!u) return null;
  let p = u.trim();
  try {
    if (p.startsWith("http")) p = new URL(p).pathname; // păstrează doar path-ul
  } catch { /* ignore */ }
  p = p.startsWith("/") ? p : `/${p}`;
  if (p.startsWith("/uploads/")) p = p.replace(/^\/uploads\//, "/storage/");
  return p;
};

function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const history = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const setupCanvas = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const cssWidth = 600;
      const cssHeight = 200;
      canvas.width = cssWidth * ratio;
      canvas.height = cssHeight * ratio;
      canvas.style.width = cssWidth + "px";
      canvas.style.height = cssHeight + "px";
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#000";

      if (value) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, cssWidth, cssHeight);
        img.src = value;
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    setupCanvas();
    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const getPos = (evt) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = "clientX" in evt ? evt.clientX : evt.touches?.[0]?.clientX ?? 0;
      const clientY = "clientY" in evt ? evt.clientY : evt.touches?.[0]?.clientY ?? 0;
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const start = (evt) => {
      evt.preventDefault?.();
      drawing.current = true;
      history.current.push(canvas.toDataURL("image/png"));
      const { x, y } = getPos(evt);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };

    const move = (evt) => {
      if (!drawing.current) return;
      evt.preventDefault?.();
      const { x, y } = getPos(evt);
      ctx.lineTo(x, y);
      ctx.stroke();
    };

    const end = (evt) => {
      if (!drawing.current) return;
      evt?.preventDefault?.();
      drawing.current = false;
      onChange(canvas.toDataURL("image/png"));
    };

    const onMouseDown = (e) => start(e);
    const onMouseMove = (e) => move(e);
    const onMouseUp = (e) => end(e);

    const onTouchStart = (e) => start(e);
    const onTouchMove = (e) => move(e);
    const onTouchEnd = (e) => end(e);

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [onChange]);

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    onChange(null);
    history.current = [];
  };

  const undo = () => {
    if (!history.current.length) return;
    const last = history.current.pop();
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      onChange(c.toDataURL("image/png"));
    };
    img.src = last;
  };

  return (
    <div>
      <canvas ref={canvasRef} className={styles.signatureCanvas} />
      <div className={styles.signatureActions}>
        <button type="button" className={styles.secondaryBtn} onClick={undo}>
          Undo
        </button>
        <button type="button" className={styles.clearBtn} onClick={clear}>
          Șterge
        </button>
      </div>
    </div>
  );
}

export default function Step3() {
  const navigate = useNavigate();
  const token = useMemo(() => localStorage.getItem("authToken"), []);
  const userKey = useMemo(() => token?.slice(0, 12) || "anon", [token]);

  const [contract, setContract] = useState(null);
  const [contractId, setContractId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [signDraft, setSignDraft] = useDraft(
    "onboarding:step3",
    { signerName: "", signerEmail: "", consent: false, typedSignature: "", useTypedSignature: false },
    { userKey, debounce: 400 }
  );
  const { signerName, signerEmail, consent, typedSignature, useTypedSignature } = signDraft;
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);

  // Guard pentru StrictMode (evită dublu init în dev)
  const initedRef = useRef(false);

  useEffect(() => {
    if (!token) navigate("/login", { replace: true });
  }, [token, navigate]);

  // Prefill
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/seller/me");
        if (data?.email) setSignDraft((s) => ({ ...s, signerEmail: s.signerEmail || data.email }));
        if (data?.shopName) setSignDraft((s) => ({ ...s, signerName: s.signerName || data.shopName }));
      } catch {""}
    })();
  }, [setSignDraft]);

  // Init contract (trimite sellerId)
  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;

    (async () => {
      try {
        const meResp = await api.get("/seller/me");
        const me = meResp?.data || {};
        const sellerId =
          me._id || me.id || me.sellerId || me.userId || me.user?._id || me.user?.id;

        if (!sellerId) throw new Error("Nu am putut determina sellerId din /seller/me.");

        const init = await api.post("/contracts/init", { sellerId });
        const c = init.data?.contract;
        setContract(c);
        setContractId(c?._id || c?.id);
      } catch (err) {
        const status = err?.response?.status;
        const msg = err?.response?.data?.msg || err?.message || "Nu am putut încărca contractul.";
        if (status === 401) return navigate("/login", { replace: true });
        setError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  // ⬇️ Download tolerant: încearcă /storage și /uploads (în ordinea asta)
  const handleDownload = async () => {
    try {
      let blob;

      if (contract?.pdfUrl) {
        const raw = contract.pdfUrl;
        const path1 = normalizeContractPath(raw);                       // ex: /storage/contracts/...
        const path2 = path1.replace(/^\/storage\//, "/uploads/");       // fallback: /uploads/contracts/...
        const candidates = [resolveFileUrl(path1), resolveFileUrl(path2)];

        let lastErr;
        for (const url of candidates) {
          try {
            const resp = await fetch(url);
            if (resp.ok) { blob = await resp.blob(); break; }
            lastErr = new Error(`HTTP ${resp.status} la ${url}`);
          } catch (e) { lastErr = e; }
        }
        if (!blob) throw lastErr || new Error("Nu am putut descărca PDF-ul.");
      } else if (contractId) {
        const { data } = await api.get(`contracts/${contractId}/download`, { responseType: "blob" });
        blob = new Blob([data], { type: "application/pdf" });
      } else {
        throw new Error("Nu există un contract de descărcat.");
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `contract-${contractId || "fara-id"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      alert("Eroare la descărcare: " + (err?.message || "necunoscută"));
    }
  };

  const renderTypedSignature = async (text) => {
    if (!text?.trim()) return null;
    const canvas = document.createElement("canvas");
    const w = 600, h = 200;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, w, h);
    ctx.font = '48px "Pacifico, Segoe Script, cursive"';
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2);
    return canvas.toDataURL("image/png");
  };

  const handleSign = async (e) => {
    e.preventDefault();
    if (!signerName?.trim()) return alert("Completează numele semnatarului.");
    if (!signerEmail?.trim() || !EMAIL_RGX.test(signerEmail)) return alert("Email semnatar invalid.");
    if (!consent) return alert("Trebuie să confirmi că ai citit și ești de acord cu termenii.");

    const image = useTypedSignature
      ? await renderTypedSignature(typedSignature || signerName)
      : signatureDataUrl;

    if (!image) return alert("Adaugă semnătura (manuală sau tipărită).");

    try {
      const payload = { signerName, signerEmail, signatureImageBase64: image, consentAccepted: true };
      const { data } = await api.post(`/contracts/${contractId}/sign`, payload);
      setContract((c) => ({
        ...c,
        status: "signed",
        pdfUrl: data.pdfUrl,
        signedAt: data.signedAt || new Date().toISOString(),
        signerName,
      }));
      alert("Contract semnat cu succes!");
      setSignDraft({ signerName, signerEmail, consent: true, typedSignature: "", useTypedSignature: false });
    } catch (err) {
      alert("Eroare la semnare: " + (err.response?.data?.msg || err.message));
    }
  };

  if (loading) return <div>Se încarcă…</div>;

  const signedInfo = contract?.signedAt ? new Date(contract.signedAt).toLocaleString() : null;
  const canSign = Boolean(
    signerName?.trim() &&
    EMAIL_RGX.test(signerEmail || "") &&
    consent &&
    (useTypedSignature ? (typedSignature?.trim() || signerName?.trim()) : signatureDataUrl)
  );

  // 🔧 Previzualizare cu URL normalizat (maps /uploads -> /storage)
  const previewUrl = (() => {
    const p = normalizeContractPath(contract?.pdfUrl);
    return p ? resolveFileUrl(p) : null;
  })();

  return (
    <>
      <div className={styles.container}>
        <div className={styles.form}>
          <h2 className={styles.title}>Contract de colaborare</h2>

          <div className={styles.preview}>
            <button type="button" className={styles.downloadBtn} onClick={handleDownload}>
              Descarcă PDF{contract?.status === "signed" ? " semnat" : ""}
            </button>
            {previewUrl ? (
              <iframe title="Previzualizare contract" src={previewUrl} className={styles.pdfFrame} />
            ) : (
              <p className={styles.hint}>Nu există încă un PDF generat.</p>
            )}
          </div>

          {contract?.status === "signed" ? (
            <div className={styles.signedBox}>
              <p>
                Contract semnat de <strong>{contract.signerName || signerName}</strong>{" "}
                {signedInfo && <> pe <strong>{signedInfo}</strong></>}.
              </p>
              <button type="button" className={styles.primaryBtn} onClick={handleDownload}>
                Descarcă PDF semnat
              </button>
              <button type="button" className={styles.skipButton} onClick={() => navigate("/vanzator/dashboard")}>
                Mergi la Dashboard
              </button>
            </div>
          ) : (
            <form onSubmit={handleSign} className={styles.signForm}>
              {error && <div className={styles.errorBox}>{error}</div>}
              <p className={styles.hint}>Verifică informațiile din contract și semnează mai jos pentru a finaliza onboarding-ul.</p>

              <div className={styles.grid2}>
                <label className={styles.fieldBlock}>
                  <span className={styles.label}>Nume semnatar</span>
                  <input
                    value={signerName}
                    onChange={(e) => setSignDraft((s) => ({ ...s, signerName: e.target.value }))}
                    placeholder="Nume complet"
                    required
                  />
                </label>
                <label className={styles.fieldBlock}>
                  <span className={styles.label}>Email semnatar</span>
                  <input
                    type="email"
                    value={signerEmail}
                    onChange={(e) => setSignDraft((s) => ({ ...s, signerEmail: e.target.value }))}
                    placeholder="email@exemplu.ro"
                    required
                  />
                </label>
              </div>

              <fieldset className={styles.fieldset}>
                <legend>Semnătură</legend>
                <label className={styles.checkline}>
                  <input
                    type="checkbox"
                    checked={useTypedSignature}
                    onChange={(e) => setSignDraft((s) => ({ ...s, useTypedSignature: e.target.checked }))}
                  />
                  Folosește semnătură tipărită
                </label>

                {useTypedSignature ? (
                  <div className={styles.grid2}>
                    <label className={styles.fieldBlock}>
                      <span className={styles.label}>Introduceți semnătura (text)</span>
                      <input
                        value={typedSignature}
                        onChange={(e) => setSignDraft((s) => ({ ...s, typedSignature: e.target.value }))}
                        placeholder={signerName || "Nume Prenume"}
                      />
                    </label>
                    <div className={styles.signaturePreviewBox}>
                      <span className={styles.hint}>Previzualizare</span>
                      <div className={styles.typedSigPreview}>
                        <span style={{ fontFamily: 'Pacifico, "Segoe Script", cursive', fontSize: 42 }}>
                          {typedSignature || signerName || "Semnătura ta"}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <SignaturePad value={signatureDataUrl} onChange={setSignatureDataUrl} />
                )}
              </fieldset>

              <label className={styles.checkline}>
                <input
                  type="checkbox"
                  checked={!!consent}
                  onChange={(e) => setSignDraft((s) => ({ ...s, consent: e.target.checked }))}
                />
                Confirm că am citit contractul și accept termenii prevăzuți în acesta.
              </label>

              <p className={styles.hint}>La semnare vom atașa data/ora și adresa IP în istoricul tău de semnare.</p>

              <div className={styles.footerBar}>
                <button
                  type="submit"
                  disabled={!canSign}
                  className={styles.primaryBtn}
                  aria-disabled={!canSign}
                  title={!canSign ? "Completează câmpurile obligatorii și adaugă semnătura" : "Semnează contractul"}
                >
                  Semnează contractul
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
