// src/pages/Vendor/Orders/components/RecipientAddressForm.jsx
//
// „Modifică adresa” destinatarului, în panoul Curier / Livrare, înainte de AWB.
// Salvează DOAR corectura pe expediere (PUT /api/vendor/shipments/:id/awb/recipient);
// comanda (Order.shippingAddress) rămâne neschimbată. Județul și localitatea din
// nomenclatorul Sameday când e disponibil (ca la checkout); altfel câmpuri text,
// rezolvate după nume la generarea AWB-ului.

import { useEffect, useId, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { api } from "../../../../lib/api";
import SamedayCityField from "../../../Checkout/delivery/SamedayCityField.jsx";
import { fetchCounties } from "../../../Checkout/delivery/deliveryApi.js";
import { apiErrorMessage } from "../../Settings/couriers/courierSettingsLogic.js";
import {
  RECIPIENT_FORM_FIELDS,
  emptyRecipientForm,
  recipientPayloadFromForm,
  validateRecipientForm,
} from "../utils/awbPanelLogic.js";
import styles from "./AwbPanel.module.css";

const fold = (v) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^judetul\s+/, "")
    .trim();

export default function RecipientAddressForm({ shipmentId, initial, expectedUpdatedAt, canReset, onSaved, onCancel }) {
  const idPrefix = useId();
  const [form, setForm] = useState(() => emptyRecipientForm(initial));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [counties, setCounties] = useState([]);
  const [nomenclator, setNomenclator] = useState("loading"); // loading | ok | off
  const [citiesAvailable, setCitiesAvailable] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchCounties()
      .then((items) => {
        if (!alive) return;
        setCounties(items);
        setNomenclator(items.length ? "ok" : "off");
        // județul precompletat doar ca text -> ID-ul din nomenclator (dacă se potrivește exact)
        if (items.length) {
          setForm((f) => {
            if (f.countyId || !f.county) return f;
            const match = items.find((c) => fold(c.name) === fold(f.county));
            return match ? { ...f, county: match.name, countyId: match.id } : f;
          });
        }
      })
      .catch(() => alive && setNomenclator("off"));
    return () => {
      alive = false;
    };
  }, []);

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  };

  const send = async (body) => {
    setBusy(true);
    setFormError("");
    try {
      await api(`/api/vendor/shipments/${encodeURIComponent(shipmentId)}/awb/recipient`, { method: "PUT", body });
      onSaved(body.reset ? "reset" : "saved");
    } catch (err) {
      setFormError(apiErrorMessage(err, "Nu am putut salva adresa. Încearcă din nou."));
      const fields = Array.isArray(err?.data?.fields) ? err.data.fields : [];
      if (fields.length) setErrors((prev) => ({ ...prev, ...Object.fromEntries(fields.map((k) => [k, prev[k] || "Verifică acest câmp."])) }));
      // altcineva a salvat între timp: reîncărcăm datele (formularul se închide, valorile noi apar)
      if (err?.data?.error === "recipient_changed") onSaved("changed");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const local = validateRecipientForm(form);
    setErrors(local);
    if (Object.keys(local).length) {
      setFormError("Verifică câmpurile marcate.");
      return;
    }
    await send({ address: recipientPayloadFromForm(form), expectedUpdatedAt: expectedUpdatedAt ?? null });
  };

  const reset = () => {
    if (busy) return;
    send({ reset: true, expectedUpdatedAt: expectedUpdatedAt ?? null });
  };

  const field = (f) => (
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
        onChange={(e) => set({ [f.key]: f.key === "postalCode" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value })}
        aria-invalid={!!errors[f.key]}
      />
      {errors[f.key] && <span className={styles.fieldError}>{errors[f.key]}</span>}
    </label>
  );
  const byKey = Object.fromEntries(RECIPIENT_FORM_FIELDS.map((f) => [f.key, f]));

  return (
    <form className={styles.fieldset} onSubmit={submit} noValidate data-recipient-form>
      <span className={styles.muted}>
        Corectura se aplică doar acestei expedieri și AWB-ului. Adresa din comandă rămâne neschimbată, pentru istoric.
      </span>

      <div className={styles.row}>
        {field(byKey.name)}
        {field(byKey.phone)}
      </div>
      <div className={styles.row}>{field(byKey.email)}</div>

      <div className={styles.row}>
        <label className={styles.field} htmlFor={`${idPrefix}-county`}>
          <span>Județ *</span>
          {nomenclator === "ok" ? (
            <select
              id={`${idPrefix}-county`}
              className={styles.input}
              value={form.countyId || ""}
              onChange={(e) => {
                const c = counties.find((x) => String(x.id) === e.target.value);
                set({ county: c?.name || "", countyId: c?.id ?? null, city: "", cityId: null });
              }}
              aria-invalid={!!errors.county}
            >
              <option value="">Alege județul</option>
              {counties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${idPrefix}-county`}
              className={styles.input}
              value={form.county}
              maxLength={120}
              autoComplete="address-level1"
              placeholder={nomenclator === "loading" ? "Se încarcă…" : ""}
              onChange={(e) => set({ county: e.target.value, countyId: null, cityId: null })}
              aria-invalid={!!errors.county}
            />
          )}
          {errors.county && <span className={styles.fieldError}>{errors.county}</span>}
        </label>
        <label className={styles.field} htmlFor={`${idPrefix}-city`}>
          <span>Localitate *</span>
          {nomenclator === "ok" ? (
            <SamedayCityField
              enabled={!!form.countyId}
              value={form.city}
              countyId={form.countyId}
              countyName={form.county}
              selected={!!form.cityId}
              className={styles.input}
              placeholder={form.countyId ? "Scrie și alege din listă" : "Alege întâi județul"}
              ariaInvalid={!!errors.city}
              onStatus={({ available }) => setCitiesAvailable(available)}
              onTextChange={(value) => set({ city: value, cityId: null })}
              onPick={(city) =>
                set({
                  city: city.name,
                  cityId: city.cityId,
                  countyId: city.countyId || form.countyId,
                  // codul poștal: doar sugerat dacă e gol (nu suprascrie)
                  postalCode: form.postalCode || city.postalCode || "",
                })
              }
            />
          ) : (
            <input
              id={`${idPrefix}-city`}
              className={styles.input}
              value={form.city}
              maxLength={160}
              autoComplete="address-level2"
              onChange={(e) => set({ city: e.target.value, cityId: null })}
              aria-invalid={!!errors.city}
            />
          )}
          {!citiesAvailable && <span className={styles.fieldError}>Lista localităților nu răspunde acum. Încearcă din nou.</span>}
          {errors.city && <span className={styles.fieldError}>{errors.city}</span>}
        </label>
      </div>
      {nomenclator === "off" && (
        <span className={styles.muted}>
          Lista localităților Sameday nu este disponibilă acum: scrie județul și localitatea exact. Le verificăm la generarea AWB-ului.
        </span>
      )}

      <div className={styles.row}>
        {field(byKey.street)}
        {field(byKey.streetNo)}
      </div>
      <div className={styles.row3}>
        {field(byKey.block)}
        {field(byKey.staircase)}
        {field(byKey.apartment)}
      </div>
      <div className={styles.row}>{field(byKey.postalCode)}</div>

      <label className={styles.field} htmlFor={`${idPrefix}-notes`}>
        <span>Observații pentru curier</span>
        <textarea
          id={`${idPrefix}-notes`}
          className={styles.input}
          rows={2}
          maxLength={200}
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
          aria-invalid={!!errors.notes}
        />
        {errors.notes && <span className={styles.fieldError}>{errors.notes}</span>}
      </label>

      {formError && (
        <div className={styles.error} role="alert">
          {formError}
        </div>
      )}
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryBtn} disabled={busy}>
          {busy ? <Loader2 size={16} className={styles.spin} /> : <MapPin size={16} />}
          {busy ? "Se salvează…" : "Salvează adresa"}
        </button>
        {canReset && (
          <button type="button" className={styles.secondaryBtn} onClick={reset} disabled={busy}>
            Revino la adresa din comandă
          </button>
        )}
        <button type="button" className={styles.secondaryBtn} onClick={onCancel} disabled={busy}>
          Renunță
        </button>
      </div>
    </form>
  );
}
