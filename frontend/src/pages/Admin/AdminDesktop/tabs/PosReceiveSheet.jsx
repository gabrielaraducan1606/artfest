// src/pages/Admin/AdminDesktop/tabs/PosReceiveSheet.jsx
//
// POS -> fișa unui produs scanat (cod AF) care e în inventarul târgului, trimis de vânzător, dar
// NErecepționat. Aceeași linie: produs, fotografie, magazin, vânzător (fără produs nou / alt cod).
// Prezența fizică o confirmă Adminul (cantitate + bifă), nu scanarea. Serviciile existente:
//   „Ambalare și accesorii” (formularul existent), preț final (POST /inventory/:id/final-price),
//   recepție (POST /inventory/:id/receive, posSale, Idempotency-Key fixă pe fișă), coș (scanarea).
// „Salvează, recepționează și adaugă în coș” face pașii în ordine; la o eroare arată exact ce s-a
// salvat, iar „Reia” continuă doar pașii rămași (dublu click / reluare => fără dubluri).
// Stocul scade doar la încasare. Eticheta cu preț vechi nu trebuie retipărită: prețul final se
// trece automat ca preț efectiv în coș.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import styles from "./AdminFairPos.module.css";
import { formatLei, newIdempotencyKey } from "./adminFairPos.js";
import { downloadLabelsPdf } from "../../../Vendor/Fair/fairInventory.js";
import { accessoriesListText, splitAtPrice } from "../../../Vendor/Fair/fairAccessories.js";
import FairAccessoriesButton, { PriceBreakdown } from "./FairAccessoriesDialog.jsx";
import { SHEET_STEP_LABEL, pendingSteps, sheetBlockReason, validateSheet } from "./posReceiveSheet.js";

const FAIR_API = "/api/admin/artfest-fair";
const toInput = (cents) => (cents == null ? "" : (cents / 100).toFixed(2).replace(".", ","));

function errorText(err, fallback) {
  const fields = err?.data?.fields;
  if (fields && typeof fields === "object") {
    const first = Object.values(fields).find(Boolean);
    if (first) return String(first);
  }
  if (!err?.status) return "Eroare de conexiune. Verifică internetul și încearcă din nou.";
  return err?.data?.message || err?.message || fallback;
}

/*
 * onAddToCart: POS („Salvează, recepționează și adaugă în coș”). Fără el (Admin → Etichete): doar
 * prețul final + recepția („Salvează și recepționează”); onSaved(line) primește linia actualizată.
 */
export default function PosReceiveSheet({ lineId, onClose, onAddToCart = null, onSaved = null }) {
  const withCart = typeof onAddToCart === "function";
  const [line, setLine] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [qtyText, setQtyText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [fields, setFields] = useState({});
  const [done, setDone] = useState([]); // pașii reușiți: price | receive | cart
  const [failure, setFailure] = useState(null); // { step, message }
  const [busy, setBusy] = useState(false);
  const [labelBusy, setLabelBusy] = useState(false);
  const busyRef = useRef(false);
  // o fișă = o recepție: aceeași cheie la dublu click / „Reia” => serverul nu recepționează de două ori
  const receiveKeyRef = useRef(`pos-sheet-${newIdempotencyKey()}`);
  const initRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api(`${FAIR_API}/inventory/${encodeURIComponent(lineId)}`);
      setLine(res.item);
      setLoadError("");
      if (!initRef.current) {
        initRef.current = true;
        setQtyText(String(Math.max(0, (res.item.declaredQty || 0) - (res.item.receivedQty || 0))));
        setPriceText(toInput(res.item.pricing?.salePriceCents ?? res.item.priceCents));
      }
      return res.item;
    } catch (err) {
      setLoadError(errorText(err, "Produsul nu a putut fi încărcat."));
      return null;
    }
  }, [lineId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busyRef.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const blocked = line ? sheetBlockReason(line) : null;
  const check = line ? validateSheet({ qtyText, priceText, confirmed }, line) : null;
  const currentPrice = line?.pricing?.salePriceCents ?? line?.priceCents ?? null;
  const price = check?.priceCents ?? currentPrice;
  const priceChanged = check?.priceCents != null && check.priceCents !== currentPrice;
  // regula actuală: vânzătorul primește prețul declarat; Artfest adaosul + accesoriile
  const split = line ? splitAtPrice(price, line.pricing?.vendorPriceCents ?? line.priceCents, line.accessories?.unitCents || 0) : null;
  const proposedCents = line?.pricing?.proposedFinalPriceCents ?? null;
  const allDone = withCart ? done.includes("cart") : done.includes("receive");

  async function run() {
    if (busyRef.current || !line) return;
    if (blocked && !done.includes("receive")) return;
    if (!done.includes("receive")) {
      setFields(check.fields);
      if (!check.ok) return;
    }
    if (split?.negative) {
      setFailure({ step: "price", message: `Prețul final e sub minimul de ${formatLei(split.floorPriceCents)} (preț declarat + accesorii): mărește-l.` });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    const completed = [...done];
    let step = null;
    try {
      for (step of pendingSteps(completed, { priceChanged, withCart })) {
        if (step === "price") {
          await api(`${FAIR_API}/inventory/${encodeURIComponent(line.id)}/final-price`, { method: "POST", body: { finalPriceCents: check.priceCents } });
        } else if (step === "receive") {
          await api(`${FAIR_API}/inventory/${encodeURIComponent(line.id)}/receive`, {
            method: "POST",
            headers: { "Idempotency-Key": receiveKeyRef.current },
            body: { receivedQty: check.qty, posSale: true },
          });
        } else if (step === "cart") {
          const fresh = await load();
          const outcome = await onAddToCart(line.barcode, { effectivePriceCents: fresh?.pricing?.salePriceCents ?? price });
          if (!outcome?.ok) throw Object.assign(new Error(outcome?.message || "Produsul nu a putut fi adăugat în coș."), { status: 200, cart: true });
        }
        completed.push(step);
        setDone([...completed]);
      }
      const fresh = await load();
      if (fresh) onSaved?.(fresh);
    } catch (err) {
      setFailure({ step, message: err?.cart ? err.message : errorText(err, "Pasul nu a reușit.") });
      // salvare parțială (ex. prețul): rândul din listă reflectă exact ce s-a salvat
      const fresh = await load();
      if (fresh) onSaved?.(fresh);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function generateLabel() {
    if (labelBusy || !line) return;
    setLabelBusy(true);
    try {
      const copies = Math.min(Math.max(line.availableQty || check?.qty || 1, 1), 240);
      await downloadLabelsPdf(`${FAIR_API}/inventory/labels.pdf`, `etichete-${line.barcode}.pdf`, "Nu am putut genera eticheta.", { body: { ids: [line.id], copies } });
      await load();
      setFailure((f) => (f?.step === "cart" ? { ...f, message: "Eticheta a fost generată. Apasă „Reia” pentru a adăuga produsul în coș." } : f));
    } catch (err) {
      setFailure({ step: "label", message: err?.message || "Nu am putut genera eticheta." });
    } finally {
      setLabelBusy(false);
    }
  }

  const title = "Produs în inventar, nerecepționat";
  const receivedNow = done.includes("receive");
  return (
    <div className={styles.cameraBackdrop} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.toolBox}>
        <div className={styles.cameraHead}>
          <strong>{title}</strong>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={busy}>
            Închide
          </button>
        </div>
        {loadError && (
          <p className={styles.cameraError} role="alert">
            {loadError}
          </p>
        )}
        {!line ? (
          !loadError && <p className={shared.subtle}>Se încarcă…</p>
        ) : (
          <>
            <div className={styles.sheetHead}>
              {line.imageUrl && <img className={styles.sheetPhoto} src={line.imageUrl} alt="" />}
              <div>
                <strong className={styles.savedTitle}>{line.title}</strong>
                {line.variantLabel && <div className={shared.subtle}>{line.variantLabel}</div>}
                <div className={shared.subtle}>
                  {line.vendor?.name || "Participant"}
                  {line.storeName ? ` · ${line.storeName}` : ""} · {line.barcodeDisplay}
                </div>
                <dl className={styles.sheetQty}>
                  <div>
                    <dt>Declarat</dt>
                    <dd>{line.declaredQty} buc.</dd>
                  </div>
                  <div>
                    <dt>Recepționat</dt>
                    <dd>{line.receivedQty || 0} buc.</dd>
                  </div>
                  <div>
                    <dt>Preț declarat</dt>
                    <dd>{formatLei(line.pricing?.vendorPriceCents ?? line.priceCents)}</dd>
                  </div>
                </dl>
              </div>
            </div>

            {blocked && !receivedNow ? (
              <p className={styles.cameraError} role="alert">
                {blocked}
              </p>
            ) : (
              <>
                <p className={styles.notice}>
                  Scanarea nu confirmă prezența: introdu câte bucăți ai primit fizic și confirmă. Prețul declarat de vânzător și prețul online nu se
                  schimbă; modificările se aplică doar vânzărilor viitoare.
                </p>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span>Cantitate primită fizic (max. {Math.max(0, (line.declaredQty || 0) - (line.receivedQty || 0))})</span>
                    <input
                      inputMode="numeric"
                      value={qtyText}
                      onChange={(e) => {
                        setQtyText(e.target.value);
                        setConfirmed(false);
                        setFields({});
                      }}
                      disabled={busy || receivedNow}
                      aria-label="Cantitate primită fizic"
                    />
                    {fields.qty && <small className={styles.fieldError}>{fields.qty}</small>}
                  </label>
                  <label className={styles.field}>
                    <span>Preț final propus de Artfest (lei)</span>
                    <input
                      inputMode="decimal"
                      value={priceText}
                      onChange={(e) => {
                        setPriceText(e.target.value);
                        setFields({});
                        setDone((d) => d.filter((s) => s !== "price"));
                      }}
                      disabled={busy || done.includes("cart")}
                      aria-label="Preț final propus de Artfest"
                    />
                    {fields.price && <small className={styles.fieldError}>{fields.price}</small>}
                  </label>
                </div>
                {line.label?.state === "outdated" || (priceChanged && line.label?.state === "valid") ? (
                  <small className={shared.subtle}>Eticheta are alt preț: nu trebuie retipărită, prețul final se trece automat ca preț efectiv în coș.</small>
                ) : null}

                <div className={styles.toolActions}>
                  <FairAccessoriesButton
                    line={line}
                    onSaved={async () => {
                      const fresh = await load();
                      if (fresh) onSaved?.(fresh);
                    }}
                  />
                  {line.accessories?.unitCents > 0 && (
                    <span className={styles.accSplit}>
                      {accessoriesListText(line.accessories.items)} = {formatLei(line.accessories.unitCents)} / buc.
                    </span>
                  )}
                </div>

                <PriceBreakdown split={split} proposedCents={proposedCents} />
                {proposedCents != null && check?.priceCents !== proposedCents && (
                  <button type="button" className={styles.ghostBtn} onClick={() => setPriceText(toInput(proposedCents))} disabled={busy || done.includes("cart")}>
                    Folosește prețul propus ({formatLei(proposedCents)})
                  </button>
                )}

                {!receivedNow && (
                  <label className={styles.confirmBox}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={busy || !check?.qty}
                    />
                    <span>
                      {check?.qty
                        ? `Confirm că am primit fizic ${check.qty} buc. Recepția se înregistrează în numele meu.`
                        : "Confirm primirea fizică (completează întâi cantitatea)."}
                    </span>
                  </label>
                )}
                {fields.confirm && <small className={styles.fieldError}>{fields.confirm}</small>}

                {(done.length > 0 || failure) && (
                  <ul className={styles.sheetSteps} aria-label="Ce s-a salvat">
                    {["price", "receive", "cart"]
                      .filter((s) => done.includes(s) || failure?.step === s)
                      .map((s) => (
                        <li key={s} className={done.includes(s) ? styles.stateOk : styles.stateBlocked}>
                          {done.includes(s) ? "✓" : "✗"} {SHEET_STEP_LABEL[s]}
                          {s === "receive" && done.includes(s) ? `: ${check?.qty ?? line.receivedQty} buc.` : ""}
                        </li>
                      ))}
                  </ul>
                )}
                {failure && (
                  <p className={styles.cameraError} role="alert">
                    {failure.message}
                  </p>
                )}
                {failure?.step === "cart" && line.label?.state === "none" && (
                  <button type="button" className={styles.ghostBtn} onClick={generateLabel} disabled={labelBusy}>
                    {labelBusy ? "Se generează…" : `Generează etichetă (${Math.max(line.availableQty || 1, 1)} buc.)`}
                  </button>
                )}

                <div className={styles.toolActions}>
                  {allDone ? (
                    <button type="button" className={styles.primaryBtn} onClick={onClose}>
                      Gata - închide fișa
                    </button>
                  ) : (
                    <button type="button" className={styles.primaryBtn} onClick={run} disabled={busy}>
                      {busy
                        ? "Se salvează…"
                        : failure || done.length
                          ? "Reia (doar pașii rămași)"
                          : withCart
                            ? "Salvează, recepționează și adaugă în coș"
                            : "Salvează și recepționează"}
                    </button>
                  )}
                </div>
                <small className={shared.subtle}>Stocul scade doar la confirmarea încasării. Recepția se face o singură dată (dublu click / „Reia” nu o repetă).</small>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
