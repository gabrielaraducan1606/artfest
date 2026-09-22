import { useState } from "react";

import { api } from "../../../lib/api.js";

import styles from "./InfluencerTermsGateModal.module.css";

/*
 * Modal afișat pe dashboardul de Influencer când terms.outdated === true
 * (vezi GET /api/influencer/me): fie există o CERERE de reacceptare
 * pentru versiunea publicată, fie contul nu a acceptat niciodată acordul.
 * Publicarea unei versiuni noi, fără cerere, NU îl afișează.
 *
 * Spre deosebire de celelalte modaluri din contul de Influencer
 * (InfluencerCollectionsModal, InfluencerDiscountCodesModal), este BLOCANT
 * (terms.blocking === true): fără buton de închidere, nu se închide la
 * click pe fundal sau cu Escape. Dacă cererea are un termen-limită încă
 * neatins (terms.blocking === false) se poate amâna prin `onDismiss`.
 *
 * Backend-ul nu se bazează pe acest modal ca unică protecție -
 * enforceInfluencerTermsGate blochează separat, server-side,
 * acțiunile comerciale (coduri de reducere, colecții).
 */
export default function InfluencerTermsGateModal({
  terms,
  onAccepted,
  onDismiss,
}) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // versiunea de acceptat: cea CERUTĂ de cerere, altfel cea publicată
  const currentVersion = terms?.requiredVersion || terms?.currentVersion || "";
  const documentUrl = terms?.documentUrl || "/acord-influenceri";
  const neverAccepted = terms?.reason === "NEVER_ACCEPTED";
  const deadline = terms?.deadlineAt ? new Date(terms.deadlineAt) : null;
  const deadlineLabel =
    deadline && !Number.isNaN(deadline.getTime())
      ? deadline.toLocaleDateString("ro-RO")
      : null;

  async function handleAccept() {
    if (!checked || saving) return;

    setSaving(true);
    setError("");

    try {
      const response = await api("/api/influencer/terms/accept", {
        method: "POST",
      });

      if (response?.ok === false) {
        throw new Error(
          response?.message || "Nu am putut înregistra acceptarea."
        );
      }

      onAccepted?.(response?.terms || null);
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Nu am putut înregistra acceptarea. Încearcă din nou."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="influencer-terms-gate-title"
      >
        <div className={styles.eyebrow}>Program recomandări</div>

        <h2 id="influencer-terms-gate-title" className={styles.title}>
          {neverAccepted
            ? "Acceptă Acordul Programului de Influenceri"
            : "Am actualizat Acordul Programului de Influenceri"}
        </h2>

        <p className={styles.body}>
          {neverAccepted
            ? "Pentru a folosi contul de Influencer, te rugăm să citești și să accepți acordul programului."
            : "Pentru a continua să folosești contul de Influencer, te rugăm să citești și să accepți versiunea actualizată a acordului."}{" "}
          Acesta clarifică, printre altele, modul de calcul al remunerației și
          regulile de atribuire atunci când o comandă poate reveni unui alt
          promotor din platformă.
        </p>

        {deadlineLabel && (
          <p className={styles.body}>
            Termen de acceptare: <strong>{deadlineLabel}</strong>.
          </p>
        )}

        <a
          href={documentUrl}
          target="_blank"
          rel="noreferrer"
          className={styles.link}
        >
          Citește acordul actualizat →
        </a>

        {error && <div className={styles.errorBox}>{error}</div>}

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={checked}
            disabled={saving}
            onChange={(e) => {
              setChecked(e.target.checked);
              setError("");
            }}
          />

          <span>
            Am citit și accept Acordul Programului de Influenceri Artfest,
            versiunea {currentVersion}.
          </span>
        </label>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!checked || saving}
            onClick={handleAccept}
          >
            {saving ? "Se salvează…" : "Accept și continui"}
          </button>

          {onDismiss && (
            <button
              type="button"
              className={styles.primaryButton}
              style={{ background: "transparent", color: "inherit", border: "1px solid currentColor" }}
              disabled={saving}
              onClick={onDismiss}
            >
              Mai târziu
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
