import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../../../../lib/api";
import styles from "./css/ConnectPayouts.module.css";

const requirementLabels = {
  "business_profile.url": "Website / pagină online",
  external_account: "Cont bancar / IBAN",

  "company.name": "Denumire firmă",
  "company.tax_id": "CUI / cod fiscal",
  "company.phone": "Telefon firmă",
  "company.address.city": "Oraș firmă",
  "company.address.line1": "Adresă firmă",
  "company.address.postal_code": "Cod poștal firmă",
  "company.address.country": "Țară firmă",

  "company.directors_provided": "Date despre administratori",
  "company.executives_provided": "Date despre reprezentanți",
  "company.owners_provided": "Date despre beneficiarii reali",

  "directors.first_name": "Prenume administrator",
  "directors.last_name": "Nume administrator",
  "directors.dob.day": "Zi naștere administrator",
  "directors.dob.month": "Lună naștere administrator",
  "directors.dob.year": "An naștere administrator",
  "directors.address.city": "Oraș administrator",
  "directors.address.line1": "Adresă administrator",
  "directors.address.postal_code": "Cod poștal administrator",
  "directors.email": "Email administrator",
  "directors.phone": "Telefon administrator",

  "individual.first_name": "Prenume",
  "individual.last_name": "Nume",
  "individual.dob.day": "Zi naștere",
  "individual.dob.month": "Lună naștere",
  "individual.dob.year": "An naștere",
  "individual.email": "Email",
  "individual.phone": "Telefon",
  "individual.address.city": "Oraș",
  "individual.address.line1": "Adresă",
  "individual.address.postal_code": "Cod poștal",
  "individual.id_number": "CNP / document identificare",
  "individual.verification.document": "Document de identitate",
};

function labelRequirement(item) {
  return requirementLabels[item] || item;
}

export default function ConnectPayoutsTab() {
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState(null);

  const payoutsLocked = false;
  const activationDateText = "17 mai";

  const hasAccount = !!status?.hasAccount;
  const payoutsEnabled = !!status?.payouts_enabled;
  const chargesEnabled = !!status?.charges_enabled;
  const detailsSubmitted = !!status?.details_submitted;

  const due = Array.isArray(status?.requirements_due)
    ? status.requirements_due
    : [];

const fullyEnabled = hasAccount && chargesEnabled && payoutsEnabled;

  const pendingVerification =
    hasAccount &&
    detailsSubmitted &&
    !chargesEnabled &&
    !payoutsEnabled;

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setErr("");

    try {
      const d = await api("/api/vendors/stripe/connect/status", {
        method: "GET",
      });

      setStatus(d);
    } catch (e) {
      setErr(e?.message || "Nu am putut verifica statusul Stripe.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const startOnboarding = useCallback(async () => {
    if (payoutsLocked) {
      setErr(
        `Activarea încasărilor va fi disponibilă după ${activationDateText}.`
      );
      return;
    }

    setStarting(true);
    setErr("");

    try {
      const d = await api("/api/vendors/stripe/connect/start", {
        method: "POST",
      });

      if (!d?.url) {
        throw new Error("Nu am primit linkul de onboarding Stripe.");
      }

      window.location.href = d.url;
    } catch (e) {
      setErr(e?.message || "Nu am putut porni onboarding-ul Stripe.");
      setStarting(false);
    }
  }, [payoutsLocked]);

  const continueOnboarding = useCallback(async () => {
    if (payoutsLocked) {
      setErr(
        `Continuarea onboarding-ului va fi disponibilă după ${activationDateText}.`
      );
      return;
    }

    setStarting(true);
    setErr("");

    try {
      const d = await api("/api/vendors/stripe/connect/continue", {
        method: "POST",
      });

      if (!d?.url) {
        throw new Error("Nu am primit linkul de continuare Stripe.");
      }

      window.location.href = d.url;
    } catch (e) {
      setErr(e?.message || "Nu am putut continua onboarding-ul Stripe.");
      setStarting(false);
    }
  }, [payoutsLocked]);

  const disconnectStripe = useCallback(async () => {
  const confirmed = window.confirm(
    "Sigur vrei să dezactivezi Stripe Connect? Nu vei mai putea primi plăți online cu cardul."
  );

  if (!confirmed) return;

  setStarting(true);
  setErr("");

  try {
    await api("/api/vendors/stripe/connect", {
      method: "DELETE",
    });

    await loadStatus();
  } catch (e) {
    setErr(e?.message || "Nu am putut dezactiva Stripe Connect.");
  } finally {
    setStarting(false);
  }
}, [loadStatus]);

  if (loading) {
    return (
      <div className={styles.loading}>
        Se verifică statusul încasărilor…
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3 className={styles.title}>Încasări prin platformă</h3>

        <p className={styles.subtitle}>
  Opțional: activează Stripe Connect doar dacă vrei să primești plăți online
  cu cardul.
</p>
      </div>

      <div className={`${styles.card} ${styles.cardSoft}`}>
        <span className={styles.badge}>Stripe Connect</span>

      <p className={styles.text}>
  Platforma folosește <strong>Stripe Connect</strong> pentru plățile online.
  Activarea este opțională. Magazinul tău poate fi publicat și fără Stripe,
  însă clienții nu vor putea plăti online cu cardul până nu activezi
  încasările.
</p>

        <p className={styles.text}>
          În Stripe vei completa datele necesare pentru verificare și pentru
          transferul banilor către contul tău bancar.
        </p>

        <ul className={styles.list}>
          <li>Nume / denumire firmă sau PFA</li>
          <li>Date de identificare cerute de Stripe</li>
          <li>IBAN / cont bancar pentru încasări</li>
        </ul>

        <p className={styles.text}>
          Datele bancare sunt completate direct în Stripe, nu în Artfest.
        </p>
      </div>

      {payoutsLocked && (
        <div className={styles.notice}>
          <h4>Activarea încasărilor nu este necesară încă.</h4>

          <p>
            Formularul Stripe va deveni disponibil după{" "}
            <strong>{activationDateText}</strong>. Până atunci poți folosi
            platforma fără să activezi încasările.
          </p>
        </div>
      )}

      {err && <div className={styles.error}>{err}</div>}

      {!hasAccount && (
        <>
          <div className={styles.card}>
            <h4 className={styles.cardTitle}>Stripe nu este conectat</h4>

            <p className={styles.text}>
  Activarea Stripe Connect este opțională. Fără Stripe, magazinul rămâne
  activ și vizibil în platformă, însă plata online cu cardul nu va fi
  disponibilă pentru clienți.
</p>
          </div>

          <div className={styles.buttonRow}>
            <button
              className={styles.primaryButton}
              onClick={startOnboarding}
              disabled={starting || payoutsLocked}
            >
              {starting ? "Se deschide Stripe…" : "Activează încasări"}
            </button>

            <button
              className={styles.secondaryButton}
              onClick={loadStatus}
              disabled={starting}
            >
              Reîncarcă status
            </button>
            
          </div>
        </>
      )}

      {hasAccount && !fullyEnabled && (
        <>
          <div className={styles.notice}>
            <h4>
              {pendingVerification
                ? "Stripe verifică datele contului"
                : "Cont Stripe început, dar incomplet"}
            </h4>

            <p>
              {pendingVerification
                ? "Datele au fost trimise către Stripe și sunt în curs de verificare. Activarea poate dura până la 24 de ore."
                : "Contul Stripe există, dar încă nu este complet activ pentru transferuri."}
            </p>

            <div className={styles.statusGrid}>
              <div className={styles.statusItem}>
                <span className={styles.statusLabel}>Plăți online</span>

                <span className={styles.statusValue}>
                  {chargesEnabled ? "Active" : "Inactive"}
                </span>
              </div>

              <div className={styles.statusItem}>
                <span className={styles.statusLabel}>
                  Transferuri bancare
                </span>

                <span className={styles.statusValue}>
                  {payoutsEnabled ? "Active" : "Inactive"}
                </span>
              </div>

              <div className={styles.statusItem}>
                <span className={styles.statusLabel}>Date trimise</span>

                <span className={styles.statusValue}>
                  {detailsSubmitted ? "Da" : "Nu"}
                </span>
              </div>
            </div>
          </div>

          {due.length > 0 && (
            <div className={styles.card}>
              <h4 className={styles.cardTitle}>
                Stripe mai cere următoarele informații:
              </h4>

              <ul className={styles.list}>
                {due.slice(0, 12).map((item) => (
                  <li key={item}>{labelRequirement(item)}</li>
                ))}
              </ul>

              {due.length > 12 && (
                <p className={styles.text}>
                  …și încă {due.length - 12}
                </p>
              )}

              <p className={styles.text}>
                Completează aceste informații în pagina Stripe de onboarding.
              </p>
            </div>
          )}

          <div className={styles.buttonRow}>
            <button
              className={styles.primaryButton}
              onClick={continueOnboarding}
              disabled={starting || payoutsLocked}
            >
              {starting ? "Se deschide Stripe…" : "Continuă onboarding"}
            </button>

            <button
              className={styles.secondaryButton}
              onClick={loadStatus}
              disabled={starting}
            >
              Reîncarcă status
            </button>
            <button
  className={styles.secondaryButton}
  onClick={disconnectStripe}
  disabled={starting}
>
  Dezactivează Stripe
</button>
          </div>
        </>
      )}

      {fullyEnabled && (
        <>
          <div className={styles.success}>
            <h4>Încasările sunt active</h4>

            <p>
  Contul tău Stripe este activ. Acum poți accepta plăți online cu cardul,
  iar încasările vor fi transferate în contul tău bancar.
</p>
          </div>

          <div className={styles.card}>
            <div className={styles.statusGrid}>
              <div className={styles.statusItem}>
                <span className={styles.statusLabel}>Plăți online</span>

                <span className={styles.statusValue}>
                  {chargesEnabled ? "Active" : "Inactive"}
                </span>
              </div>

              <div className={styles.statusItem}>
                <span className={styles.statusLabel}>Transferuri</span>

                <span className={styles.statusValue}>
                  {payoutsEnabled ? "Active" : "Inactive"}
                </span>
              </div>

              <div className={styles.statusItem}>
                <span className={styles.statusLabel}>Date trimise</span>

                <span className={styles.statusValue}>
                  {detailsSubmitted ? "Da" : "Nu"}
                </span>
              </div>
            </div>
          </div>

          <div className={styles.buttonRow}>
            <button
              className={styles.secondaryButton}
              onClick={loadStatus}
            >
              Reîncarcă status
            </button>
            <button
  className={styles.secondaryButton}
  onClick={disconnectStripe}
  disabled={starting}
>
  Dezactivează Stripe
</button>
          </div>
        </>
      )}
    </div>
  );
}