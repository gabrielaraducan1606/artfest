// src/pages/Vendor/Fair/FairPricingModelSection.jsx
//
// Regulamentul 2.0.0 la Târgul Artfest (preț stabilit de Artfest, comision 10% / vendor 90%) - acceptare EXPLICITĂ, în modal.
//  - solicitarea apare doar dacă serverul o oferă: există o versiune PUBLICATĂ a
//    regulamentului care conține regula, iar înscrierea e trimisă sau aprobată
//    (nu retrasă, respinsă sau anulată - verificat pe server);
//  - modalul arată rezumatul schimbărilor, exemplul cu cifre și documentul complet,
//    cu bifă și buton de acceptare; „Mai târziu” îl închide (regula veche rămâne);
//  - acceptarea se aplică doar vânzărilor viitoare; vânzările și deconturile anterioare
//    rămân neschimbate.

import { useCallback, useEffect, useRef, useState } from "react";
import { BadgePercent, X } from "lucide-react";
import { api } from "../../../lib/api";
import { formatLei } from "./fairSales.js";
import styles from "./FairInventory.module.css";

export const PRICING_MODEL_API = "/api/vendor/artfest-fair/pricing-model";
const DISMISS_KEY = "artfest-fair-pricing-later";

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });
}

// „Mai târziu” ține doar în sesiunea curentă a browserului, pentru versiunea dată
function dismissedFor(version) {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === version;
  } catch {
    return false;
  }
}
function rememberDismiss(version) {
  try {
    sessionStorage.setItem(DISMISS_KEY, version);
  } catch {
    /* fără stocare: modalul reapare la următoarea încărcare */
  }
}

// exemplul 10% / 90%, cu prețul sugerat și cu o reducere (cifrele vin de la server)
function Example({ ex }) {
  const pct = ex.commissionBps / 100;
  return (
    <ul className={styles.receptionMessages}>
      <li>
        Prețul tău declarat: <strong>{formatLei(ex.vendorPriceCents)}</strong>. Prețul sugerat la Târg:{" "}
        <strong>{formatLei(ex.salePriceCents)}</strong> (prețul declarat / 0,90).
      </li>
      <li>
        Vândut la {formatLei(ex.salePriceCents)}: Artfest {pct}% = <strong>{formatLei(ex.artfestCents)}</strong>, tu {100 - pct}% ={" "}
        <strong>{formatLei(ex.vendorCents)}</strong>.
      </li>
      <li>
        Vândut cu reducere, la {formatLei(ex.discountedSaleCents)}: Artfest {pct}% = <strong>{formatLei(ex.discountedArtfestCents)}</strong>,
        tu {100 - pct}% = <strong>{formatLei(ex.discountedVendorCents)}</strong>. Reducerea scade și suma ta.
      </li>
    </ul>
  );
}

function AcceptModal({ state, onClose, onAccepted }) {
  const [doc, setDoc] = useState(null);
  const [docError, setDocError] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    let cancelled = false;
    api(`${PRICING_MODEL_API}/document`)
      .then((d) => !cancelled && setDoc(d))
      .catch((err) => !cancelled && setDocError(err?.data?.message || "Documentul nu a putut fi încărcat."));
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [busy, onClose]);

  async function accept() {
    if (!checked || busy || !doc) return;
    setBusy(true);
    setError("");
    try {
      const res = await api(`${PRICING_MODEL_API}/accept`, {
        method: "POST",
        body: { accepted: true, termsVersion: state.offer.version },
      });
      onAccepted(res.pricing);
    } catch (err) {
      setError(err?.data?.message || err?.message || "Nu am putut salva acceptarea.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={() => !busy && onClose()} role="presentation">
      <div
        className={`${styles.modal} ${styles.modalWide}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fair-pricing-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHead}>
          <h3 id="fair-pricing-modal-title">Regulament nou la Târg: preț stabilit de Artfest, comision 10%</h3>
          <button ref={closeRef} type="button" className={styles.iconBtn} onClick={onClose} aria-label="Închide" disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.muted}>
            Până accepți, rămân regulile versiunii acceptate la înscriere. Comisionul rămâne 10% din prețul efectiv de vânzare,
            iar tu primești 90%. Noile reguli se aplică doar vânzărilor de după acceptare.
          </p>

          <h4 className={styles.label}>Ce se schimbă</h4>
          <ul className={styles.receptionMessages}>
            {state.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          <h4 className={styles.label}>Exemplu</h4>
          <Example ex={state.example} />

          <h4 className={styles.label}>Documentul complet (versiunea {state.offer.version})</h4>
          <div className={styles.docBox} tabIndex={0} aria-label="Documentul complet">
            {doc ? (
              <article dangerouslySetInnerHTML={{ __html: doc.html }} />
            ) : docError ? (
              <p className={styles.errorBox}>{docError}</p>
            ) : (
              <p className={styles.muted}>Se încarcă documentul…</p>
            )}
          </div>
          {state.offer.url && (
            <a href={state.offer.url} target="_blank" rel="noreferrer">
              Deschide documentul într-o pagină separată
            </a>
          )}

          <label className={styles.checkRow}>
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={busy || !doc} />
            <span>
              Am citit și accept Regulamentul Târgului Artfest, versiunea {state.offer.version}: prețul de vânzare stabilit de Artfest,
              comisionul de 10% din prețul efectiv (primesc 90%, inclusiv când prețul este redus) și condițiile taxei de participare
              din capitolele 2.D.3 și 16.5.
            </span>
          </label>
          {error && (
            <div className={styles.errorBox} role="alert">
              {error}
            </div>
          )}
        </div>

        <div className={styles.modalFoot}>
          <button type="button" className={styles.btnGhost} onClick={onClose} disabled={busy}>
            Mai târziu
          </button>
          <button type="button" className={styles.btn} onClick={accept} disabled={!checked || busy || !doc}>
            {busy ? "Se salvează…" : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FairPricingModelSection() {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await api(PRICING_MODEL_API);
      setState(s);
      if (s.canAccept && !dismissedFor(s.offer.version)) setOpen(true);
    } catch {
      setState(null); // fără ofertă / eroare => nimic de afișat
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const close = useCallback(() => {
    if (state?.offer?.version) rememberDismiss(state.offer.version);
    setOpen(false);
  }, [state]);

  if (!state) return null;
  const accepted = state.model === "FAIR_PRICE";
  if (!accepted && !state.canAccept) return null;

  return (
    <section className={styles.section} aria-labelledby="fair-pricing-title">
      <div className={styles.head}>
        <div>
          <h2 id="fair-pricing-title" className={styles.title}>
            <BadgePercent size={20} aria-hidden="true" /> {accepted ? "Regulamentul tău la târg" : "Regulament nou disponibil"}
          </h2>
          {accepted ? (
            <p className={styles.muted}>
              Artfest stabilește prețul de vânzare la Târg; comisionul este 10% din prețul efectiv, iar tu primești 90%. Acceptat
              la {formatDateTime(state.acceptedAt)} (regulament, versiunea {state.termsVersion}).
            </p>
          ) : (
            <p className={styles.muted}>
              Acum se aplică regulile versiunii acceptate la înscriere. Noul regulament se aplică doar dacă îl accepți.
            </p>
          )}
        </div>
        {!accepted && (
          <div className={styles.headActions}>
            <button type="button" className={styles.btn} onClick={() => setOpen(true)}>
              Citește și acceptă
            </button>
          </div>
        )}
      </div>
      {notice && (
        <div className={styles.hint} role="status">
          {notice}
        </div>
      )}
      {open && !accepted && (
        <AcceptModal
          state={state}
          onClose={close}
          onAccepted={(pricing) => {
            setState(pricing);
            setOpen(false);
            setNotice("Ai acceptat noul regulament. Se aplică vânzărilor de acum înainte.");
          }}
        />
      )}
    </section>
  );
}
