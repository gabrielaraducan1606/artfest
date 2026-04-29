// src/pages/Admin/AdminDesktop/AdminDesktop.jsx
import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../../../lib/api";
import { useAuth } from "../../Auth/Context/context.js";
import styles from "./AdminDesktop.module.css";

import AdminUsersTab from "./tabs/AdminUsersTab.jsx";
import AdminVendorsTab from "./tabs/AdminVendorsTab.jsx";
import AdminVendorPlansTab from "./tabs/AdminVendorTabPlans.jsx";
import AdminOrdersTab from "./tabs/AdminOrdersTab.jsx";
import AdminProductsTab from "./tabs/AdminProductsTab.jsx";
import AdminPoliciesTab from "./tabs/AdminPoliciesTab.jsx";
import AdminEmailLogsTab from "./tabs/AdminEmailLogsTab.jsx";

const TABS = [
  { id: "adminAllUsers", label: "Toate conturile" },
  { id: "users", label: "Useri (clienți)" },
  { id: "vendors", label: "Vendori" },
  { id: "vendorPlans", label: "Abonamente (Vendori)" },
  { id: "orders", label: "Comenzi" },
  { id: "products", label: "Produse" },
  { id: "policies", label: "Politici / consimțăminte" },
  { id: "emails", label: "Emailuri" },
];

const TAB_IDS = TABS.reduce((acc, t) => {
  acc[t.id] = t.id;
  return acc;
}, {});

export default function AdminDesktop() {
  const { me, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState(TAB_IDS.adminAllUsers);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [users, setUsers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [userConsents, setUserConsents] = useState([]);
  const [vendorAgreements, setVendorAgreements] = useState([]);
  const [vendorPlans, setVendorPlans] = useState({ total: 0, items: [] });

  const [loadedTabs, setLoadedTabs] = useState({
    adminAllUsers: false,
    users: false,
    vendors: false,
    vendorPlans: false,
    orders: false,
    products: false,
    policies: false,
    emails: false,
  });

  const [stats, setStats] = useState({
    users: 0,
    vendors: 0,
    orders: 0,
    products: 0,
  });

  const [ordersFilter, setOrdersFilter] = useState({
    userId: null,
    vendorId: null,
  });

  const isAdmin = me && me.role === "ADMIN";

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

  const loadPolicies = useCallback(async () => {
    const [uc, va] = await Promise.all([
      api("/api/admin/user-consents"),
      api("/api/admin/vendor-acceptances").catch(() => ({ agreements: [] })),
    ]);

    setUserConsents(uc.consents || []);
    setVendorAgreements(va.agreements || []);
  }, []);

  const loadVendorPlans = useCallback(async () => {
    const d = await api("/api/admin/vendors/plans?take=50&skip=0");
    setVendorPlans({ total: d.total ?? 0, items: d.items ?? [] });
  }, []);

  const loadTabData = useCallback(
    async (tabId) => {
      if (!tabId) return;
      if (loadedTabs[tabId]) return;

      if (tabId === TAB_IDS.emails) {
        setLoadedTabs((prev) => ({ ...prev, emails: true }));
        return;
      }

      if (tabId === TAB_IDS.products) {
        setLoadedTabs((prev) => ({ ...prev, products: true }));
        return;
      }

      setLoading(true);
      setError("");

      try {
        if (tabId === TAB_IDS.adminAllUsers || tabId === TAB_IDS.users) {
          await loadUsers();
          setLoadedTabs((prev) => ({
            ...prev,
            adminAllUsers: true,
            users: true,
          }));
        } else if (tabId === TAB_IDS.vendors) {
          await loadVendors();
          setLoadedTabs((prev) => ({ ...prev, vendors: true }));
        } else if (tabId === TAB_IDS.vendorPlans) {
          await loadVendorPlans();
          setLoadedTabs((prev) => ({ ...prev, vendorPlans: true }));
        } else if (tabId === TAB_IDS.orders) {
          await loadOrders();
          setLoadedTabs((prev) => ({ ...prev, orders: true }));
        } else if (tabId === TAB_IDS.policies) {
          await loadPolicies();
          setLoadedTabs((prev) => ({ ...prev, policies: true }));
        }
      } catch (e) {
        console.error(e);
        setError(
          e?.response?.data?.message ||
            e?.message ||
            "Nu am putut încărca datele pentru acest tab."
        );
      } finally {
        setLoading(false);
      }
    },
    [
      loadedTabs,
      loadUsers,
      loadVendors,
      loadVendorPlans,
      loadOrders,
      loadPolicies,
    ]
  );

  const handleGoToOrders = useCallback(
    ({ userId = null, vendorId = null } = {}) => {
      setOrdersFilter({ userId, vendorId });
      loadTabData(TAB_IDS.orders);
      setActiveTab(TAB_IDS.orders);
    },
    [loadTabData]
  );

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) return;
    loadStats();
  }, [authLoading, isAdmin, loadStats]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) return;
    loadTabData(activeTab);
  }, [authLoading, isAdmin, activeTab, loadTabData]);

  const activeTabLabel = useMemo(
    () => TABS.find((t) => t.id === activeTab)?.label || "",
    [activeTab]
  );

  if (authLoading) {
    return <div className={styles.page}>Se verifică sesiunea…</div>;
  }

  if (!isAdmin) {
    return <div className={styles.page}>Acces doar pentru administratori.</div>;
  }

  const renderTabContent = () => {
    if (loading) return null;
    if (error) return <div className={styles.error}>{error}</div>;

    if (activeTab === TAB_IDS.adminAllUsers && !users.length) {
      return <EmptyState text="Nu există conturi încă." />;
    }

    if (activeTab === TAB_IDS.users && !users.length) {
      return <EmptyState text="Nu există clienți încă." />;
    }

    if (activeTab === TAB_IDS.vendors && !vendors.length) {
      return <EmptyState text="Nu există vendori încă." />;
    }

    if (activeTab === TAB_IDS.vendorPlans && !vendorPlans?.items?.length) {
      return <EmptyState text="Nu există încă abonamente sau nu au fost încărcate." />;
    }

    if (activeTab === TAB_IDS.orders && !orders.length) {
      return <EmptyState text="Nu există comenzi în acest moment." />;
    }

    if (
      activeTab === TAB_IDS.policies &&
      !userConsents.length &&
      !vendorAgreements.length
    ) {
      return <EmptyState text="Nu există încă înregistrări de consimțăminte sau acorduri." />;
    }

    if (activeTab === TAB_IDS.adminAllUsers) {
      return (
        <AdminUsersTab
          users={users}
          variant="all"
          onGoToOrders={handleGoToOrders}
        />
      );
    }

    if (activeTab === TAB_IDS.users) {
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

    if (activeTab === TAB_IDS.vendorPlans) {
      return (
        <AdminVendorPlansTab
          initial={vendorPlans}
          onRefresh={async () => {
            await loadVendorPlans();
          }}
        />
      );
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
      return <AdminProductsTab />;
    }

    if (activeTab === TAB_IDS.policies) {
      return (
        <AdminPoliciesTab
          userConsents={userConsents}
          vendorAgreements={vendorAgreements}
        />
      );
    }

    if (activeTab === TAB_IDS.emails) {
      return <AdminEmailLogsTab />;
    }

    return null;
  };

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.h1}>Panou Admin</h1>
          <p className={styles.subtle}>
            Logat ca <b>{me.email}</b> ({me.role})
          </p>
        </div>
      </header>

      <div className={styles.kpiRow}>
        <KPI label="Utilizatori" value={stats.users} />
        <KPI label="Vendori" value={stats.vendors} />
        <KPI label="Comenzi" value={stats.orders} />
        <KPI label="Produse" value={stats.products} />
      </div>

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

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{activeTabLabel}</h2>
          {loading && <span className={styles.subtle}>Se încarcă datele…</span>}
        </div>

        {renderTabContent()}
      </div>
    </section>
  );
}

function KPI({ label, value }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiVal}>{value}</div>
      <div className={styles.kpiLabel}>{label}</div>
    </div>
  );
}

function EmptyState({ text }) {
  return <p className={styles.emptyState}>{text}</p>;
}