import { useState } from "react";

import { api } from "../../../lib/api.js";

import styles from "./InfluencerTermsGateModal.module.css";

/*
 * Modal BLOCANT - afișat pe dashboardul de Influencer când
 * terms.outdated === true (vezi GET /api/influencer/me). Spre
 * deosebire de celelalte modaluri din contul de Influencer
 * (InfluencerCollectionsModal, InfluencerDiscountCodesModal), acesta
 * NU se poate închide fără acceptare - nu are buton de închidere,
 * nu se închide la click pe fundal, nu se închide cu Escape.
 *
 * Backend-ul nu se bazează pe acest modal ca unică protecție -
 * enforceInfluencerTermsGate blochează separat, server-side,
 * acțiunile comerciale (coduri de reducere, colecții).
 */
export default function InfluencerTermsGateModal({ terms, onAccepted }) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const currentVersion = terms?.currentVersion || "";
  const documentUrl = terms?.documentUrl || "/acord-influenceri";

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
          Am actualizat Acordul Programului de Influenceri
        </h2>

        <p className={styles.body}>
          Pentru a continua să folosești contul de Influencer, te rugăm să
          citești și să accepți versiunea actualizată a acordului. Acesta
          clarifică, printre altele, modul de calcul al remunerației și
          regulile de atribuire atunci când o comandă poate reveni unui alt
          promotor din platformă.
        </p>

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
        </div>
      </div>
    </div>
  );
}
