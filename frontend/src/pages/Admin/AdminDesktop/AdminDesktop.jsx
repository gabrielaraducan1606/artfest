// src/pages/Admin/AdminDesktop/AdminDesktop.jsx
import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../../../lib/api";
import { useAuth } from "../../Auth/Context/context.js";
import styles from "./AdminDesktop.module.css";

import AdminUsersTab from "./tabs/AdminUsersTab.jsx";
import AdminVendorsTab from "./tabs/AdminVendorsTab.jsx";
import AdminOrdersTab from "./tabs/AdminOrdersTab.jsx";
import AdminProductsTab from "./tabs/AdminProductsTab.jsx";
import AdminPoliciesTab from "./tabs/AdminPoliciesTab.jsx";

/**
 * Definiție tab-uri: un singur source of truth
 *
 * adminAllUsers = toate conturile (USER + VENDOR + ADMIN)
 * users         = doar useri (clienți, role=USER)
 */
const TABS = [
  { id: "adminAllUsers", label: "Toate conturile" }, // USER + VENDOR + ADMIN
  { id: "users", label: "Useri (clienți)" }, // doar role = USER
  { id: "vendors", label: "Vendori" },
  { id: "orders", label: "Comenzi" },
  { id: "products", label: "Produse" },
  { id: "policies", label: "Politici / consimțăminte" }, // 👉 tab nou
];

/**
 * Helper ca să nu treci magic strings prin cod
 */
const TAB_IDS = TABS.reduce((acc, t) => {
  acc[t.id] = t.id;
  return acc;
}, {});

export default function AdminDesktop() {
  const { me, loading: authLoading } = useAuth();

  // tab implicit: toate conturile
  const [activeTab, setActiveTab] = useState(TAB_IDS.adminAllUsers);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [users, setUsers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [userConsents, setUserConsents] = useState([]);      // consimțăminte per user
  const [vendorAgreements, setVendorAgreements] = useState([]); // acorduri per vendor 👈

  // simple cache ca să nu refaci request-ul de fiecare dată
  const [loadedTabs, setLoadedTabs] = useState({
    adminAllUsers: false, // toate conturile
    users: false, // doar clienți
    vendors: false,
    orders: false,
    products: false,
    policies: false, // tab consimțăminte / acorduri
  });

  const [stats, setStats] = useState({
    users: 0,
    vendors: 0,
    orders: 0,
    products: 0,
    // nu punem KPI separat pentru policies, e mai mult un tab de audit
  });

  // filtru “forțat” pentru tabul de comenzi (setat din UsersTab)
  const [ordersFilter, setOrdersFilter] = useState({
    userId: null,
    vendorId: null,
  });

  const isAdmin = me && me.role === "ADMIN";

  // ==================== DATA LOADERS ====================

  const loadStats = useCallback(async () => {
    try {
      const d = await api("/api/admin/stats").catch(() => null);
      if (!d) return;
      setStats({
        users: d.usersCount ?? 0,
        vendors: d.vendorsCount ?? 0,
        orders: d.ordersCount ?? 0,
        products: d.productsCount ?? 0,
      });
    } catch {
      // nu blocăm pagina dacă pică stats
    }
  }, []);

  const loadUsers = useCallback(async () => {
    const d = await api("/api/admin/users");
    setUsers(d.users || []);
  }, []);

  const loadVendors = useCallback(async () => {
    const d = await api("/api/admin/vendors");
    setVendors(d.vendors || []);
  }, []);

  const loadOrders = useCallback(async () => {
    const d = await api("/api/admin/orders?limit=50");
    setOrders(d.orders || []);
  }, []);

  const loadProducts = useCallback(async () => {
    const d = await api("/api/admin/products?limit=50");
    setProducts(d.products || []);
  }, []);

  // 👉 loader pentru tab-ul de consimțăminte user + acorduri vendor
  const loadPolicies = useCallback(async () => {
    // facem în paralel cele 2 request-uri
    const [uc, va] = await Promise.all([
      api("/api/admin/user-consents"),         // { consents: [...] }
      api("/api/admin/vendor-acceptances").catch(() => ({ agreements: [] })), // { agreements: [...] }
    ]);

    setUserConsents(uc.consents || []);
    setVendorAgreements(va.agreements || []);
  }, []);

  /**
   * Loader generic pe baza tab-ului activ.
   * Are grijă să nu reîncarce inutil dacă deja avem date pentru acel tab.
   */
  const loadTabData = useCallback(
    async (tabId) => {
      if (!tabId) return;

      // dacă tabul e deja încărcat, nu mai facem request
      if (loadedTabs[tabId]) return;

      setLoading(true);
      setError("");

      try {
        if (tabId === TAB_IDS.adminAllUsers || tabId === TAB_IDS.users) {
          // ambele tab-uri folosesc aceleași date de bază (lista completă de useri),
          // doar filtrarea diferă în AdminUsersTab prin prop-ul `variant`
          await loadUsers();
          setLoadedTabs((prev) => ({
            ...prev,
            adminAllUsers: true,
            users: true,
          }));
        } else if (tabId === TAB_IDS.vendors) {
          await loadVendors();
          setLoadedTabs((prev) => ({ ...prev, vendors: true }));
        } else if (tabId === TAB_IDS.orders) {
          await loadOrders();
          setLoadedTabs((prev) => ({ ...prev, orders: true }));
        } else if (tabId === TAB_IDS.products) {
          await loadProducts();
          setLoadedTabs((prev) => ({ ...prev, products: true }));
        } else if (tabId === TAB_IDS.policies) {
          await loadPolicies();
          setLoadedTabs((prev) => ({ ...prev, policies: true }));
        }
      } catch (e) {
        console.error(e);
        const message =
          e?.response?.data?.message ||
          e?.message ||
          "Nu am putut încărca datele pentru acest tab.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [loadedTabs, loadUsers, loadVendors, loadOrders, loadProducts, loadPolicies]
  );

  // callback folosit de UsersTab ca să sară în tabul de comenzi filtrat
  const handleGoToOrders = useCallback(
    ({ userId = null, vendorId = null } = {}) => {
      setOrdersFilter({ userId, vendorId });
      // ne asigurăm că avem datele pentru tab-ul de comenzi
      loadTabData(TAB_IDS.orders);
      // schimbăm tab-ul
      setActiveTab(TAB_IDS.orders);
    },
    [loadTabData]
  );

  // ==================== EFFECTS ====================

  // 1) când aflăm că userul e admin, încărcăm stats o singură dată
  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) return;
    loadStats();
  }, [authLoading, isAdmin, loadStats]);

  // 2) la schimbarea tab-ului încărcăm datele pentru acel tab (dacă nu sunt încă)
  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) return;
    loadTabData(activeTab);
  }, [authLoading, isAdmin, activeTab, loadTabData]);

  // ==================== GUARDING ====================

  const activeTabLabel = useMemo(
    () => TABS.find((t) => t.id === activeTab)?.label || "",
    [activeTab]
  );

  if (authLoading) {
    return <div className={styles.page}>Se verifică sesiunea…</div>;
  }

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        Acces doar pentru administratori.
      </div>
    );
  }

  // ==================== RENDER HELPERS ====================

  const renderTabContent = () => {
    if (loading) return null; // loading se afișează în header

    if (error) {
      return <div className={styles.error}>{error}</div>;
    }

    // state de "no data"
    if (activeTab === TAB_IDS.adminAllUsers && !users.length) {
      return <EmptyState text="Nu există conturi încă." />;
    }

    if (activeTab === TAB_IDS.users && !users.length) {
      return <EmptyState text="Nu există clienți încă." />;
    }

    if (activeTab === TAB_IDS.vendors && !vendors.length) {
      return <EmptyState text="Nu există vendori încă." />;
    }

    if (activeTab === TAB_IDS.orders && !orders.length) {
      return <EmptyState text="Nu există comenzi în acest moment." />;
    }

    if (activeTab === TAB_IDS.products && !products.length) {
      return <EmptyState text="Nu există produse listate încă." />;
    }

    // pentru tab-ul de politici, verificăm ambele colecții
    if (
      activeTab === TAB_IDS.policies &&
      !userConsents.length &&
      !vendorAgreements.length
    ) {
      return (
        <EmptyState text="Nu există încă înregistrări de consimțăminte sau acorduri." />
      );
    }

    // conținut efectiv al tab-urilor
    if (activeTab === TAB_IDS.adminAllUsers) {
      // toate conturile: USER + VENDOR + ADMIN
      return (
        <AdminUsersTab
          users={users}
          variant="all"
          onGoToOrders={handleGoToOrders}
        />
      );
    }

    if (activeTab === TAB_IDS.users) {
      // doar useri (clienți)
      return (
        <AdminUsersTab
          users={users}
          variant="customers"
          onGoToOrders={handleGoToOrders}
        />
      );
    }

    if (activeTab === TAB_IDS.vendors) {
      return <AdminVendorsTab vendors={vendors} />;
    }

    if (activeTab === TAB_IDS.orders) {
      return (
        <AdminOrdersTab
          orders={orders}
          forcedUserId={ordersFilter.userId}
          forcedVendorId={ordersFilter.vendorId}
        />
      );
    }

    if (activeTab === TAB_IDS.products) {
      return <AdminProductsTab products={products} />;
    }

    if (activeTab === TAB_IDS.policies) {
      return (
        <AdminPoliciesTab
          userConsents={userConsents}
          vendorAgreements={vendorAgreements}
        />
      );
    }

    return null;
  };

  // ==================== JSX ====================

  return (
    <section className={styles.page}>
      {/* HEADER */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.h1}>Panou Admin</h1>
          <p className={styles.subtle}>
            Logat ca <b>{me.email}</b> ({me.role})
          </p>
        </div>
      </header>

      {/* KPI cards */}
      <div className={styles.kpiRow}>
        <KPI label="Utilizatori" value={stats.users} />
        <KPI label="Vendori" value={stats.vendors} />
        <KPI label="Comenzi" value={stats.orders} />
        <KPI label="Produse" value={stats.products} />
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`${styles.tab} ${
              activeTab === tab.id ? styles.tabActive : ""
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content card */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{activeTabLabel}</h2>
          {loading && (
            <span className={styles.subtle}>Se încarcă datele…</span>
          )}
        </div>

        {renderTabContent()}
      </div>
    </section>
  );
}

/* ==================== KPI component ==================== */

function KPI({ label, value }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiVal}>{value}</div>
      <div className={styles.kpiLabel}>{label}</div>
    </div>
  );
}

/* ==================== Empty state component ==================== */

function EmptyState({ text }) {
  return <p className={styles.emptyState}>{text}</p>;
}
