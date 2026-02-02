import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import {
  Search,
  RefreshCw,
  Loader2,
  ChevronLeft,
  ChevronRight,
  FileText,
  CheckCircle2,
  ExternalLink,
  X,
} from "lucide-react";

import styles from "./AdminBillingToClient.module.css";

/* Utils */
function formatMoney(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(v);
}

function formatDate(d) {
  try {
    const dt = new Date(d);
    return new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short" }).format(dt);
  } catch {
    return d || "";
  }
}

export default function AdminBillingToClientPage() {
  const [tab, setTab] = useState("toInvoice"); // toInvoice | invoices

  // shared filters
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);

  // list
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState({ items: [], total: 0 });

  // modal (order)
  const [previewOrder, setPreviewOrder] = useState(null);

  // modal (draft)
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftErr, setDraftErr] = useState("");
  const [draft, setDraft] = useState(null);
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

  // create
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));

  const query = useMemo(() => ({ q, from, to, page, pageSize }), [q, from, to, page, pageSize]);

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr("");
      try {
        const qs = new URLSearchParams(
          Object.fromEntries(Object.entries(query).filter(([, v]) => v !== "" && v != null))
        ).toString();

        const url =
          tab === "toInvoice"
            ? `/api/admin/billing/to-invoice?${qs}`
            : `/api/admin/invoices?direction=PLATFORM_TO_CLIENT&${qs}`;

        const res = await api(url);
        if (!alive) return;

        setData({
          items: Array.isArray(res?.items) ? res.items : [],
          total: Number(res?.total || 0),
        });
      } catch {
        if (!alive) return;
        setErr(tab === "toInvoice" ? "Nu am putut încărca comenzile de facturat." : "Nu am putut încărca facturile.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [query, tab]);

  function reset() {
    setPage(1);
    setQ("");
    setFrom("");
    setTo("");
  }

  async function openPreview(row) {
    setPreviewOrder(row);
    setDraft(null);
    setDraftErr("");
    setCreateErr("");
    setDraftLoading(true);

    try {
      const res = await api(
        `/api/admin/billing/preview-invoice-from-order?orderId=${encodeURIComponent(row.orderId)}&vatRate=0`
      );
      setDraft(res);
    } catch {
      setDraftErr("Nu am putut genera draftul de factură.");
    } finally {
      setDraftLoading(false);
    }
  }

  async function createInvoiceFromOrder(orderId) {
    setCreating(true);
    setCreateErr("");
    try {
      const res = await api(`/api/admin/billing/create-invoice-from-order`, {
        method: "POST",
        body: JSON.stringify({ orderId, vatRate: 0 }),
      });

      const inv = res?.invoice;
      if (!inv?.id) throw new Error("bad_response");

      // scoate comanda din listă (de facturat)
      setData((prev) => ({
        ...prev,
        items: (prev.items || []).filter((x) => x.orderId !== orderId),
        total: Math.max(0, Number(prev.total || 0) - 1),
      }));

      // închide modal
      setPreviewOrder(null);
      setDraft(null);

      alert(`Factura a fost creată: ${inv.series ? inv.series + " " : ""}${inv.number}`);
    } catch (e) {
      const status = e?.status || e?.response?.status;
      const data = e?.data || e?.response?.data;
      setCreateErr(
        status === 409
          ? data?.message || "Nu pot crea factura (nu e DELIVERED sau există deja)."
          : "Nu am putut crea factura. Încearcă din nou."
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.h1}>Facturare (Platformă → Client)</h1>
          <div className={styles.muted} style={{ fontSize: 13, marginTop: 4 }}>
            Comenzile apar la „De facturat” doar după ce sunt marcate <strong>DELIVERED</strong>.
          </div>
        </div>

        <button className={styles.secondaryBtn} onClick={() => setPage((p) => p)}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${tab === "toInvoice" ? styles.tabActive : ""}`}
          onClick={() => {
            setTab("toInvoice");
            setPage(1);
          }}
        >
          De facturat
        </button>

        <button
          type="button"
          className={`${styles.tab} ${tab === "invoices" ? styles.tabActive : ""}`}
          onClick={() => {
            setTab("invoices");
            setPage(1);
          }}
        >
          Facturi emise
        </button>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.inputWrap}>
          <Search size={16} className={styles.inputIcon} />
          <input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder={tab === "toInvoice" ? "Caută: AF-..., client, email…" : "Caută: nr factură, client, orderId…"}
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

      {/* List */}
      <div className={styles.card}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>{tab === "toInvoice" ? "Comandă" : "Factură"}</th>
                <th className={styles.th}>Client</th>
                <th className={styles.th}>Data</th>
                <th className={styles.th}>Total</th>
                <th className={styles.th}></th>
              </tr>
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
                  if (tab === "toInvoice") {
                    return (
                      <tr
                        key={row.orderId}
                        className={styles.row}
                        onClick={() => openPreview(row)}
                        title="Click pentru preview"
                      >
                        <td className={styles.td}>
                          <div style={{ display: "grid", gap: 4 }}>
                            <div style={{ fontWeight: 800 }}>{row.orderNumber || row.orderId}</div>
                            <div className={styles.muted} style={{ fontSize: 12 }}>
                              Status: <code className={styles.code}>{row.status}</code>
                            </div>
                          </div>
                        </td>

                        <td className={styles.td}>
                          <div style={{ fontWeight: 700 }}>{row.customerName || "—"}</div>
                          <div className={styles.muted} style={{ fontSize: 12 }}>
                            {row.customerEmail || "—"} · {row.customerPhone || "—"}
                          </div>
                        </td>

                        <td className={styles.td}>{row.createdAt ? formatDate(row.createdAt) : "—"}</td>

                        <td className={styles.td}>{formatMoney(row.total)}</td>

                        <td className={styles.td} onClick={(e) => e.stopPropagation()}>
                          <button className={styles.primaryBtn} onClick={() => openPreview(row)}>
                            <FileText size={16} /> Preview
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  // invoices tab
                  return (
                    <tr key={row.id} className={styles.row}>
                      <td className={styles.td}>
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontWeight: 800 }}>
                            {row.series ? `${row.series} ` : ""}
                            {row.number || "—"}
                          </div>
                          <div className={styles.muted} style={{ fontSize: 12 }}>
                            orderId: <code className={styles.code}>{row.orderId || "—"}</code>
                          </div>
                        </div>
                      </td>

                      <td className={styles.td}>
                        <div style={{ fontWeight: 700 }}>{row.clientName || "—"}</div>
                        <div className={styles.muted} style={{ fontSize: 12 }}>
                          {row.clientEmail || "—"}
                        </div>
                      </td>

                      <td className={styles.td}>{row.issueDate ? formatDate(row.issueDate) : "—"}</td>

                      <td className={styles.td}>{formatMoney(row.totalGross)}</td>

                      <td className={styles.td}>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          {row.pdfUrl ? (
                           
<a
  className={styles.secondaryBtn}
  href={`${API_URL}/api/admin/invoices/${row.id}/pdf`}
  target="_blank"
  rel="noreferrer"
>
  <ExternalLink size={16} /> PDF
</a>

                          ) : (
                            <span className={styles.muted} style={{ fontSize: 12 }}>
                              (fără PDF)
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!!err && <p className={styles.error}>{err}</p>}

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

      {/* Preview modal */}
      {previewOrder && (
        <PreviewInvoiceModal
          order={previewOrder}
          draft={draft}
          draftLoading={draftLoading}
          draftErr={draftErr}
          creating={creating}
          error={createErr}
          onClose={() => {
            setPreviewOrder(null);
            setDraft(null);
            setDraftErr("");
            setCreateErr("");
          }}
          onCreate={() => createInvoiceFromOrder(previewOrder.orderId)}
        />
      )}
    </main>
  );
}

function PreviewInvoiceModal({ order, draft, draftLoading, draftErr, onClose, onCreate, creating, error }) {
  const d = draft?.draft;
  const issuer = draft?.issuer;

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <div>
            <div style={{ fontWeight: 800, fontFamily: "var(--font-title)" }}>
              Preview factură (Platformă → Client)
            </div>
            <div className={styles.muted} style={{ fontSize: 12, marginTop: 2 }}>
              Comandă <code className={styles.code}>{order.orderNumber || order.orderId}</code>
            </div>
          </div>

          <button className={styles.iconBtn} onClick={onClose} aria-label="Închide">
            <X size={18} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {draftLoading && (
            <div className={styles.muted} style={{ fontSize: 13 }}>
              <Loader2 size={16} className={styles.spin} /> Generez draftul…
            </div>
          )}

          {!!draftErr && <div className={styles.error} style={{ marginTop: 10 }}>{draftErr}</div>}

          {!draftLoading && d && (
            <>
              <div className={styles.kvGrid}>
                <KV label="Emitent (Platformă)">
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 800 }}>{issuer?.companyName || "—"}</div>
                    <div className={styles.muted} style={{ fontSize: 12 }}>
                      CUI: {issuer?.cui || "—"} {issuer?.regCom ? `· RegCom: ${issuer.regCom}` : ""}
                    </div>
                    <div className={styles.muted} style={{ fontSize: 12 }}>
                      {issuer?.address || "—"}
                    </div>
                    {(issuer?.iban || issuer?.bank) && (
                      <div className={styles.muted} style={{ fontSize: 12 }}>
                        IBAN: {issuer?.iban || "—"} {issuer?.bank ? `· ${issuer.bank}` : ""}
                      </div>
                    )}
                  </div>
                </KV>

                <KV label="Factură (draft)">
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 900 }}>
                      {d.series} {d.number} <span className={styles.muted} style={{ fontSize: 12 }}>(următorul)</span>
                    </div>
                    <div className={styles.muted} style={{ fontSize: 12 }}>
                      Emitere: {formatDate(d.issueDate)} · Scadență: {formatDate(d.dueDate)}
                    </div>
                  </div>
                </KV>

                <KV label="Client">
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ fontWeight: 700 }}>{d.clientName || "—"}</div>
                    <div className={styles.muted} style={{ fontSize: 12 }}>
                      {d.clientEmail || "—"} · {d.clientPhone || "—"}
                    </div>
                    {d.clientAddress && (
                      <div className={styles.muted} style={{ fontSize: 12 }}>
                        {d.clientAddress}
                      </div>
                    )}
                  </div>
                </KV>

                <KV label="Total">
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{formatMoney(d.totals?.totalGross)}</div>
                  <div className={styles.muted} style={{ fontSize: 12, marginTop: 6 }}>
                    Net: {formatMoney(d.totals?.totalNet)} · TVA: {formatMoney(d.totals?.totalVat)}
                  </div>
                </KV>
              </div>

              <div className={styles.card} style={{ marginTop: 12 }}>
                <div className={styles.tableWrap} style={{ maxHeight: 260 }}>
                  <table className={styles.table}>
                    <thead className={styles.thead}>
                      <tr>
                        <th className={styles.th}>Descriere</th>
                        <th className={styles.th}>Cant.</th>
                        <th className={styles.th}>Preț (net)</th>
                        <th className={styles.th}>TVA</th>
                        <th className={styles.th}>Total (brut)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(d.lines || []).map((ln, idx) => (
                        <tr key={idx} className={styles.row}>
                          <td className={styles.td}>{ln.description}</td>
                          <td className={styles.td}>{ln.quantity}</td>
                          <td className={styles.td}>{formatMoney(ln.unitNet)}</td>
                          <td className={styles.td}>{Number(ln.vatRate || 0)}%</td>
                          <td className={styles.td}>{formatMoney(ln.totalGross)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {!!error && <div className={styles.error} style={{ marginTop: 10 }}>{error}</div>}

          <div className={styles.modalActions}>
            <button className={styles.primaryBtn} disabled={creating} onClick={onCreate}>
              {creating ? <Loader2 size={16} className={styles.spin} /> : <CheckCircle2 size={16} />}
              Creează factura
            </button>
            <button className={styles.secondaryBtn} onClick={onClose}>
              Închide
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KV({ label, children }) {
  return (
    <div className={styles.kv}>
      <div className={styles.kvLabel}>{label}</div>
      <div className={styles.kvValue}>{children}</div>
    </div>
  );
}
