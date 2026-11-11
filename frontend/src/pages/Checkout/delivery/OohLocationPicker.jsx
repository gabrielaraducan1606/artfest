// src/pages/Checkout/delivery/OohLocationPicker.jsx
//
// Alegerea unei locații easybox / Sameday Point: căutare (oraș, adresă,
// nume), filtru pe tip, listă + hartă. Desktop: listă și hartă alăturate;
// mobil: ecran complet cu taburi „Listă” / „Hartă” și buton fix
// „Alege această locație”. Locațiile vin doar de la backend-ul Artfest.

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import styles from "./Delivery.module.css";
import { foldText, searchOohLocations } from "./deliveryApi.js";
import { METHOD_LABELS, publicLocation, scheduleSummary, upcomingSpecialDays } from "./deliveryState.js";

const OohMap = lazy(() => import("./OohMap.jsx"));

// Montat doar cât timp e deschis: valorile inițiale se citesc o singură dată
// (rerandările checkout-ului nu resetează căutarea sau alegerea curentă).
// region = { city, county } din adresa clientului: locațiile din zonă apar
// primele (fără a le ascunde pe celelalte). „Lângă mine” = poziția din
// browser, opțională, doar în memoria componentei (nu se salvează).
export default function OohLocationPicker({ open, method, availableTypes, initialLocation, defaultQuery = "", region = null, storeLabel, onSelect, onClose }) {
  const [query, setQuery] = useState(defaultQuery);
  const [near, setNear] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  const canLocate = typeof navigator !== "undefined" && Boolean(navigator.geolocation);
  const [type, setType] = useState(method);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(initialLocation?.type === method ? initialLocation.id : null);
  const [initial] = useState(initialLocation?.type === method ? initialLocation : null);
  const [mobileView, setMobileView] = useState("list");
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // căutare cu întârziere mică; cererea anterioară se anulează
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const res = await searchOohLocations({
          q: query,
          type,
          city: region?.city || "",
          county: region?.county || "",
          near,
          signal: controller.signal,
        });
        setItems(res.items.map(publicLocation).filter(Boolean));
        setTotal(res.total);
      } catch (e) {
        if (e?.name !== "AbortError") {
          setError(`Momentan nu putem încărca opțiunile ${METHOD_LABELS[type] || "Easybox"}. Poți continua cu livrare la adresă sau poți încerca din nou.`);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // region: o singură dată la deschidere (componenta e montată doar cât e deschisă)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, type, near]);

  // „Lângă mine”: opțional, la cererea clientului; poziția nu se salvează
  const locate = () => {
    if (!canLocate) return;
    setLocating(true);
    setLocateError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocateError("Nu am putut afla poziția. Caută după oraș sau stradă.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  };

  // blocare scroll + Escape (o singură dată la deschidere)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => e.key === "Escape" && onCloseRef.current?.();
    window.addEventListener("keydown", onKey);
    // pe ecrane mici nu deschidem tastatura automat (lista rămâne vizibilă)
    if (window.matchMedia?.("(min-width: 761px)").matches) {
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
    }
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = useMemo(
    () => items.find((l) => l.id === selectedId) || (initial?.id === selectedId ? initial : null),
    [items, selectedId, initial]
  );

  const pick = useCallback((id) => {
    setSelectedId(id);
    const node = listRef.current?.querySelector(`[data-ooh-id="${id}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  if (!open) return null;

  const confirm = () => selected && onSelect?.(selected);
  // „Întâi locațiile din …” doar dacă primul rezultat chiar e din localitatea / județul clientului
  const same = (a, b) => Boolean(a && b) && foldText(a) === foldText(b);
  const regionLabel = items[0]
    ? same(items[0].city, region?.city)
      ? region.city
      : same(items[0].county, region?.county)
        ? region.county
        : ""
    : "";
  const typeOptions = ["LOCKER", "PUDO"].filter((t) => availableTypes.includes(t));

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="ooh-picker-title">
        <header className={styles.dialogHead}>
          <div>
            <h2 id="ooh-picker-title" className={styles.dialogTitle}>
              Alege {METHOD_LABELS[type]}
            </h2>
            {storeLabel ? <p className={styles.dialogSub}>Pentru produsele de la {storeLabel}</p> : null}
          </div>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </header>

        <div className={styles.toolbar}>
          <input
            ref={inputRef}
            className={styles.search}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Caută după oraș, stradă sau nume"
            aria-label="Caută locația"
          />
          {canLocate ? (
            <button
              type="button"
              className={`${styles.chip} ${near ? styles.chipActive : ""}`}
              onClick={near ? () => setNear(null) : locate}
              disabled={locating}
              aria-pressed={Boolean(near)}
            >
              {locating ? "Caut poziția…" : near ? "Lângă mine ✓" : "Lângă mine"}
            </button>
          ) : null}
          {typeOptions.length > 1 && (
            <div className={styles.chips} role="tablist" aria-label="Tip locație">
              {typeOptions.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={type === t}
                  className={`${styles.chip} ${type === t ? styles.chipActive : ""}`}
                  onClick={() => {
                    setType(t);
                    setSelectedId(null);
                  }}
                >
                  {METHOD_LABELS[t]}
                </button>
              ))}
            </div>
          )}
          <div className={styles.viewTabs} role="tablist" aria-label="Mod de afișare">
            {[
              ["list", "Listă"],
              ["map", "Hartă"],
            ].map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={mobileView === v}
                className={`${styles.viewTab} ${mobileView === v ? styles.viewTabActive : ""}`}
                onClick={() => setMobileView(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.body} data-view={mobileView}>
          <div className={styles.listPane} ref={listRef}>
            {loading && !items.length ? <p className={styles.state}>Se încarcă locațiile…</p> : null}
            {error ? <p className={styles.stateError}>{error}</p> : null}
            {locateError ? <p className={styles.stateError}>{locateError}</p> : null}
            {!near && !query && regionLabel ? <p className={styles.state}>Întâi locațiile din {regionLabel}.</p> : null}
            {!loading && !error && !items.length ? (
              <p className={styles.state}>Nicio locație găsită. Încearcă alt oraș sau altă stradă.</p>
            ) : null}
            <ul className={styles.list}>
              {items.map((loc) => {
                const active = loc.id === selectedId;
                const hours = scheduleSummary(loc.schedule);
                const special = upcomingSpecialDays(loc.specialSchedule);
                return (
                  <li key={loc.id}>
                    <button
                      type="button"
                      data-ooh-id={loc.id}
                      className={`${styles.locItem} ${active ? styles.locItemActive : ""}`}
                      onClick={() => setSelectedId(loc.id)}
                      aria-pressed={active}
                    >
                      <span className={`${styles.badge} ${loc.type === "PUDO" ? styles.badgePudo : styles.badgeLocker}`}>
                        {METHOD_LABELS[loc.type]}
                      </span>
                      <strong className={styles.locName}>{loc.name}</strong>
                      <span className={styles.locAddress}>
                        {loc.address}
                        {loc.city ? `, ${loc.city}` : ""}
                        {loc.postalCode ? `, ${loc.postalCode}` : ""}
                      </span>
                      {loc.distanceKm != null ? <span className={styles.locHours}>la {String(loc.distanceKm).replace(".", ",")} km</span> : null}
                      {hours ? <span className={styles.locHours}>{hours}</span> : null}
                      {special.length ? (
                        <span className={styles.locSpecial}>
                          Program special: {special.map((s) => `${s.date} ${s.text}`).join(" · ")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {total > items.length ? (
              <p className={styles.state}>Afișăm primele {items.length} din {total}. Scrie orașul sau strada pentru rezultate mai precise.</p>
            ) : null}
          </div>

          <div className={styles.mapPane}>
            <Suspense fallback={<div className={styles.mapFallback}>Se încarcă harta…</div>}>
              <OohMap locations={items} selectedId={selectedId} onSelect={pick} visible={mobileView === "map"} />
            </Suspense>
          </div>
        </div>

        <footer className={styles.dialogFoot}>
          {selected ? (
            <p className={styles.footSummary}>
              <strong>{selected.name}</strong>
              <span>
                {selected.address}
                {selected.city ? `, ${selected.city}` : ""}
                {selected.county ? `, ${selected.county}` : ""}
                {selected.postalCode ? ` · ${selected.postalCode}` : ""}
              </span>
              {scheduleSummary(selected.schedule) ? <span>{scheduleSummary(selected.schedule)}</span> : null}
              {selected.acceptsCardPayment === false ? <span>La această locație nu se poate plăti cu cardul.</span> : null}
            </p>
          ) : (
            <p className={styles.footHint}>Alege o locație din listă sau de pe hartă.</p>
          )}
          <button type="button" className={styles.primary} disabled={!selected} onClick={confirm}>
            Alege această locație
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
