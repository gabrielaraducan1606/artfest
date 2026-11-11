// src/pages/Admin/AdminCouriersPage/AdminCouriersPage.jsx
//
// Admin „Curieri”: starea integrărilor de curierat (azi Sameday; ceilalți
// curieri „În curând”). Starea „Conectat” vine DOAR dintr-o verificare reală
// read-only (butonul „Verifică conexiunea”); mediul (Demo / Production) e
// doar afișat - se controlează pe server. Datele vin deja filtrate (fără
// credentiale / token).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import TrackingTimeline from "../../../components/Courier/TrackingTimeline.jsx";
import styles from "./AdminCouriersPage.module.css";
import { SERVICE_ROWS, environmentLabel, formatCheckedAt, layers, statusView, testedWithLabel } from "./courierStatusView.js";

function StatusPill({ status }) {
  const v = statusView(status);
  return (
    <span className={`${styles.pill} ${styles[`tone_${v.tone}`]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {v.label}
    </span>
  );
}

function CourierCard({ courier, onUpdated }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [, setTick] = useState(0);
  const timer = useRef(null);

  // „Verificat acum” -> dată, fără reîncărcare
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => clearInterval(timer.current), []);

  const startCooldown = (sec) => {
    clearInterval(timer.current);
    setCooldown(sec);
    timer.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1) {
          clearInterval(timer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const check = async () => {
    if (checking || cooldown) return;
    setChecking(true);
    setError("");
    try {
      const data = await api(`/api/admin/couriers/${courier.provider.toLowerCase()}/check`, { method: "POST" });
      onUpdated(data.courier);
      startCooldown(30);
    } catch (e) {
      if (e?.status === 429 && e?.data?.courier) {
        onUpdated(e.data.courier);
        startCooldown(Number(e.data.retryAfterSec) || 30);
      } else {
        setError(e?.data?.message || "Verificarea nu a putut fi pornită.");
      }
    } finally {
      setChecking(false);
    }
  };

  const last = courier.lastCheck;
  const cfg = courier.configuration || {};
  const points = last?.pickupPoints || [];
  const configured = points.find((p) => p.isConfigured) || null;
  const contact = configured?.contacts?.find((c) => c.id === String(cfg.contactPersonId)) || configured?.contacts?.find((c) => c.isDefault) || null;

  return (
    <article className={styles.card} aria-labelledby={`courier-${courier.provider}`}>
      <header className={styles.cardHead}>
        <div>
          <h2 id={`courier-${courier.provider}`} className={styles.cardTitle}>
            {courier.name}
          </h2>
          <span className={styles.envBadge} title="Mediul se configurează pe server">
            Mediu: {environmentLabel(courier.environment)}
          </span>
        </div>
        <StatusPill status={courier.status} />
      </header>

      <ul className={styles.layers}>
        {layers(courier).map((l) => (
          <li key={l.key}>
            <span className={styles.layerLabel}>{l.label}</span>
            <span className={`${styles.layerValue} ${styles[`text_${l.tone}`]}`}>{l.value}</span>
          </li>
        ))}
      </ul>

      {last?.message ? (
        <p className={`${styles.message} ${styles[`box_${statusView(last.status).tone}`]}`} role="status">
          {last.message}
        </p>
      ) : (
        <p className={styles.messageMuted}>Starea se află doar după o verificare reală. Apasă „Verifică conexiunea”.</p>
      )}

      {last?.issues?.length ? (
        <ul className={styles.issues}>
          {last.issues.map((i) => (
            <li key={i.code}>{i.message}</li>
          ))}
        </ul>
      ) : null}

      <dl className={styles.details}>
        <div>
          <dt>Pickup point</dt>
          <dd>
            {configured ? (
              <>
                <strong>{configured.alias || "Punct de ridicare"}</strong>
                <span>
                  {[configured.address, configured.city, configured.county].filter(Boolean).join(", ")}
                  {configured.postalCode ? ` · ${configured.postalCode}` : ""}
                </span>
                <span className={styles.muted}>ID {configured.id}</span>
              </>
            ) : cfg.pickupPointId ? (
              <span className={styles.muted}>ID {cfg.pickupPointId} (neverificat)</span>
            ) : (
              <span className={styles.muted}>Neconfigurat</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Persoană de contact</dt>
          <dd>{contact ? <span>{contact.name || `ID ${contact.id}`}{contact.isDefault ? " (implicită)" : ""}</span> : <span className={styles.muted}>{cfg.contactPersonId ? `ID ${cfg.contactPersonId}` : "Implicită Sameday"}</span>}</dd>
        </div>
        {SERVICE_ROWS.map(([key, label]) => {
          const s = last?.services?.[key];
          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {s ? (
                  <span className={s.active ? styles.text_ok : styles.text_off}>
                    {s.active ? "Activ" : "Inactiv"}
                    {s.active && s.name ? <span className={styles.muted}> · {s.name} (ID {s.id})</span> : null}
                  </span>
                ) : (
                  <span className={styles.muted}>Neverificat</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>

      {last?.allServices?.length ? (
        <details className={styles.more}>
          <summary>Toate serviciile active pe cont ({last.allServices.length})</summary>
          <ul>
            {last.allServices.map((s) => (
              <li key={s.id}>
                {s.name || "—"} <span className={styles.muted}>ID {s.id}{s.deliveryType ? ` · ${s.deliveryType}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {points.length > 1 ? (
        <details className={styles.more}>
          <summary>Puncte de ridicare pe cont ({points.length})</summary>
          <ul>
            {points.map((p) => (
              <li key={p.id}>
                {p.alias || "—"} <span className={styles.muted}>ID {p.id}{p.isDefault ? " · implicit" : ""}{p.active ? "" : " · dezactivat"}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer className={styles.cardFoot}>
        <span className={styles.muted}>
          Ultima verificare: <strong>{formatCheckedAt(last?.checkedAt)}</strong>
          {testedWithLabel(last?.testedWith) ? ` · ${testedWithLabel(last.testedWith)}` : ""}
        </span>
        <button type="button" className={styles.primary} onClick={check} disabled={checking || cooldown > 0} aria-busy={checking || undefined}>
          {checking ? "Se verifică…" : cooldown > 0 ? `Poți verifica din nou în ${cooldown}s` : "Verifică conexiunea"}
        </button>
      </footer>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

const DIRECTION_LABEL = { OUTBOUND: "Livrare", RETURN: "Retur" };

/*
 * Istoricul tracking-ului (status-sync) după AWB / nr. comandă / id expediere.
 * Doar citire, fără apel la curier; include evenimentele nemapate / neaplicate.
 */
function TrackingLookup() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);

  const search = async (e) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/admin/couriers/tracking?q=${encodeURIComponent(term)}`);
      setResults(Array.isArray(data?.results) ? data.results : []);
    } catch (err) {
      setResults(null);
      setError(err?.data?.message || "Nu am putut încărca istoricul tracking-ului.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.tracking} aria-labelledby="tracking-title">
      <h2 id="tracking-title" className={styles.sectionTitle}>Istoric tracking</h2>
      <p className={styles.messageMuted}>
        Evenimentele primite de la curier pentru o expediere, inclusiv cele care nu au schimbat statusul comenzii.
      </p>
      <form className={styles.trackingForm} onSubmit={search} role="search">
        <input
          className={styles.trackingInput}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="AWB, număr comandă sau id expediere"
          aria-label="AWB, număr comandă sau id expediere"
          maxLength={64}
        />
        <button type="submit" className={styles.trackingButton} disabled={loading || !q.trim()}>
          {loading ? "Se caută…" : "Caută"}
        </button>
      </form>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {results && !results.length ? <p className={styles.messageMuted}>Nicio expediere găsită.</p> : null}
      {(results || []).map((r) => (
        <article key={r.shipmentId} className={styles.trackingCard}>
          <header className={styles.trackingHead}>
            <strong>{r.orderNumber ? `Comanda #${r.orderNumber}` : `Expediere ${r.shipmentId}`}</strong>
            <span className={styles.messageMuted}>
              {[DIRECTION_LABEL[r.direction] || r.direction, r.awb ? `AWB ${r.awb}` : null, r.status, r.vendorName].filter(Boolean).join(" · ")}
            </span>
          </header>
          <TrackingTimeline events={r.events} admin emptyMessage="Nu există evenimente status-sync pentru această expediere." />
        </article>
      ))}
    </section>
  );
}

function PlannedCard({ courier }) {
  return (
    <article className={`${styles.card} ${styles.cardPlanned}`} aria-label={`${courier.name} - în curând`}>
      <header className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{courier.name}</h2>
        <span className={styles.soon}>În curând</span>
      </header>
      <p className={styles.messageMuted}>Integrarea nu este disponibilă încă.</p>
    </article>
  );
}

export default function AdminCouriersPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/admin/couriers");
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch (e) {
      setError(e?.data?.message || "Nu am putut încărca starea curierilor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = (courier) => setItems((prev) => prev.map((c) => (c.provider === courier.provider ? courier : c)));
  const implemented = items.filter((c) => c.implemented);
  const planned = items.filter((c) => !c.implemented);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.h1}>Curieri</h1>
        <p className={styles.subtitle}>Starea integrărilor de curierat. Verificarea conexiunii este doar de citire: nu generează AWB și nu schimbă configurația.</p>
      </header>

      {loading ? <p className={styles.messageMuted}>Se încarcă…</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <section className={styles.grid}>
        {implemented.map((c) => (
          <CourierCard key={c.provider} courier={c} onUpdated={update} />
        ))}
      </section>

      {planned.length ? (
        <section>
          <h2 className={styles.sectionTitle}>Alți curieri</h2>
          <div className={styles.plannedGrid}>
            {planned.map((c) => (
              <PlannedCard key={c.provider} courier={c} />
            ))}
          </div>
        </section>
      ) : null}

      <TrackingLookup />
    </main>
  );
}
