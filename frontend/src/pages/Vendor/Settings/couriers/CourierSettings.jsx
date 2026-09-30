// src/pages/Vendor/Settings/couriers/CourierSettings.jsx
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import {
  Truck,
  MapPin,
  Plus,
  Loader2,
  PlugZap,
  Pencil,
  Star,
  Unplug,
  Trash2,
  X,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
} from "lucide-react";
import { api } from "../../../../lib/api";
import settingsStyles from "../Settings.module.css";
import styles from "./CourierSettings.module.css";
import { VENDOR_COURIERS_ENABLED } from "../../../../config/features.js";
import {
  COURIERS_ANCHOR_ID,
  isCouriersHash,
  accountStatusMeta,
  formatDateTime,
  buildInitialCourierForm,
  validateCourierForm,
  buildCreatePayload,
  buildUpdatePayload,
  mapBackendFieldErrors,
  apiErrorMessage,
  PICKUP_ADDRESS_FIELDS,
  emptyPickupAddressForm,
  validatePickupAddressForm,
  buildPickupAddressPayload,
  formatPickupAddress,
} from "./courierSettingsLogic.js";

/*
 * Setări > Livrare și retururi: "Curieri conectați" + "Adrese de ridicare".
 * Folosește DOAR API-ul existent (/api/vendor/couriers/*,
 * /api/vendor/pickup-addresses/*). Formularul de conectare e generat din
 * schema providerului întoarsă de backend. Nu include AWB / tracking /
 * pickup API / tarife.
 */

const CAPABILITY_LABELS = {
  testConnection: "Test conexiune",
  createShipment: "Generare AWB",
  label: "Etichete",
  tracking: "Urmărire colet",
  cancelShipment: "Anulare AWB",
  pickupRequest: "Comandă ridicare",
  pickupPoints: "Puncte de ridicare",
  lockers: "Lockere",
  cashOnDelivery: "Ramburs",
  quote: "Tarife",
  webhooks: "Actualizări automate",
};

function SectionCard({ icon, title, subtitle, right, children }) {
  return (
    <section className={settingsStyles.card}>
      <header className={`${settingsStyles.cardHead} ${styles.sectionHead}`}>
        <div className={settingsStyles.cardTitle}>
          {icon}
          <div>
            <div className={settingsStyles.title}>{title}</div>
            {subtitle && <div className={settingsStyles.subtitle}>{subtitle}</div>}
          </div>
        </div>
        {right && <div className={styles.sectionActions}>{right}</div>}
      </header>
      <div className={settingsStyles.cardBody}>{children}</div>
    </section>
  );
}

/* ===== Modal accesibil, mobile-friendly (bottom sheet pe ecrane mici) ===== */
function Modal({ title, onClose, busy = false, children, footer, size = "md" }) {
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // focus pe primul câmp / buton din modal
    const first = panelRef.current?.querySelector(
      "input, select, textarea, button:not([data-close])"
    );
    first?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`${styles.modal} ${size === "sm" ? styles.modalSm : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.modalHead}>
          <h3 id={titleId} className={styles.modalTitle}>
            {title}
          </h3>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            disabled={busy}
            aria-label="Închide"
            data-close
          >
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

function ConfirmModal({ title, children, confirmLabel, onConfirm, onClose, busy, error }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      size="sm"
      footer={
        <>
          <button type="button" className={styles.ghostBtn} onClick={onClose} disabled={busy}>
            Renunță
          </button>
          <button type="button" className={styles.dangerBtn} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={16} className={settingsStyles.spin} /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className={styles.confirmText}>{children}</div>
      {error && (
        <div className={settingsStyles.error} role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}

function StatusBadge({ status }) {
  const meta = accountStatusMeta(status);
  return <span className={`${styles.badge} ${styles[`tone_${meta.tone}`]}`}>{meta.label}</span>;
}

/* ===== Câmp generat din schema providerului ===== */
function SchemaField({ field, value, onChange, error, idPrefix, secretMode }) {
  const [reveal, setReveal] = useState(false);
  const inputId = `${idPrefix}-${field.key}`;
  const errorId = `${inputId}-err`;

  if (field.type === "select") {
    return (
      <label className={settingsStyles.field} htmlFor={inputId}>
        <span>
          {field.label}
          {field.required ? " *" : ""}
        </span>
        <select
          id={inputId}
          className={settingsStyles.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        >
          {!field.required && <option value="">—</option>}
          {(field.options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {error && (
          <span id={errorId} className={styles.fieldError}>
            {error}
          </span>
        )}
      </label>
    );
  }

  const isPassword = field.type === "password";
  return (
    <label className={settingsStyles.field} htmlFor={inputId}>
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      <div className={styles.inputWrap}>
        <input
          id={inputId}
          name={`courier-${field.key}`}
          className={settingsStyles.input}
          type={isPassword && !reveal ? "password" : "text"}
          value={value}
          maxLength={field.maxLength || 256}
          onChange={(e) => onChange(e.target.value)}
          // credentialele curierului NU sunt parola Artfest - fără autofill
          autoComplete={secretMode ? (isPassword ? "new-password" : "off") : "off"}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : field.help ? `${inputId}-help` : undefined}
        />
        {isPassword && (
          <button
            type="button"
            className={styles.revealBtn}
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? "Ascunde" : "Arată"}
          >
            {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      {field.help && !error && (
        <span id={`${inputId}-help`} className={settingsStyles.subtitle}>
          {field.help}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.fieldError}>
          {error}
        </span>
      )}
    </label>
  );
}

/* ===== Formular conectare / editare cont ===== */
function CourierAccountForm({ provider, account, addresses, onSaved, onCancel, onBack }) {
  const isEdit = !!account;
  const idPrefix = useId();
  const [form, setForm] = useState(() => buildInitialCourierForm(provider, account));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);

  const enabledCapabilities = Object.entries(provider?.capabilities || {})
    .filter(([, on]) => on)
    .map(([key]) => CAPABILITY_LABELS[key] || key);

  const setCredential = (key, value) => {
    setForm((f) => ({ ...f, credentials: { ...f.credentials, [key]: value } }));
    setErrors((e) => ({ ...e, [`credentials.${key}`]: undefined }));
  };
  const setConfig = (key, value) => {
    setForm((f) => ({ ...f, publicConfig: { ...f.publicConfig, [key]: value } }));
    setErrors((e) => ({ ...e, [`publicConfig.${key}`]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const localErrors = validateCourierForm(provider, form);
    setErrors(localErrors);
    setFormError("");
    if (Object.keys(localErrors).length) return;

    try {
      setBusy(true);
      if (isEdit) {
        const payload = buildUpdatePayload(provider, form, account);
        if (!Object.keys(payload).length) {
          onCancel();
          return;
        }
        await api(`/api/vendor/couriers/accounts/${encodeURIComponent(account.id)}`, {
          method: "PATCH",
          body: payload,
        });
        onSaved("Contul de curier a fost actualizat.");
      } else {
        const res = await api("/api/vendor/couriers/accounts", {
          method: "POST",
          body: buildCreatePayload(provider, form),
        });
        const points = res?.details?.pickupPoints?.length || 0;
        onSaved(
          `${provider.name} a fost conectat.${
            points ? ` Am găsit ${points} ${points === 1 ? "punct" : "puncte"} de ridicare în contul tău.` : ""
          }`
        );
      }
    } catch (err) {
      // mesaj sanitizat de backend; valorile formularului rămân
      const message = apiErrorMessage(err, "Nu am putut salva contul. Încearcă din nou.");
      setFormError(message);
      const fields = Array.isArray(err?.data?.fields) ? err.data.fields : [];
      if (fields.length) setErrors((prev) => ({ ...prev, ...mapBackendFieldErrors(provider, fields, message) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={styles.form} noValidate autoComplete="off">
      {!isEdit && onBack && (
        <button type="button" className={styles.backBtn} onClick={onBack} disabled={busy}>
          <ChevronLeft size={16} /> Alege alt curier
        </button>
      )}

      <div className={styles.providerHeader}>
        <Truck size={18} />
        <strong>{provider.name}</strong>
      </div>
      {/* descrierea vine din metadata providerului (backend), dacă există */}
      {provider.description && <p className={styles.hint}>{provider.description}</p>}

      {enabledCapabilities.length > 0 && (
        <div className={styles.capabilities} aria-label="Funcții disponibile acum">
          {enabledCapabilities.map((c) => (
            <span key={c} className={styles.chip}>
              {c}
            </span>
          ))}
        </div>
      )}
      {!provider?.capabilities?.createShipment && (
        <p className={styles.hint}>
          Momentan conectăm și verificăm contul. Generarea AWB-urilor din Artfest va fi disponibilă
          într-o etapă următoare.
        </p>
      )}

      <label className={settingsStyles.field} htmlFor={`${idPrefix}-label`}>
        <span>Nume cont *</span>
        <input
          id={`${idPrefix}-label`}
          className={settingsStyles.input}
          value={form.label}
          maxLength={160}
          onChange={(e) => {
            setForm((f) => ({ ...f, label: e.target.value }));
            setErrors((x) => ({ ...x, label: undefined }));
          }}
          placeholder={`Ex: ${provider.name} – atelier principal`}
          aria-invalid={!!errors.label}
        />
        {errors.label && <span className={styles.fieldError}>{errors.label}</span>}
      </label>

      <fieldset className={styles.fieldset}>
        <legend>Date de autentificare</legend>

        {isEdit && (
          <div className={styles.savedCreds}>
            <CheckCircle2 size={16} />
            <span>
              Credentiale salvate: <strong>{account.hasCredentials ? "da" : "nu"}</strong>
              {account.credentialsHint ? ` · ${account.credentialsHint}` : ""}
            </span>
          </div>
        )}

        {isEdit && !form.replaceCredentials ? (
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => setForm((f) => ({ ...f, replaceCredentials: true }))}
          >
            Înlocuiește credentialele
          </button>
        ) : (
          <>
            {isEdit && (
              <p className={styles.hint}>
                Introdu noile credentiale. Le testăm cu {provider.name} înainte de salvare; cele
                vechi rămân active dacă testul nu reușește.
              </p>
            )}
            <div className={settingsStyles.grid2}>
              {(provider.credentialFields || []).map((field) => (
                <SchemaField
                  key={field.key}
                  field={field}
                  value={form.credentials[field.key] ?? ""}
                  onChange={(v) => setCredential(field.key, v)}
                  error={errors[`credentials.${field.key}`]}
                  idPrefix={`${idPrefix}-cred`}
                  secretMode
                />
              ))}
            </div>
            {isEdit && (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    replaceCredentials: false,
                    credentials: buildInitialCourierForm(provider).credentials,
                  }))
                }
              >
                Păstrează credentialele actuale
              </button>
            )}
          </>
        )}
      </fieldset>

      {(provider.publicConfigFields || []).length > 0 && (
        <div className={settingsStyles.grid2}>
          {provider.publicConfigFields.map((field) => (
            <SchemaField
              key={field.key}
              field={field}
              value={form.publicConfig[field.key] ?? ""}
              onChange={(v) => setConfig(field.key, v)}
              error={errors[`publicConfig.${field.key}`]}
              idPrefix={`${idPrefix}-cfg`}
            />
          ))}
        </div>
      )}

      <label className={settingsStyles.field} htmlFor={`${idPrefix}-pickup`}>
        <span>Adresă de ridicare</span>
        <select
          id={`${idPrefix}-pickup`}
          className={settingsStyles.input}
          value={form.pickupAddressId}
          onChange={(e) => {
            setForm((f) => ({ ...f, pickupAddressId: e.target.value }));
            setErrors((x) => ({ ...x, pickupAddressId: undefined }));
          }}
        >
          <option value="">{addresses.length ? "Adresa implicită" : "Nicio adresă salvată"}</option>
          {addresses.map((a) => (
            <option key={a.id} value={a.id}>
              {[a.contactName, a.city, a.street && `${a.street} ${a.streetNo}`].filter(Boolean).join(" · ")}
              {a.isDefault ? " (implicită)" : ""}
            </option>
          ))}
        </select>
        {errors.pickupAddressId && <span className={styles.fieldError}>{errors.pickupAddressId}</span>}
      </label>

      {formError && (
        <div className={settingsStyles.error} role="alert">
          {formError}
        </div>
      )}

      <div className={styles.formFoot}>
        <button type="button" className={styles.ghostBtn} onClick={onCancel} disabled={busy}>
          Renunță
        </button>
        <button type="submit" className={settingsStyles.primary} disabled={busy}>
          {busy && <Loader2 size={16} className={settingsStyles.spin} />}
          {busy
            ? "Se testează conexiunea…"
            : isEdit
            ? form.replaceCredentials
              ? "Testează și salvează"
              : "Salvează"
            : "Testează și conectează"}
        </button>
      </div>
    </form>
  );
}

/* ===== Formular adresă de ridicare ===== */
function PickupAddressForm({ address, onSaved, onCancel }) {
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

    try {
      setBusy(true);
      const body = buildPickupAddressPayload(form);
      if (address) {
        await api(`/api/vendor/pickup-addresses/${encodeURIComponent(address.id)}`, {
          method: "PATCH",
          body,
        });
      } else {
        await api("/api/vendor/pickup-addresses", {
          method: "POST",
          body: { ...body, ...(form.isDefault ? { isDefault: true } : {}) },
        });
      }
      onSaved(address ? "Adresa a fost actualizată." : "Adresa de ridicare a fost adăugată.");
    } catch (err) {
      const message = apiErrorMessage(err, "Nu am putut salva adresa. Încearcă din nou.");
      setFormError(message);
      const fields = Array.isArray(err?.data?.fields) ? err.data.fields : [];
      if (fields.length) {
        setErrors((prev) => ({
          ...prev,
          ...Object.fromEntries(fields.map((k) => [k, "Verifică acest câmp."])),
        }));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      <div className={settingsStyles.grid2}>
        {PICKUP_ADDRESS_FIELDS.map((f) => (
          <label
            key={f.key}
            className={`${settingsStyles.field} ${f.key === "details" ? styles.spanAll : ""}`}
            htmlFor={`${idPrefix}-${f.key}`}
          >
            <span>
              {f.label}
              {f.required ? " *" : ""}
            </span>
            <input
              id={`${idPrefix}-${f.key}`}
              className={settingsStyles.input}
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

      {!address && (
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => setForm((x) => ({ ...x, isDefault: e.target.checked }))}
          />
          <span>Setează ca adresă implicită</span>
        </label>
      )}

      {formError && (
        <div className={settingsStyles.error} role="alert">
          {formError}
        </div>
      )}

      <div className={styles.formFoot}>
        <button type="button" className={styles.ghostBtn} onClick={onCancel} disabled={busy}>
          Renunță
        </button>
        <button type="submit" className={settingsStyles.primary} disabled={busy}>
          {busy && <Loader2 size={16} className={settingsStyles.spin} />}
          {busy ? "Se salvează…" : address ? "Salvează adresa" : "Adaugă adresa"}
        </button>
      </div>
    </form>
  );
}

/* ===== Pagina ===== */
/*
 * Flag oprit (config/features.js): chiar și cu acces direct pe
 * /setari?tab=shipping#couriers, secțiunea NU permite nicio acțiune și nu
 * face niciun apel API - doar un mesaj discret. Ancora rămâne pentru
 * linkurile vechi.
 */
export default function CourierSettings() {
  if (!VENDOR_COURIERS_ENABLED) {
    return (
      <div id={COURIERS_ANCHOR_ID} className={styles.anchor}>
        <SectionCard icon={<PlugZap size={18} />} title="Curieri conectați">
          <p className={styles.hint}>Funcție disponibilă în curând.</p>
        </SectionCard>
      </div>
    );
  }
  return <CourierSettingsInner />;
}

function CourierSettingsInner() {
  const [providers, setProviders] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // modale
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectProvider, setConnectProvider] = useState(null);
  const [editAccount, setEditAccount] = useState(null);
  const [disconnectAccount, setDisconnectAccount] = useState(null);
  const [addressModal, setAddressModal] = useState(null); // { address|null }
  const [deleteAddress, setDeleteAddress] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  // acțiuni per rând (anti dublu-click)
  const [busyAction, setBusyAction] = useState({}); // { [key]: true }
  const [rowErrors, setRowErrors] = useState({}); // { [accountId|addressId]: message }

  const providerById = useMemo(
    () => Object.fromEntries(providers.map((p) => [p.id, p])),
    [providers]
  );

  const loadAll = useCallback(async () => {
    setLoadError("");
    try {
      const [p, a, ad] = await Promise.all([
        api("/api/vendor/couriers/providers"),
        api("/api/vendor/couriers/accounts"),
        api("/api/vendor/pickup-addresses"),
      ]);
      setProviders(Array.isArray(p?.items) ? p.items : []);
      setAccounts(Array.isArray(a?.items) ? a.items : []);
      setAddresses(Array.isArray(ad?.items) ? ad.items : []);
    } catch (e) {
      setLoadError(apiErrorMessage(e, "Nu am putut încărca curierii și adresele de ridicare."));
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadAccounts = useCallback(async () => {
    const a = await api("/api/vendor/couriers/accounts");
    setAccounts(Array.isArray(a?.items) ? a.items : []);
  }, []);

  const reloadAddresses = useCallback(async () => {
    const ad = await api("/api/vendor/pickup-addresses");
    setAddresses(Array.isArray(ad?.items) ? ad.items : []);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /*
   * Link direct /setari?tab=shipping#couriers (meniu „Curieri”, CTA din
   * Comenzi): scroll la secțiune după încărcare + highlight discret ~1.8s.
   * Al doilea scroll acoperă setările de transport de deasupra, care se
   * încarcă în paralel și pot împinge secțiunea mai jos.
   */
  const location = useLocation();
  const anchorRef = useRef(null);
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    if (loading || !isCouriersHash(location.hash)) return undefined;
    const el = anchorRef.current;
    if (!el) return undefined;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const scroll = () =>
      el.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });

    scroll();
    const again = setTimeout(scroll, 400);
    setHighlight(true);
    const off = setTimeout(() => setHighlight(false), 1800);

    return () => {
      clearTimeout(again);
      clearTimeout(off);
    };
  }, [loading, location.hash, location.key]);

  const anchorProps = {
    id: COURIERS_ANCHOR_ID,
    ref: anchorRef,
    className: `${styles.anchor} ${highlight ? styles.anchorHighlight : ""}`,
  };

  const runRowAction = async (key, rowId, fn) => {
    if (busyAction[key]) return;
    setBusyAction((b) => ({ ...b, [key]: true }));
    setRowErrors((r) => ({ ...r, [rowId]: undefined }));
    try {
      await fn();
    } catch (e) {
      setRowErrors((r) => ({ ...r, [rowId]: apiErrorMessage(e) }));
    } finally {
      setBusyAction((b) => {
        const next = { ...b };
        delete next[key];
        return next;
      });
    }
  };

  /* ----- acțiuni cont ----- */
  const testAccount = (account) =>
    runRowAction(`test:${account.id}`, account.id, async () => {
      const res = await api(
        `/api/vendor/couriers/accounts/${encodeURIComponent(account.id)}/test`,
        { method: "POST" }
      );
      if (res?.account) {
        setAccounts((list) => list.map((x) => (x.id === res.account.id ? res.account : x)));
      }
      if (res?.ok) toast.success("Conexiunea funcționează.");
      else {
        setRowErrors((r) => ({
          ...r,
          [account.id]: res?.error?.message || "Testul conexiunii a eșuat.",
        }));
      }
    });

  const makeDefault = (account) =>
    runRowAction(`default:${account.id}`, account.id, async () => {
      await api(`/api/vendor/couriers/accounts/${encodeURIComponent(account.id)}/default`, {
        method: "POST",
      });
      await reloadAccounts();
      toast.success(`„${account.label}” este acum contul implicit.`);
    });

  const confirmDisconnect = async () => {
    if (!disconnectAccount || confirmBusy) return;
    setConfirmBusy(true);
    setConfirmError("");
    try {
      await api(`/api/vendor/couriers/accounts/${encodeURIComponent(disconnectAccount.id)}`, {
        method: "DELETE",
      });
      setDisconnectAccount(null);
      await reloadAccounts();
      toast.success("Curierul a fost deconectat.");
    } catch (e) {
      setConfirmError(apiErrorMessage(e, "Nu am putut deconecta curierul."));
    } finally {
      setConfirmBusy(false);
    }
  };

  /* ----- acțiuni adrese ----- */
  const makeDefaultAddress = (address) =>
    runRowAction(`addr-default:${address.id}`, address.id, async () => {
      await api(`/api/vendor/pickup-addresses/${encodeURIComponent(address.id)}/default`, {
        method: "POST",
      });
      await reloadAddresses();
      toast.success("Adresa implicită a fost schimbată.");
    });

  const confirmDeleteAddress = async () => {
    if (!deleteAddress || confirmBusy) return;
    setConfirmBusy(true);
    setConfirmError("");
    try {
      await api(`/api/vendor/pickup-addresses/${encodeURIComponent(deleteAddress.id)}`, {
        method: "DELETE",
      });
      setDeleteAddress(null);
      // conturile legate de adresă rămân fără adresă (backend: SetNull)
      await Promise.all([reloadAddresses(), reloadAccounts()]);
      toast.success("Adresa a fost ștearsă.");
    } catch (e) {
      setConfirmError(apiErrorMessage(e, "Nu am putut șterge adresa."));
    } finally {
      setConfirmBusy(false);
    }
  };

  const openConnect = () => {
    setConnectProvider(providers.length === 1 ? providers[0] : null);
    setConnectOpen(true);
  };
  const closeConnect = () => {
    setConnectOpen(false);
    setConnectProvider(null);
  };

  if (loading) {
    return (
      <div {...anchorProps}>
        <div className={settingsStyles.loading}>
          <Loader2 className={settingsStyles.spin} size={18} /> Se încarcă curierii…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div {...anchorProps}>
      <SectionCard
        icon={<PlugZap size={18} />}
        title="Curieri conectați"
        right={
          <button type="button" className={settingsStyles.primary} onClick={loadAll}>
            Reîncearcă
          </button>
        }
      >
        <div className={settingsStyles.error} role="alert">
          {loadError}
        </div>
      </SectionCard>
      </div>
    );
  }

  const addressById = Object.fromEntries(addresses.map((a) => [a.id, a]));

  return (
    <div {...anchorProps}>
    <div className={settingsStyles.grid1}>
      {/* ===================== CURIERI ===================== */}
      <SectionCard
        icon={<PlugZap size={18} />}
        title="Curieri conectați"
        subtitle="Conectează contul tău de curier (contractul tău). Datele de autentificare sunt criptate și nu mai pot fi citite după salvare."
        right={
          accounts.length > 0 && providers.length > 0 ? (
            <button type="button" className={settingsStyles.primary} onClick={openConnect}>
              <Plus size={16} /> Conectează curier
            </button>
          ) : null
        }
      >
        {accounts.length === 0 ? (
          <div className={styles.empty}>
            <Truck size={28} aria-hidden="true" />
            <p className={styles.emptyTitle}>Nu ai niciun curier conectat.</p>
            {providers.length > 0 ? (
              <button type="button" className={settingsStyles.primary} onClick={openConnect}>
                <Plus size={16} /> Conectează primul curier
              </button>
            ) : (
              <p className={settingsStyles.subtitle}>Momentan nu există curieri disponibili pentru conectare.</p>
            )}
          </div>
        ) : (
          <ul className={styles.list}>
            {accounts.map((account) => {
              const provider = providerById[account.provider];
              const testing = !!busyAction[`test:${account.id}`];
              const settingDefault = !!busyAction[`default:${account.id}`];
              const pickup = account.pickupAddressId ? addressById[account.pickupAddressId] : null;
              const rowError = rowErrors[account.id];

              return (
                <li key={account.id} className={styles.item}>
                  <div className={styles.itemMain}>
                    <div className={styles.itemTitleRow}>
                      <span className={styles.providerName}>{provider?.name || account.provider}</span>
                      <StatusBadge status={account.status} />
                      {account.isDefault && (
                        <span className={`${styles.badge} ${styles.tone_primary}`}>
                          <Star size={12} aria-hidden="true" /> Implicit
                        </span>
                      )}
                    </div>
                    <div className={styles.itemLabel}>{account.label}</div>
                    <div className={styles.meta}>
                      {account.credentialsHint && <span>Utilizator: {account.credentialsHint}</span>}
                      <span>
                        {account.lastTestedAt
                          ? `Testat: ${formatDateTime(account.lastTestedAt)}${
                              account.lastTestOk === false ? " – eșuat" : ""
                            }`
                          : "Netestat"}
                      </span>
                      {pickup && <span>Ridicare: {pickup.city}, {pickup.street} {pickup.streetNo}</span>}
                    </div>
                    {account.lastTestOk === false && account.lastError && !rowError && (
                      <div className={styles.rowError}>
                        <AlertTriangle size={14} aria-hidden="true" /> {account.lastError}
                      </div>
                    )}
                    {rowError && (
                      <div className={styles.rowError} role="alert">
                        <AlertTriangle size={14} aria-hidden="true" /> {rowError}
                      </div>
                    )}
                  </div>

                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => testAccount(account)}
                      disabled={testing}
                      aria-busy={testing}
                    >
                      {testing ? <Loader2 size={15} className={settingsStyles.spin} /> : <PlugZap size={15} />}
                      {testing ? "Se testează…" : "Testează conexiunea"}
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => setEditAccount(account)}
                      disabled={!provider}
                      title={provider ? undefined : "Curier indisponibil momentan"}
                    >
                      <Pencil size={15} /> Editează
                    </button>
                    {!account.isDefault && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => makeDefault(account)}
                        disabled={settingDefault}
                      >
                        {settingDefault ? <Loader2 size={15} className={settingsStyles.spin} /> : <Star size={15} />}
                        Setează implicit
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionDanger}`}
                      onClick={() => {
                        setConfirmError("");
                        setDisconnectAccount(account);
                      }}
                    >
                      <Unplug size={15} /> Deconectează
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* ===================== ADRESE DE RIDICARE ===================== */}
      <SectionCard
        icon={<MapPin size={18} />}
        title="Adrese de ridicare"
        subtitle="Adresele de unde curierul ridică coletele. Folosim adresa implicită dacă nu alegi alta pentru un cont."
        right={
          addresses.length > 0 ? (
            <button
              type="button"
              className={settingsStyles.primary}
              onClick={() => setAddressModal({ address: null })}
            >
              <Plus size={16} /> Adaugă adresă
            </button>
          ) : null
        }
      >
        {addresses.length === 0 ? (
          <div className={styles.empty}>
            <MapPin size={28} aria-hidden="true" />
            <p className={styles.emptyTitle}>Adaugă adresa de unde va ridica curierul coletele.</p>
            <button
              type="button"
              className={settingsStyles.primary}
              onClick={() => setAddressModal({ address: null })}
            >
              <Plus size={16} /> Adaugă adresă
            </button>
          </div>
        ) : (
          <ul className={styles.list}>
            {addresses.map((a) => {
              const settingDefault = !!busyAction[`addr-default:${a.id}`];
              return (
                <li key={a.id} className={styles.item}>
                  <div className={styles.itemMain}>
                    <div className={styles.itemTitleRow}>
                      <span className={styles.providerName}>{a.contactName}</span>
                      {a.isDefault && (
                        <span className={`${styles.badge} ${styles.tone_primary}`}>
                          <Star size={12} aria-hidden="true" /> Implicită
                        </span>
                      )}
                    </div>
                    <div className={styles.itemLabel}>{formatPickupAddress(a)}</div>
                    <div className={styles.meta}>
                      <span>{a.phone}</span>
                      {a.email && <span>{a.email}</span>}
                    </div>
                    {rowErrors[a.id] && (
                      <div className={styles.rowError} role="alert">
                        <AlertTriangle size={14} aria-hidden="true" /> {rowErrors[a.id]}
                      </div>
                    )}
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => setAddressModal({ address: a })}
                    >
                      <Pencil size={15} /> Editează
                    </button>
                    {!a.isDefault && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => makeDefaultAddress(a)}
                        disabled={settingDefault}
                      >
                        {settingDefault ? <Loader2 size={15} className={settingsStyles.spin} /> : <Star size={15} />}
                        Setează implicită
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionDanger}`}
                      onClick={() => {
                        setConfirmError("");
                        setDeleteAddress(a);
                      }}
                    >
                      <Trash2 size={15} /> Șterge
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      {/* ===================== MODALE ===================== */}
      {connectOpen && (
        <Modal title="Conectează curier" onClose={closeConnect}>
          {!connectProvider ? (
            <div className={styles.providerPicker}>
              <p className={settingsStyles.subtitle}>Alege curierul cu care ai contract.</p>
              <div className={styles.providerGrid}>
                {providers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.providerCard}
                    onClick={() => setConnectProvider(p)}
                  >
                    <Truck size={20} aria-hidden="true" />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <CourierAccountForm
              key={connectProvider.id}
              provider={connectProvider}
              addresses={addresses}
              onBack={providers.length > 1 ? () => setConnectProvider(null) : undefined}
              onCancel={closeConnect}
              onSaved={async (message) => {
                closeConnect();
                toast.success(message);
                await reloadAccounts().catch(() => {});
              }}
            />
          )}
        </Modal>
      )}

      {editAccount && providerById[editAccount.provider] && (
        <Modal title="Editează contul de curier" onClose={() => setEditAccount(null)}>
          <CourierAccountForm
            provider={providerById[editAccount.provider]}
            account={editAccount}
            addresses={addresses}
            onCancel={() => setEditAccount(null)}
            onSaved={async (message) => {
              setEditAccount(null);
              toast.success(message);
              await reloadAccounts().catch(() => {});
            }}
          />
        </Modal>
      )}

      {disconnectAccount && (
        <ConfirmModal
          title="Sigur vrei să deconectezi acest curier?"
          confirmLabel="Deconectează"
          onConfirm={confirmDisconnect}
          onClose={() => !confirmBusy && setDisconnectAccount(null)}
          busy={confirmBusy}
          error={confirmError}
        >
          <p>
            <strong>{disconnectAccount.label}</strong> va fi deconectat, iar datele de autentificare
            salvate vor fi șterse.
          </p>
          <p>Comenzile și expedierile deja existente nu sunt șterse.</p>
        </ConfirmModal>
      )}

      {addressModal && (
        <Modal
          title={addressModal.address ? "Editează adresa de ridicare" : "Adaugă adresă de ridicare"}
          onClose={() => setAddressModal(null)}
        >
          <PickupAddressForm
            address={addressModal.address}
            onCancel={() => setAddressModal(null)}
            onSaved={async (message) => {
              setAddressModal(null);
              toast.success(message);
              await reloadAddresses().catch(() => {});
            }}
          />
        </Modal>
      )}

      {deleteAddress && (
        <ConfirmModal
          title="Ștergi adresa de ridicare?"
          confirmLabel="Șterge adresa"
          onConfirm={confirmDeleteAddress}
          onClose={() => !confirmBusy && setDeleteAddress(null)}
          busy={confirmBusy}
          error={confirmError}
        >
          <p>{formatPickupAddress(deleteAddress)}</p>
          <p>Conturile de curier care o foloseau vor rămâne fără o adresă aleasă explicit.</p>
        </ConfirmModal>
      )}
    </div>
    </div>
  );
}
