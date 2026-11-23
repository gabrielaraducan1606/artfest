// src/pages/Admin/AdminDesktop/tabs/AdminFairPromoLabels.jsx
//
// Admin → Târg → Etichete → „Etichete fără preț” (loc alb „Preț: ______ lei”):
//  - QR: „Magazin participant” (pagina lui publică) sau „Artfest” (www.artfest.ro);
//  - doar promovare: fără produs / cod AF, nu pentru POS;
//  - „Cu produs din inventar”: eticheta de produs cu codul AF al liniei (pentru POS), fără
//    preț tipărit - prețul efectiv se introduce obligatoriu la casă (orice participant
//    aprobat). Produsul se alege din inventarul participantului sau se adaugă prin
//    fluxul existent de produse manuale („Adaugă în inventar”), apoi se recepționează.
// Eligibilitatea, proprietarul produsului și adresa QR se verifică pe server.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import { downloadLabelsPdf } from "../../../Vendor/Fair/fairInventory.js";
import rx from "./AdminFairReception.module.css";
import styles from "./AdminFairPromoLabels.module.css";

const API = "/api/admin/artfest-fair/labels/promo";
const LINE_STATUS = { SUBMITTED: "de recepționat", RECEIVED: "recepționat" };

function errorMessage(err, fallback) {
  const fields = err?.data?.fields ? Object.values(err.data.fields).filter(Boolean) : [];
  return [err?.data?.message || err?.message || fallback, ...fields].join(" ");
}

function newRequestId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export default function AdminFairPromoLabels({ onClose }) {
  const [kind, setKind] = useState("store");
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [registrationId, setRegistrationId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [withProduct, setWithProduct] = useState(false);
  const [productMode, setProductMode] = useState("existing");
  const [lineId, setLineId] = useState("");
  const [newProduct, setNewProduct] = useState({ title: "", priceRon: "", declaredQty: "1" });
  const [copies, setCopies] = useState("24");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const firstRef = useRef(null);
  // o cheie per produs nou: dublu click / reîncercare => aceeași linie (fluxul existent)
  const requestIdRef = useRef(newRequestId());
  // onClose vine nou la fiecare randare a panoului: îl citim prin ref (încărcarea rulează o singură dată)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const load = useCallback(async () => {
    try {
      setData(await api(`${API}/participants`));
      setLoadError("");
    } catch (err) {
      setLoadError(errorMessage(err, "Nu am putut încărca participanții."));
    }
  }, []);

  useEffect(() => {
    firstRef.current?.focus();
    load();
    const onKey = (e) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  const participants = data?.items || [];
  const participant = participants.find((p) => p.registrationId === registrationId) || null;
  const stores = useMemo(() => participant?.stores || [], [participant]);
  const store = stores.find((s) => s.serviceId === serviceId) || null;
  const lines = participant?.lines || [];
  const line = lines.find((l) => l.id === lineId) || null;
  const maxCopies = data?.maxCopies || 240;

  // un singur magazin disponibil: îl alegem automat
  useEffect(() => {
    const available = stores.filter((s) => s.available);
    setServiceId(available.length === 1 ? available[0].serviceId : "");
  }, [registrationId, stores]);
  useEffect(() => setLineId(""), [registrationId]);

  const needsParticipant = kind === "store" || withProduct;
  const copiesNumber = Number(copies);
  const copiesValid = Number.isInteger(copiesNumber) && copiesNumber >= 1 && copiesNumber <= maxCopies;
  const storeReady = kind === "artfest" || (participant && store?.available);
  const productReady = !withProduct || Boolean(line);
  const canDownload = !busy && copiesValid && storeReady && productReady && (!needsParticipant || participant);
  const sameTitle = newProduct.title.trim()
    ? lines.find((l) => l.title.trim().toLowerCase() === newProduct.title.trim().toLowerCase())
    : null;

  async function addProduct() {
    if (busy || !participant) return;
    setBusy("add");
    setError("");
    setNotice("");
    try {
      const res = await api(`${API}/inventory-item`, {
        method: "POST",
        body: {
          registrationId: participant.registrationId,
          title: newProduct.title,
          priceRon: newProduct.priceRon,
          declaredQty: Number(newProduct.declaredQty),
          clientRequestId: requestIdRef.current,
        },
      });
      await load();
      setLineId(res.item.id);
      setProductMode("existing");
      setNewProduct({ title: "", priceRon: "", declaredQty: "1" });
      requestIdRef.current = newRequestId();
      setNotice(
        `${res.duplicate ? "Produsul era deja adăugat" : "Produsul a fost adăugat în inventar"}: ${res.item.title} (${res.item.barcodeDisplay}). ` +
          "Recepționează-l în „Recepție” înainte de vânzare."
      );
    } catch (err) {
      setError(errorMessage(err, "Nu am putut adăuga produsul."));
    } finally {
      setBusy("");
    }
  }

  async function download() {
    if (!canDownload) return;
    setBusy("pdf");
    setError("");
    setNotice("");
    try {
      const body = {
        kind,
        copies: copiesNumber,
        ...(needsParticipant ? { registrationId: participant.registrationId } : {}),
        ...(kind === "store" ? { serviceId: store.serviceId } : {}),
        ...(withProduct ? { inventoryItemId: line.id } : {}),
      };
      const name = withProduct ? `etichete-fara-pret-${line.barcodeDisplay}.pdf` : kind === "artfest" ? "etichete-artfest.pdf" : "etichete-magazin.pdf";
      await downloadLabelsPdf(`${API}.pdf`, name, "Nu am putut genera etichetele.", { body });
      setNotice(
        `PDF-ul a fost generat: ${copiesNumber} ${copiesNumber === 1 ? "etichetă" : "etichete"} (A4, 70 × 37 mm)` +
          (withProduct ? `, cu codul ${line.barcodeDisplay}. La vânzare, prețul scris pe etichetă se introduce în POS.` : ".") +
          " La imprimare alege scala 100%."
      );
      if (withProduct) load();
    } catch (err) {
      setError(errorMessage(err, "Nu am putut genera etichetele."));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={styles.backdrop} onClick={() => !busy && onClose()} role="presentation">
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="promo-labels-title" onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h3 id="promo-labels-title">Etichete fără preț</h3>
          <button ref={firstRef} type="button" className={rx.ghostBtn} onClick={onClose} aria-label="Închide" disabled={Boolean(busy)}>
            ✕
          </button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.muted}>
            Același format ca etichetele produselor, cu loc alb „Preț: ______ lei” pentru prețul scris cu pixul.
          </p>

          <fieldset className={styles.kinds}>
            <legend className={styles.label}>QR-ul etichetei</legend>
            <label className={styles.option}>
              <input type="radio" name="promo-kind" value="store" checked={kind === "store"} onChange={() => setKind("store")} />
              <span>
                <strong>Magazin participant</strong>
                <small>Numele magazinului + QR către pagina lui de pe Artfest</small>
              </span>
            </label>
            <label className={styles.option}>
              <input type="radio" name="promo-kind" value="artfest" checked={kind === "artfest"} onChange={() => setKind("artfest")} />
              <span>
                <strong>Artfest</strong>
                <small>„Artfest” + QR către www.artfest.ro + „Descoperă creația românească”</small>
              </span>
            </label>
          </fieldset>

          <label className={styles.check}>
            <input type="checkbox" checked={withProduct} onChange={(e) => setWithProduct(e.target.checked)} />
            <span>
              <strong>Cu produs din inventar</strong> (cod AF pentru POS)
              <small>Fără bifă: etichetă doar de promovare, nu se scanează în POS.</small>
            </span>
          </label>

          {loadError && (
            <div className={styles.error} role="alert">
              {loadError}
            </div>
          )}

          {needsParticipant && (
            <label className={styles.field}>
              <span className={styles.label}>{withProduct ? "Participantul căruia îi aparține produsul" : "Participant (înscriere aprobată)"}</span>
              <select value={registrationId} onChange={(e) => setRegistrationId(e.target.value)} disabled={!data}>
                <option value="">{data ? "Alege participantul" : "Se încarcă…"}</option>
                {participants.map((p) => (
                  <option key={p.registrationId} value={p.registrationId}>
                    {p.vendorName}
                    {p.stores.length ? ` — ${p.stores.map((s) => s.name).join(", ")}` : " — fără magazin"}
                  </option>
                ))}
              </select>
            </label>
          )}

          {kind === "store" && participant && stores.length > 1 && (
            <label className={styles.field}>
              <span className={styles.label}>Magazin</span>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Alege magazinul</option>
                {stores.map((s) => (
                  <option key={s.serviceId} value={s.serviceId} disabled={!s.available}>
                    {s.name}
                    {s.available ? "" : " (fără pagină publică)"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "store" && participant && stores.length === 0 && (
            <p className={styles.warn}>Participantul nu are niciun magazin de produse pe Artfest.</p>
          )}
          {kind === "store" && participant && stores.length > 0 && stores.every((s) => !s.available) && (
            <p className={styles.warn}>
              Niciun magazin al participantului nu are o pagină publică activă pe Artfest, deci nu se poate genera un QR valid.
            </p>
          )}

          {withProduct && participant && (
            <div className={styles.product}>
              <div className={styles.segment} role="radiogroup" aria-label="Produsul">
                <label className={styles.option}>
                  <input type="radio" name="product-mode" checked={productMode === "existing"} onChange={() => setProductMode("existing")} />
                  <span>Produs din inventar</span>
                </label>
                <label className={styles.option}>
                  <input type="radio" name="product-mode" checked={productMode === "new"} onChange={() => setProductMode("new")} />
                  <span>Adaugă în inventar</span>
                </label>
              </div>

              {productMode === "existing" ? (
                <label className={styles.field}>
                  <span className={styles.label}>Produs</span>
                  <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
                    <option value="">{lines.length ? "Alege produsul" : "Participantul nu are produse trimise în inventar"}</option>
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title}
                        {l.variantLabel ? ` (${l.variantLabel})` : ""} · {l.barcodeDisplay} · {LINE_STATUS[l.status] || l.status}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className={styles.newProduct}>
                  <label className={styles.field}>
                    <span className={styles.label}>Denumire</span>
                    <input value={newProduct.title} maxLength={200} onChange={(e) => setNewProduct((p) => ({ ...p, title: e.target.value }))} />
                  </label>
                  <div className={styles.row}>
                    <label className={styles.field}>
                      <span className={styles.label}>Preț declarat (lei)</span>
                      <input inputMode="decimal" value={newProduct.priceRon} onChange={(e) => setNewProduct((p) => ({ ...p, priceRon: e.target.value }))} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.label}>Cantitate</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={newProduct.declaredQty}
                        onChange={(e) => setNewProduct((p) => ({ ...p, declaredQty: e.target.value }))}
                      />
                    </label>
                  </div>
                  {sameTitle && (
                    <p className={styles.warn}>
                      Există deja „{sameTitle.title}” ({sameTitle.barcodeDisplay}) în inventarul participantului. Alege-l din „Produs din
                      inventar” dacă e același produs.
                    </p>
                  )}
                  <small className={styles.muted}>
                    Se adaugă prin fluxul obișnuit de produse manuale; produsul trebuie recepționat înainte de vânzare.
                  </small>
                  <div>
                    <button type="button" className={rx.ghostBtn} onClick={addProduct} disabled={Boolean(busy) || !newProduct.title.trim() || !newProduct.priceRon}>
                      {busy === "add" ? "Se adaugă…" : "Adaugă în inventar"}
                    </button>
                  </div>
                </div>
              )}
              {line && productMode === "existing" && (
                <p className={styles.target}>
                  Cod AF pe etichetă: <span>{line.barcodeDisplay}</span> (același pe toate exemplarele)
                </p>
              )}
            </div>
          )}

          {kind === "store" && store?.available && (
            <p className={styles.target}>
              QR către: <span>{store.url}</span>
            </p>
          )}
          {kind === "artfest" && (
            <p className={styles.target}>
              QR către: <span>{data?.artfest?.url || "https://www.artfest.ro"}</span>
            </p>
          )}

          <label className={styles.field}>
            <span className={styles.label}>Număr de exemplare (1–{maxCopies})</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={maxCopies}
              step={1}
              value={copies}
              onChange={(e) => setCopies(e.target.value)}
              className={styles.copies}
            />
            <small className={styles.muted}>24 de etichete pe o coală A4; pozițiile rămase pe ultima coală sunt goale.</small>
          </label>
          {!copiesValid && <p className={styles.warn}>Introdu un număr întreg între 1 și {maxCopies}.</p>}

          {notice && (
            <div className={styles.notice} role="status">
              {notice}
            </div>
          )}
          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
        </div>

        <div className={styles.modalFoot}>
          <button type="button" className={rx.primaryBtn} onClick={download} disabled={!canDownload}>
            {busy === "pdf" ? "Se generează…" : "Descarcă PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
