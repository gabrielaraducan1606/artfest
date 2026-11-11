// src/pages/Checkout/addresses/AddressBook.jsx
//
// Agenda de adrese din checkout (client autentificat):
//   <DeliverToCard>  „Livrează la” + „Schimbă”
//   <AddressDrawer>  lista adreselor (alege / editează / șterge / implicită)
//                    și formularul „Adaugă adresă” / „Editează adresa”.
// Pe mobil drawer-ul ocupă tot ecranul; pe desktop e o fereastră centrată.
// Nu se părăsește checkout-ul.

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./AddressBook.module.css";
import SamedayCityField from "../delivery/SamedayCityField.jsx";
import { sanitizePhoneInput } from "../checkoutForm.js";
import { ADDRESS_LABELS, addressLine, recipientLine } from "./addressBook.js";
import { CITIES_FALLBACK_MESSAGE, CITY_PICK_MESSAGE, cityNeedsPick, postalSuggestion } from "../delivery/placeFields.js";

const countyNameOf = (counties, code) => counties.find((c) => c.code === code)?.name || code || "";

export function DeliverToCard({ address, counties = [], onChange, children }) {
  return (
    <div className={styles.deliverTo}>
      <div className={styles.deliverToText}>
        <span className={styles.deliverToLabel}>Livrează la</span>
        {address ? (
          <>
            <strong className={styles.deliverToName}>
              {ADDRESS_LABELS[address.label] || "Adresă"}
              {address.isDefault ? <span className={styles.badge}>Implicită</span> : null}
            </strong>
            <span className={styles.deliverToLine}>{recipientLine(address)}</span>
            <span className={styles.deliverToLine}>{addressLine(address, countyNameOf(counties, address.county))}</span>
          </>
        ) : (
          <span className={styles.deliverToLine}>Nu ai ales încă o adresă.</span>
        )}
        {children}
      </div>
      <button type="button" className={styles.changeButton} onClick={onChange}>
        {address ? "Schimbă" : "Adaugă adresă"}
      </button>
    </div>
  );
}

const EMPTY_FORM = {
  label: "HOME",
  firstName: "",
  lastName: "",
  phone: "",
  county: "",
  city: "",
  postalCode: "",
  street: "",
  notes: "",
  samedayCountyId: null,
  samedayCityId: null,
  isDefault: false,
};

function formFromAddress(address) {
  if (!address) return { ...EMPTY_FORM };
  return {
    ...EMPTY_FORM,
    ...address,
    postalCode: address.postalCode || "",
    notes: address.notes || "",
    // ID-urile se trimit doar dacă au fost validate; altfel clientul alege din nou localitatea
    samedayCountyId: address.samedayValidated ? address.samedayCountyId : null,
    samedayCityId: address.samedayValidated ? address.samedayCityId : null,
    isDefault: Boolean(address.isDefault),
  };
}

function AddressForm({ initial, counties, nomenclator, busy, error, fieldErrors, isFirst, onCancel, onSubmit }) {
  const [form, setForm] = useState(() => formFromAddress(initial));
  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const firstRef = useRef(null);
  // lista de localități Sameday răspunde? (altfel textul e acceptat, nevalidat)
  const [citiesAvailable, setCitiesAvailable] = useState(true);
  const [postalHint, setPostalHint] = useState(null);
  const [localErrors, setLocalErrors] = useState({});

  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);

  const county = counties.find((c) => c.code === form.county) || null;
  const countyName = countyNameOf(counties, form.county);
  const fe = { ...(fieldErrors || {}), ...localErrors };

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        // nomenclator activ: localitatea trebuie aleasă din listă (ID validat)
        if (cityNeedsPick({ nomenclatorActive: nomenclator, citiesAvailable, samedayCityId: form.samedayCityId, city: form.city })) {
          setLocalErrors({ city: CITY_PICK_MESSAGE });
          return;
        }
        setLocalErrors({});
        onSubmit(form);
      }}
    >
      <div className={styles.labels} role="radiogroup" aria-label="Eticheta adresei">
        {Object.entries(ADDRESS_LABELS).map(([value, text]) => (
          <label key={value} className={`${styles.labelChip} ${form.label === value ? styles.labelChipActive : ""}`}>
            <input type="radio" name="address-label" value={value} checked={form.label === value} onChange={() => set({ label: value })} />
            {text}
          </label>
        ))}
      </div>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Nume*</span>
          <input ref={firstRef} value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} autoComplete="family-name" className={fe.lastName ? styles.inputError : ""} />
          {fe.lastName ? <em className={styles.fieldError}>{fe.lastName}</em> : null}
        </label>
        <label className={styles.field}>
          <span>Prenume*</span>
          <input value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} autoComplete="given-name" className={fe.firstName ? styles.inputError : ""} />
          {fe.firstName ? <em className={styles.fieldError}>{fe.firstName}</em> : null}
        </label>
        <label className={styles.fieldFull}>
          <span>Telefon*</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={form.phone}
            onChange={(e) => set({ phone: sanitizePhoneInput(e.target.value) })}
            placeholder="07xxxxxxxx"
            className={fe.phone ? styles.inputError : ""}
          />
          {fe.phone ? <em className={styles.fieldError}>{fe.phone}</em> : null}
        </label>
        <label className={styles.field}>
          <span>Județ*</span>
          <select
            value={form.county}
            onChange={(e) => {
              const next = counties.find((c) => c.code === e.target.value);
              setPostalHint(null);
              set({ county: e.target.value, city: "", samedayCountyId: next?.samedayId ?? null, samedayCityId: null });
            }}
            className={fe.county ? styles.inputError : ""}
          >
            <option value="">Alege județul</option>
            {counties.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {fe.county ? <em className={styles.fieldError}>{fe.county}</em> : null}
        </label>
        <label className={styles.field}>
          <span>Localitate*</span>
          {nomenclator ? (
            <>
              <SamedayCityField
                enabled
                value={form.city}
                countyId={county?.samedayId || form.samedayCountyId || null}
                countyName={countyName}
                selected={Boolean(form.samedayCityId)}
                className={fe.city ? styles.inputError : ""}
                placeholder="Scrie și alege din listă"
                ariaInvalid={Boolean(fe.city)}
                onStatus={({ available }) => setCitiesAvailable(available)}
                onTextChange={(value) => {
                  setLocalErrors({});
                  setPostalHint(null);
                  set({ city: value, samedayCityId: null });
                }}
                onPick={(city) => {
                  setLocalErrors({});
                  // codul poștal NU se completează singur - doar sugestie
                  const suggested = postalSuggestion(city, form.postalCode);
                  setPostalHint(suggested ? { code: suggested, city: city.name } : null);
                  set({ city: city.name, samedayCountyId: city.countyId, samedayCityId: city.cityId });
                }}
              />
              {!citiesAvailable ? <em className={styles.fallbackNote}>{CITIES_FALLBACK_MESSAGE}</em> : null}
            </>
          ) : (
            <input value={form.city} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" className={fe.city ? styles.inputError : ""} />
          )}
          {fe.city ? <em className={styles.fieldError}>{fe.city}</em> : null}
        </label>
        <label className={styles.fieldFull}>
          <span>Stradă și număr*</span>
          <input value={form.street} onChange={(e) => set({ street: e.target.value })} autoComplete="street-address" placeholder="Ex: Str. Lalelelor 7, bl. A, ap. 3" className={fe.street ? styles.inputError : ""} />
          {fe.street ? <em className={styles.fieldError}>{fe.street}</em> : null}
        </label>
        <label className={styles.field}>
          <span>Cod poștal</span>
          <input
            inputMode="numeric"
            maxLength={6}
            value={form.postalCode}
            onChange={(e) => set({ postalCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
            autoComplete="postal-code"
            className={fe.postalCode ? styles.inputError : ""}
          />
          {fe.postalCode ? <em className={styles.fieldError}>{fe.postalCode}</em> : null}
          {postalHint && postalHint.code !== form.postalCode ? (
            <span className={styles.postalHint}>
              <span>
                Cod poștal sugerat pentru {postalHint.city}: <strong>{postalHint.code}</strong>
              </span>
              <button
                type="button"
                onClick={() => {
                  set({ postalCode: postalHint.code });
                  setPostalHint(null);
                }}
              >
                Folosește
              </button>
            </span>
          ) : null}
        </label>
        <label className={styles.fieldFull}>
          <span>Observații pentru curier (opțional)</span>
          <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </div>

      {!isFirst ? (
        <label className={styles.checkbox}>
          <input type="checkbox" checked={form.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} />
          Setează ca adresă implicită
        </label>
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.formActions}>
        {onCancel ? (
          <button type="button" className={styles.secondary} onClick={onCancel} disabled={busy}>
            Înapoi
          </button>
        ) : null}
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? "Se salvează…" : "Salvează adresa"}
        </button>
      </div>
    </form>
  );
}

/**
 * view: { mode: "list" } | { mode: "form", address?: Object }
 */
export function AddressDrawer({
  open,
  view,
  addresses = [],
  selectedId,
  counties = [],
  nomenclator = false,
  busy = false,
  error = "",
  fieldErrors = null,
  onClose,
  onShowForm,
  onShowList,
  onSelect,
  onSave,
  onDelete,
  onSetDefault,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const isForm = view?.mode === "form";
  // view.address fără id = formular nou precompletat (ex. adresa tastată înainte de login)
  const prefill = isForm ? view.address || null : null;
  const editing = prefill?.id ? prefill : null;
  const title = isForm ? (editing ? "Editează adresa" : "Adaugă adresă") : "Livrează la";

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={styles.drawer} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.drawerHead}>
          <h3>{title}</h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </header>

        <div className={styles.drawerBody}>
          {isForm ? (
            <AddressForm
              key={editing?.id || "new"}
              initial={prefill}
              counties={counties}
              nomenclator={nomenclator}
              busy={busy}
              error={error}
              fieldErrors={fieldErrors}
              isFirst={!addresses.length || (editing && addresses.length === 1)}
              onCancel={addresses.length ? onShowList : null}
              onSubmit={(form) => onSave(form, editing?.id || null)}
            />
          ) : (
            <>
              <ul className={styles.list}>
                {addresses.map((a) => {
                  const selected = a.id === selectedId;
                  return (
                    <li key={a.id} className={`${styles.item} ${selected ? styles.itemSelected : ""}`}>
                      <button type="button" className={styles.itemMain} onClick={() => onSelect(a)} aria-pressed={selected}>
                        <span className={styles.radioDot} aria-hidden="true" />
                        <span className={styles.itemText}>
                          <strong>
                            {ADDRESS_LABELS[a.label] || "Adresă"}
                            {a.isDefault ? <span className={styles.badge}>Implicită</span> : null}
                          </strong>
                          <span>{recipientLine(a)}</span>
                          <span>{addressLine(a, countyNameOf(counties, a.county))}</span>
                        </span>
                      </button>

                      {confirmDelete === a.id ? (
                        <div className={styles.confirm}>
                          <span>Ștergi această adresă?</span>
                          <button type="button" className={styles.dangerLink} disabled={busy} onClick={() => onDelete(a).then(() => setConfirmDelete(null))}>
                            Da, șterge
                          </button>
                          <button type="button" className={styles.link} onClick={() => setConfirmDelete(null)}>
                            Renunță
                          </button>
                        </div>
                      ) : (
                        <div className={styles.itemActions}>
                          <button type="button" className={styles.link} onClick={() => onShowForm(a)} disabled={busy}>
                            Editează
                          </button>
                          {!a.isDefault ? (
                            <button type="button" className={styles.link} onClick={() => onSetDefault(a)} disabled={busy}>
                              Setează ca implicită
                            </button>
                          ) : null}
                          <button type="button" className={styles.dangerLink} onClick={() => setConfirmDelete(a.id)} disabled={busy}>
                            Șterge
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}

              <button type="button" className={styles.addButton} onClick={() => onShowForm(null)} disabled={busy}>
                + Adaugă adresă
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
