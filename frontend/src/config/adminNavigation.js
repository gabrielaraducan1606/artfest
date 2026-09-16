// src/config/adminNavigation.js

/*
 * Configurația STATICĂ a drawerului pentru rolul ADMIN - mirror
 * structural al celorlalte navigationByRole. Doar rute reale,
 * verificate în App.jsx (blocul <Route path="/admin"> cu copiii lui)
 * înainte de a fi adăugate aici.
 *
 * IMPORTANT - itemi ceruți în structura orientativă dar OMIȘI
 * intenționat, pentru că nu au o rută/destinație reală distinctă
 * (verificat direct în cod, nu presupus):
 * - "Vendori" și "Comenzi": există doar ca TABURI interne în
 *   AdminDesktop.jsx (state intern, fără query param propriu) - ar
 *   duce la exact aceeași adresă ca "Dashboard" (/admin), fără să
 *   selecteze automat tabul dorit. La fel ca la INFLUENCER, nu
 *   duplicăm un item spre o destinație identică cu alta deja listată.
 * - "Influenceri": există doar ca tab intern în AdminMarketingPage.jsx
 *   (tot fără query param) - aceeași problemă, plus că ar fi identic
 *   cu "Marketing".
 * - "Promoții": nu există nicio rută sau tab cu acest nume în admin.
 * - "Setări": nu există nicio rută de setări pentru admin în router.
 *
 * Nu conține JSX, unread counts sau logică de auth.
 */

export const ADMIN_DASHBOARD_LINK = {
  label: "Dashboard",
  to: "/admin",
  icon: "LayoutGrid",
};

export const ADMIN_NAV_SECTIONS = [
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
      { label: "Marketing", to: "/admin/marketing", icon: "Megaphone" },
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
