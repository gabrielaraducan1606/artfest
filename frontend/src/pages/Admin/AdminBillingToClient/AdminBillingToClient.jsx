import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import {
  Search,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FileText,
  ExternalLink,
  Eye,
} from "lucide-react";

import styles from "./AdminBillingToClient.module.css";
import VendorCommissionBreakdownModal from "./VendorCommissionBreakdownModal.jsx";
import VendorPayoutRequestBlock from "./VendorPayoutRequestBlock.jsx";

function formatMoney(n, currency = "RON") {
  const v = Number(n || 0);
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
  }).format(v);
}

function formatDate(d) {
  if (!d) return "—";

  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "—";

    return new Intl.DateTimeFormat("ro-RO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(dt);
  } catch {
    return d || "—";
  }
}

function getInvoiceNumber(row) {
  if (row.providerSeries && row.providerNumber) {
    return `${row.providerSeries}-${row.providerNumber}`;
  }

  if (row.series && row.number) {
    return `${row.series} ${row.number}`;
  }

  return row.number || "—";
}

export default function AdminBillingToClientPage() {
  const [tab, setTab] = useState("vendorDue"); // vendorDue | invoices | subscriptions

  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState({ items: [], total: 0 });

  const [creatingId, setCreatingId] = useState("");
  const [createErr, setCreateErr] = useState("");

  const [detailsVendor, setDetailsVendor] = useState(null); // { vendorId, displayName } | null

  // Solicitare factură/documente, când Artfest DATOREAZĂ vendorului
  // (audit 2026-09-16) - stare per rând, cheie vendorId - STRICT
  // pentru loading/eroare imediat după click; statusul persistent
  // ("Factură solicitată"/"Documente solicitate") vine din
  // row.payoutRequestStatus (backend, GET /billing/vendors-due),
  // NU din acest state local - vezi refreshTick mai jos.
  const [payoutRequests, setPayoutRequests] = useState({});

  const [refreshTick, setRefreshTick] = useState(0);

  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));

  const query = useMemo(
    () => ({ q, from, to, page, pageSize }),
    [q, from, to, page, pageSize]
  );

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr("");
      setCreateErr("");

      try {
        const qs = new URLSearchParams(
          Object.fromEntries(
            Object.entries(query).filter(([, v]) => v !== "" && v != null)
          )
        ).toString();

        let url = "";

        if (tab === "vendorDue") {
          url = `/api/admin/billing/vendors-due?${qs}`;
        } else if (tab === "subscriptions") {
          url =
            `/api/admin/invoices?` +
            `direction=PLATFORM_TO_VENDOR&` +
            `type=SUBSCRIPTION&` +
            `provider=STRIPE&${qs}`;
        } else {
          url = `/api/admin/invoices?direction=PLATFORM_TO_VENDOR&${qs}`;
        }

        const res = await api(url);

        if (!alive) return;

        setData({
          items: Array.isArray(res?.items) ? res.items : [],
          total: Number(res?.total ?? res?.items?.length ?? 0),
        });
      } catch {
        if (!alive) return;

        setErr(
          tab === "vendorDue"
            ? "Nu am putut încărca vendorii de facturat."
            : tab === "subscriptions"
              ? "Nu am putut încărca plățile abonamentelor."
              : "Nu am putut încărca facturile către vendori."
        );
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();

    return () => {
      alive = false;
    };
  }, [query, tab, refreshTick]);

  function reset() {
    setPage(1);
    setQ("");
    setFrom("");
    setTo("");
  }

  function refresh() {
    setRefreshTick((n) => n + 1);
  }
// ADAUGI AICI
async function openInvoicePdf(invoiceId) {
  try {
   const res = await fetch(`${API_URL}/admin/invoices/${invoiceId}/pdf`, {
      method: "GET",
      credentials: "include",
      headers: {
        Authorization: localStorage.getItem("token")
          ? `Bearer ${localStorage.getItem("token")}`
          : "",
      },
    });

    if (!res.ok) throw new Error("pdf_failed");

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    window.open(url, "_blank", "noopener,noreferrer");

    setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  } catch {
    alert("Nu am putut deschide PDF-ul.");
  }
}
  async function createVendorCommissionInvoice(vendorId) {
    setCreatingId(vendorId);
    setCreateErr("");

    try {
      const res = await api(`/api/admin/billing/create-vendor-commission-invoice`, {
        method: "POST",
        body: JSON.stringify({ vendorId, vatRate: 0 }),
      });

      const inv = res?.invoice;
      if (!inv?.id) throw new Error("bad_response");

      alert(`Factura a fost creată: ${inv.series || ""} ${inv.number || ""}`);

      setData((prev) => ({
        ...prev,
        items: (prev.items || []).filter((x) => x.vendorId !== vendorId),
        total: Math.max(0, Number(prev.total || 0) - 1),
      }));
    } catch (e) {
      const message =
        e?.data?.message ||
        e?.response?.data?.message ||
        "Nu am putut crea factura pentru vendor.";

      setCreateErr(message);
    } finally {
      setCreatingId("");
    }
  }

  /*
   * Artfest DATOREAZĂ vendorului (audit 2026-09-16) - solicitare
   * factură (vendor cu formă juridică) SAU documente fiscale
   * (persoană fizică fără formă juridică). Server-side decide tipul
   * fiscal DIN NOU (nu are încredere în ce a calculat frontend-ul) -
   * aici doar alegem eticheta corectă de buton, pe baza `row.fiscalType`
   * întors de API. Idempotent: al doilea click pe același vendor
   * (aceeași perioadă implicită - "de facturat azi") întoarce
   * `alreadyRequested: true`, fără duplicat de notificare/email.
   */
  async function requestVendorPayout(row) {
    const vendorId = row.vendorId;
    setPayoutRequests((prev) => ({ ...prev, [vendorId]: { loading: true, error: "" } }));

    try {
      /*
       * Perioada NU se mai trimite de aici (audit 2026-09-16) - se
       * calculează STRICT server-side (getPreviousBucharestMonthBoundaries),
       * ca sursă unică, identică cu cea folosită la afișarea
       * statusului "Factură solicitată" (GET /billing/vendors-due) -
       * altfel un calcul ușor diferit pe client ar putea produce un
       * dedupeKey care nu se mai potrivește niciodată la citire.
       */
      await api(`/api/admin/billing/request-vendor-payout`, {
        method: "POST",
        body: JSON.stringify({
          vendorId,
          amount: Number(row.vendorNet || 0),
          currency: row.currency || "RON",
        }),
      });

      setPayoutRequests((prev) => {
        const next = { ...prev };
        delete next[vendorId];
        return next;
      });

      /*
       * Sursa persistentă a statusului e backend-ul
       * (row.payoutRequestStatus, din GET /billing/vendors-due) - NU
       * un flag local (cerință explicită: statusul trebuie să
       * supraviețuiască unui refresh de pagină). Aici doar reîncărcăm
       * lista ca să apară imediat, fără să așteptăm alt trigger.
       */
      setRefreshTick((n) => n + 1);
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const message =
        status === 409
          ? "Tipul fiscal nu este cunoscut sau nu este complet - verifică datele fiscale ale vendorului."
          : e?.data?.message || e?.response?.data?.message || "Nu am putut trimite solicitarea.";

      setPayoutRequests((prev) => ({ ...prev, [vendorId]: { loading: false, error: message } }));
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.h1}>Facturare & Abonamente</h1>
          <div className={styles.muted} style={{ fontSize: 13, marginTop: 4 }}>
            Facturi către vendori, comisioane și plăți abonamente Stripe.
          </div>
        </div>

        <button className={styles.secondaryBtn} onClick={refresh}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === "vendorDue" ? styles.tabActive : ""}`}
          onClick={() => {
            setTab("vendorDue");
            setPage(1);
          }}
        >
          Vendori de facturat
        </button>

        <button
          type="button"
          className={`${styles.tab} ${tab === "invoices" ? styles.tabActive : ""}`}
          onClick={() => {
            setTab("invoices");
            setPage(1);
          }}
        >
          Facturi emise către vendori
        </button>

        <button
          type="button"
          className={`${styles.tab} ${tab === "subscriptions" ? styles.tabActive : ""}`}
          onClick={() => {
            setTab("subscriptions");
            setPage(1);
          }}
        >
          Abonamente Stripe
        </button>
      </div>

      <div className={styles.filters}>
        <div className={styles.inputWrap}>
          <Search size={16} className={styles.inputIcon} />
          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder={
              tab === "vendorDue"
                ? "Caută vendor, firmă, email, CUI…"
                : tab === "subscriptions"
                  ? "Caută abonament, vendor, email, Stripe invoice…"
                  : "Caută nr factură, vendor, email…"
            }
            className={styles.input}
          />
        </div>

        <div className={styles.actions}>
          <div className={styles.dateWrap}>
            <span className={styles.muted} style={{ fontSize: 13 }}>
              De la
            </span>
            <input
              type="date"
              className={styles.dateInput}
              value={from}
              onChange={(e) => {
                setPage(1);
                setFrom(e.target.value);
              }}
            />
          </div>

          <div className={styles.dateWrap}>
            <span className={styles.muted} style={{ fontSize: 13 }}>
              Până la
            </span>
            <input
              type="date"
              className={styles.dateInput}
              value={to}
              onChange={(e) => {
                setPage(1);
                setTo(e.target.value);
              }}
            />
          </div>

          <button className={styles.secondaryBtn} onClick={reset}>
            <RefreshCw size={16} /> Reset
          </button>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.thead}>
              {tab === "vendorDue" ? (
                <tr>
                  <th className={styles.th}>Vendor</th>
                  <th className={styles.th}>Date facturare</th>
                  <th className={styles.th}>Tranzacții</th>
                  <th className={styles.th}>Comision datorat</th>
                  <th className={styles.th}></th>
                </tr>
              ) : (
                <tr>
                  <th className={styles.th}>
                    {tab === "subscriptions" ? "Plată / Factură" : "Factură"}
                  </th>
                  <th className={styles.th}>Vendor</th>
                  <th className={styles.th}>
                    {tab === "subscriptions" ? "Data plății" : "Data"}
                  </th>
                  <th className={styles.th}>Total</th>
                  <th className={styles.th}></th>
                </tr>
              )}
            </thead>

            <tbody>
              {loading && (
                <tr>
                  <td className={styles.td} colSpan={5}>
                    <Loader2 size={16} className={styles.spin} /> Se încarcă…
                  </td>
                </tr>
              )}

              {!loading && (data.items || []).length === 0 && (
                <tr>
                  <td className={styles.emptyCell} colSpan={5}>
                    Nu există rezultate.
                  </td>
                </tr>
              )}

              {!loading &&
                (data.items || []).map((row) => {
                  if (tab === "vendorDue") {
                    return (
                      <tr key={row.vendorId} className={styles.row}>
                        <td className={styles.td}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ fontWeight: 800 }}>
                              {row.displayName || "Vendor"}
                            </div>
                            <div className={styles.muted} style={{ fontSize: 12 }}>
                              {row.email || "—"}
                            </div>

                            {row.missingBilling && (
                              <div className={styles.error} style={{ fontSize: 12 }}>
                                Date de facturare lipsă
                              </div>
                            )}
                          </div>
                        </td>

                        <td className={styles.td}>
                          <div style={{ fontWeight: 700 }}>
                            {row.billing?.companyName ||
                              row.billing?.vendorName ||
                              row.billing?.contactPerson ||
                              "—"}
                          </div>
                          <div className={styles.muted} style={{ fontSize: 12 }}>
                            CUI: {row.billing?.cui || "—"}
                          </div>
                          <div className={styles.muted} style={{ fontSize: 12 }}>
                            {row.billing?.address || "—"}
                          </div>
                        </td>

                        <td className={styles.td}>
                          <div style={{ fontWeight: 800 }}>{row.entryCount || 0}</div>
                          <div className={styles.muted} style={{ fontSize: 12 }}>
                            Vânzări nete:{" "}
                            {formatMoney(row.totalSalesNet, row.currency || "RON")}
                          </div>
                        </td>

                        <td className={styles.td}>
                          <div style={{ fontWeight: 900 }}>
                            {formatMoney(row.commissionNet, row.currency || "RON")}
                          </div>

                          {Number(row.alreadyUnpaidGross || 0) > 0 && (
                            <div className={styles.muted} style={{ fontSize: 12 }}>
                              Deja neplătit:{" "}
                              {formatMoney(row.alreadyUnpaidGross, row.currency || "RON")}
                            </div>
                          )}
                        </td>

                        <td className={styles.td}>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              justifyContent: "flex-end",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              onClick={() =>
                                setDetailsVendor({
                                  vendorId: row.vendorId,
                                  displayName: row.displayName,
                                })
                              }
                            >
                              <Eye size={16} /> Vezi detalii
                            </button>

                            <button
                              className={styles.primaryBtn}
                              disabled={!row.canInvoice || creatingId === row.vendorId}
                              onClick={() => createVendorCommissionInvoice(row.vendorId)}
                            >
                              {creatingId === row.vendorId ? (
                                <Loader2 size={16} className={styles.spin} />
                              ) : (
                                <FileText size={16} />
                              )}
                              Creează factură
                            </button>
                          </div>

                          {Number(row.vendorNet || 0) > 0 && (
                            <VendorPayoutRequestBlock
                              row={row}
                              state={payoutRequests[row.vendorId]}
                              onRequest={() => requestVendorPayout(row)}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={row.id} className={styles.row}>
                      <td className={styles.td}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontWeight: 800 }}>{getInvoiceNumber(row)}</div>

                          <div className={styles.muted} style={{ fontSize: 12 }}>
                            Status:{" "}
                            <code className={styles.code}>{row.status || "—"}</code>
                          </div>

                          {row.provider === "SMARTBILL" && (
                            <div className={styles.muted} style={{ fontSize: 12 }}>
                              SmartBill
                            </div>
                          )}

                          {row.provider === "STRIPE" && (
                            <div className={styles.muted} style={{ fontSize: 12 }}>
                              Stripe Subscription
                            </div>
                          )}
                        </div>
                      </td>

                      <td className={styles.td}>
                        <div style={{ fontWeight: 700 }}>{row.clientName || "—"}</div>
                        <div className={styles.muted} style={{ fontSize: 12 }}>
                          {row.clientEmail || "—"}
                        </div>
                      </td>

                      <td className={styles.td}>
                        <div>
                          {row.paidAt
                            ? formatDate(row.paidAt)
                            : row.issueDate
                              ? formatDate(row.issueDate)
                              : "—"}
                        </div>

                        {tab !== "subscriptions" && (
                          <div className={styles.muted} style={{ fontSize: 12 }}>
                            Scadență: {row.dueDate ? formatDate(row.dueDate) : "—"}
                          </div>
                        )}
                      </td>

                      <td className={styles.td}>
                        {formatMoney(row.totalGross, row.currency || "RON")}
                      </td>

                      <td className={styles.td}>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            justifyContent: "flex-end",
                          }}
                        >
                          <button
  type="button"
  className={styles.secondaryBtn}
  onClick={() => openInvoicePdf(row.id)}
>
  <ExternalLink size={16} /> PDF
</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!!err && <p className={styles.error}>{err}</p>}
        {!!createErr && <p className={styles.error}>{createErr}</p>}

        {data.total > pageSize && (
          <div className={styles.pagination}>
            <button
              className={styles.secondaryBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft size={16} /> Anterioare
            </button>

            <span className={styles.pageInfo}>
              Pagina {page} / {totalPages} · {data.total} rezultate
            </span>

            <button
              className={styles.secondaryBtn}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Următoare <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {detailsVendor && (
        <VendorCommissionBreakdownModal
          vendorId={detailsVendor.vendorId}
          vendorName={detailsVendor.displayName}
          onClose={() => setDetailsVendor(null)}
        />
      )}
    </main>
  );
}