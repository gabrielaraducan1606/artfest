// AdminPoliciesTab.jsx
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../AdminDesktop.module.css";

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

const PAGE_SIZE = 50;

/* ========== User filters ========== */

function createDefaultUserFilters() {
  return {
    q: "",
    hasTos: "ALL", // ALL | YES | NO
    hasPrivacy: "ALL",
    hasMarketing: "ALL",
  };
}

/* ========== Vendor filters ========== */

function createDefaultVendorFilters() {
  return {
    q: "",
    hasVendorTerms: "ALL", // ALL | YES | NO
    hasShipping: "ALL",
    hasReturns: "ALL",
    hasProductDecl: "ALL",
  };
}

export default function AdminPoliciesTab({
  userConsents = [],
  vendorAgreements = [],
}) {
  // user filters + paginație
  const [userFilters, setUserFilters] = useState(createDefaultUserFilters);
  const [userPage, setUserPage] = useState(1);

  // vendor filters + paginație
  const [vendorFilters, setVendorFilters] = useState(
    createDefaultVendorFilters
  );
  const [vendorPage, setVendorPage] = useState(1);

  // vendor selectat pentru drawer
  const [selectedVendor, setSelectedVendor] = useState(null);

  /* ========== USERS ========== */

  const handleUserFilterChange = (updater) => {
    setUserFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
    setUserPage(1);
  };

  const resetUserFilters = () => {
    setUserFilters(createDefaultUserFilters());
    setUserPage(1);
  };

  const filteredUserRows = useMemo(() => {
    let list = [...(userConsents || [])];

    const q = userFilters.q.trim().toLowerCase();
    if (q) {
      list = list.filter((row) => {
        const email = row.email?.toLowerCase() || "";
        const userId = row.userId?.toLowerCase() || "";
        return email.includes(q) || userId.includes(q);
      });
    }

    if (userFilters.hasTos === "YES") {
      list = list.filter((r) => r.tosAccepted);
    } else if (userFilters.hasTos === "NO") {
      list = list.filter((r) => !r.tosAccepted);
    }

    if (userFilters.hasPrivacy === "YES") {
      list = list.filter((r) => r.privacyAccepted);
    } else if (userFilters.hasPrivacy === "NO") {
      list = list.filter((r) => !r.privacyAccepted);
    }

    if (userFilters.hasMarketing === "YES") {
      list = list.filter((r) => r.marketingOptIn);
    } else if (userFilters.hasMarketing === "NO") {
      list = list.filter((r) => !r.marketingOptIn);
    }

    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return list;
  }, [userConsents, userFilters]);

  const userTotalItems = filteredUserRows.length;
  const userTotalPages = userTotalItems
    ? Math.ceil(userTotalItems / PAGE_SIZE)
    : 1;
  const userCurrentPage = Math.min(userPage, userTotalPages);
  const userStartIndex = (userCurrentPage - 1) * PAGE_SIZE;
  const userEndIndex = userStartIndex + PAGE_SIZE;
  const userPaginatedRows = filteredUserRows.slice(
    userStartIndex,
    userEndIndex
  );

  /* ========== VENDORS ========== */

  const handleVendorFilterChange = (updater) => {
    setVendorFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
    setVendorPage(1);
  };

  const resetVendorFilters = () => {
    setVendorFilters(createDefaultVendorFilters());
    setVendorPage(1);
  };

  const filteredVendorRows = useMemo(() => {
    let list = [...(vendorAgreements || [])];

    const q = vendorFilters.q.trim().toLowerCase();
    if (q) {
      list = list.filter((row) => {
        const vendorName = row.vendorName?.toLowerCase() || "";
        const vendorEmail = row.vendorEmail?.toLowerCase() || "";
        const userEmail = row.userEmail?.toLowerCase() || "";
        const vendorId = row.vendorId?.toLowerCase() || "";
        return (
          vendorName.includes(q) ||
          vendorEmail.includes(q) ||
          userEmail.includes(q) ||
          vendorId.includes(q)
        );
      });
    }

    if (vendorFilters.hasVendorTerms === "YES") {
      list = list.filter((r) => r.vendorTermsAccepted);
    } else if (vendorFilters.hasVendorTerms === "NO") {
      list = list.filter((r) => !r.vendorTermsAccepted);
    }

    if (vendorFilters.hasShipping === "YES") {
      list = list.filter((r) => r.shippingAccepted);
    } else if (vendorFilters.hasShipping === "NO") {
      list = list.filter((r) => !r.shippingAccepted);
    }

    if (vendorFilters.hasReturns === "YES") {
      list = list.filter((r) => r.returnsAccepted);
    } else if (vendorFilters.hasReturns === "NO") {
      list = list.filter((r) => !r.returnsAccepted);
    }

    if (vendorFilters.hasProductDecl === "YES") {
      list = list.filter((r) => r.productDeclarationAccepted);
    } else if (vendorFilters.hasProductDecl === "NO") {
      list = list.filter((r) => !r.productDeclarationAccepted);
    }

    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return list;
  }, [vendorAgreements, vendorFilters]);

  const vendorTotalItems = filteredVendorRows.length;
  const vendorTotalPages = vendorTotalItems
    ? Math.ceil(vendorTotalItems / PAGE_SIZE)
    : 1;
  const vendorCurrentPage = Math.min(vendorPage, vendorTotalPages);
  const vendorStartIndex = (vendorCurrentPage - 1) * PAGE_SIZE;
  const vendorEndIndex = vendorStartIndex + PAGE_SIZE;
  const vendorPaginatedRows = filteredVendorRows.slice(
    vendorStartIndex,
    vendorEndIndex
  );

  return (
    <>
      {/* ====== User consents ====== */}
      <section style={{ marginBottom: 32 }}>
        <h3 className={styles.sectionTitle}>Consimțăminte user</h3>

        <div className={styles.filtersRow}>
          <label>
            <span>Caută</span>
            <input
              type="text"
              placeholder="Email sau User ID"
              value={userFilters.q}
              onChange={(e) =>
                handleUserFilterChange((f) => ({
                  ...f,
                  q: e.target.value,
                }))
              }
            />
          </label>

          <label>
            <span>Termeni &amp; condiții (TOS)</span>
            <select
              value={userFilters.hasTos}
              onChange={(e) =>
                handleUserFilterChange((f) => ({
                  ...f,
                  hasTos: e.target.value,
                }))
              }
            >
              <option value="ALL">Toți</option>
              <option value="YES">Doar cu TOS acceptat</option>
              <option value="NO">Fără TOS</option>
            </select>
          </label>

          <label>
            <span>Politica de confidențialitate</span>
            <select
              value={userFilters.hasPrivacy}
              onChange={(e) =>
                handleUserFilterChange((f) => ({
                  ...f,
                  hasPrivacy: e.target.value,
                }))
              }
            >
              <option value="ALL">Toți</option>
              <option value="YES">Doar cu Privacy acceptată</option>
              <option value="NO">Fără Privacy</option>
            </select>
          </label>

          <label>
            <span>Marketing</span>
            <select
              value={userFilters.hasMarketing}
              onChange={(e) =>
                handleUserFilterChange((f) => ({
                  ...f,
                  hasMarketing: e.target.value,
                }))
              }
            >
              <option value="ALL">Toți</option>
              <option value="YES">Doar cu opt-in</option>
              <option value="NO">Doar fără opt-in</option>
            </select>
          </label>

          <div className={styles.filtersActions}>
            <button
              type="button"
              className={styles.resetBtn}
              onClick={resetUserFilters}
            >
              Reset
            </button>
            <span className={styles.filtersCount}>
              {userTotalItems} rezultate
            </span>
          </div>
        </div>

        <UserConsentsTable
          rows={userPaginatedRows}
          totalItems={userTotalItems}
        />

        <Pagination
          page={userCurrentPage}
          totalPages={userTotalPages}
          totalItems={userTotalItems}
          onPageChange={setUserPage}
        />
      </section>

      {/* ====== Vendor agreements ====== */}
      <section>
        <h3 className={styles.sectionTitle}>Acorduri vendori</h3>

        <div className={styles.filtersRow}>
          <label>
            <span>Caută</span>
            <input
              type="text"
              placeholder="Nume vendor, email, Vendor ID"
              value={vendorFilters.q}
              onChange={(e) =>
                handleVendorFilterChange((f) => ({
                  ...f,
                  q: e.target.value,
                }))
              }
            />
          </label>

          <label>
            <span>Acord Master vânzători</span>
            <select
              value={vendorFilters.hasVendorTerms}
              onChange={(e) =>
                handleVendorFilterChange((f) => ({
                  ...f,
                  hasVendorTerms: e.target.value,
                }))
              }
            >
              <option value="ALL">Toți</option>
              <option value="YES">Doar cu acord</option>
              <option value="NO">Fără acord</option>
            </select>
          </label>

          <label>
            <span>Shipping addendum</span>
            <select
              value={vendorFilters.hasShipping}
              onChange={(e) =>
                handleVendorFilterChange((f) => ({
                  ...f,
                  hasShipping: e.target.value,
                }))
              }
            >
              <option value="ALL">Toți</option>
              <option value="YES">Doar cu acceptare</option>
              <option value="NO">Fără</option>
            </select>
          </label>

          <label>
            <span>Politică retur</span>
            <select
              value={vendorFilters.hasReturns}
              onChange={(e) =>
                handleVendorFilterChange((f) => ({
                  ...f,
                  hasReturns: e.target.value,
                }))
              }
            >
              <option value="ALL">Toți</option>
              <option value="YES">Doar cu acceptare</option>
              <option value="NO">Fără</option>
            </select>
          </label>

          <label>
            <span>Declarație produse</span>
            <select
              value={vendorFilters.hasProductDecl}
              onChange={(e) =>
                handleVendorFilterChange((f) => ({
                  ...f,
                  hasProductDecl: e.target.value,
                }))
              }
            >
              <option value="ALL">Toți</option>
              <option value="YES">Doar cu declarație</option>
              <option value="NO">Fără declarație</option>
            </select>
          </label>

          <div className={styles.filtersActions}>
            <button
              type="button"
              className={styles.resetBtn}
              onClick={resetVendorFilters}
            >
              Reset
            </button>
            <span className={styles.filtersCount}>
              {vendorTotalItems} rezultate
            </span>
          </div>
        </div>

        <VendorAgreementsTable
          rows={vendorPaginatedRows}
          totalItems={vendorTotalItems}
          onShowVendorDetails={setSelectedVendor}
        />

        <Pagination
          page={vendorCurrentPage}
          totalPages={vendorTotalPages}
          totalItems={vendorTotalItems}
          onPageChange={setVendorPage}
        />

        {/* Drawer detalii per vendor */}
        {selectedVendor && (
          <VendorDetailsDrawer
            vendor={selectedVendor}
            onClose={() => setSelectedVendor(null)}
          />
        )}
      </section>
    </>
  );
}

/* ========== User table ========== */

function UserConsentsTable({ rows, totalItems }) {
  if (!rows?.length) {
    return (
      <p className={styles.subtle}>
        {totalItems
          ? "Nu există rezultate pe această pagină."
          : "Nu există înregistrări de consimțământ."}
      </p>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>User ID</th>
            <th>Email</th>
            <th>Creat la</th>
            <th>TOS</th>
            <th>Privacy</th>
            <th>Marketing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId}>
              <td>
                <code>{r.userId}</code>
              </td>
              <td>{r.email}</td>
              <td>{formatDate(r.createdAt)}</td>
              <td>
                {r.tosAccepted
                  ? `Da (v${r.tosVersion || "?"}, ${formatDate(
                      r.tosGivenAt
                    )})`
                  : "Nu"}
              </td>
              <td>
                {r.privacyAccepted
                  ? `Da (v${r.privacyVersion || "?"}, ${formatDate(
                      r.privacyGivenAt
                    )})`
                  : "Nu"}
              </td>
              <td>
                {r.marketingOptIn
                  ? `Da (v${r.marketingVersion || "?"}, ${formatDate(
                      r.marketingGivenAt
                    )})`
                  : "Nu"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========== Vendor table ========== */

function VendorAgreementsTable({ rows, totalItems, onShowVendorDetails }) {
  if (!rows?.length) {
    return (
      <p className={styles.subtle}>
        {totalItems
          ? "Nu există rezultate pe această pagină."
          : "Nu există înregistrări de acorduri vendor."}
      </p>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Vendor ID</th>
            <th>Nume vendor</th>
            <th>Email vendor</th>
            <th>Email user</th>
            <th>Creat la</th>
            <th>Acord Master</th>
            <th>Shipping addendum</th>
            <th>Politică retur</th>
            <th>Declarație produse</th>
            <th>Detalii</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vendorId}>
              <td>
                <code>{r.vendorId}</code>
              </td>
              <td>{r.vendorName || "—"}</td>
              <td>{r.vendorEmail || "—"}</td>
              <td>{r.userEmail || "—"}</td>
              <td>{formatDate(r.createdAt)}</td>
              <td>
                {r.vendorTermsAccepted
                  ? `Da (v${r.vendorTermsVersion || "?"}, ${formatDate(
                      r.vendorTermsAcceptedAt
                    )})`
                  : "Nu"}
              </td>
              <td>
                {r.shippingAccepted
                  ? `Da (v${r.shippingVersion || "?"}, ${formatDate(
                      r.shippingAcceptedAt
                    )})`
                  : "Nu"}
              </td>
              <td>
                {r.returnsAccepted
                  ? `Da (v${r.returnsVersion || "?"}, ${formatDate(
                      r.returnsAcceptedAt
                    )})`
                  : "Nu"}
              </td>
              <td>
                {r.productDeclarationAccepted
                  ? `Da (v${r.productDeclarationVersion || "?"}, ${formatDate(
                      r.productDeclarationAcceptedAt
                    )})`
                  : "Nu"}
              </td>
              <td>
                <button
                  type="button"
                  className={styles.emailBtn}
                  onClick={() => onShowVendorDetails?.(r)}
                >
                  Detalii
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========== Pagination ========== */

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

/* ========== VendorDetailsDrawer ========== */

function VendorDetailsDrawer({ vendor, onClose }) {
  if (!vendor) return null;
  if (typeof document === "undefined") return null;

  const {
    vendorName,
    vendorEmail,
    userEmail,
    vendorId,
    createdAt,

    // curierat (informativ, din VendorService.attributes)
    wantsCourier,
    courierAddendumToggleAccepted,
    courierServicesCount,
    courierSample,

    // acorduri legale (VendorAcceptance)
    vendorTermsAccepted,
    vendorTermsVersion,
    vendorTermsAcceptedAt,

    shippingAccepted,
    shippingVersion,
    shippingAcceptedAt,

    returnsAccepted,
    returnsVersion,
    returnsAcceptedAt,

    productDeclarationAccepted,
    productDeclarationVersion,
    productDeclarationAcceptedAt,
  } = vendor;

  const node = (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        aria-label="Detalii vendor"
      >
        <header className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>
              {vendorName || "Vendor fără nume"}
            </h3>
            <p className={styles.drawerSub}>
              {vendorEmail || "—"} {userEmail && <>· User: {userEmail}</>}
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
          {/* Identitate */}
          <section className={styles.drawerSection}>
            <h4>Identitate</h4>
            <div className={styles.drawerField}>
              <span>Vendor ID</span>
              <code>{vendorId}</code>
            </div>
            <div className={styles.drawerField}>
              <span>Nume vendor</span>
              <span>{vendorName || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Email vendor</span>
              <span>{vendorEmail || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Email user</span>
              <span>{userEmail || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Creat la</span>
              <span>{formatDate(createdAt)}</span>
            </div>
          </section>

          {/* Curierat integrat (profil servicii) */}
          <section className={styles.drawerSection}>
            <h4>Curierat integrat (profil servicii)</h4>
            <div className={styles.drawerField}>
              <span>courierEnabled (profil servicii)</span>
              <span>{wantsCourier ? "Da" : "Nu"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Anexă curierat bifată (profil)</span>
              <span>{courierAddendumToggleAccepted ? "Da" : "Nu"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Număr servicii</span>
              <span>
                {courierServicesCount != null ? courierServicesCount : "—"}
              </span>
            </div>

            {courierSample && (
              <div className={styles.drawerField}>
                <span>Exemplu serviciu</span>
                <span>
                  ID serviciu: <code>{courierSample.id}</code>
                  <br />
                  courierEnabled: {courierSample.courierEnabled ? "Da" : "Nu"}
                  <br />
                  courierAddendumAccepted:{" "}
                  {courierSample.courierAddendumAccepted ? "Da" : "Nu"}
                  <br />
                  Versiune anexă:{" "}
                  {courierSample.courierAddendumVersion || "—"}
                  <br />
                  Acceptată la:{" "}
                  {courierSample.courierAddendumAcceptedAt
                    ? formatDate(courierSample.courierAddendumAcceptedAt)
                    : "—"}
                </span>
              </div>
            )}

            <p className={styles.subtle}>
              * Valorile de mai sus vin din{" "}
              <code>VendorService.attributes</code> (checkbox-urile din
              onboarding), nu din istoricul legal (
              <code>VendorAcceptance</code>).
            </p>
          </section>

          {/* Acorduri legale */}
          <section className={styles.drawerSection}>
            <h4>Acorduri legale (VendorAcceptance)</h4>
            <div className={styles.drawerField}>
              <span>Acord Master vânzători</span>
              <span>
                {vendorTermsAccepted
                  ? `Da (v${vendorTermsVersion || "?"}, ${formatDate(
                      vendorTermsAcceptedAt
                    )})`
                  : "Nu"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Shipping addendum</span>
              <span>
                {shippingAccepted
                  ? `Da (v${shippingVersion || "?"}, ${formatDate(
                      shippingAcceptedAt
                    )})`
                  : "Nu"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Politică retur</span>
              <span>
                {returnsAccepted
                  ? `Da (v${returnsVersion || "?"}, ${formatDate(
                      returnsAcceptedAt
                    )})`
                  : "Nu"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Declarație produse</span>
              <span>
                {productDeclarationAccepted
                  ? `Da (v${productDeclarationVersion || "?"}, ${formatDate(
                      productDeclarationAcceptedAt
                    )})`
                  : "Nu"}
              </span>
            </div>
          </section>
        </div>

        <footer className={styles.drawerFooter}>
          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={onClose}
          >
            Închide
          </button>
        </footer>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}
