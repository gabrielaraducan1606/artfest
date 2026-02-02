import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import s from "./AdminVendorPlansPage.module.css";

async function apiGet(url) {
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data?.message || "Request failed"), {
      data,
      status: res.status,
    });
  }
  return data;
}

async function apiPatch(url, body) {
  const res = await fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data?.message || "Request failed"), {
      data,
      status: res.status,
    });
  }
  return data;
}

const STATUSES = [
  "",
  "active",
  "pending",
  "canceled",
  "canceled_at_period_end",
  "past_due",
  "unpaid",
  "expired",
];

function formatDT(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

function getBadgeClass(status) {
  switch (status) {
    case "active":
      return `${s.badge} ${s.badgeSuccess}`;
    case "pending":
    case "past_due":
    case "unpaid":
    case "canceled_at_period_end":
      return `${s.badge} ${s.badgeWarning}`;
    case "canceled":
    case "expired":
      return `${s.badge} ${s.badgeDanger}`;
    default:
      return `${s.badge} ${s.badgeMuted}`;
  }
}

function prettyStatus(status) {
  if (!status) return "—";
  return status.replaceAll("_", " ");
}

function formatCommission(bps) {
  if (bps == null) return "—";
  const pct = Number(bps) / 100; // 1200 -> 12
  if (!Number.isFinite(pct)) return "—";
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

function formatMoney(cents, currency = "RON") {
  if (cents == null) return "—";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  const val = (n / 100).toFixed(2);
  return `${val} ${currency}`;
}

export default function AdminVendorPlansPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [onlyWithSubscription, setOnlyWithSubscription] = useState(true);

  const [trialDraft, setTrialDraft] = useState({}); // { [vendorId]: string }

  const [selected, setSelected] = useState(null); // item selectat pt drawer

  const take = 50;
  const [page, setPage] = useState(0);

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status) params.set("status", status);
    params.set("onlyWithSubscription", onlyWithSubscription ? "1" : "0");
    params.set("take", String(take));
    params.set("skip", String(page * take));
    return `/api/admin/vendors/plans?${params.toString()}`;
  }, [q, status, onlyWithSubscription, page]);

  async function refresh() {
    const r = await apiGet(url);
    setItems(r.items || []);
    setTotal(r.total || 0);
  }

  useEffect(() => {
    let mounted = true;
    setErr("");
    setLoading(true);

    apiGet(url)
      .then((r) => {
        if (!mounted) return;
        setItems(r.items || []);
        setTotal(r.total || 0);
      })
      .catch((e) => {
        if (!mounted) return;
        setErr(e?.data?.message || e.message);
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [url]);

  const pages = Math.max(1, Math.ceil(total / take));

  return (
    <div className={s.page}>
      <h2 className={s.title}>Admin · Planuri vânzători</h2>

      <div className={s.card}>
        <div className={s.toolbar}>
          <div className={s.controlGroup}>
            <input
              className={s.input}
              value={q}
              onChange={(e) => {
                setPage(0);
                setQ(e.target.value);
              }}
              placeholder="Caută: email / displayName / nume"
            />

            <select
              className={s.select}
              value={status}
              onChange={(e) => {
                setPage(0);
                setStatus(e.target.value);
              }}
            >
              {STATUSES.map((st) => (
                <option key={st || "all"} value={st}>
                  {st || "(toate statusurile)"}
                </option>
              ))}
            </select>

            <label className={s.checkboxLabel}>
              <input
                className={s.checkbox}
                type="checkbox"
                checked={onlyWithSubscription}
                onChange={(e) => {
                  setPage(0);
                  setOnlyWithSubscription(e.target.checked);
                }}
              />
              Doar cu abonament
            </label>
          </div>

          <div className={s.spacer} />

          <div className={s.pager}>
            <button
              className={s.button}
              disabled={loading || page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </button>

            <span className={s.pagerText}>
              {loading
                ? "Se încarcă..."
                : `Pagina ${page + 1} / ${pages} · ${total} vânzători`}
            </span>

            <button
              className={`${s.button} ${s.buttonPrimary}`}
              disabled={loading || page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>

        {err && <div className={s.error}>{err}</div>}

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>User</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
                <th>Trial</th>
                <th>Detalii</th>
              </tr>
            </thead>

            <tbody>
              {items.map((v) => {
                const current = v.currentSubscription || null;
                const latest = v.latestSubscription || null;

                const sub = current || latest;
                const plan = sub?.plan;
                const isCurrent = Boolean(current && sub?.id === current.id);

                const userLabel =
                  v.user?.email ||
                  [v.user?.firstName, v.user?.lastName].filter(Boolean).join(" ") ||
                  v.user?.name ||
                  "—";

                const planLabel = plan
                  ? `${plan.code} · ${plan.name}`
                  : sub
                  ? sub.planId
                  : "—";

                const statusValue = sub?.status || "";
                const badgeCls = getBadgeClass(statusValue);

                const nowTs = Date.now();
                const trialEndsTs = sub?.trialEndsAt
                  ? new Date(sub.trialEndsAt).getTime()
                  : null;
                const isTrial = trialEndsTs && trialEndsTs > nowTs;
                const trialLabel = isTrial ? `până la ${formatDT(sub.trialEndsAt)}` : "—";

                const draftVal = trialDraft[v.vendorId] ?? (sub?.trialDays ?? "");

                return (
                  <tr key={v.vendorId} className={s.row}>
                    <td>
                      <div className={s.vendorName}>{v.displayName}</div>
                      <div className={s.subText}>
                        {(v.vendorEmail || "").trim()}
                        {v.vendorPhone ? ` · ${v.vendorPhone}` : ""}
                      </div>
                      <div className={s.subText}>
                        <span className={v.isActive ? s.vendorStatusActive : s.vendorStatusInactive}>
                          {v.isActive ? "✅ activ" : "⛔ inactiv"}
                        </span>
                      </div>
                    </td>

                    <td>
                      <div>{userLabel}</div>
                      <div className={s.subText}>
                        role: {v.user?.role} · status: {v.user?.status}
                      </div>
                    </td>

                    <td>{planLabel}</td>

                    <td>
                      <span className={badgeCls}>
                        {prettyStatus(statusValue)}
                        {sub && (
                          <span style={{ marginLeft: 6, opacity: 0.7 }}>
                            · {isCurrent ? "curent" : "ultim"}
                          </span>
                        )}
                      </span>
                    </td>

                    <td>{formatDT(sub?.startAt)}</td>
                    <td>{formatDT(sub?.endAt)}</td>

                    <td>
                      <div className={s.subText}>{trialLabel}</div>

                      <div className={s.trialRow}>
                        <input
                          className={s.input}
                          style={{ width: 90 }}
                          type="number"
                          min={0}
                          max={365}
                          value={draftVal}
                          onChange={(e) =>
                            setTrialDraft((m) => ({ ...m, [v.vendorId]: e.target.value }))
                          }
                          placeholder="zile"
                          disabled={!sub || loading}
                          title={!sub ? "Vendorul nu are abonament" : ""}
                          onClick={(e) => e.stopPropagation()}
                        />

                        <button
                          className={s.button}
                          disabled={!sub || loading}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              setLoading(true);
                              setErr("");
                              const days = Number(trialDraft[v.vendorId] ?? 0);
                              await apiPatch(`/api/admin/vendors/${v.vendorId}/subscription/trial`, {
                                trialDays: Number.isFinite(days) ? days : 0,
                              });
                              await refresh();
                            } catch (e2) {
                              setErr(e2?.data?.message || e2.message);
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >
                          Setează
                        </button>

                        <button
                          className={s.button}
                          disabled={!sub || loading}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              setLoading(true);
                              setErr("");
                              await apiPatch(`/api/admin/vendors/${v.vendorId}/subscription/trial`, {
                                trialDays: 0,
                              });
                              setTrialDraft((m) => ({ ...m, [v.vendorId]: "" }));
                              await refresh();
                            } catch (e2) {
                              setErr(e2?.data?.message || e2.message);
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >
                          Șterge
                        </button>
                      </div>
                    </td>

                    <td>
                      <button
                        type="button"
                        className={s.detailsBtn}
                        disabled={!sub}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected({
                            ...v,
                            _sub: sub || null,
                            _plan: plan || null,
                          });
                        }}
                        title={!sub ? "Vendorul nu are abonament" : "Vezi detalii plan"}
                      >
                        Vezi
                      </button>
                    </td>
                  </tr>
                );
              })}

              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={8} className={s.empty}>
                    Nu există rezultate.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Drawer detalii */}
        {selected && (
          <VendorPlanDetailsDrawer
            item={selected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ===================== Drawer ===================== */

function VendorPlanDetailsDrawer({ item, onClose }) {
  if (!item) return null;
  if (typeof document === "undefined") return null;

  const sub = item._sub || null;
  const plan = item._plan || null;

  const vendorEmail = (item.vendorEmail || "").trim() || "—";
  const vendorPhone = item.vendorPhone || "—";

  const userName =
    item.user?.email ||
    [item.user?.firstName, item.user?.lastName].filter(Boolean).join(" ") ||
    item.user?.name ||
    "—";

  const planName = plan ? `${plan.name} (${plan.code})` : "—";
  const price = plan ? formatMoney(plan.priceCents, plan.currency) : "—";
  const interval = plan?.interval || sub?.meta?.interval || "—";
  const commission = formatCommission(plan?.commissionBps ?? null);
  const maxProducts =
    plan?.maxProducts == null ? "nelimitat" : String(plan.maxProducts);

  const features = Array.isArray(plan?.features) ? plan.features : [];

  const node = (
    <div className={s.drawerOverlay} onClick={onClose}>
      <aside className={s.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={s.drawerHeader}>
          <div>
            <h3 className={s.drawerTitle}>{item.displayName}</h3>
            <p className={s.drawerSub}>
              {vendorEmail}
              {vendorPhone !== "—" ? ` · ${vendorPhone}` : ""}
            </p>
          </div>

          <button
            type="button"
            className={s.drawerClose}
            onClick={onClose}
            aria-label="Închide"
          >
            ×
          </button>
        </header>

        <div className={s.drawerBody}>
          <section className={s.drawerSection}>
            <h4>Vendor</h4>
            <div className={s.drawerField}>
              <span>ID vendor</span>
              <code>{item.vendorId}</code>
            </div>
            <div className={s.drawerField}>
              <span>Status vendor</span>
              <span>
                <span className={item.isActive ? s.vendorStatusActive : s.vendorStatusInactive}>
                  {item.isActive ? "Activ" : "Inactiv"}
                </span>
              </span>
            </div>
            <div className={s.drawerField}>
              <span>Creat la</span>
              <span>{formatDT(item.createdAt)}</span>
            </div>
          </section>

          <section className={s.drawerSection}>
            <h4>User</h4>
            <div className={s.drawerField}>
              <span>User</span>
              <span>{userName}</span>
            </div>
            <div className={s.drawerField}>
              <span>Role</span>
              <span>{item.user?.role || "—"}</span>
            </div>
            <div className={s.drawerField}>
              <span>Status user</span>
              <span>{item.user?.status || "—"}</span>
            </div>
          </section>

          <section className={s.drawerSection}>
            <h4>Abonament</h4>
            <div className={s.drawerField}>
              <span>Status</span>
              <span>
                <span className={getBadgeClass(sub?.status || "")}>
                  {prettyStatus(sub?.status || "")}
                </span>
              </span>
            </div>
            <div className={s.drawerField}>
              <span>Start</span>
              <span>{formatDT(sub?.startAt)}</span>
            </div>
            <div className={s.drawerField}>
              <span>End</span>
              <span>{formatDT(sub?.endAt)}</span>
            </div>
            <div className={s.drawerField}>
              <span>Trial</span>
              <span>{sub?.trialEndsAt ? formatDT(sub.trialEndsAt) : "—"}</span>
            </div>
          </section>

          <section className={s.drawerSection}>
            <h4>Plan</h4>
            <div className={s.drawerField}>
              <span>Plan</span>
              <span>{planName}</span>
            </div>
            <div className={s.drawerField}>
              <span>Preț</span>
              <span>{price}</span>
            </div>
            <div className={s.drawerField}>
              <span>Interval</span>
              <span>{String(interval)}</span>
            </div>
            <div className={s.drawerField}>
              <span>Comision</span>
              <span>
                {commission}
                {plan?.commissionBps != null ? (
                  <span className={s.subText} style={{ marginLeft: 6 }}>
                    ({plan.commissionBps} bps)
                  </span>
                ) : null}
              </span>
            </div>
            <div className={s.drawerField}>
              <span>Max produse</span>
              <span>{maxProducts}</span>
            </div>
          </section>

          <section className={s.drawerSection}>
            <h4>Features</h4>
            {features.length ? (
              <ul className={s.featureList}>
                {features.map((f, idx) => (
                  <li key={`${idx}-${f}`}>{f}</li>
                ))}
              </ul>
            ) : (
              <p className={s.subtle}>Nu există features salvate pe plan.</p>
            )}
          </section>

          <section className={s.drawerSection}>
            <h4>Debug (opțional)</h4>
            <pre className={s.codeBlock}>
              {JSON.stringify(
                {
                  vendorId: item.vendorId,
                  subscriptionId: sub?.id,
                  planId: sub?.planId,
                  planCode: plan?.code,
                },
                null,
                2
              )}
            </pre>
          </section>
        </div>

        <footer className={s.drawerFooter}>
          <button type="button" className={s.drawerBtnSecondary} onClick={onClose}>
            Închide
          </button>
        </footer>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}
