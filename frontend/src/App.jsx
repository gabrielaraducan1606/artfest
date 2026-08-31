// src/App.jsx

import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useSearchParams,
  useParams,
} from "react-router-dom";

import {
  useEffect,
  useState,
  lazy,
  Suspense,
} from "react";

import ScrollToTop from "./components/ScrollToTop.jsx";
import AppLayout from "./components/Navbar/AppLayout.jsx";
import Navbar from "./components/Navbar/Navbar.jsx";

import Home from "./pages/Home";

import Checkout from "./pages/Checkout/Checkout";
import ThankYou from "./pages/Checkout/Thankyou.jsx";

import CookiesPolicy from "./pages/CookieBanner/CookiePolicy";
import ReturnPolicy from "./pages/CookieBanner/ReturnPolicy";
import CookiePreferences from "./pages/CookieBanner/CookiePreferences";
import CookieBanner from "./pages/CookieBanner/CookieBanner";

import PublicCollectionPage from "./pages/Collections/PublicCollections.jsx";
import PublicCampaignPage from "./pages/Campaigns/PublicCampaignPage.jsx";
import PublicInfluencerCollectionPage
  from "./pages/Influencer/PublicInfluencerCollectionPage/PublicInfluencerCollectionPage.jsx";
import Login from "./pages/Auth/Login/Login";
import Register from "./pages/Auth/Register/Register";
import ForgotPassword from "./pages/Auth/ForgotPassword";
import ResetPassword from "./pages/Auth/ResetPassword";
import VerifyEmail from "./pages/Auth/VerifyEmail/VerifyEmail";

import Desktop from "./pages/Dasboard/Desktop";

import OnboardingServices from "./pages/Vendor/Onboarding/OnBoardingServices/OnBoardingServices";
import OnboardingDetails from "./pages/Vendor/Onboarding/OnBoardingDetails/OnBoardingDetails";

// Lazy - profil magazin public, fișier mare; nu are ce căuta în
// bundle-ul inițial al Products/Home. Prefetch-uit explicit la
// hover/focus/touch pe cardul magazinului sau pe linkul vânzătorului
// din ProductDetails.
const ProfilMagazin = lazy(() =>
  import("./pages/Vendor/ProfilMagazin/ProfilMagazin")
);
import StoreRedirect from "./pages/Vendor/ProfilMagazin/StoreRedirect";
// Lazy - fișier mare (4700+ linii); nu are ce căuta în bundle-ul
// inițial al paginii Produse. Prefetch-uit explicit la hover/focus
// pe ProductCard, ca tranziția să rămână instantă în fluxul normal.
const DetaliiProdus = lazy(() =>
  import("./pages/Vendor/Produse/ProductDetails")
);

import WishlistPage from "./pages/Wishlist/Wishlist";
import CartPage from "./pages/Cart/Cart";

import VendorVisitorsPage from "./pages/Vendor/Visitors/Visitors";
import VendorMessagesPage from "./pages/Vendor/Mesaje/Messages.jsx";
import UserMessagesPage from "./pages/User/Messages/UserMessages.jsx";

import VendorSupportPage from "./pages/Vendor/VendorSupport/VendorSupportPage.jsx";
import UserSupportPage from "./pages/User/UserSupport/UserSupportPage.jsx";
import GuestSupportPage from "./pages/Guest/GuestSupport/GuestSupportPage.jsx";
import AdminSupportPage from "./pages/Admin/AdminSupport/AdminSupportPage.jsx";

import GuestOrderPage from "./pages/Guest/GuestOrder/GuestOrder.jsx";

import SettingsPage from "./pages/Vendor/Settings/Settings";
import NotificationsPage from "./pages/Vendor/Notifications/Notifications";

import OrdersPage from "./pages/User/Orders/UserOrders.jsx";
import MyOrderDetailsPage from "./pages/User/Orders/UserOrderDetails.jsx";

const VendorOrdersPlanningPage = lazy(() =>
  import("./pages/Vendor/Orders/VendorOrdersPlaningPage.jsx")
);
import ProductsPage from "./pages/Products/Products";
import StoresPage from "./pages/Stores/StoresPage";
import AccountPage from "./pages/AccountPage/AccountPage";
import MobileCategories from "./pages/Categories/MobileCategories";

const ShopPlanner = lazy(() =>
  import("./pages/Vendor/Planner/ShopPlanner")
);

import VendorOrdersPage from "./pages/Vendor/Orders/Orders";
// Lazy - fișier mare (2500+ linii); prefetch-uit explicit la
// hover/focus/touch pe un rând din tabelul de comenzi, ca navigarea
// efectivă să nu mai aștepte descărcarea codului paginii.
const OrderDetailsPage = lazy(() =>
  import("./pages/Vendor/Orders/OrdersDetailsPage")
);

const VendorHomepagePromotions = lazy(() =>
  import("./pages/Vendor/Promotions/VendorPromotions.jsx")
);
import CatalogProdusePage from "./pages/Vendor/CatalogProduse/CatalogProduse.jsx";

const VendorInvoicesPage = lazy(() =>
  import("./pages/Vendor/Invoices/InvoicePage.jsx")
);
const CostLibraryPage = lazy(() =>
  import("./pages/Vendor/CostsProfit/CostLibraryPage.jsx")
);
const ProfitabilityPage = lazy(() =>
  import("./pages/Vendor/CostsProfit/ProfitabilityPage.jsx")
);
const ProductCostingDetailPage = lazy(() =>
  import("./pages/Vendor/CostsProfit/ProductCostingDetailPage.jsx")
);
const UserInvoicesPage = lazy(() =>
  import("./pages/User/Invoices/UserInvoicesPage")
);

import UserDesktop from "./pages/User/UserDesktop/UserDesktop.jsx";

const AdminDesktop = lazy(() =>
  import("./pages/Admin/AdminDesktop/AdminDesktop.jsx")
);
const AdminMarketingPage = lazy(() =>
  import("./pages/Admin/AdminMarketing/AdminMarketingPage.jsx")
);
const AdminMaintenance = lazy(() =>
  import("./pages/Admin/AdminMaintenance/AdminMaintenancePage.jsx")
);
const AdminVendorPlansPage = lazy(() =>
  import("./pages/Admin/AdminVendorPlansPage/AdminVendorPlansPage.jsx")
);
const AdminPickupsPage = lazy(() =>
  import("./pages/Admin/AdminPickupsPage/AdminPickupsPage.jsx")
);
const AdminBillingToClientPage = lazy(() =>
  import("./pages/Admin/AdminBillingToClient/AdminBillingToClient.jsx")
);

import CategoryPage from "./pages/CategoryPage/CategoryPage.jsx";
const RouteIncidentsPage = lazy(() =>
  import("./pages/Admin/AdminIncidentsPage/AdminIncidentsPage.jsx")
);

import UserSettingsPage from "./pages/User/UserSettings/UserSettingsPage.jsx";
import UserNotificationsPage from "./pages/User/Notification/UserNotaificationPage.jsx";

import AmbassadorsPage from "./pages/Home/AmbassadorPage/AmbassadorPage.jsx";
import ServiciiDigitale from "./pages/ServiciiDigitale/ServiciiDigitale.jsx";
import CustomerRequestDetailsPage
  from "./pages/Home/CustomerRequestsSection/CustomerRequestDetailsPage.jsx";
  import CustomerRequestsPage
  from "./pages/Home/CustomerRequestsSection/CustomerRequestsPage.jsx";

  import InfluencerRegisterPage from "./pages/Influencer/InfluencerRegisterPage.jsx";
import InfluencerDashboardPage from "./pages/Influencer/InfluencerDashboardPage/InfluencerDashboardPage.jsx";
import {
  SEOProvider,
} from "./components/Seo/SeoProvider";

import {
  useAuth,
} from "./pages/Auth/Context/context.js";

/* ================= Helpers ================= */

function ResetOrForgot() {
  const [params] =
    useSearchParams();

  const token =
    params.get("token");

  return token
    ? <ResetPassword />
    : <ForgotPassword />;
}

function AtSlugRedirect() {
  const { slug } =
    useParams();

  return (
    <Navigate
      to={`/magazin/${slug}`}
      replace
    />
  );
}

function getLegalBase() {
  return (
    import.meta.env.VITE_API_URL ||
    window.location.origin
  )
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
}

function LegalHtmlRoute({
  path,
  title,
}) {
  const [html, setHtml] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [err, setErr] =
    useState("");

  useEffect(() => {
    const ctrl =
      new AbortController();

    async function load() {
      try {
        setLoading(true);
        setErr("");

        const res =
          await fetch(
            `${getLegalBase()}${path}`,
            {
              signal:
                ctrl.signal,

              credentials:
                "include",
            }
          );

        if (!res.ok) {
          throw new Error(
            `HTTP ${res.status}`
          );
        }

        const text =
          await res.text();

        setHtml(text);
      } catch (e) {
        if (
          e.name ===
          "AbortError"
        ) {
          return;
        }

        setErr(
          `Nu am putut încărca ${title}.`
        );
      } finally {
        setLoading(false);
      }
    }

    load();

    return () =>
      ctrl.abort();
  }, [path, title]);

  if (loading) {
    return (
      <div
        style={{
          padding: 24,
        }}
      >
        Se încarcă…
      </div>
    );
  }

  if (err) {
    return (
      <div
        style={{
          padding: 24,
        }}
      >
        {err}
      </div>
    );
  }

  return (
    <section
      style={{
        maxWidth: 900,
        margin: "40px auto",
        padding: "0 16px",
      }}
    >
      <div
        dangerouslySetInnerHTML={{
          __html: html,
        }}
      />
    </section>
  );
}

/* ================= Guards ================= */

function RequireUser({
  children,
}) {
  const {
    me,
    loading,
  } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          padding: 24,
        }}
      >
        Se verifică sesiunea…
      </div>
    );
  }

  if (!me) {
    return (
      <Navigate
        to="/autentificare"
        replace
      />
    );
  }

  if (
    me.role !==
    "USER"
  ) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  return children;
}

function RequireAuthenticated({
  children,
}) {
  const {
    me,
    loading,
  } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          padding: 24,
        }}
      >
        Se verifică sesiunea…
      </div>
    );
  }

  if (!me) {
    return (
      <Navigate
        to="/autentificare"
        replace
      />
    );
  }

  return children;
}

function RequireVendor({
  children,
}) {
  const {
    me,
    loading,
  } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          padding: 24,
        }}
      >
        Se verifică sesiunea…
      </div>
    );
  }

  if (!me) {
    return (
      <Navigate
        to="/autentificare"
        replace
      />
    );
  }

  if (
    me.role !==
    "VENDOR"
  ) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  return children;
}

function RequireAdmin({
  children,
}) {
  const {
    me,
    loading,
  } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          padding: 24,
        }}
      >
        Se verifică sesiunea…
      </div>
    );
  }

  if (!me) {
    return (
      <Navigate
        to="/autentificare"
        replace
      />
    );
  }

  if (
    me.role !==
    "ADMIN"
  ) {
    return (
      <Navigate
        to="/"
        replace
      />
    );
  }

  return children;
}

/* ================= Admin layout ================= */

function AdminLayout() {
  return (
    <>
      <Navbar />
      <Outlet />
    </>
  );
}

/* ================= SEO const ================= */

const ORIGIN =
  typeof window !==
    "undefined" &&
  window.location?.origin
    ? window.location.origin
    : "";

/* ================= App ================= */

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />

      <SEOProvider
        defaults={{
          siteName:
            "Artfest",

          baseUrl:
            ORIGIN ||
            "https://artfest.ro",

          titleTemplate:
            "%s • Artfest",

          defaultTitle:
            "Artfest — cadouri și produse artizanale",

          defaultDescription:
            "Descoperă produse unicat create de artizani români pe Artfest.",

          defaultImage:
            `${ORIGIN}/img/share-fallback.jpg`,

          twitterSite:
            "@artfest_ro",
        }}
      >
        <Suspense fallback={null}>
        <Routes>
          {/* ================= PUBLIC / USER / VENDOR ================= */}

          <Route
            element={
              <AppLayout />
            }
          >
            {/* Public */}

            <Route
              path="/"
              element={
                <Home />
              }
            />

            <Route
  path="/cereri"
  element={
    <CustomerRequestsPage />
  }
/>

<Route
  path="/cereri/:id"
  element={
    <CustomerRequestDetailsPage />
  }
/>
            <Route
              path="/comanda-guest/:id"
              element={
                <GuestOrderPage />
              }
            />

            {/* Checkout */}

            <Route
              path="/checkout"
              element={
                <Checkout />
              }
            />

            <Route
              path="/multumim"
              element={
                <ThankYou />
              }
            />

            {/* Legal */}

            <Route
              path="/politica-cookie"
              element={
                <CookiesPolicy />
              }
            />

            <Route
              path="/politica-de-retur"
              element={
                <ReturnPolicy />
              }
            />

            <Route
              path="/preferinte-cookie"
              element={
                <CookiePreferences />
              }
            />

            <Route
              path="/colectii/:slug"
              element={
                <PublicCollectionPage />
              }
            />

            <Route
              path="/c/:slug"
              element={
                <PublicCampaignPage />
              }
            />
<Route
  path="/selectii/:slug"
  element={
    <PublicInfluencerCollectionPage />
  }
/>
            <Route
              path="/confidentialitate"
              element={
                <LegalHtmlRoute
                  path="/legal/privacy.html"
                  title="politica de confidențialitate"
                />
              }
            />

            <Route
              path="/termenii-si-conditiile"
              element={
                <LegalHtmlRoute
                  path="/legal/tos.html"
                  title="termenii și condițiile"
                />
              }
            />

            <Route
              path="/acord-vanzatori"
              element={
                <LegalHtmlRoute
                  path="/legal/vendor_terms.html"
                  title="acordul pentru vânzători"
                />
              }
            />

            <Route
              path="/politica-retur"
              element={
                <LegalHtmlRoute
                  path="/legal/returns_policy_ack.html"
                  title="politica de retur"
                />
              }
            />

            <Route
              path="/anexa-expediere"
              element={
                <LegalHtmlRoute
                  path="/legal/shipping_addendum.html"
                  title="anexa de expediere"
                />
              }
            />

            <Route
              path="/anexa-produse"
              element={
                <LegalHtmlRoute
                  path="/legal/products_addendum.html"
                  title="anexa produse"
                />
              }
            />

            <Route
              path="/cookies"
              element={
                <LegalHtmlRoute
                  path="/legal/cookies.html"
                  title="politica cookies"
                />
              }
            />

            {/* Servicii digitale */}

            <Route
              path="/servicii-digitale"
              element={
                <ServiciiDigitale />
              }
            />

            {/* Auth */}

            <Route
              path="/autentificare"
              element={
                <Login />
              }
            />

            <Route
              path="/inregistrare"
              element={
                <Register />
              }
            />

<Route
  path="/influencer/register"
  element={<InfluencerRegisterPage />}
/>
<Route
  path="/influencer"
  element={<InfluencerDashboardPage />}
/>
            <Route
              path="/verify-email"
              element={
                <VerifyEmail />
              }
            />

            <Route
              path="/reset-parola"
              element={
                <ResetOrForgot />
              }
            />

            {/* User */}

            <Route
              path="/wishlist"
              element={
                <WishlistPage />
              }
            />

            <Route
              path="/cos"
              element={
                <CartPage />
              }
            />

            <Route
              path="/comenzile-mele"
              element={
                <RequireAuthenticated>
                  <OrdersPage />
                </RequireAuthenticated>
              }
            />

            <Route
              path="/comanda/:id"
              element={
                <RequireAuthenticated>
                  <MyOrderDetailsPage />
                </RequireAuthenticated>
              }
            />

            <Route
              path="/cont"
              element={
                <AccountPage />
              }
            />

            <Route
              path="/cont/setari"
              element={
                <UserSettingsPage />
              }
            />

            <Route
              path="/notificari"
              element={
                <UserNotificationsPage />
              }
            />

            <Route
              path="/cont/mesaje"
              element={
                <RequireUser>
                  <UserMessagesPage />
                </RequireUser>
              }
            />

            <Route
              path="/desktop-user"
              element={
                <UserDesktop />
              }
            />

            <Route
              path="/ambasadori"
              element={
                <AmbassadorsPage />
              }
            />

            {/* Vendor */}

            <Route
              path="/desktop"
              element={
                <RequireVendor>
                  <Desktop />
                </RequireVendor>
              }
            />

            <Route
              path="/vendor/catalog"
              element={
                <RequireVendor>
                  <CatalogProdusePage />
                </RequireVendor>
              }
            />

            <Route
              path="/vendor/costs-profit"
              element={
                <RequireVendor>
                  <ProfitabilityPage />
                </RequireVendor>
              }
            />

            <Route
              path="/vendor/costs-profit/library"
              element={
                <RequireVendor>
                  <CostLibraryPage />
                </RequireVendor>
              }
            />

            <Route
              path="/vendor/costs-profit/:productId"
              element={
                <RequireVendor>
                  <ProductCostingDetailPage />
                </RequireVendor>
              }
            />

            <Route
              path="/onboarding"
              element={
                <RequireVendor>
                  <OnboardingServices />
                </RequireVendor>
              }
            />

            <Route
              path="/onboarding/details"
              element={
                <RequireVendor>
                  <OnboardingDetails />
                </RequireVendor>
              }
            />

            <Route
              path="/produs/:id"
              element={
                <DetaliiProdus />
              }
            />

            <Route
              path="/vendor/visitors"
              element={
                <RequireVendor>
                  <VendorVisitorsPage />
                </RequireVendor>
              }
            />

            <Route
              path="/mesaje"
              element={
                <RequireVendor>
                  <VendorMessagesPage />
                </RequireVendor>
              }
            />

            <Route
              path="/vendor/support"
              element={
                <RequireVendor>
                  <VendorSupportPage />
                </RequireVendor>
              }
            />

            <Route
              path="/setari"
              element={
                <RequireVendor>
                  <SettingsPage />
                </RequireVendor>
              }
            />

            <Route
              path="/vendor/notifications"
              element={
                <RequireVendor>
                  <NotificationsPage />
                </RequireVendor>
              }
            />

            <Route
              path="/vendor/promovari"
              element={
                <VendorHomepagePromotions />
              }
            />

            <Route
              path="/planner"
              element={
                <RequireVendor>
                  <ShopPlanner />
                </RequireVendor>
              }
            />

            {/* Facturi */}

            <Route
              path="/facturi"
              element={
                <UserInvoicesPage />
              }
            />

            <Route
              path="/vendor/invoices"
              element={
                <RequireVendor>
                  <VendorInvoicesPage />
                </RequireVendor>
              }
            />

            {/* Comenzi vendor */}

            <Route
              path="/vendor/orders"
              element={
                <RequireVendor>
                  <VendorOrdersPage />
                </RequireVendor>
              }
            />

            <Route
              path="/vendor/orders/:id"
              element={
                <RequireVendor>
                  <OrderDetailsPage />
                </RequireVendor>
              }
            />

            <Route
              path="/vendor/orders/planning"
              element={
                <RequireVendor>
                  <VendorOrdersPlanningPage />
                </RequireVendor>
              }
            />

            {/* Magazin public */}

            <Route
              path="/magazin/:slug"
              element={
                <ProfilMagazin />
              }
            />

            <Route
              path="/produse"
              element={
                <ProductsPage />
              }
            />

            <Route
              path="/magazine"
              element={
                <StoresPage />
              }
            />

            <Route
              path="/vendor/store"
              element={
                <RequireVendor>
                  <StoreRedirect />
                </RequireVendor>
              }
            />

            <Route
              path="/categorii"
              element={
                <MobileCategories />
              }
            />

            <Route
              path="/@:slug"
              element={
                <AtSlugRedirect />
              }
            />

            <Route
              path="/categorii/:slug"
              element={
                <CategoryPage />
              }
            />

            {/* Support */}

            <Route
              path="/account/support"
              element={
                <RequireUser>
                  <UserSupportPage />
                </RequireUser>
              }
            />

            <Route
              path="/account/support/tickets/:ticketId"
              element={
                <RequireUser>
                  <UserSupportPage />
                </RequireUser>
              }
            />

            <Route
              path="/support"
              element={
                <GuestSupportPage />
              }
            />

            {/* Fallback */}

            <Route
              path="*"
              element={
                <Navigate
                  to="/"
                  replace
                />
              }
            />
          </Route>

          {/* ================= ADMIN ================= */}

          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route
              index
              element={
                <AdminDesktop />
              }
            />

            <Route
              path="marketing"
              element={
                <AdminMarketingPage />
              }
            />

            <Route
              path="support"
              element={
                <AdminSupportPage />
              }
            />

            <Route
              path="maintenance"
              element={
                <AdminMaintenance />
              }
            />

            <Route
              path="incidents"
              element={
                <RouteIncidentsPage />
              }
            />

            <Route
              path="vendor-plans"
              element={
                <AdminVendorPlansPage />
              }
            />

            <Route
              path="pickups"
              element={
                <AdminPickupsPage />
              }
            />

            <Route
              path="billing"
              element={
                <AdminBillingToClientPage />
              }
            />
          </Route>
        </Routes>
        </Suspense>

        {/* Banner global, disponibil pe orice rută */}
        <CookieBanner />
      </SEOProvider>
    </BrowserRouter>
  );
}