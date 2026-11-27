// src/pages/Admin/AdminDesktop/tabs/PosProductTools.jsx
//
// POS -> „Adaugă produs” (pungi de cadou, ambalaje, alte produse manuale) și
// „Produse / Etichete” (căutare după denumire sau cod, etichete, adăugare în coș).
//  - proprietar: Artfest - stoc propriu SAU un magazin al unui participant APPROVED;
//  - „Stoc primit fizic” cu confirmare explicită: produsul intră direct în stocul târgului
//    (recepția existentă: mișcare RECEIVED, cine, când); stocul se poate suplimenta la fel;
//  - doar Admin, inclusiv după termenul de inventar (vânzătorii rămân limitați);
//  - etichetele: formatul existent (denumire, preț, cod de bare AF), număr ales;
//  - salvarea / tipărirea NU înregistrează vânzări; banii la încasare: Artfest = integral
//    Artfest, participant = prețul declarat pentru vânzător + adaos 10% și accesorii pentru Artfest.
//    Nimic nu e publicat online.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import styles from "./AdminFairPos.module.css";
import { formatLei, newIdempotencyKey } from "./adminFairPos.js";
import { downloadLabelsPdf } from "../../../Vendor/Fair/fairInventory.js";
import { accessoriesListText, emptyRow, liveUnitTotal, parseLeiToCents, proposedPrice, splitAtPrice, validateAccessoryRows } from "../../../Vendor/Fair/fairAccessories.js";
import FairAccessoriesButton, { AccessoryRowsEditor } from "./FairAccessoriesDialog.jsx";
import { findSimilarProducts } from "./posReceiveSheet.js";
import {
  LABEL_COPIES_MAX,
  OWNER_ARTFEST,
  OWNER_PARTICIPANT,
  QTY_MAX,
  TITLE_MAX,
  canAddStock,
  findSameTitle,
  inventoryClosedMessage,
  ownerSplitText,
  parseLabelCopies,
  parseReceivedQty,
  productSaleState,
  validateNewProduct,
} from "./posProducts.js";

const FAIR_API = "/api/admin/artfest-fair";

function apiMessage(err, fallback) {
  const fields = err?.data?.fields;
  if (fields && typeof fields === "object") {
    const first = Object.values(fields).find(Boolean);
    if (first) return String(first);
  }
  if (!err?.status) return "Eroare de conexiune. Verifică internetul și încearcă din nou.";
  return err?.data?.message || err?.message || fallback;
}

function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.cameraBackdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.toolBox}>
        <div className={styles.cameraHead}>
          <strong>{title}</strong>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>
            Închide
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* Suplimentarea stocului primit fizic (confirmare + cheie de idempotență per operație). */
function AddStock({ line, onDone }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: "", text: "" });
  const busyRef = useRef(false);
  const keyRef = useRef(newIdempotencyKey());
  const n = parseReceivedQty(qty);

  async function save() {
    if (busyRef.current) return;
    if (!n) return setMessage({ tone: "error", text: `Introdu câte bucăți ai primit (1 - ${QTY_MAX}).` });
    if (!confirmed) return setMessage({ tone: "error", text: `Confirmă că ai primit fizic ${n} buc.` });
    busyRef.current = true;
    setBusy(true);
    try {
      await api(`${FAIR_API}/pos/products/${encodeURIComponent(line.id)}/stock`, {
        method: "POST",
        headers: { "Idempotency-Key": `pos-stock-${keyRef.current}` },
        body: { receivedQty: n, confirmReceived: true },
      });
      keyRef.current = newIdempotencyKey(); // următoarea suplimentare = altă operație
      setMessage({ tone: "ok", text: `Stoc suplimentat: +${n} buc.` });
      setQty("");
      setConfirmed(false);
      setOpen(false);
      onDone?.();
    } catch (err) {
      setMessage({ tone: "error", text: apiMessage(err, "Stocul nu a putut fi suplimentat.") });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={styles.addStock}>
      {!open ? (
        <button type="button" className={styles.ghostBtn} onClick={() => setOpen(true)}>
          Suplimentează stocul
        </button>
      ) : (
        <div className={styles.addStockForm}>
          <label className={styles.copiesField}>
            <span>Stoc primit fizic (+)</span>
            <input inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setConfirmed(false); }} aria-label={`Stoc primit fizic suplimentar, ${line.title}`} disabled={busy} />
          </label>
          <label className={styles.checkRow}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy || !n} />
            <span>{n ? `Confirm că am primit fizic ${n} buc.` : "Confirm primirea fizică"}</span>
          </label>
          <button type="button" className={styles.primaryBtn} onClick={save} disabled={busy || !n || !confirmed}>
            {busy ? "Se salvează…" : "Adaugă în stoc"}
          </button>
        </div>
      )}
      {message.text && (
        <p className={message.tone === "error" ? styles.cameraError : styles.stateOk} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

/*
 * Acțiunile unui produs: starea explicată, etichetele (număr ales), adăugarea în coș
 * (aceeași funcție ca scannerul), recepția (linii trimise de vânzători), suplimentarea stocului.
 */
function ProductActions({ line, onChanged, onAddToCart, compact = false }) {
  const [copies, setCopies] = useState(String(Math.min(Math.max(line.availableQty || line.declaredQty || 1, 1), LABEL_COPIES_MAX)));
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState({ tone: "", text: "" });
  const busyRef = useRef(false);
  const receiveKeyRef = useRef(`pos-receive-${newIdempotencyKey()}`);
  const state = productSaleState(line);

  async function run(kind, fn) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setMessage({ tone: "", text: "" });
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  const labels = () =>
    run("labels", async () => {
      const n = parseLabelCopies(copies);
      if (!n) {
        setMessage({ tone: "error", text: `Alege între 1 și ${LABEL_COPIES_MAX} de etichete.` });
        return;
      }
      try {
        await downloadLabelsPdf(`${FAIR_API}/inventory/labels.pdf`, `etichete-${line.barcode || line.id}.pdf`, "Nu am putut genera etichetele.", {
          body: { ids: [line.id], copies: n },
        });
        setMessage({ tone: "ok", text: `${n} ${n === 1 ? "etichetă generată" : "etichete generate"} (fără vânzare înregistrată).` });
        onChanged?.();
      } catch (err) {
        setMessage({ tone: "error", text: err?.message || "Nu am putut genera etichetele." });
      }
    });

  const receive = () =>
    run("receive", async () => {
      if (!window.confirm(`Confirmi că ai primit fizic ${line.declaredQty} buc. din „${line.title}”?`)) return;
      try {
        await api(`${FAIR_API}/inventory/${encodeURIComponent(line.id)}/receive`, {
          method: "POST",
          headers: { "Idempotency-Key": receiveKeyRef.current },
          body: { receivedQty: line.declaredQty },
        });
        setMessage({ tone: "ok", text: `Recepționat: ${line.declaredQty} buc. Produsul se poate vinde.` });
        onChanged?.();
      } catch (err) {
        setMessage({ tone: "error", text: apiMessage(err, "Recepția nu a reușit.") });
      }
    });

  const addToCart = () =>
    run("cart", async () => {
      const outcome = await onAddToCart(line.barcode);
      if (!outcome?.ok) setMessage({ tone: "error", text: outcome?.message || "Produsul nu a putut fi adăugat în coș." });
    });

  return (
    <div className={styles.productActions}>
      <p className={state.tone === "ok" ? styles.stateOk : state.tone === "wait" ? styles.stateWait : styles.stateBlocked}>{state.text}</p>
      <div className={styles.toolActions}>
        {line.actions?.canReceive && (
          <button type="button" className={styles.ghostBtn} onClick={receive} disabled={Boolean(busy)}>
            {busy === "receive" ? "Se recepționează…" : `Recepționează ${line.declaredQty} buc.`}
          </button>
        )}
        <label className={styles.copiesField}>
          <span>{compact ? "Etichete" : "Număr de etichete"}</span>
          <input
            inputMode="numeric"
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
            aria-label={`Număr de etichete, ${line.title}`}
            disabled={Boolean(busy)}
          />
        </label>
        <button type="button" className={styles.ghostBtn} onClick={labels} disabled={Boolean(busy) || line.actions?.canPrintLabel === false}>
          {busy === "labels" ? "Se generează…" : "Generează etichetă"}
        </button>
        <button type="button" className={styles.primaryBtn} onClick={addToCart} disabled={Boolean(busy)}>
          {busy === "cart" ? "Se adaugă…" : "Adaugă în coș"}
        </button>
        <FairAccessoriesButton line={line} onSaved={() => onChanged?.()} />
      </div>
      {line.accessories?.unitCents > 0 && (
        <p className={styles.accSplit}>
          Ambalare și accesorii (Artfest), pe bucată: {accessoriesListText(line.accessories.items)} = {formatLei(line.accessories.unitCents)}. Se rețin din
          suma vânzătorului la vânzare.
        </p>
      )}
      {canAddStock(line) && <AddStock line={line} onDone={onChanged} />}
      {message.text && (
        <p className={message.tone === "error" ? styles.cameraError : styles.stateOk} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

/* ===================== Adaugă produs ===================== */

const EMPTY_FORM = { owner: "", registrationId: "", serviceId: "", title: "", priceRon: "", receivedQty: "", confirmReceived: false };

/*
 * mode = "store": „Adaugă produs într-un magazin” (după „Cod negăsit”): doar participanți APPROVED,
 * cu preț final propus și accesorii opționale, salvate după creare prin serviciile existente
 * (pași reluabili, fără dubluri). Codul scanat necunoscut NU devine cod AF: codul se generează
 * prin mecanismul existent. Înainte de creare: produsele asemănătoare ale participantului.
 */
export function AddProductDialog({ inventory, onClose, onAddToCart, mode = "any", onOpenReceiveSheet }) {
  const storeMode = mode === "store";
  const [owners, setOwners] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(storeMode ? { ...EMPTY_FORM, owner: OWNER_PARTICIPANT } : EMPTY_FORM);
  // opționale (participant): prețul final propus de Artfest și „Ambalare și accesorii”
  const [finalPriceText, setFinalPriceText] = useState("");
  const [accRows, setAccRows] = useState([emptyRow()]);
  const [extras, setExtras] = useState({ plan: null, done: [], failure: "", busy: false });
  const [pickedExisting, setPickedExisting] = useState(false);
  const [fields, setFields] = useState({});
  const [error, setError] = useState("");
  const [duplicateOk, setDuplicateOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null); // linia completă (GET /inventory/:id)
  const savingRef = useRef(false);
  // o cerere = un produs: același id la dublu click / retrimitere => aceeași linie pe server
  const requestIdRef = useRef(crypto.randomUUID());

  const loadOwners = useCallback(async () => {
    try {
      setOwners(await api(`${FAIR_API}/pos/products/owners`));
      setLoadError("");
    } catch (err) {
      setLoadError(apiMessage(err, "Nu am putut încărca proprietarii."));
    }
  }, []);

  useEffect(() => {
    loadOwners();
  }, [loadOwners]);

  const refreshSaved = useCallback(async (id) => {
    const res = await api(`${FAIR_API}/inventory/${encodeURIComponent(id)}`);
    setSaved(res.item);
  }, []);

  const participant = (owners?.participants || []).find((p) => p.registrationId === form.registrationId) || null;
  const stores = participant?.stores || [];
  const ownerLines = form.owner === OWNER_ARTFEST ? owners?.artfest?.lines : form.owner === OWNER_PARTICIPANT ? participant?.lines : null;
  const sameTitle = ownerLines ? findSameTitle(ownerLines, form.title) : null;
  // posibile produse existente ale aceluiași proprietar (inclusiv denumirea identică)
  const similar = ownerLines ? findSimilarProducts(ownerLines, form.title) : [];
  if (sameTitle && !similar.some((l) => l.id === sameTitle.id)) similar.unshift(sameTitle);
  const participantExtras = form.owner === OWNER_PARTICIPANT;
  const qtyN = parseReceivedQty(form.receivedQty);
  const deadlinePassed = inventory && inventory.open === false;

  const update = (patch, clearKeys = []) => {
    setForm((f) => ({ ...f, ...patch }));
    setFields((x) => {
      const next = { ...x };
      for (const k of clearKeys) delete next[k];
      return next;
    });
    setError("");
  };

  async function save(e) {
    e.preventDefault();
    if (savingRef.current) return;
    const check = validateNewProduct(form, { clientRequestId: requestIdRef.current, stores });
    setFields(check.fields);
    if (!check.ok) return;
    if (similar.length && !duplicateOk) {
      setError("Există produse asemănătoare: alege unul existent sau confirmă că este un produs diferit.");
      return;
    }
    // opționale: verificate ÎNAINTE de creare (nimic nu se salvează pe jumătate din cauza lor)
    let plan = { finalPriceCents: null, accessories: [] };
    if (participantExtras) {
      if (finalPriceText.trim()) {
        const cents = parseLeiToCents(finalPriceText);
        if (cents === null) return setFields((f) => ({ ...f, finalPrice: "Preț final invalid (ex. 120 sau 99,90)." }));
        plan.finalPriceCents = cents;
      }
      const acc = validateAccessoryRows(accRows);
      if (!acc.ok) return setFields((f) => ({ ...f, ...Object.fromEntries(Object.entries(acc.fields).map(([k, v]) => [`acc.${k}`, v])), accessories: "Verifică accesoriile." }));
      plan.accessories = acc.items;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const res = await api(`${FAIR_API}/pos/products`, { method: "POST", body: check.body });
      setSaved(res.item);
      loadOwners();
      await runExtras(res.item, plan, []);
    } catch (err) {
      setError(apiMessage(err, "Produsul nu a putut fi salvat."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  /*
   * Pașii opționali după creare (serviciile existente): prețul final, apoi accesoriile. La eroare se
   * arată exact ce s-a salvat; „Reia” face doar pașii rămași (ambele servicii sunt idempotente).
   */
  async function runExtras(item, plan, already) {
    const steps = [];
    if (plan.finalPriceCents != null && plan.finalPriceCents !== item.pricing?.salePriceCents) steps.push("price");
    if (plan.accessories.length) steps.push("accessories");
    const done = [...already];
    setExtras({ plan, done, failure: "", busy: true });
    try {
      for (const step of steps.filter((x) => !done.includes(x))) {
        if (step === "price") {
          await api(`${FAIR_API}/inventory/${encodeURIComponent(item.id)}/final-price`, { method: "POST", body: { finalPriceCents: plan.finalPriceCents } });
        } else {
          await api(`${FAIR_API}/inventory/${encodeURIComponent(item.id)}/accessories`, { method: "PUT", body: { items: plan.accessories } });
        }
        done.push(step);
        setExtras({ plan, done: [...done], failure: "", busy: true });
      }
      setExtras({ plan, done, failure: "", busy: false });
    } catch (err) {
      setExtras({ plan, done, failure: apiMessage(err, "Pasul nu a reușit."), busy: false });
    }
    await refreshSaved(item.id).catch(() => {});
  }

  // produs existent ales din lista celor asemănătoare: fără creare; nerecepționat => fișa de recepție
  async function pickExisting(id) {
    try {
      const res = await api(`${FAIR_API}/inventory/${encodeURIComponent(id)}`);
      if (res.item.status === "SUBMITTED" && onOpenReceiveSheet) {
        onOpenReceiveSheet(id);
        return;
      }
      setPickedExisting(true);
      setSaved(res.item);
    } catch (err) {
      setError(apiMessage(err, "Produsul nu a putut fi încărcat."));
    }
  }

  function another() {
    requestIdRef.current = crypto.randomUUID();
    setPickedExisting(false);
    setExtras({ plan: null, done: [], failure: "", busy: false });
    setFinalPriceText("");
    setAccRows([emptyRow()]);
    setSaved(null);
    setForm((f) => ({ ...EMPTY_FORM, owner: f.owner, registrationId: f.registrationId, serviceId: f.serviceId }));
    setFields({});
    setError("");
    setDuplicateOk(false);
  }

  return (
    <Dialog title={storeMode ? "Adaugă produs într-un magazin" : "Adaugă produs"} onClose={onClose}>
      {saved ? (
        <div className={styles.savedProduct}>
          <p className={styles.stateOk} role="status">
            {pickedExisting
              ? "Produs existent selectat (nimic nou creat)."
              : "Produs salvat și intrat în stocul târgului (nicio vânzare înregistrată). Nu este publicat online."}
          </p>
          <strong className={styles.savedTitle}>{saved.title}</strong>
          <span className={shared.subtle}>
            {saved.vendor?.name || "Participant"}
            {!saved.artfestOwned && saved.storeName ? ` · ${saved.storeName}` : ""} · {formatLei(saved.priceCents)} · {saved.receivedQty} buc. primite
          </span>
          <span className={shared.subtle}>{ownerSplitText(saved)}</span>
          {!saved.artfestOwned && saved.pricing?.salePriceCents != null && (
            <span className={shared.subtle}>
              Preț declarat {formatLei(saved.pricing.vendorPriceCents)} · adaos Artfest {formatLei(Math.max(0, saved.pricing.markupCents ?? 0))}
              {saved.accessories?.unitCents > 0 ? ` · accesorii ${formatLei(saved.accessories.unitCents)}` : ""} · total client{" "}
              {formatLei(saved.pricing.salePriceCents)} · vânzătorul primește {formatLei(saved.pricing.vendorNetCents)} / buc.
              {saved.pricing.finalDiffersFromProposed ? ` (preț propus: ${formatLei(saved.pricing.proposedFinalPriceCents)})` : ""}
            </span>
          )}
          {extras.plan && (extras.done.length > 0 || extras.failure) && (
            <ul className={styles.sheetSteps} aria-label="Ce s-a salvat">
              <li className={styles.stateOk}>✓ Produs creat și recepționat ({saved.receivedQty} buc.)</li>
              {extras.done.includes("price") && <li className={styles.stateOk}>✓ Preț final salvat</li>}
              {extras.done.includes("accessories") && <li className={styles.stateOk}>✓ Ambalare și accesorii salvate</li>}
            </ul>
          )}
          {extras.failure && (
            <div className={styles.addStockForm}>
              <p className={styles.cameraError} role="alert">
                {extras.failure}
              </p>
              <button type="button" className={styles.primaryBtn} onClick={() => runExtras(saved, extras.plan, extras.done)} disabled={extras.busy}>
                {extras.busy ? "Se salvează…" : "Reia (doar pașii rămași)"}
              </button>
            </div>
          )}
          <span className={styles.codeBig} aria-label="Cod AF">
            {saved.barcodeDisplay}
          </span>
          <ProductActions
            line={saved}
            onChanged={() => refreshSaved(saved.id)}
            onAddToCart={async (code) => {
              const outcome = await onAddToCart(code);
              if (outcome?.ok) onClose();
              return outcome;
            }}
          />
          <button type="button" className={styles.ghostBtn} onClick={another}>
            Adaugă alt produs
          </button>
        </div>
      ) : (
        <form className={styles.toolForm} onSubmit={save} noValidate>
          {deadlinePassed && (
            <p className={styles.notice} role="status">
              {inventoryClosedMessage(inventory.deadlineAt)}
            </p>
          )}
          {loadError && (
            <p className={styles.cameraError} role="alert">
              {loadError}
            </p>
          )}
          <fieldset className={styles.ownerChoice} disabled={saving || !owners}>
            <legend>Proprietar</legend>
            {!storeMode && (
            <label className={styles.checkRow}>
              <input
                type="radio"
                name="pos-product-owner"
                checked={form.owner === OWNER_ARTFEST}
                onChange={() => { update({ owner: OWNER_ARTFEST, registrationId: "", serviceId: "" }, ["owner", "serviceId"]); setDuplicateOk(false); }}
              />
              <span>Artfest - stoc propriu (încasare integral Artfest)</span>
            </label>
            )}
            <label className={styles.checkRow}>
              <input
                type="radio"
                name="pos-product-owner"
                checked={form.owner === OWNER_PARTICIPANT}
                onChange={() => { update({ owner: OWNER_PARTICIPANT }, ["owner"]); setDuplicateOk(false); }}
              />
              <span>Magazinul unui participant (vânzătorul primește prețul declarat; Artfest adaos 10% + accesorii)</span>
            </label>
            {fields.owner && <small className={styles.fieldError}>{fields.owner}</small>}
          </fieldset>
          {form.owner === OWNER_PARTICIPANT && (
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span>Participant</span>
                <select
                  value={form.registrationId}
                  onChange={(e) => {
                    const p = (owners?.participants || []).find((x) => x.registrationId === e.target.value);
                    update({ registrationId: e.target.value, serviceId: p?.stores?.length === 1 ? p.stores[0].serviceId : "" }, ["owner", "serviceId"]);
                    setDuplicateOk(false);
                  }}
                  disabled={saving}
                >
                  <option value="">Alege participantul</option>
                  {(owners?.participants || []).map((p) => (
                    <option key={p.registrationId} value={p.registrationId}>
                      {p.vendorName}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Magazin</span>
                <select value={form.serviceId} onChange={(e) => update({ serviceId: e.target.value }, ["serviceId"])} disabled={saving || !participant || !stores.length}>
                  <option value="">{!participant ? "Alege întâi participantul" : stores.length ? "Alege magazinul" : "Fără magazin de produse"}</option>
                  {stores.map((s) => (
                    <option key={s.serviceId} value={s.serviceId}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {fields.serviceId && <small className={styles.fieldError}>{fields.serviceId}</small>}
              </label>
            </div>
          )}
          <label className={styles.field}>
            <span>Denumire</span>
            <input
              value={form.title}
              onChange={(e) => { update({ title: e.target.value }, ["title"]); setDuplicateOk(false); }}
              maxLength={TITLE_MAX}
              placeholder="Ex. Pungă de cadou mică"
              disabled={saving}
            />
            {fields.title && <small className={styles.fieldError}>{fields.title}</small>}
          </label>
          {similar.length > 0 && (
            <div className={styles.warning} role="alert">
              {sameTitle
                ? `Există deja „${sameTitle.title}” la acest proprietar (${sameTitle.barcodeDisplay}). Pentru mai multe bucăți folosește „Suplimentează stocul” la produsul existent (din „Produse / Etichete”).`
                : "Produse asemănătoare la acest proprietar - poate fi unul dintre ele:"}
              <ul className={styles.similarList}>
                {similar.map((l) => (
                  <li key={l.id}>
                    <span>
                      {l.title} · {l.barcodeDisplay}
                      {l.status === "SUBMITTED" ? " · trimis, nerecepționat" : ""}
                    </span>
                    <button type="button" className={styles.ghostBtn} onClick={() => pickExisting(l.id)} disabled={saving}>
                      Este acesta
                    </button>
                  </li>
                ))}
              </ul>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={duplicateOk} onChange={(e) => setDuplicateOk(e.target.checked)} />
                <span>Este un produs diferit, salvează-l</span>
              </label>
            </div>
          )}
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>{form.owner === OWNER_PARTICIPANT ? "Preț declarat (lei)" : "Preț (lei)"}</span>
              <input value={form.priceRon} onChange={(e) => update({ priceRon: e.target.value }, ["priceRon"])} inputMode="decimal" placeholder="Ex. 5 sau 4,50" disabled={saving} />
              {fields.priceRon && <small className={styles.fieldError}>{fields.priceRon}</small>}
            </label>
            <label className={styles.field}>
              <span>Stoc primit fizic</span>
              <input
                value={form.receivedQty}
                onChange={(e) => update({ receivedQty: e.target.value, confirmReceived: false }, ["receivedQty", "confirmReceived"])}
                inputMode="numeric"
                placeholder="Bucăți primite"
                disabled={saving}
              />
              {fields.receivedQty && <small className={styles.fieldError}>{fields.receivedQty}</small>}
            </label>
          </div>
          <label className={styles.confirmBox}>
            <input
              type="checkbox"
              checked={form.confirmReceived}
              onChange={(e) => update({ confirmReceived: e.target.checked }, ["confirmReceived"])}
              disabled={saving || !qtyN}
            />
            <span>
              {qtyN
                ? `Confirm că am primit fizic ${qtyN} buc. Intrarea se înregistrează în numele meu.`
                : "Confirm stocul primit fizic (completează întâi numărul de bucăți)."}
            </span>
          </label>
          {fields.confirmReceived && <small className={styles.fieldError}>{fields.confirmReceived}</small>}
          {participantExtras && (
            <details className={styles.breakdown} open={storeMode}>
              <summary>Opțional: preț final propus și ambalare / accesorii</summary>
              <label className={styles.field}>
                <span>Preț final (lei, opțional; gol = prețul propus: declarat + 10% + accesorii)</span>
                <input
                  value={finalPriceText}
                  onChange={(e) => {
                    setFinalPriceText(e.target.value);
                    update({}, ["finalPrice"]);
                  }}
                  inputMode="decimal"
                  placeholder="Ex. 120"
                  disabled={saving}
                  aria-label="Preț final propus de Artfest"
                />
                {fields.finalPrice && <small className={styles.fieldError}>{fields.finalPrice}</small>}
              </label>
              <small className={shared.subtle}>Ambalare și accesorii adăugate de Artfest, PER BUCATĂ de produs (se rețin din suma vânzătorului):</small>
              <AccessoryRowsEditor
                rows={accRows}
                onChange={(next) => {
                  setAccRows(next);
                  setFields((f) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith("acc"))));
                }}
                fields={Object.fromEntries(Object.entries(fields).filter(([k]) => k.startsWith("acc.")).map(([k, v]) => [k.slice(4), v]))}
                disabled={saving}
              />
              {(() => {
                const declared = parseLeiToCents(form.priceRon);
                const acc = liveUnitTotal(accRows);
                const proposed = proposedPrice(declared, acc);
                const split = splitAtPrice(parseLeiToCents(finalPriceText) ?? proposed, declared, acc);
                return split ? (
                  <small className={split.negative ? styles.fieldError : shared.subtle}>
                    Pe bucată: preț declarat {formatLei(split.declaredCents)} · {split.markupReduced ? "comision 10%" : "adaos Artfest"} {formatLei(Math.max(0, split.markupCents))} ·
                    accesorii {formatLei(split.accessoriesCents)} · total client {formatLei(split.priceCents)}
                    {split.priceCents !== proposed ? ` (propus ${formatLei(proposed)})` : ""}
                    {split.negative
                      ? " - nu acoperă accesoriile: vânzarea ar fi blocată la casă"
                      : split.markupReduced
                        ? ` - sub prețul propus: accesorii, apoi 10% din rest; vânzătorului ${formatLei(split.vendorNetCents)}`
                        : ""}
                  </small>
                ) : null;
              })()}
            </details>
          )}
          {error && (
            <p className={styles.cameraError} role="alert">
              {error}
            </p>
          )}
          <button type="submit" className={styles.primaryBtn} disabled={saving || !owners}>
            {saving ? "Se salvează…" : "Salvează produsul"}
          </button>
          <small className={shared.subtle}>Produsul nu se publică în magazinul online. Cantitate între 1 și {QTY_MAX}.</small>
        </form>
      )}
    </Dialog>
  );
}

/* ===================== Produse / Etichete ===================== */

export function ProductsDialog({ onClose, onAddToCart }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const seq = useRef(0);

  const load = useCallback(async (term) => {
    const mine = ++seq.current;
    try {
      const res = await api(`${FAIR_API}/inventory?filter=all&q=${encodeURIComponent(term)}`);
      if (mine === seq.current) {
        setItems(res.items || []);
        setError("");
      }
    } catch (err) {
      if (mine === seq.current) setError(apiMessage(err, "Nu am putut încărca produsele."));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <Dialog title="Produse / Etichete" onClose={onClose}>
      <input
        type="search"
        className={styles.scanInput}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Caută după denumire, cod AF sau proprietar"
        aria-label="Caută produse"
        autoComplete="off"
      />
      {error && (
        <p className={styles.cameraError} role="alert">
          {error}
        </p>
      )}
      {items === null ? (
        <p className={shared.subtle}>Se încarcă…</p>
      ) : items.length === 0 ? (
        <p className={shared.subtle}>Niciun produs găsit.</p>
      ) : (
        <ul className={styles.productList}>
          {items.map((line) => (
            <li key={line.id} className={styles.productItem}>
              <div className={styles.productHead}>
                <strong>{line.title}</strong>
                <span className={styles.codeSmall}>{line.barcodeDisplay}</span>
              </div>
              <span className={shared.subtle}>
                {line.vendor?.name || "Participant"}
                {!line.artfestOwned && line.storeName ? ` · ${line.storeName}` : ""} · {formatLei(line.priceCents)}
                {line.isManual ? " · produs manual" : ""}
              </span>
              <ProductActions line={line} compact onChanged={() => load(q.trim())} onAddToCart={onAddToCart} />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
