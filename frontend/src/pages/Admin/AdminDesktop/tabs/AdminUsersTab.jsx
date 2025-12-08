import { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FaUndoAlt } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../lib/api.js";
import styles from "../AdminDesktop.module.css";

const PAGE_SIZE = 25;

// factory pentru filtre, ca să avem mereu obiect nou
function createDefaultUserFilters() {
  return {
    q: "",
    role: "ALL", // ALL | USER | VENDOR | ADMIN
    verified: "ALL", // ALL | YES | NO
    marketing: "ALL", // ALL | YES | NO
    hasVendor: "ALL", // ALL | YES | NO
    hasTickets: "ALL", // ALL | YES | NO
    status: "ALL", // ALL | ACTIVE | SUSPENDED
    hasOrders: "ALL", // ALL | YES | NO
    sort: "NEWEST", // NEWEST | OLDEST | EMAIL
  };
}

// helper pentru dată
function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

/**
 * variant = "all"        -> Toate conturile (USER + VENDOR + ADMIN)
 * variant = "customers"  -> doar USER
 */
export default function AdminUsersTab({ users, variant = "all", onGoToOrders }) {
  const [filters, setFilters] = useState(createDefaultUserFilters);
  const [selectedUser, setSelectedUser] = useState(null);
  const [page, setPage] = useState(1);

  // când se schimbă tab-ul (variant), resetăm pagina
  useEffect(() => {
    setPage(1);
  }, [variant]);

  // stats pe roluri (din toate conturile încărcate)
  const roleStats = useMemo(() => {
    const out = { USER: 0, VENDOR: 0, ADMIN: 0 };
    for (const u of users || []) {
      if (u.role === "USER") out.USER++;
      if (u.role === "VENDOR") out.VENDOR++;
      if (u.role === "ADMIN") out.ADMIN++;
    }
    return out;
  }, [users]);

  const filteredUsers = useMemo(() => {
    let list = [...(users || [])];

    // dacă suntem pe tabul "Useri (clienți)", păstrăm doar role=USER
    if (variant === "customers") {
      list = list.filter((u) => u.role === "USER");
    }

    const q = filters.q.trim().toLowerCase();
    if (q) {
      list = list.filter((u) => {
        const id = (u.id || "").toLowerCase();
        const email = u.email?.toLowerCase() || "";
        const name =
          (
            u.name ||
            `${u.firstName || ""} ${u.lastName || ""}`.trim()
          ).toLowerCase() || "";
        return id.includes(q) || email.includes(q) || name.includes(q);
      });
    }

    if (filters.role !== "ALL" && variant === "all") {
      list = list.filter((u) => u.role === filters.role);
    }

    if (filters.verified === "YES") {
      list = list.filter((u) => !!u.emailVerifiedAt);
    } else if (filters.verified === "NO") {
      list = list.filter((u) => !u.emailVerifiedAt);
    }

    if (filters.marketing === "YES") {
      list = list.filter((u) => !!u.marketingOptIn);
    } else if (filters.marketing === "NO") {
      list = list.filter((u) => !u.marketingOptIn);
    }

    if (filters.hasVendor === "YES") {
      list = list.filter((u) => !!u.vendor);
    } else if (filters.hasVendor === "NO") {
      list = list.filter((u) => !u.vendor);
    }

    if (filters.hasTickets === "YES") {
      list = list.filter((u) => (u._count?.supportTickets || 0) > 0);
    } else if (filters.hasTickets === "NO") {
      list = list.filter((u) => (u._count?.supportTickets || 0) === 0);
    }

    // Filtrare după status cont (ACTIVE / SUSPENDED)
    if (filters.status !== "ALL") {
      list = list.filter((u) => {
        const status = u.status || (u.isSuspended ? "SUSPENDED" : "ACTIVE");
        return status === filters.status;
      });
    }

    // Filtrare după existență comenzi (necesită _count.orders în backend)
    if (filters.hasOrders === "YES") {
      list = list.filter((u) => (u._count?.orders || 0) > 0);
    } else if (filters.hasOrders === "NO") {
      list = list.filter((u) => (u._count?.orders || 0) === 0);
    }

    if (filters.sort === "NEWEST") {
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (filters.sort === "OLDEST") {
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (filters.sort === "EMAIL") {
      list.sort((a, b) =>
        (a.email || "").localeCompare(b.email || "", "ro-RO")
      );
    }

    return list;
  }, [users, filters, variant]);

  // calcul paginare
  const totalItems = filteredUsers.length;
  const totalPages = totalItems ? Math.ceil(totalItems / PAGE_SIZE) : 1;
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

  const resetFilters = () => {
    setFilters(createDefaultUserFilters());
    setPage(1);
  };

  const handleFilterChange = (updater) => {
    setFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
    setPage(1);
  };

  return (
    <>
      {/* Rezumat roluri */}
      <div className={styles.roleSummary}>
        <span>
          Total conturi: <b>{users?.length || 0}</b>
        </span>
        <span>
          USER: <b>{roleStats.USER}</b>
        </span>
        <span>
          VENDOR: <b>{roleStats.VENDOR}</b>
        </span>
        <span>
          ADMIN: <b>{roleStats.ADMIN}</b>
        </span>
      </div>

      {/* Filtre */}
      <div className={styles.filtersRow}>
        <label>
          <span>Caută</span>
          <input
            type="text"
            placeholder="Email, nume sau ID"
            value={filters.q}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, q: e.target.value }))
            }
          />
        </label>

        {variant === "all" && (
          <label>
            <span>Rol</span>
            <select
              value={filters.role}
              onChange={(e) =>
                handleFilterChange((f) => ({ ...f, role: e.target.value }))
              }
            >
              <option value="ALL">Toate</option>
              <option value="USER">USER</option>
              <option value="VENDOR">VENDOR</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
        )}

        <label>
          <span>Verificare email</span>
          <select
            value={filters.verified}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, verified: e.target.value }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="YES">Doar verificați</option>
            <option value="NO">Doar neverificați</option>
          </select>
        </label>

        <label>
          <span>Comunicări promoționale</span>
          <select
            value={filters.marketing}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, marketing: e.target.value }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="YES">Acceptă marketing</option>
            <option value="NO">Nu acceptă marketing</option>
          </select>
        </label>

        <label>
          <span>Vendor</span>
          <select
            value={filters.hasVendor}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, hasVendor: e.target.value }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="YES">Doar cu vendor</option>
            <option value="NO">Doar fără vendor</option>
          </select>
        </label>

        <label>
          <span>Tichete suport</span>
          <select
            value={filters.hasTickets}
            onChange={(e) =>
              handleFilterChange((f) => ({
                ...f,
                hasTickets: e.target.value,
              }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="YES">Cu tichete</option>
            <option value="NO">Fără tichete</option>
          </select>
        </label>

        {/* Filtru: Status cont */}
        <label>
          <span>Status cont</span>
          <select
            value={filters.status}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, status: e.target.value }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="ACTIVE">Doar active</option>
            <option value="SUSPENDED">Doar suspendate</option>
          </select>
        </label>

        {/* Filtru: Comenzi */}
        <label>
          <span>Comenzi</span>
          <select
            value={filters.hasOrders}
            onChange={(e) =>
              handleFilterChange((f) => ({ ...f, hasOrders: e.target.value }))
            }
          >
            <option value="ALL">Toți</option>
            <option value="YES">Cu comenzi</option>
            <option value="NO">Fără comenzi</option>
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
            <option value="EMAIL">Email (A–Z)</option>
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

          <span className={styles.filtersCount}>{totalItems} rezultate</span>
        </div>
      </div>

      {/* Tabel + paginare + drawer */}
      <UsersTable
        rows={paginatedUsers}
        onRowClick={(u) => setSelectedUser(u)}
        totalItems={totalItems}
      />

      <Pagination
        page={currentPage}
        totalPages={totalPages}
        totalItems={totalItems}
        onPageChange={setPage}
      />

      {selectedUser && (
        <UserDetailsDrawer
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onGoToOrders={onGoToOrders}
        />
      )}
    </>
  );
}

/* ============ Tabel utilizatori ============ */

function UsersTable({ rows, onRowClick, totalItems }) {
  if (!rows?.length) {
    return (
      <p className={styles.subtle}>
        {totalItems
          ? "Nu există utilizatori pe această pagină."
          : "Nu există utilizatori sau nu au fost încărcați încă."}
      </p>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Email</th>
            <th>Nume</th>
            <th>Rol</th>
            <th>Status</th>
            <th>Creat la</th>
            <th>Ultima conectare</th>
            <th>Verificat</th>
            <th>Marketing</th>
            <th>Vendor?</th>
            <th># Favorite</th>
            <th># Cart</th>
            <th># Reviews</th>
            <th># Tickets</th>
            <th># Orders</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const displayName =
              u.name ||
              `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
              "—";

            const status =
              u.status || (u.isSuspended ? "SUSPENDED" : "ACTIVE");
            const isSuspended = status === "SUSPENDED";

            return (
              <tr
                key={u.id}
                className={`${styles.clickableRow} ${
                  u.role === "ADMIN" ? styles.rowAdmin : ""
                } ${isSuspended ? styles.rowSuspended || "" : ""}`}
                onClick={() => onRowClick?.(u)}
                tabIndex={0}
                role="button"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick?.(u);
                  }
                }}
              >
                <td>
                  <button
                    type="button"
                    className={styles.emailBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!u.id) return;
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(u.id).catch(() => {});
                      } else {
                        window.prompt("Copiază ID-ul userului:", u.id);
                      }
                    }}
                    title="Copiază ID user"
                  >
                    <code>{u.id}</code>
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className={styles.emailBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!u.email) return;
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(u.email).catch(() => {});
                      } else {
                        window.prompt("Copiază emailul:", u.email);
                      }
                    }}
                    title="Copiază email"
                  >
                    {u.email}
                  </button>
                </td>
                <td>{displayName}</td>
                <td>
                  <span
                    className={`${styles.roleBadge} ${
                      styles["roleBadge" + u.role] || ""
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td>
                  <span
                    className={`${styles.statusBadge || ""} ${
                      isSuspended ? styles.statusBadgeSuspended || "" : ""
                    }`}
                  >
                    {isSuspended ? "Suspendat" : "Activ"}
                  </span>
                </td>
                <td>{formatDate(u.createdAt)}</td>
                <td>{u.lastLoginAt ? formatDate(u.lastLoginAt) : "—"}</td>
                <td>{u.emailVerifiedAt ? "Da" : "Nu"}</td>
                <td>{u.marketingOptIn ? "Da" : "Nu"}</td>
                <td>
                  {u.vendor
                    ? `${u.vendor.displayName || ""} (${
                        u.vendor.city || "—"
                      })`
                    : "Nu"}
                </td>
                <td>{u._count?.Favorite ?? 0}</td>
                <td>{u._count?.cartItems ?? 0}</td>
                <td>{u._count?.reviews ?? 0}</td>
                <td>{u._count?.supportTickets ?? 0}</td>
                <td>{u._count?.orders ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============ Paginare ============ */

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

/* ============ Drawer detalii user + acțiuni admin ============ */

function UserDetailsDrawer({ user, onClose, onGoToOrders }) {
  const navigate = useNavigate();

  const [localUser, setLocalUser] = useState(user);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    setLocalUser(user);
    setActionError("");
    setActionMessage("");
  }, [user]);

  if (!user) return null;
  if (typeof document === "undefined") return null;

  const displayName =
    localUser.name ||
    `${localUser.firstName || ""} ${localUser.lastName || ""}`.trim() ||
    "—";

  const vendorLabel = localUser.vendor
    ? `${localUser.vendor.displayName || ""} (${
        localUser.vendor.city || "—"
      })`
    : "—";

  const createdAt = formatDate(localUser.createdAt);
  const verifiedAt = localUser.emailVerifiedAt
    ? formatDate(localUser.emailVerifiedAt)
    : null;
  const lastLogin = localUser.lastLoginAt
    ? formatDate(localUser.lastLoginAt)
    : null;

  const favorites = localUser._count?.Favorite ?? 0;
  const cartItems = localUser._count?.cartItems ?? 0;
  const reviews = localUser._count?.reviews ?? 0;
  const tickets = localUser._count?.supportTickets ?? 0;
  const orders = localUser._count?.orders ?? 0;

  const status =
    localUser.status || (localUser.isSuspended ? "SUSPENDED" : "ACTIVE");
  const isSuspended = status === "SUSPENDED";

  const marketingPrefs = localUser.marketingPrefs;
  const consents = localUser.UserConsent || [];

  const handleGoOrders = () => {
    onGoToOrders?.({ userId: localUser.id });
  };

  const handleGoSupport = () => {
    navigate(`/admin/support?userId=${encodeURIComponent(localUser.id)}`);
  };

  const handleGoVendorOrders = () => {
    if (!localUser.vendor?.id) return;
    onGoToOrders?.({ vendorId: localUser.vendor.id });
  };

  const handleToggleSuspend = async () => {
    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const url = isSuspended
        ? `/api/admin/users/${localUser.id}/unsuspend`
        : `/api/admin/users/${localUser.id}/suspend`;

      const res = await api(url, { method: "POST" });

      const updated =
        res?.user || {
          ...localUser,
          status: isSuspended ? "ACTIVE" : "SUSPENDED",
          isSuspended: !isSuspended,
        };

      setLocalUser(updated);
      setActionMessage(
        isSuspended ? "Contul a fost reactivat." : "Contul a fost suspendat."
      );
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        "Nu am putut actualiza statusul contului.";
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleForceVerifyEmail = async () => {
    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      const res = await api(
        `/api/admin/users/${localUser.id}/verify-email`,
        { method: "POST" }
      );

      const updated =
        res?.user || {
          ...localUser,
          emailVerifiedAt: new Date().toISOString(),
        };

      setLocalUser(updated);
      setActionMessage("Emailul a fost marcat ca verificat.");
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        "Nu am putut marca emailul ca verificat.";
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendPasswordReset = async () => {
    setActionLoading(true);
    setActionError("");
    setActionMessage("");

    try {
      await api(
        `/api/admin/users/${localUser.id}/send-password-reset`,
        { method: "POST" }
      );

      setActionMessage("Email de resetare parolă trimis către utilizator.");
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        "Nu am putut trimite emailul de resetare parolă.";
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const node = (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        aria-label="Detalii utilizator"
      >
        <header className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>{displayName}</h3>
            <p className={styles.drawerSub}>
              {localUser.email} ·{" "}
              <span
                className={`${styles.roleBadge} ${
                  styles["roleBadge" + localUser.role] || ""
                }`}
              >
                {localUser.role}
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
          {/* Info de bază */}
          <section className={styles.drawerSection}>
            <h4>Info de bază</h4>
            <div className={styles.drawerField}>
              <span>ID user</span>
              <code>{localUser.id}</code>
            </div>
            <div className={styles.drawerField}>
              <span>Email</span>
              <span>{localUser.email}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Nume afișat</span>
              <span>{displayName}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Creat la</span>
              <span>{createdAt}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Ultima conectare</span>
              <span>{lastLogin || "Niciodată / necunoscut"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Status cont</span>
              <span>{isSuspended ? "Suspendat" : "Activ"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Email verificat</span>
              <span>
                {localUser.emailVerifiedAt ? `Da (${verifiedAt})` : "Nu"}
              </span>
            </div>
            <div className={styles.drawerField}>
              <span>Marketing</span>
              <span>{localUser.marketingOptIn ? "Opt-in" : "Nu"}</span>
            </div>
          </section>

          {/* Vendor */}
          <section className={styles.drawerSection}>
            <h4>Vendor</h4>
            <div className={styles.drawerField}>
              <span>Vendor asociat</span>
              <span>{vendorLabel}</span>
            </div>
          </section>

          {/* Activitate */}
          <section className={styles.drawerSection}>
            <h4>Activitate</h4>
            <div className={styles.drawerField}>
              <span>Favorite</span>
              <span>{favorites}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Produse în coș</span>
              <span>{cartItems}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Reviews</span>
              <span>{reviews}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Tichete suport</span>
              <span>{tickets}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Comenzi</span>
              <span>{orders}</span>
            </div>
          </section>

          {/* Marketing & consimțăminte */}
          <section className={styles.drawerSection}>
            <h4>Marketing & consimțăminte</h4>
            {marketingPrefs ? (
              <>
                <div className={styles.drawerField}>
                  <span>Preferință sursă</span>
                  <span>{marketingPrefs.sourcePreference}</span>
                </div>
                <div className={styles.drawerField}>
                  <span>Canale active</span>
                  <span>
                    Email: {marketingPrefs.emailEnabled ? "On" : "Off"} · SMS:{" "}
                    {marketingPrefs.smsEnabled ? "On" : "Off"} · Push:{" "}
                    {marketingPrefs.pushEnabled ? "On" : "Off"}
                  </span>
                </div>
                {Array.isArray(marketingPrefs.topics) &&
                  marketingPrefs.topics.length > 0 && (
                    <div className={styles.drawerField}>
                      <span>Subiecte</span>
                      <span>{marketingPrefs.topics.join(", ")}</span>
                    </div>
                  )}
              </>
            ) : (
              <p className={styles.subtle}>
                Nu există preferințe detaliate de marketing salvate.
              </p>
            )}

            {consents.length > 0 && (
              <div className={styles.drawerField}>
                <span>Consimțăminte</span>
                <span>
                  {consents
                    .map(
                      (c) =>
                        `${c.document} (v${c.version}, ${formatDate(
                          c.givenAt
                        )})`
                    )
                    .join(" · ")}
                </span>
              </div>
            )}
          </section>

          {/* Acțiuni admin */}
          <section className={styles.drawerSection}>
            <h4>Acțiuni admin</h4>
            <div className={styles.drawerActions}>
              <button
                type="button"
                className={styles.adminActionBtnDanger}
                onClick={handleToggleSuspend}
                disabled={actionLoading}
              >
                {isSuspended ? "Reactivează contul" : "Suspendă contul"}
              </button>

              {!localUser.emailVerifiedAt && (
                <button
                  type="button"
                  className={styles.adminActionBtn}
                  onClick={handleForceVerifyEmail}
                  disabled={actionLoading}
                >
                  Marchează email ca verificat
                </button>
              )}

              <button
                type="button"
                className={styles.adminActionBtn}
                onClick={handleSendPasswordReset}
                disabled={actionLoading}
              >
                Trimite resetare parolă
              </button>
            </div>

            {actionError && (
              <p className={styles.actionError}>{actionError}</p>
            )}
            {actionMessage && (
              <p className={styles.actionSuccess}>{actionMessage}</p>
            )}
          </section>
        </div>

        <footer className={styles.drawerFooter}>
          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={handleGoSupport}
          >
            Vezi tichete suport
          </button>
          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={handleGoOrders}
          >
            Vezi comenzi user
          </button>
          {localUser.vendor && (
            <button
              type="button"
              className={styles.drawerBtnSecondary}
              onClick={handleGoVendorOrders}
            >
              Vezi comenzi vendor
            </button>
          )}
          <button
            type="button"
            className={styles.drawerBtnDisabled}
            disabled
            title="De implementat în backend"
          >
            Impersonează (în curând)
          </button>
        </footer>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}
