// src/config/vendorNavigation.js

/*
 * Configurația STATICĂ a meniului de administrare vendor (drawer-ul
 * deschis din burger în Navbar.jsx). Doar rute reale, deja folosite
 * în aplicație (verificate în App.jsx / CatalogProduse.jsx / Settings.jsx
 * înainte de a fi adăugate aici) - niciuna inventată.
 *
 * Nu conține JSX și nu conține profileLinks dinamice (construite din
 * vServices) - acelea rămân în Navbar.jsx, care le combină cu secțiunea
 * "magazin" de mai jos la momentul randării.
 *
 * `icon` e doar un nume (cheie într-un lookup de componente lucide-react
 * din Navbar.jsx) - nu o referință la componentă, ca fișierul să rămână
 * configurație pură.
 */

export const VENDOR_DASHBOARD_LINK = {
  label: "Dashboard",
  to: "/desktop",
  icon: "LayoutGrid",
};

export const VENDOR_NAV_SECTIONS = [
  {
    key: "magazin",
    label: "Magazine",
    icon: "Store",
    items: [
      /*
       * Audit navigare 2026-09-14: aici era greșit /magazine
       * (directorul PUBLIC de magazine, StoresPage.jsx) - "Magazinele
       * mele" trebuie să ducă la magazinele PROPRII ale vendorului
       * (VendorStoresPage.jsx, acum legată la /vendor/stores).
       */
      { label: "Magazinele mele", to: "/vendor/stores", icon: "Store" },
      { label: "Vizitatori", to: "/vendor/visitors", icon: "Users" },
    ],
  },
  {
    /*
     * Audit navigare 2026-09-14 (corectat) - "Achiziții" e secțiunea
     * cerută explicit de vendor, cu același sistem de
     * acordeon/secțiuni ca restul burgerului (NU link-uri separate de
     * nivel 1 - varianta anterioară a fost respinsă). Rutele deja
     * există, nicio pagină/logică nouă: /vendor/stores (magazinele
     * proprii ale vendorului, nu directorul public /magazine),
     * /servicii-digitale (pagina publică existentă, fosta zonă
     * "Servicii digitale" din vechiul dropdown "Achiziții").
     *
     * FIX (audit 2026-09-23) - "Achiziții > Produse" ducea greșit spre
     * /vendor/catalog (catalogul PROPRIU al vendorului, identic cu
     * "Produse > Catalog produse" de mai jos - secțiunea "Achiziții"
     * e despre ce CUMPĂRĂ vendorul, nu ce vinde). Dusă acum spre
     * pagina publică de produse (/produse, Products.jsx) - același
     * pattern ca intrarea "Produse" din guestNavigation.js.
     */
    key: "achizitii",
    label: "Achiziții",
    icon: "ShoppingBag",
    items: [
      { label: "Produse", to: "/produse", icon: "Package" },
      { label: "Magazine", to: "/vendor/stores", icon: "Store" },
      { label: "Servicii digitale", to: "/servicii-digitale", icon: "Sparkles" },
    ],
  },
  {
    key: "produse",
    label: "Produse",
    icon: "Package",
    items: [
      { label: "Catalog produse", to: "/vendor/catalog?tab=products", icon: "Package" },
      { label: "Importuri", to: "/vendor/catalog?tab=imports", icon: "Upload" },
    ],
  },
  {
    key: "vanzari",
    label: "Vânzări",
    icon: "ShoppingBag",
    items: [
      { label: "Comenzi", to: "/vendor/orders", icon: "ShoppingBag" },
      {
        label: "Planificator comenzi",
        to: "/vendor/orders/planning",
        icon: "CalendarDays",
      },
      { label: "Mesaje", to: "/mesaje", icon: "MessageSquare" },
    ],
  },
  {
    key: "promovare",
    label: "Promovare",
    icon: "Megaphone",
    items: [
      { label: "Colecții", to: "/vendor/catalog?tab=campaigns", icon: "Layers" },
      { label: "Coduri", to: "/vendor/catalog?tab=codes", icon: "Tag" },
      { label: "Recomandări", to: "/vendor/catalog?tab=referrals", icon: "Megaphone" },
      { label: "Promoții", to: "/vendor/catalog?tab=promotions", icon: "Percent" },
    ],
  },
  {
    key: "financiar",
    label: "Financiar",
    icon: "Receipt",
    items: [
      {
        label: "Facturi & încasări",
        to: "/vendor/invoices",
        icon: "Receipt",
      },
      {
        label: "Activare plăți online (Stripe)",
        to: "/setari?tab=payouts",
        icon: "CreditCard",
      },
      { label: "Costuri & profit", to: "/vendor/costs-profit", icon: "TrendingUp" },
    ],
  },
  {
    key: "cont",
    label: "Cont",
    icon: "Settings",
    items: [
      { label: "Setări", to: "/setari", icon: "Settings" },
    ],
  },
  {
    key: "ajutor-legal",
    label: "Ajutor & legal",
    icon: "LifeBuoy",
    items: [
      { label: "Asistență", to: "/vendor/support", icon: "LifeBuoy" },
      {
        label: "Acord vânzători / Termeni vânzători",
        to: "/acord-vanzatori",
        icon: "FileText",
      },
      { label: "Politica de retur", to: "/politica-retur", icon: "FileText" },
      { label: "Anexa expediere", to: "/anexa-expediere", icon: "FileText" },
      { label: "Anexa produse", to: "/anexa-produse", icon: "FileText" },
      {
        label: "Politica de confidențialitate",
        to: "/confidentialitate",
        icon: "FileText",
      },
      /*
       * Audit legal 2026-09-14 - "Politica de cookies" lipsea din
       * burger-ul vendorului deși ruta /cookies există deja (App.jsx,
       * manifest-driven). Adăugată direct aici, fără secțiune nouă.
       */
      {
        label: "Politica de cookies",
        to: "/cookies",
        icon: "FileText",
      },
      /*
       * Audit navigare 2026-09-14 (corectat) - adăugat direct în
       * "Ajutor & legal" (cerut explicit), fără o secțiune nouă
       * "Documente legale". Ruta /termenii-si-conditiile există deja
       * (App.jsx).
       */
      {
        label: "Termeni și condiții",
        to: "/termenii-si-conditiile",
        icon: "FileText",
      },
    ],
  },
];
