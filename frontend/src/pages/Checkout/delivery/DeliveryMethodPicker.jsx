// src/pages/Checkout/delivery/DeliveryMethodPicker.jsx
//
// Metoda de livrare pentru UN magazin din coș (fiecare magazin își trimite
// singur coletul, deci fiecare are alegerea și costul lui). Fără termeni
// tehnici: doar „Livrare la adresă” / „Easybox” / „Sameday Point”.

import React from "react";
import styles from "./Delivery.module.css";
import { METHOD_HINTS, METHOD_LABELS } from "./deliveryState.js";

// lastUsed: { LOCKER?: {status, location?}, PUDO?: … } - ultimul punct al clientului,
// revalidat de server; doar pentru afișare (plasarea revalidează din nou)
// unavailableMethod: easybox / Sameday Point ales anterior, indisponibil acum ->
// clientul alege explicit livrarea la adresă sau încearcă din nou (fără schimbare tăcută)
export default function DeliveryMethodPicker({
  groupKey,
  methods,
  selection,
  priceLabel,
  error,
  lastUsed = {},
  unavailableMethod = null,
  retrying = false,
  onChangeMethod,
  onOpenLocations,
  onRetry,
}) {
  const name = `delivery-${groupKey}`;
  // fără alegere bifată cât timp metoda salvată e indisponibilă (clientul decide)
  const current = unavailableMethod ? null : selection?.method || "HOME";
  const location = selection?.location || null;
  const last = current && current !== "HOME" ? lastUsed?.[current] : null;
  const isLastUsed = Boolean(location && last?.status === "ok" && Number(last.location?.id) === Number(location.id));
  const lastUnavailable = !location && last?.status === "unavailable";

  return (
    <div className={styles.picker}>
      {unavailableMethod ? (
        <div className={styles.notice} role="status">
          <p style={{ margin: 0 }}>
            Momentan nu putem încărca opțiunile {METHOD_LABELS[unavailableMethod]}. Poți continua cu livrare la adresă sau
            poți încerca din nou.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" className={styles.secondary} onClick={() => onChangeMethod("HOME")}>
              Continuă cu livrare la adresă
            </button>
            {onRetry ? (
              <button type="button" className={styles.linkButton} onClick={onRetry} disabled={retrying}>
                {retrying ? "Se verifică…" : "Încearcă din nou"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className={styles.options} role="radiogroup" aria-label="Metoda de livrare">
        {methods.map(({ method }) => {
          const checked = current === method;
          return (
            <label key={method} className={`${styles.option} ${checked ? styles.optionActive : ""}`}>
              <input
                type="radio"
                name={name}
                value={method}
                checked={checked}
                onChange={() => onChangeMethod(method)}
                className={styles.radio}
              />
              <span className={styles.optionText}>
                <span className={styles.optionTitle}>{METHOD_LABELS[method]}</span>
                <span className={styles.optionHint}>{METHOD_HINTS[method]}</span>
              </span>
              {priceLabel ? <span className={styles.optionPrice}>{priceLabel}</span> : null}
            </label>
          );
        })}
      </div>

      {current && current !== "HOME" ? (
        location ? (
          <div className={styles.chosen}>
            <div>
              <span className={styles.chosenLabel}>{isLastUsed ? "Ultimul punct folosit" : "Livrare la:"}</span>
              <strong className={styles.chosenName}>{location.name}</strong>
              <span className={styles.chosenAddress}>
                {location.address}
                {location.city ? `, ${location.city}` : ""}
              </span>
            </div>
            <button type="button" className={styles.linkButton} onClick={() => onOpenLocations(current)}>
              {isLastUsed ? "Alege alt punct" : "Schimbă"}
            </button>
          </div>
        ) : (
          <>
            {lastUnavailable ? (
              <p className={styles.notice} role="status">
                Ultimul punct folosit nu mai este disponibil. Alege alt punct.
              </p>
            ) : null}
            <button type="button" className={styles.secondary} onClick={() => onOpenLocations(current)}>
              Alege {METHOD_LABELS[current]}
            </button>
          </>
        )
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
