// ==============================
// File: src/pages/Vendor/Invoices/InvoicePage.jsx
// (re-purpose: Decontări / Plăți către vendor)
// ==============================
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./InvoicePage.module.css";

// URL către tab-ul de facturare din onboarding (ajustează dacă e altul)
const BILLING_URL = "/onboarding/details?tab=facturare";

const PAYOUT_STATUS_LABELS = {
  REQUESTED: "Cerere trimisă",
  APPROVED: "Aprobat",
  PAID: "Plătit",
  REJECTED: "Respins",
};

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("ro-RO");
}

function formatDateTime(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("ro-RO");
}

const nf = new Intl.NumberFormat("ro-RO", {
  style: "currency",
  currency: "RON",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(val, currency = "RON") {
  const v = Number(val || 0);
  if (!Number.isFinite(v)) return `0.00 ${currency}`;
  if (currency === "RON") return nf.format(v);
  return `${v.toFixed(2)} ${currency}`;
}

export default function VendorInvoicesPage() {
  // billing (ne trebuie ca să permitem cerere plată)
  const [billing, setBilling] = useState(null);

  // taburi: DECONTARI (default) + FACTURI ARTFEST (opțional)
  const [activeTab, setActiveTab] = useState("PAYOUTS");

  // summary payouts
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryErr, setSummaryErr] = useState("");

  // eligible entries
  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesErr, setEntriesErr] = useState("");

  // payouts history
  const [payouts, setPayouts] = useState([]);
  const [payoutsLoading] = useState(false);
  const [payoutsErr] = useState("");

  // (opțional) facturi ArtFest -> vendor (dacă le păstrezi)
  const [platformInvoices, setPlatformInvoices] = useState([]);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformErr, setPlatformErr] = useState("");
  const [platformLoaded, setPlatformLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  // UI state for request payout
  const [requesting, setRequesting] = useState(false);
  const [requestMsg, setRequestMsg] = useState("");

  // initial load: billing + payout summary + payouts history
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setSummaryLoading(true);
        setSummaryErr("");

        const [billingRes, summaryRes, payoutsRes] = await Promise.all([
          api("/api/vendors/me/billing").catch(() => null),
          api("/api/vendor/payouts/summary"),
          api("/api/vendor/payouts").catch(() => ({ items: [] })),
        ]);

        if (!alive) return;

        if (billingRes?.billing) setBilling(billingRes.billing);

        setSummary(summaryRes || null);
        setPayouts(Array.isArray(payoutsRes?.items) ? payoutsRes.items : []);
      } catch (e) {
        if (!alive) return;
        setSummaryErr(e?.message || "Nu am putut încărca sumarul decontărilor.");
      } finally {
        if (alive) setSummaryLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // load eligible entries when tab is PAYOUTS
  useEffect(() => {
    if (activeTab !== "PAYOUTS") return;

    let alive = true;
    (async () => {
      try {
        setEntriesLoading(true);
        setEntriesErr("");

        const res = await api("/api/vendor/payouts/entries?eligible=true").catch(
          () => ({ items: [] })
        );
        if (!alive) return;

        const items = Array.isArray(res?.items) ? res.items : res || [];
        setEntries(items);
      } catch (e) {
        if (!alive) return;
        setEntriesErr(e?.message || "Nu am putut încărca intrările eligibile.");
      } finally {
        if (alive) setEntriesLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [activeTab]);

  // optional: load platform invoices lazily on tab
  useEffect(() => {
    if (activeTab !== "ARTFEST" || platformLoaded) return;

    let alive = true;
    (async () => {
      try {
        setPlatformLoading(true);
        setPlatformErr("");
        const res = await api("/api/vendors/me/invoices").catch(() => ({
          items: [],
        }));
        if (!alive) return;
        setPlatformInvoices(Array.isArray(res?.items) ? res.items : []);
        setPlatformLoaded(true);
      } catch (e) {
        if (!alive) return;
        setPlatformErr(e?.message || "Nu am putut încărca facturile ArtFest.");
      } finally {
        if (alive) setPlatformLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [activeTab, platformLoaded]);

  const filteredPlatformInvoices = useMemo(() => {
    return platformInvoices.filter((inv) => {
      if (statusFilter !== "ALL" && inv.status !== statusFilter) return false;
      if (typeFilter !== "ALL" && inv.type !== typeFilter) return false;
      return true;
    });
  }, [platformInvoices, statusFilter, typeFilter]);

  const nextEligibleLabel = useMemo(() => {
    const next = summary?.nextEligibleAt;
    if (!next) return null;
    const dt = new Date(next);
    if (Number.isNaN(dt.getTime())) return null;
    return formatDateTime(dt);
  }, [summary]);

  const canRequestPayout = useMemo(() => {
    // condiții minime:
    // - billing complet
    // - ai bani disponibili
    // - nu e prea devreme (backend oricum blochează)
    const amount = Number(summary?.availableAmount || 0);
    return !!billing && amount > 0;
  }, [billing, summary]);

  async function reloadSummaryAndHistory() {
    const [summaryRes, payoutsRes] = await Promise.all([
      api("/api/vendor/payouts/summary"),
      api("/api/vendor/payouts").catch(() => ({ items: [] })),
    ]);
    setSummary(summaryRes || null);
    setPayouts(Array.isArray(payoutsRes?.items) ? payoutsRes.items : []);
  }

  async function onRequestPayout() {
    try {
      setRequesting(true);
      setRequestMsg("");

      const res = await api("/api/vendor/payouts/request", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });

      // refresh state (summary, history, eligible entries)
      await reloadSummaryAndHistory();

      const entriesRes = await api("/api/vendor/payouts/entries?eligible=true").catch(
        () => ({ items: [] })
      );
      setEntries(Array.isArray(entriesRes?.items) ? entriesRes.items : []);

      if (res?.pdfUrl) {
        setRequestMsg("Cererea a fost trimisă. Poți deschide PDF-ul decontului.");
        // opțional: auto-open
        // window.open(res.pdfUrl, "_blank", "noopener,noreferrer");
      } else {
        setRequestMsg("Cererea a fost trimisă.");
      }
    } catch (e) {
      // backend poate întoarce 412 billing_required, 409 too soon etc.
      setRequestMsg(e?.message || "Nu am putut trimite cererea de plată.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <main className={styles.page}>
      {/* ===== HEADER GENERAL ===== */}
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Decontări</h1>
          <p className={styles.subtitle}>
            Vezi cât ai de încasat și trimite o cerere de plată (maxim o dată la 30 de zile).
          </p>
        </div>

        <div className={styles.headerRight}>
          <a href={BILLING_URL} className={styles.linkBtn}>
            Actualizează datele de facturare
          </a>
        </div>
      </header>

      {/* ===== TABURI ===== */}
      <div className={styles.tabs} role="tablist" aria-label="Secțiuni">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "PAYOUTS"}
          className={`${styles.tab} ${activeTab === "PAYOUTS" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("PAYOUTS")}
        >
          Decontări & plăți
        </button>

        {/* opțional: păstrezi tabul vechi cu facturi ArtFest -> vendor */}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "ARTFEST"}
          className={`${styles.tab} ${activeTab === "ARTFEST" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("ARTFEST")}
        >
          Facturi ArtFest către mine
        </button>
      </div>

      {/* =========================
          TAB: PAYOUTS
         ========================= */}
      {activeTab === "PAYOUTS" && (
        <div role="tabpanel" aria-label="Decontări & plăți">
          {/* Billing card */}
          {billing ? (
            <section className={styles.billingCard} aria-label="Date facturare vendor">
              <h2 className={styles.sectionTitle}>Date facturare</h2>
              <div className={styles.billingGrid}>
                <div>
                  <strong>{billing.companyName}</strong>
                  <div>{billing.address}</div>
                </div>
                <div>
                  <div>CUI: {billing.cui || "—"}</div>
                  <div>Nr. Reg. Com.: {billing.regCom || "—"}</div>
                </div>
                <div>
                  <div>IBAN: {billing.iban || "—"}</div>
                  <div>Banca: {billing.bank || "—"}</div>
                </div>
              </div>
            </section>
          ) : (
            <section className={styles.billingCard} aria-label="Date facturare lipsă">
              <h2 className={styles.sectionTitle}>Date facturare</h2>
              <p className={styles.info}>
                Nu ai completat încă datele de facturare.{" "}
                <a href={BILLING_URL} className={styles.linkInline}>
                  Completează-le acum
                </a>{" "}
                pentru a putea cere plata.
              </p>
            </section>
          )}

          {/* Summary */}
          <section className={styles.summaryRow} aria-label="Sumar decontări">
            {summaryLoading ? (
              <p className={styles.info}>Se încarcă sumarul…</p>
            ) : summaryErr ? (
              <p className={styles.error} role="alert">
                {summaryErr}
              </p>
            ) : (
              <>
                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Disponibil de încasat</span>
                  <span className={styles.summaryValue}>
                    {formatMoney(summary?.availableAmount, summary?.currency || "RON")}
                  </span>
                  <span className={styles.summaryPill}>
                    {Number(summary?.eligibleCount || 0)} intrări eligibile
                  </span>
                </div>

                <div className={styles.summaryCard}>
                  <span className={styles.summaryLabel}>Următoarea cerere posibilă</span>
                  <span className={styles.summaryValue}>
                    {nextEligibleLabel || "Acum"}
                  </span>
                  {summary?.lastPayout?.requestedAt && (
                    <span className={styles.summaryPill}>
                      Ultima cerere: {formatDateTime(summary.lastPayout.requestedAt)}
                    </span>
                  )}
                </div>
              </>
            )}
          </section>

          {/* Actions */}
          <section className={styles.filters} aria-label="Acțiuni decontare">
            <div className={styles.filterGroup} style={{ alignItems: "flex-start" }}>
              <label>Plată</label>
              <button
                type="button"
                className={styles.linkBtn}
                disabled={!canRequestPayout || requesting}
                onClick={onRequestPayout}
              >
                {requesting ? "Se trimite…" : "Cere plata"}
              </button>
              {requestMsg && <div className={styles.info} style={{ marginTop: 8 }}>{requestMsg}</div>}
              {!billing && (
                <div className={styles.info} style={{ marginTop: 8 }}>
                  Completează datele de facturare ca să poți cere plata.
                </div>
              )}
            </div>

            {summary?.breakdown && (
              <div className={styles.filterGroup}>
                <label>Detalii calcul</label>
                <div className={styles.info}>
                  <div>
                    Produse net:{" "}
                    <b>{formatMoney(summary.breakdown.itemsNet, summary.currency)}</b>
                  </div>
                  <div>
                    Comision net:{" "}
                    <b>{formatMoney(summary.breakdown.commissionNet, summary.currency)}</b>
                  </div>
                  <div>
                    Îți revine:{" "}
                    <b>{formatMoney(summary.breakdown.vendorNet, summary.currency)}</b>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    (Transportul nu este inclus în decont, conform regulii tale.)
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Eligible entries */}
          <section className={styles.tableWrap} aria-label="Intrări eligibile">
            <h2 className={styles.sectionTitle}>Comenzi / intrări incluse la următoarea plată</h2>
            <p className={styles.info}>
              Lista de mai jos arată strict partea vendorului (vendorNet) care se va cumula în cererea
              de plată.
            </p>

            {entriesLoading ? (
              <p className={styles.info}>Se încarcă intrările…</p>
            ) : entriesErr ? (
              <p className={styles.error} role="alert">
                {entriesErr}
              </p>
            ) : entries.length === 0 ? (
              <p className={styles.info}>
                Nu există intrări eligibile momentan.
              </p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tip</th>
                    <th>Comandă</th>
                    <th>Sumă (îți revine)</th>
                    <th>Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.occurredAt)}</td>
                      <td>{e.type}</td>
                      <td>{e.orderNumber || e.orderId || "—"}</td>
                      <td>{formatMoney(e.vendorNet, e.currency || "RON")}</td>
                      <td>
                        {e.orderId && (
                          <a href={`/vendor/orders/${e.orderId}`} className={styles.linkBtn}>
                            Vezi comandă
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Payout history */}
          <section className={styles.tableWrap} aria-label="Istoric decontări" style={{ marginTop: 18 }}>
            <h2 className={styles.sectionTitle}>Istoric cereri de plată</h2>

            {payoutsLoading ? (
              <p className={styles.info}>Se încarcă istoricul…</p>
            ) : payoutsErr ? (
              <p className={styles.error} role="alert">
                {payoutsErr}
              </p>
            ) : payouts.length === 0 ? (
              <p className={styles.info}>Nu ai încă cereri de plată.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Data cererii</th>
                    <th>Perioadă</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {payouts.map((p) => (
                    <tr key={p.id}>
                      <td>{formatDateTime(p.requestedAt)}</td>
                      <td>
                        {p.periodFrom && p.periodTo
                          ? `${formatDate(p.periodFrom)} – ${formatDate(p.periodTo)}`
                          : "—"}
                      </td>
                      <td>{formatMoney(p.amountNet, p.currency || "RON")}</td>
                      <td>
                        <span className={`${styles.status} ${styles[`status_${p.status}`]}`}>
                          {PAYOUT_STATUS_LABELS[p.status] || p.status}
                        </span>
                      </td>
                      <td>
                        {p.pdfUrl && (
                          <a
                            href={p.pdfUrl}
                            className={styles.linkBtn}
                            target="_blank"
                            rel="noreferrer"
                          >
                            PDF
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {/* =========================
          TAB: ARTFEST invoices (optional)
         ========================= */}
      {activeTab === "ARTFEST" && (
        <div role="tabpanel" aria-label="Facturi ArtFest către mine">
          <h2 className={styles.sectionTitle}>Facturi ArtFest către mine</h2>
          <p className={styles.info}>
            (Opțional) Dacă păstrezi fluxul în care ArtFest emite facturi către vendor pentru comisioane / abonamente etc.
          </p>

          <section className={styles.filters} aria-label="Filtre facturi ArtFest">
            <div className={styles.filterGroup}>
              <label htmlFor="statusFilter">Status</label>
              <select
                id="statusFilter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">Toate</option>
                <option value="UNPAID">Neplătite</option>
                <option value="OVERDUE">Scadente</option>
                <option value="PAID">Plătite</option>
                <option value="CANCELLED">Anulate</option>
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="typeFilter">Tip factură</label>
              <select
                id="typeFilter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="ALL">Toate</option>
                <option value="COMMISSION">Comisioane</option>
                <option value="SUBSCRIPTION">Abonamente</option>
                <option value="SHIPPING">Curierat</option>
                <option value="OTHER">Altele</option>
              </select>
            </div>
          </section>

          {platformLoading && <p className={styles.info}>Se încarcă facturile…</p>}
          {platformErr && !platformLoading && (
            <p className={styles.error} role="alert">
              {platformErr}
            </p>
          )}

          {!platformLoading && !platformErr && (
            <section aria-label="Lista facturilor ArtFest" className={styles.tableWrap}>
              {filteredPlatformInvoices.length === 0 ? (
                <p className={styles.info}>Nu există facturi pentru criteriile selectate.</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Număr</th>
                      <th>Data</th>
                      <th>Tip</th>
                      <th>Perioadă</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlatformInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.number}</td>
                        <td>{formatDate(inv.issueDate)}</td>
                        <td>{inv.type}</td>
                        <td>
                          {inv.periodFrom && inv.periodTo
                            ? `${formatDate(inv.periodFrom)} – ${formatDate(inv.periodTo)}`
                            : "—"}
                        </td>
                        <td>{formatMoney(inv.totalGross, inv.currency || "RON")}</td>
                        <td>
                          <span className={`${styles.status} ${styles[`status_${inv.status}`]}`}>
                            {inv.status}
                          </span>
                        </td>
                        <td>
                          {inv.downloadUrl && (
                            <a
                              href={inv.downloadUrl}
                              className={styles.linkBtn}
                              target="_blank"
                              rel="noreferrer"
                            >
                              PDF
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>
      )}
    </main>
  );
}
