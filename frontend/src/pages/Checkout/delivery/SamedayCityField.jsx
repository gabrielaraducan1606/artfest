// src/pages/Checkout/delivery/SamedayCityField.jsx
//
// „Localitate” cu autocomplete din nomenclatorul Sameday (prin backend-ul
// Artfest: /api/shipping/cities -> GET /api/geolocation/city). Clientul vede
// doar denumirile; alegerea din listă salvează ID-urile Sameday.
//
//  - sugestii abia de la 2 caractere, cu debounce (fără cerere la fiecare tastă);
//  - filtrate după județul ales (countyId Sameday, altfel după denumire);
//  - max MAX_SUGGESTIONS vizibile; tastatură (↑ ↓ Enter Esc) pe desktop,
//    rânduri înalte pe mobil; la focus pe mobil câmpul urcă sus, ca lista să
//    nu fie acoperită de tastatură;
//  - lista indisponibilă (eroare de rețea / Sameday) -> onStatus({ available:
//    false }): părintele acceptă textul, marcat nevalidat (serverul reîncearcă
//    validarea la plasare).
// Fără nomenclator (enabled = false): câmp text simplu.

import React, { useEffect, useId, useRef, useState } from "react";
import styles from "./Delivery.module.css";
import { fetchCities, fetchCounties, foldText } from "./deliveryApi.js";

export const MAX_SUGGESTIONS = 15;
export const MIN_QUERY = 2;
export const DEBOUNCE_MS = 300;

export default function SamedayCityField({
  enabled,
  value,
  countyId: countyIdProp = null,
  countyName,
  selected = false,
  onTextChange,
  onPick,
  onBlur,
  onStatus,
  inputRef,
  className,
  placeholder,
  ariaInvalid,
}) {
  const [countyId, setCountyId] = useState(countyIdProp);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const typed = useRef(false);
  const ownRef = useRef(null);
  const listId = useId();
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  const setInput = (node) => {
    ownRef.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  };

  // județul ales -> ID-ul Sameday (direct, sau după denumire)
  useEffect(() => {
    let cancelled = false;
    if (!enabled) return undefined;
    if (countyIdProp) {
      setCountyId(countyIdProp);
      return undefined;
    }
    setCountyId(null);
    if (!countyName) return undefined;
    fetchCounties()
      .then((list) => {
        if (cancelled) return;
        const target = foldText(countyName).replace(/^judetul /, "");
        const match = list.find((c) => foldText(c.name) === target);
        setCountyId(match ? match.id : null);
      })
      .catch(() => !cancelled && statusRef.current?.({ available: false }));
    return () => {
      cancelled = true;
    };
  }, [enabled, countyIdProp, countyName]);

  // sugestii: doar după tastare, de la MIN_QUERY caractere, cu debounce
  useEffect(() => {
    let cancelled = false;
    const q = String(value || "").trim();
    if (!enabled || !countyId || !typed.current || foldText(q).length < MIN_QUERY) {
      setSuggestions([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      fetchCities(countyId, q)
        .then((list) => {
          if (cancelled) return;
          setSuggestions(list.slice(0, MAX_SUGGESTIONS));
          setActive(-1);
          statusRef.current?.({ available: true });
        })
        .catch(() => {
          if (cancelled) return;
          setSuggestions([]);
          statusRef.current?.({ available: false });
        })
        .finally(() => !cancelled && setSearching(false));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, countyId, value]);

  const choose = (city) => {
    typed.current = false;
    setOpen(false);
    setSuggestions([]);
    onPick?.({ name: city.name, countyId, cityId: city.id, postalCode: city.postalCode || null, village: city.village || null });
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || !suggestions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(suggestions[active]);
    }
  };

  const onFocus = () => {
    setOpen(true);
    // mobil: câmpul urcă în partea de sus, rezultatele rămân deasupra tastaturii
    if (enabled && window.matchMedia?.("(max-width: 760px)").matches) {
      setTimeout(() => ownRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 250);
    }
  };

  const showList = enabled && open && suggestions.length > 0;
  const q = String(value || "").trim();
  const showEmpty = enabled && open && typed.current && countyId && !searching && foldText(q).length >= MIN_QUERY && !suggestions.length && !selected;

  return (
    <div className={styles.cityField}>
      <input
        ref={setInput}
        className={className}
        value={value}
        onChange={(e) => {
          typed.current = true;
          setOpen(true);
          onTextChange?.(e.target.value);
        }}
        onFocus={onFocus}
        onBlur={(e) => {
          setTimeout(() => setOpen(false), 150);
          onBlur?.(e);
        }}
        onKeyDown={onKeyDown}
        placeholder={enabled && !countyId ? "Alege întâi județul" : placeholder}
        autoComplete="off"
        role={enabled ? "combobox" : undefined}
        aria-expanded={enabled ? showList : undefined}
        aria-controls={enabled ? listId : undefined}
        aria-autocomplete={enabled ? "list" : undefined}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={ariaInvalid || undefined}
      />
      {showList ? (
        <ul id={listId} className={styles.citySuggestions} role="listbox">
          {suggestions.map((city, i) => (
            <li
              key={city.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`${styles.citySuggestion} ${i === active ? styles.citySuggestionActive : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(city);
              }}
            >
              <span className={styles.cityName}>{city.name}</span>
              {city.village && foldText(city.village) !== foldText(city.name) ? <span className={styles.cityMeta}>{city.village}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {showEmpty ? (
        <div className={styles.cityEmpty} role="status">
          Nicio localitate găsită în acest județ.
        </div>
      ) : null}
    </div>
  );
}
