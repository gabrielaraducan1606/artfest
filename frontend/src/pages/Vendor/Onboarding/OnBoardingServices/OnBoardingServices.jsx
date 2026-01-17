import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";
import styles from "./OnBoardingServices.module.css";

// ✨ doar aceste coduri sunt permise momentan
const ALLOWED_CODES = new Set(["products"]);
// ✨ cardul „special” care trebuie să fie primul
const FEATURED_CODE = "products";

export default function OnboardingServices() {
  const [types, setTypes] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [existing, setExisting] = useState(new Set());
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // ✅ rezilient: dacă /me/services dă 401/404, nu mai cade tot
        const [st, ms] = await Promise.all([
          api("/api/service-types").catch(() => ({ items: [] })),
          api("/api/vendors/me/services").catch(() => ({ items: [] })),
        ]);
        if (!alive) return;

        const fetched = st.items || [];

        // ✨ ordonează astfel încât FEATURED_CODE să fie primul; restul alfabetic
        const ordered = [...fetched].sort((a, b) => {
          if (a.code === FEATURED_CODE) return -1;
          if (b.code === FEATURED_CODE) return 1;
          return a.name.localeCompare(b.name, "ro", { sensitivity: "base" });
        });

        setTypes(ordered);
        setExisting(new Set((ms.items || []).map((s) => s.type?.code || s.typeCode)));
      } catch {
        if (!alive) return;
        setTypes([]); setExisting(new Set());
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  function toggle(code) {
    // ✨ nu permite selectarea celor indisponibile momentan
    if (!ALLOWED_CODES.has(code) || existing.has(code) || isSubmitting) return;
    const s = new Set(selected);
    s.has(code) ? s.delete(code) : s.add(code);
    setSelected(s);
  }

  async function refreshExisting() {
    try {
      const ms = await api("/api/vendors/me/services");
      const ex = new Set((ms.items || []).map((s) => s.type?.code || s.typeCode));
      setExisting(ex);
      return ex;
    } catch {
      return existing;
    }
  }

  async function createDrafts() {
    setError("");
    setIsSubmitting(true);
    try {
      const ex = await refreshExisting();
      // ✨ creează doar serviciile permise
      const toCreate = [...selected].filter((code) => ALLOWED_CODES.has(code) && !ex.has(code));
      if (toCreate.length === 0) {
        window.location.href = "/onboarding/details";
        return;
      }
      await Promise.all(
        toCreate.map(async (code) => {
          try {
            await api("/api/vendors/me/services", { method: "POST", body: { typeCode: code } });
          } catch (e) {
            const msg = (e && (e.status || e.message || "")).toString();
            if (String(e?.status) === "409" || /exist|dup(licat)?|unic/i.test(msg)) return;
            throw e;
          }
        })
      );
      window.location.href = "/onboarding/details";
    } catch (e) {
      setError(e?.message || "Eroare la crearea drafturilor");
    } finally {
      setIsSubmitting(false);
    }
  }

const canContinue = useMemo(
  // ✅ activ dacă ai selectat ceva SAU ai deja servicii adăugate
  // ❌ dezactivat doar dacă nu ai nici selectate, nici existente
  () => (selected.size > 0 || existing.size > 0) && !isSubmitting && !loading,
  [selected, existing, isSubmitting, loading]
);

  return (
    <section className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>Alege serviciile pe care le oferi</h1>
        <p className={styles.subtitle}>
          Momentan, este disponibil doar <strong>Magazin / Produse</strong>. Celelalte vor fi disponibile în curând.
        </p>
      </header>

      <div className={styles.grid}>
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={`sk-${i}`} className={`${styles.card} ${styles.skeleton}`} aria-hidden />
            ))
          : types.map((t) => {
              const isExisting = existing.has(t.code);
              const isAvailable = ALLOWED_CODES.has(t.code); // ✨
              const checked = selected.has(t.code) || isExisting;
              const disabled = !isAvailable || isExisting || isSubmitting;

              return (
                <label
                  key={t.code}
                  className={[
                    styles.card,
                    checked ? styles.cardChecked : "",
                    isExisting ? styles.cardExisting : "",
                    !isAvailable ? styles.cardDisabled : "",
                  ].join(" ").trim()}
                >
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(t.code)}
                  />
                  <div className={styles.cardHeader}>
                    <span className={styles.checkmark} aria-hidden />
                    <span className={styles.cardTitle}>{t.name}</span>
                  </div>
                  <div className={styles.cardMeta}>{t.code}</div>

                  {isExisting && <span className={styles.badge}>Deja adăugat</span>}
                  {!isExisting && !isAvailable && (
                    <span className={styles.badgeMuted}>Indisponibil momentan</span>
                  )}
                </label>
              );
            })}
      </div>

      <div className={styles.footer}>
        <button className={styles.primaryBtn} disabled={!canContinue} onClick={createDrafts}>
          {isSubmitting ? "Se salvează…" : "Continuă"}
        </button>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </div>
    </section>
  );
}
