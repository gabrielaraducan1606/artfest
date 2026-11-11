// src/pages/Vendor/Orders/components/AwbPanel.jsx
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  Truck,
  FileDown,
  Loader2,
  AlertTriangle,
  RefreshCcw,
  Ban,
  ExternalLink,
  PackageCheck,
  MapPin,
  SearchCheck,
  Printer,
  X,
} from "lucide-react";
import { api, buildApiUrl } from "../../../../lib/api";
import {
  apiErrorMessage,
  formatDateTime,
  PICKUP_ADDRESS_FIELDS,
  emptyPickupAddressForm,
  validatePickupAddressForm,
  buildPickupAddressPayload,
} from "../../Settings/couriers/courierSettingsLogic.js";
import {
  AWB_GENERATION_ENABLED,
  COURIER_SETUP_PENDING_MESSAGE,
  COURIER_MANUAL_SHIPPING_MESSAGE,
} from "../../../../config/features.js";
import {
  decideAwbPanelState,
  lastAttemptNotice,
  awbStatusBadge,
  AWB_INPUT_FIELDS,
  isCourierSetupPending,
  isPlatformSetupBlocker,
  courierSetupMessage,
  isAwbLiveDisabled,
  AWB_LIVE_DISABLED_MESSAGE,
  isPickupBlocker,
  PICKUP_DETAILS_MISSING_MESSAGE,
  packageTypeLabel,
  canCancelArtfestAwb,
  awbCancelView,
  cancelErrorIsState,
  canDownloadArtfestLabel,
  isArtfestManagedAwb,
  labelFileName,
  initialAwbForm,
  buildAwbRequestBody,
  validateAwbForm,
  remainingBlockers,
  canSubmitAwb,
  newIdempotencyKey,
  shouldKeepIdempotencyKey,
  formatMoneyRon,
  canShipManually,
  manualShipVisibility,
  MANUAL_COURIER_SUGGESTIONS,
  initialManualShipForm,
  validateManualShipForm,
  buildManualShipBody,
  formatShippedDate,
  awbPickupStage,
  awbProgressSteps,
  AWB_LABEL_FORMATS,
  labelQueryFormat,
  labelErrorMessage,
} from "../utils/awbPanelLogic.js";
import TrackingTimeline from "../../../../components/Courier/TrackingTimeline.jsx";
import styles from "./AwbPanel.module.css";

/*
 * Secțiunea „Curier / Livrare” din detaliul comenzii (per Shipment).
 * Curierat CENTRALIZAT: AWB-ul se generează cu contul Sameday al Artfest,
 * iar curierul RIDICĂ coletul de la adresa de ridicare a vendorului
 * (thirdPartyPickup) - vendorul nu conectează curier. Starea
 * (utils/awbPanelLogic.js -> decideAwbPanelState) decide UN singur set de acțiuni:
 *  - pregătit -> ridicare (adresa vendorului, completabilă aici), destinatar,
 *    plată (ramburs calculat de server), colet (greutate) + „Generează AWB”,
 *    care deschide confirmarea cu previzualizarea finală de la server;
 *    configurare Artfest lipsă -> mesajul concret, buton dezactivat;
 *  - AWB creat -> „AWB generat”, număr, etichetă, tracking (fără al doilea AWB);
 *  - UNKNOWN -> „Verifică din nou la Sameday” (după referință), fără generare;
 *  - FAILED / CANCELLED -> mesajul ultimei încercări + formularul din nou.
 * COD e calculat EXCLUSIV de backend și afișat read-only.
 *
 * Expediere FĂRĂ integrare („Trimite fără integrare”): disponibilă mereu
 * înainte de predare - vendorul declară opțional curierul, AWB-ul /
 * tracking-ul și data expedierii; fără CourierAwb, fără apel la curier.
 *
 * Flag: AWB_GENERATION_ENABLED (config/features.js) - generare, etichetă,
 * anulare (DELETE la Sameday; starea se schimbă doar la confirmarea lui).
 */

// eticheta PDF prin backend (frontend-ul nu apelează niciodată Sameday)
async function fetchLabelBlob(shipmentId, format = "A6") {
  const f = labelQueryFormat(format);
  const res = await fetch(buildApiUrl(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/label?format=${f}`), {
    credentials: "include",
  });
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const err = new Error("label_failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return res.blob();
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function downloadLabel(shipmentId, awb, format = "A6") {
  saveBlob(await fetchLabelBlob(shipmentId, format), labelFileName(awb, shipmentId));
}

// PDF-ul în tab nou (vizualizatorul browserului are „Tipărește”); fereastra se
// deschide sincron la click (altfel o blochează browserul), apoi primește PDF-ul
async function printLabel(shipmentId, awb, format = "A6") {
  const win = window.open("", "_blank");
  try {
    const blob = await fetchLabelBlob(shipmentId, format);
    if (!win) {
      saveBlob(blob, labelFileName(awb, shipmentId)); // pop-up blocat -> descărcare
      return;
    }
    const url = URL.createObjectURL(blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    win?.close();
    throw e;
  }
}

function errorCode(e) {
  return e?.data?.error || null;
}

function StatusBadge({ status }) {
  const meta = awbStatusBadge(status);
  return <span className={`${styles.badge} ${styles[`tone_${meta.tone}`]}`}>{meta.label}</span>;
}

function Blockers({ items }) {
  if (!items?.length) return null;
  return (
    <div className={styles.blockers} role="alert">
      <div className={styles.blockersTitle}>
        <AlertTriangle size={16} aria-hidden="true" /> AWB-ul nu poate fi generat încă:
      </div>
      <ul>
        {items.map((b, i) => (
          <li key={`${b.code}-${i}`}>{b.message}</li>
        ))}
      </ul>
    </div>
  );
}

// contul Artfest neconfigurat / integrarea oprită: mesaj clar, fără AWB simulat
function SetupPendingNotice({ message = COURIER_SETUP_PENDING_MESSAGE }) {
  return (
    <div className={`${styles.notice} ${styles.notice_warning}`} role="status" data-awb-setup-pending>
      <strong>{message}</strong>
      <span>AWB-ul nu poate fi generat încă din Artfest. {COURIER_MANUAL_SHIPPING_MESSAGE}</span>
    </div>
  );
}

/* ---------- AWB creat ---------- */

/*
 * Istoricul curierului (status-sync): se încarcă doar la deschidere; include
 * și evenimentele care nu au schimbat statusul comenzii. Doar citire.
 */
function TrackingHistory({ shipmentId }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [events, setEvents] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/awb/tracking`);
      setEvents(Array.isArray(res?.events) ? res.events : []);
    } catch (e) {
      setError(apiErrorMessage(e, "Nu am putut încărca istoricul curierului."));
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    if (open && events === null && !loading && !error) load();
  }, [open, events, loading, error, load]);

  return (
    <details className={styles.trackingHistory} onToggle={(e) => setOpen(e.currentTarget.open)} data-awb-tracking-history>
      <summary>Istoric curier</summary>
      {loading ? (
        <div className={styles.loading} role="status">
          <Loader2 size={16} className={styles.spin} /> Se încarcă istoricul…
        </div>
      ) : error ? (
        <div className={styles.error} role="alert">
          {error}{" "}
          <button type="button" className={styles.linkBtn} onClick={load}>
            <RefreshCcw size={14} /> Încearcă din nou
          </button>
        </div>
      ) : events ? (
        <>
          <TrackingTimeline events={events} />
          <button type="button" className={styles.linkBtn} onClick={load}>
            <RefreshCcw size={14} /> Reîmprospătează
          </button>
        </>
      ) : null}
    </details>
  );
}

function CreatedView({ shipment, awbStatus, onChanged, reload }) {
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // refuzul Sameday (ex. 405 - coletul preluat) rămâne vizibil în secțiune
  const [cancelError, setCancelError] = useState("");
  // A6 implicit (etichetă termică); A4 pentru imprimante de birou
  const [labelFormat, setLabelFormat] = useState("A6");
  // eticheta indisponibilă / eroare: mesaj vizibil + „Verifică din nou”
  const [labelError, setLabelError] = useState("");
  const [rechecking, setRechecking] = useState(false);
  const formatSelectId = useId();
  const pickup = awbPickupStage({ awbStatus, shipment });
  const steps = awbProgressSteps(pickup.stage);

  const s = awbStatus?.shipment || {};
  const awb = s.awb || shipment?.awb;
  const latest = awbStatus?.latest?.awbNumber === awb ? awbStatus.latest : null;
  const trackingUrl = s.trackingUrl || shipment?.trackingUrl || null;
  // originea AWB-ului (Artfest vs. manual) - neschimbată de o anulare în curs
  const artfestAwb = isArtfestManagedAwb({ awbStatus, shipment });
  // butoanele etichetei: doar AWB Artfest confirmat, fără anulare în curs / neconfirmată
  const canDownloadLabel = canDownloadArtfestLabel({ awbStatus, shipment });
  const provider = s.courierProvider || shipment?.courierProvider;
  const service = s.courierService || shipment?.courierService;
  // anulare la Sameday (DELETE /api/awb): serverul decide dacă e permisă (coletul
  // nepredat, fără anulare în curs / neconfirmată) - și pentru o comandă anulată
  const canCancel = AWB_GENERATION_ENABLED && canCancelArtfestAwb({ awbStatus });
  // anulare în curs / neconfirmată: fără buton (fără retry orb), doar starea
  const cancelView = awbCancelView(awbStatus);

  // un singur fetch de etichetă odată (descărcare sau tipărire)
  const labelBusy = downloading || printing;

  const onDownload = async () => {
    if (labelBusy) return;
    setDownloading(true);
    setLabelError("");
    try {
      await downloadLabel(shipment.id, awb, labelFormat);
    } catch (e) {
      setLabelError(labelErrorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  const onPrint = async () => {
    if (labelBusy) return;
    setPrinting(true);
    setLabelError("");
    try {
      await printLabel(shipment.id, awb, labelFormat);
    } catch (e) {
      setLabelError(labelErrorMessage(e));
    } finally {
      setPrinting(false);
    }
  };

  // reîncarcă starea AWB-ului (fără apel la curier) și șterge eroarea
  const onRecheck = async () => {
    if (rechecking) return;
    setRechecking(true);
    try {
      await reload();
      setLabelError("");
    } finally {
      setRechecking(false);
    }
  };

  // starea se schimbă DOAR după confirmarea curierului (backend)
  const onCancel = async () => {
    if (cancelling) return;
    const ok = window.confirm(
      `Anulezi AWB-ul ${awb}? Anularea se face la Sameday și nu poate fi refăcută; vei putea genera un AWB nou.`
    );
    if (!ok) return;
    setCancelling(true);
    setCancelError("");
    try {
      await api(`/api/vendor/shipments/${encodeURIComponent(shipment.id)}/awb/cancel`, { method: "POST" });
      toast.success("AWB-ul a fost anulat.");
      await reload();
      onChanged?.();
    } catch (e) {
      const message = apiErrorMessage(e, "Nu am putut anula AWB-ul.");
      if (cancelErrorIsState(errorCode(e))) {
        // rezultat incert / în curs: starea (din reload) explică, nu un „refuz”
        setCancelError("");
        toast.warn(message);
      } else {
        setCancelError(message);
        toast.error(message);
      }
      await reload();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      <div className={styles.text} data-awb-created>
        <strong>AWB generat</strong>
        <span>
          AWB: <strong>{awb}</strong>
        </span>
      </div>

      {/* ce urmează: doar starea locală; fără ore / date de ridicare inventate */}
      {!cancelView && (
        <>
          <ol className={styles.progress} aria-label="Progresul expedierii">
            {steps.map((st) => (
              <li
                key={st.key}
                className={`${styles.progressStep} ${styles[`progress_${st.state}`] || ""}`}
                aria-current={st.state === "current" ? "step" : undefined}
              >
                <span className={styles.progressDot} aria-hidden="true">
                  {st.state === "done" ? "✓" : ""}
                </span>
                {st.label}
              </li>
            ))}
          </ol>
          <div
            className={`${styles.notice} ${pickup.tone === "warning" ? styles.notice_warning : ""}`}
            role="status"
            data-awb-pickup-stage={pickup.stage}
          >
            <strong>{pickup.title}</strong>
            <span>{pickup.message}</span>
            {pickup.at && <span className={styles.muted}>{formatDateTime(pickup.at)}</span>}
          </div>
        </>
      )}

      {canDownloadLabel && (
        <div className={styles.labelFormat}>
          <label htmlFor={formatSelectId}>Format etichetă</label>
          <select
            id={formatSelectId}
            value={labelFormat}
            onChange={(e) => setLabelFormat(labelQueryFormat(e.target.value))}
            disabled={labelBusy}
          >
            {AWB_LABEL_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f === "A6" ? "A6 (etichetă 10×15)" : "A4 (imprimantă obișnuită)"}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* acțiunile principale primele (pe mobil: lățime completă) */}
      <div className={styles.actions}>
        {canDownloadLabel && (
          <button type="button" className={styles.primaryBtn} onClick={onDownload} disabled={labelBusy} aria-busy={downloading}>
            {downloading ? <Loader2 size={16} className={styles.spin} /> : <FileDown size={16} />}
            {downloading ? "Se descarcă…" : `Descarcă eticheta ${labelFormat}`}
          </button>
        )}
        {canDownloadLabel && (
          <button type="button" className={styles.secondaryBtn} onClick={onPrint} disabled={labelBusy} aria-busy={printing}>
            {printing ? <Loader2 size={16} className={styles.spin} /> : <Printer size={16} />}
            {printing ? "Se deschide…" : "Tipărește eticheta"}
          </button>
        )}
        {trackingUrl && (
          <a className={styles.secondaryBtn} href={trackingUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" /> Vezi tracking
          </a>
        )}
        {canCancel && !cancelView && (
          <button type="button" className={styles.dangerBtn} onClick={onCancel} disabled={cancelling}>
            {cancelling ? <Loader2 size={16} className={styles.spin} /> : <Ban size={16} />}
            {cancelling ? "Se anulează…" : "Anulează AWB"}
          </button>
        )}
      </div>

      {labelError && (
        <div className={styles.error} role="alert" data-awb-label-error>
          <span>{labelError}</span>
          <button type="button" className={styles.linkBtn} onClick={onRecheck} disabled={rechecking}>
            {rechecking ? <Loader2 size={14} className={styles.spin} /> : <RefreshCcw size={14} />} Verifică din nou
          </button>
        </div>
      )}

      {cancelView?.state === "in_progress" && (
        <div className={styles.loading} role="status" data-awb-cancel-in-progress>
          <Loader2 size={16} className={styles.spin} /> {cancelView.message}
          <button type="button" className={styles.linkBtn} onClick={reload}>
            <RefreshCcw size={14} /> Reîmprospătează
          </button>
        </div>
      )}

      {cancelView?.state === "unknown" && (
        <div className={`${styles.notice} ${styles.notice_warning}`} role="status" data-awb-cancel-unknown>
          <strong>Anulare neconfirmată</strong>
          <span>{cancelView.message}</span>
          <span className={styles.muted}>
            Nu preda coletul cu acest AWB și nu genera altul până la confirmare. Echipa Artfest verifică AWB-ul la Sameday.
          </span>
          <button type="button" className={styles.linkBtn} onClick={reload}>
            <RefreshCcw size={14} /> Verifică din nou
          </button>
        </div>
      )}

      <dl className={styles.details}>
        <div className={styles.detail}>
          <dt>AWB</dt>
          <dd>{awb}</dd>
        </div>
        <div className={styles.detail}>
          <dt>Curier</dt>
          <dd>{[provider === "SAMEDAY" ? "Sameday" : provider, service].filter(Boolean).join(" · ") || "—"}</dd>
        </div>
        {latest?.createdAt && (
          <div className={styles.detail}>
            <dt>Creat</dt>
            <dd>{formatDateTime(latest.createdAt)}</dd>
          </div>
        )}
        {latest && (
          <div className={styles.detail}>
            <dt>Ramburs</dt>
            <dd>{formatMoneyRon(latest.codAmount)}</dd>
          </div>
        )}
      </dl>

      {artfestAwb && shipment?.id ? <TrackingHistory shipmentId={shipment.id} /> : null}

      {cancelError && (
        <div className={styles.error} role="alert" data-awb-cancel-error>
          {cancelError}
        </div>
      )}

      {!artfestAwb && (
        <span className={styles.muted}>AWB setat manual de echipa Artfest.</span>
      )}
    </>
  );
}

/* ---------- formular AWB (pregătit / reîncercare) ---------- */

function stripEmpty(form) {
  const out = {};
  for (const [k, v] of Object.entries(form || {})) if (v !== "" && v != null) out[k] = v;
  return out;
}

/*
 * Adresa de ridicare a vendorului (de unde ridică Sameday coletul): se
 * salvează prin rutele existente /api/vendor/pickup-addresses, apoi
 * previzualizarea se recalculează pe server (sursa de adevăr).
 */
function PickupAddressInlineForm({ address, onSaved, onCancel }) {
  const idPrefix = useId();
  const [form, setForm] = useState(() => emptyPickupAddressForm(address));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const local = validatePickupAddressForm(form);
    setErrors(local);
    setFormError("");
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const body = buildPickupAddressPayload(form);
      if (address?.id) {
        await api(`/api/vendor/pickup-addresses/${encodeURIComponent(address.id)}`, { method: "PATCH", body });
      } else {
        await api("/api/vendor/pickup-addresses", { method: "POST", body: { ...body, isDefault: true } });
      }
      toast.success("Adresa de ridicare a fost salvată.");
      onSaved();
    } catch (err) {
      setFormError(apiErrorMessage(err, "Nu am putut salva adresa. Încearcă din nou."));
      const fields = Array.isArray(err?.data?.fields) ? err.data.fields : [];
      if (fields.length) setErrors((prev) => ({ ...prev, ...Object.fromEntries(fields.map((k) => [k, "Verifică acest câmp."])) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.fieldset} onSubmit={submit} noValidate data-pickup-form>
      <span className={styles.muted}>De aici ridică Sameday coletul. Datele apar pe AWB.</span>
      <div className={styles.row}>
        {PICKUP_ADDRESS_FIELDS.map((f) => (
          <label key={f.key} className={styles.field} htmlFor={`${idPrefix}-${f.key}`}>
            <span>
              {f.label}
              {f.required ? " *" : ""}
            </span>
            <input
              id={`${idPrefix}-${f.key}`}
              className={styles.input}
              type={f.type || "text"}
              inputMode={f.inputMode}
              autoComplete={f.autoComplete || "off"}
              maxLength={f.max}
              value={form[f.key]}
              onChange={(e) => {
                const v = e.target.value;
                setForm((x) => ({ ...x, [f.key]: v }));
                setErrors((x) => ({ ...x, [f.key]: undefined }));
              }}
              aria-invalid={!!errors[f.key]}
            />
            {errors[f.key] && <span className={styles.fieldError}>{errors[f.key]}</span>}
          </label>
        ))}
      </div>
      {formError && (
        <div className={styles.error} role="alert">
          {formError}
        </div>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryBtn} disabled={busy}>
          {busy ? <Loader2 size={16} className={styles.spin} /> : <MapPin size={16} />}
          {busy ? "Se salvează…" : "Salvează adresa de ridicare"}
        </button>
        <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
          Renunță
        </button>
      </div>
    </form>
  );
}

function PickupSummary({ pickup, blockers, onEdit }) {
  const problem = (blockers || []).find(isPickupBlocker);
  return (
    <div className={styles.group} data-awb-pickup>
      <div className={styles.groupHead}>
        <span className={styles.groupTitle}>Ridicare</span>
        <button type="button" className={styles.linkBtn} onClick={onEdit}>
          {pickup ? "Modifică" : "Completează"}
        </button>
      </div>
      {problem && (
        <div className={`${styles.notice} ${styles.notice_warning}`} role="alert">
          <strong>{problem.code === "pickup_phone_invalid" || problem.code === "pickup_postal_code_invalid" ? problem.message : PICKUP_DETAILS_MISSING_MESSAGE}</strong>
        </div>
      )}
      {pickup && (
        <dl className={styles.details}>
          <div className={styles.detail}>
            <dt>Magazin</dt>
            <dd>{pickup.storeName || "—"}</dd>
          </div>
          <div className={styles.detail}>
            <dt>Persoană de contact</dt>
            <dd>{pickup.contactName || "—"}</dd>
          </div>
          <div className={styles.detail}>
            <dt>Telefon</dt>
            <dd>{pickup.phone || "—"}</dd>
          </div>
          <div className={styles.detail}>
            <dt>Adresa de ridicare</dt>
            <dd>{pickup.fullAddress || "—"}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function ConfirmGroup({ title, rows }) {
  return (
    <div className={styles.group}>
      <span className={styles.groupTitle}>{title}</span>
      <dl className={styles.details}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.detail}>
            <dt>{label}</dt>
            <dd>{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/*
 * Confirmarea „Generează AWB”: previzualizarea calculată de server pentru
 * greutatea / coletele introduse (ridicare, destinatar, colet, serviciu,
 * plată). Butonul final trimite cererea (cheie de idempotență per încercare).
 */
function AwbConfirmDialog({ preview, loading, blockers, submitting, submitError, onConfirm, onClose }) {
  const titleId = useId();
  const confirmRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  useEffect(() => {
    if (!loading) confirmRef.current?.focus();
  }, [loading]);

  const pickup = preview?.pickup || {};
  const recipient = preview?.recipient || {};
  const ready = !!preview && !loading && blockers.length === 0;
  const cod = preview?.payment?.type === "COD";

  return (
    <div className={styles.overlay} role="presentation" onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}>
      <div className={`${styles.dialog} ${styles.dialogWide}`} role="dialog" aria-modal="true" aria-labelledby={titleId} data-awb-confirm>
        <h2 id={titleId} className={styles.dialogTitle}>
          Verifică datele AWB-ului
        </h2>
        <button type="button" className={styles.dialogClose} onClick={onClose} disabled={submitting} aria-label="Închide">
          <X size={18} />
        </button>

        {loading && (
          <div className={styles.loading} role="status">
            <Loader2 size={18} className={styles.spin} /> Verificăm datele expedierii…
          </div>
        )}

        {preview && !loading && (
          <>
            <Blockers items={blockers} />
            <ConfirmGroup
              title="Ridicare"
              rows={[
                ["Magazin", pickup.storeName],
                ["Persoană de contact", pickup.contactName],
                ["Telefon", pickup.phone],
                ["Adresa de ridicare", pickup.fullAddress],
              ]}
            />
            <ConfirmGroup
              title="Destinatar"
              rows={[
                ["Nume", recipient.name],
                ["Telefon", recipient.phone],
                ["Adresă", recipient.address],
                ["Localitate / județ", [recipient.city, recipient.county].filter(Boolean).join(", ")],
              ]}
            />
            <ConfirmGroup
              title="Colet"
              rows={[
                ["Număr colete", preview.parcels != null ? String(preview.parcels) : null],
                ["Greutate", preview.weightKg != null ? `${String(preview.weightKg).replace(".", ",")} kg` : null],
                ["Tip colet", preview.packageType?.label],
              ]}
            />
            <ConfirmGroup title="Livrare" rows={[["Serviciu Sameday", preview.serviceName ? `${preview.serviceName} - livrare la adresă` : null]]} />
            <ConfirmGroup
              title="Plată"
              rows={[
                ["Plată", preview.payment?.label],
                ["Sumă ramburs", cod ? formatMoneyRon(preview.payment.codAmount) : formatMoneyRon(0)],
              ]}
            />
          </>
        )}

        {submitError && (
          <div className={styles.error} role="alert">
            {submitError}
          </div>
        )}

        <div className={styles.dialogActions}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
            Renunță
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={styles.primaryBtn}
            onClick={onConfirm}
            disabled={!ready || submitting}
            aria-busy={submitting}
            data-awb-confirm-submit
          >
            {submitting ? <Loader2 size={16} className={styles.spin} /> : <Truck size={16} />}
            {submitting ? "Se generează…" : "Generează AWB"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AwbForm({ shipmentId, notice, onCreated, onSetupPendingChange }) {
  const idPrefix = useId();
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [form, setForm] = useState(null);
  const [inputsTouched, setInputsTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [serverBlockers, setServerBlockers] = useState(null);
  const [editingPickup, setEditingPickup] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const keyRef = useRef(newIdempotencyKey());
  const submittingRef = useRef(false);

  const runPreview = useCallback(
    async (body = {}) => {
      setLoadingPreview(true);
      setPreviewError("");
      setServerBlockers(null);
      try {
        const res = await api(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/awb/preview`, {
          method: "POST",
          body,
        });
        setPreview(res.preview);
        setForm((prev) => (prev ? { ...initialAwbForm(res.preview), ...stripEmpty(prev) } : initialAwbForm(res.preview)));
        setInputsTouched(false);
        return res.preview;
      } catch (e) {
        setPreviewError(apiErrorMessage(e, "Nu am putut pregăti AWB-ul. Încearcă din nou."));
        return null;
      } finally {
        setLoadingPreview(false);
      }
    },
    [shipmentId]
  );

  useEffect(() => {
    runPreview({});
  }, [runPreview]);

  const formErrors = form ? validateAwbForm(form) : {};
  const allBlockers = serverBlockers || preview?.blockers;
  const setupPending = isCourierSetupPending({ ...preview, blockers: allBlockers });
  const setupMessage = courierSetupMessage({ ...preview, blockers: allBlockers }, COURIER_SETUP_PENDING_MESSAGE);
  // configurarea Artfest și adresa de ridicare au secțiunile lor; lista păstrează restul
  const blockers = remainingBlockers(allBlockers, { inputsTouched }).filter(
    (b) => !isPlatformSetupBlocker(b) && !isPickupBlocker(b)
  );
  const pickupBlocked = (allBlockers || []).some(isPickupBlocker);
  const awbLiveOff = isAwbLiveDisabled(preview);
  const canOpenConfirm =
    !!preview &&
    !loadingPreview &&
    !setupPending &&
    !awbLiveOff &&
    !pickupBlocked &&
    canSubmitAwb({ blockers: allBlockers, inputsTouched, formErrors, submitting });

  useEffect(() => {
    // AWB real oprit: „Trimite fără integrare” devine acțiunea clară
    if (preview) onSetupPendingChange?.(setupPending || awbLiveOff);
  }, [preview, setupPending, awbLiveOff, onSetupPendingChange]);

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (AWB_INPUT_FIELDS.includes(key)) setInputsTouched(true);
    setSubmitError("");
  };

  // „Generează AWB” -> previzualizarea finală (server) în dialogul de confirmare
  const openConfirm = async () => {
    if (!canOpenConfirm) return;
    setSubmitError("");
    setConfirmOpen(true);
    await runPreview(buildAwbRequestBody(form));
  };

  const submit = async () => {
    // protecție dublu click (și înainte ca state-ul să se actualizeze)
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await api(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/awb`, {
        method: "POST",
        body: buildAwbRequestBody(form),
        headers: { "Idempotency-Key": keyRef.current },
      });
      toast.success(`AWB generat: ${res?.awb?.awbNumber}`);
      setConfirmOpen(false);
      onCreated(res?.awb);
    } catch (e) {
      if (!shouldKeepIdempotencyKey(e)) keyRef.current = newIdempotencyKey();
      if (Array.isArray(e?.data?.blockers)) {
        setServerBlockers(e.data.blockers);
        setInputsTouched(false);
      }
      setSubmitError(apiErrorMessage(e, "Nu am putut genera AWB-ul. Încearcă din nou."));
      if (errorCode(e) === "courier_awb_live_disabled") {
        setConfirmOpen(false); // AWB real oprit pe server - nimic trimis la curier
        setPreview((p) => (p ? { ...p, awbLiveEnabled: false } : p));
      }
      if (["awb_status_unknown", "awb_saved_partially", "awb_in_progress", "awb_exists"].includes(errorCode(e))) {
        setConfirmOpen(false);
        onCreated(null); // reîncarcă: secțiunea arată starea reală (verificare / AWB existent)
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const recipient = preview?.recipient || {};
  const confirmBlockers = serverBlockers || preview?.blockers || [];

  return (
    <div className={styles.body}>
      {notice && (
        <div className={`${styles.notice} ${notice.tone === "danger" ? styles.notice_danger : ""}`} role="status">
          <strong>{notice.title}</strong>
          <span>{notice.message}</span>
        </div>
      )}

      {loadingPreview && !preview && (
        <div className={styles.loading} role="status">
          <Loader2 size={18} className={styles.spin} /> Verificăm datele expedierii…
        </div>
      )}

      {previewError && (
        <div className={styles.error} role="alert">
          {previewError}{" "}
          <button type="button" className={styles.linkBtn} onClick={() => runPreview(buildAwbRequestBody(form || {}))}>
            Reîncearcă
          </button>
        </div>
      )}

      {preview && form && (
        <>
          {setupPending && <SetupPendingNotice message={setupMessage} />}

          <Blockers items={blockers} />

          {editingPickup ? (
            <PickupAddressInlineForm
              address={preview.pickup?.addressId ? { id: preview.pickup.addressId, ...(preview.pickup.form || {}) } : null}
              onCancel={() => setEditingPickup(false)}
              onSaved={async () => {
                setEditingPickup(false);
                await runPreview(buildAwbRequestBody(form));
              }}
            />
          ) : (
            <PickupSummary pickup={preview.pickup} blockers={allBlockers} onEdit={() => setEditingPickup(true)} />
          )}

          {/* destinatarul, din comandă (server) - vendorul îl verifică înainte de generare */}
          <div className={styles.group}>
            <span className={styles.groupTitle}>Destinatar</span>
            <dl className={styles.details}>
              <div className={styles.detail}>
                <dt>Nume</dt>
                <dd>{recipient.name || "—"}</dd>
              </div>
              <div className={styles.detail}>
                <dt>Telefon</dt>
                <dd>{recipient.phone || "—"}</dd>
              </div>
              <div className={styles.detail}>
                <dt>Adresă</dt>
                <dd>{preview.deliveryAddress || "—"}</dd>
              </div>
              <div className={styles.detail}>
                <dt>Plată</dt>
                {/* read-only: calculat de server din comandă */}
                <dd>
                  <output className={styles.cod} aria-label="Sumă ramburs, calculată automat">
                    {formatMoneyRon(preview.codAmount)}
                  </output>
                  <div className={styles.muted}>
                    {preview.paymentMethod === "COD" ? "Ramburs - calculat automat din comandă" : "Achitat online - fără ramburs"}
                  </div>
                </dd>
              </div>
            </dl>
          </div>

          <fieldset className={styles.fieldset} disabled={submitting}>
            <legend>Colet</legend>

            <div className={styles.row}>
              <label className={styles.field} htmlFor={`${idPrefix}-p`}>
                <span>Nr. colete</span>
                <input
                  id={`${idPrefix}-p`}
                  className={styles.input}
                  inputMode="numeric"
                  value={form.parcels}
                  onChange={(e) => setField("parcels", e.target.value)}
                  aria-invalid={!!formErrors.parcels}
                />
                {formErrors.parcels && <span className={styles.fieldError}>{formErrors.parcels}</span>}
              </label>
              <label className={styles.field} htmlFor={`${idPrefix}-w`}>
                <span>Greutate totală (kg) *</span>
                <input
                  id={`${idPrefix}-w`}
                  className={styles.input}
                  inputMode="decimal"
                  value={form.weightKg}
                  onChange={(e) => setField("weightKg", e.target.value)}
                  aria-invalid={!!formErrors.weightKg}
                  placeholder="Ex: 1.5"
                />
                {inputsTouched && formErrors.weightKg && <span className={styles.fieldError}>{formErrors.weightKg}</span>}
              </label>
            </div>
            <span className={styles.muted} data-awb-package-type>
              Tip colet: {packageTypeLabel(form.weightKg, form.parcels)}
            </span>

            <details className={styles.dims}>
              <summary>Dimensiuni (opțional)</summary>
              <div className={styles.row3}>
                {[
                  ["lengthCm", "Lungime (cm)"],
                  ["widthCm", "Lățime (cm)"],
                  ["heightCm", "Înălțime (cm)"],
                ].map(([key, label]) => (
                  <label key={key} className={styles.field} htmlFor={`${idPrefix}-${key}`}>
                    <span>{label}</span>
                    <input
                      id={`${idPrefix}-${key}`}
                      className={styles.input}
                      inputMode="numeric"
                      value={form[key]}
                      onChange={(e) => setField(key, e.target.value)}
                      aria-invalid={!!formErrors[key]}
                    />
                    {formErrors[key] && <span className={styles.fieldError}>{formErrors[key]}</span>}
                  </label>
                ))}
              </div>
            </details>
          </fieldset>

          {submitError && !confirmOpen && (
            <div className={styles.error} role="alert">
              {submitError}
            </div>
          )}

          {awbLiveOff && !setupPending && (
            <div className={`${styles.notice} ${styles.notice_warning}`} role="status" data-awb-live-disabled>
              {AWB_LIVE_DISABLED_MESSAGE}
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={openConfirm}
              disabled={!canOpenConfirm}
              aria-disabled={!canOpenConfirm}
              title={
                setupPending
                  ? setupMessage
                  : awbLiveOff
                    ? AWB_LIVE_DISABLED_MESSAGE
                    : pickupBlocked
                      ? PICKUP_DETAILS_MISSING_MESSAGE
                      : undefined
              }
            >
              <Truck size={16} />
              {notice?.retryLabel || "Generează AWB"}
            </button>
          </div>

          {confirmOpen && (
            <AwbConfirmDialog
              preview={preview}
              loading={loadingPreview}
              blockers={confirmBlockers}
              submitting={submitting}
              submitError={submitError}
              onConfirm={submit}
              onClose={() => setConfirmOpen(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ---------- AWB neconfirmat (UNKNOWN) ---------- */

/*
 * Răspunsul Sameday nu a ajuns (timeout / conexiune): generarea rămâne
 * blocată (fără AWB dublu). „Verifică din nou la Sameday” caută AWB-ul după
 * referința expedierii (backend: recoverUnknownAwb) - nu creează niciun AWB.
 */
function UnknownAwbNotice({ shipmentId, onChanged }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const checkingRef = useRef(false);

  const recheck = async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setMessage("");
    try {
      const res = await api(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/awb/recover`, { method: "POST" });
      if (res?.outcome === "created") toast.success(`AWB generat: ${res?.awb?.awbNumber}`);
      else toast.info("Sameday nu are AWB pentru această încercare. Poți genera AWB-ul din nou.");
      await onChanged();
    } catch (e) {
      setMessage(apiErrorMessage(e, "Nu am putut verifica la Sameday. Încearcă din nou."));
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  };

  return (
    <div className={`${styles.notice} ${styles.notice_warning}`} role="status" data-awb-unknown>
      <strong>Sameday nu a confirmat încă AWB-ul</strong>
      <span>
        Nu știm încă dacă AWB-ul a fost creat. Ca să evităm un AWB dublu, nu se generează altul până nu verificăm la
        Sameday.
      </span>
      {message && <span className={styles.fieldError}>{message}</span>}
      <div className={styles.actions}>
        <button type="button" className={styles.secondaryBtn} onClick={recheck} disabled={checking} aria-busy={checking}>
          {checking ? <Loader2 size={16} className={styles.spin} /> : <SearchCheck size={16} />}
          {checking ? "Se verifică…" : "Verifică din nou la Sameday"}
        </button>
      </div>
    </div>
  );
}

/* ---------- expediere fără integrare ---------- */

function ManualShippedView({ shipment }) {
  return (
    <>
      {shipment.trackingUrl && (
        <div className={styles.actions}>
          <a className={styles.secondaryBtn} href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" /> Vezi tracking
          </a>
        </div>
      )}
      <dl className={styles.details}>
        <div className={styles.detail}>
          <dt>Curier</dt>
          <dd>{shipment.courierProvider || "—"}</dd>
        </div>
        <div className={styles.detail}>
          <dt>AWB / tracking</dt>
          <dd>{shipment.awb || "—"}</dd>
        </div>
        <div className={styles.detail}>
          <dt>Expediat</dt>
          <dd>{formatShippedDate(shipment.handedOverAt) || "—"}</dd>
        </div>
      </dl>
      <span className={styles.muted}>Trimis fără integrare de curier. AWB-ul nu se generează ulterior din Artfest.</span>
    </>
  );
}

function ManualShipForm({ orderId, canProcess, onDone, onClose }) {
  const idPrefix = useId();
  const [form, setForm] = useState(() => initialManualShipForm());
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const submittingRef = useRef(false);

  const errors = validateManualShipForm(form);
  const hasErrors = Object.keys(errors).length > 0;
  const maxDate = initialManualShipForm().shippedAt;

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSubmitError("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    // protecție dublu click (și înainte ca state-ul să se actualizeze)
    if (submittingRef.current || hasErrors || !canProcess) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      await api(`/api/vendor/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        body: buildManualShipBody(form),
      });
      toast.success("Comanda a fost marcată ca expediată.");
      onDone?.();
    } catch (err) {
      setSubmitError(apiErrorMessage(err, "Nu am putut marca expedierea. Încearcă din nou."));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const fieldError = (key) => ((touched || form[key]) && errors[key]) || null;

  return (
    <form className={styles.body} onSubmit={submit} noValidate>
      <fieldset className={styles.fieldset} disabled={submitting}>
        <legend>Trimite fără integrare</legend>
        <span className={styles.muted}>
          Trimiți coletul pe cont propriu, cu orice curier. Câmpurile sunt opționale; clientul primește datele de
          urmărire dacă le completezi. Costul transportului și plata comenzii nu se schimbă.
        </span>

        <div className={styles.row}>
          <label className={styles.field} htmlFor={`${idPrefix}-courier`}>
            <span>Curier (opțional)</span>
            <input
              id={`${idPrefix}-courier`}
              className={styles.input}
              list={`${idPrefix}-couriers`}
              value={form.courierName}
              maxLength={80}
              autoComplete="off"
              placeholder="Ex: FAN Courier"
              onChange={(e) => setField("courierName", e.target.value)}
              aria-invalid={!!fieldError("courierName")}
            />
            <datalist id={`${idPrefix}-couriers`}>
              {MANUAL_COURIER_SUGGESTIONS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {fieldError("courierName") && <span className={styles.fieldError}>{errors.courierName}</span>}
          </label>

          <label className={styles.field} htmlFor={`${idPrefix}-awb`}>
            <span>AWB / număr de urmărire (opțional)</span>
            <input
              id={`${idPrefix}-awb`}
              className={styles.input}
              value={form.awb}
              maxLength={60}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => setField("awb", e.target.value)}
              aria-invalid={!!fieldError("awb")}
            />
            {fieldError("awb") && <span className={styles.fieldError}>{errors.awb}</span>}
          </label>
        </div>

        <div className={styles.row}>
          <label className={styles.field} htmlFor={`${idPrefix}-url`}>
            <span>Link de urmărire (opțional)</span>
            <input
              id={`${idPrefix}-url`}
              className={styles.input}
              type="url"
              inputMode="url"
              value={form.trackingUrl}
              maxLength={500}
              autoComplete="off"
              placeholder="https://…"
              onChange={(e) => setField("trackingUrl", e.target.value)}
              aria-invalid={!!fieldError("trackingUrl")}
            />
            {fieldError("trackingUrl") && <span className={styles.fieldError}>{errors.trackingUrl}</span>}
          </label>

          <label className={styles.field} htmlFor={`${idPrefix}-date`}>
            <span>Data expedierii *</span>
            <input
              id={`${idPrefix}-date`}
              className={styles.input}
              type="date"
              value={form.shippedAt}
              max={maxDate}
              onChange={(e) => setField("shippedAt", e.target.value)}
              aria-invalid={!!fieldError("shippedAt")}
            />
            {fieldError("shippedAt") && <span className={styles.fieldError}>{errors.shippedAt}</span>}
          </label>
        </div>
      </fieldset>

      {!canProcess && (
        <div className={styles.error} role="alert">
          Clientul nu a finalizat încă plata. Poți expedia comanda după confirmarea plății.
        </div>
      )}

      {submitError && (
        <div className={styles.error} role="alert">
          {submitError}
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="submit"
          className={styles.primaryBtn}
          disabled={submitting || !canProcess || (touched && hasErrors)}
          aria-busy={submitting}
        >
          {submitting ? <Loader2 size={16} className={styles.spin} /> : <PackageCheck size={16} />}
          {submitting ? "Se salvează…" : "Marchează ca expediată"}
        </button>
        <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={submitting}>
          Renunță
        </button>
      </div>
    </form>
  );
}

/*
 * Intrarea „Trimite fără integrare”: "primary" (niciun curier utilizabil)
 * = buton clar; "discreet" (curier conectat) = link sub formularul AWB.
 */
function ManualShipEntry({ visibility, orderId, canProcess, onDone, secondary = false }) {
  const [open, setOpen] = useState(false);
  if (!visibility || !orderId) return null;

  if (open) {
    return (
      <ManualShipForm
        orderId={orderId}
        canProcess={canProcess}
        onDone={() => {
          setOpen(false);
          onDone?.();
        }}
        onClose={() => setOpen(false)}
      />
    );
  }

  if (visibility === "discreet") {
    return (
      <button type="button" className={styles.linkBtn} onClick={() => setOpen(true)}>
        sau trimite fără integrare
      </button>
    );
  }

  return (
    <div className={styles.actions}>
      <button type="button" className={secondary ? styles.secondaryBtn : styles.primaryBtn} onClick={() => setOpen(true)}>
        <PackageCheck size={16} aria-hidden="true" /> Trimite fără integrare
      </button>
    </div>
  );
}

function SectionShell({ title = "Curier / Livrare", badge = null, children }) {
  return (
    <section id="awb" className={styles.section} aria-label="Curier și livrare">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Truck size={18} />
        </span>
        <h3 className={styles.title}>{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

/* ---------- secțiunea ---------- */

export default function AwbPanel(props) {
  const { shipment, orderStatus, orderId, canProcess = true, onChanged } = props;

  // expediată fără integrare: doar datele introduse de vendor (indiferent de flag)
  if (shipment?.manualShipment) {
    return (
      <SectionShell badge={<span className={`${styles.badge} ${styles.tone_success}`}>Fără integrare</span>}>
        <ManualShippedView shipment={shipment} />
      </SectionShell>
    );
  }

  // generarea AWB oprită din config: niciun apel de curierat; fluxul manual activ
  if (!AWB_GENERATION_ENABLED) {
    if (!canShipManually({ shipment, orderStatus }) || !orderId) return null;
    return (
      <SectionShell title="Livrare">
        <SetupPendingNotice />
        <ManualShipEntry visibility="primary" orderId={orderId} canProcess={canProcess} onDone={onChanged} />
      </SectionShell>
    );
  }

  return <AwbPanelInner {...props} />;
}

function AwbPanelInner({ shipment, orderStatus, orderId, canProcess = true, onChanged }) {
  const [awbStatus, setAwbStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [setupPending, setSetupPending] = useState(false);

  const shipmentId = shipment?.id;

  // contul de curier e al Artfest: doar statusul AWB al expedierii
  const load = useCallback(async () => {
    if (!shipmentId) return;
    setLoading(true);
    try {
      setAwbStatus(await api(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/awb`));
      setLoadError(null);
    } catch (e) {
      setAwbStatus(null);
      setLoadError({ code: errorCode(e) === "courier_integration_disabled" ? "courier_integration_disabled" : "load_failed" });
    } finally {
      setLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const state = decideAwbPanelState({ shipment, orderStatus, loading, loadError, awbStatus });

  const manualVis = orderId
    ? manualShipVisibility({ shipment, orderStatus, panelState: state, setupPending })
    : null;

  if (!shipmentId || state === "hidden") return null;

  const badgeStatus =
    state === "created" ? "CREATED" : state === "unknown" ? "UNKNOWN" : state === "requested" ? "REQUESTED" : null;

  const afterChange = async () => {
    await load();
    onChanged?.();
  };

  return (
    <SectionShell badge={badgeStatus && <StatusBadge status={badgeStatus} />}>
      {state === "loading" && (
        <div className={styles.loading} role="status">
          <Loader2 size={18} className={styles.spin} /> Se încarcă…
        </div>
      )}

      {/* backend oprit (COURIER_INTEGRATION_ENABLED, 503): niciun apel la curier */}
      {state === "disabled" && <SetupPendingNotice />}

      {state === "error" && (
        <div className={styles.error} role="alert">
          Nu am putut încărca datele de livrare.{" "}
          <button type="button" className={styles.linkBtn} onClick={load}>
            Reîncearcă
          </button>
        </div>
      )}

      {state === "requested" && (
        <div className={styles.text}>
          <strong>AWB în curs de generare</strong>
          <span className={styles.muted}>Așteptăm confirmarea curierului. Nu genera din nou.</span>
          <button type="button" className={styles.linkBtn} onClick={load}>
            <RefreshCcw size={14} /> Reîmprospătează
          </button>
        </div>
      )}

      {state === "unknown" && <UnknownAwbNotice shipmentId={shipmentId} onChanged={afterChange} />}

      {state === "created" && (
        <CreatedView
          shipment={shipment}
          awbStatus={awbStatus}
          onChanged={onChanged}
          reload={load}
        />
      )}

      {state === "ready" && (
        <AwbForm
          key={awbStatus?.latest?.id || "new"}
          shipmentId={shipmentId}
          notice={lastAttemptNotice(awbStatus)}
          onCreated={afterChange}
          onSetupPendingChange={setSetupPending}
        />
      )}

      {/* „Trimite fără integrare”: clar când AWB-ul nu poate fi generat, discret lângă „Generează AWB” */}
      <ManualShipEntry
        visibility={manualVis}
        orderId={orderId}
        canProcess={canProcess}
        onDone={onChanged}
      />
    </SectionShell>
  );
}
