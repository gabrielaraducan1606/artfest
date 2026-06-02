// src/pages/Vendor/Invoices/InvoicePage.jsx
import { useEffect, useMemo, useState } from "react";
import styles from "./InvoicePage.module.css";

const API_BASE = import.meta.env.VITE_API_URL || "";
const BILLING_URL = "/onboarding/details?tab=facturare";

function apiFileUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;

  const base = String(API_BASE || "").replace(/\/+$/, "");

  if (base.endsWith("/api") && url.startsWith("/api/")) {
    return `${base}${url.replace(/^\/api/, "")}`;
  }

  return `${base}${url}`;
}

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

async function apiGet(url) {
  const res = await fetch(`/api${url}`, {
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || data?.error || "Eroare la încărcare.");
  }

  return data;
}

async function apiPost(url) {
  const res = await fetch(`/api${url}`, {
    method: "POST",
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message || data?.error || "Eroare la salvare.");
  }

  return data;
}

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

function getEntryShippingNet(entry) {
  return Number(
    entry?.shippingNet ??
      entry?.transportNet ??
      entry?.shippingAmount ??
      entry?.meta?.shippingNet ??
      entry?.meta?.transportNet ??
      entry?.meta?.shippingAmount ??
      entry?.meta?.shipping ??
      entry?.meta?.deliveryFee ??
      entry?.shipment?.price ??
      0
  );
}

function getEntryOrderTotalNet(entry) {
  return Number(
    entry?.orderTotalNet ??
      entry?.meta?.orderTotalNet ??
      entry?.meta?.totalNet ??
      Number(entry?.itemsNet || 0) + getEntryShippingNet(entry)
  );
}

function isIndependentCreatorBilling(billing) {
  return billing?.sellerType === "independent_creator";
}

function getBillingDisplayName(billing) {
  if (!billing) return "—";

  if (isIndependentCreatorBilling(billing)) {
    return billing.vendorName || billing.contactPerson || "Creator Independent";
  }

  return billing.companyName || billing.vendorName || "Business Verificat";
}

function getVatLabel(vatStatus) {
  if (vatStatus === "payer") return "Plătitor TVA";
  if (vatStatus === "non_payer") return "Neplătitor TVA";
  return "—";
}

function getInvoiceDisplayNumber(inv) {
  if (inv?.providerSeries && inv?.providerNumber) {
    return `${inv.providerSeries}-${inv.providerNumber}`;
  }

  if (inv?.series && inv?.number) {
    return `${inv.series}-${inv.number}`;
  }

  return inv?.number || "—";
}

function BillingDetails({ billing }) {
  if (!billing) return null;

  const independent = isIndependentCreatorBilling(billing);

  return (
    <div className={styles.billingGrid}>
      <div>
        <strong>{getBillingDisplayName(billing)}</strong>
        <div>
          {independent
            ? "Creator Independent"
            : `Business Verificat${billing.legalType ? ` · ${billing.legalType}` : ""}`}
        </div>
        <div>{billing.address || "—"}</div>
      </div>

      {independent ? (
        <div>
          <div>Nume complet: {billing.contactPerson || "—"}</div>
          <div>Email: {billing.email || "—"}</div>
          <div>Telefon: {billing.phone || "—"}</div>
        </div>
      ) : (
        <div>
          <div>CUI / Cod fiscal: {billing.cui || "—"}</div>
          <div>Nr. Reg. Com.: {billing.regCom || "—"}</div>
          <div>TVA: {getVatLabel(billing.vatStatus)}</div>
        </div>
      )}
    </div>
  );
}

export default function VendorInvoicesPage() {
  const [billing, setBilling] = useState(null);
  const [activeTab, setActiveTab] = useState(TABS.CURRENT_PERIOD);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryErr, setSummaryErr] = useState("");

  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesErr, setEntriesErr] = useState("");

  const [statements, setStatements] = useState([]);

  const [commissionInvoices, setCommissionInvoices] = useState([]);
  const [commissionLoading, setCommissionLoading] = useState(true);
  const [commissionErr, setCommissionErr] = useState("");

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [autoPaySaving, setAutoPaySaving] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadData() {
      try {
        setSummaryLoading(true);
        setEntriesLoading(true);
        setCommissionLoading(true);
        setSummaryErr("");
        setEntriesErr("");
        setCommissionErr("");

        const [summaryRes, entriesRes, statementsRes, invoicesRes, billingRes] =
          await Promise.allSettled([
            apiGet("/vendor/payouts/summary"),
            apiGet("/vendor/payouts/entries?eligible=true"),
            apiGet("/vendor/payouts"),
            apiGet("/vendors/me/invoices"),
            apiGet("/vendors/me/billing"),
          ]);

        if (!alive) return;

        if (summaryRes.status === "fulfilled") {
          setSummary(summaryRes.value);
        } else {
          setSummaryErr(summaryRes.reason?.message || "Nu am putut încărca sumarul financiar.");
        }

        if (entriesRes.status === "fulfilled") {
          setEntries(entriesRes.value?.items || []);
        } else {
          setEntriesErr(entriesRes.reason?.message || "Nu am putut încărca tranzacțiile.");
        }

        if (statementsRes.status === "fulfilled") {
          setStatements(statementsRes.value?.items || []);
        } else {
          setStatements([]);
        }

        if (invoicesRes.status === "fulfilled") {
          setCommissionInvoices(invoicesRes.value?.items || []);
        } else {
          setCommissionErr(invoicesRes.reason?.message || "Nu am putut încărca facturile.");
        }

        if (billingRes.status === "fulfilled") {
          setBilling(billingRes.value?.billing || billingRes.value || null);
        } else {
          setBilling(null);
        }
      } catch (err) {
        if (alive) {
          setSummaryErr(err?.message || "Nu am putut încărca situația financiară.");
          setEntriesErr(err?.message || "Nu am putut încărca tranzacțiile.");
          setCommissionErr(err?.message || "Nu am putut încărca facturile.");
        }
      } finally {
        if (alive) {
          setSummaryLoading(false);
          setEntriesLoading(false);
          setCommissionLoading(false);
        }
      }
    }

    loadData();

    return () => {
      alive = false;
    };
  }, []);

  async function disableAutoPay() {
    try {
      setAutoPaySaving(true);

      await apiPost("/vendors/me/billing/auto-pay/disable");

      setBilling((prev) =>
        prev
          ? {
              ...prev,
              autoBillingEnabled: false,
            }
          : prev
      );

      setCommissionInvoices((prev) =>
        prev.map((inv) => ({
          ...inv,
          autoBillingEnabled: false,
        }))
      );
    } catch (err) {
      alert(err?.message || "Nu am putut dezactiva plata automată.");
    } finally {
      setAutoPaySaving(false);
    }
  }

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
      shippingNet: Number(summary?.currentPeriod?.shippingNet || 0),
      orderTotalNet: Number(summary?.currentPeriod?.orderTotalNet || 0),
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
              <BillingDetails billing={billing} />
            </section>
          ) : (
            <section className={styles.billingCard} aria-label="Date de facturare lipsă">
              <h2 className={styles.sectionTitle}>Datele tale de facturare</h2>
              <p className={styles.info}>
                Nu ai completat încă datele de facturare.{" "}
                <a href={BILLING_URL} className={styles.linkInline}>
                  Completează-le acum
                </a>{" "}
                pentru afișarea corectă a comisioanelor și situațiilor lunare.
              </p>
            </section>
          )}

          <section className={styles.summaryRow} aria-label="Sumar perioadă curentă">
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Vânzări produse nete</span>
              <span className={styles.summaryValue}>
                {formatMoney(currentPeriod.salesNet, currentPeriod.currency)}
              </span>
              <span className={styles.summaryPill}>Produse din comenzile eligibile</span>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Transport</span>
              <span className={styles.summaryValue}>
                {formatMoney(currentPeriod.shippingNet, currentPeriod.currency)}
              </span>
              <span className={styles.summaryPill}>Transport defalcat din comenzi</span>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Total comenzi net</span>
              <span className={styles.summaryValue}>
                {formatMoney(
                  currentPeriod.orderTotalNet || currentPeriod.salesNet + currentPeriod.shippingNet,
                  currentPeriod.currency
                )}
              </span>
              <span className={styles.summaryPill}>Produse + transport</span>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Comision calculat</span>
              <span className={styles.summaryValue}>
                {formatMoney(currentPeriod.commissionNet, currentPeriod.currency)}
              </span>
              <span className={styles.summaryPill}>
                Această sumă intră în calculul facturării platformei
              </span>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Câștigul tău estimat</span>
              <span className={styles.summaryValue}>
                {formatMoney(currentPeriod.vendorNetInformative, currentPeriod.currency)}
              </span>
              <span className={styles.summaryPill}>
                Informativ: vânzări minus comisionul platformei
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
                    <th>Produse net</th>
                    <th>Transport</th>
                    <th>Total comandă</th>
                    <th>Comision</th>
                    <th>Câștig vendor</th>
                    <th>Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const shippingNet = getEntryShippingNet(e);
                    const orderTotalNet = getEntryOrderTotalNet(e);

                    return (
                      <tr key={e.id}>
                        <td>{formatDate(e.occurredAt)}</td>
                        <td>{getEntryTypeLabel(e.type)}</td>
                        <td>{e.orderNumber || e.orderId || "—"}</td>
                        <td>{formatMoney(e.itemsNet, e.currency || "RON")}</td>
                        <td>{formatMoney(shippingNet, e.currency || "RON")}</td>
                        <td>{formatMoney(orderTotalNet, e.currency || "RON")}</td>
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
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section
            className={styles.tableWrap}
            aria-label="Istoric situații lunare"
            style={{ marginTop: 18 }}
          >
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
              <span className={styles.summaryPill}>{billingOverview.unpaidCount} facturi active</span>
            </div>

            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>Următoarea scadență</span>
              <span className={styles.summaryValue}>{formatDateTime(billingOverview.nextDueAt)}</span>
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
                  Aici găsești facturile de comision emise prin SmartBill și salvate în contul tău.
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
                        <th>Sursă</th>
                        <th>Acțiuni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCommissionInvoices.map((inv) => (
                        <tr key={inv.id}>
                          <td>
                            <div>{getInvoiceDisplayNumber(inv)}</div>
                            <div className={styles.clientSubline}>
                              {inv.smartBill
                                ? "Factura SmartBill"
                                : inv.directionLabel || "Factura platformă"}
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
                          <td>{inv.smartBill ? "SmartBill" : "Local"}</td>
                          <td>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {inv.downloadUrl && (
                                <a
                                  href={apiFileUrl(inv.downloadUrl)}
                                  className={styles.linkBtn}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  PDF
                                </a>
                              )}

                              {inv.paymentUrl && (
                                <a href={apiFileUrl(inv.paymentUrl)} className={styles.linkBtn}>
                                  Plătește
                                </a>
                              )}

                              {inv.paymentUrlWithAuto && !inv.autoBillingEnabled && (
                                <a
                                  href={apiFileUrl(inv.paymentUrlWithAuto)}
                                  className={styles.linkBtn}
                                  title="Plătește factura și salvează cardul pentru plăți automate viitoare"
                                >
                                  Plătește + auto
                                </a>
                              )}

                              {inv.autoBillingEnabled && (
                                <>
                                  <span className={styles.clientSubline}>Auto activ</span>

                                  <button
                                    type="button"
                                    className={styles.linkBtn}
                                    onClick={disableAutoPay}
                                    disabled={autoPaySaving}
                                  >
                                    {autoPaySaving ? "Se dezactivează…" : "Dezactivează auto"}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div className={styles.autoBillingNote}>
                  <strong>Ce înseamnă „Plătește + auto”?</strong>

                  <p>
                    Dacă alegi această opțiune, plata facturii se face acum, iar cardul tău poate fi
                    salvat securizat pentru plăți automate viitoare către platformă.
                  </p>

                  <p>
                    Astfel, facturile următoare pot fi achitate automat la scadență, fără să mai fie
                    nevoie să intri manual în cont.
                  </p>

                  <p>Poți dezactiva oricând plata automată din setările contului tău.</p>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}