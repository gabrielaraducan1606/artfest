// src/admin/maintenance/AdminMaintenance.jsx
import { useEffect, useState } from "react";
import { api } from "../../../lib/api.js";
import styles from "./AdminMaintenancePage.module.css";

import AdminInactivityTab from "./tabs/AdminInactivityTab.jsx";
import AdminAuthSecurityTab from "./tabs/AdminAuthSecurityTab.jsx";
import AdminProblemAccountsTab from "./tabs/AdminSuspendCounts.jsx";
import AdminReviewReportsTab from "./tabs/AdminReviewsReport.jsx";
import AdminCityVariantsTab from "./tabs/AdminCityVariantsTab.jsx"; // 👈 nou
import { FaQuestionCircle } from "react-icons/fa";

// tab-uri din pagina de mentenanță
const TABS = [
  { id: "inactivity", label: "Inactivitate conturi" },
  { id: "authSecurity", label: "Securitate autentificare" },
  { id: "problemAccounts", label: "Conturi cu probleme" },
  { id: "cityVariants", label: "Orașe magazine" },        // 👈 nou
  { id: "reviewReports", label: "Raportări recenzii" },   // 👈 deja existent
];

export default function AdminMaintenance() {
  const [activeTab, setActiveTab] = useState("inactivity");

  // ===================== INACTIVITY STATE =====================
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [previewItems, setPreviewItems] = useState([]);
  const [config, setConfig] = useState({
    inactivityMonths: null,
    warningDays: null,
  });

  const [warningLogs, setWarningLogs] = useState([]);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // ===================== AUTH SECURITY STATE =====================
  const [secLoading, setSecLoading] = useState(false);
  const [secError, setSecError] = useState("");
  const [secData, setSecData] = useState(null);
  const [secIssuesCount, setSecIssuesCount] = useState(0); // pt badge pe tab

  // ===================== PROBLEM ACCOUNTS STATE =====================
  const [problemLoading, setProblemLoading] = useState(false);
  const [problemError, setProblemError] = useState("");
  const [problemItems, setProblemItems] = useState([]);
  const [problemIssuesCount, setProblemIssuesCount] = useState(0);

  // ===================== REVIEW REPORTS META (pt badge) =====================
  const [reviewReportsCount, setReviewReportsCount] = useState(0);

  // ===================== CITY VARIANTS META (pt badge) =====================
  const [cityVariantsCount, setCityVariantsCount] = useState(0);

  // ajutor / descriere rol pagină
  const [showHelp, setShowHelp] = useState(false);

  // =====================================================
  //     LOADERS (preview conturi + log emailuri)
  // =====================================================

  const loadPreview = async () => {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const d = await api("/api/admin/maintenance/inactive-preview");
      setPreviewItems(d.items || []);
      setConfig(d.config || {});
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut încărca lista de conturi inactive.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const loadWarningLogs = async () => {
    try {
      const d = await api("/api/admin/maintenance/warnings-log");
      setWarningLogs(d.logs || []);
    } catch (e) {
      // nu blocăm pagina dacă logul nu se încarcă
      console.error("maintenance warnings-log error", e);
    }
  };

  // loader pentru securitate autentificare
  const loadAuthSecurity = async () => {
    setSecLoading(true);
    setSecError("");

    try {
      const d = await api("/api/admin/maintenance/security-overview");
      setSecData(d || null);
      setSecIssuesCount(d?.issuesCount || 0);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut încărca datele de securitate (parole/login).";
      setSecError(msg);
    } finally {
      setSecLoading(false);
    }
  };

  // loader de bază pentru conturi cu probleme
  const loadProblemAccounts = async () => {
    setProblemLoading(true);
    setProblemError("");

    try {
      // baza – backend-ul o să o implementeze ulterior
      const d = await api("/api/admin/maintenance/problem-accounts");
      const items = d.items || [];
      setProblemItems(items);
      setProblemIssuesCount(d.issuesCount ?? items.length ?? 0);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut încărca lista de conturi cu probleme.";
      setProblemError(msg);
    } finally {
      setProblemLoading(false);
    }
  };

  // loader meta pentru raportările de recenzii (doar count pt badge)
  const loadReviewReportsMeta = async () => {
    try {
      const d = await api(
        "/api/admin/maintenance/review-reports?take=1&days=30"
      );
      setReviewReportsCount(d.total || 0);
    } catch (e) {
      console.error("maintenance review-reports meta error", e);
      // nu blocăm pagina dacă nu merge, lăsăm badge-ul 0
    }
  };

  // loader meta pentru variante orașe (doar număr de grupuri pt badge)
  const loadCityVariantsMeta = async () => {
    try {
      const d = await api("/api/admin/cities/variants");
      const groups = d?.groups || [];
      setCityVariantsCount(groups.length || 0);
    } catch (e) {
      console.error("admin cities variants meta error", e);
      // nu blocăm pagina dacă nu merge
    }
  };

  const loadAll = async () => {
    await Promise.all([
      loadPreview(),
      loadWarningLogs(),
      loadAuthSecurity(),
      loadProblemAccounts(),
      loadReviewReportsMeta(),
      loadCityVariantsMeta(),
    ]);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =====================================================
  //                 ACȚIUNI ADMIN
  // =====================================================

  const handleSendWarnings = async () => {
    setActionLoading(true);
    setError("");
    setMessage("");

    try {
      const d = await api("/api/admin/maintenance/send-warnings", {
        method: "POST",
      });

      setMessage(
        `Email-uri de avertizare trimise către ${d.notified || 0} conturi.`
      );
      await loadAll();
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut trimite email-urile de avertizare.";
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRunCleanup = async () => {
    if (
      !window.confirm(
        "Ești sigur(ă) că vrei să rulezi curățarea conturilor inactive? Această acțiune este ireversibilă."
      )
    ) {
      return;
    }

    setActionLoading(true);
    setError("");
    setMessage("");

    try {
      const d = await api("/api/admin/maintenance/run-cleanup", {
        method: "POST",
      });

      setMessage(`Curățare rulată. Conturi șterse: ${d.deleted || 0}.`);
      await loadAll();
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut rula curățarea conturilor.";
      setError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // =====================================================
  //                     RENDER PAGE
  // =====================================================

  const renderTabContent = () => {
    if (activeTab === "inactivity") {
      return (
        <AdminInactivityTab
          loading={loading}
          actionLoading={actionLoading}
          previewItems={previewItems}
          config={config}
          warningLogs={warningLogs}
          error={error}
          message={message}
          onReloadAll={loadAll}
          onSendWarnings={handleSendWarnings}
          onRunCleanup={handleRunCleanup}
        />
      );
    }

    if (activeTab === "authSecurity") {
      return (
        <AdminAuthSecurityTab
          secLoading={secLoading}
          secError={secError}
          secData={secData}
          onReloadSecurity={loadAuthSecurity}
        />
      );
    }

    if (activeTab === "problemAccounts") {
      return (
        <AdminProblemAccountsTab
          loading={problemLoading}
          error={problemError}
          items={problemItems}
          issuesCount={problemIssuesCount}
          onReload={loadProblemAccounts}
        />
      );
    }

    if (activeTab === "cityVariants") {
      return <AdminCityVariantsTab />; // 👈 noul tab pentru orașe
    }

    if (activeTab === "reviewReports") {
      // tab-ul nostru existent – își face singur fetch detaliat
      return <AdminReviewReportsTab />;
    }

    return (
      <p className={styles.subtle}>Acest tab nu este încă implementat.</p>
    );
  };

  return (
    <section className={styles.page}>
      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div>
            <h1 className={styles.h1}>
              Mentenanță sistem
              <button
                type="button"
                className={styles.helpIconBtn}
                onClick={() => setShowHelp((v) => !v)}
                title="Află mai multe despre rolul acestei pagini"
              >
                <FaQuestionCircle className={styles.helpIcon} />
              </button>
            </h1>
            <p className={styles.subtle}>
              Instrumente pentru gestionarea conturilor inactive, securitatea
              autentificării, conturi cu probleme, curățarea datelor și
              normalizarea datelor introduse de vendori.
            </p>
          </div>
        </div>

        {showHelp && (
          <div className={styles.helpBox}>
            <p>
              <strong>Rolul acestei pagini:</strong> să centralizeze toate
              operațiunile de &quot;curățenie&quot; și sănătate a platformei:
            </p>
            <ul>
              <li>
                gestionarea conturilor <strong>inactive</strong> și
                notificarea lor înainte de ștergere;
              </li>
              <li>
                verificarea și remedierea problemelor de{" "}
                <strong>securitate la autentificare</strong> (parole slabe,
                multe eșecuri de login etc.);
              </li>
              <li>
                identificarea și monitorizarea <strong>conturilor cu
                probleme</strong> (suspiciuni de abuz, fraudă, blocări
                manuale etc.);
              </li>
              <li>
                analizarea și normalizarea <strong>orașelor magazinelor</strong>{" "}
                introduse de vendori (Bacau / Bacău / BACĂU etc.).
              </li>
            </ul>
          </div>
        )}
      </header>

      {/* Tabs locale pentru pagina de mentenanță */}
      <div className={styles.tabs}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;

          let badgeValue = 0;
          if (tab.id === "authSecurity") badgeValue = secIssuesCount;
          else if (tab.id === "problemAccounts")
            badgeValue = problemIssuesCount;
          else if (tab.id === "reviewReports")
            badgeValue = reviewReportsCount;
          else if (tab.id === "cityVariants")
            badgeValue = cityVariantsCount;

          const showBadge = badgeValue > 0;

          return (
            <button
              key={tab.id}
              type="button"
              className={`${styles.tab} ${
                isActive ? styles.tabActive : ""
              }`}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
            >
              <span>{tab.label}</span>
              {showBadge && (
                <span className={styles.tabBadge}>
                  {badgeValue > 99 ? "99+" : badgeValue}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Card conținut */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            {TABS.find((t) => t.id === activeTab)?.label || ""}
          </h2>
        </div>

        {renderTabContent()}
      </div>
    </section>
  );
}
