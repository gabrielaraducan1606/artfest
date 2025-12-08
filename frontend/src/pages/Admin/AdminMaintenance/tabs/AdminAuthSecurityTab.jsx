// src/pages/Admin/AdminMaintenance/tabs/AdminAuthSecurityTab.jsx
import { useState, useMemo } from "react";
import { api } from "../../../../lib/api.js";
import styles from "../AdminMaintenancePage.module.css";

// helper de formatat dată – local
function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

function getPasswordAgeDays(user) {
  if (!user?.lastPasswordChangeAt) return null;
  const d = new Date(user.lastPasswordChangeAt);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Returnează tag-urile de risc pentru un user
 */
function getRiskTags(user, cfg) {
  const tags = [];
  const maxAge = cfg.maxPasswordAgeDays || 180;
  const maxFails = cfg.maxFailedAttempts24h || 10;

  const ageDays = getPasswordAgeDays(user);

  if (!user.lastPasswordChangeAt) {
    tags.push("Parolă neschimbată");
  } else if (ageDays != null && ageDays > maxAge) {
    tags.push("Parolă veche");
  }

  if ((user.failed24h || 0) >= maxFails) {
    tags.push("Multe eșecuri");
  }

  if (user.locked) {
    tags.push("Blocat");
  }

  return tags;
}

/**
 * Tabul "Securitate autentificare"
 *
 * Așteaptă un `secData` de forma:
 * {
 *   issuesCount: number,
 *   config: { maxPasswordAgeDays: number, maxFailedAttempts24h: number },
 *   passwordStats: {
 *     stalePasswords: number,
 *     neverChanged: number,
 *     avgPasswordAgeDays: number
 *   },
 *   riskyLogins: [
 *     { id, email, failed24h, lastFailedAt, locked, lastPasswordChangeAt }
 *   ],
 *   autoAlerts?: {
 *     suspiciousLast24h?: number,
 *     lastAutoAlertAt?: string | null
 *   }
 * }
 */
export default function AdminAuthSecurityTab({
  secLoading,
  secError,
  secData,
  onReloadSecurity,
}) {
  const cfg = secData?.config || {};
  const stats = secData?.passwordStats || {};
  const autoAlerts = secData?.autoAlerts || {};

  // riskyLogins memoizat separat, fără || [] în afara hook-ului
  const riskyLogins = useMemo(
    () => (Array.isArray(secData?.riskyLogins) ? secData.riskyLogins : []),
    [secData?.riskyLogins]
  );

  // filtru și sortare locală pentru risky logins
  const [riskyFilter, setRiskyFilter] = useState("");
  const [riskySort, setRiskySort] = useState("FAILED_DESC"); // FAILED_DESC | FAILED_ASC | LAST_FAILED_DESC
  const [riskFilter, setRiskFilter] = useState("ALL"); // ALL | LOCKED | STALE_PASSWORD

  const [lockBusyId, setLockBusyId] = useState(null);
  const [resetBusyId, setResetBusyId] = useState(null);
  const [emailBusyId, setEmailBusyId] = useState(null); // pentru reminder/avertizare
  const [bulkBusy, setBulkBusy] = useState(false);

  // selecție multiplu
  const [selectedIds, setSelectedIds] = useState([]);

  const filteredRiskyLogins = useMemo(() => {
    return riskyLogins
      .filter((u) => {
        // text search după email
        if (riskyFilter.trim()) {
          const hay = (u.email || "").toLowerCase();
          if (!hay.includes(riskyFilter.trim().toLowerCase())) return false;
        }

        // filtru de risc
        if (riskFilter === "LOCKED" && !u.locked) {
          return false;
        }

        if (riskFilter === "STALE_PASSWORD") {
          const ageDays = getPasswordAgeDays(u);
          const maxAge = cfg.maxPasswordAgeDays || 180;

          // considerăm "risc" și dacă nu a fost niciodată schimbată
          if (!u.lastPasswordChangeAt && ageDays == null) return true;
          if (ageDays == null) return false;
          if (ageDays <= maxAge) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (riskySort === "FAILED_ASC") {
          return (a.failed24h || 0) - (b.failed24h || 0);
        }
        if (riskySort === "FAILED_DESC") {
          return (b.failed24h || 0) - (a.failed24h || 0);
        }
        if (riskySort === "LAST_FAILED_DESC") {
          const da = a.lastFailedAt ? new Date(a.lastFailedAt).getTime() : 0;
          const db = b.lastFailedAt ? new Date(b.lastFailedAt).getTime() : 0;
          return db - da;
        }
        return 0;
      });
  }, [riskyLogins, riskyFilter, riskySort, riskFilter, cfg.maxPasswordAgeDays]);

  const visibleIds = useMemo(
    () => filteredRiskyLogins.map((u) => u.id),
    [filteredRiskyLogins]
  );

  const selectedVisibleIds = useMemo(
    () => visibleIds.filter((id) => selectedIds.includes(id)),
    [visibleIds, selectedIds]
  );

  const allVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.every((id) => selectedIds.includes(id));
  const someVisibleSelected =
    visibleIds.length > 0 &&
    visibleIds.some((id) => selectedIds.includes(id));

  const toggleSelectOne = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      // deselectăm doar pe cei vizibili
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      // adăugăm toți vizibilii
      setSelectedIds((prev) => {
        const set = new Set(prev);
        for (const id of visibleIds) set.add(id);
        return Array.from(set);
      });
    }
  };

  const handleToggleLock = async (user) => {
    if (!user?.id) return;

    try {
      if (!user.locked) {
        const ok = window.confirm(
          `Ești sigur(ă) că vrei să blochezi contul pentru ${
            user.email || "acest user"
          }?\nNu va mai putea să se autentifice până când nu îl deblochezi.`
        );
        if (!ok) return;
      }

      setLockBusyId(user.id);

      if (user.locked) {
        await api(`/api/admin/maintenance/users/${user.id}/unlock`, {
          method: "POST",
        });
      } else {
        await api(`/api/admin/maintenance/users/${user.id}/lock`, {
          method: "POST",
        });
      }

      if (typeof onReloadSecurity === "function") {
        await onReloadSecurity();
      }
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut actualiza statusul contului.";
      alert(msg);
    } finally {
      setLockBusyId(null);
    }
  };

  const handleForceReset = async (user) => {
    if (!user?.email) {
      alert("Acest user nu are o adresă de email setată.");
      return;
    }

    const ok = window.confirm(
      `Trimitem un email de resetare a parolei către ${user.email}?`
    );
    if (!ok) return;

    try {
      setResetBusyId(user.id);

      // Folosim ruta existentă de forgot-password
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: { email: user.email },
      });

      alert("Dacă adresa este validă, am trimis un email de resetare.");
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut iniția resetarea parolei.";
      alert(msg);
    } finally {
      setResetBusyId(null);
    }
  };

  const handleSendPasswordReminder = async (user) => {
    if (!user?.id || !user?.email) {
      alert("User-ul nu are email asociat.");
      return;
    }

    const ok = window.confirm(
      `Trimiți o recomandare de schimbare parolă către ${user.email}?`
    );
    if (!ok) return;

    try {
      setEmailBusyId(user.id);
      await api(
        `/api/admin/maintenance/users/${user.id}/send-password-reminder`,
        { method: "POST" }
      );
      alert(
        "Email de recomandare schimbare parolă trimis (dacă emailul este valid)."
      );
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut trimite recomandarea de schimbare parolă.";
      alert(msg);
    } finally {
      setEmailBusyId(null);
    }
  };

  const handleSendSuspiciousWarning = async (user) => {
    if (!user?.id || !user?.email) {
      alert("User-ul nu are email asociat.");
      return;
    }

    const ok = window.confirm(
      `Trimiți o avertizare de login suspect către ${user.email}?`
    );
    if (!ok) return;

    try {
      setEmailBusyId(user.id);
      await api(
        `/api/admin/maintenance/users/${user.id}/send-suspicious-login-warning`,
        { method: "POST" }
      );
      alert(
        "Email de avertizare login suspect trimis (dacă emailul este valid)."
      );
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut trimite avertizarea de login suspect.";
      alert(msg);
    } finally {
      setEmailBusyId(null);
    }
  };

  // =========================
  //   ACȚIUNI BULK
  // =========================

  const handleBulkPasswordReminder = async () => {
    const ids = selectedVisibleIds;
    if (!ids.length) {
      alert("Selectează cel puțin un cont din listă.");
      return;
    }

    const ok = window.confirm(
      `Trimiți recomandare de schimbare parolă către ${ids.length} conturi selectate?`
    );
    if (!ok) return;

    try {
      setBulkBusy(true);
      await api(
        "/api/admin/maintenance/users/bulk-password-reminder",
        {
          method: "POST",
          body: { userIds: ids },
        }
      );
      alert(
        "Am inițiat trimiterea recomandărilor de schimbare parolă către conturile selectate (în măsura în care au email valid)."
      );
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut trimite emailurile de recomandare.";
      alert(msg);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkSuspiciousWarning = async () => {
    const ids = selectedVisibleIds;
    if (!ids.length) {
      alert("Selectează cel puțin un cont din listă.");
      return;
    }

    const ok = window.confirm(
      `Trimiți avertizare de login suspect către ${ids.length} conturi selectate?`
    );
    if (!ok) return;

    try {
      setBulkBusy(true);
      await api(
        "/api/admin/maintenance/users/bulk-suspicious-login-warning",
        {
          method: "POST",
          body: { userIds: ids },
        }
      );
      alert(
        "Am inițiat trimiterea avertizărilor de login suspect către conturile selectate."
      );
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut trimite emailurile de avertizare.";
      alert(msg);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className={styles.maintenanceWrapper}>
      <section className={styles.drawerSection}>
        <h4>Securitate autentificare</h4>
        <p className={styles.subtle}>
          Aici vezi parole foarte vechi și conturi cu multe încercări eșuate
          recente. Dacă apare o bulină pe tab, înseamnă că există probleme care
          ar trebui verificate.
        </p>

        <ul className={styles.subtle}>
          <li>
            <b>Parolă prea veche:</b> mai veche de{" "}
            <b>{cfg.maxPasswordAgeDays ?? "…"} zile</b>
          </li>
          <li>
            <b>Încercări eșuate excesive:</b> mai mult de{" "}
            <b>{cfg.maxFailedAttempts24h ?? "…"} eșecuri</b> în ultimele 24h pe
            același cont.
          </li>
          <li>
            Pragurile sunt configurate în <code>.env</code> prin{" "}
            <code>SEC_MAX_PASSWORD_AGE_DAYS</code> și{" "}
            <code>SEC_MAX_FAILED_ATTEMPTS_24H</code>.
          </li>
        </ul>
      </section>

      <section className={styles.drawerSection}>
        <h4>Rezumat rapid</h4>

        <div className={styles.rowBetween}>
          {secLoading && (
            <p className={styles.subtle} style={{ margin: 0 }}>
              Se încarcă datele de securitate…
            </p>
          )}
          {secError && (
            <p className={styles.actionError} style={{ margin: 0 }}>
              {secError}
            </p>
          )}

          <button
            type="button"
            className={styles.adminActionBtn}
            onClick={onReloadSecurity}
            disabled={secLoading}
          >
            Reîncarcă doar securitatea
          </button>
        </div>

        {!secLoading && !secError && (
          <div className={styles.statCardsRow}>
            <div className={styles.smallStatCard}>
              <div className={styles.smallStatLabel}>Parole foarte vechi</div>
              <div className={styles.smallStatValue}>
                {stats.stalePasswords ?? 0}
              </div>
            </div>

            <div className={styles.smallStatCard}>
              <div className={styles.smallStatLabel}>
                Parole niciodată schimbate
              </div>
              <div className={styles.smallStatValue}>
                {stats.neverChanged ?? 0}
              </div>
            </div>

            <div className={styles.smallStatCard}>
              <div className={styles.smallStatLabel}>
                Medie vechime parole
              </div>
              <div className={styles.smallStatValue}>
                {stats.avgPasswordAgeDays != null
                  ? `${stats.avgPasswordAgeDays} zile`
                  : "—"}
              </div>
            </div>

            <div className={styles.smallStatCard}>
              <div className={styles.smallStatLabel}>
                Conturi cu multe eșecuri
              </div>
              <div className={styles.smallStatValue}>
                {riskyLogins.length}
              </div>
            </div>

            {/* Card opțional: alerte automate login suspect */}
            <div className={styles.smallStatCard}>
              <div className={styles.smallStatLabel}>
                Alerte automate login suspect (24h)
              </div>
              <div className={styles.smallStatValue}>
                {autoAlerts.suspiciousLast24h ?? 0}
              </div>
              {autoAlerts.lastAutoAlertAt && (
                <div className={styles.smallStatFoot}>
                  Ultima: {formatDate(autoAlerts.lastAutoAlertAt)}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className={styles.drawerSection}>
        <h4>Conturi cu multe încercări eșuate</h4>
        <p className={styles.subtle}>
          Lista de mai jos arată conturile care au depășit pragul de încercări
          eșuate într-o perioadă scurtă. Poți bloca conturi, forța resetarea
          parolei și trimite mailuri de avertizare / recomandare.
        </p>

        <div className={styles.filtersRow}>
          <label className={styles.subtle}>
            Caută după email:
            <input
              type="text"
              value={riskyFilter}
              onChange={(e) => setRiskyFilter(e.target.value)}
              className={styles.input}
              placeholder="ex: user@exemplu.ro"
            />
          </label>

          <label className={styles.subtle}>
            Sortează după:
            <select
              value={riskySort}
              onChange={(e) => setRiskySort(e.target.value)}
              className={styles.select}
            >
              <option value="FAILED_DESC">Eșecuri (descrescător)</option>
              <option value="FAILED_ASC">Eșecuri (crescător)</option>
              <option value="LAST_FAILED_DESC">
                Ultimul eșec (cele mai recente)
              </option>
            </select>
          </label>

          <label className={styles.subtle}>
            Filtru risc:
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className={styles.select}
            >
              <option value="ALL">Toate</option>
              <option value="LOCKED">Doar blocate</option>
              <option value="STALE_PASSWORD">Doar parole vechi</option>
            </select>
          </label>

          <span className={styles.subtle}>
            Rezultate: <b>{filteredRiskyLogins.length}</b>
          </span>
        </div>

        {/* Acțiuni bulk pentru selecția curentă */}
        <div className={styles.bulkActionsRow}>
          <span className={styles.subtle}>
            Selectate: <b>{selectedVisibleIds.length}</b> din{" "}
            {visibleIds.length}
          </span>

          <div className={styles.bulkButtons}>
            <button
              type="button"
              className={styles.adminActionBtnSecondary}
              onClick={handleBulkPasswordReminder}
              disabled={
                bulkBusy ||
                !selectedVisibleIds.length ||
                secLoading ||
                filteredRiskyLogins.length === 0
              }
            >
              {bulkBusy ? "Se trimit..." : "Recomandă schimbare (bulk)"}
            </button>

            <button
              type="button"
              className={styles.adminActionBtnSecondary}
              onClick={handleBulkSuspiciousWarning}
              disabled={
                bulkBusy ||
                !selectedVisibleIds.length ||
                secLoading ||
                filteredRiskyLogins.length === 0
              }
            >
              {bulkBusy ? "Se trimit..." : "Avertizare login (bulk)"}
            </button>
          </div>
        </div>

        {filteredRiskyLogins.length === 0 ? (
          <p className={styles.subtle}>
            Nu există conturi cu probleme de autentificare în acest moment.
          </p>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => {
                        if (!el) return;
                        el.indeterminate =
                          !allVisibleSelected && someVisibleSelected;
                      }}
                      onChange={toggleSelectAllVisible}
                    />
                  </th>
                  <th>User ID</th>
                  <th>Email</th>
                  <th>Eșecuri în ultimele 24h</th>
                  <th>Ultimul eșec</th>
                  <th>Ultima schimbare parolă</th>
                  <th>Risc</th>
                  <th>Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filteredRiskyLogins.map((u) => {
                  const riskTags = getRiskTags(u, cfg);
                  const maxFails = cfg.maxFailedAttempts24h || 10;
                  const isHighFail = (u.failed24h || 0) >= maxFails;

                  const canSendPasswordReminder =
                    !u.locked &&
                    (riskTags.includes("Parolă veche") ||
                      riskTags.includes("Parolă neschimbată"));

                  const canSendSuspiciousWarning = isHighFail;

                  const busyThisRow =
                    lockBusyId === u.id ||
                    resetBusyId === u.id ||
                    emailBusyId === u.id ||
                    secLoading ||
                    bulkBusy;

                  const checked = selectedIds.includes(u.id);

                  return (
                    <tr key={u.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelectOne(u.id)}
                        />
                      </td>
                      <td>
                        <code>{u.id}</code>
                      </td>
                      <td>{u.email || "—"}</td>
                      <td>{u.failed24h ?? 0}</td>
                      <td>
                        {u.lastFailedAt ? formatDate(u.lastFailedAt) : "—"}
                      </td>
                      <td>
                        {u.lastPasswordChangeAt
                          ? formatDate(u.lastPasswordChangeAt)
                          : "—"}
                      </td>
                      <td>
                        <div className={styles.riskTagsRow}>
                          {riskTags.length === 0 ? (
                            <span className={styles.subtle}>—</span>
                          ) : (
                            riskTags.map((tag) => (
                              <span key={tag} className={styles.riskTag}>
                                {tag}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td>
                        <div className={styles.actionsCell}>
                          <span className={styles.subtle}>
                            {u.locked ? "Blocat" : "Activ"}
                          </span>

                          <button
                            type="button"
                            className={styles.adminActionBtn}
                            onClick={() => handleToggleLock(u)}
                            disabled={busyThisRow}
                          >
                            {lockBusyId === u.id
                              ? "Se aplică..."
                              : u.locked
                              ? "Deblochează"
                              : "Blochează"}
                          </button>

                          <button
                            type="button"
                            className={styles.adminActionBtnSecondary}
                            onClick={() => handleForceReset(u)}
                            disabled={busyThisRow}
                          >
                            {resetBusyId === u.id
                              ? "Se trimite..."
                              : "Resetare parolă"}
                          </button>

                          {canSendPasswordReminder && (
                            <button
                              type="button"
                              className={styles.adminActionBtnSecondary}
                              onClick={() => handleSendPasswordReminder(u)}
                              disabled={busyThisRow}
                            >
                              {emailBusyId === u.id
                                ? "Se trimite..."
                                : "Recomandă schimbare"}
                            </button>
                          )}

                          {canSendSuspiciousWarning && (
                            <button
                              type="button"
                              className={styles.adminActionBtnSecondary}
                              onClick={() => handleSendSuspiciousWarning(u)}
                              disabled={busyThisRow}
                            >
                              {emailBusyId === u.id
                                ? "Se trimite..."
                                : "Avertizare login"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
