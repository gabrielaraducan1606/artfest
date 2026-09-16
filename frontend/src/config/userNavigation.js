// src/config/userNavigation.js

/*
 * Configurația STATICĂ a drawerului pentru rolul USER - mirror
 * structural al vendorNavigation.js. Doar rute reale, verificate în
 * App.jsx înainte de a fi adăugate aici.
 *
 * Nu conține JSX, unread counts sau logică de auth - acelea rămân în
 * Navbar.jsx.
 */

export const USER_DASHBOARD_LINK = {
  label: "Dashboard",
  to: "/desktop-user",
  icon: "LayoutGrid",
};

export const USER_NAV_SECTIONS = [
  {
    key: "dashboard",
    label: "Activitate",
    icon: "Activity",
    items: [
      { label: "Comenzile mele", to: "/comenzile-mele", icon: "ShoppingBag" },
      { label: "Mesaje", to: "/cont/mesaje", icon: "MessageSquare" },
      { label: "Notificări", to: "/notificari", icon: "Bell" },
      { label: "Dorințe", to: "/wishlist", icon: "Heart" },
    ],
  },
  {
    key: "cont",
    label: "Cont",
    icon: "Settings",
    items: [
      { label: "Setări", to: "/cont/setari", icon: "Settings" },
      { label: "Asistență", to: "/account/support", icon: "LifeBuoy" },
    ],
  },
  {
    key: "ajutor-legal",
    label: "Ajutor & legal",
    icon: "FileText",
    items: [
      {
        label: "Termeni și condiții",
        to: "/termenii-si-conditiile",
        icon: "FileText",
      },
      {
        label: "Confidențialitate",
        to: "/confidentialitate",
        icon: "FileText",
      },
      { label: "Cookies", to: "/politica-cookie", icon: "FileText" },
      {
        label: "Politica de retur",
        to: "/politica-de-retur",
        icon: "FileText",
      },
    ],
  },
];
