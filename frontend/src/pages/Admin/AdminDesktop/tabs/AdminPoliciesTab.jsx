import { useMemo, useState } from "react";
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
            <span>Termeni & condiții (TOS)</span>
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
        />

        <Pagination
          page={vendorCurrentPage}
          totalPages={vendorTotalPages}
          totalItems={vendorTotalItems}
          onPageChange={setVendorPage}
        />
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

function VendorAgreementsTable({ rows, totalItems }) {
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
