// src/pages/Admin/AdminDesktop/tabs/AdminVendorPlansTab.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "../../../../lib/api";
import styles from "../AdminDesktop.module.css";

const TAKE = 50;

function formatDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

function formatDays(n) {
  if (n === null || n === undefined) return "—";
  if (!Number.isFinite(Number(n))) return "—";
  return `${n} zile`;
}

function prettyStatus(status) {
  if (!status) return "—";
  return String(status).replaceAll("_", " ");
}

function billingLabel(state) {
  switch (state) {
    case "trial":
      return "Trial";
    case "paid":
      return "Plătit";
    case "past_due":
      return "Plată întârziată";
    case "unpaid":
      return "Neplătit";
    case "canceling":
      return "Se anulează";
    case "canceled":
      return "Anulat";
    case "expired":
      return "Expirat";
    case "pending":
      return "În așteptare";
    case "none":
      return "Fără abonament";
    default:
      return prettyStatus(state);
  }
}

function badgeStyle(state) {
  if (state === "paid" || state === "trial") {
    return {
      padding: "4px 8px",
      borderRadius: 999,
      background: "#dcfce7",
      color: "#166534",
      fontWeight: 700,
      fontSize: 12,
      whiteSpace: "nowrap",
    };
  }

  if (state === "past_due" || state === "pending" || state === "canceling") {
    return {
      padding: "4px 8px",
      borderRadius: 999,
      background: "#fef3c7",
      color: "#92400e",
      fontWeight: 700,
      fontSize: 12,
      whiteSpace: "nowrap",
    };
  }

  if (
    state === "unpaid" ||
    state === "canceled" ||
    state === "expired" ||
    state === "none"
  ) {
    return {
      padding: "4px 8px",
      borderRadius: 999,
      background: "#fee2e2",
      color: "#991b1b",
      fontWeight: 700,
      fontSize: 12,
      whiteSpace: "nowrap",
    };
  }

  return {
    padding: "4px 8px",
    borderRadius: 999,
    background: "#f3f4f6",
    color: "#374151",
    fontWeight: 700,
    fontSize: 12,
    whiteSpace: "nowrap",
  };
}

const BILLING_STATES = [
  "",
  "trial",
  "paid",
  "past_due",
  "unpaid",
  "canceling",
  "canceled",
  "expired",
  "pending",
  "none",
];

export default function AdminVendorPlansTab({ initial, onRefresh }) {
  const [q, setQ] = useState("");
  const [billingState, setBillingState] = useState("");
  const [onlyWithSub, setOnlyWithSub] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [page, setPage] = useState(1);
  const [data, setData] = useState(() => initial || { total: 0, items: [] });

  useEffect(() => {
    setData(initial || { total: 0, items: [] });
    setPage(1);
  }, [initial]);

  const items = useMemo(() => data.items || [], [data]);
  const total = data.total ?? items.length;
  const totalPages = Math.max(1, Math.ceil(total / TAKE));

  const fetchList = useCallback(
    async ({ skip = 0 } = {}) => {
      setLoading(true);
      setError("");

      try {
        const qs = new URLSearchParams();
        qs.set("take", String(TAKE));
        qs.set("skip", String(skip));

        if (q.trim()) qs.set("q", q.trim());
        if (billingState) qs.set("billingState", billingState);
        if (onlyWithSub) qs.set("onlyWithSubscription", "1");

        const d = await api(`/api/admin/vendors/plans?${qs.toString()}`);
        setData({ total: d.total ?? 0, items: d.items ?? [] });
      } catch (e) {
        setError(
          e?.data?.message ||
            e?.message ||
            "Nu am putut încărca abonamentele."
        );
      } finally {
        setLoading(false);
      }
    },
    [q, billingState, onlyWithSub]
  );

  const goToPage = async (nextPage) => {
    const safePage = Math.min(Math.max(1, nextPage), totalPages);
    setPage(safePage);
    await fetchList({ skip: (safePage - 1) * TAKE });
  };

  const searchFromFirstPage = async () => {
    setPage(1);
    await fetchList({ skip: 0 });
  };

  const handleRefresh = async () => {
    await fetchList({ skip: (page - 1) * TAKE });
    await onRefresh?.();
  };

  const handleReset = () => {
    setQ("");
    setBillingState("");
    setOnlyWithSub(false);
    setPage(1);
  };

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

        <label>
          <span>Status abonament</span>
          <select
            value={billingState}
            onChange={(e) => setBillingState(e.target.value)}
          >
            {BILLING_STATES.map((st) => (
              <option key={st || "all"} value={st}>
                {st ? billingLabel(st) : "Toate"}
              </option>
            ))}
          </select>
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
            onClick={handleReset}
            title="Resetează filtre"
          >
            Reset
          </button>

          <button
            type="button"
            className={styles.resetBtn}
            onClick={searchFromFirstPage}
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

          <span className={styles.filtersCount}>{total} rezultate</span>
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
              <th>Billing</th>
              <th>Status DB</th>
              <th>Zile rămase</th>
              <th>Trial</th>
              <th>Stripe</th>
              <th>Blocked</th>
              <th>Acțiuni</th>
            </tr>
          </thead>

          <tbody>
            {items.map((row) => (
              <VendorPlanRow
                key={row.vendorId}
                row={row}
                onUpdated={async () => {
                  await fetchList({ skip: (page - 1) * TAKE });
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {total > TAKE ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            justifyContent: "flex-end",
            marginTop: 16,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => goToPage(1)}
            disabled={loading || page <= 1}
          >
            Prima
          </button>

          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => goToPage(page - 1)}
            disabled={loading || page <= 1}
          >
            Înapoi
          </button>

          <span className={styles.filtersCount}>
            Pagina {page} din {totalPages}
          </span>

          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => goToPage(page + 1)}
            disabled={loading || page >= totalPages}
          >
            Înainte
          </button>

          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => goToPage(totalPages)}
            disabled={loading || page >= totalPages}
          >
            Ultima
          </button>
        </div>
      ) : null}
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

  const billing = row.billing || {};
  const state = billing.state || shown?.billingState || shown?.status || "none";

  const planLabel = shown?.plan?.name || shown?.plan?.code || "—";
  const dbStatus = shown?.status || "—";
  const endAt = shown?.endAt || null;
  const trialEndsAt = shown?.trialEndsAt || null;

  const stripeSubId =
    shown?.stripeSubscriptionId || shown?.meta?.stripeSubscriptionId || null;

  const stripeStatus =
    billing.stripeStatus ||
    shown?.stripeStatus ||
    shown?.meta?.stripeStatus ||
    "—";

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
    await call(() =>
      api(`/api/admin/vendors/${vendorId}/subscription/stripe/sync`, {
        method: "POST",
      })
    );
  };

  const cancelStripe = async () => {
    if (!window.confirm("Sigur vrei să setezi cancel_at_period_end = true?")) {
      return;
    }

    await call(() =>
      api(`/api/admin/vendors/${vendorId}/subscription/stripe/cancel`, {
        method: "POST",
      })
    );
  };

  const resumeStripe = async () => {
    await call(() =>
      api(`/api/admin/vendors/${vendorId}/subscription/stripe/resume`, {
        method: "POST",
      })
    );
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

      <td>
        <span style={badgeStyle(state)}>{billingLabel(state)}</span>
        {billing.cancelAtPeriodEnd ? (
          <div className={styles.subtle}>cancel at period end</div>
        ) : null}
      </td>

      <td>{prettyStatus(dbStatus)}</td>

      <td>
        <div>{formatDays(billing.daysLeft)}</div>
        <div className={styles.subtle}>{formatDate(endAt)}</div>
      </td>

      <td>
        <div>{formatDays(billing.trialDaysLeft)}</div>
        <div className={styles.subtle}>{formatDate(trialEndsAt)}</div>
      </td>

      <td>
        <div>
          Stripe status: <b>{prettyStatus(stripeStatus)}</b>
        </div>
        {stripeSubId ? (
          <code title={stripeSubId}>{String(stripeSubId).slice(0, 18)}…</code>
        ) : (
          <span className={styles.subtle}>fără Stripe sub</span>
        )}
      </td>

      <td>
        {billing.isBlocked ? (
          <span style={badgeStyle("unpaid")}>Da</span>
        ) : (
          <span style={badgeStyle("paid")}>Nu</span>
        )}
      </td>

      <td>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            className={styles.resetBtn}
            onClick={syncStripe}
            disabled={busy || !stripeSubId}
            title={
              !stripeSubId
                ? "Nu există Stripe subscription"
                : "Sincronizează cu Stripe"
            }
          >
            Sync Stripe
          </button>

          <button
            type="button"
            className={styles.resetBtn}
            onClick={cancelStripe}
            disabled={busy || !stripeSubId}
          >
            Cancel
          </button>

          <button
            type="button"
            className={styles.resetBtn}
            onClick={resumeStripe}
            disabled={busy || !stripeSubId}
          >
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
              disabled={busy || !shown}
            />

            <button
              type="button"
              className={styles.resetBtn}
              onClick={setTrial}
              disabled={busy || !shown}
            >
              Set trial
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}