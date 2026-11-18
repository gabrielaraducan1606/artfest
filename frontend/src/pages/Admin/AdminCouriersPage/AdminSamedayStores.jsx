// src/pages/Admin/AdminCouriersPage/AdminSamedayStores.jsx
//
// Admin: „Livrare Sameday prin Artfest” per magazin. Lista magazinelor care au activat
// opțiunea sau sunt restricționate + restricția Artfest (dezactivare / reactivare).
// Restricția NU dezactivează magazinul: statusul, produsele și livrarea vânzătorului rămân.

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";

const PLATFORM_REASON_LABELS = {
  feature_flag_off: "comutatorul SAMEDAY_ARTFEST_DELIVERY_ENABLED este oprit",
  courier_integration_disabled: "integrarea de curierat este oprită",
  awb_live_disabled: "generarea AWB reală este oprită",
  active_environment_missing: "mediul Sameday activ nu este setat",
  platform_environment_missing: "mediul contului Sameday nu este permis",
  platform_account_missing: "contul Sameday Artfest nu este configurat",
  platform_credentials_invalid: "autentificarea contului Sameday a eșuat",
  platform_account_not_active: "contul Sameday Artfest nu este activ",
  awb_not_verified_by_admin: "AWB-ul nu a fost confirmat de Admin",
  no_successful_awb_in_environment: "nu există încă un AWB reușit în acest mediu",
  permanent_account_rejection: "Sameday a respins recent contul (permisiune / contract)",
  admin_verification_older_than_rejection: "confirmarea Admin este mai veche decât ultima respingere",
  readiness_check_failed: "verificarea nu a putut fi făcută",
};

const fmt = (d) => (d ? new Date(d).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "—");

export default function AdminSamedayStores({ styles }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [manualId, setManualId] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api("/api/admin/sameday-delivery/stores"));
    } catch (e) {
      setError(e?.data?.message || "Nu am putut încărca magazinele Sameday.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setDisabled = async (serviceId, disabled) => {
    const id = String(serviceId || "").trim();
    if (!id || busy) return;
    setBusy(id);
    setError("");
    try {
      await api(`/api/admin/sameday-delivery/stores/${encodeURIComponent(id)}`, { method: "PUT", body: { disabled } });
      setManualId("");
      await load();
    } catch (e) {
      setError(e?.data?.message || "Nu am putut salva restricția.");
    } finally {
      setBusy("");
    }
  };

  const platform = data?.platform;
  const stores = data?.stores || [];

  return (
    <section className={styles.card} aria-labelledby="sameday-stores-title">
      <header className={styles.cardHead}>
        <h2 id="sameday-stores-title" className={styles.cardTitle}>
          Livrare Sameday prin Artfest, pe magazin
        </h2>
      </header>
      <p className={styles.messageMuted}>
        Restricția Artfest oprește doar livrarea Sameday pentru magazin; magazinul, produsele și livrarea vânzătorului rămân
        neschimbate.
      </p>

      {platform ? (
        <p className={`${styles.message} ${styles[platform.ready ? "box_ok" : "box_warn"]}`} role="status">
          {platform.ready
            ? `Contul Artfest este pregătit${platform.degraded ? " (erori temporare recente)" : ""}.`
            : `Indisponibilă pentru toți vânzătorii: ${(platform.reasons || []).map((r) => PLATFORM_REASON_LABELS[r] || r).join("; ")}.`}
        </p>
      ) : null}

      {stores.length ? (
        <dl className={styles.details}>
          {stores.map((s) => (
            <div key={s.serviceId}>
              <dt>
                {s.title || "Magazin"} {s.vendorName ? <span className={styles.muted}>· {s.vendorName}</span> : null}
              </dt>
              <dd>
                {s.optedIn ? `Activată de vânzător (${fmt(s.optedInAt)})` : "Neactivată de vânzător"}
                {s.disabledByArtfest ? ` · Dezactivată de Artfest (${fmt(s.disabledAt)})` : ""}{" "}
                <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => setDisabled(s.serviceId, !s.disabledByArtfest)}>
                  {busy === s.serviceId ? "Se salvează…" : s.disabledByArtfest ? "Ridică restricția" : "Dezactivează Sameday"}
                </button>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={styles.messageMuted}>Niciun magazin nu a activat încă livrarea Sameday prin Artfest.</p>
      )}

      <form
        className={styles.trackingForm}
        onSubmit={(e) => {
          e.preventDefault();
          setDisabled(manualId, true);
        }}
      >
        <input
          className={styles.trackingInput}
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          placeholder="ID magazin (VendorService) - restricție preventivă"
          aria-label="ID magazin pentru restricție"
        />
        <button type="submit" className={styles.trackingButton} disabled={!manualId.trim() || Boolean(busy)}>
          Dezactivează
        </button>
      </form>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
