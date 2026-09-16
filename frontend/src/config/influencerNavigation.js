// src/config/influencerNavigation.js

/*
 * Configurația STATICĂ a drawerului pentru rolul INFLUENCER - mirror
 * structural al vendorNavigation.js / userNavigation.js. Doar rute
 * reale, verificate în App.jsx și în InfluencerDashboardPage.jsx
 * înainte de a fi adăugate aici.
 *
 * IMPORTANT: /influencer are un SINGUR router real (nu pagini
 * separate) - Colecțiile și Codurile de reducere sunt MODALE deschise
 * din interiorul tabului "promotion" (state intern, fără query param
 * propriu fiecare), nu rute distincte - de-aia sunt UN SINGUR item
 * "Promovare" spre /influencer?tab=promotion, nu două iteme identice
 * ca destinație. Nu inventăm rute separate care nu există.
 *
 * Nu conține JSX, unread counts sau logică de auth.
 */

export const INFLUENCER_DASHBOARD_LINK = {
  label: "Dashboard influencer",
  to: "/influencer",
  icon: "LayoutGrid",
};

export const INFLUENCER_NAV_SECTIONS = [
  {
    key: "promovare",
    label: "Promovare",
    icon: "Megaphone",
    items: [
      {
        label: "Promovare",
        to: "/influencer?tab=promotion",
        icon: "Megaphone",
      },
      { label: "Resurse", to: "/influencer?tab=resources", icon: "FileText" },
    ],
  },
  {
    key: "performanta",
    label: "Performanță",
    icon: "TrendingUp",
    items: [
      {
        label: "Comenzi & câștiguri",
        to: "/influencer?tab=orders",
        icon: "ShoppingBag",
      },
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
        label: "Acordul Programului de Influenceri",
        to: "/acord-influenceri",
        icon: "FileText",
      },
    ],
  },
];
