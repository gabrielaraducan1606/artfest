import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../AdminDesktop.module.css";
import LegalDocumentsPanel from "./legal/LegalDocumentsPanel.jsx";

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

const PAGE_SIZE = 50;

function createDefaultUserFilters() {
  return {
  q: "",
  hasTos: "ALL",
  hasPrivacy: "ALL",
  hasCookies: "ALL",
  hasReturns: "ALL",
  hasMarketing: "ALL",
};
}

function createDefaultVendorFilters() {
  return {
    q: "",
    hasVendorTerms: "ALL",
    hasReturns: "ALL",
    hasProductDecl: "ALL",
  };
}

function createDefaultInfluencerFilters() {
  return {
    q: "",
    termsStatus: "ALL",
  };
}

const TABS = {
  DOCUMENTS: "DOCUMENTS",
  USERS: "USERS",
  VENDORS: "VENDORS",
  INFLUENCERS: "INFLUENCERS",
};

const INFLUENCER_TERMS_STATUS_LABELS = {
  UPDATED: "Actualizat",
  OUTDATED: "Necesită reacceptare",
  OLDER_VERSION: "Versiune anterioară (fără cerere)",
  NEVER_ACCEPTED: "Nu a acceptat",
};

function normalizeUserConsents(userConsents = []) {
  if (!Array.isArray(userConsents)) {
    return [];
  }

  /*
   * Noul backend returnează deja câte un rând per utilizator.
   * În acest caz nu mai grupăm din nou datele.
   */
  const alreadyAggregated = userConsents.some(
    (item) =>
      Object.prototype.hasOwnProperty.call(item || {}, "tosAccepted") ||
      Array.isArray(item?.tosHistory) ||
      Array.isArray(item?.privacyHistory)
  );

  if (alreadyAggregated) {
    return userConsents.map((item) => ({
      ...item,

      email:
        item?.email ||
        item?.userEmail ||
        "",

      createdAt:
        item?.createdAt ||
        item?.givenAt ||
        null,

      tosHistory: Array.isArray(item?.tosHistory)
        ? item.tosHistory
        : [],

      privacyHistory: Array.isArray(item?.privacyHistory)
        ? item.privacyHistory
        : [],

      cookiesHistory: Array.isArray(item?.cookiesHistory)
        ? item.cookiesHistory
        : [],

      returnsHistory: Array.isArray(item?.returnsHistory)
        ? item.returnsHistory
        : [],

      marketingHistory: Array.isArray(item?.marketingHistory)
        ? item.marketingHistory
        : [],
    }));
  }

  /*
   * Compatibilitate cu formatul vechi:
   * câte un obiect pentru fiecare UserConsent.
   */
  const grouped = new Map();

  for (const item of userConsents) {
    const userId =
      item?.userId ||
      item?.user?.id ||
      "";

    const email =
      item?.userEmail ||
      item?.email ||
      item?.user?.email ||
      "";

    const groupKey =
      userId ||
      email;

    if (!groupKey) {
      continue;
    }

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        userId,
        email,

        createdAt:
          item?.userCreatedAt ||
          item?.createdAt ||
          item?.givenAt ||
          null,

        tosAccepted: false,
        tosVersion: null,
        tosGivenAt: null,
        tosHistory: [],

        privacyAccepted: false,
        privacyVersion: null,
        privacyGivenAt: null,
        privacyHistory: [],

        cookiesAccepted: false,
        cookiesVersion: null,
        cookiesGivenAt: null,
        cookiesHistory: [],

        returnsAccepted: false,
        returnsVersion: null,
        returnsGivenAt: null,
        returnsHistory: [],

        marketingOptIn: false,
        marketingVersion: null,
        marketingGivenAt: null,
        marketingHistory: [],
      });
    }

    const row = grouped.get(groupKey);

    if (!row.userId && userId) {
      row.userId = userId;
    }

    if (!row.email && email) {
      row.email = email;
    }

    const consent = {
      id: item?.id || null,
      document: item?.document || null,
      version: item?.version || null,
      checksum: item?.checksum || null,
      givenAt:
        item?.givenAt ||
        item?.createdAt ||
        null,
      ip: item?.ip || null,
      ua: item?.ua || null,
    };

    switch (item?.document) {
      case "TOS":
        row.tosHistory.push(consent);
        break;

      case "PRIVACY":
      case "PRIVACY_ACK":
        row.privacyHistory.push(consent);
        break;

      case "COOKIES":
      case "COOKIES_ACK":
        row.cookiesHistory.push(consent);
        break;

      case "RETURNS_POLICY_ACK":
        row.returnsHistory.push(consent);
        break;

      case "MARKETING":
      case "MARKETING_EMAIL_OPTIN":
        row.marketingHistory.push(consent);
        break;

      default:
        break;
    }
  }

  const sortNewestFirst = (history = []) =>
    [...history].sort((a, b) => {
      const timeA = new Date(
        a?.givenAt || 0
      ).getTime();

      const timeB = new Date(
        b?.givenAt || 0
      ).getTime();

      return timeB - timeA;
    });

  return Array.from(grouped.values()).map((row) => {
    row.tosHistory =
      sortNewestFirst(row.tosHistory);

    row.privacyHistory =
      sortNewestFirst(row.privacyHistory);

    row.cookiesHistory =
      sortNewestFirst(row.cookiesHistory);

    row.returnsHistory =
      sortNewestFirst(row.returnsHistory);

    row.marketingHistory =
      sortNewestFirst(row.marketingHistory);

    const latestTos =
      row.tosHistory[0] || null;

    const latestPrivacy =
      row.privacyHistory[0] || null;

    const latestCookies =
      row.cookiesHistory[0] || null;

    const latestReturns =
      row.returnsHistory[0] || null;

    const latestMarketing =
      row.marketingHistory[0] || null;

    return {
      ...row,

      tosAccepted: !!latestTos,
      tosVersion:
        latestTos?.version || null,
      tosGivenAt:
        latestTos?.givenAt || null,

      privacyAccepted:
        !!latestPrivacy,
      privacyVersion:
        latestPrivacy?.version || null,
      privacyGivenAt:
        latestPrivacy?.givenAt || null,

      cookiesAccepted:
        !!latestCookies,
      cookiesVersion:
        latestCookies?.version || null,
      cookiesGivenAt:
        latestCookies?.givenAt || null,

      returnsAccepted:
        !!latestReturns,
      returnsVersion:
        latestReturns?.version || null,
      returnsGivenAt:
        latestReturns?.givenAt || null,

      marketingOptIn:
        !!latestMarketing,
      marketingVersion:
        latestMarketing?.version || null,
      marketingGivenAt:
        latestMarketing?.givenAt || null,
    };
  });
}
export default function AdminPoliciesTab({
  users = [],
  userConsents = [],
  vendorAgreements = [],
  influencerTerms = {},
}) {
  const [activeTab, setActiveTab] = useState(TABS.DOCUMENTS);

  const [userFilters, setUserFilters] = useState(createDefaultUserFilters);
  const [userPage, setUserPage] = useState(1);

  const [vendorFilters, setVendorFilters] = useState(
    createDefaultVendorFilters
  );
  const [vendorPage, setVendorPage] = useState(1);

  const [selectedVendor, setSelectedVendor] = useState(null);

  const [influencerFilters, setInfluencerFilters] = useState(
    createDefaultInfluencerFilters
  );
  const [influencerPage, setInfluencerPage] = useState(1);

  const [selectedInfluencerTerms, setSelectedInfluencerTerms] =
    useState(null);

  const influencerRows = useMemo(
    () => influencerTerms?.influencers || [],
    [influencerTerms]
  );
  const influencerCurrentVersion = influencerTerms?.currentVersion || null;
  const influencerDocumentUrl = influencerTerms?.documentUrl || null;

  const normalizedUserRows = useMemo(() => {
    const legalRows = normalizeUserConsents(userConsents);

    const legalByUserId = new Map();
    const legalByEmail = new Map();

    for (const row of legalRows) {
      if (row?.userId) {
        legalByUserId.set(row.userId, row);
      }

      if (row?.email) {
        legalByEmail.set(String(row.email).toLowerCase(), row);
      }
    }

    return (users || []).map((user) => {
      const legal =
        legalByUserId.get(user.id) ||
        legalByEmail.get(String(user.email || "").toLowerCase()) ||
        {};

      const cookieHistory = Array.isArray(user.cookieConsents)
        ? user.cookieConsents
        : [];

      const latestCookie =
        user.latestCookieConsent || cookieHistory[0] || null;

      return {
        ...legal,

        userId: user.id,
        email: user.email || "",
        role: user.role || "USER",
        createdAt: user.createdAt || legal.createdAt || null,

        tosAccepted: !!legal.tosAccepted,
        tosVersion: legal.tosVersion || null,
        tosGivenAt: legal.tosGivenAt || null,
        tosHistory: Array.isArray(legal.tosHistory) ? legal.tosHistory : [],

        privacyAccepted: !!legal.privacyAccepted,
        privacyVersion: legal.privacyVersion || null,
        privacyGivenAt: legal.privacyGivenAt || null,
        privacyHistory: Array.isArray(legal.privacyHistory)
          ? legal.privacyHistory
          : [],

        returnsAccepted: !!legal.returnsAccepted,
        returnsVersion: legal.returnsVersion || null,
        returnsGivenAt: legal.returnsGivenAt || null,
        returnsHistory: Array.isArray(legal.returnsHistory)
          ? legal.returnsHistory
          : [],

        marketingOptIn: !!user.marketingOptIn,
        marketingVersion: legal.marketingVersion || null,
        marketingGivenAt: legal.marketingGivenAt || null,
        marketingHistory: Array.isArray(legal.marketingHistory)
          ? legal.marketingHistory
          : [],

        cookieConsents: cookieHistory,
        latestCookieConsent: latestCookie,
        cookiesAccepted: !!latestCookie,
        cookieAnalytics: latestCookie ? !!latestCookie.analytics : null,
        cookieMarketing: latestCookie ? !!latestCookie.marketing : null,
        cookieAction: latestCookie?.action || null,
        cookieSource: latestCookie?.source || null,
        cookieVersion: latestCookie?.consentVersion || null,
        cookieGivenAt: latestCookie?.createdAt || null,
      };
    });
  }, [users, userConsents]);

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
    let list = [...normalizedUserRows];

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

    if (userFilters.hasCookies === "YES") {
  list = list.filter((r) => r.cookiesAccepted);
} else if (userFilters.hasCookies === "NO") {
  list = list.filter((r) => !r.cookiesAccepted);
}

if (userFilters.hasReturns === "YES") {
  list = list.filter((r) => r.returnsAccepted);
} else if (userFilters.hasReturns === "NO") {
  list = list.filter((r) => !r.returnsAccepted);
}

if (userFilters.hasMarketing === "YES") {
  list = list.filter((r) => r.marketingOptIn);
} else if (userFilters.hasMarketing === "NO") {
  list = list.filter((r) => !r.marketingOptIn);
}

    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  }, [normalizedUserRows, userFilters]);

  const userTotalItems = filteredUserRows.length;
  const userTotalPages = userTotalItems
    ? Math.ceil(userTotalItems / PAGE_SIZE)
    : 1;
  const userCurrentPage = Math.min(userPage, userTotalPages);
  const userStartIndex = (userCurrentPage - 1) * PAGE_SIZE;
  const userEndIndex = userStartIndex + PAGE_SIZE;
  const userPaginatedRows = filteredUserRows.slice(userStartIndex, userEndIndex);

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

  const handleInfluencerFilterChange = (updater) => {
    setInfluencerFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
    setInfluencerPage(1);
  };

  const resetInfluencerFilters = () => {
    setInfluencerFilters(createDefaultInfluencerFilters());
    setInfluencerPage(1);
  };

  const filteredInfluencerRows = useMemo(() => {
    let list = [...influencerRows];

    const q = influencerFilters.q.trim().toLowerCase();
    if (q) {
      list = list.filter((row) => {
        const name = row.name?.toLowerCase() || "";
        const email = row.email?.toLowerCase() || "";
        return name.includes(q) || email.includes(q);
      });
    }

    if (influencerFilters.termsStatus !== "ALL") {
      list = list.filter(
        (row) => row.termsStatus === influencerFilters.termsStatus
      );
    }

    list.sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt));
    return list;
  }, [influencerRows, influencerFilters]);

  const influencerTotalItems = filteredInfluencerRows.length;
  const influencerTotalPages = influencerTotalItems
    ? Math.ceil(influencerTotalItems / PAGE_SIZE)
    : 1;
  const influencerCurrentPage = Math.min(
    influencerPage,
    influencerTotalPages
  );
  const influencerStartIndex = (influencerCurrentPage - 1) * PAGE_SIZE;
  const influencerEndIndex = influencerStartIndex + PAGE_SIZE;
  const influencerPaginatedRows = filteredInfluencerRows.slice(
    influencerStartIndex,
    influencerEndIndex
  );

  return (
    <>
      <div
        className={styles.filtersRow}
        style={{ alignItems: "flex-end", marginBottom: 14 }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`${styles.paginationBtn} ${
              activeTab === TABS.DOCUMENTS ? styles.paginationBtnActive : ""
            }`}
            onClick={() => setActiveTab(TABS.DOCUMENTS)}
          >
            Documente juridice
          </button>

          <button
            type="button"
            className={`${styles.paginationBtn} ${
              activeTab === TABS.USERS ? styles.paginationBtnActive : ""
            }`}
            onClick={() => setActiveTab(TABS.USERS)}
          >
            Consimțăminte user
          </button>

          <button
            type="button"
            className={`${styles.paginationBtn} ${
              activeTab === TABS.VENDORS ? styles.paginationBtnActive : ""
            }`}
            onClick={() => setActiveTab(TABS.VENDORS)}
          >
            Acorduri vendori
          </button>

          <button
            type="button"
            className={`${styles.paginationBtn} ${
              activeTab === TABS.INFLUENCERS ? styles.paginationBtnActive : ""
            }`}
            onClick={() => setActiveTab(TABS.INFLUENCERS)}
          >
            Influenceri
          </button>

        </div>
      </div>

      {activeTab === TABS.USERS && (
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
              <span>Cookies</span>
              <select
                value={userFilters.hasCookies}
                onChange={(e) =>
                  handleUserFilterChange((f) => ({
                    ...f,
                    hasCookies: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="YES">Cu decizie cookies</option>
                <option value="NO">Fără decizie cookies</option>
              </select>
            </label>

            <label>
              <span>Marketing comunicări</span>
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
      )}

      {activeTab === TABS.VENDORS && (
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

          {selectedVendor && (
            <VendorDetailsDrawer
              vendor={selectedVendor}
              onClose={() => setSelectedVendor(null)}
            />
          )}
        </section>
      )}

      {activeTab === TABS.INFLUENCERS && (
        <section>
          <h3 className={styles.sectionTitle}>
            Acord Program Influenceri
            {influencerCurrentVersion && (
              <span className={styles.subtle} style={{ marginLeft: 10 }}>
                Versiune publicată: v{influencerCurrentVersion}
                {influencerDocumentUrl && (
                  <>
                    {" · "}
                    <a
                      href={influencerDocumentUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Vezi documentul
                    </a>
                  </>
                )}
              </span>
            )}
          </h3>

          <p className={styles.subtle} style={{ marginTop: -6 }}>
            {influencerTerms?.reacceptance ? (
              <>
                Reacceptare cerută pentru v{influencerTerms.reacceptance.version}
                {influencerTerms.reacceptance.deadlineAt && (
                  <> (termen {formatDate(influencerTerms.reacceptance.deadlineAt)})</>
                )}
                . Influencerii care nu au acceptat această versiune văd fereastra de acceptare.
              </>
            ) : (
              <>
                Nicio cerere de reacceptare deschisă: o versiune nouă publicată nu blochează
                influencerii. Cererea se face din „Documente juridice” → Acordul Programului de
                Influenceri → „Cere reacceptarea”.
              </>
            )}
          </p>

          <div className={styles.filtersRow}>
            <label>
              <span>Caută</span>
              <input
                type="text"
                placeholder="Nume influencer, email"
                value={influencerFilters.q}
                onChange={(e) =>
                  handleInfluencerFilterChange((f) => ({
                    ...f,
                    q: e.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Status acord</span>
              <select
                value={influencerFilters.termsStatus}
                onChange={(e) =>
                  handleInfluencerFilterChange((f) => ({
                    ...f,
                    termsStatus: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="UPDATED">Actualizați</option>
                <option value="OUTDATED">Necesită reacceptare</option>
                <option value="OLDER_VERSION">Versiune anterioară</option>
                <option value="NEVER_ACCEPTED">Nu au acceptat</option>
              </select>
            </label>

            <div className={styles.filtersActions}>
              <button
                type="button"
                className={styles.resetBtn}
                onClick={resetInfluencerFilters}
              >
                Reset
              </button>
              <span className={styles.filtersCount}>
                {influencerTotalItems} rezultate
              </span>
            </div>
          </div>

          <InfluencerTermsTable
            rows={influencerPaginatedRows}
            totalItems={influencerTotalItems}
            currentVersion={influencerCurrentVersion}
            onShowHistory={setSelectedInfluencerTerms}
          />

          <Pagination
            page={influencerCurrentPage}
            totalPages={influencerTotalPages}
            totalItems={influencerTotalItems}
            onPageChange={setInfluencerPage}
          />

          {selectedInfluencerTerms && (
            <InfluencerTermsHistoryDrawer
              influencer={selectedInfluencerTerms}
              currentVersion={influencerCurrentVersion}
              documentUrl={influencerDocumentUrl}
              onClose={() => setSelectedInfluencerTerms(null)}
            />
          )}
        </section>
      )}

      {activeTab === TABS.DOCUMENTS && <LegalDocumentsPanel />}
    </>
  );
}

function renderConsent(history = [], accepted, version, givenAt) {
  if (!accepted) {
    return "Nu";
  }

  return (
    <div>
      <div>
        <strong>
          Versiunea curentă: v{version || "?"}
        </strong>
      </div>

      <div
        style={{
          fontSize: 12,
          opacity: 0.72,
          marginTop: 4,
        }}
      >
        Acceptată la: {formatDate(givenAt)}
      </div>

      {history.length > 0 && (
        <div
          style={{
            fontSize: 12,
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          <strong>Istoric:</strong>{" "}
          {history
            .map(
              (item) =>
                `v${item.version || "?"} — ${formatDate(item.givenAt)}`
            )
            .join(" · ")}
        </div>
      )}
    </div>
  );
}
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
            <th>Utilizator</th>
            <th>Rol</th>
            <th>Creat la</th>
            <th>TOS</th>
            <th>Privacy</th>
            <th>Cookies</th>
            <th>Retur</th>
            <th>Marketing</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.email || r.userId}>
              <td>
                <div>
                  <div style={{ fontWeight: 700 }}>{r.email || "—"}</div>
                  <div
                    style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}
                    title={r.userId || ""}
                  >
                    {r.userId ? `ID: ${r.userId}` : "Fără ID"}
                  </div>
                </div>
              </td>

              <td>
                <strong>{r.role || "USER"}</strong>
              </td>

              <td>{formatDate(r.createdAt)}</td>

            <td>
  {r.tosAccepted ? (
    <div>
      <div>
        <strong>
          Versiunea curentă: v{r.tosVersion || "?"}
        </strong>
      </div>

      <div
        style={{
          fontSize: 12,
          opacity: 0.72,
          marginTop: 4,
        }}
      >
        Acceptată la: {formatDate(r.tosGivenAt)}
      </div>

      {Array.isArray(r.tosHistory) &&
      r.tosHistory.length > 0 ? (
        <div
          style={{
            fontSize: 12,
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          <strong>Istoric:</strong>{" "}
          {r.tosHistory
            .map(
              (item) =>
                `v${item.version || "?"} — ${formatDate(
                  item.givenAt
                )}`
            )
            .join(" · ")}
        </div>
      ) : null}
    </div>
  ) : (
    "Nu"
  )}
</td>

              <td>
  {renderConsent(
    r.privacyHistory,
    r.privacyAccepted,
    r.privacyVersion,
    r.privacyGivenAt
  )}
</td>

              <td>
                {!r.latestCookieConsent ? (
                  <span>Fără decizie</span>
                ) : (
                  <div>
                    <div>
                      <strong>
                        Analytics: {r.cookieAnalytics ? "Acceptat" : "Refuzat"}
                      </strong>
                    </div>

                    <div style={{ marginTop: 4 }}>
                      <strong>
                        Marketing: {r.cookieMarketing ? "Acceptat" : "Refuzat"}
                      </strong>
                    </div>

                    <div
                      style={{
                        fontSize: 12,
                        opacity: 0.72,
                        marginTop: 5,
                      }}
                    >
                      {r.cookieAction || "—"} · {r.cookieSource || "—"}
                    </div>

                    <div
                      style={{
                        fontSize: 12,
                        opacity: 0.72,
                        marginTop: 3,
                      }}
                    >
                      v{r.cookieVersion || "?"} · {formatDate(r.cookieGivenAt)}
                    </div>
                  </div>
                )}
              </td>

           <td>
  {renderConsent(
    r.returnsHistory,
    r.returnsAccepted,
    r.returnsVersion,
    r.returnsGivenAt
  )}
</td>

            <td>
  {renderConsent(
    r.marketingHistory,
    r.marketingOptIn,
    r.marketingVersion,
    r.marketingGivenAt
  )}
</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
            <th>Politică retur</th>
            <th>Declarație produse</th>
            <th>Anexa produse</th>
            <th>Politică livrare</th>
            <th>Notă GDPR</th>
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
                {r.productsAddendumAccepted
                  ? `Da (v${r.productsAddendumVersion || "?"}, ${formatDate(
                      r.productsAddendumAcceptedAt
                    )})`
                  : r.productsAddendumPublishedVersion
                  ? `Nu (publicată v${r.productsAddendumPublishedVersion})`
                  : "Nu"}
              </td>

              <td>
                {r.shippingPolicyVersion
                  ? `v${r.shippingPolicyVersion}`
                  : "—"}
              </td>

              <td>
                {r.privacyPolicyVersion
                  ? `v${r.privacyPolicyVersion}`
                  : "—"}
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
  for (let p = start; p <= end; p++) pages.push(p);

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

function VendorDetailsDrawer({ vendor, onClose }) {
  if (!vendor) return null;
  if (typeof document === "undefined") return null;

  const {
    vendorName,
    vendorEmail,
    userEmail,
    vendorId,
    createdAt,

    wantsCourier,
    courierAddendumToggleAccepted,
    courierServicesCount,
    courierSample,

    vendorTermsAccepted,
    vendorTermsVersion,
    vendorTermsAcceptedAt,

    returnsAccepted,
    returnsVersion,
    returnsAcceptedAt,

    productsAddendumAccepted,
    productsAddendumVersion,
    productsAddendumAcceptedAt,
    productsAddendumPublishedVersion,

    shippingAddendumAccepted,
    shippingAddendumAcceptedVersion,
    shippingAddendumAcceptedAt,

    shippingPolicyTitle,
    shippingPolicyUrl,
    shippingPolicyVersion,
    shippingPolicyRequired,
    shippingPolicyPublishedAt,

    privacyPolicyTitle,
    privacyPolicyUrl,
    privacyPolicyVersion,
    privacyPolicyRequired,
    privacyPolicyPublishedAt,

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
                  Versiune anexă: {courierSample.courierAddendumVersion || "—"}
                  <br />
                  Acceptată la:{" "}
                  {courierSample.courierAddendumAcceptedAt
                    ? formatDate(courierSample.courierAddendumAcceptedAt)
                    : "—"}
                </span>
              </div>
            )}

            <p className={styles.subtle}>
              * Valorile de mai sus vin din <code>VendorService.attributes</code>{" "}
              și sunt informative pentru setup-ul de curier.
            </p>
          </section>

          <section className={styles.drawerSection}>
            <h4>Acorduri legale acceptate</h4>

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

            <div className={styles.drawerField}>
              <span>Anexa produse</span>
              <span>
                {productsAddendumAccepted
                  ? `Da (v${productsAddendumVersion || "?"}, ${formatDate(
                      productsAddendumAcceptedAt
                    )})`
                  : "Nu"}
                {productsAddendumPublishedVersion && (
                  <>
                    <br />
                    Versiune publicată: {productsAddendumPublishedVersion}
                  </>
                )}
              </span>
            </div>

            <div className={styles.drawerField}>
              <span>Anexa de expediere (acceptare)</span>
              <span>
                {shippingAddendumAccepted
                  ? `Da (v${shippingAddendumAcceptedVersion || "?"}, ${formatDate(
                      shippingAddendumAcceptedAt
                    )})`
                  : "Nu"}
              </span>
            </div>
          </section>

          <section className={styles.drawerSection}>
            <h4>Documente informative active</h4>

            <div className={styles.drawerField}>
              <span>{shippingPolicyTitle || "Politica de livrare"}</span>
              <span>
                Versiune: {shippingPolicyVersion || "—"}
                <br />
                Obligatoriu: {shippingPolicyRequired ? "Da" : "Nu"}
                <br />
                Publicat la: {formatDate(shippingPolicyPublishedAt)}
                <br />
                {shippingPolicyUrl ? (
                  <a
                    href={shippingPolicyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Deschide documentul
                  </a>
                ) : (
                  "Link lipsă"
                )}
              </span>
            </div>

            <div className={styles.drawerField}>
              <span>{privacyPolicyTitle || "Nota GDPR pentru vendori"}</span>
              <span>
                Versiune: {privacyPolicyVersion || "—"}
                <br />
                Obligatoriu: {privacyPolicyRequired ? "Da" : "Nu"}
                <br />
                Publicat la: {formatDate(privacyPolicyPublishedAt)}
                <br />
                {privacyPolicyUrl ? (
                  <a
                    href={privacyPolicyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Deschide documentul
                  </a>
                ) : (
                  "Link lipsă"
                )}
              </span>
            </div>

            <p className={styles.subtle}>
              * Aceste documente sunt afișate informativ în onboarding și nu mai
              sunt tratate ca acceptări separate în admin.
            </p>
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

/* =========================================================
   INFLUENCERI - Acord Program Influenceri (influencer_terms)

   Read-only: nu există nicio acțiune de editare/ștergere/
   "marchează ca acceptat" - doar vizualizare. Acceptarea rămâne
   exclusiv acțiunea influencerului
   (POST /api/influencer/terms/accept).
========================================================= */

function InfluencerTermsStatusBadge({ status }) {
  const className =
    status === "UPDATED"
      ? styles.termsBadgeUpdated
      : status === "OUTDATED"
      ? styles.termsBadgeOutdated
      : status === "OLDER_VERSION"
      ? styles.termsBadgeUpdated
      : styles.termsBadgeMissing;

  return (
    <span className={`${styles.roleBadge} ${className}`}>
      {INFLUENCER_TERMS_STATUS_LABELS[status] || status}
    </span>
  );
}

function InfluencerTermsTable({
  rows,
  totalItems,
  currentVersion,
  onShowHistory,
}) {
  if (!rows?.length) {
    return (
      <p className={styles.subtle}>
        {totalItems
          ? "Nu există rezultate pe această pagină."
          : "Nu există influenceri înregistrați."}
      </p>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Influencer</th>
            <th>Email</th>
            <th>Status influencer</th>
            <th>Acord acceptat</th>
            <th>Versiune curentă</th>
            <th>Status acord</th>
            <th>Ultima acceptare</th>
            <th>Acțiuni</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.influencerId}>
              <td>
                <div style={{ fontWeight: 700 }}>{r.name || "—"}</div>
                <div
                  style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}
                  title={`InfluencerProfile.id: ${r.influencerId} · User.id: ${r.userId}`}
                >
                  ID profil: {r.influencerId}
                </div>
              </td>

              <td>{r.email || "—"}</td>

              <td>
                <span
                  className={
                    r.influencerStatus === "ACTIVE"
                      ? styles.vendorStatusActive
                      : styles.vendorStatusInactive
                  }
                >
                  {r.influencerStatus === "ACTIVE" ? "Activ" : "Dezactivat"}
                </span>
              </td>

              <td>{r.acceptedVersion ? `v${r.acceptedVersion}` : "—"}</td>

              <td>{currentVersion ? `v${currentVersion}` : "—"}</td>

              <td>
                <InfluencerTermsStatusBadge status={r.termsStatus} />
              </td>

              <td>{r.acceptedAt ? formatDate(r.acceptedAt) : "—"}</td>

              <td>
                <button
                  type="button"
                  className={styles.emailBtn}
                  onClick={() => onShowHistory?.(r)}
                >
                  Vezi istoric
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InfluencerTermsHistoryDrawer({
  influencer,
  currentVersion,
  documentUrl,
  onClose,
}) {
  if (!influencer) return null;
  if (typeof document === "undefined") return null;

  const { name, email, influencerId, userId, history = [] } = influencer;

  const node = (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        aria-label="Istoric acceptări influencer"
      >
        <header className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>
              {name || "Influencer fără nume"}
            </h3>
            <p className={styles.drawerSub}>{email || "—"}</p>
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
          <section className={styles.drawerSection}>
            <h4>Identitate</h4>

            <div className={styles.drawerField}>
              <span>InfluencerProfile.id</span>
              <code>{influencerId}</code>
            </div>

            <div className={styles.drawerField}>
              <span>User.id</span>
              <code>{userId}</code>
            </div>

            <p className={styles.subtle}>
              * UserConsent este legat de User.id (nu de
              InfluencerProfile.id) - istoricul de mai jos e căutat după
              User.id.
            </p>
          </section>

          <section className={styles.drawerSection}>
            <h4>Document curent</h4>

            <div className={styles.drawerField}>
              <span>Versiune curentă (legal manifest)</span>
              <span>{currentVersion ? `v${currentVersion}` : "—"}</span>
            </div>

            {documentUrl && (
              <div className={styles.drawerField}>
                <span>Document</span>
                <a href={documentUrl} target="_blank" rel="noreferrer">
                  Vezi documentul curent
                </a>
              </div>
            )}
          </section>

          <section className={styles.drawerSection}>
            <h4>Istoric acceptări (INFLUENCER_TERMS)</h4>

            {!history.length ? (
              <p className={styles.subtle}>
                Acest influencer nu a acceptat niciodată Acordul Programului
                de Influenceri.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {history.map((item) => {
                  const isCurrent =
                    currentVersion && item.version === currentVersion;

                  return (
                    <div
                      key={item.id}
                      className={styles.drawerField}
                      style={{
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: 4,
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                        padding: "8px 10px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          className={`${styles.roleBadge} ${
                            isCurrent
                              ? styles.termsBadgeUpdated
                              : styles.termsBadgeOutdated
                          }`}
                        >
                          v{item.version || "?"}
                        </span>
                        {isCurrent && (
                          <span className={styles.subtle}>
                            (versiunea curentă)
                          </span>
                        )}
                      </div>

                      <span>Acceptat la: {formatDate(item.givenAt)}</span>

                      <span title={item.checksum || ""}>
                        Checksum:{" "}
                        {item.checksum
                          ? `${item.checksum.slice(0, 12)}…`
                          : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
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