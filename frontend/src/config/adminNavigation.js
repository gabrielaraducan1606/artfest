// src/config/adminNavigation.js

/*
 * Configurația STATICĂ a drawerului pentru rolul ADMIN - mirror
 * structural al celorlalte navigationByRole. Doar rute reale din App.jsx
 * (blocul /admin cu copiii lui).
 *
 * Taburile interne (Comenzi, Vendori, Produse... în AdminDesktop.jsx;
 * Influenceri, Coduri... în AdminMarketingPage.jsx) sunt adresabile prin
 * ?tab=<id> - ambele pagini citesc ȘI scriu parametrul, deci linkurile de
 * aici deschid direct tabul (inclusiv pe mobil, din drawer). Fără ?tab=
 * se afișează tabul implicit al paginii (ADMIN_DEFAULT_TABS, folosit și la
 * marcarea itemului activ).
 *
 * Nu există în router: „Setări” admin (nicio rută) - omis intenționat.
 * Nu conține JSX, unread counts sau logică de auth.
 */

// tabul afișat când URL-ul nu are ?tab= (marcarea itemului activ)
export const ADMIN_DEFAULT_TABS = Object.freeze({
  "/admin": "adminAllUsers",
  "/admin/marketing": "campaign",
});

export const ADMIN_DASHBOARD_LINK = {
  label: "Dashboard",
  to: "/admin",
  icon: "LayoutGrid",
};

export const ADMIN_NAV_SECTIONS = [
  {
    key: "operatiuni",
    label: "Operațiuni",
    icon: "ShoppingBag",
    items: [
      { label: "Comenzi", to: "/admin?tab=orders", icon: "ShoppingBag" },
      { label: "Retururi", to: "/admin?tab=returns", icon: "Truck" },
      { label: "Produse", to: "/admin?tab=products", icon: "Package" },
      { label: "Colecții & promoții", to: "/admin?tab=collections", icon: "Layers" },
      { label: "Vendori", to: "/admin?tab=vendors", icon: "Users" },
      { label: "Useri (clienți)", to: "/admin?tab=users", icon: "UserIcon" },
    ],
  },
  {
    key: "gestionare",
    label: "Gestionare",
    icon: "Users",
    items: [
      { label: "Abonamente", to: "/admin/vendor-plans", icon: "CreditCard" },
      { label: "Colete", to: "/admin/pickups", icon: "Package" },
      { label: "Facturare", to: "/admin/billing", icon: "Receipt" },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    icon: "Megaphone",
    items: [
      { label: "Influenceri", to: "/admin/marketing?tab=influencers", icon: "Sparkles" },
      { label: "Coduri de reducere", to: "/admin/marketing?tab=vendorDiscountCodes", icon: "Percent" },
      { label: "Campanii vendori", to: "/admin/marketing?tab=vendorCampaigns", icon: "Megaphone" },
      { label: "Email & newsletter", to: "/admin/marketing", icon: "MessageSquare" },
    ],
  },
  {
    key: "sistem",
    label: "Sistem",
    icon: "Settings",
    items: [
      { label: "Mentenanță", to: "/admin/maintenance", icon: "Wrench" },
      { label: "Incidente", to: "/admin/incidents", icon: "AlertTriangle" },
    ],
  },
  {
    key: "suport",
    label: "Suport",
    icon: "LifeBuoy",
    items: [
      { label: "Asistență admin", to: "/admin/support", icon: "LifeBuoy" },
    ],
  },
];

/*
 * Itemul activ în meniul admin: lipsa ?tab= = tabul implicit al paginii,
 * ca „Dashboard” să nu fie marcat activ și pe /admin?tab=orders, iar
 * „Email & newsletter” să nu fie activ pe /admin/marketing?tab=influencers.
 */
export function withAdminDefaultTab(to, pathname, search) {
  const [path, query = ""] = String(to || "").split("?");
  const params = new URLSearchParams(query);
  const defaultTab = ADMIN_DEFAULT_TABS[path];
  if (defaultTab && !params.get("tab")) params.set("tab", defaultTab);

  const current = new URLSearchParams(search || "");
  const currentDefault = ADMIN_DEFAULT_TABS[pathname];
  if (currentDefault && !current.get("tab")) current.set("tab", currentDefault);

  return {
    to: `${path}${params.toString() ? `?${params}` : ""}`,
    search: current.toString() ? `?${current}` : "",
  };
}

// eticheta paginii curente (header-ul admin pe mobil)
export function getAdminPageLabel(pathname, search) {
  const all = [ADMIN_DASHBOARD_LINK, ...ADMIN_NAV_SECTIONS.flatMap((s) => s.items)];
  for (const item of all) {
    const { to, search: effectiveSearch } = withAdminDefaultTab(item.to, pathname, search);
    const [path, query = ""] = to.split("?");
    if (pathname !== path && !pathname.startsWith(`${path}/`)) continue;
    const wanted = new URLSearchParams(query);
    const current = new URLSearchParams(effectiveSearch);
    if ([...wanted.entries()].every(([k, v]) => current.get(k) === v)) {
      return item === ADMIN_DASHBOARD_LINK ? "Dashboard" : item.label;
    }
  }
  return "Admin";
}
