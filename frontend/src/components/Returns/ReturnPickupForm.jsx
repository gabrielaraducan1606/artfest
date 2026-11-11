// src/components/Returns/ReturnPickupForm.jsx
//
// Alegerea metodei de retur + adresa de ridicare (Sameday STANDARD).
// Județul și localitatea DOAR din nomenclatorul Sameday (prin /api/shipping),
// ca în checkout; serverul revalidează tot. Easybox apare doar ca „în curând”.
//
// Două moduri:
//  - controlat (value + onChange): în formularul de solicitare retur;
//  - cu salvare (onSubmit): „Modifică metoda” din cardul cererii.

import { useEffect, useId, useState } from "react";
import { useReturnPickupAvailable } from "./returnPickupAvailability.js";
import SamedayCityField from "../../pages/Checkout/delivery/SamedayCityField.jsx";
import { fetchCounties } from "../../pages/Checkout/delivery/deliveryApi.js";
import {
  CLIENT_RETURN_METHODS,
  EMPTY_PICKUP_FORM,
  RETURN_METHOD_HINTS,
  RETURN_METHOD_LABELS,
  pickupPayloadFromForm,
  validatePickupForm,
} from "./returnLogistics.js";
import { returnStyles as rs } from "./returnUtils.js";
import styles from "./ReturnLogistics.module.css";

export function ReturnPickupFields({ method, form, onMethod, onForm, errors = {}, methods = CLIENT_RETURN_METHODS, disabled = false }) {
  const uid = useId();
  const pickupAvailable = useReturnPickupAvailable();
  const [counties, setCounties] = useState([]);
  const [nomenclator, setNomenclator] = useState("loading"); // loading | ok | off
  const [citiesAvailable, setCitiesAvailable] = useState(true);

  useEffect(() => {
    if (method !== "HOME_PICKUP") return undefined;
    let alive = true;
    fetchCounties()
      .then((items) => {
        if (!alive) return;
        setCounties(items);
        setNomenclator(items.length ? "ok" : "off");
        // județul precompletat după denumire (fără ID) -> ID-ul din nomenclator
        if (items.length && form.county && !form.samedayCountyId) {
          const fold = (v) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^judetul\s+/, "").trim();
          const match = items.find((c) => fold(c.name) === fold(form.county));
          if (match) onForm({ ...form, county: match.name, samedayCountyId: match.id });
        }
      })
      .catch(() => alive && setNomenclator("off"));
    return () => {
      alive = false;
    };
    // doar la deschiderea ridicării de la adresă
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  const set = (patch) => onForm({ ...form, ...patch });

  return (
    <div className={styles.pickupForm}>
      <div className={styles.methods} role="radiogroup" aria-label="Metoda de retur">
        {methods.map((m) => {
          // ridicarea prin curier: doar când serverul o raportează disponibilă
          const off = m === "HOME_PICKUP" && pickupAvailable !== true;
          return (
            <label key={m} className={`${styles.method} ${method === m ? styles.methodActive : ""} ${off ? styles.methodDisabled : ""}`}>
              <input type="radio" name={`${uid}-method`} value={m} checked={method === m} disabled={disabled || off} onChange={() => onMethod(m)} />
              <span>
                <strong>{RETURN_METHOD_LABELS[m]}</strong>
                <span className={styles.methodHint}>
                  {off
                    ? pickupAvailable === null
                      ? "Se verifică disponibilitatea…"
                      : "Ridicarea de la adresă nu este disponibilă momentan. Poți trimite singur coletul."
                    : RETURN_METHOD_HINTS[m]}
                </span>
              </span>
            </label>
          );
        })}
        <div className={`${styles.method} ${styles.methodDisabled}`} aria-disabled="true">
          <span>
            <strong>{RETURN_METHOD_LABELS.EASYBOX}</strong>
            <span className={styles.methodHint}>Returul prin easybox va fi disponibil în curând.</span>
          </span>
        </div>
      </div>

      {method === "HOME_PICKUP" && pickupAvailable === false && (
        <div className={`${rs.notice} ${rs.notice_warning}`}>
          Ridicarea de la adresă nu este disponibilă momentan. Alege „Trimit singur coletul” sau revino mai târziu.
        </div>
      )}

      {method === "HOME_PICKUP" && pickupAvailable === true && (
        <fieldset className={styles.addressGrid} disabled={disabled}>
          <legend className={styles.legend}>Adresa de unde ridică curierul coletul</legend>
          {nomenclator === "off" && (
            <div className={`${rs.notice} ${rs.notice_warning} ${styles.full}`}>
              Lista localităților curierului nu este disponibilă acum, iar adresa nu poate fi confirmată. Poți alege „Trimit singur
              coletul” sau poți reveni mai târziu.
            </div>
          )}
          <label className={styles.field}>
            <span>Nume și prenume*</span>
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" aria-invalid={!!errors.name} />
            {errors.name && <em className={styles.fieldError}>{errors.name}</em>}
          </label>
          <label className={styles.field}>
            <span>Telefon*</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={(e) => set({ phone: e.target.value.replace(/[^\d+\s]/g, "") })}
              placeholder="07xxxxxxxx"
              aria-invalid={!!errors.phone}
            />
            {errors.phone && <em className={styles.fieldError}>{errors.phone}</em>}
          </label>
          <label className={styles.field}>
            <span>Județ*</span>
            <select
              value={form.samedayCountyId || ""}
              disabled={nomenclator !== "ok"}
              onChange={(e) => {
                const c = counties.find((x) => String(x.id) === e.target.value);
                set({ county: c?.name || "", samedayCountyId: c?.id ?? null, city: "", samedayCityId: null });
              }}
              aria-invalid={!!errors.county}
            >
              <option value="">{nomenclator === "loading" ? "Se încarcă…" : "Alege județul"}</option>
              {counties.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {errors.county && <em className={styles.fieldError}>{errors.county}</em>}
          </label>
          <label className={styles.field}>
            <span>Localitate*</span>
            <SamedayCityField
              enabled={nomenclator === "ok" && !!form.samedayCountyId}
              value={form.city}
              countyId={form.samedayCountyId}
              countyName={form.county}
              selected={!!form.samedayCityId}
              placeholder={form.samedayCountyId ? "Scrie și alege din listă" : "Alege întâi județul"}
              ariaInvalid={!!errors.city}
              onStatus={({ available }) => setCitiesAvailable(available)}
              onTextChange={(value) => set({ city: value, samedayCityId: null })}
              onPick={(city) =>
                set({
                  city: city.name,
                  samedayCityId: city.cityId,
                  samedayCountyId: city.countyId || form.samedayCountyId,
                  // codul poștal: doar dacă e gol (sugestie, nu suprascriere)
                  postalCode: form.postalCode || city.postalCode || "",
                })
              }
            />
            {!citiesAvailable && <em className={styles.fieldError}>Lista localităților nu răspunde acum. Încearcă din nou.</em>}
            {errors.city && <em className={styles.fieldError}>{errors.city}</em>}
          </label>
          <label className={`${styles.field} ${styles.full}`}>
            <span>Stradă și număr*</span>
            <input
              value={form.address}
              onChange={(e) => set({ address: e.target.value })}
              autoComplete="street-address"
              placeholder="Ex: Str. Lalelelor 7, bl. A, ap. 3"
              aria-invalid={!!errors.address}
            />
            {errors.address && <em className={styles.fieldError}>{errors.address}</em>}
          </label>
          <label className={styles.field}>
            <span>Cod poștal</span>
            <input
              inputMode="numeric"
              maxLength={6}
              value={form.postalCode}
              onChange={(e) => set({ postalCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
              autoComplete="postal-code"
              aria-invalid={!!errors.postalCode}
            />
            {errors.postalCode && <em className={styles.fieldError}>{errors.postalCode}</em>}
          </label>
          <label className={styles.field}>
            <span>Email (opțional)</span>
            <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" aria-invalid={!!errors.email} />
            {errors.email && <em className={styles.fieldError}>{errors.email}</em>}
          </label>
        </fieldset>
      )}
    </div>
  );
}

/**
 * „Modifică metoda / adresa” - salvează prin onSubmit(returnMethod, pickupAddress|null).
 * Erorile de câmp ale serverului (fields) apar sub câmpuri.
 */
export default function ReturnPickupForm({ initialMethod, initialForm, methods, onSubmit, onCancel }) {
  const [method, setMethod] = useState(initialMethod || "");
  const [form, setForm] = useState(initialForm || EMPTY_PICKUP_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    if (!method) {
      setError("Alege metoda de retur.");
      return;
    }
    const local = method === "HOME_PICKUP" ? validatePickupForm(form) : {};
    setErrors(local);
    if (Object.keys(local).length) return;

    setSaving(true);
    try {
      await onSubmit(method, method === "HOME_PICKUP" ? pickupPayloadFromForm(form) : null);
    } catch (e) {
      setErrors(e?.data?.fields || {});
      setError(e?.data?.message || e?.message || "Nu am putut salva metoda de retur.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={rs.composer}>
      <ReturnPickupFields
        method={method}
        form={form}
        onMethod={(m) => {
          setMethod(m);
          setErrors({});
        }}
        onForm={setForm}
        errors={errors}
        methods={methods}
        disabled={saving}
      />
      {error && <div className={rs.error}>{error}</div>}
      <div className={rs.actions}>
        <button type="button" className={`${rs.btn} ${rs.btnPrimary}`} onClick={save} disabled={saving}>
          {saving ? "Se salvează…" : method === "HOME_PICKUP" ? "Confirmă adresa de ridicare" : "Salvează metoda"}
        </button>
        {onCancel && (
          <button type="button" className={rs.btn} onClick={onCancel} disabled={saving}>
            Renunță
          </button>
        )}
      </div>
    </div>
  );
}
