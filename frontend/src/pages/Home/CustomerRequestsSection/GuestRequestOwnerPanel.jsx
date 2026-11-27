// Pagina cererii, văzută de vizitatorul fără cont care a trimis-o (sesiune
// din linkul de email): fotografii (adăugate după confirmare) + invitația
// discretă la cont pentru conversații și comandă. Conversațiile și comanda
// cer cont în etapa 1 - fluxurile existente rămân neschimbate.

import React, { useState } from "react";
import { Link } from "react-router-dom";

import styles from "./GuestRequestPages.module.css";
import { guestApi } from "./guestRequest.js";

const MAX_IMAGES = 10;

export function guestAccountLinks(requestId) {
  const back = `/cereri/${encodeURIComponent(requestId)}`;
  return {
    register: `/inregistrare?redirect=${encodeURIComponent(back)}`,
    login: `${back}?auth=login&redirect=${encodeURIComponent(back)}`,
  };
}

export function GuestAccountPrompt({ requestId }) {
  const links = guestAccountLinks(requestId);
  return (
    <div className={styles.form} role="status">
      <p className={styles.muted}>
        Pentru a discuta cu artizanul și a continua spre comandă ai nevoie de un cont gratuit, cu{" "}
        <strong>același email</strong> folosit în cerere. Cererea și ofertele trec automat în cont.
      </p>
      <div className={styles.actions}>
        <Link className={styles.primary} to={links.register}>Creează cont</Link>
        <Link className={styles.secondary} to={links.login}>Am deja cont</Link>
      </div>
    </div>
  );
}

export default function GuestRequestOwnerPanel({ request, onImagesChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const images = Array.isArray(request?.images) ? request.images : [];
  const canEditPhotos = request?.status === "OPEN" && !request?.user?.id;

  async function handleFiles(event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    input.value = "";
    if (!files.length || busy) return;

    setError("");
    setBusy(true);

    let current = images;
    try {
      for (const file of files.slice(0, Math.max(0, MAX_IMAGES - current.length))) {
        const result = await guestApi.uploadImage(request.id, file);
        current = Array.isArray(result?.images) ? result.images : current;
        onImagesChange?.(current);
      }
      if (files.length > MAX_IMAGES - images.length) {
        setError(`Poți adăuga cel mult ${MAX_IMAGES} fotografii.`);
      }
    } catch (err) {
      setError(err?.data?.message || err?.message || "Fotografia nu a putut fi încărcată.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(url) {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const result = await guestApi.deleteImage(request.id, url);
      onImagesChange?.(Array.isArray(result?.images) ? result.images : images.filter((item) => item !== url));
    } catch (err) {
      setError(err?.data?.message || err?.message || "Fotografia nu a putut fi ștearsă.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.form} style={{ textAlign: "left" }}>
      <p className={styles.muted}>
        Aceasta este cererea ta. Ofertele primite apar mai jos; pentru fiecare ofertă nouă îți trimitem un email.
      </p>

      {canEditPhotos && (
        <div className={styles.form} id="fotografii">
          <span className={styles.label}>Fotografii de inspirație ({images.length}/{MAX_IMAGES})</span>

          {images.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 8 }}>
              {images.map((url) => (
                <div key={url} style={{ position: "relative" }}>
                  <img
                    src={url}
                    alt=""
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 10, display: "block" }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemove(url)}
                    disabled={busy}
                    aria-label="Șterge fotografia"
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 4,
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      border: 0,
                      background: "rgba(0,0,0,.6)",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {images.length < MAX_IMAGES && (
            <label className={styles.secondary} style={{ cursor: busy ? "default" : "pointer" }}>
              {busy ? "Se verifică fotografia…" : "📷 Adaugă fotografii"}
              <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={handleFiles} />
            </label>
          )}

          <p className={styles.muted}>
            Fotografiile sunt verificate automat: nu pot conține telefon, email, linkuri sau coduri QR.
          </p>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <GuestAccountPrompt requestId={request.id} />
    </div>
  );
}
