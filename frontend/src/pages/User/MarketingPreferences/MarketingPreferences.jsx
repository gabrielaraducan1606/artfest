// src/pages/MarketingPreferences/MarketingPreferences.jsx
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./MarketingPreferences.module.css";

// UI-ul tău intern: un master toggle + 4 checkbox-uri
const DEFAULT_STATE = {
  emailMarketingEnabled: true,
  categories: {
    platformNews: true,      // noutăți & colecții noi din magazine
    followedVendors: true,   // produse din magazinele pe care le urmărești
    recommendations: true,   // recomandări de produse pentru evenimente
    surveys: false,          // chestionare & feedback
  },
};

export default function MarketingPreferences() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [emailMarketingEnabled, setEmailMarketingEnabled] = useState(
    DEFAULT_STATE.emailMarketingEnabled
  );
  const [categories, setCategories] = useState(DEFAULT_STATE.categories);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ============================
  //    LOAD FROM BACKEND (GET)
  // ============================
  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      setSuccess("");

      try {
        // backend: GET /api/me/marketing-preferences
        const data = await api("/api/me/marketing-preferences");

        if (!active) return;

        // răspuns backend:
        // {
        //   sourcePreference: "PLATFORM_ONLY" | "FOLLOWED_VENDORS" | ...,
        //   topics: ["RECOMMENDATIONS", "PROMOTIONS", ...],
        //   emailEnabled: true/false,
        //   smsEnabled: bool,
        //   pushEnabled: bool,
        //   from: "db" | "default"
        // }

        const {
          sourcePreference,
          topics,
          emailEnabled,
        } = data || {};

        const hasTopics = Array.isArray(topics) && topics.length > 0;
        const enabled = !!emailEnabled && hasTopics && sourcePreference !== "NONE";

        setEmailMarketingEnabled(enabled);

        // mapăm topic-urile din backend pe categoriile din UI
        const t = Array.isArray(topics) ? topics : [];

        setCategories({
          platformNews: t.includes("PROMOTIONS"),      // noutăți & oferte
          followedVendors: t.includes("RECOMMENDATIONS"), // folosim RECOMMENDATIONS pt magazine urmărite
          recommendations: t.includes("EVENTS"),       // îl mapăm pe EVENTS
          surveys: t.includes("FEEDBACK"),             // feedback / chestionare
        });
      } catch (e) {
        if (!active) return;
        const msg =
          e?.data?.error ||
          e?.message ||
          "Nu am putut încărca preferințele de marketing.";
        setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  // ============================
  //       SAVE HANDLER (PUT)
  // ============================
  const handleSave = async (e) => {
    e.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      let payload;

      if (!emailMarketingEnabled) {
        // dacă user-ul dezactivează complet marketing-ul:
        payload = {
          sourcePreference: "NONE",
          topics: [],
          emailEnabled: false,
          smsEnabled: false,
          pushEnabled: false,
        };
      } else {
        const topics = [];

        if (categories.platformNews) {
          topics.push("PROMOTIONS");
        }
        if (categories.followedVendors) {
          topics.push("RECOMMENDATIONS");
        }
        if (categories.recommendations) {
          topics.push("EVENTS");
        }
        if (categories.surveys) {
          topics.push("FEEDBACK");
        }

        // dacă user-ul vrea conținut din magazinele urmărite, punem un sourcePreference mai "avansat"
        const sourcePreference = categories.followedVendors
          ? "FOLLOWED_AND_PAST_PURCHASES"
          : "PLATFORM_ONLY";

        // important: dacă user-ul marchează emailMarketingEnabled,
        // dar nu are niciun topic bifat, nu are sens -> trimitem NONE
        if (topics.length === 0) {
          payload = {
            sourcePreference: "NONE",
            topics: [],
            emailEnabled: false,
            smsEnabled: false,
            pushEnabled: false,
          };
        } else {
          payload = {
            sourcePreference,
            topics,
            emailEnabled: true,
            smsEnabled: false, // poți extinde UI-ul mai târziu
            pushEnabled: false,
          };
        }
      }

      // backend așteaptă PUT, nu POST
      await api("/api/me/marketing-preferences", {
        method: "PUT",
        body: payload,
      });

      setSuccess("Preferințele tale au fost salvate.");
    } catch (e2) {
      const msg =
        e2?.data?.error ||
        e2?.message ||
        "Nu am putut salva preferințele de marketing.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const disabledCategories = !emailMarketingEnabled;

  // ============================
  //          RENDER
  // ============================
  return (
    <section className={styles.pageWrapper}>
      <header>
        <h1 className={styles.title}>Preferințe marketing</h1>
        <p className={styles.subtitle}>
          Alege ce fel de emailuri despre produse din magazinele Artfest vrei
          să primești. Emailurile esențiale (comenzi, facturi, securitate)
          vor fi trimise în continuare, indiferent de setări.
        </p>
      </header>

      <form className={styles.card} onSubmit={handleSave}>
        {/* ==================== Master toggle ==================== */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Emailuri despre produse</h3>
          <p className={styles.sectionDescription}>
            Controlează dacă vrei să primești emailuri de marketing cu produse,
            colecții și oferte din magazinele Artfest.
          </p>

          <label className={styles.checkboxItem}>
            <input
              type="checkbox"
              checked={emailMarketingEnabled}
              onChange={(e) => setEmailMarketingEnabled(e.target.checked)}
            />
            <span className={styles.checkboxLabel}>
              <strong>
                Vreau să primesc emailuri cu produse și oferte din magazine
              </strong>
              <br />
              Noutăți și idei de produse relevante pentru evenimentele mele,
              trimise ocazional.
            </span>
          </label>
        </section>

        {/* ==================== Tipuri de conținut ==================== */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Tipuri de conținut</h3>
          <p className={styles.sectionDescription}>
            Alege ce fel de emailuri despre produse te interesează. Dacă
            dezactivezi opțiunea de mai sus, aceste preferințe vor fi ignorate.
          </p>

          <div className={styles.checkboxGrid}>
            {/* platformNews -> PROMOTIONS */}
            <label className={styles.checkboxItem}>
              <input
                type="checkbox"
                checked={categories.platformNews}
                disabled={disabledCategories}
                onChange={(e) =>
                  setCategories((prev) => ({
                    ...prev,
                    platformNews: e.target.checked,
                  }))
                }
              />
              <span
                className={styles.checkboxLabel}
                style={disabledCategories ? { opacity: 0.6 } : undefined}
              >
                <strong>Noutăți & colecții noi din magazine</strong>
                <br />
                Lansări de produse, colecții tematice și selecții speciale din
                magazinele Artfest.
              </span>
            </label>

            {/* followedVendors -> RECOMMENDATIONS + FOLLOWED_AND_PAST_PURCHASES */}
            <label className={styles.checkboxItem}>
              <input
                type="checkbox"
                checked={categories.followedVendors}
                disabled={disabledCategories}
                onChange={(e) =>
                  setCategories((prev) => ({
                    ...prev,
                    followedVendors: e.target.checked,
                  }))
                }
              />
              <span
                className={styles.checkboxLabel}
                style={disabledCategories ? { opacity: 0.6 } : undefined}
              >
                <strong>Magazine și produse pe care le urmărești</strong>
                <br />
                Noutăți și recomandări de produse legate de magazinele și
                listele tale de favorite.
              </span>
            </label>

            {/* recommendations -> EVENTS */}
            <label className={styles.checkboxItem}>
              <input
                type="checkbox"
                checked={categories.recommendations}
                disabled={disabledCategories}
                onChange={(e) =>
                  setCategories((prev) => ({
                    ...prev,
                    recommendations: e.target.checked,
                  }))
                }
              />
              <span
                className={styles.checkboxLabel}
                style={disabledCategories ? { opacity: 0.6 } : undefined}
              >
                <strong>Recomandări de produse pentru evenimentele tale</strong>
                <br />
                Idei de produse și servicii potrivite pentru tipurile de
                evenimente pe care le organizezi.
              </span>
            </label>

            {/* surveys -> FEEDBACK */}
            <label className={styles.checkboxItem}>
              <input
                type="checkbox"
                checked={categories.surveys}
                disabled={disabledCategories}
                onChange={(e) =>
                  setCategories((prev) => ({
                    ...prev,
                    surveys: e.target.checked,
                  }))
                }
              />
              <span
                className={styles.checkboxLabel}
                style={disabledCategories ? { opacity: 0.6 } : undefined}
              >
                <strong>Chestionare & feedback</strong>
                <br />
                Ocazional te putem întreba ce tip de produse cauți sau cum
                ți s-a părut selecția din magazine.
              </span>
            </label>
          </div>
        </section>

        {/* ==================== Buttons & messages ==================== */}
        <button
          type="submit"
          className={styles.saveButton}
          disabled={saving || loading}
        >
          {saving ? "Se salvează…" : "Salvează preferințele"}
        </button>

        {success && <p className={styles.successMsg}>{success}</p>}
        {error && <p className={styles.errorMsg}>{error}</p>}

        {loading && !error && (
          <p className={styles.sectionDescription} style={{ marginTop: 12 }}>
            Se încarcă preferințele tale…
          </p>
        )}
      </form>
    </section>
  );
}
