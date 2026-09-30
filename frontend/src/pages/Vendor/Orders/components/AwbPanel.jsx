// src/pages/Vendor/Orders/components/AwbPanel.jsx
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-toastify";
import { Truck, FileDown, Loader2, X, AlertTriangle, RefreshCcw } from "lucide-react";
import { api, buildApiUrl } from "../../../../lib/api";
import { apiErrorMessage } from "../../Settings/couriers/courierSettingsLogic.js";
import CourierConnectCta from "./CourierConnectCta.jsx";
import { VENDOR_COURIERS_ENABLED } from "../../../../config/features.js";
import {
  decideAwbPanelState,
  isArtfestLabel,
  initialAwbForm,
  buildAwbRequestBody,
  validateAwbForm,
  remainingBlockers,
  canSubmitAwb,
  newIdempotencyKey,
  shouldKeepIdempotencyKey,
  formatMoneyRon,
} from "../utils/awbPanelLogic.js";
import styles from "./AwbPanel.module.css";

/*
 * Panoul AWB din detaliul comenzii (per Shipment):
 *  - fără cont de curier activ -> CTA „Conectează un curier” (existent);
 *  - cont activ, fără AWB      -> „Generează AWB” (modal: preview -> confirmare);
 *  - AWB existent              -> număr AWB + „Descarcă eticheta”.
 * COD e calculat de backend și afișat read-only. Nu include tracking /
 * pickup / retur / tarife.
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

function Modal({ title, onClose, busy, children, footer }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className={styles.modalHead}>
          <h3 id={titleId} className={styles.modalTitle}>
            {title}
          </h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} disabled={busy} aria-label="Închide">
            <X size={18} />
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
        {footer && <div className={styles.modalFoot}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
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

function AwbModal({ shipmentId, onClose, onCreated }) {
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
  const blockers = remainingBlockers(serverBlockers || preview?.blockers, { inputsTouched });
  const canSubmit = !!preview && !loadingPreview && canSubmitAwb({
    blockers: serverBlockers || preview?.blockers,
    inputsTouched,
    formErrors,
    submitting,
  });

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
      if (e?.data?.error === "awb_status_unknown" || e?.data?.error === "awb_saved_partially") {
        onCreated(null); // reîncarcă pagina: panoul arată starea „în verificare”
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const services = preview?.services || [];
  const accounts = (preview?.accounts || []).filter((a) => a.status === "ACTIVE");

  return (
    <Modal
      title="Generează AWB"
      onClose={onClose}
      busy={submitting}
      footer={
        <>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={submitting}>
            Renunță
          </button>
          <button type="button" className={styles.primaryBtn} onClick={submit} disabled={!canSubmit} aria-busy={submitting}>
            {submitting && <Loader2 size={16} className={styles.spin} />}
            {submitting ? "Se generează…" : "Generează AWB"}
          </button>
        </>
      }
    >
      {loadingPreview && !preview && (
        <div className={styles.loading} role="status">
          <Loader2 size={18} className={styles.spin} /> Verificăm datele comenzii…
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
        <div className={styles.body}>
          <Blockers items={blockers} />

          <section className={styles.grid}>
            <div className={styles.block}>
              <div className={styles.blockTitle}>Destinatar</div>
              <div>{preview.recipient?.name || "—"}</div>
              <div className={styles.muted}>{preview.recipient?.phone || "—"}</div>
              <div className={styles.muted}>{preview.deliveryAddress || "—"}</div>
              {preview.method === "LOCKER" && <div className={styles.muted}>Livrare la locker {preview.lockerId}</div>}
            </div>
            <div className={styles.block}>
              <div className={styles.blockTitle}>Expeditor</div>
              {preview.sender ? (
                <>
                  <div>{preview.sender.contactName}</div>
                  <div className={styles.muted}>
                    {[preview.sender.street, preview.sender.streetNo].filter(Boolean).join(" ")}, {preview.sender.city},{" "}
                    {preview.sender.county}
                  </div>
                </>
              ) : (
                <div className={styles.muted}>—</div>
              )}
            </div>
            <div className={styles.block}>
              <div className={styles.blockTitle}>Curier</div>
              <div>{preview.courier?.label || "—"}</div>
              <div className={styles.muted}>Comanda {preview.orderNumber}</div>
            </div>
            <div className={styles.block}>
              <div className={styles.blockTitle}>Ramburs (COD)</div>
              {/* read-only: calculat de server din comandă */}
              <output className={styles.cod} aria-label="Sumă ramburs, calculată automat">
                {formatMoneyRon(preview.codAmount)}
              </output>
              <div className={styles.muted}>
                {preview.paymentMethod === "COD" ? "Calculat automat din comandă" : "Comandă plătită online"}
              </div>
            </div>
          </section>

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
              <label className={styles.field} htmlFor={`${idPrefix}-p`}>
                <span>Colete</span>
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
            </div>

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
          </fieldset>

          {submitError && (
            <div className={styles.error} role="alert">
              {submitError}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function stripEmpty(form) {
  const out = {};
  for (const [k, v] of Object.entries(form || {})) if (v !== "" && v != null) out[k] = v;
  return out;
}

// flag oprit => fără „Generează AWB” / „Descarcă eticheta” și fără apeluri API (config/features.js)
export default function AwbPanel(props) {
  if (!VENDOR_COURIERS_ENABLED) return null;
  return <AwbPanelInner {...props} />;
}

function AwbPanelInner({ shipment, orderStatus, onChanged }) {
  const [accounts, setAccounts] = useState(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState(false);
  const [activeStatus, setActiveStatus] = useState(null);
  const [latestError, setLatestError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const shipmentId = shipment?.id;

  const loadState = useCallback(async () => {
    if (!shipmentId) return;
    setAccountsLoading(true);
    setAccountsError(false);
    try {
      const [acc, status] = await Promise.all([
        api("/api/vendor/couriers/accounts"),
        api(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/awb`).catch(() => null),
      ]);
      setAccounts(Array.isArray(acc?.items) ? acc.items : []);
      setActiveStatus(status?.active || null);
      setLatestError(status?.active === "UNKNOWN" ? status?.latest?.errorMessage || "" : "");
    } catch {
      setAccountsError(true);
    } finally {
      setAccountsLoading(false);
    }
  }, [shipmentId]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  if (!shipmentId) return null;

  const state = decideAwbPanelState({
    shipment,
    orderStatus,
    accounts,
    accountsLoading,
    accountsError,
    activeStatus,
  });

  const onDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadLabel(shipmentId, shipment.awb);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Nu am putut descărca eticheta."));
    } finally {
      setDownloading(false);
    }
  };

  if (state === "hidden" || state === "loading") return null;
  if (state === "connect") return <CourierConnectCta variant="compact" />;

  return (
    <section className={styles.panel} aria-label="AWB">
      <span className={styles.icon} aria-hidden="true">
        <Truck size={20} />
      </span>

      {state === "created" && (
        <>
          <div className={styles.text}>
            <strong>AWB {shipment.awb}</strong>
            <span className={styles.muted}>
              {[shipment.courierProvider === "SAMEDAY" ? "Sameday" : shipment.courierProvider, shipment.courierService]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          {isArtfestLabel(shipment) && (
            <button type="button" className={styles.primaryBtn} onClick={onDownload} disabled={downloading}>
              {downloading ? <Loader2 size={16} className={styles.spin} /> : <FileDown size={16} />}
              Descarcă eticheta
            </button>
          )}
        </>
      )}

      {state === "pending" && (
        <div className={styles.text}>
          <strong>{activeStatus === "REQUESTED" ? "AWB în curs de generare" : "Verificăm AWB-ul la curier"}</strong>
          <span className={styles.muted}>
            {latestError ||
              "Curierul nu a confirmat încă rezultatul. Nu genera din nou; revino peste câteva minute."}
          </span>
          <button type="button" className={styles.linkBtn} onClick={loadState}>
            <RefreshCcw size={14} /> Reîmprospătează
          </button>
        </div>
      )}

      {state === "generate" && (
        <>
          <div className={styles.text}>
            <strong>Curier</strong>
            <span className={styles.muted}>Generează AWB-ul direct din Artfest, cu contul tău de curier.</span>
          </div>
          <button type="button" className={styles.primaryBtn} onClick={() => setModalOpen(true)}>
            <Truck size={16} /> Generează AWB
          </button>
        </>
      )}

      {modalOpen && (
        <AwbModal
          shipmentId={shipmentId}
          onClose={() => setModalOpen(false)}
          onCreated={async () => {
            setModalOpen(false);
            await loadState();
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}
