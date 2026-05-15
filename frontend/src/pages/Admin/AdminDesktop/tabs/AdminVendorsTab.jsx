// AdminVendorsTab.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { FaUndoAlt } from "react-icons/fa";
import { api } from "../../../../lib/api";
import styles from "../AdminDesktop.module.css";

const PAGE_SIZE = 25;

function createDefaultVendorFilters() {
  return {
    q: "",
    active: "ALL",
    hasBilling: "ALL",
    sellerType: "ALL",
    tva: "ALL",
    hasFollowers: "ALL",
    stripe: "ALL",
    sort: "NEWEST",
  };
}

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

function formatSellerType(billing) {
  if (!billing) return "—";
  if (billing.sellerType === "independent_creator") return "Creator Independent";
  if (billing.sellerType === "verified_business") return "Business Verificat";
  return "—";
}

function formatBillingIdentity(billing) {
  if (!billing) return "—";

  if (billing.sellerType === "independent_creator") {
    return billing.vendorName || billing.contactPerson || "Creator Independent";
  }

  return billing.companyName || billing.vendorName || billing.cui || "Business Verificat";
}

function formatBoolDate(ok, date) {
  if (!ok) return "Nu";
  return date ? `Da – ${formatDate(date)}` : "Da";
}

function formatVendorVatShort(billing) {
  if (!billing || billing.sellerType === "independent_creator") return "—";
  if (!billing.vatStatus) return "—";

  if (billing.vatStatus === "payer") {
    if (billing.vatRate) return `Plătitor (${billing.vatRate}%)`;
    return "Plătitor";
  }

  if (billing.vatStatus === "non_payer") return "Neplătitor";
  return "—";
}

function formatVendorVatLong(billing) {
  if (!billing || billing.sellerType === "independent_creator") return "Nu se aplică";
  if (!billing.vatStatus) return "Nespecificat";

  if (billing.vatStatus === "payer") {
    if (billing.vatRate) return `Plătitor de TVA – cotă ${billing.vatRate}%`;
    return "Plătitor de TVA";
  }

  if (billing.vatStatus === "non_payer") return "Neplătitor de TVA";
  return "Nespecificat";
}

function formatEntityDeclarationShort(v) {
  if (!v?.entitySelfDeclared) return "Neconfirmat";
  const when = v.entitySelfDeclaredAt ? formatDate(v.entitySelfDeclaredAt) : null;
  return when ? `Confirmat • ${when}` : "Confirmat";
}

function extractEntityMeta(meta) {
  if (!meta || typeof meta !== "object") return { pageUrl: null, referrer: null };

  return {
    pageUrl: typeof meta.pageUrl === "string" ? meta.pageUrl : null,
    referrer: typeof meta.referrer === "string" ? meta.referrer : null,
  };
}

function getStripeShortStatus(v) {
  if (!v?.stripeAccountId) return "—";

  const st = v?.stripeConnectStatus || "pending";
  if (st === "enabled") return "Enabled";
  if (st === "pending") return "Pending";
  if (st === "restricted") return "Restricted";
  if (st === "not_started") return "—";

  return String(st);
}

export default function AdminVendorsTab({ vendors }) {
  const [filters, setFilters] = useState(createDefaultVendorFilters);
  const [page, setPage] = useState(1);

  const [localVendors, setLocalVendors] = useState(() => vendors || []);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    setLocalVendors(vendors || []);
  }, [vendors]);

  const handleFilterChange = (updater) => {
    setFilters((prev) => (typeof updater === "function" ? updater(prev) : updater));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(createDefaultVendorFilters());
    setPage(1);
  };

  const filteredVendors = useMemo(() => {
    let list = [...(localVendors || [])];
    const q = filters.q.trim().toLowerCase();

    if (q) {
      list = list.filter((v) => {
        const billing = v.billing || {};

        const searchable = [
          v.displayName,
          v.user?.email,
          v.address,
          v.email,
          v.phone,
          billing.sellerType,
          billing.vendorName,
          billing.companyName,
          billing.cui,
          billing.regCom,
          billing.address,
          billing.email,
          billing.contactPerson,
          billing.phone,
          billing.vatStatus,
          billing.vatRate,
          v.stripeAccountId,
          v.stripeConnectStatus,
          v.entitySelfDeclaredMeta ? JSON.stringify(v.entitySelfDeclaredMeta) : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchable.includes(q);
      });
    }

    if (filters.active === "YES") list = list.filter((v) => v.isActive);
    else if (filters.active === "NO") list = list.filter((v) => !v.isActive);

    if (filters.hasBilling === "YES") list = list.filter((v) => !!v.billing);
    else if (filters.hasBilling === "NO") list = list.filter((v) => !v.billing);

    if (filters.sellerType === "INDEPENDENT") {
      list = list.filter((v) => v.billing?.sellerType === "independent_creator");
    } else if (filters.sellerType === "BUSINESS") {
      list = list.filter((v) => v.billing?.sellerType === "verified_business");
    }

    if (filters.tva === "YES") {
      list = list.filter((v) => v.billing?.tvaActive === true);
    } else if (filters.tva === "NO") {
      list = list.filter((v) => v.billing && v.billing.tvaActive === false);
    }

    if (filters.hasFollowers === "YES") {
      list = list.filter((v) => (v.followers || 0) > 0);
    } else if (filters.hasFollowers === "NO") {
      list = list.filter((v) => (v.followers || 0) === 0);
    }

    if (filters.stripe === "CONNECTED") list = list.filter((v) => !!v.stripeAccountId);
    else if (filters.stripe === "NOT_CONNECTED") list = list.filter((v) => !v.stripeAccountId);
    else if (filters.stripe === "ENABLED") list = list.filter((v) => v.stripeConnectStatus === "enabled");
    else if (filters.stripe === "PENDING") list = list.filter((v) => !!v.stripeAccountId && v.stripeConnectStatus === "pending");
    else if (filters.stripe === "RESTRICTED") list = list.filter((v) => !!v.stripeAccountId && v.stripeConnectStatus === "restricted");

    if (filters.sort === "NEWEST") list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (filters.sort === "OLDEST") list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (filters.sort === "NAME") list.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || "", "ro-RO"));
    else if (filters.sort === "FOLLOWERS") list.sort((a, b) => (b.followers || 0) - (a.followers || 0));

    return list;
  }, [localVendors, filters]);

  const totalItems = filteredVendors.length;
  const totalPages = totalItems ? Math.ceil(totalItems / PAGE_SIZE) : 1;
  const currentPage = Math.min(page, totalPages);
  const paginatedVendors = filteredVendors.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const updateVendorInState = useCallback((updatedVendor) => {
    setLocalVendors((prev) => prev.map((v) => (v.id === updatedVendor.id ? updatedVendor : v)));
    setSelectedVendor((prev) => (prev && prev.id === updatedVendor.id ? updatedVendor : prev));
  }, []);

  const handleToggleActive = async (vendor) => {
    setActionError("");
    setBusyId(vendor.id);

    try {
      const endpoint = vendor.isActive
        ? `/api/admin/vendors/${vendor.id}/deactivate`
        : `/api/admin/vendors/${vendor.id}/activate`;

      const resp = await api(endpoint, { method: "POST" });
      if (resp?.vendor) updateVendorInState({ ...vendor, ...resp.vendor });
    } catch (e) {
      setActionError(e?.data?.error || e?.message || "Nu am putut actualiza statusul vendorului.");
    } finally {
      setBusyId(null);
    }
  };

  const handleSendReset = async (vendor) => {
    setActionError("");
    setBusyId(vendor.id);

    try {
      if (!vendor.user?.id) {
        setActionError("Vendorul nu are un user asociat.");
        return;
      }

      await api(`/api/admin/users/${vendor.user.id}/send-password-reset`, {
        method: "POST",
      });

      alert("Email de resetare parolă trimis.");
    } catch (e) {
      setActionError(e?.data?.error || e?.message || "Nu am putut trimite emailul de resetare.");
    } finally {
      setBusyId(null);
    }
  };

  const handleForceAgreementsReset = async (vendor) => {
    setActionError("");
    setBusyId(vendor.id);

    try {
      await api(`/api/admin/vendors/${vendor.id}/reset-agreements`, {
        method: "POST",
      });

      alert("Acordurile legale au fost resetate.");
    } catch (e) {
      setActionError(e?.data?.error || e?.message || "Nu am putut reseta acordurile legale.");
    } finally {
      setBusyId(null);
    }
  };

  const handleStripeSync = async (vendor) => {
    setActionError("");
    setBusyId(vendor.id);

    try {
      const resp = await api(`/api/admin/vendors/${vendor.id}/stripe/sync`, {
        method: "POST",
      });

      if (resp?.vendor) updateVendorInState({ ...vendor, ...resp.vendor });
      alert("Status Stripe actualizat.");
    } catch (e) {
      setActionError(e?.data?.message || e?.data?.error || e?.message || "Nu am putut sincroniza statusul Stripe.");
    } finally {
      setBusyId(null);
    }
  };

  if (!localVendors?.length) {
    return <p className={styles.subtle}>Nu există vendori sau nu au fost încărcați încă.</p>;
  }

  return (
    <>
      <div className={styles.filtersRow}>
        <label>
          <span>Caută</span>
          <input
            type="text"
            placeholder="Nume, email, CUI, tip vendor, TVA, Stripe..."
            value={filters.q}
            onChange={(e) => handleFilterChange((f) => ({ ...f, q: e.target.value }))}
          />
        </label>

        <label>
          <span>Activ</span>
          <select value={filters.active} onChange={(e) => handleFilterChange((f) => ({ ...f, active: e.target.value }))}>
            <option value="ALL">Toți</option>
            <option value="YES">Doar activi</option>
            <option value="NO">Doar inactivi</option>
          </select>
        </label>

        <label>
          <span>Billing</span>
          <select value={filters.hasBilling} onChange={(e) => handleFilterChange((f) => ({ ...f, hasBilling: e.target.value }))}>
            <option value="ALL">Toți</option>
            <option value="YES">Cu billing</option>
            <option value="NO">Fără billing</option>
          </select>
        </label>

        <label>
          <span>Tip vânzător</span>
          <select value={filters.sellerType} onChange={(e) => handleFilterChange((f) => ({ ...f, sellerType: e.target.value }))}>
            <option value="ALL">Toți</option>
            <option value="BUSINESS">Business Verificat</option>
            <option value="INDEPENDENT">Creator Independent</option>
          </select>
        </label>

        <label>
          <span>TVA activ ANAF</span>
          <select value={filters.tva} onChange={(e) => handleFilterChange((f) => ({ ...f, tva: e.target.value }))}>
            <option value="ALL">Toți</option>
            <option value="YES">TVA activ</option>
            <option value="NO">TVA inactiv</option>
          </select>
        </label>

        <label>
          <span>Urmăritori</span>
          <select value={filters.hasFollowers} onChange={(e) => handleFilterChange((f) => ({ ...f, hasFollowers: e.target.value }))}>
            <option value="ALL">Toți</option>
            <option value="YES">Cu urmăritori</option>
            <option value="NO">Fără urmăritori</option>
          </select>
        </label>

        <label>
          <span>Stripe</span>
          <select value={filters.stripe} onChange={(e) => handleFilterChange((f) => ({ ...f, stripe: e.target.value }))}>
            <option value="ALL">Toți</option>
            <option value="CONNECTED">Conectați</option>
            <option value="NOT_CONNECTED">Neconectați</option>
            <option value="ENABLED">Enabled</option>
            <option value="PENDING">Pending</option>
            <option value="RESTRICTED">Restricted</option>
          </select>
        </label>

        <label>
          <span>Sortare</span>
          <select value={filters.sort} onChange={(e) => handleFilterChange((f) => ({ ...f, sort: e.target.value }))}>
            <option value="NEWEST">Cei mai noi</option>
            <option value="OLDEST">Cei mai vechi</option>
            <option value="NAME">Nume A–Z</option>
            <option value="FOLLOWERS">Cei mai urmăriți</option>
          </select>
        </label>

        <div className={styles.filtersActions}>
          <button type="button" className={styles.resetBtn} onClick={resetFilters}>
            <FaUndoAlt size={14} />
            <span>Reset</span>
          </button>

          <span className={styles.filtersCount}>{totalItems} vendori</span>
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Magazin</th>
              <th>Tip vânzător</th>
              <th>Billing</th>
              <th>Activ</th>
              <th>Acorduri</th>
              <th>Utilizator</th>
              <th>CUI</th>
              <th>Stripe</th>
              <th>Payouts</th>
              <th>Charges</th>
              <th>TVA ANAF</th>
              <th>TVA vendor</th>
              <th># Servicii</th>
              <th># Vizitatori</th>
              <th># Urmăritori</th>
              <th># Tickets</th>
              <th>Creat la</th>
            </tr>
          </thead>

          <tbody>
            {paginatedVendors.map((v) => {
              const billing = v.billing;
              const counts = v._count || {};
              const isBusy = busyId === v.id;
              const ag = v.agreementsSummary;

              return (
                <tr
                  key={v.id}
                  className={styles.clickableRow}
                  onClick={() => setSelectedVendor(v)}
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedVendor(v);
                    }
                  }}
                >
                  <td>{v.displayName}</td>
                  <td>{formatSellerType(billing)}</td>
                  <td>{formatBillingIdentity(billing)}</td>

                  <td>
                    <span className={v.isActive ? styles.vendorStatusActive : styles.vendorStatusInactive}>
                      {isBusy ? "…" : v.isActive ? "Activ" : "Inactiv"}
                    </span>
                  </td>

                  <td>{ag ? (ag.allRequired ? "OK" : "Incomplet") : "—"}</td>
                  <td>{v.user?.email || "—"}</td>
                  <td>{billing?.sellerType === "verified_business" ? billing?.cui || "—" : "—"}</td>
                  <td title={v.stripeAccountId || "Neconectat"}>{getStripeShortStatus(v)}</td>
                  <td>{v.stripeAccountId ? (v.stripePayoutsEnabled ? "Da" : "Nu") : "—"}</td>
                  <td>{v.stripeAccountId ? (v.stripeChargesEnabled ? "Da" : "Nu") : "—"}</td>
                  <td>
                    {billing?.sellerType === "verified_business"
                      ? billing.tvaActive === null || billing.tvaActive === undefined
                        ? "—"
                        : billing.tvaActive
                        ? "Da"
                        : "Nu"
                      : "—"}
                  </td>
                  <td>{formatVendorVatShort(billing)}</td>
                  <td>{counts.services ?? 0}</td>
                  <td>{counts.visitors ?? 0}</td>
                  <td>{v.followers ?? 0}</td>
                  <td>{counts.supportTickets ?? 0}</td>
                  <td>{formatDate(v.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={currentPage} totalPages={totalPages} totalItems={totalItems} onPageChange={setPage} />

      {selectedVendor && (
        <VendorDetailsDrawer
          vendor={selectedVendor}
          busy={busyId === selectedVendor.id}
          error={actionError}
          onClose={() => setSelectedVendor(null)}
          onToggleActive={handleToggleActive}
          onSendReset={handleSendReset}
          onForceAgreementsReset={handleForceAgreementsReset}
          onStripeSync={handleStripeSync}
        />
      )}
    </>
  );
}

function VendorDetailsDrawer({
  vendor,
  busy,
  error,
  onClose,
  onToggleActive,
  onSendReset,
  onForceAgreementsReset,
  onStripeSync,
}) {
  if (!vendor || typeof document === "undefined") return null;

  const billing = vendor.billing;
  const counts = vendor._count || {};
  const ag = vendor.agreementsSummary;
  const { pageUrl, referrer } = extractEntityMeta(vendor.entitySelfDeclaredMeta);
  const stripeConnected = !!vendor.stripeAccountId;
  const isBusiness = billing?.sellerType === "verified_business";
  const isIndependent = billing?.sellerType === "independent_creator";

  const node = (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <aside className={styles.drawer} onClick={(e) => e.stopPropagation()} aria-label="Detalii vendor">
        <header className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>{vendor.displayName}</h3>
            <p className={styles.drawerSub}>
              {formatSellerType(billing)} ·{" "}
              <span className={vendor.isActive ? styles.vendorStatusActive : styles.vendorStatusInactive}>
                {vendor.isActive ? "Activ" : "Inactiv"}
              </span>
            </p>
          </div>

          <button type="button" className={styles.drawerClose} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </header>

        <div className={styles.drawerBody}>
          {error && <div className={styles.error}>{error}</div>}

          <section className={styles.drawerSection}>
            <h4>Info magazin</h4>

            <div className={styles.drawerField}>
              <span>ID vendor</span>
              <code>{vendor.id}</code>
            </div>

            <div className={styles.drawerField}>
              <span>Entitate juridică profil</span>
              <span>{formatEntityDeclarationShort(vendor)}</span>
            </div>

            {vendor.entitySelfDeclared && (
              <>
                <div className={styles.drawerField}>
                  <span>IP confirmare</span>
                  <span>{vendor.entitySelfDeclaredIp || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>User-Agent</span>
                  <span style={{ wordBreak: "break-word" }}>{vendor.entitySelfDeclaredUa || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Page URL</span>
                  <span style={{ wordBreak: "break-word" }}>{pageUrl || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Referrer</span>
                  <span style={{ wordBreak: "break-word" }}>{referrer || "—"}</span>
                </div>
              </>
            )}

            <div className={styles.drawerField}>
              <span>Adresă profil</span>
              <span>{vendor.address || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Telefon profil</span>
              <span>{vendor.phone || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Email public</span>
              <span>{vendor.email || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Creat la</span>
              <span>{formatDate(vendor.createdAt)}</span>
            </div>

            {vendor.publicProfileUrl && (
              <div className={styles.drawerField}>
                <span>Profil public</span>
                <a href={vendor.publicProfileUrl} target="_blank" rel="noreferrer">
                  Deschide magazin
                </a>
              </div>
            )}
          </section>

          <section className={styles.drawerSection}>
            <h4>Billing</h4>

            <div className={styles.drawerField}>
              <span>Tip vânzător</span>
              <span>{formatSellerType(billing)}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Nume vendor facturare</span>
              <span>{billing?.vendorName || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Persoană de contact</span>
              <span>{billing?.contactPerson || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Email facturare</span>
              <span>{billing?.email || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Telefon facturare</span>
              <span>{billing?.phone || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Adresă facturare</span>
              <span>{billing?.address || "—"}</span>
            </div>

            {isIndependent && (
              <>
                <div className={styles.drawerField}>
                  <span>Responsabilitate fiscală confirmată</span>
                  <span>{formatBoolDate(billing?.taxResponsibilityConfirmed, billing?.taxResponsibilityConfirmedAt)}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Termeni Creator Independent confirmați</span>
                  <span>{formatBoolDate(billing?.independentTermsConfirmed, billing?.independentTermsConfirmedAt)}</span>
                </div>
              </>
            )}

            {isBusiness && (
              <>
                <div className={styles.drawerField}>
                  <span>Tip entitate</span>
                  <span>{billing?.legalType || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Denumire entitate</span>
                  <span>{billing?.companyName || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>CUI</span>
                  <span>{billing?.cui || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Nr. Reg. Com.</span>
                  <span>{billing?.regCom || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Statut TVA vendor</span>
                  <span>{formatVendorVatLong(billing)}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Responsabil TVA confirmat</span>
                  <span>{formatBoolDate(billing?.vatResponsibilityConfirmed, billing?.vatLastResponsibilityConfirm)}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>TVA activ ANAF</span>
                  <span>
                    {billing?.tvaActive === null || billing?.tvaActive === undefined ? "—" : billing.tvaActive ? "Da" : "Nu"}
                  </span>
                </div>

                <div className={styles.drawerField}>
                  <span>Inactiv ANAF</span>
                  <span>{billing?.inactiv === null || billing?.inactiv === undefined ? "—" : billing.inactiv ? "Da" : "Nu"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Insolvent</span>
                  <span>{billing?.insolvent === null || billing?.insolvent === undefined ? "—" : billing.insolvent ? "Da" : "Nu"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Split TVA</span>
                  <span>{billing?.splitTva === null || billing?.splitTva === undefined ? "—" : billing.splitTva ? "Da" : "Nu"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Verificat ANAF la</span>
                  <span>{billing?.tvaVerifiedAt ? formatDate(billing.tvaVerifiedAt) : "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Sursă verificare</span>
                  <span>{billing?.tvaSource || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Denumire ANAF</span>
                  <span>{billing?.anafName || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Adresă ANAF</span>
                  <span>{billing?.anafAddress || "—"}</span>
                </div>
              </>
            )}
          </section>

          <section className={styles.drawerSection}>
            <h4>Stripe Connect</h4>

            <div className={styles.drawerField}>
              <span>Conectat</span>
              <span>{stripeConnected ? "Da" : "Nu"}</span>
            </div>

            {stripeConnected && (
              <>
                <div className={styles.drawerField}>
                  <span>Account ID</span>
                  <code>{vendor.stripeAccountId}</code>
                </div>

                <div className={styles.drawerField}>
                  <span>Status</span>
                  <span>{vendor.stripeConnectStatus || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Payouts enabled</span>
                  <span>{vendor.stripePayoutsEnabled ? "Da" : "Nu"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Charges enabled</span>
                  <span>{vendor.stripeChargesEnabled ? "Da" : "Nu"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Details submitted</span>
                  <span>{vendor.stripeDetailsSubmitted ? "Da" : "Nu"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Onboarded la</span>
                  <span>{vendor.stripeOnboardedAt ? formatDate(vendor.stripeOnboardedAt) : "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Disabled reason</span>
                  <span style={{ wordBreak: "break-word" }}>{vendor.stripeDisabledReason || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Requirements due</span>
                  <pre className={styles.codeBlock}>
                    {vendor.stripeRequirementsDue ? JSON.stringify(vendor.stripeRequirementsDue, null, 2) : "—"}
                  </pre>
                </div>
              </>
            )}
          </section>

          <section className={styles.drawerSection}>
            <h4>Acorduri legale</h4>

            <div className={styles.drawerField}>
              <span>Status acorduri</span>
              <span>{ag ? (ag.allRequired ? "Toate acceptate" : "Incomplet") : "—"}</span>
            </div>

            {ag && (
              <>
                <div className={styles.drawerField}>
                  <span>Documente acceptate</span>
                  <span>{ag.acceptedDocs?.join(", ") || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Documente lipsă</span>
                  <span>{ag.missingDocs?.join(", ") || "—"}</span>
                </div>

                <div className={styles.drawerField}>
                  <span>Ultima acceptare</span>
                  <span>{ag.lastAcceptedAt ? formatDate(ag.lastAcceptedAt) : "—"}</span>
                </div>
              </>
            )}
          </section>

          <section className={styles.drawerSection}>
            <h4>User asociat</h4>

            <div className={styles.drawerField}>
              <span>User ID</span>
              <span>{vendor.user?.id || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Email user</span>
              <span>{vendor.user?.email || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Rol user</span>
              <span>{vendor.user?.role || "—"}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Ultima logare</span>
              <span>{vendor.user?.lastLoginAt ? formatDate(vendor.user.lastLoginAt) : "—"}</span>
            </div>
          </section>

          <section className={styles.drawerSection}>
            <h4>Activitate</h4>

            <div className={styles.drawerField}>
              <span>Servicii</span>
              <span>{counts.services ?? 0}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Vizitatori</span>
              <span>{counts.visitors ?? 0}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Urmăritori</span>
              <span>{vendor.followers ?? 0}</span>
            </div>

            <div className={styles.drawerField}>
              <span>Tickets suport</span>
              <span>{counts.supportTickets ?? 0}</span>
            </div>
          </section>
        </div>

        <footer className={styles.drawerFooter}>
          <button type="button" className={styles.drawerBtnSecondary} onClick={() => onToggleActive?.(vendor)} disabled={busy}>
            {busy ? "Se actualizează…" : vendor.isActive ? "Dezactivează vendor" : "Activează vendor"}
          </button>

          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={() => onSendReset?.(vendor)}
            disabled={busy || !vendor.user?.id}
          >
            Trimite resetare parolă
          </button>

          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={() => {
              if (window.confirm("Sigur vrei să ștergi acceptările legale pentru acest vendor?")) {
                onForceAgreementsReset?.(vendor);
              }
            }}
            disabled={busy}
          >
            Forțează re-acceptarea acordurilor
          </button>

          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={() => onStripeSync?.(vendor)}
            disabled={busy || !vendor.stripeAccountId}
          >
            Sync Stripe
          </button>
        </footer>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}

function Pagination({ page, totalPages, totalItems, onPageChange }) {
  if (!totalItems || totalPages <= 1) return null;

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);

  for (let p = start; p <= end; p++) pages.push(p);

  return (
    <div className={styles.pagination}>
      <div className={styles.paginationInfo}>
        Pagina {page} din {totalPages} · {totalItems} rezultate
      </div>

      <div className={styles.paginationControls}>
        <button type="button" className={styles.paginationBtn} onClick={() => canPrev && onPageChange(page - 1)} disabled={!canPrev}>
          ‹ Înapoi
        </button>

        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.paginationBtn} ${p === page ? styles.paginationBtnActive : ""}`}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}

        <button type="button" className={styles.paginationBtn} onClick={() => canNext && onPageChange(page + 1)} disabled={!canNext}>
          Înainte ›
        </button>
      </div>
    </div>
  );
}