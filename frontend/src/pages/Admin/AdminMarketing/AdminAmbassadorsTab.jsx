import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./AdminMarketingPage.module.css";

export default function AdminAmbassadorsTab() {
  const [overview, setOverview] = useState(null);
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState({
    ambassadorMin: 3,
    goldMin: 10,
    eliteMin: 25,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [overviewRes, listRes, settingsRes] = await Promise.all([
        api("/api/admin/marketing/ambassadors/overview"),
        api("/api/admin/marketing/ambassadors/list"),
        api("/api/admin/marketing/ambassadors/settings"),
      ]);

      setOverview(overviewRes);
      setItems(listRes.items || []);
      setSettings(settingsRes.settings || settings);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      await api("/api/admin/marketing/ambassadors/settings", {
        method: "PUT",
        body: settings,
      });
      await load();
    } finally {
      setSaving(false);
    }
  }
useEffect(() => {
  load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
  if (loading) {
    return <div className={styles.cardMuted}>Se încarcă ambasadorii…</div>;
  }

  return (
    <div className={styles.cardMuted}>
      <div className={styles.marketingStats}>
        <div className={styles.marketingStatItem}>
          <span className={styles.marketingStatLabel}>Creatori total</span>
          <span className={styles.marketingStatVal}>
            {overview?.totalVendors || 0}
          </span>
        </div>

        <div className={styles.marketingStatItem}>
          <span className={styles.marketingStatLabel}>Invitații totale</span>
          <span className={styles.marketingStatVal}>
            {overview?.totalInvites || 0}
          </span>
        </div>

        <div className={styles.marketingStatItem}>
          <span className={styles.marketingStatLabel}>Ambasadori activi</span>
          <span className={styles.marketingStatVal}>
            {overview?.activeAmbassadors || 0}
          </span>
        </div>

        <div className={styles.marketingStatItem}>
          <span className={styles.marketingStatLabel}>Elite</span>
          <span className={styles.marketingStatVal}>
            {overview?.eliteCount || 0}
          </span>
        </div>
      </div>

      <div className={styles.prefsHead}>
        <div>
          <h4>Praguri ambasadori</h4>
          <p className={styles.subtle}>
            Nivelurile se recalculează automat după salvare.
          </p>
        </div>

        <div className={styles.prefsFilters}>
          <input
            type="number"
            value={settings.ambassadorMin}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                ambassadorMin: Number(e.target.value),
              }))
            }
            placeholder="Ambassador"
          />

          <input
            type="number"
            value={settings.goldMin}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                goldMin: Number(e.target.value),
              }))
            }
            placeholder="Gold"
          />

          <input
            type="number"
            value={settings.eliteMin}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                eliteMin: Number(e.target.value),
              }))
            }
            placeholder="Elite"
          />

          <button
            type="button"
            className={styles.prefsRefreshBtn}
            onClick={saveSettings}
            disabled={saving}
          >
            {saving ? "Se salvează…" : "Salvează pragurile"}
          </button>
        </div>
      </div>

      <div className={styles.prefsTableWrap}>
        <table className={styles.prefsTable}>
          <thead>
            <tr>
              <th>Creator</th>
              <th>Email</th>
              <th>Oraș</th>
              <th>Cod referral</th>
              <th>Invitați</th>
              <th>Nivel</th>
              <th>Creat la</th>
            </tr>
          </thead>

          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{row.vendorName || "—"}</td>
                <td>{row.email || "—"}</td>
                <td>{row.city || "—"}</td>
                <td>{row.referralCode}</td>
                <td>{row.invitedCount}</td>
                <td>{row.level}</td>
                <td>
                  {row.createdAt
                    ? new Date(row.createdAt).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}