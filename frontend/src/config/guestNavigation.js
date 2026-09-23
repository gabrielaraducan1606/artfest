// src/config/guestNavigation.js

/*
 * Configurația STATICĂ a drawerului pentru vizitatorii neautentificați
 * (GUEST) - mirror structural al celorlalte navigationByRole (vendor/
 * user/influencer). Doar rute publice reale, verificate în App.jsx.
 *
 * GUEST nu are "Dashboard" - nu există dashboardLink pentru el
 * (Navbar.jsx trebuie să treacă dashboardLink={null} la shell).
 *
 * Autentificare / Creează cont / Devino partener NU sunt rute - sunt
 * modalele deja existente în Navbar.jsx (authOpen/partnerOpen). Un
 * item de-aici poate avea `action` (string) în loc de `to` - Navbar.jsx
 * leagă acel string de handler-ul real (setAuthOpen/setPartnerOpen),
 * config-ul rămâne doar date, fără funcții/JSX.
 */

export const GUEST_NAV_SECTIONS = [
  {
    key: "acasa",
    label: "Acasă",
    icon: "Home",
    items: [
      { label: "Acasă", to: "/", icon: "Home" },
      { label: "Produse", to: "/produse", icon: "Package" },
      { label: "Magazine", to: "/magazine", icon: "Store" },
      { label: "Categorii", to: "/categorii", icon: "LayoutGrid" },
      { label: "Colecții", to: "/colectii", icon: "Layers" },
    ],
  },
  {
    key: "servicii",
    label: "Servicii",
    icon: "Sparkles",
    items: [
      {
        label: "Servicii digitale",
        to: "/servicii-digitale",
        icon: "Sparkles",
      },
    ],
  },
  {
    key: "cont",
    label: "Cont",
    icon: "UserIcon",
    items: [
      { label: "Autentificare", action: "login", icon: "UserIcon" },
      { label: "Creează cont", action: "register", icon: "UserPlus" },
      { label: "Devino partener", action: "partner", icon: "Store" },
    ],
  },
  {
    key: "ajutor",
    label: "Ajutor",
    icon: "LifeBuoy",
    items: [
      { label: "Asistență", to: "/support", icon: "LifeBuoy" },
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
    ],
  },
];
