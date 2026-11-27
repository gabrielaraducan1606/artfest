// src/pages/Admin/AdminDesktop/tabs/AdminFairPosPanel.jsx
//
// Admin -> Târg Artfest -> POS / Vânzare (MVP, fără fiscalizare).
// Scanner (tastatură / USB 1D, Enter) -> coș -> preview calculat pe server ->
// CASH / CARD -> vânzare atomică cu Idempotency-Key. Numărul intern
// (ex. TA26-000123) NU este bon fiscal.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "../../../../lib/api";
import shared from "../AdminDesktop.module.css";
import styles from "./AdminFairPos.module.css";
import {
  DISPOSITION_LABEL,
  PAYMENT_LABEL,
  POS_API,
  RESPONSIBILITY_LABEL,
  RETURN_TYPE_LABEL,
  SALE_STATUS_LABEL,
  canSubmit,
  cartInputProblems,
  cartPayload,
  cartSignature,
  classifyScan,
  formatLei,
  invalidCodeMessage,
  keyTargetKind,
  PROMO_QR_MESSAGE,
  scanErrorMessage,
  shouldRedirectToScanner,
  isAboveLabel,
  initialPosState,
  newIdempotencyKey,
  posReducer,
  scanRejectMessage,
} from "./adminFairPos.js";
import PosCameraScanner from "./PosCameraScanner.jsx";
import { AddProductDialog, ProductsDialog } from "./PosProductTools.jsx";
import PosReceiveSheet from "./PosReceiveSheet.jsx";
import { downloadLabelsPdf } from "../../../Vendor/Fair/fairInventory.js";
import { SaleReturnModal, SaleVoidModal } from "./AdminFairSaleReturn.jsx";
import { isValidDate, reportUrl, todayFairDate } from "../../../Vendor/Fair/fairSales.js";
import { accessoriesListText } from "../../../Vendor/Fair/fairAccessories.js";

function errorMessage(err, fallback) {
  const problems = err?.data?.problems;
  if (Array.isArray(problems) && problems.length) {
    return problems.map((p) => `${p.title || "Produs"}: ${(p.messages || []).join(" ")}`).join(" · ");
  }
  return err?.data?.message || err?.message || fallback;
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" });
}

/* ===================== Vânzare ===================== */

/*
 * Prețul pe rând (calculat pe server, la fiecare modificare). Regula actuală pentru participanți:
 * vânzătorul primește prețul DECLARAT integral; Artfest adaosul (10% din declarat) + accesoriile.
 * O reducere la casă diminuează doar adaosul; sub declarat + accesorii vânzarea se blochează. Prețul efectiv se poate introduce la casă
 * pentru orice participant aprobat, doar pentru vânzarea curentă, fără retipărirea etichetei.
 */
function PriceCell({ line: l, priced: p, busy, dispatch }) {
  const id = l.inventoryItemId;
  const unit = (cents) => (p && l.quantity ? formatLei(Math.round(cents / l.quantity)) : "…");
  return (
    <div className={styles.priceCell}>
      {l.vendorPriceCents != null && l.canEditPrice && (
        <span className={shared.subtle}>
          Declarat {formatLei(l.vendorPriceCents)}
          {l.suggestedPriceCents != null ? ` · Propus ${formatLei(l.suggestedPriceCents)}` : ""}
        </span>
      )}
      <span className={shared.subtle}>{l.blankPriceLabel ? "Etichetă fără preț tipărit" : `Etichetă ${formatLei(l.labelPriceCents)}`}</span>
      {l.blankPriceLabel && <span className={styles.split}>Introdu prețul scris pe etichetă.</span>}
      {l.requiresPrice && !l.blankPriceLabel && (
        <span className={styles.split}>Eticheta are alt preț decât cel actual: vinde cu prețul de mai jos, fără retipărire.</span>
      )}
      {l.canEditPrice ? (
        <label className={styles.priceEdit}>
          <span>Preț efectiv</span>
          <input
            className={styles.priceInput}
            inputMode="decimal"
            data-pos-numeric=""
            value={l.priceInput}
            placeholder={l.labelPriceCents != null ? formatLei(l.labelPriceCents).replace(" lei", "") : "preț"}
            onChange={(e) => dispatch({ type: "SET_PRICE", inventoryItemId: id, value: e.target.value })}
            disabled={busy}
            aria-label={`Preț efectiv pe bucată, ${l.title}`}
          />
          <span>lei</span>
        </label>
      ) : (
        <strong>{unit(p?.lineGrossCents ?? l.priceCents * l.quantity)}</strong>
      )}
      {l.canEditPrice && isAboveLabel(l) && (
        <label className={styles.aboveLabel}>
          <input
            type="checkbox"
            checked={l.aboveLabelConfirmed}
            onChange={(e) => dispatch({ type: "CONFIRM_ABOVE_LABEL", inventoryItemId: id, value: e.target.checked })}
            disabled={busy}
          />
          <span>
            Prețul introdus ({l.priceInput} lei) este <strong>mai mare</strong> decât prețul de pe etichetă ({formatLei(l.salePriceCents)}).
            Confirm prețul pentru această vânzare (fără retipărirea etichetei).
          </span>
        </label>
      )}
      <span className={styles.split}>
        {p?.artfestOwned ? (
          <>Produs Artfest: integral Artfest {unit(p?.commissionCents ?? 0)}</>
        ) : p?.financeRule === "DECLARED_PLUS_MARKUP" ? (
          <>
            Vânzător (preț declarat) {unit(p.vendorNetCents)} · Adaos Artfest {unit(Math.max(0, p.commissionCents))}
            {(p.accessoriesCents || 0) > 0 && <> · Accesorii {unit(p.accessoriesCents)}</>}
          </>
        ) : p?.financeRule === "DISCOUNTED_COMMISSION" ? (
          <>
            Accesorii {unit(p.accessoriesCents || 0)} · Comision 10% {unit(Math.max(0, p.commissionCents))} · Vânzător {unit(p.vendorNetCents)}
          </>
        ) : (
          <>
            Comision 10% {unit(p?.commissionCents ?? 0)}
            {/* „Ambalare și accesorii” Artfest: reținute din partea vânzătorului */}
            {(p?.accessoriesCents || 0) > 0 && <> · Ambalare și accesorii {unit(p.accessoriesCents)}</>} · Vânzător {unit(p?.vendorNetCents ?? 0)}
          </>
        )}
        {l.quantity > 1 ? " / buc." : ""}
      </span>
      {(p?.accessoriesCents || 0) > 0 && p.accessories?.length > 0 && (
        <span className={shared.subtle}>Accesorii pe bucată: {accessoriesListText(p.accessories)}</span>
      )}
      {/* sub prețul propus: reducerea afectează suma vânzătorului - calculul complet, înainte de confirmare */}
      {p?.financeRule === "DISCOUNTED_COMMISSION" && p.baseCents >= 0 && (
        <span className={styles.vendorReduced} role="note">
          Sub prețul propus ({formatLei(p.proposedUnitPriceCents * l.quantity)}{l.quantity > 1 ? ` pentru ${l.quantity} buc.` : ""}): reducerea afectează suma vânzătorului.
          Încasat {formatLei(p.lineGrossCents)} − accesorii {formatLei(p.accessoriesCents || 0)} = bază {formatLei(p.baseCents)}; comision Artfest 10%{" "}
          {formatLei(p.commissionCents)}; vânzătorul {formatLei(p.vendorNetCents)} în loc de {formatLei(p.declaredLineCents)}; Artfest{" "}
          {formatLei(p.lineGrossCents - p.vendorNetCents)}.
        </span>
      )}
    </div>
  );
}

function SalePanel({ salesOpen, inventory }) {
  const [state, dispatch] = useReducer(posReducer, initialPosState);
  // scanări trimise la server și încă fără răspuns (doar pentru indicația „Se verifică…”)
  const [pendingScans, setPendingScans] = useState(0);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const scanRef = useRef(null);
  // o cheie per coș + metodă: retry / dublu click => aceeași vânzare pe server
  const keyRef = useRef({ signature: "", key: "" });
  // coșul curent, pentru rezultatul arătat în fereastra camerei (fără să aștepte randarea)
  const cartRef = useRef(state.cart);
  cartRef.current = state.cart;
  // camera telefonului: cât e deschisă, focusul NU se mută în câmpul de cod; după închidere,
  // nici el (pe telefon ar deschide tastatura) - până la prima tastă fizică (scanner USB / tastatură)
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraOpenRef = useRef(false);
  // „Adaugă produs” / „Produse / Etichete”: aceeași regulă de focus ca la cameră
  const [tool, setTool] = useState(null); // null | "add" | "addStore" | "products" | "receive"
  // fișa produsului nerecepționat (id-ul liniei) și ultimul cod AF negăsit
  const [sheetLineId, setSheetLineId] = useState(null);
  const [notFoundCode, setNotFoundCode] = useState(null);
  const toolOpenRef = useRef(false);
  const autoFocusBlockedRef = useRef(false);

  // focusul revine pe scanner DOAR dacă nu editezi alt câmp (preț, cantitate, alt câmp text)
  const focusScanner = useCallback(() => {
    requestAnimationFrame(() => {
      const input = scanRef.current;
      if (!input || input.disabled) return;
      if (cameraOpenRef.current || toolOpenRef.current || autoFocusBlockedRef.current) return;
      const kind = keyTargetKind(document.activeElement, input);
      if (kind === "scanner" || kind === "other") input.focus();
    });
  }, []);

  useEffect(() => {
    focusScanner();
  }, [focusScanner, state.cart.length, state.lastSale, state.busy]);

  /*
   * Scannerul USB / Bluetooth „tastează” codul foarte repede, urmat de Enter. Ascultăm în faza de
   * captură, ca nicio literă să nu se piardă: dacă focusul e pe pagină / un buton / o bifă, sau
   * pe preț / cantitate și vine o literă (codul începe cu „AF”), tasta e mutată SINCRON în
   * câmpul de scanare (înainte, focusul se muta abia la cadrul următor și primele caractere se
   * pierdeau). Cifrele tastate în preț / cantitate și orice alt câmp text rămân neatinse.
   */
  useEffect(() => {
    const onKey = (e) => {
      const input = scanRef.current;
      if (!input || input.disabled || cameraOpenRef.current || toolOpenRef.current) return;
      // o tastă fizică (scanner USB / tastatură): focusul automat revine
      autoFocusBlockedRef.current = false;
      if (!shouldRedirectToScanner(e, keyTargetKind(e.target, input))) return;
      e.preventDefault();
      input.focus();
      input.value += e.key;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const signature = cartSignature(state.cart);
  useEffect(() => {
    if (!state.cart.length) {
      setPreview(null);
      setPreviewError("");
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api(`${POS_API}/preview`, { method: "POST", body: { lines: JSON.parse(signature) } });
        if (!cancelled) {
          // totalul afișat ține minte coșul pentru care a fost calculat
          setPreview({ ...res, signature });
          setPreviewError("");
        }
      } catch (err) {
        if (!cancelled) setPreviewError(errorMessage(err, "Nu am putut calcula totalul."));
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [signature, state.cart.length]);

  /*
   * O scanare = conținutul câmpului la Enter (sau Tab, dacă scannerul e setat cu Tab la final).
   * Câmpul e citit și golit SINCRON, deci un Enter / Tab în plus trimis de scanner găsește
   * câmpul gol și nu mai procesează aceeași scanare a doua oară. Două scanări intenționate ale
   * aceluiași produs sunt două cereri => coșul crește cantitatea (în limita stocului), ca înainte.
   */
  /*
   * Căutarea codului la server + adăugarea în coș (o bucată): ACEEAȘI funcție pentru câmpul de
   * cod, scannerul USB / Bluetooth și camera. Întoarce rezultatul, pentru fereastra camerei.
   */
  async function lookupAndAdd(barcode, { effectivePriceCents = null } = {}) {
    setPendingScans((n) => n + 1);
    try {
      const res = await api(`${POS_API}/scan?barcode=${encodeURIComponent(barcode)}`);
      setNotFoundCode(null);
      // trimis de vânzător, dar nerecepționat: aceeași linie, fișa de recepție (fără produs nou / alt cod)
      if (res.item.notReceived) {
        const message = `${res.item.title}: produs în inventar, nerecepționat. Completează fișa de recepție.`;
        dispatch({ type: "SCAN_ERROR", message });
        setSheetLineId(res.item.inventoryItemId);
        openTool("receive");
        return { ok: false, handoff: true, message };
      }
      const rejected = scanRejectMessage(cartRef.current, res.item);
      dispatch({ type: "SCANNED", item: res.item });
      // din fișă: eticheta are alt preț => prețul final ca preț efectiv (fără retipărire)
      if (!rejected && effectivePriceCents && res.item.requiresPrice) {
        dispatch({ type: "SET_PRICE", inventoryItemId: res.item.inventoryItemId, value: (effectivePriceCents / 100).toFixed(2).replace(".", ",") });
      }
      return rejected ? { ok: false, message: rejected } : { ok: true, title: res.item.title };
    } catch (err) {
      const message = scanErrorMessage(err, barcode);
      dispatch({ type: "SCAN_ERROR", message });
      // „Cod negăsit”: fără creare automată; se poate adăuga manual un produs într-un magazin
      // (camera rămâne deschisă cu „Reîncearcă”, ca înainte; butonul apare în POS după închidere)
      if (Number(err?.status) === 404) {
        setNotFoundCode(barcode);
        return { ok: false, message: `${message} Închide camera pentru „Adaugă produs într-un magazin”.` };
      }
      return { ok: false, message };
    } finally {
      setPendingScans((n) => n - 1);
      focusScanner();
    }
  }

  async function submitScan() {
    const input = scanRef.current;
    if (!input) return;
    const scan = classifyScan(input.value);
    input.value = "";
    if (scan.kind === "empty") return;
    if (scan.kind === "promo") {
      dispatch({ type: "SCAN_ERROR", message: PROMO_QR_MESSAGE });
      return;
    }
    if (!scan.valid) {
      dispatch({ type: "SCAN_ERROR", message: invalidCodeMessage(scan) });
      return;
    }
    await lookupAndAdd(scan.barcode);
  }

  /*
   * Textul citit de cameră (QR sau Code128): aceeași normalizare și validare ca la câmpul de cod.
   * QR de promovare / text care nu e cod de produs: doar mesaj în fereastră, scanarea continuă.
   */
  async function scanFromCamera(raw) {
    const scan = classifyScan(raw);
    if (scan.kind === "empty") return { ok: false, continueScanning: true, message: "" };
    if (scan.kind === "promo") return { ok: false, continueScanning: true, message: PROMO_QR_MESSAGE };
    if (!scan.valid) return { ok: false, continueScanning: true, message: invalidCodeMessage(scan) };
    return lookupAndAdd(scan.barcode);
  }

  function openCamera() {
    cameraOpenRef.current = true;
    autoFocusBlockedRef.current = true;
    // câmpul de cod nu rămâne activ sub fereastră (pe telefon ar ține tastatura deschisă)
    if (document.activeElement === scanRef.current) scanRef.current?.blur();
    setCameraOpen(true);
  }

  function closeCamera() {
    cameraOpenRef.current = false;
    setCameraOpen(false);
  }

  function openTool(name) {
    toolOpenRef.current = true;
    autoFocusBlockedRef.current = true;
    if (document.activeElement === scanRef.current) scanRef.current?.blur();
    setTool(name);
  }

  const closeTool = useCallback(() => {
    toolOpenRef.current = false;
    setTool(null);
  }, []);

  function onScan(event) {
    event.preventDefault();
    submitScan();
  }

  async function pay(paymentMethod) {
    if (!canSubmit(state, preview, signature)) return;
    const sig = `${signature}|${paymentMethod}`;
    if (keyRef.current.signature !== sig) keyRef.current = { signature: sig, key: newIdempotencyKey() };
    const total = preview?.totals?.totalPaidCents;
    if (!window.confirm(`Confirmi încasarea ${formatLei(total)} prin ${PAYMENT_LABEL[paymentMethod].toLowerCase()}?`)) return;

    dispatch({ type: "SUBMIT_START" });
    try {
      const res = await api(`${POS_API}/sales`, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current.key },
        body: { lines: cartPayload(state.cart), paymentMethod },
      });
      keyRef.current = { signature: "", key: "" };
      dispatch({ type: "SUBMIT_SUCCESS", sale: res.sale });
    } catch (err) {
      dispatch({ type: "SUBMIT_ERROR", message: errorMessage(err, "Vânzarea nu a reușit.") });
    } finally {
      focusScanner();
    }
  }

  const problems = new Map((preview?.problems || []).map((p) => [p.inventoryItemId, p]));
  const inputProblems = cartInputProblems(state.cart);
  const previewFresh = preview?.signature === signature;
  const priced = new Map((preview?.lines || []).map((l) => [l.inventoryItemId, l]));

  return (
    <div className={styles.layout}>
      <section className={styles.cartCol} aria-label="Coș">
        <form className={styles.scanRow} onSubmit={onScan}>
          {/* necontrolat: scannerul tastează mai repede decât randarea; valoarea e citită la Enter */}
          <input
            ref={scanRef}
            className={styles.scanInput}
            defaultValue=""
            onKeyDown={(e) => {
              // scanner setat cu Tab la final: Tab cu un cod în câmp = Enter
              if (e.key === "Tab" && !e.shiftKey && e.currentTarget.value.trim()) {
                e.preventDefault();
                submitScan();
              }
            }}
            placeholder="Scanează sau introdu codul (AF-XXXX-XXXX)"
            aria-label="Scanează sau introdu codul"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            disabled={state.busy}
          />
          <button type="submit" className={styles.ghostBtn} disabled={state.busy}>
            Adaugă
          </button>
        </form>
        <button type="button" className={styles.cameraBtn} onClick={openCamera} disabled={state.busy}>
          Scanează cu camera
        </button>
        {cameraOpen && <PosCameraScanner onScan={scanFromCamera} onClose={closeCamera} />}
        <div className={styles.toolButtons}>
          <button type="button" className={styles.ghostBtn} onClick={() => openTool("add")} disabled={state.busy}>
            Adaugă produs
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => openTool("products")} disabled={state.busy}>
            Produse / Etichete
          </button>
        </div>
        {tool === "add" && (
          <AddProductDialog inventory={inventory} onClose={closeTool} onAddToCart={lookupAndAdd} onOpenReceiveSheet={(id) => { setSheetLineId(id); openTool("receive"); }} />
        )}
        {tool === "addStore" && (
          <AddProductDialog
            mode="store"
            inventory={inventory}
            onClose={() => {
              setNotFoundCode(null);
              closeTool();
            }}
            onAddToCart={lookupAndAdd}
            onOpenReceiveSheet={(id) => {
              setSheetLineId(id);
              openTool("receive");
            }}
          />
        )}
        {tool === "receive" && sheetLineId && (
          <PosReceiveSheet
            lineId={sheetLineId}
            onClose={() => {
              setSheetLineId(null);
              closeTool();
            }}
            onAddToCart={lookupAndAdd}
          />
        )}
        {tool === "products" && <ProductsDialog onClose={closeTool} onAddToCart={lookupAndAdd} />}
        <p className={shared.subtle} aria-live="polite">
          {pendingScans > 0
            ? "Se verifică codul…"
            : "Scanează codul de bare de pe eticheta produsului sau tastează codul și apasă Enter. Stocul scade doar la încasare."}
        </p>
        {state.notice && !state.error && (
          <p className={styles.scanNotice} role="status">
            {state.notice}
          </p>
        )}
        {!salesOpen && <p className={styles.warning}>Vânzările sunt închise. Deschide-le din bara de sus.</p>}
        {state.error && (
          <div className={shared.error} role="alert">
            {state.error}
          </div>
        )}
        {notFoundCode && (
          <div className={styles.notFoundBox}>
            <span className={shared.subtle}>Codul scanat nu devine cod AF și nu se asociază cu niciun produs.</span>
            <button type="button" className={styles.primaryBtn} onClick={() => openTool("addStore")} disabled={state.busy}>
              Adaugă produs într-un magazin
            </button>
          </div>
        )}

        {state.lastSale && !state.cart.length ? (
          <div className={styles.success} role="status">
            <strong>Vânzare înregistrată: {state.lastSale.receiptReference}</strong>
            <span>
              Total {formatLei(state.lastSale.totalPaidCents)} · {PAYMENT_LABEL[state.lastSale.paymentMethod]}
            </span>
            <ul>
              {state.lastSale.lines.map((l) => (
                <li key={l.id}>
                  {l.title} × {l.quantity} - {formatLei(l.lineGrossCents)}
                </li>
              ))}
            </ul>
            <span className={shared.subtle}>Număr intern de vânzare - nu este bon fiscal.</span>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={() => {
                dispatch({ type: "NEW_SALE" });
                focusScanner();
              }}
            >
              Vânzare nouă
            </button>
          </div>
        ) : state.cart.length === 0 ? (
          <p className={shared.subtle}>Coșul e gol. Scanează primul produs.</p>
        ) : (
          <table className={shared.table}>
            <thead>
              <tr>
                <th>Produs</th>
                <th>Vendor</th>
                <th>Preț</th>
                <th>Cantitate</th>
                <th>Subtotal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {state.cart.map((l) => {
                const p = priced.get(l.inventoryItemId);
                const problem = problems.get(l.inventoryItemId);
                return (
                  <tr key={l.inventoryItemId} className={problem ? styles.rowError : undefined}>
                    <td>
                      <strong>{l.title}</strong>
                      {l.variantLabel && <div className={shared.subtle}>{l.variantLabel}</div>}
                      <div className={shared.subtle}>{l.barcodeDisplay}</div>
                      {p?.discount && (
                        <div className={styles.discount}>
                          Reducere „{p.discount.name}”: −{formatLei(p.lineDiscountCents)}
                        </div>
                      )}
                      {problem && <div className={styles.errorText}>{problem.messages.join(" ")}</div>}
                    </td>
                    <td>{l.vendorName || "—"}</td>
                    <td>
                      <PriceCell line={l} priced={p} busy={state.busy} dispatch={dispatch} />
                    </td>
                    <td>
                      <div className={styles.qty}>
                        <button type="button" onClick={() => dispatch({ type: "DEC", inventoryItemId: l.inventoryItemId })} disabled={state.busy || l.quantity <= 1} aria-label="Scade">
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={l.availableQty}
                          value={l.quantity}
                          data-pos-numeric=""
                          onChange={(e) => dispatch({ type: "SET_QTY", inventoryItemId: l.inventoryItemId, quantity: e.target.value })}
                          disabled={state.busy}
                          aria-label={`Cantitate ${l.title}`}
                        />
                        <button type="button" onClick={() => dispatch({ type: "INC", inventoryItemId: l.inventoryItemId })} disabled={state.busy || l.quantity >= l.availableQty} aria-label="Crește">
                          +
                        </button>
                      </div>
                      <div className={shared.subtle}>max {l.availableQty}</div>
                    </td>
                    <td>{p ? formatLei(p.lineGrossCents) : "…"}</td>
                    <td>
                      <button type="button" className={styles.ghostBtn} onClick={() => dispatch({ type: "REMOVE", inventoryItemId: l.inventoryItemId })} disabled={state.busy}>
                        Elimină
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <aside className={styles.summaryCol} aria-label="Total">
        <h4>Total</h4>
        {previewError && <div className={shared.error}>{previewError}</div>}
        {preview && state.cart.length > 0 ? (
          <>
            <dl className={styles.totals}>
              <div>
                <dt>Preț de listă</dt>
                <dd>{formatLei(preview.totals.listCents)}</dd>
              </div>
              <div>
                <dt>Reduceri</dt>
                <dd>−{formatLei(preview.totals.discountCents)}</dd>
              </div>
              <div className={styles.grand}>
                <dt>De plată</dt>
                <dd>{formatLei(preview.totals.totalPaidCents)}</dd>
              </div>
            </dl>
            <details className={styles.breakdown}>
              <summary>Pe vânzător</summary>
              <ul>
                {preview.vendors.map((v) => (
                  <li key={v.vendorId}>
                    {v.vendorName || v.vendorId}: {formatLei(v.grossCents)} · comision Artfest {formatLei(v.commissionCents)}
                    {(v.accessoriesCents || 0) > 0 ? ` · ambalare și accesorii ${formatLei(v.accessoriesCents)}` : ""} · vânzătorului{" "}
                    {formatLei(v.vendorNetCents)}
                  </li>
                ))}
                {preview.totals.artfest && (
                  <li>
                    Artfest total {formatLei(preview.totals.artfest.totalCents)} = comision {formatLei(preview.totals.artfest.commissionCents)} + accesorii{" "}
                    {formatLei(preview.totals.artfest.accessoriesCents)} + produse proprii {formatLei(preview.totals.artfest.ownProductsCents)}
                  </li>
                )}
              </ul>
            </details>
            <div className={styles.payRow}>
              {["CASH", "CARD"].map((method) => (
                <button
                  key={method}
                  type="button"
                  className={styles.payBtn}
                  onClick={() => pay(method)}
                  disabled={!salesOpen || !canSubmit(state, preview, signature)}
                >
                  {state.busy ? "Se înregistrează…" : `Încasează ${PAYMENT_LABEL[method].toLowerCase()}`}
                </button>
              ))}
            </div>
            {!preview.canConfirm && <p className={styles.errorText}>Elimină sau corectează produsele marcate.</p>}
            {inputProblems.map((msg) => (
              <p key={msg} className={styles.errorText}>
                {msg}
              </p>
            ))}
            {!previewFresh && !inputProblems.length && <p className={shared.subtle}>Se recalculează totalul…</p>}
          </>
        ) : (
          <p className={shared.subtle}>—</p>
        )}
      </aside>
    </div>
  );
}

/* ===================== Vânzări ===================== */

function SalesHistory() {
  const [items, setItems] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(null); // "return" | "void"

  const loadList = useCallback(async () => {
    try {
      const res = await api(`${POS_API}/sales`);
      setItems(res.items || []);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca vânzările."));
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // doar ultima vânzare deschisă poate actualiza detaliul (altfel o reîncărcare
  // întârziată ar putea pune înapoi altă vânzare sub butoanele de retur / anulare)
  const openSeq = useRef(0);

  async function open(id, message = "") {
    const seq = ++openSeq.current;
    setDetail((current) => (current?.id === id ? current : null));
    setNotice(message);
    try {
      const res = await api(`${POS_API}/sales/${encodeURIComponent(id)}`);
      if (seq === openSeq.current) setDetail(res.item);
    } catch (err) {
      if (seq === openSeq.current) setError(errorMessage(err, "Nu am putut încărca vânzarea."));
    }
  }

  async function afterReturn(message) {
    setModal(null);
    await Promise.all([loadList(), detail ? open(detail.id, message) : null]);
  }

  if (error) return <div className={shared.error}>{error}</div>;
  if (!items) return <p className={shared.subtle}>Se încarcă…</p>;
  if (!items.length) return <p className={shared.subtle}>Nicio vânzare încă.</p>;

  return (
    <div className={styles.history}>
      <table className={shared.table}>
        <thead>
          <tr>
            <th>Număr</th>
            <th>Data</th>
            <th>Total</th>
            <th>Plată</th>
            <th>Status</th>
            <th>Produse</th>
            <th>Returnate</th>
            <th>Vendori</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>{s.receiptReference}</td>
              <td>{formatDate(s.soldAt)}</td>
              <td>{formatLei(s.totalPaidCents)}</td>
              <td>{PAYMENT_LABEL[s.paymentMethod] || s.paymentMethod}</td>
              <td>{SALE_STATUS_LABEL[s.status] || s.status}</td>
              <td>{s.units}</td>
              <td>{s.returnedUnits || "—"}</td>
              <td>{s.vendors.join(", ")}</td>
              <td>
                <button type="button" className={styles.ghostBtn} onClick={() => open(s.id)}>
                  Detalii
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <section className={styles.detail} aria-label={`Vânzarea ${detail.receiptReference}`}>
          <div className={styles.detailHead}>
            <h4>
              {detail.receiptReference} · {formatLei(detail.totalPaidCents)} · {PAYMENT_LABEL[detail.paymentMethod]} ·{" "}
              {SALE_STATUS_LABEL[detail.status] || detail.status}
            </h4>
            <div className={styles.detailActions}>
              {detail.actions?.canReturn && (
                <button type="button" className={styles.ghostBtn} onClick={() => setModal("return")}>
                  Retur / rambursare
                </button>
              )}
              {detail.actions?.canVoid && (
                <button type="button" className={styles.ghostBtn} onClick={() => setModal("void")}>
                  Anulează vânzarea
                </button>
              )}
              <button type="button" className={styles.ghostBtn} onClick={() => setDetail(null)}>
                Închide
              </button>
            </div>
          </div>
          {notice && <div className={styles.success}>{notice}</div>}
          <p className={shared.subtle}>Număr intern de vânzare - nu este bon fiscal. {formatDate(detail.soldAt)}</p>
          <table className={shared.table}>
            <thead>
              <tr>
                <th>Produs</th>
                <th>Vendor</th>
                <th>Cant.</th>
                <th>Returnat</th>
                <th>Listă</th>
                <th>Reducere</th>
                <th>Încasat</th>
                <th>Comision / adaos</th>
                <th>Accesorii</th>
                <th>Net vendor</th>
                <th>Mișcare stoc</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.title}
                    <div className={shared.subtle}>{l.barcodeDisplay}</div>
                  </td>
                  <td>{l.vendorName || "—"}</td>
                  <td>{l.quantity}</td>
                  <td>{l.returnedQty || "—"}</td>
                  <td>{formatLei(l.lineListCents)}</td>
                  <td>
                    {l.lineDiscountCents ? `−${formatLei(l.lineDiscountCents)}` : "—"}
                    {l.discount && (
                      <div className={shared.subtle}>
                        {l.discount.name} ({l.discount.fundingSource === "ARTFEST" ? "finanțată de Artfest" : "finanțată de vendor"})
                      </div>
                    )}
                  </td>
                  <td>{formatLei(l.lineGrossCents)}</td>
                  <td>
                    {formatLei(l.commissionCents)}
                    {(l.financeRule === "DECLARED_PLUS_MARKUP" || l.financeRule === "DISCOUNTED_COMMISSION") && (
                      <div className={shared.subtle}>
                        {l.financeRule === "DISCOUNTED_COMMISSION" ? "sub propus: 10% după accesorii" : "adaos"} · declarat {formatLei(l.declaredUnitPriceCents)} / buc.
                      </div>
                    )}
                  </td>
                  <td>
                    {(l.accessoriesCents || 0) > 0 ? formatLei(l.accessoriesCents) : "—"}
                    {(l.accessoriesCents || 0) > 0 && <div className={shared.subtle}>{accessoriesListText(l.accessories)} / buc.</div>}
                  </td>
                  <td>{formatLei(l.vendorNetCents)}</td>
                  <td className={shared.subtle}>{l.movements.map((m) => `${m.type} ${m.quantity} · ${m.id}`).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className={styles.vendorTotals}>
            {detail.vendors.map((v) => (
              <li key={v.vendorId}>
                {v.vendorName || v.vendorId}: încasat {formatLei(v.grossCents)} · comision {formatLei(v.commissionCents)} · net{" "}
                {formatLei(v.vendorNetCents)}
                {v.artfestFundedDiscountCents ? ` (din care compensație Artfest ${formatLei(v.artfestFundedDiscountCents)})` : ""}
              </li>
            ))}
          </ul>
          {detail.returns?.length > 0 && (
            <>
              <h4>Retururi / anulări · rambursat {formatLei(detail.refundedCents)}</h4>
              <ul className={styles.vendorTotals}>
                {detail.returns.map((r) => (
                  <li key={r.id}>
                    {RETURN_TYPE_LABEL[r.type]} {r.reference} · {formatDate(r.createdAt)} · {formatLei(r.refundCents)} ({PAYMENT_LABEL[r.refundMethod]}) · comision
                    inversat {formatLei(r.commissionReversedCents)} · net vendor inversat {formatLei(r.vendorNetReversedCents)}
                    {r.artfestFundedReversedCents ? ` · compensație Artfest inversată ${formatLei(r.artfestFundedReversedCents)}` : ""}
                    <div className={shared.subtle}>
                      Motiv: {r.reason} ·{" "}
                      {r.lines
                        .map((rl) => `${detail.lines.find((l) => l.id === rl.saleLineId)?.title || "produs"} × ${rl.quantity} - ${DISPOSITION_LABEL[rl.disposition]}${rl.conditionNote ? ` (${rl.conditionNote})` : ""}${rl.refundResponsibility ? ` · suportat de ${RESPONSIBILITY_LABEL[rl.refundResponsibility]}: ${rl.responsibilityReason}` : ""}`)
                        .join("; ")}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {detail && modal === "return" && <SaleReturnModal sale={detail} onClose={() => setModal(null)} onDone={afterReturn} />}
      {detail && modal === "void" && <SaleVoidModal sale={detail} onClose={() => setModal(null)} onDone={afterReturn} />}
    </div>
  );
}

/* ===================== Raport zilnic ===================== */

function DailyReport() {
  const [date, setDate] = useState(() => todayFairDate());
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!isValidDate(date)) return;
    setBusy(true);
    try {
      setReport(await api(reportUrl(`${POS_API}/reports/daily`, date)));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca raportul."));
    } finally {
      setBusy(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function downloadCsv() {
    setCsvBusy(true);
    setError("");
    try {
      await downloadLabelsPdf(
        reportUrl(`${POS_API}/reports/daily`, date, { csv: true }),
        `raport-targ-artfest-admin-${date}.csv`,
        "Nu am putut exporta raportul."
      );
    } catch (err) {
      setError(err?.message || "Nu am putut exporta raportul.");
    } finally {
      setCsvBusy(false);
    }
  }

  const r = report?.returns;
  const rows = report
    ? [
        ["Vânzări", report.salesCount],
        ["Bucăți", report.units],
        ["Valoare de listă", formatLei(report.listCents)],
        ["Reduceri", formatLei(report.discountCents)],
        ["Încasat", formatLei(report.totalPaidCents)],
        ["Numerar", formatLei(report.cashCents)],
        ["Card", formatLei(report.cardCents)],
        ["Comision / adaos Artfest (inclusiv produse proprii)", formatLei(report.commissionCents)],
        ["Artfest - adaos din produsele participanților (comision la vânzările vechi)", formatLei(report.artfest?.sales.commissionCents)],
        ["Artfest - recuperare ambalare și accesorii (nu este profit net)", formatLei(report.artfest?.sales.accessoriesCents)],
        ["Artfest - vânzări produse proprii", formatLei(report.artfest?.sales.ownProductsCents)],
        ["Artfest - total din vânzări (fără dublare)", formatLei(report.artfest?.sales.totalCents)],
        ["Net datorat vendorilor (vânzări)", formatLei(report.vendorNetCents)],
        ["Compensații Artfest (reduceri Artfest)", formatLei(report.artfestFundedDiscountCents)],
      ]
    : [];
  const returnRows = r
    ? [
        ["Retururi / anulări", `${r.count}${r.voidCount ? ` (din care ${r.voidCount} anulări)` : ""} · ${r.units} buc.`],
        ["Rambursat total", formatLei(r.refundCents)],
        ["Rambursat numerar", formatLei(r.cashRefundCents)],
        ["Rambursat card", formatLei(r.cardRefundCents)],
        ["Rambursări suportate de vendor", formatLei(r.vendorBorne.refundCents)],
        ["Rambursări suportate de Artfest", formatLei(r.artfestBorne.refundCents)],
        ["Comision inversat (imputat vendorului)", formatLei(r.vendorBorne.commissionReversedCents)],
        ["Net vendor inversat (imputat vendorului)", formatLei(r.vendorBorne.vendorNetReversedCents)],
        ["Încasat net al zilei", formatLei(report.netCollectedCents)],
        ["Numerar net", formatLei(report.netCashCents)],
        ["Card net", formatLei(report.netCardCents)],
        ["Comision net al zilei", formatLei(report.dayCommissionCents)],
        ["Accesorii nete ale zilei", formatLei(report.dayAccessoriesCents)],
        ["Artfest - total net al zilei (fără dublare)", formatLei(report.artfest?.day.totalCents)],
        ["Net vendori al zilei", formatLei(report.dayVendorNetCents)],
      ]
    : [];

  return (
    <div className={styles.history}>
      <div className={styles.scanRow}>
        <label>
          Ziua{" "}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Ziua raportului" />
        </label>
        <button type="button" className={styles.ghostBtn} onClick={load} disabled={busy}>
          {busy ? "Se actualizează…" : "Actualizează"}
        </button>
        <button type="button" className={styles.ghostBtn} onClick={downloadCsv} disabled={csvBusy || !report}>
          {csvBusy ? "Se exportă…" : "Export CSV"}
        </button>
      </div>
      <p className={shared.subtle}>
        Ora României (zi locală 00:00 – 24:00). Vânzările zilei cu valorile de la vânzare; retururile apar în ziua în care
        s-au făcut (istoricul zilei vânzării nu se modifică). Sursa sunt liniile vânzărilor și ale retururilor.
      </p>
      {error && <div className={shared.error}>{error}</div>}

      {report && (
        <>
          {!report.consistent && (
            <p className={styles.warning}>
              Totalurile din antetul vânzărilor / retururilor nu corespund cu suma liniilor - verifică ziua.
            </p>
          )}
          <dl className={styles.totals}>
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h4>Retururi și net al zilei</h4>
          <dl className={styles.totals}>
            {returnRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <h4>Pe vendori</h4>
          {report.vendors.length === 0 ? (
            <p className={shared.subtle}>Nicio vânzare sau retur în această zi.</p>
          ) : (
            <table className={shared.table}>
              <thead>
                <tr>
                  <th>Magazin</th>
                  <th>Vânzări</th>
                  <th>Bucăți</th>
                  <th>Listă</th>
                  <th>Reduceri</th>
                  <th>Încasat</th>
                  <th>Comision / adaos</th>
                  <th>Accesorii</th>
                  <th>Net</th>
                  <th>Rambursat</th>
                  <th>Net al zilei</th>
                </tr>
              </thead>
              <tbody>
                {report.vendors.map((v) => (
                  <tr key={v.vendorId}>
                    <td>{v.storeName || v.vendorId}</td>
                    <td>{v.salesCount}</td>
                    <td>{v.units}</td>
                    <td>{formatLei(v.listCents)}</td>
                    <td>{v.discountCents ? `−${formatLei(v.discountCents)}` : "—"}</td>
                    <td>{formatLei(v.grossCents)}</td>
                    <td>{formatLei(v.commissionCents)}</td>
                    <td>{(v.accessoriesCents || 0) > 0 ? formatLei(v.accessoriesCents) : "—"}</td>
                    <td>
                      {formatLei(v.vendorNetCents)}
                      {v.artfestFundedDiscountCents ? (
                        <div className={shared.subtle}>compensație Artfest {formatLei(v.artfestFundedDiscountCents)}</div>
                      ) : null}
                    </td>
                    <td>
                      {v.returns.refundCents ? formatLei(v.returns.refundCents) : "—"}
                      {v.returns.artfestBorne.refundCents ? (
                        <div className={shared.subtle}>din care suportat de Artfest {formatLei(v.returns.artfestBorne.refundCents)}</div>
                      ) : null}
                    </td>
                    <td>{formatLei(v.dayVendorNetCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {report.products.length > 0 && (
            <>
              <h4>Top produse</h4>
              <table className={shared.table}>
                <thead>
                  <tr>
                    <th>Produs</th>
                    <th>Magazin</th>
                    <th>Cant.</th>
                    <th>Valoare</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((p) => (
                    <tr key={p.inventoryItemId}>
                      <td>
                        {p.title}
                        {p.variantLabel ? ` (${p.variantLabel})` : ""}
                        <div className={shared.subtle}>{p.barcodeDisplay}</div>
                      </td>
                      <td>{p.storeName || "—"}</td>
                      <td>{p.quantity}</td>
                      <td>{formatLei(p.grossCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {report.returnList.length > 0 && (
            <>
              <h4>Retururile zilei</h4>
              <table className={shared.table}>
                <thead>
                  <tr>
                    <th>Retur</th>
                    <th>Ora</th>
                    <th>Bucăți</th>
                    <th>Rambursat</th>
                    <th>Comision inversat</th>
                    <th>Net vendor inversat</th>
                    <th>Motiv</th>
                  </tr>
                </thead>
                <tbody>
                  {report.returnList.map((x) => (
                    <tr key={x.id}>
                      <td>
                        {RETURN_TYPE_LABEL[x.type]} {x.reference}
                        <div className={shared.subtle}>{x.dispositions.map((d) => DISPOSITION_LABEL[d]).join(", ")}</div>
                      </td>
                      <td>{x.localTime}</td>
                      <td>{x.units}</td>
                      <td>
                        {formatLei(x.refundCents)} ({PAYMENT_LABEL[x.refundMethod]})
                      </td>
                      <td>{formatLei(x.commissionReversedCents)}</td>
                      <td>{formatLei(x.vendorNetReversedCents)}</td>
                      <td>{x.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ===================== Panou ===================== */

/* ===================== Situația (pe vânzător + total târg) ===================== */

// un bloc „azi” / „total”: încasări, cuvenit vânzătorilor, Artfest, anulări și retururi separat
// partea Artfest, separat (comision / recuperare accesorii / produse proprii); total fără dublare
function ArtfestShareRows({ share }) {
  if (!share) return null;
  return (
    <>
      <div>
        <dt>· adaos din produsele participanților (comision la vânzările vechi)</dt>
        <dd>{formatLei(share.commissionCents)}</dd>
      </div>
      <div>
        <dt>· recuperare ambalare și accesorii (nu este profit net)</dt>
        <dd>{formatLei(share.accessoriesCents)}</dd>
      </div>
      <div>
        <dt>· vânzări produse proprii Artfest</dt>
        <dd>{formatLei(share.ownProductsCents)}</dd>
      </div>
      {share.artfestBorneRefundCents > 0 && (
        <div>
          <dt>· rambursări suportate de Artfest</dt>
          <dd>−{formatLei(share.artfestBorneRefundCents)}</dd>
        </div>
      )}
      {share.artfestFundedCents !== 0 && (
        <div>
          <dt>· compensații Artfest pentru reduceri</dt>
          <dd>−{formatLei(share.artfestFundedCents)}</dd>
        </div>
      )}
    </>
  );
}

function SummaryCard({ title, data, share }) {
  if (!data) return null;
  return (
    <section className={styles.summaryCard}>
      <h4>{title}</h4>
      <dl className={styles.totals}>
        <div>
          <dt>Vânzări ({data.sales.units} buc.)</dt>
          <dd>{formatLei(data.sales.grossCents)}</dd>
        </div>
        <div>
          <dt>Anulări ({data.voids.units} buc.)</dt>
          <dd>−{formatLei(data.voids.refundCents)}</dd>
        </div>
        <div>
          <dt>Retururi ({data.returns.units} buc.)</dt>
          <dd>−{formatLei(data.returns.refundCents)}</dd>
        </div>
        <div className={styles.grand}>
          <dt>Încasări din produse</dt>
          <dd>{formatLei(data.net.collectedCents)}</dd>
        </div>
        <div>
          <dt>Cuvenit vânzătorilor</dt>
          <dd>{formatLei(data.net.vendorDueCents)}</dd>
        </div>
        <div>
          <dt>Partea Artfest (total)</dt>
          <dd>{formatLei(data.net.artfestCents)}</dd>
        </div>
        <ArtfestShareRows share={share} />
      </dl>
    </section>
  );
}

function FairSummary() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await api(`${POS_API}/reports/summary`));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca situația."));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.reportWrap}>
      <div className={styles.reportBar}>
        <span className={shared.subtle}>
          Azi = {data?.date || "…"} (ora României). Taxa de participare nu este inclusă: se gestionează separat.
        </span>
        <button type="button" className={styles.ghostBtn} onClick={load} disabled={busy}>
          {busy ? "Se încarcă…" : "Actualizează"}
        </button>
      </div>
      {error && <div className={shared.error}>{error}</div>}
      {data && (
        <>
          <div className={styles.summaryCards}>
            <SummaryCard title="Azi" data={data.totals.today} share={data.artfest?.today} />
            <SummaryCard title="Total târg" data={data.totals.total} share={data.artfest?.total} />
            <section className={styles.summaryCard}>
              <h4>Deconturi</h4>
              <dl className={styles.totals}>
                <div>
                  <dt>Cuvenit (cu ajustări)</dt>
                  <dd>{formatLei(data.totals.settlement.dueCents)}</dd>
                </div>
                <div>
                  <dt>Decontat (plătit)</dt>
                  <dd>{formatLei(data.totals.settlement.paidCents)}</dd>
                </div>
                <div className={styles.grand}>
                  <dt>Rest de plătit</dt>
                  <dd>{formatLei(data.totals.settlement.remainingCents)}</dd>
                </div>
              </dl>
            </section>
          </div>
          {data.rows.length === 0 ? (
            <p className={shared.subtle}>Nicio vânzare încă.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={shared.table}>
                <thead>
                  <tr>
                    <th>Vânzător</th>
                    <th>Azi</th>
                    <th>Încasări (total)</th>
                    <th>Cuvenit vânzătorului</th>
                    <th>Partea Artfest</th>
                    <th>Anulări / retururi</th>
                    <th>Decontat</th>
                    <th>Rest</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.vendorId}>
                      <td>{r.vendorName || r.vendorId}</td>
                      <td>
                        {formatLei(r.today.net.collectedCents)}
                        <div className={shared.subtle}>{r.todayUnits} buc.</div>
                      </td>
                      <td>{formatLei(r.total.net.collectedCents)}</td>
                      <td>{formatLei(r.total.net.vendorDueCents)}</td>
                      <td>
                        {formatLei(r.total.net.artfestCents)}
                        {(r.total.net.accessoriesCents || 0) > 0 && (
                          <div className={shared.subtle}>din care ambalare și accesorii {formatLei(r.total.net.accessoriesCents)}</div>
                        )}
                      </td>
                      <td>
                        {r.total.voids.units + r.total.returns.units > 0
                          ? `${r.total.voids.units} / ${r.total.returns.units} buc. · −${formatLei(r.total.voids.refundCents + r.total.returns.refundCents)}`
                          : "—"}
                      </td>
                      <td>{formatLei(r.settlement.paidCents)}</td>
                      <td>{formatLei(r.settlement.remainingCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminFairPosPanel() {
  const [tab, setTab] = useState("sale");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api(`${POS_API}/status`));
    } catch (err) {
      setError(errorMessage(err, "Nu am putut încărca starea POS."));
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function toggleSales() {
    const next = !status?.salesOpen;
    if (!window.confirm(next ? "Deschizi vânzările la târg?" : "Închizi vânzările la târg?")) return;
    try {
      setStatus(await api(`${POS_API}/status`, { method: "POST", body: { salesOpen: next } }));
    } catch (err) {
      setError(errorMessage(err, "Nu am putut schimba starea vânzărilor."));
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.topBar}>
        <div className={styles.tabs} role="tablist" aria-label="POS">
          {[
            ["sale", "Vânzare"],
            ["history", "Vânzări"],
            ["report", "Raport zilnic"],
            ["summary", "Situație"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`${styles.tabBtn} ${tab === id ? styles.tabBtnActive : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {status && (
          <div className={styles.status}>
            <span className={status.salesOpen ? styles.open : styles.closed}>
              {status.salesOpen ? "Vânzări deschise" : "Vânzări închise"}
            </span>
            <button type="button" className={styles.ghostBtn} onClick={toggleSales}>
              {status.salesOpen ? "Închide vânzările" : "Deschide vânzările"}
            </button>
          </div>
        )}
      </div>
      {error && <div className={shared.error}>{error}</div>}
      {tab === "sale" && (
        <SalePanel
          salesOpen={Boolean(status?.salesOpen)}
          inventory={status ? { open: status.inventoryOpen !== false, deadlineAt: status.inventoryDeadlineAt || null } : null}
        />
      )}
      {tab === "history" && <SalesHistory />}
      {tab === "report" && <DailyReport />}
      {tab === "summary" && <FairSummary />}
    </div>
  );
}
