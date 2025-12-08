import { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { FaUndoAlt } from "react-icons/fa";
import { api } from "../../../../lib/api";
import styles from "../AdminDesktop.module.css";

const PAGE_SIZE = 25;

function createDefaultVendorFilters() {
  return {
    q: "",
    active: "ALL", // ALL | YES | NO
    hasBilling: "ALL", // ALL | YES | NO
    tva: "ALL", // ALL | YES | NO (ANAF tvaActive)
    hasFollowers: "ALL", // ALL | YES | NO
    sort: "NEWEST", // NEWEST | OLDEST | NAME | FOLLOWERS
  };
}

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

// mic helper pentru afișare frumoasă TVA vendor în tabel
function formatVendorVatShort(billing) {
  if (!billing || !billing.vatStatus) return "—";
  if (billing.vatStatus === "payer") {
    if (billing.vatRate === "0") return "Plătitor (0% / scutit)";
    if (billing.vatRate) return `Plătitor (${billing.vatRate}%)`;
    return "Plătitor";
  }
  if (billing.vatStatus === "non_payer") return "Neplătitor";
  return "—";
}

// helper pentru descriere mai lungă în drawer
function formatVendorVatLong(billing) {
  if (!billing || !billing.vatStatus) return "Nespecificat";
  if (billing.vatStatus === "payer") {
    if (billing.vatRate === "0") {
      return "Plătitor de TVA – cotă 0% / scutit (situație specială)";
    }
    if (billing.vatRate) {
      return `Plătitor de TVA – cotă ${billing.vatRate}%`;
    }
    return "Plătitor de TVA (cotă nespecificată)";
  }
  if (billing.vatStatus === "non_payer") {
    return "Neplătitor de TVA";
  }
  return "Nespecificat";
}

export default function AdminVendorsTab({ vendors }) {
  const [filters, setFilters] = useState(createDefaultVendorFilters);
  const [page, setPage] = useState(1);

  const [localVendors, setLocalVendors] = useState(() => vendors || []);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);

  // sync când se schimbă lista din props
  useEffect(() => {
    setLocalVendors(vendors || []);
  }, [vendors]);

  const handleFilterChange = (updater) => {
    setFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(createDefaultVendorFilters());
    setPage(1);
  };

  // filtrare + sortare
  const filteredVendors = useMemo(() => {
    let list = [...(localVendors || [])];
    const q = filters.q.trim().toLowerCase();

    if (q) {
      list = list.filter((v) => {
        const name = v.displayName?.toLowerCase() || "";
        const email = v.user?.email?.toLowerCase() || "";
        const cui = v.billing?.cui?.toLowerCase() || "";
        const addr = (v.address || v.billing?.address || "").toLowerCase();
        const vatStatus = v.billing?.vatStatus || "";
        const vatRate = v.billing?.vatRate || "";

        return (
          name.includes(q) ||
          email.includes(q) ||
          cui.includes(q) ||
          addr.includes(q) ||
          vatStatus.toLowerCase().includes(q) ||
          String(vatRate).toLowerCase().includes(q)
        );
      });
    }

    if (filters.active === "YES") {
      list = list.filter((v) => v.isActive);
    } else if (filters.active === "NO") {
      list = list.filter((v) => !v.isActive);
    }

    if (filters.hasBilling === "YES") {
      list = list.filter((v) => !!v.billing);
    } else if (filters.hasBilling === "NO") {
      list = list.filter((v) => !v.billing);
    }

    // filtrare după TVA ANAF
    if (filters.tva === "YES") {
      list = list.filter((v) => v.billing?.tvaActive === true);
    } else if (filters.tva === "NO") {
      list = list.filter((v) => v.billing && v.billing.tvaActive === false);
    }

    // 🔥 filtrare după urmăritori
    if (filters.hasFollowers === "YES") {
      list = list.filter((v) => (v.followers || 0) > 0);
    } else if (filters.hasFollowers === "NO") {
      list = list.filter((v) => (v.followers || 0) === 0);
    }

    // sortare
    if (filters.sort === "NEWEST") {
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (filters.sort === "OLDEST") {
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (filters.sort === "NAME") {
      list.sort((a, b) =>
        (a.displayName || "").localeCompare(b.displayName || "", "ro-RO")
      );
    } else if (filters.sort === "FOLLOWERS") {
      list.sort(
        (a, b) => (b.followers || 0) - (a.followers || 0)
      );
    }

    return list;
  }, [localVendors, filters]);

  // paginare
  const totalItems = filteredVendors.length;
  const totalPages = totalItems ? Math.ceil(totalItems / PAGE_SIZE) : 1;
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedVendors = filteredVendors.slice(startIndex, endIndex);

  const updateVendorInState = useCallback((updatedVendor) => {
    setLocalVendors((prev) =>
      prev.map((v) => (v.id === updatedVendor.id ? updatedVendor : v))
    );
    setSelectedVendor((prev) =>
      prev && prev.id === updatedVendor.id ? updatedVendor : prev
    );
  }, []);

  const handleToggleActive = async (vendor) => {
    setActionError("");
    setBusyId(vendor.id);
    try {
      const endpoint = vendor.isActive
        ? `/api/admin/vendors/${vendor.id}/deactivate`
        : `/api/admin/vendors/${vendor.id}/activate`;
      const resp = await api(endpoint, { method: "POST" });
      if (resp?.vendor) {
        updateVendorInState(resp.vendor);
      }
    } catch (e) {
      const msg =
        e?.data?.error ||
        e?.message ||
        "Nu am putut actualiza statusul vendorului.";
      setActionError(msg);
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
        setBusyId(null);
        return;
      }
      await api(`/api/admin/users/${vendor.user.id}/send-password-reset`, {
        method: "POST",
      });
      alert("Email de resetare parolă trimis (dacă adresa este validă).");
    } catch (e) {
      const msg =
        e?.data?.error ||
        e?.message ||
        "Nu am putut trimite emailul de resetare.";
      setActionError(msg);
    } finally {
      setBusyId(null);
    }
  };

  // forțează re-acceptarea acordurilor legale pentru vendor
  const handleForceAgreementsReset = async (vendor) => {
    setActionError("");
    setBusyId(vendor.id);
    try {
      await api(`/api/admin/vendors/${vendor.id}/reset-agreements`, {
        method: "POST",
      });
      alert(
        "Acordurile legale au fost resetate. Vendorul va trebui să le accepte din nou la următoarea adăugare de produs."
      );
    } catch (e) {
      const msg =
        e?.data?.error ||
        e?.message ||
        "Nu am putut reseta acordurile legale pentru acest vendor.";
      setActionError(msg);
    } finally {
      setBusyId(null);
    }
  };

  if (!localVendors?.length) {
    return (
      <p className={styles.subtle}>
        Nu există vendori sau nu au fost încărcați încă.
      </p>
    );
  }

  return (
    <>
      {/* Filtre */}
      <div className={styles.filtersRow}>
        <label>
          <span>Caută</span>
          <input
            type="text"
            placeholder="Nume magazin, email, CUI, TVA sau adresă"
            value={filters.q}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, q: e.target.value }))
            }
          />
        </label>

        <label>
          <span>Activ</span>
          <select
            value={filters.active}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, active: e.target.value }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="YES">Doar activi</option>
            <option value="NO">Doar inactivi</option>
          </select>
        </label>

        <label>
          <span>Billing</span>
          <select
            value={filters.hasBilling}
            onChange={(e) =>
              handleFilterChange((f) => ({
                ...f,
                hasBilling: e.target.value,
              }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="YES">Cu billing</option>
            <option value="NO">Fără billing</option>
          </select>
        </label>

        <label>
          <span>TVA activ (ANAF)</span>
          <select
            value={filters.tva}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, tva: e.target.value }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="YES">TVA activ</option>
            <option value="NO">TVA inactiv</option>
          </select>
        </label>

        {/* 🔥 nou – filtru după urmăritori */}
        <label>
          <span>Urmăritori</span>
          <select
            value={filters.hasFollowers}
            onChange={(e) =>
              handleFilterChange((f) => ({
                ...f,
                hasFollowers: e.target.value,
              }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="YES">Cu urmăritori</option>
            <option value="NO">Fără urmăritori</option>
          </select>
        </label>

        <label>
          <span>Sortare</span>
          <select
            value={filters.sort}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, sort: e.target.value }))
            }
          >
            <option value="NEWEST">Cei mai noi</option>
            <option value="OLDEST">Cei mai vechi</option>
            <option value="NAME">Nume (A–Z)</option>
            {/* 🔥 nou – sortare după urmăritori */}
            <option value="FOLLOWERS">Cei mai urmăriți</option>
          </select>
        </label>

        <div className={styles.filtersActions}>
          <button
            type="button"
            className={styles.resetBtn}
            onClick={resetFilters}
            title="Resetează toate filtrele"
          >
            <FaUndoAlt size={14} />
            <span>Reset</span>
          </button>

          <span className={styles.filtersCount}>{totalItems} vendori</span>
        </div>
      </div>

      {/* Tabel vendori */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Magazin</th>
              <th>Entitate juridică</th>
              <th>Activ</th>
              <th>Acorduri legale</th>
              <th>Utilizator</th>
              <th>Billing (CUI)</th>
              <th>TVA activ (ANAF)</th>
              <th>TVA (vendor)</th>
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
              const agLabel = ag
                ? ag.allRequired
                  ? "OK"
                  : "Incomplet"
                : "—";
              const agTitle = ag
                ? ag.allRequired
                  ? `Toate acordurile obligatorii acceptate. Ultima acceptare: ${
                      ag.lastAcceptedAt ? formatDate(ag.lastAcceptedAt) : "n/a"
                    }`
                  : `Acorduri lipsă: ${ag.missingDocs?.join(", ") || "—"}`
                : "Nu există informații despre acorduri pentru acest vendor.";

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
                  <td>
                    {v.entitySelfDeclared
                      ? "Confirmat de vendor"
                      : "Neconfirmat"}
                  </td>
                  <td>
                    <span
                      className={
                        v.isActive
                          ? styles.vendorStatusActive
                          : styles.vendorStatusInactive
                      }
                    >
                      {isBusy ? "…" : v.isActive ? "Activ" : "Inactiv"}
                    </span>
                  </td>

                  {/* Status acorduri în tabel */}
                  <td title={agTitle}>{agLabel}</td>

                  <td>{v.user?.email || "—"}</td>
                  <td>{billing?.cui || "—"}</td>
                  <td>
                    {billing
                      ? billing.tvaActive === null ||
                        billing.tvaActive === undefined
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

      <Pagination
        page={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={setPage}
      />

      {selectedVendor && (
        <VendorDetailsDrawer
          vendor={selectedVendor}
          busy={busyId === selectedVendor.id}
          error={actionError}
          onClose={() => setSelectedVendor(null)}
          onToggleActive={handleToggleActive}
          onSendReset={handleSendReset}
          onForceAgreementsReset={handleForceAgreementsReset}
        />
      )}
    </>
  );
}

/* ============ Drawer detalii vendor ============ */

function VendorDetailsDrawer({
  vendor,
  busy,
  error,
  onClose,
  onToggleActive,
  onSendReset,
  onForceAgreementsReset,
}) {
  if (!vendor) return null;
  if (typeof document === "undefined") return null;

  const billing = vendor.billing;
  const counts = vendor._count || {};
  const ag = vendor.agreementsSummary;

  const node = (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        aria-label="Detalii vendor"
      >
        <header className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>{vendor.displayName}</h3>
            <p className={styles.drawerSub}>
              {vendor.entitySelfDeclared
                ? "Entitate juridică confirmată de vendor"
                : "Entitate juridică NEconfirmată"}{" "}
              ·{" "}
              <span
                className={
                  vendor.isActive
                    ? styles.vendorStatusActive
                    : styles.vendorStatusInactive
                }
              >
                {vendor.isActive ? "Activ" : "Inactiv"}
              </span>
            </p>
          </div>
          <button
            type="button"
            className={styles.drawerClose}
            onClick={onClose}
            aria-label="Închide"
          >
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
              <span>Entitate juridică</span>
              <span>
                {vendor.entitySelfDeclared
                  ? "Confirmat de vendor"
                  : "Neconfirmat"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Adresă magazin (profil)</span>
              <span>{vendor.address || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Telefon</span>
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
                <a
                  href={vendor.publicProfileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Deschide magazin
                </a>
              </div>
            )}
          </section>

          {/* Acorduri legale */}
          <section className={styles.drawerSection}>
            <h4>Acorduri legale</h4>
            <div className={styles.drawerField}>
              <span>Status acorduri</span>
              <span>
                {ag
                  ? ag.allRequired
                    ? "Toate acordurile obligatorii sunt acceptate"
                    : "Incomplet – lipsesc acorduri"
                  : "Nu există informații"}
              </span>
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
                  <span>
                    {ag.lastAcceptedAt ? formatDate(ag.lastAcceptedAt) : "—"}
                  </span>
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
              <span>
                {vendor.user?.lastLoginAt
                  ? formatDate(vendor.user.lastLoginAt)
                  : "—"}
              </span>
            </div>
          </section>

          <section className={styles.drawerSection}>
            <h4>Billing</h4>
            <div className={styles.drawerField}>
              <span>Tip entitate</span>
              <span>{billing?.legalType || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Nume vendor (facturare)</span>
              <span>{billing?.vendorName || "—"}</span>
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
              <span>Adresă facturare</span>
              <span>{billing?.address || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>IBAN</span>
              <span>{billing?.iban || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Banca</span>
              <span>{billing?.bank || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Email facturare</span>
              <span>{billing?.email || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Persoană de contact</span>
              <span>{billing?.contactPerson || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Telefon facturare</span>
              <span>{billing?.phone || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>TVA activ (ANAF)</span>
              <span>
                {billing
                  ? billing.tvaActive === null ||
                    billing.tvaActive === undefined
                    ? "—"
                    : billing.tvaActive
                    ? "Da"
                    : "Nu"
                  : "—"}
              </span>
            </div>

            {/* NOU – info TVA vendor din formular */}
            <div className={styles.drawerField}>
              <span>Statut TVA (vendor)</span>
              <span>{formatVendorVatLong(billing)}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Cotă TVA (vendor)</span>
              <span>
                {billing?.vatRate
                  ? billing.vatRate === "0"
                    ? "0% / scutit"
                    : `${billing.vatRate}%`
                  : "—"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Responsabil TVA confirmat</span>
              <span>
                {billing?.vatResponsibilityConfirmed
                  ? billing.vatLastResponsibilityConfirm
                    ? `Da – ${formatDate(
                        billing.vatLastResponsibilityConfirm
                      )}`
                    : "Da"
                  : "Nu"}
              </span>
            </div>

            <div className={styles.drawerField}>
              <span>Inactiv ANAF</span>
              <span>
                {billing?.inactiv === null ||
                billing?.inactiv === undefined
                  ? "—"
                  : billing.inactiv
                  ? "Da"
                  : "Nu"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Insolvent</span>
              <span>
                {billing?.insolvent === null ||
                billing?.insolvent === undefined
                  ? "—"
                  : billing.insolvent
                  ? "Da"
                  : "Nu"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Split TVA</span>
              <span>
                {billing?.splitTva === null ||
                billing?.splitTva === undefined
                  ? "—"
                  : billing.splitTva
                  ? "Da"
                  : "Nu"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Verificat ANAF la</span>
              <span>
                {billing?.tvaVerifiedAt
                  ? formatDate(billing.tvaVerifiedAt)
                  : "—"}
              </span>
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
              <span>Urmăritori (follow la magazin)</span>
              <span>{vendor.followers ?? 0}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Tickets suport</span>
              <span>{counts.supportTickets ?? 0}</span>
            </div>
          </section>
        </div>

        <footer className={styles.drawerFooter}>
          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={() => onToggleActive?.(vendor)}
            disabled={busy}
          >
            {busy
              ? "Se actualizează…"
              : vendor.isActive
              ? "Dezactivează vendor"
              : "Activează vendor"}
          </button>

          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={() => onSendReset?.(vendor)}
            disabled={busy || !vendor.user?.id}
            title={
              vendor.user?.id
                ? "Trimite un email de resetare parolă user-ului asociat"
                : "Vendor fără user asociat"
            }
          >
            Trimite resetare parolă
          </button>

          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={() => {
              if (
                window.confirm(
                  "Sigur vrei să ștergi acceptările legale pentru acest vendor? La următoarea adăugare de produs, va trebui să le accepte din nou."
                )
              ) {
                onForceAgreementsReset?.(vendor);
              }
            }}
            disabled={busy}
          >
            Forțează re-acceptarea acordurilor
          </button>

          <button
            type="button"
            className={styles.drawerBtnDisabled}
            disabled
            title="Impersonare vendor – de implementat în backend"
          >
            Impersonează (în curând)
          </button>
        </footer>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}

/* ============ Paginare simplă ============ */

function Pagination({ page, totalPages, totalItems, onPageChange }) {
  if (!totalItems || totalPages <= 1) return null;

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const handlePrev = () => {
    if (canPrev) onPageChange(page - 1);
  };

  const handleNext = () => {
    if (canNext) onPageChange(page + 1);
  };

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let p = start; p <= end; p++) {
    pages.push(p);
  }

  return (
    <div className={styles.pagination}>
      <div className={styles.paginationInfo}>
        Pagina {page} din {totalPages} · {totalItems} rezultate
      </div>
      <div className={styles.paginationControls}>
        <button
          type="button"
          className={styles.paginationBtn}
          onClick={handlePrev}
          disabled={!canPrev}
        >
          ‹ Înapoi
        </button>

        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.paginationBtn} ${
              p === page ? styles.paginationBtnActive : ""
            }`}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}

        <button
          type="button"
          className={styles.paginationBtn}
          onClick={handleNext}
          disabled={!canNext}
        >
          Înainte ›
        </button>
      </div>
    </div>
  );
}
