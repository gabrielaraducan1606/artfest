// src/pages/Vendor/Orders/components/AwbPanel.jsx
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import {
  Truck,
  FileDown,
  Loader2,
  AlertTriangle,
  RefreshCcw,
  Ban,
  ExternalLink,
  Settings2,
  PackageCheck,
  X,
} from "lucide-react";
import { api, buildApiUrl } from "../../../../lib/api";
import { apiErrorMessage, formatDateTime } from "../../Settings/couriers/courierSettingsLogic.js";
import {
  COURIER_AUTOMATION_ENABLED,
  COURIER_AUTOMATION_SOON_MESSAGE,
  COURIER_MANUAL_SHIPPING_MESSAGE,
} from "../../../../config/features.js";
import { vendorCouriersSettingsUrl } from "../../../../config/vendorNavigation.js";
import {
  decideAwbPanelState,
  lastAttemptNotice,
  awbStatusBadge,
  settingsActionForBlockers,
  canCancelArtfestAwb,
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
  shouldShowCourierPrompt,
  MANUAL_COURIER_SUGGESTIONS,
  initialManualShipForm,
  validateManualShipForm,
  buildManualShipBody,
  formatShippedDate,
} from "../utils/awbPanelLogic.js";
import styles from "./AwbPanel.module.css";

/*
 * Secțiunea „Curier / Livrare” din detaliul comenzii (per Shipment).
 * Starea (utils/awbPanelLogic.js -> decideAwbPanelState) decide UN singur
 * set de acțiuni; niciun buton activ pentru o acțiune care nu poate rula:
 *  - fără cont / cont invalid / fără adresă de ridicare -> link spre Setări;
 *  - pregătit -> formularul AWB (curier, serviciu, punct de ridicare,
 *    colete, greutate, ramburs calculat de server) + „Generează AWB”;
 *  - AWB creat -> număr, status, dată, etichetă, tracking, anulare (dacă
 *    serverul o permite: awbStatus.canCancel);
 *  - UNKNOWN -> „Necesită verificare”, fără generare (rezolvă adminul);
 *  - FAILED / CANCELLED -> mesajul ultimei încercări + formularul din nou.
 * COD e calculat EXCLUSIV de backend și afișat read-only.
 *
 * Expediere FĂRĂ integrare („Trimite fără integrare”): disponibilă mereu
 * înainte de predare (și cu integrarea oprită) - vendorul declară opțional
 * curierul, AWB-ul / tracking-ul și data expedierii; fără CourierAwb, fără
 * apel la curier, nimic financiar. Fără niciun cont de curier, dialogul
 * „Nu ai conectat încă un curier” apare o singură dată (preferința
 * „Continuă fără integrare” e salvată pe vendor).
 *
 * Flag: COURIER_AUTOMATION_ENABLED (config/features.js: VENDOR_COURIERS_ENABLED && COURIER_AUTO_INTEGRATION_AVAILABLE). Oprit -> fără apeluri
 * de curierat; rămân doar expedierea fără integrare și datele ei.
 */

async function downloadLabel(shipmentId, awb) {
  const res = await fetch(buildApiUrl(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/label`), {
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
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `AWB-${awb || shipmentId}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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

/*
 * Link la Setări → curieri cu întoarcere la comanda curentă (?returnTo=) -
 * „Trimite coletul fără integrare” din ajutorul eAWB revine aici.
 */
function useCouriersSettingsUrl() {
  const { pathname } = useLocation();
  return vendorCouriersSettingsUrl({ returnTo: pathname });
}

function SettingsLink({ label }) {
  const settingsUrl = useCouriersSettingsUrl();
  return (
    <Link className={styles.primaryBtn} to={settingsUrl}>
      <Settings2 size={16} aria-hidden="true" /> {label}
    </Link>
  );
}

function SetupCta({ title, text, linkLabel }) {
  return (
    <>
      <div className={styles.text}>
        <strong>{title}</strong>
        <span className={styles.muted}>{text}</span>
      </div>
      <div className={styles.actions}>
        <SettingsLink label={linkLabel} />
      </div>
    </>
  );
}

/* ---------- AWB creat ---------- */

function CreatedView({ shipment, awbStatus, orderStatus, onChanged, reload }) {
  const [downloading, setDownloading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const s = awbStatus?.shipment || {};
  const awb = s.awb || shipment?.awb;
  const latest = awbStatus?.latest?.awbNumber === awb ? awbStatus.latest : null;
  const trackingUrl = s.trackingUrl || shipment?.trackingUrl || null;
  const artfestLabel = s.artfestLabel ?? String(shipment?.labelUrl || "").startsWith("/api/vendor/shipments/");
  const provider = s.courierProvider || shipment?.courierProvider;
  const service = s.courierService || shipment?.courierService;
  const canCancel = canCancelArtfestAwb({ awbStatus, orderStatus });

  const onDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadLabel(shipment.id, awb);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Nu am putut descărca eticheta."));
    } finally {
      setDownloading(false);
    }
  };

  // starea se schimbă DOAR după confirmarea curierului (backend)
  const onCancel = async () => {
    if (cancelling) return;
    const ok = window.confirm(
      `Anulezi AWB-ul ${awb}? Anularea se face la curier și nu poate fi refăcută; vei putea genera un AWB nou.`
    );
    if (!ok) return;
    setCancelling(true);
    try {
      await api(`/api/vendor/shipments/${encodeURIComponent(shipment.id)}/awb/cancel`, { method: "POST" });
      toast.success("AWB-ul a fost anulat.");
      await reload();
      onChanged?.();
    } catch (e) {
      toast.error(apiErrorMessage(e, "Nu am putut anula AWB-ul."));
      await reload();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      {/* acțiunile principale primele (pe mobil: lățime completă) */}
      <div className={styles.actions}>
        {artfestLabel && (
          <button type="button" className={styles.primaryBtn} onClick={onDownload} disabled={downloading}>
            {downloading ? <Loader2 size={16} className={styles.spin} /> : <FileDown size={16} />}
            Descarcă eticheta
          </button>
        )}
        {trackingUrl && (
          <a className={styles.secondaryBtn} href={trackingUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" /> Vezi tracking
          </a>
        )}
        {canCancel && (
          <button type="button" className={styles.dangerBtn} onClick={onCancel} disabled={cancelling}>
            {cancelling ? <Loader2 size={16} className={styles.spin} /> : <Ban size={16} />}
            Anulează AWB
          </button>
        )}
      </div>

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

      {!artfestLabel && (
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

function AwbForm({ shipmentId, notice, onCreated }) {
  const idPrefix = useId();
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [form, setForm] = useState(null);
  const [inputsTouched, setInputsTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [serverBlockers, setServerBlockers] = useState(null);
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
      } catch (e) {
        setPreviewError(apiErrorMessage(e, "Nu am putut pregăti AWB-ul. Încearcă din nou."));
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
  const blockers = remainingBlockers(allBlockers, { inputsTouched });
  const settingsAction = settingsActionForBlockers(blockers);
  const canSubmit =
    !!preview &&
    !loadingPreview &&
    canSubmitAwb({ blockers: allBlockers, inputsTouched, formErrors, submitting });

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (["weightKg", "parcels", "lengthCm", "widthCm", "heightCm", "serviceId"].includes(key)) setInputsTouched(true);
    setSubmitError("");
  };

  const submit = async () => {
    // protecție dublu click (și înainte ca state-ul să se actualizeze)
    if (submittingRef.current || !canSubmit) return;
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
      onCreated(res?.awb);
    } catch (e) {
      if (!shouldKeepIdempotencyKey(e)) keyRef.current = newIdempotencyKey();
      if (Array.isArray(e?.data?.blockers)) {
        setServerBlockers(e.data.blockers);
        setInputsTouched(false);
      }
      setSubmitError(apiErrorMessage(e, "Nu am putut genera AWB-ul. Încearcă din nou."));
      if (["awb_status_unknown", "awb_saved_partially", "awb_in_progress", "awb_exists"].includes(errorCode(e))) {
        onCreated(null); // reîncarcă: secțiunea arată starea reală (verificare / AWB existent)
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const services = preview?.services || [];
  const accounts = (preview?.accounts || []).filter((a) => a.status === "ACTIVE");
  const selectedService = services.find((s) => String(s.id) === String(form?.serviceId));

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
          <Loader2 size={18} className={styles.spin} /> Verificăm datele comenzii și contul de curier…
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
          <Blockers items={blockers} />

          <dl className={styles.details}>
            <div className={styles.detail}>
              <dt>Curier</dt>
              <dd>{preview.courier?.label || "—"}</dd>
            </div>
            <div className={styles.detail}>
              <dt>Serviciu</dt>
              <dd>{selectedService?.name || preview.serviceName || "—"}</dd>
            </div>
            <div className={styles.detail}>
              <dt>Punct de ridicare</dt>
              <dd>{preview.pickupPoint?.alias || (preview.pickupPoint ? `#${preview.pickupPoint.id}` : "—")}</dd>
            </div>
            <div className={styles.detail}>
              <dt>Ramburs</dt>
              {/* read-only: calculat de server din comandă */}
              <dd>
                <output className={styles.cod} aria-label="Sumă ramburs, calculată automat">
                  {formatMoneyRon(preview.codAmount)}
                </output>
                <div className={styles.muted}>
                  {preview.paymentMethod === "COD" ? "Calculat automat din comandă" : "Comandă plătită online"}
                </div>
              </dd>
            </div>
          </dl>

          <fieldset className={styles.fieldset} disabled={submitting}>
            <legend>Colet</legend>

            {accounts.length > 1 && (
              <label className={styles.field} htmlFor={`${idPrefix}-acc`}>
                <span>Cont de curier</span>
                <select
                  id={`${idPrefix}-acc`}
                  className={styles.input}
                  value={form.courierAccountId}
                  onChange={(e) => {
                    const next = { ...form, courierAccountId: e.target.value, serviceId: "" };
                    setForm(next);
                    runPreview(buildAwbRequestBody(next));
                  }}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {services.length > 1 && (
              <label className={styles.field} htmlFor={`${idPrefix}-svc`}>
                <span>Serviciu</span>
                <select
                  id={`${idPrefix}-svc`}
                  className={styles.input}
                  value={form.serviceId}
                  onChange={(e) => setField("serviceId", e.target.value)}
                >
                  {services.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                      {s.code ? ` (${s.code})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

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

          {submitError && (
            <div className={styles.error} role="alert">
              {submitError}
            </div>
          )}

          <div className={styles.actions}>
            {settingsAction ? (
              <SettingsLink label={settingsAction.label} />
            ) : (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={submit}
                disabled={!canSubmit}
                aria-busy={submitting}
              >
                {submitting ? <Loader2 size={16} className={styles.spin} /> : <Truck size={16} />}
                {submitting ? "Se generează…" : notice?.retryLabel || "Generează AWB"}
              </button>
            )}
          </div>
        </>
      )}
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

function CourierPromptDialog({ onContinue, onClose, busy, error }) {
  const settingsUrl = useCouriersSettingsUrl();
  const titleId = useId();
  const descId = useId();
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}>
        <button type="button" className={styles.dialogClose} onClick={onClose} aria-label="Închide">
          <X size={18} />
        </button>
        <h2 id={titleId} className={styles.dialogTitle}>
          Nu ai conectat încă un curier.
        </h2>
        <div id={descId} className={styles.text}>
          <span>Poți continua și trimite coletul pe cont propriu.</span>
          <span className={styles.muted}>Poți conecta ulterior un curier din Setări → Livrare și retururi.</span>
        </div>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        <div className={styles.dialogActions}>
          <Link ref={firstRef} className={styles.secondaryBtn} to={settingsUrl}>
            <Settings2 size={16} aria-hidden="true" /> Conectează curier
          </Link>
          <button type="button" className={styles.primaryBtn} onClick={onContinue} disabled={busy} aria-busy={busy}>
            {busy && <Loader2 size={16} className={styles.spin} />}
            Continuă fără integrare
          </button>
        </div>
      </div>
    </div>
  );
}

// dialogul apare cel mult o dată pe sesiune; persistent doar „Continuă fără integrare”
let courierPromptShownThisSession = false;

function SectionShell({ title = "Curier / Livrare", badge = null, children }) {
  return (
    <section className={styles.section} aria-label="Curier și livrare">
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

  // integrarea automată indisponibilă: niciun apel de curierat; fluxul manual activ,
  // acțiunile automate vizibile dar dezactivate (greyed out, fără request)
  if (!COURIER_AUTOMATION_ENABLED) {
    if (!canShipManually({ shipment, orderStatus }) || !orderId) return null;
    return (
      <SectionShell title="Livrare">
        <div className={styles.text}>
          <strong>Trimite coletul cu curierul tău</strong>
          <span className={styles.muted}>
            Expediezi pe cont propriu și marchezi aici comanda ca expediată, cu AWB-ul și linkul de urmărire, dacă le
            ai.
          </span>
        </div>
        <ManualShipEntry visibility="primary" orderId={orderId} canProcess={canProcess} onDone={onChanged} />

        <div className={styles.automationUnavailable}>
          <span className={styles.muted} role="status">
            {COURIER_AUTOMATION_SOON_MESSAGE} {COURIER_MANUAL_SHIPPING_MESSAGE}
          </span>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.secondaryBtn} ${styles.unavailableBtn}`}
              disabled
              aria-disabled="true"
              title={COURIER_AUTOMATION_SOON_MESSAGE}
            >
              <Truck size={16} aria-hidden="true" /> Generează AWB
            </button>
            <button
              type="button"
              className={`${styles.secondaryBtn} ${styles.unavailableBtn}`}
              disabled
              aria-disabled="true"
              title={COURIER_AUTOMATION_SOON_MESSAGE}
            >
              <Settings2 size={16} aria-hidden="true" /> Conectează curier
            </button>
          </div>
        </div>
      </SectionShell>
    );
  }

  return <AwbPanelInner {...props} />;
}

function AwbPanelInner({ shipment, orderStatus, orderId, canProcess = true, onChanged }) {
  const settingsUrl = useCouriersSettingsUrl();
  const [data, setData] = useState({ accounts: null, pickupAddresses: null, awbStatus: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [preference, setPreference] = useState(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptError, setPromptError] = useState("");

  const shipmentId = shipment?.id;

  // preferința „Continuă fără integrare” (eșec -> fără dialog, nimic blocat)
  useEffect(() => {
    let alive = true;
    api("/api/vendor/shipping-preferences")
      .then((res) => alive && setPreference(res || null))
      .catch(() => alive && setPreference(null));
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!shipmentId) return;
    setLoading(true);
    const [acc, addr, status] = await Promise.allSettled([
      api("/api/vendor/couriers/accounts"),
      api("/api/vendor/pickup-addresses"),
      api(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/awb`),
    ]);
    const failures = [acc, addr, status].filter((r) => r.status === "rejected").map((r) => r.reason);
    const disabled = failures.find((e) => errorCode(e) === "courier_integration_disabled");

    setData({
      accounts: acc.status === "fulfilled" && Array.isArray(acc.value?.items) ? acc.value.items : null,
      pickupAddresses: addr.status === "fulfilled" && Array.isArray(addr.value?.items) ? addr.value.items : null,
      awbStatus: status.status === "fulfilled" ? status.value : null,
    });
    setLoadError(
      disabled
        ? { code: "courier_integration_disabled" }
        : acc.status === "rejected" || addr.status === "rejected"
          ? { code: "load_failed" }
          : null
    );
    setLoading(false);
  }, [shipmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const state = decideAwbPanelState({
    shipment,
    orderStatus,
    accounts: data.accounts,
    pickupAddresses: data.pickupAddresses,
    loading,
    loadError,
    awbStatus: data.awbStatus,
  });

  const manualVis = orderId ? manualShipVisibility({ shipment, orderStatus, panelState: state }) : null;
  const showPrompt = shouldShowCourierPrompt({
    panelState: state,
    preference,
    sessionShown: courierPromptShownThisSession,
    manualAvailable: !!manualVis,
  });

  // „Nu ai conectat încă un curier” - o singură dată (vezi shouldShowCourierPrompt)
  useEffect(() => {
    if (!showPrompt) return;
    courierPromptShownThisSession = true;
    setPromptOpen(true);
  }, [showPrompt]);

  const closePrompt = useCallback(() => {
    setPromptOpen(false);
    setPromptError("");
  }, []);

  const continueWithoutIntegration = async () => {
    if (promptBusy) return;
    setPromptBusy(true);
    setPromptError("");
    try {
      const res = await api("/api/vendor/shipping-preferences/courier-prompt/dismiss", { method: "POST" });
      setPreference(res || { courierPromptDismissed: true });
      setPromptOpen(false);
    } catch (e) {
      setPromptError(apiErrorMessage(e, "Nu am putut salva alegerea. Încearcă din nou."));
    } finally {
      setPromptBusy(false);
    }
  };

  if (!shipmentId || state === "hidden") return null;

  const badgeStatus =
    state === "created" ? "CREATED" : state === "unknown" ? "UNKNOWN" : state === "requested" ? "REQUESTED" : null;

  const afterChange = async () => {
    await load();
    onChanged?.();
  };

  return (
    <section className={styles.section} aria-label="Curier și livrare">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          <Truck size={18} />
        </span>
        <h3 className={styles.title}>Curier / Livrare</h3>
        {badgeStatus && <StatusBadge status={badgeStatus} />}
      </div>

      {state === "loading" && (
        <div className={styles.loading} role="status">
          <Loader2 size={18} className={styles.spin} /> Se încarcă…
        </div>
      )}

      {state === "disabled" && (
        <div className={styles.text}>
          <strong>În curs de activare</strong>
          <span className={styles.muted}>Generarea AWB direct din Artfest va fi disponibilă în curând.</span>
        </div>
      )}

      {state === "error" && (
        <div className={styles.error} role="alert">
          Nu am putut încărca datele de curier.{" "}
          <button type="button" className={styles.linkBtn} onClick={load}>
            Reîncearcă
          </button>
        </div>
      )}

      {state === "connect" && (
        <>
          <div className={styles.text}>
            <strong>Niciun curier conectat</strong>
            <span className={styles.muted}>
              Poți trimite coletul pe cont propriu și îl marchezi aici ca expediat, sau conectezi contul de curier ca
              să generezi AWB-uri direct din Artfest.
            </span>
          </div>
          {!manualVis && (
            <div className={styles.actions}>
              <SettingsLink label="Conectează un curier" />
            </div>
          )}
        </>
      )}

      {state === "reconnect" && (
        <SetupCta
          title="Contul de curier nu este activ"
          text="Datele de conectare au fost respinse de curier sau contul e dezactivat. Reintrodu credentialele în Setări."
          linkLabel="Reconectează contul de curier"
        />
      )}

      {state === "setup_pickup" && (
        <SetupCta
          title="Lipsește adresa de ridicare"
          text="Adaugă adresa de unde curierul ridică coletul."
          linkLabel="Configurează punctul de ridicare"
        />
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

      {state === "unknown" && (
        <div className={`${styles.notice} ${styles.notice_warning}`} role="status">
          <strong>Curierul nu a confirmat AWB-ul</strong>
          <span>
            Nu știm încă dacă AWB-ul a fost creat la curier. Ca să evităm un AWB dublu, generarea e blocată până
            când echipa Artfest verifică la curier. Nu crea AWB-ul manual în contul curierului; dacă durează,
            contactează suportul Artfest.
          </span>
          <button type="button" className={styles.linkBtn} onClick={load}>
            <RefreshCcw size={14} /> Reîmprospătează
          </button>
        </div>
      )}

      {state === "created" && (
        <CreatedView
          shipment={shipment}
          awbStatus={data.awbStatus}
          orderStatus={orderStatus}
          onChanged={onChanged}
          reload={load}
        />
      )}

      {state === "ready" && (
        <AwbForm
          key={data.awbStatus?.latest?.id || "new"}
          shipmentId={shipmentId}
          notice={lastAttemptNotice(data.awbStatus)}
          onCreated={afterChange}
        />
      )}

      {/* „Trimite fără integrare”: clar fără curier utilizabil, discret lângă „Generează AWB” */}
      <ManualShipEntry
        visibility={manualVis}
        orderId={orderId}
        canProcess={canProcess}
        onDone={onChanged}
        secondary={state === "reconnect" || state === "setup_pickup"}
      />

      {state === "connect" && manualVis && (
        <Link className={styles.linkBtn} to={settingsUrl}>
          <Settings2 size={14} aria-hidden="true" /> Conectează un curier
        </Link>
      )}

      {promptOpen && (
        <CourierPromptDialog
          onContinue={continueWithoutIntegration}
          onClose={closePrompt}
          busy={promptBusy}
          error={promptError}
        />
      )}
    </section>
  );
}
