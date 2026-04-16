// src/pages/Vendor/Invoices/InvoicePage.jsx
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import styles from "./InvoicePage.module.css";

const BILLING_URL = "/onboarding/details?tab=facturare";

const TABS = {
  CURRENT_PERIOD: "CURRENT_PERIOD",
  PLATFORM_INVOICES: "PLATFORM_INVOICES",
};

const STATEMENT_STATUS_LABELS = {
  DRAFT: "Ciornă",
  UNPAID: "Neplătit",
  OVERDUE: "Scadent",
  PAID: "Plătit",
  CANCELLED: "Anulat",
};

const COMMISSION_INVOICE_STATUS_LABELS = {
  DRAFT: "Ciornă",
  UNPAID: "Neplătită",
  OVERDUE: "Scadentă",
  PAID: "Plătită",
  CANCELLED: "Anulată",
};

const COMMISSION_INVOICE_TYPE_LABELS = {
  COMMISSION: "Comision",
  SUBSCRIPTION: "Abonament",
  SHIPPING: "Curierat",
  OTHER: "Altele",
};

const ENTRY_TYPE_LABELS = {
  SALE: "Comandă",
  ADJUSTMENT: "Ajustare",
  REFUND: "Corecție",
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

function getEntryTypeLabel(type) {
  return ENTRY_TYPE_LABELS[type] || type || "—";
}

function getCommissionInvoiceStatusLabel(status) {
  return COMMISSION_INVOICE_STATUS_LABELS[status] || status || "—";
}

function getCommissionInvoiceTypeLabel(type) {
  return COMMISSION_INVOICE_TYPE_LABELS[type] || type || "—";
}

export default function VendorInvoicesPage() {
  const [billing, setBilling] = useState(null);
  const [activeTab, setActiveTab] = useState(TABS.CURRENT_PERIOD);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryErr, setSummaryErr] = useState("");

  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesErr, setEntriesErr] = useState("");

  const [statements, setStatements] = useState([]);

  const [commissionInvoices, setCommissionInvoices] = useState([]);
  const [commissionLoading, setCommissionLoading] = useState(false);
  const [commissionErr, setCommissionErr] = useState("");
  const [commissionLoaded, setCommissionLoaded] = useState(false);

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setSummaryLoading(true);
        setSummaryErr("");

        const [billingRes, summaryRes, statementsRes] = await Promise.all([
          api("/api/vendors/me/billing").catch(() => null),
          api("/api/vendor/payouts/summary"),
          api("/api/vendor/payouts").catch(() => ({ items: [] })),
        ]);

        if (!alive) return;

        setBilling(billingRes?.billing || null);
        setSummary(summaryRes || null);
        setStatements(Array.isArray(statementsRes?.items) ? statementsRes.items : []);
      } catch (e) {
        if (!alive) return;
        setSummaryErr(e?.message || "Nu am putut încărca sumarul financiar.");
      } finally {
        if (alive) setSummaryLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== TABS.CURRENT_PERIOD) return;

    let alive = true;

    (async () => {
      try {
        setEntriesLoading(true);
        setEntriesErr("");

        const res = await api("/api/vendor/payouts/entries?eligible=true").catch(() => ({
          items: [],
        }));

        if (!alive) return;
        setEntries(Array.isArray(res?.items) ? res.items : []);
      } catch (e) {
        if (!alive) return;
        setEntriesErr(e?.message || "Nu am putut încărca comenzile incluse în calcul.");
      } finally {
        if (alive) setEntriesLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== TABS.PLATFORM_INVOICES || commissionLoaded) return;

    let alive = true;

    (async () => {
      try {
        setCommissionLoading(true);
        setCommissionErr("");

        const res = await api("/api/vendors/me/invoices").catch(() => ({
          items: [],
        }));

        if (!alive) return;

        setCommissionInvoices(Array.isArray(res?.items) ? res.items : []);
        setCommissionLoaded(true);
      } catch (e) {
        if (!alive) return;
        setCommissionErr(e?.message || "Nu am putut încărca facturile platformei.");
      } finally {
        if (alive) setCommissionLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [activeTab, commissionLoaded]);

  const filteredCommissionInvoices = useMemo(() => {
    return commissionInvoices.filter((inv) => {
      if (statusFilter !== "ALL" && inv.status !== statusFilter) return false;
      if (typeFilter !== "ALL" && inv.type !== typeFilter) return false;
      return true;
    });
  }, [commissionInvoices, statusFilter, typeFilter]);

  const currentPeriod = useMemo(() => {
    return {
      entryCount: Number(summary?.currentPeriod?.entryCount || 0),
      salesNet: Number(summary?.currentPeriod?.salesNet || 0),
      commissionNet: Number(summary?.currentPeriod?.commissionNet || 0),
      vendorNetInformative: Number(summary?.currentPeriod?.vendorNetInformative || 0),
      currency: summary?.currentPeriod?.currency || summary?.currency || "RON",
    };
  }, [summary]);

  const billingOverview = useMemo(() => {
    return {
      totalDue: Number(summary?.billing?.totalDue || 0),
      totalPaid: Number(summary?.billing?.totalPaid || 0),
      totalInvoiced: Number(summary?.billing?.totalInvoiced || 0),
      totalOverdue: Number(summary?.billing?.totalOverdue || 0),
      unpaidCount: Number(summary?.billing?.unpaidCount || 0),
      nextDueAt: summary?.billing?.nextDueAt || null,
      currency: summary?.billing?.currency || summary?.currency || "RON",
    };
  }, [summary]);

  const nextImportantMoment = useMemo(() => {
    if (billingOverview.nextDueAt) {
      return {
        label: formatDateTime(billingOverview.nextDueAt),
        hint: "Scadența următoarei facturi emise de platformă",
      };
    }

    if (summary?.nextStatementAt) {
      return {
        label: formatDateTime(summary.nextStatementAt),
        hint: "Următoarea închidere / emitere de situație lunară",
      };
    }

    return {
      label: "—",
      hint: "Nu există scadențe sau repere active",
    };
  }, [billingOverview.nextDueAt, summary]);

  const lastStatementLabel = useMemo(() => {
    if (!summary?.lastStatement?.issuedAt) return null;
    return formatDateTime(summary.lastStatement.issuedAt);
  }, [summary]);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Facturare și comisioane</h1>
          <p className={styles.subtitle}>
            Vezi comisionul acumulat din comenzile tale, facturile emise de platformă și istoricul
            situațiilor lunare.
          </p>
        </div>

        <div className={styles.headerRight}>
          <a href={BILLING_URL} className={styles.linkBtn}>
            Actualizează datele de facturare
          </a>
        </div>
      </header>

      {summaryLoading ? (
        <p className={styles.info}>Se încarcă situația financiară…</p>
      ) : summaryErr ? (
        <p className={styles.error} role="alert">
          {summaryErr}
        </p>
      ) : (
        <section className={styles.summaryRow} aria-label="Imagine de ansamblu">
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Comision estimat în perioada curentă</span>
            <span className={styles.summaryValue}>
              {formatMoney(currentPeriod.commissionNet, currentPeriod.currency)}
            </span>
            <span className={styles.summaryPill}>
              {currentPeriod.entryCount} tranzacții incluse în calcul
            </span>
          </div>

          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Ai de plată către platformă</span>
            <span className={styles.summaryValue}>
              {formatMoney(billingOverview.totalDue, billingOverview.currency)}
            </span>
            <span className={styles.summaryPill}>
              {billingOverview.unpaidCount} facturi neachitate / scadente
            </span>
          </div>

          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Următorul moment important</span>
            <span className={styles.summaryValue}>{nextImportantMoment.label}</span>
            <span className={styles.summaryPill}>{nextImportantMoment.hint}</span>
          </div>
        </section>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Secțiuni">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === TABS.CURRENT_PERIOD}
          className={`${styles.tab} ${activeTab === TABS.CURRENT_PERIOD ? styles.tabActive : ""}`}
          onClick={() => setActiveTab(TABS.CURRENT_PERIOD)}
        >
          Comision perioada curentă
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === TABS.PLATFORM_INVOICES}
          className={`${styles.tab} ${
            activeTab === TABS.PLATFORM_INVOICES ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab(TABS.PLATFORM_INVOICES)}
        >
          Facturi emise de platformă
        </button>
      </div>

      {activeTab === TABS.CURRENT_PERIOD && (
        <div role="tabpanel" aria-label="Comision perioadă curentă">
          {billing ? (
            <section className={styles.billingCard} aria-label="Date de facturare">
              <h2 className={styles.sectionTitle}>Datele tale de facturare</h2>
              <div className={styles.billingGrid}>
                <div>
                  <strong>{billing.companyName}</strong>
                  <div>{billing.address || "—"}</div>
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
            <section className={styles.billingCard} aria-label="Date de facturare lipsă">
              <h2 className={styles.sectionTitle}>Datele tale de facturare</h2>
              <p className={styles.info}>
                Nu ai completat încă datele de facturare.{" "}
                <a href={BILLING_URL} className={styles.linkInline}>
                  Completează-le acum
                </a>{" "}
                pentru emiterea corectă a facturilor și documentelor lunare.
              </p>
            </section>
          )}

          <section className={styles.summaryRow} aria-label="Sumar perioadă curentă">
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Vânzări nete în calcul</span>
              <span className={styles.summaryValue}>
                {formatMoney(currentPeriod.salesNet, currentPeriod.currency)}
              </span>
              <span className={styles.summaryPill}>
                Pe baza comenzilor livrate și ajustărilor deschise
              </span>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Comision calculat</span>
              <span className={styles.summaryValue}>
                {formatMoney(currentPeriod.commissionNet, currentPeriod.currency)}
              </span>
              <span className={styles.summaryPill}>
                Această sumă va intra în următoarea factură / situație
              </span>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Net vendor informativ</span>
              <span className={styles.summaryValue}>
                {formatMoney(currentPeriod.vendorNetInformative, currentPeriod.currency)}
              </span>
              <span className={styles.summaryPill}>
                Informativ, fără a reprezenta o plată procesată de platformă
              </span>
            </div>
          </section>

          <section className={styles.tableWrap} aria-label="Comenzi incluse în calcul">
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>Comenzi incluse în calculul comisionului</h2>
                <p className={styles.info}>
                  Aici vezi comenzile și ajustările care intră în perioada curentă de facturare.
                </p>
              </div>
            </div>

            {entriesLoading ? (
              <p className={styles.info}>Se încarcă tranzacțiile…</p>
            ) : entriesErr ? (
              <p className={styles.error} role="alert">
                {entriesErr}
              </p>
            ) : entries.length === 0 ? (
              <p className={styles.info}>Nu există tranzacții deschise în perioada curentă.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tip</th>
                    <th>Comandă</th>
                    <th>Net produse</th>
                    <th>Comision</th>
                    <th>Net informativ vendor</th>
                    <th>Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.occurredAt)}</td>
                      <td>{getEntryTypeLabel(e.type)}</td>
                      <td>{e.orderNumber || e.orderId || "—"}</td>
                      <td>{formatMoney(e.itemsNet, e.currency || "RON")}</td>
                      <td>{formatMoney(e.commissionNet, e.currency || "RON")}</td>
                      <td>{formatMoney(e.vendorNet, e.currency || "RON")}</td>
                      <td>
                        {e.orderId && (
                          <a href={`/vendor/orders/${e.orderId}`} className={styles.linkBtn}>
                            Vezi comanda
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className={styles.tableWrap} aria-label="Istoric situații lunare" style={{ marginTop: 18 }}>
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>Istoric situații lunare</h2>
                <p className={styles.info}>
                  Fiecare situație lunară agregă comenzile dintr-o perioadă și comisionul aferent.
                </p>
              </div>
            </div>

            {statements.length === 0 ? (
              <p className={styles.info}>Nu există încă situații lunare generate.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Emisă la</th>
                    <th>Perioadă</th>
                    <th>Vânzări nete</th>
                    <th>Comision</th>
                    <th>Status</th>
                    <th>Actiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {statements.map((s) => (
                    <tr key={s.id}>
                      <td>{formatDateTime(s.issuedAt)}</td>
                      <td>
                        {s.periodFrom && s.periodTo
                          ? `${formatDate(s.periodFrom)} – ${formatDate(s.periodTo)}`
                          : "—"}
                      </td>
                      <td>{formatMoney(s.totalItemsNet, s.currency || "RON")}</td>
                      <td>{formatMoney(s.totalCommissionNet, s.currency || "RON")}</td>
                      <td>
                        <span className={`${styles.status} ${styles[`status_${s.status}`]}`}>
                          {STATEMENT_STATUS_LABELS[s.status] || s.status}
                        </span>
                      </td>
                      <td>
                        {s.pdfUrl && (
                          <a
                            href={s.pdfUrl}
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

            {lastStatementLabel && (
              <p className={styles.info} style={{ marginTop: 10 }}>
                Ultima situație emisă: {lastStatementLabel}
              </p>
            )}
          </section>
        </div>
      )}

      {activeTab === TABS.PLATFORM_INVOICES && (
        <div role="tabpanel" aria-label="Facturi emise de platformă">
          <section className={styles.summaryRow} aria-label="Sumar facturi platformă">
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Ai de plată acum</span>
              <span className={styles.summaryValue}>
                {formatMoney(billingOverview.totalDue, billingOverview.currency)}
              </span>
              <span className={styles.summaryPill}>
                {billingOverview.unpaidCount} facturi active
              </span>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Următoarea scadență</span>
              <span className={styles.summaryValue}>
                {formatDateTime(billingOverview.nextDueAt)}
              </span>
              <span className={styles.summaryPill}>
                {billingOverview.totalOverdue > 0
                  ? `Restanțe curente: ${formatMoney(
                      billingOverview.totalOverdue,
                      billingOverview.currency
                    )}`
                  : "Nu există restanțe în acest moment"}
              </span>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Plătit până acum</span>
              <span className={styles.summaryValue}>
                {formatMoney(billingOverview.totalPaid, billingOverview.currency)}
              </span>
              <span className={styles.summaryPill}>
                Total facturat: {formatMoney(billingOverview.totalInvoiced, billingOverview.currency)}
              </span>
            </div>
          </section>

          <section className={styles.tableWrap} aria-label="Facturi platformă">
            <div className={styles.sectionHead}>
              <div>
                <h2 className={styles.sectionTitle}>Facturi emise de platformă</h2>
                <p className={styles.info}>
                  Aici găsești facturile pentru comisioane, abonamente, curierat sau alte costuri
                  asociate contului tău.
                </p>
              </div>
            </div>

            <section className={styles.filters} aria-label="Filtre facturi">
              <div className={styles.filterGroup}>
                <label htmlFor="statusFilter">Status</label>
                <select
                  id="statusFilter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="ALL">Toate</option>
                  <option value="DRAFT">Ciornă</option>
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

            {commissionLoading && <p className={styles.info}>Se încarcă facturile…</p>}

            {commissionErr && !commissionLoading && (
              <p className={styles.error} role="alert">
                {commissionErr}
              </p>
            )}

            {!commissionLoading && !commissionErr && (
              <>
                {filteredCommissionInvoices.length === 0 ? (
                  <p className={styles.info}>Nu există facturi pentru criteriile selectate.</p>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Număr</th>
                        <th>Emisă la</th>
                        <th>Scadență</th>
                        <th>Tip</th>
                        <th>Comandă</th>
                        <th>Total</th>
                        <th>Status</th>
                        <th>Actiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCommissionInvoices.map((inv) => (
                        <tr key={inv.id}>
                          <td>
                            <div>{inv.number}</div>
                            <div className={styles.clientSubline}>
                              {inv.directionLabel || "Factura platformă"}
                            </div>
                          </td>
                          <td>{formatDate(inv.issueDate)}</td>
                          <td>{formatDate(inv.dueDate)}</td>
                          <td>{getCommissionInvoiceTypeLabel(inv.type)}</td>
                          <td>{inv.orderNumber || inv.orderId || "—"}</td>
                          <td>{formatMoney(inv.totalGross, inv.currency || "RON")}</td>
                          <td>
                            <span className={`${styles.status} ${styles[`status_${inv.status}`]}`}>
                              {getCommissionInvoiceStatusLabel(inv.status)}
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
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}