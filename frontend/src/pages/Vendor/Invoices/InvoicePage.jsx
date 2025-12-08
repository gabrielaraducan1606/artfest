// ==============================
// File: src/pages/Vendor/Invoices/InvoicePage.jsx
// ==============================
import { useEffect, useState, useMemo } from "react";
import { api } from "../../../lib/api";
import styles from "./InvoicePage.module.css";

// URL către tab-ul de facturare din onboarding (ajustează dacă e altul)
const BILLING_URL = "/onboarding/details?tab=facturare";

const STATUS_LABELS = {
  PAID: "Plătită",
  UNPAID: "Neplătită",
  OVERDUE: "Scadentă",
  CANCELLED: "Anulată",
};

const TYPE_LABELS = {
  COMMISSION: "Comisioane",
  SUBSCRIPTION: "Abonamente",
  SHIPPING: "Curierat",
  OTHER: "Altele",
};

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("ro-RO");
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
  // fallback simplu pt alte monede
  return `${v.toFixed(2)} ${currency}`;
}

export default function VendorInvoicesPage() {
  const [billing, setBilling] = useState(null);

  // Facturi ARTFEST → vendor
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  // Tab activ (ACUM: default CLIENTS)
  const [activeTab, setActiveTab] = useState("CLIENTS");

  // Facturi vendor → clienți
  const [clientInvoices, setClientInvoices] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsErr, setClientsErr] = useState("");
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [clientStatusFilter, setClientStatusFilter] = useState("ALL");
  const [clientSearch, setClientSearch] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr("");

        const [billingRes, invRes] = await Promise.all([
          api("/api/vendors/me/billing").catch(() => null),
          api("/api/vendors/me/invoices").catch(() => ({
            items: [],
          })),
        ]);

        if (!alive) return;

        if (billingRes?.billing) setBilling(billingRes.billing);
        const items = Array.isArray(invRes?.items) ? invRes.items : invRes || [];
        setInvoices(items);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Nu am putut încărca facturile.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Lazy-load pentru facturile către clienți
  useEffect(() => {
    if (activeTab !== "CLIENTS" || clientsLoaded) return;

    let alive = true;
    (async () => {
      try {
        setClientsLoading(true);
        setClientsErr("");

        const res = await api("/api/vendors/me/client-invoices").catch(
          () => ({ items: [] })
        );
        if (!alive) return;

        const items = Array.isArray(res?.items) ? res.items : res || [];
        setClientInvoices(items);
        setClientsLoaded(true);
      } catch (e) {
        if (!alive) return;
        setClientsErr(
          e?.message || "Nu am putut încărca facturile către clienți."
        );
      } finally {
        if (alive) setClientsLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [activeTab, clientsLoaded]);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== "ALL" && inv.status !== statusFilter) return false;
      if (typeFilter !== "ALL" && inv.type !== typeFilter) return false;
      return true;
    });
  }, [invoices, statusFilter, typeFilter]);

  const summary = useMemo(() => {
    let totalUnpaid = 0;
    let unpaidCount = 0;
    let totalThisMonth = 0;
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    for (const inv of invoices) {
      const val = Number(inv.totalGross) || 0;
      const issue = inv.issueDate ? new Date(inv.issueDate) : null;

      if (inv.status === "UNPAID" || inv.status === "OVERDUE") {
        totalUnpaid += val;
        unpaidCount += 1;
      }
      if (
        issue &&
        issue.getMonth() === currentMonth &&
        issue.getFullYear() === currentYear
      ) {
        totalThisMonth += val;
      }
    }
    return { totalUnpaid, unpaidCount, totalThisMonth };
  }, [invoices]);

  const filteredClientInvoices = useMemo(() => {
    return clientInvoices.filter((inv) => {
      if (clientStatusFilter !== "ALL" && inv.status !== clientStatusFilter)
        return false;

      const q = clientSearch.trim().toLowerCase();
      if (!q) return true;

      // 🔹 căutăm și după numele firmei / CUI / RegCom
      const haystack = [
        inv.number,
        inv.clientName,
        inv.clientEmail,
        inv.clientCompanyName,
        inv.clientCui,
        inv.clientRegCom,
        inv.orderNumber,
        inv.orderId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [clientInvoices, clientStatusFilter, clientSearch]);

  return (
    <main className={styles.page}>
      {/* ===== HEADER GENERAL ===== */}
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>Facturi</h1>
          <p className={styles.subtitle}>
            Gestionează facturile tale către clienți și facturile emise de ArtFest către tine.
          </p>
        </div>

        <div className={styles.headerRight}>
          <a
            href={BILLING_URL}
            className={styles.linkBtn}
          >
            Actualizează datele de facturare
          </a>
        </div>
      </header>

      {/* ===== TABURI ===== */}
      <div
        className={styles.tabs}
        role="tablist"
        aria-label="Tipuri de facturi"
      >
        {/* PRIMUL: facturile către clienți */}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "CLIENTS"}
          className={`${styles.tab} ${
            activeTab === "CLIENTS" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("CLIENTS")}
        >
          Facturile mele către clienți
        </button>

        {/* AL DOILEA: facturile ArtFest către vendor */}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "ARTFEST"}
          className={`${styles.tab} ${
            activeTab === "ARTFEST" ? styles.tabActive : ""
          }`}
          onClick={() => setActiveTab("ARTFEST")}
        >
          Facturile ArtFest către mine
        </button>
      </div>

      {/* ===== TAB 1: FACTURILE VENDORULUI CĂTRE CLIENȚI ===== */}
      {activeTab === "CLIENTS" && (
        <div
          role="tabpanel"
          aria-label="Facturile mele către clienți"
          className={styles.clientsPanel}
        >
          <h2 className={styles.sectionTitle}>
            Facturile tale către clienți
          </h2>
          <p className={styles.info}>
            Aici vezi facturile emise de tine către clienții finali, pe baza comenzilor din
            ArtFest. Numărul de factură se incrementează automat, dacă lași câmpul gol
            la generare.
          </p>

          <div className={styles.infoBox}>
            <p>
              <strong>Numerotare facturi:</strong> dacă lași câmpul de număr gol la
              prima factură, ArtFest pornește automat o serie (ex: <code>AF-2025-00001</code>)
              și o incrementează la fiecare factură nouă. Dacă introduci un număr propriu,
              vom continua automat numerotarea în funcție de acel număr.
            </p>
            <p>
              <strong>Statusuri:</strong> <b>Neplătită</b> = emisă dar neplătită,&nbsp;
              <b>Scadentă</b> = a trecut de data scadentă,&nbsp;
              <b>Plătită</b> = marcată ca achitată,&nbsp;
              <b>Anulată</b> = factură invalidă.
            </p>
          </div>

          {/* Filtre pentru facturi clienți */}
          <section
            className={styles.filters}
            aria-label="Filtre facturi clienți"
          >
            <div className={styles.filterGroup}>
              <label htmlFor="clientStatusFilter">
                Status
              </label>
              <select
                id="clientStatusFilter"
                value={clientStatusFilter}
                onChange={(e) =>
                  setClientStatusFilter(e.target.value)
                }
              >
                <option value="ALL">Toate</option>
                <option value="UNPAID">Neplătite</option>
                <option value="OVERDUE">Scadente</option>
                <option value="PAID">Plătite</option>
                <option value="CANCELLED">Anulate</option>
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="clientSearch">
                Căutare
              </label>
              <input
                id="clientSearch"
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Număr factură, client, firmă, CUI, comandă…"
              />
            </div>
          </section>

          {clientsLoading && (
            <p className={styles.info}>
              Se încarcă facturile către clienți…
            </p>
          )}
          {clientsErr && !clientsLoading && (
            <p
              className={styles.error}
              role="alert"
            >
              {clientsErr}
            </p>
          )}

          {!clientsLoading && !clientsErr && (
            <section
              aria-label="Lista facturilor către clienți"
              className={styles.tableWrap}
            >
              {filteredClientInvoices.length === 0 ? (
                <p className={styles.info}>
                  Momentan nu există facturi emise către clienți sau nu se potrivesc
                  filtrului selectat.
                </p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Număr</th>
                      <th>Data</th>
                      <th>Client</th>
                      <th>Comandă</th>
                      <th>Total</th>
                      <th>Status</th>
                      <th>Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredClientInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.number}</td>
                        <td>{formatDate(inv.issueDate)}</td>

                        {/* 🔹 CLIENT: PF / PJ cu denumire + CUI / RegCom */}
                        <td>
                          <div>
                            <strong>
                              {inv.clientLegalType === "PJ"
                                ? (inv.clientCompanyName ||
                                   inv.clientName ||
                                   inv.clientEmail ||
                                   "—")
                                : (inv.clientName ||
                                   inv.clientEmail ||
                                   "—")}
                            </strong>
                          </div>

                          {inv.clientLegalType === "PJ" &&
                            (inv.clientCui || inv.clientRegCom) && (
                              <div className={styles.clientSubline}>
                                {inv.clientCui && <>CUI: {inv.clientCui}</>}
                                {inv.clientCui && inv.clientRegCom && " · "}
                                {inv.clientRegCom && (
                                  <>Reg. Com.: {inv.clientRegCom}</>
                                )}
                              </div>
                          )}
                        </td>

                        <td>{inv.orderNumber || inv.orderId || "—"}</td>
                        <td>
                          {formatMoney(
                            inv.totalGross,
                            inv.currency || "RON"
                          )}
                        </td>
                        <td>
                          <span
                            className={`${styles.status} ${
                              styles[`status_${inv.status}`]
                            }`}
                          >
                            {STATUS_LABELS[inv.status] || inv.status}
                          </span>
                        </td>
                        <td className={styles.actionsCell}>
                          {inv.orderId && (
                            <a
                              href={`/vendor/orders/${inv.orderId}`}
                              className={styles.linkBtn}
                            >
                              Vezi comandă
                            </a>
                          )}
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

      {/* ===== TAB 2: FACTURILE ARTFEST CĂTRE VENDOR ===== */}
      {activeTab === "ARTFEST" && (
        <div
          role="tabpanel"
          aria-label="Facturile ArtFest către mine"
        >
          {/* Card cu datele de facturare */}
          {billing ? (
            <section
              className={styles.billingCard}
              aria-label="Datele tale de facturare"
            >
              <h2 className={styles.sectionTitle}>
                Date facturare vendor
              </h2>
              <div className={styles.billingGrid}>
                <div>
                  <strong>{billing.companyName}</strong>
                  <div>{billing.vendorName}</div>
                  <div>{billing.address}</div>
                </div>
                <div>
                  <div>CUI: {billing.cui || "—"}</div>
                  <div>
                    Nr. Reg. Com.: {billing.regCom || "—"}
                  </div>
                  {billing.tvaActive !== undefined && (
                    <div>
                      TVA:{" "}
                      {billing.tvaActive
                        ? "Plătitor TVA"
                        : "Neplătitor TVA"}
                    </div>
                  )}
                </div>
                <div>
                  <div>IBAN: {billing.iban || "—"}</div>
                  <div>Banca: {billing.bank || "—"}</div>
                </div>
                <div>
                  <div>
                    Email facturare:{" "}
                    {billing.email || "—"}
                  </div>
                  <div>
                    Contact:{" "}
                    {billing.contactPerson || "—"} (
                    {billing.phone || "—"})
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className={styles.billingCard}>
              <h2 className={styles.sectionTitle}>
                Date facturare vendor
              </h2>
              <p className={styles.info}>
                Nu ai completat încă datele de facturare.{" "}
                <a
                  href={BILLING_URL}
                  className={styles.linkInline}
                >
                  Completează-le acum
                </a>{" "}
                pentru a putea primi facturi.
              </p>
            </section>
          )}

          {/* Rezumat */}
          <section
            className={styles.summaryRow}
            aria-label="Situație facturi ArtFest"
          >
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>
                Total facturi luna curentă
              </span>
              <span className={styles.summaryValue}>
                {formatMoney(summary.totalThisMonth)}
              </span>
            </div>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>
                Suma neplătită către ArtFest
              </span>
              <span className={styles.summaryValue}>
                {formatMoney(summary.totalUnpaid)}
              </span>
              <span className={styles.summaryPill}>
                {summary.unpaidCount} factur
                {summary.unpaidCount === 1 ? "ă" : "i"}
              </span>
            </div>
          </section>

          {/* Filtre */}
          <section
            className={styles.filters}
            aria-label="Filtre facturi"
          >
            <div className={styles.filterGroup}>
              <label htmlFor="statusFilter">
                Status
              </label>
              <select
                id="statusFilter"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value)
                }
              >
                <option value="ALL">Toate</option>
                <option value="UNPAID">Neplătite</option>
                <option value="OVERDUE">Scadente</option>
                <option value="PAID">Plătite</option>
                <option value="CANCELLED">Anulate</option>
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="typeFilter">
                Tip factură
              </label>
              <select
                id="typeFilter"
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value)
                }
              >
                <option value="ALL">Toate</option>
                <option value="COMMISSION">
                  Comisioane
                </option>
                <option value="SUBSCRIPTION">
                  Abonamente
                </option>
                <option value="SHIPPING">
                  Curierat
                </option>
                <option value="OTHER">
                  Altele
                </option>
              </select>
            </div>
          </section>

          {loading && (
            <p className={styles.info}>
              Se încarcă facturile…
            </p>
          )}
          {err && !loading && (
            <p
              className={styles.error}
              role="alert"
            >
              {err}
            </p>
          )}

          {!loading && !err && (
            <section
              aria-label="Lista facturilor ArtFest"
              className={styles.tableWrap}
            >
              {filteredInvoices.length === 0 ? (
                <p className={styles.info}>
                  Nu există facturi pentru criteriile selectate.
                </p>
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
                    {filteredInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>{inv.number}</td>
                        <td>
                          {formatDate(inv.issueDate)}
                        </td>
                        <td>
                          {TYPE_LABELS[inv.type] || inv.type}
                        </td>
                        <td>
                          {inv.periodFrom && inv.periodTo
                            ? `${formatDate(inv.periodFrom)} – ${formatDate(
                                inv.periodTo
                              )}`
                            : "—"}
                        </td>
                        <td>
                          {formatMoney(
                            inv.totalGross,
                            inv.currency || "RON"
                          )}
                        </td>
                        <td>
                          <span
                            className={`${styles.status} ${
                              styles[`status_${inv.status}`]
                            }`}
                          >
                            {STATUS_LABELS[inv.status] || inv.status}
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
                              Descarcă PDF
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
