// src/pages/Admin/AdminDesktop/tabs/AdminVendorPlansTab.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../../../../lib/api";
import styles from "../AdminDesktop.module.css";

function formatDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

function subKind(sub) {
  if (!sub) return "—";
  const now = new Date();
  const trialEndsAt = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
  if (trialEndsAt && trialEndsAt > now) return "trial";
  return "paid";
}

export default function AdminVendorPlansTab({ initial, onRefresh }) {
  const [q, setQ] = useState("");
  const [onlyWithSub, setOnlyWithSub] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [data, setData] = useState(() => initial || { total: 0, items: [] });

  useEffect(() => {
    setData(initial || { total: 0, items: [] });
  }, [initial]);

  const fetchList = useCallback(
    async ({ skip = 0 } = {}) => {
      setLoading(true);
      setError("");
      try {
        const qs = new URLSearchParams();
        qs.set("take", "50");
        qs.set("skip", String(skip));
        if (q.trim()) qs.set("q", q.trim());
        if (onlyWithSub) qs.set("onlyWithSubscription", "1");

        const d = await api(`/api/admin/vendors/plans?${qs.toString()}`);
        setData({ total: d.total ?? 0, items: d.items ?? [] });
      } catch (e) {
        setError(e?.data?.message || e?.message || "Nu am putut încărca abonamentele.");
      } finally {
        setLoading(false);
      }
    },
    [q, onlyWithSub]
  );

  const handleRefresh = async () => {
    await fetchList({ skip: 0 });
    await onRefresh?.();
  };

  const items = useMemo(() => data.items || [], [data]);

  return (
    <div>
      <div className={styles.filtersRow}>
        <label>
          <span>Caută</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Vendor, user email, nume..."
            type="text"
          />
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={onlyWithSub}
            onChange={(e) => setOnlyWithSub(e.target.checked)}
          />
          <span>Doar cu subscription</span>
        </label>

        <div className={styles.filtersActions}>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => {
              setQ("");
              setOnlyWithSub(false);
            }}
            title="Resetează filtre"
          >
            Reset
          </button>

          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => fetchList({ skip: 0 })}
            disabled={loading}
            title="Caută"
          >
            {loading ? "Se caută…" : "Caută"}
          </button>

          <button
            type="button"
            className={styles.resetBtn}
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh"
          >
            Refresh
          </button>

          <span className={styles.filtersCount}>{data.total ?? items.length} rezultate</span>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {!loading && !items.length ? (
        <p className={styles.subtle}>Nu există rezultate.</p>
      ) : null}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>User</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Tip</th>
              <th>EndAt</th>
              <th>TrialEndsAt</th>
              <th>Stripe sub</th>
              <th>Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <VendorPlanRow
                key={row.vendorId}
                row={row}
                onUpdated={async () => {
                  // simplu: reîncarcă lista curentă
                  await fetchList({ skip: 0 });
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VendorPlanRow({ row, onUpdated }) {
  const vendorId = row.vendorId;
  const vendorName = row.displayName || "—";
  const userEmail = row.user?.email || "—";

  const current = row.currentSubscription || null;
  const latest = row.latestSubscription || null;
  const shown = current || latest;

  const planLabel = shown?.plan?.name || shown?.plan?.code || "—";
  const status = shown?.status || "—";
  const kind = subKind(shown);
  const endAt = shown?.endAt || null;
  const trialEndsAt = shown?.trialEndsAt || null;

  const stripeSubId = shown?.stripeSubscriptionId || shown?.meta?.stripeSubscriptionId || null;

  const [busy, setBusy] = useState(false);
  const [trialDays, setTrialDays] = useState("");

  const call = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await onUpdated?.();
    } finally {
      setBusy(false);
    }
  };

  const setTrial = async () => {
    const n = Number(trialDays || 0);
    await call(() =>
      api(`/api/admin/vendors/${vendorId}/subscription/trial`, {
        method: "PATCH",
        body: { trialDays: Number.isFinite(n) ? n : 0 },
      })
    );
    setTrialDays("");
  };

  const syncStripe = async () => {
    await call(() => api(`/api/admin/vendors/${vendorId}/subscription/stripe/sync`, { method: "POST" }));
  };

  const cancelStripe = async () => {
    if (!window.confirm("Sigur vrei să setezi cancel_at_period_end = true?")) return;
    await call(() => api(`/api/admin/vendors/${vendorId}/subscription/stripe/cancel`, { method: "POST" }));
  };

  const resumeStripe = async () => {
    await call(() => api(`/api/admin/vendors/${vendorId}/subscription/stripe/resume`, { method: "POST" }));
  };

  return (
    <tr>
      <td>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <b>{vendorName}</b>
          <span className={styles.subtle}>id: {vendorId}</span>
        </div>
      </td>

      <td>{userEmail}</td>

      <td>{planLabel}</td>

      <td>{status}</td>

      <td>{kind}</td>

      <td>{formatDate(endAt)}</td>

      <td>{formatDate(trialEndsAt)}</td>

      <td>
        {stripeSubId ? (
          <code title={stripeSubId}>{String(stripeSubId).slice(0, 18)}…</code>
        ) : (
          "—"
        )}
      </td>

      <td>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className={styles.resetBtn} onClick={syncStripe} disabled={busy}>
            Sync Stripe
          </button>

          <button type="button" className={styles.resetBtn} onClick={cancelStripe} disabled={busy}>
            Cancel
          </button>

          <button type="button" className={styles.resetBtn} onClick={resumeStripe} disabled={busy}>
            Resume
          </button>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              style={{ width: 90 }}
              type="number"
              min="0"
              max="365"
              placeholder="trial zile"
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              disabled={busy}
            />
            <button type="button" className={styles.resetBtn} onClick={setTrial} disabled={busy}>
              Set trial
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}
