// src/pages/Vendor/Fair/FairDeliveryNotes.jsx
//
// Avize de însoțire a mărfii (cod 14-3-6A) din inventarul târgului:
//   - DeliveryNoteModal: produse și prețuri -> previzualizare PDF (neemis) -> confirmare -> descărcare
//     (Idempotency-Key per fereastră: dublu-click / retrimitere => același aviz);
//   - DeliveryNotesHistory: istoricul, PDF, anulare trasabilă, aviz înlocuitor.
// Nimic de aici nu modifică inventarul sau stocurile.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, Download, ExternalLink, Eye, FileText, Pencil, RefreshCw, RotateCcw, X } from "lucide-react";
import { api } from "../../../lib/api";
import {
  BILLING_SETTINGS_URL,
  DELIVERY_NOTES_API,
  buildIssueBody,
  canEmbedPdf,
  fetchDeliveryNotePreviewPdf,
  downloadDeliveryNotePdf,
  formatDate,
  formatLei,
  initialRows,
  newIdempotencyKey,
  rowValueCents,
} from "./fairDeliveryNotes.js";
import base from "./FairInventory.module.css";
import styles from "./FairDeliveryNotes.module.css";

function errorMessage(err, fallback) {
  return err?.data?.message || err?.message || fallback;
}

// emitere / previzualizare refuzate de backend din cauza datelor de facturare (issuer_*)
function isBillingError(err) {
  return String(err?.data?.error || "").startsWith("issuer_");
}

// câmpurile din „Opțiuni suplimentare” (la eroare, secțiunea se deschide singură)
const MORE_FIELDS = ["series", "startNumber", "reason"];
const VERIFY_MSG = "Verifică câmpurile marcate.";

// regimul TVA al emitentului, din datele lui de facturare (doar informativ; nu se calculează TVA)
function vatLine(vat) {
  if (vat?.status === "payer") return "Ești plătitor de TVA: trece prețurile fără TVA.";
  if (vat?.status === "non_payer") return "Ești neplătitor de TVA: nu se adaugă TVA.";
  return "Regimul TVA nu este completat în datele de facturare. Trece prețurile fără TVA.";
}

function partyName(party) {
  if (!party?.name) return "—";
  const lt = party.legalType && !String(party.name).toUpperCase().includes(String(party.legalType).toUpperCase());
  return lt ? `${party.name} ${party.legalType}` : party.name;
}

/* ===================== Emitere ===================== */

export function DeliveryNoteModal({ replaceNote = null, onClose, onIssued }) {
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({
    series: "",
    isNewSeries: true,
    startNumber: "",
    reason: "",
    withoutValues: false,
    valuesConfirmed: false,
    withoutInvoice: false,
    notes: "",
    delegateName: "",
    delegateIdSeries: "",
    delegateIdNumber: "",
    delegateIdIssuedBy: "",
    vehicle: "",
    shippedAt: "",
    replacesNoteId: replaceNote?.id || null,
    destination: "",
  });
  // erorile de câmp: după prima încercare se recalculează la fiecare modificare (dispar când
  // câmpul e corectat); erorile primite de la server se șterg la prima modificare
  const [serverErrors, setServerErrors] = useState({});
  const [touched, setTouched] = useState(false);
  const [step, setStep] = useState("edit"); // edit | pdf | done
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState(null);
  const keyRef = useRef(newIdempotencyKey());
  const [pdfUrl, setPdfUrl] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editDestination, setEditDestination] = useState(false);
  const embedPdf = useMemo(() => canEmbedPdf(), []);

  // eliberează PDF-ul de previzualizare la schimbare / închidere
  useEffect(() => () => pdfUrl && URL.revokeObjectURL(pdfUrl), [pdfUrl]);

  useEffect(() => {
    let alive = true;
    api(`${DELIVERY_NOTES_API}/preview`)
      .then((res) => {
        if (!alive) return;
        setPreview(res);
        setRows(initialRows(res.items, replaceNote));
        const last = res.series?.[0];
        setForm((f) => ({
          ...f,
          reason: replaceNote?.reason || res.defaults?.reason || "",
          // adresa de recepție Artfest (precompletată); se poate schimba (ex. predare la târg)
          destination: replaceNote?.destination || res.destination || "",
          series: replaceNote?.series || last?.series || "",
          isNewSeries: !(replaceNote?.series || last?.series),
          withoutValues: replaceNote ? Boolean(replaceNote.withoutValues) : false,
          withoutInvoice: replaceNote ? Boolean(replaceNote.withoutInvoice) : false,
        }));
      })
      .catch((err) => alive && setLoadError(errorMessage(err, "Nu am putut pregăti avizul.")));
    return () => {
      alive = false;
    };
  }, [replaceNote]);

  /*
   * Date de facturare incomplete: pagina de facturare se deschide într-o filă nouă,
   * iar aici reîncărcăm doar verificarea (emitent + blocaje) când participantul revine.
   * Formularul și produsele selectate rămân neatinse.
   */
  const [checkingBilling, setCheckingBilling] = useState(false);
  const [billingNotice, setBillingNotice] = useState(""); // "" | "fixed" | "still"
  const checkingRef = useRef(false);
  const billingIncomplete = Boolean(preview?.billing);

  const refreshBilling = useCallback(async (manual = false) => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setCheckingBilling(true);
    try {
      const res = await api(`${DELIVERY_NOTES_API}/preview`);
      setPreview(res);
      setBillingNotice(res.billing ? (manual ? "still" : "") : "fixed");
      if (!res.billing) setError("");
    } catch (err) {
      if (manual) setError(errorMessage(err, "Nu am putut verifica datele de facturare."));
    } finally {
      checkingRef.current = false;
      setCheckingBilling(false);
    }
  }, []);

  useEffect(() => {
    if (!billingIncomplete) return undefined;
    const onReturn = () => {
      if (document.visibilityState === "visible") refreshBilling();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [billingIncomplete, refreshBilling]);

  const clearServerErrors = () => setServerErrors((e) => (Object.keys(e).length ? {} : e));
  const set = (key, value) => {
    clearServerErrors();
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setRow = (id, patch) => {
    clearServerErrors();
    setRows((list) => list.map((r) => (r.inventoryItemId === id ? { ...r, ...patch } : r)));
  };

  const computed = useMemo(() => buildIssueBody(form, rows), [form, rows]);
  const errors = touched ? { ...serverErrors, ...computed.errors } : serverErrors;
  const seriesOptions = preview?.series || [];
  const currentSeries = seriesOptions.find((s) => s.series === String(form.series).trim().toUpperCase());
  // prima emitere (nicio serie folosită încă): seria se cere direct în formular
  const firstSeries = !seriesOptions.length && !replaceNote?.series;

  // validare locală; la eroare în „Opțiuni suplimentare” secțiunea se deschide
  function validate() {
    setError("");
    setTouched(true);
    setServerErrors({});
    const keys = Object.keys(computed.errors);
    if (!keys.length) return true;
    if (!firstSeries && keys.some((k) => MORE_FIELDS.includes(k))) setMoreOpen(true);
    if (keys.includes("destination")) setEditDestination(true);
    setError(VERIFY_MSG);
    return false;
  }

  // PDF „PREVIZUALIZARE – NEEMIS” (serverul nu salvează nimic, nu consumă număr)
  async function showPdfPreview(e) {
    e?.preventDefault();
    if (previewing || saving) return;
    if (!validate()) {
      setStep("edit");
      return;
    }
    setPreviewing(true);
    try {
      const blob = await fetchDeliveryNotePreviewPdf(computed.body);
      setPdfUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      setStep("pdf");
    } catch (err) {
      setError(errorMessage(err, "Nu am putut genera previzualizarea."));
      if (isBillingError(err)) {
        setStep("edit");
        refreshBilling();
      } else if (err?.data?.fields) {
        setServerErrors(err.data.fields);
        setStep("edit");
      }
    } finally {
      setPreviewing(false);
    }
  }

  function backToForm() {
    setStep("edit");
    setPdfUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  }

  async function downloadIssued() {
    if (downloading || !issued) return;
    setDownloading(true);
    setError("");
    try {
      await downloadDeliveryNotePdf(issued);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut descărca avizul."));
    } finally {
      setDownloading(false);
    }
  }

  async function issue() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await api(DELIVERY_NOTES_API, {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
        body: computed.body,
      });
      setIssued(res.note);
      setStep("done");
      onIssued?.(res.note);
    } catch (err) {
      setError(errorMessage(err, "Nu am putut emite avizul."));
      if (isBillingError(err)) {
        setStep("edit");
        refreshBilling();
      } else if (err?.data?.fields) setStep("edit");
    } finally {
      setSaving(false);
    }
  }

  const close = () => !saving && onClose();
  const blockers = preview?.blockers || [];
  // blocajele din datele de facturare au panoul lor; celelalte ascund formularul
  const billingBlockers = blockers.filter((b) => b.billing);
  const otherBlockers = blockers.filter((b) => !b.billing);
  const billingDetails = billingBlockers.filter((b) => !["issuer_incomplete", "issuer_billing_missing"].includes(b.code));
  const withValues = !form.withoutValues;

  const seriesFields = (
    <div className={base.fieldRow}>
      <label className={base.field}>
        <span className={base.label}>Seria avizului</span>
        <input
          className={base.input}
          name="series"
          value={form.series}
          maxLength={16}
          // lista de sugestii doar dacă există serii folosite (altfel rămâne un popup gol pe mobil)
          list={seriesOptions.length ? "delivery-note-series" : undefined}
          autoComplete="off"
          placeholder="ex. AV"
          onChange={(e) => {
            const v = e.target.value.toUpperCase();
            setForm((f) => ({ ...f, series: v, isNewSeries: !seriesOptions.some((s) => s.series === v.trim()) }));
          }}
          aria-invalid={errors.series ? "true" : undefined}
        />
        {seriesOptions.length > 0 && (
          <datalist id="delivery-note-series">
            {seriesOptions.map((s) => (
              <option key={s.series} value={s.series} />
            ))}
          </datalist>
        )}
        {errors.series && <span className={base.fieldError}>{errors.series}</span>}
      </label>
      {form.isNewSeries ? (
        <label className={base.field}>
          <span className={base.label}>Primul număr (opțional)</span>
          <input
            className={base.input}
            inputMode="numeric"
            value={form.startNumber}
            placeholder="1"
            onChange={(e) => set("startNumber", e.target.value.replace(/\D/g, ""))}
            aria-invalid={errors.startNumber ? "true" : undefined}
          />
          {errors.startNumber && <span className={base.fieldError}>{errors.startNumber}</span>}
        </label>
      ) : (
        <div className={base.field}>
          <span className={base.label}>Următorul număr</span>
          <span className={styles.static}>{currentSeries?.nextNumber ?? "—"}</span>
        </div>
      )}
    </div>
  );

  const seriesSummary = form.series
    ? `${String(form.series).trim().toUpperCase()} nr. ${currentSeries?.nextNumber ?? (form.startNumber || 1)}`
    : "—";

  return (
    <div className={`${base.backdrop} ${styles.backdropTop}`} onClick={close} role="presentation">
      <form
        className={`${base.modal} ${styles.modalWide}`}
        role="dialog"
        aria-modal="true"
        aria-label="Generează aviz de însoțire a mărfii"
        onClick={(e) => e.stopPropagation()}
        onSubmit={showPdfPreview}
        noValidate
      >
        <div className={base.modalHead}>
          <h3>
            <FileText size={18} aria-hidden="true" /> {replaceNote ? "Aviz înlocuitor" : "Aviz de însoțire a mărfii"}
          </h3>
          <button type="button" className={base.iconBtn} onClick={close} aria-label="Închide" disabled={saving}>
            <X size={18} />
          </button>
        </div>

        <div className={base.modalBody}>
          {!preview && !loadError && <p className={base.muted}>Se pregătește avizul…</p>}
          {loadError && (
            <div className={base.errorBox} role="alert">
              {loadError}
            </div>
          )}

          {preview && step === "done" && issued && (
            <div className={styles.done}>
              <div className={base.successBox} role="status">
                Avizul <strong>{issued.series} nr. {issued.number}</strong> din {formatDate(issued.issuedAt)} a fost emis și
                salvat în istoric.
              </div>
              <button type="button" className={`${base.btn} ${styles.downloadMain}`} onClick={downloadIssued} disabled={downloading}>
                <Download size={18} aria-hidden="true" /> {downloading ? "Se descarcă…" : "Descarcă avizul PDF"}
              </button>
              <p className={base.hint}>
                Tipărește avizul, semnează-l și pune-l alături de colet. Îl găsești oricând în istoric, cu aceeași serie și
                același număr.
              </p>
            </div>
          )}

          {preview && step !== "done" && preview.billing && (
            <div className={`${styles.blockers} ${styles.billingPanel}`} role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>Pentru a genera avizul de însoțire a mărfii, completează datele de facturare ale firmei tale.</strong>
                {billingDetails.map((b) => (
                  <p key={b.code} className={styles.billingText}>
                    {b.message}
                  </p>
                ))}
                {preview.billing.missing?.length > 0 && (
                  <>
                    <p className={styles.billingText}>
                      {preview.billing.missing.length === 1 ? "Lipsește:" : "Lipsesc:"}
                    </p>
                    <ul>
                      {preview.billing.missing.map((m) => (
                        <li key={m.field}>{m.label}</li>
                      ))}
                    </ul>
                  </>
                )}
                {preview.issuerKind === "independent_creator" && (
                  <p className={base.hint}>
                    Dacă ai o formă juridică (SRL, PFA, II sau IF), actualizează datele de facturare. Pentru predarea
                    produselor de către creatorii independenți, Artfest pregătește un proces-verbal de predare-primire,
                    separat de avizul fiscal.
                  </p>
                )}
                <div className={styles.billingActions}>
                  <a className={base.btn} href={BILLING_SETTINGS_URL} target="_blank" rel="noopener noreferrer">
                    {preview.billing.action === "complete" ? "Completează datele de facturare" : "Actualizează datele de facturare"}
                    <ExternalLink size={16} aria-hidden="true" />
                  </a>
                  <button type="button" className={base.btnGhost} onClick={() => refreshBilling(true)} disabled={checkingBilling}>
                    <RefreshCw size={16} aria-hidden="true" /> {checkingBilling ? "Se verifică…" : "Am salvat datele, verifică din nou"}
                  </button>
                </div>
                <p className={base.hint}>
                  Pagina „Date facturare” se deschide într-o filă nouă. După ce salvezi, revino aici: datele se verifică
                  automat, iar ce ai completat în aviz rămâne.
                </p>
                {billingNotice === "still" && !checkingBilling && (
                  <p className={base.fieldError}>Datele de facturare sunt încă incomplete. Verifică câmpurile de mai sus.</p>
                )}
              </div>
            </div>
          )}

          {preview && step !== "done" && billingNotice === "fixed" && !preview.billing && (
            <div className={base.successBox} role="status">
              Datele de facturare sunt complete. Poți continua cu avizul.
            </div>
          )}

          {preview && step !== "done" && otherBlockers.length > 0 && (
            <div className={styles.blockers} role="alert">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>Avizul nu poate fi emis încă</strong>
                <ul>
                  {otherBlockers.map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {preview && step === "edit" && otherBlockers.length === 0 && (
            <>
              {replaceNote && (
                <p className={base.hint}>
                  Înlocuiește avizul anulat {replaceNote.series} nr. {replaceNote.number}. Avizul nou primește un număr nou.
                </p>
              )}

              {/* emitent -> destinatar -> adresă: precompletate */}
              <dl className={styles.route}>
                <div>
                  <dt>De la</dt>
                  <dd>
                    <strong>{partyName(preview.issuer)}</strong>
                    {preview.issuer?.cui && <span> · CUI {preview.issuer.cui}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Către</dt>
                  <dd>
                    <strong>{partyName(preview.recipient)}</strong>
                    {preview.recipient?.cui && <span> · CUI {preview.recipient.cui}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Livrare la</dt>
                  <dd>
                    {editDestination ? (
                      <div className={styles.destEdit}>
                        <textarea
                          className={base.input}
                          rows={2}
                          maxLength={500}
                          value={form.destination}
                          onChange={(e) => set("destination", e.target.value)}
                          aria-label="Adresa de livrare"
                          aria-invalid={errors.destination ? "true" : undefined}
                        />
                        {errors.destination && <span className={base.fieldError}>{errors.destination}</span>}
                        {preview.destination && form.destination.trim() !== preview.destination && (
                          <button type="button" className={base.btnSmall} onClick={() => set("destination", preview.destination)}>
                            Folosește adresa de recepție Artfest
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className={styles.destText}>
                        {form.destination || "—"}
                        <button type="button" className={styles.linkBtn} onClick={() => setEditDestination(true)}>
                          <Pencil size={13} aria-hidden="true" /> Modifică
                        </button>
                      </span>
                    )}
                  </dd>
                </div>
                {!firstSeries && (
                  <div>
                    <dt>Aviz</dt>
                    <dd>{seriesSummary}</dd>
                  </div>
                )}
              </dl>

              {firstSeries && (
                <div className={styles.firstSeries}>
                  {seriesFields}
                  <p className={base.hint}>Prima ta serie de avize. Numărul crește automat la fiecare aviz.</p>
                </div>
              )}

              {/* produsele: doar cantitate și preț de completat */}
              <div className={`${styles.table} ${withValues ? "" : styles.noValues}`} role="table" aria-label="Produse pe aviz">
                <div className={`${styles.tr} ${styles.th}`} role="row">
                  <span role="columnheader">Produs</span>
                  <span role="columnheader">Cantitate</span>
                  {withValues && <span role="columnheader">Preț artizan (lei)</span>}
                  {withValues && <span role="columnheader">Valoare</span>}
                </div>
                {rows.map((r) => {
                  const id = r.inventoryItemId;
                  const disabled = r.remainingQty <= 0;
                  const value = rowValueCents(r);
                  const qtyErr = errors[`rows.${id}.quantity`];
                  const priceErr = errors[`rows.${id}.price`];
                  const active = r.selected && !disabled;
                  return (
                    <div key={id} role="row" className={`${styles.tr} ${active ? "" : styles.rowOff}`}>
                      <label className={styles.cellProduct} role="cell">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          disabled={disabled}
                          onChange={(e) => setRow(id, { selected: e.target.checked })}
                          aria-label={`Include ${r.title}`}
                        />
                        <span>
                          <strong>{r.title}</strong>
                          {r.variantLabel && <small>{r.variantLabel}</small>}
                          <small>
                            {disabled
                              ? "Toată cantitatea este deja pe avize."
                              : `max ${r.remainingQty}${r.fairPriceCents ? ` · la târg ${formatLei(r.fairPriceCents)}` : ""}`}
                          </small>
                        </span>
                      </label>
                      <div className={styles.cell} role="cell">
                        <span className={styles.cellLabel}>Cantitate</span>
                        <input
                          className={base.input}
                          inputMode="numeric"
                          value={r.quantity}
                          disabled={!active}
                          onChange={(e) => setRow(id, { quantity: e.target.value.replace(/\D/g, "") })}
                          aria-label={`Cantitate ${r.title}`}
                          aria-invalid={qtyErr ? "true" : undefined}
                        />
                        {active && qtyErr && <span className={base.fieldError}>{qtyErr}</span>}
                      </div>
                      {withValues && (
                        <div className={styles.cell} role="cell">
                          <span className={styles.cellLabel}>Preț artizan (lei)</span>
                          <input
                            className={base.input}
                            inputMode="decimal"
                            value={r.price}
                            placeholder="0,00"
                            disabled={!active}
                            onChange={(e) => setRow(id, { price: e.target.value })}
                            aria-label={`Preț artizan ${r.title}`}
                            aria-invalid={priceErr ? "true" : undefined}
                          />
                          {active && priceErr && <span className={base.fieldError}>{priceErr}</span>}
                        </div>
                      )}
                      {withValues && (
                        <div className={`${styles.cell} ${styles.cellValue}`} role="cell">
                          <span className={styles.cellLabel}>Valoare</span>
                          <strong>{active && value ? formatLei(value) : "—"}</strong>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className={`${styles.tr} ${styles.totalRow}`} role="row">
                  <span role="cell">Total</span>
                  <span role="cell">{computed.totalQuantity} buc.</span>
                  {withValues && <span role="cell" className={styles.hideMobile} />}
                  {withValues && (
                    <strong role="cell" className={styles.cellValue}>
                      {formatLei(computed.totalValueCents)}
                    </strong>
                  )}
                </div>
              </div>
              {errors.rows && <span className={base.fieldError}>{errors.rows}</span>}

              {withValues && (
                <div className={styles.priceNote}>
                  <p>
                    <strong>Preț artizan</strong> = prețul la care facturezi produsul către Artfest, nu prețul de vânzare de
                    la târg. {vatLine(preview.issuerVat)}
                  </p>
                  {preview.issuerVat?.anafMismatch && (
                    <p>Statutul TVA din datele tale de facturare diferă de verificarea ANAF. Verifică datele de facturare.</p>
                  )}
                  <label className={styles.check}>
                    <input type="checkbox" checked={form.valuesConfirmed} onChange={(e) => set("valuesConfirmed", e.target.checked)} />
                    <span>Confirm prețurile de mai sus.</span>
                  </label>
                  {errors.valuesConfirmed && <span className={base.fieldError}>{errors.valuesConfirmed}</span>}
                </div>
              )}

              {/* rar necesare: seria, motivul, valori, mențiuni, expediție */}
              <details className={styles.more} open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
                <summary>Opțiuni suplimentare</summary>
                <div className={styles.moreBody}>
                  {!firstSeries && seriesFields}

                  <label className={base.field}>
                    <span className={base.label}>Motivul expedierii</span>
                    <textarea
                      className={base.input}
                      rows={3}
                      maxLength={500}
                      value={form.reason}
                      onChange={(e) => set("reason", e.target.value)}
                      aria-invalid={errors.reason ? "true" : undefined}
                    />
                    {errors.reason && <span className={base.fieldError}>{errors.reason}</span>}
                  </label>

                  <label className={styles.check}>
                    <input type="checkbox" checked={form.withoutValues} onChange={(e) => set("withoutValues", e.target.checked)} />
                    <span>
                      Aviz fără prețuri și valori
                      <small>Doar dacă valoarea bunurilor este stabilită printr-un document separat.</small>
                    </span>
                  </label>

                  <label className={styles.check}>
                    <input type="checkbox" checked={form.withoutInvoice} onChange={(e) => set("withoutInvoice", e.target.checked)} />
                    <span>
                      Mențiunea „Fără factură”
                      <small>Nu se aplică automat; bifeaz-o doar dacă se potrivește operațiunii tale.</small>
                    </span>
                  </label>

                  <fieldset className={styles.fieldset}>
                    <legend className={base.label}>Date privind expediția</legend>
                    <p className={base.hint}>Ce nu completezi rămâne liber pe aviz, ca să poată fi scris de mână.</p>
                    <div className={styles.grid}>
                      <label className={base.field}>
                        <span className={base.label}>Numele delegatului</span>
                        <input className={base.input} value={form.delegateName} maxLength={160} onChange={(e) => set("delegateName", e.target.value)} />
                      </label>
                      <label className={base.field}>
                        <span className={base.label}>C.I. seria</span>
                        <input className={base.input} value={form.delegateIdSeries} maxLength={10} onChange={(e) => set("delegateIdSeries", e.target.value)} />
                      </label>
                      <label className={base.field}>
                        <span className={base.label}>C.I. nr.</span>
                        <input className={base.input} value={form.delegateIdNumber} maxLength={20} onChange={(e) => set("delegateIdNumber", e.target.value)} />
                      </label>
                      <label className={base.field}>
                        <span className={base.label}>Eliberat(ă) de</span>
                        <input className={base.input} value={form.delegateIdIssuedBy} maxLength={120} onChange={(e) => set("delegateIdIssuedBy", e.target.value)} />
                      </label>
                      <label className={base.field}>
                        <span className={base.label}>Mijloc de transport / nr.</span>
                        <input className={base.input} value={form.vehicle} maxLength={80} onChange={(e) => set("vehicle", e.target.value)} />
                      </label>
                      <label className={base.field}>
                        <span className={base.label}>Data și ora expedierii</span>
                        <input className={base.input} type="datetime-local" value={form.shippedAt} onChange={(e) => set("shippedAt", e.target.value)} />
                      </label>
                    </div>
                  </fieldset>

                  <label className={base.field}>
                    <span className={base.label}>Mențiuni</span>
                    <textarea className={base.input} rows={2} maxLength={2000} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
                  </label>
                </div>
              </details>
            </>
          )}

          {preview && step === "pdf" && pdfUrl && (
            <div className={styles.pdfStep}>
              <div className={styles.previewNotice} role="status">
                <strong>PREVIZUALIZARE – NEEMIS.</strong> Avizul nu este încă emis. După confirmare primește seria și numărul{" "}
                <strong>{seriesSummary}</strong> și nu mai poate fi modificat (doar anulat și înlocuit).
              </div>
              <dl className={styles.summary}>
                <dt>Produse</dt>
                <dd>
                  {computed.body.lines.length} produse, {computed.totalQuantity} bucăți
                </dd>
                <dt>Valoare</dt>
                <dd>{form.withoutValues ? "fără valori" : formatLei(computed.totalValueCents)}</dd>
                <dt>Livrare la</dt>
                <dd>{computed.body.destination}</dd>
              </dl>
              {embedPdf ? (
                <iframe className={styles.pdfFrame} src={pdfUrl} title="Previzualizare aviz (neemis)" />
              ) : (
                <p className={base.hint}>Pe acest dispozitiv, previzualizarea se deschide separat.</p>
              )}
              <a className={`${base.btnSmall} ${styles.openPdf}`} href={pdfUrl} target="_blank" rel="noopener noreferrer">
                <Eye size={14} aria-hidden="true" /> Deschide previzualizarea PDF
              </a>
            </div>
          )}

          {error && !(error === VERIFY_MSG && !Object.keys(errors).length) && (
            <div className={base.errorBox} role="alert">
              {error}
            </div>
          )}
        </div>

        <div className={base.modalFoot}>
          {step === "done" ? (
            <button type="button" className={base.btn} onClick={onClose}>
              Închide
            </button>
          ) : step === "pdf" ? (
            <>
              <button type="button" className={base.btnGhost} onClick={backToForm} disabled={saving}>
                Corectează datele
              </button>
              <button type="button" className={base.btn} onClick={issue} disabled={saving}>
                {saving ? "Se emite…" : "Confirmă emiterea"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={base.btnGhost} onClick={close} disabled={saving}>
                Renunță
              </button>
              <button type="submit" className={`${base.btn} ${styles.previewBtn}`} disabled={!preview || blockers.length > 0 || previewing}>
                <Eye size={16} aria-hidden="true" /> {previewing ? "Se pregătește…" : "Previzualizează avizul"}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

/* ===================== Istoric ===================== */

function CancelForm({ note, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (saving) return;
    if (reason.trim().length < 5) {
      setError("Scrie motivul anulării (cel puțin 5 caractere).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(`${DELIVERY_NOTES_API}/${encodeURIComponent(note.id)}/cancel`, { method: "POST", body: { reason } });
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Nu am putut anula avizul."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.cancelForm}>
      <label className={base.field}>
        <span className={base.label}>Motivul anulării</span>
        <textarea className={base.input} rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <p className={base.hint}>Avizul anulat rămâne în istoric, cu numărul lui. Numărul nu se refolosește.</p>
      {error && (
        <div className={base.errorBox} role="alert">
          {error}
        </div>
      )}
      <div className={styles.inlineActions}>
        <button type="button" className={base.btnSmall} onClick={onCancel} disabled={saving}>
          Renunță
        </button>
        <button type="button" className={`${base.btnSmall} ${base.btnDanger}`} onClick={submit} disabled={saving}>
          {saving ? "Se anulează…" : "Anulează avizul"}
        </button>
      </div>
    </div>
  );
}

export function DeliveryNotesHistory({ refreshKey, onReplace }) {
  const [notes, setNotes] = useState(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    api(DELIVERY_NOTES_API)
      .then((res) => alive && (setNotes(res.notes || []), setError("")))
      .catch((err) => alive && setError(errorMessage(err, "Nu am putut încărca avizele.")));
    return () => {
      alive = false;
    };
  }, [refreshKey, reload]);

  if (!notes?.length && !error) return null;

  return (
    <div className={styles.history} aria-labelledby="fair-delivery-notes-title">
      <h3 id="fair-delivery-notes-title" className={styles.historyTitle}>
        <FileText size={18} aria-hidden="true" /> Avize emise
      </h3>
      {error && (
        <div className={base.errorBox} role="alert">
          {error}
        </div>
      )}
      <ul className={styles.historyList}>
        {(notes || []).map((n) => (
          <li key={n.id} className={styles.historyItem}>
            <div className={styles.historyHead}>
              <strong>
                {n.series} nr. {n.number}
              </strong>
              <span className={n.status === "CANCELLED" ? styles.badgeCancelled : styles.badgeIssued}>
                {n.status === "CANCELLED" ? "Anulat" : "Emis"}
              </span>
            </div>
            <span className={base.muted}>
              {formatDate(n.issuedAt)} · {n.lines.length} produse, {n.totalQuantity} bucăți ·{" "}
              {n.withoutValues ? "fără valori" : formatLei(n.totalValueCents)}
            </span>
            {n.replaces && <small className={base.muted}>Înlocuiește avizul {n.replaces.series} nr. {n.replaces.number}</small>}
            {n.status === "CANCELLED" && (
              <small className={base.muted}>
                Anulat la {formatDate(n.cancelledAt)}: {n.cancelReason}
                {n.replacedBy ? ` · înlocuit de ${n.replacedBy.series} nr. ${n.replacedBy.number}` : ""}
              </small>
            )}
            <details className={styles.details}>
              <summary>Produse</summary>
              <ul>
                {n.lines.map((l) => (
                  <li key={l.position}>
                    {l.title}
                    {l.variantLabel ? ` (${l.variantLabel})` : ""} · {l.internalCode} · {l.quantity} {l.unit}
                  </li>
                ))}
              </ul>
            </details>
            {cancelling === n.id ? (
              <CancelForm
                note={n}
                onCancel={() => setCancelling(null)}
                onDone={() => {
                  setCancelling(null);
                  setReload((x) => x + 1);
                }}
              />
            ) : (
              <div className={styles.inlineActions}>
                <button type="button" className={base.btnSmall} onClick={() => downloadDeliveryNotePdf(n).catch((e) => setError(e.message))}>
                  <Download size={14} aria-hidden="true" /> Descarcă avizul PDF
                </button>
                {n.status === "ISSUED" && (
                  <button type="button" className={`${base.btnSmall} ${base.btnDanger}`} onClick={() => setCancelling(n.id)}>
                    <Ban size={14} aria-hidden="true" /> Anulează
                  </button>
                )}
                {n.status === "CANCELLED" && !n.replacedBy && onReplace && (
                  <button type="button" className={base.btnSmall} onClick={() => onReplace(n)}>
                    <RotateCcw size={14} aria-hidden="true" /> Emite aviz înlocuitor
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
