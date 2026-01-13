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

import ScrollToTop from "./components/ScrollToTop.jsx";
import AppLayout from "./components/Navbar/AppLayout.jsx";
import Navbar from "./components/Navbar/Navbar.jsx"; // folosit în AdminLayout (opțional)

import Home from "./pages/Home";

import Checkout from "./pages/Checkout/Checkout";
import ThankYou from "./pages/Checkout/Thankyou.jsx";

import CookiesPolicy from "./pages/CookieBanner/CookiePolicy";
import ReturnPolicy from "./pages/CookieBanner/ReturnPolicy";
import CookiePreferences from "./pages/CookieBanner/CookiePreferences";
import CookieBanner from "./pages/CookieBanner/CookieBanner";

import Login from "./pages/Auth/Login/Login";
import Register from "./pages/Auth/Register/Register";
import ForgotPassword from "./pages/Auth/ForgotPassword";
import ResetPassword from "./pages/Auth/ResetPassword";
import VerifyEmail from "./pages/Auth/VerifyEmail/VerifyEmail";

import Desktop from "./pages/Dasboard/Desktop";
import OnboardingServices from "./pages/Vendor/Onboarding/OnBoardingServices/OnBoardingServices";
import OnboardingDetails from "./pages/Vendor/Onboarding/OnBoardingDetails/OnBoardingDetails";

import ProfilMagazin from "./pages/Vendor/ProfilMagazin/ProfilMagazin";
import StoreRedirect from "./pages/Vendor/ProfilMagazin/StoreRedirect";
import DetaliiProdus from "./pages/Vendor/Produse/ProductDetails";

import WishlistPage from "./pages/Wishlist/Wishlist";
import CartPage from "./pages/Cart/Cart";

import VendorVisitorsPage from "./pages/Vendor/Visitors/Visitors";
import VendorMessagesPage from "./pages/Vendor/Mesaje/Messages.jsx";
import UserMessagesPage from "./pages/User/Messages/UserMessages.jsx";

import VendorSupportPage from "./pages/Vendor/VendorSupport/VendorSupportPage.jsx";
import UserSupportPage from "./pages/User/UserSupport/UserSupportPage.jsx";
import GuestSupportPage from "./pages/Guest/GuestSupport/GuestSupportPage.jsx";
import AdminSupportPage from "./pages/Admin/AdminSupport/AdminSupportPage.jsx";

import SettingsPage from "./pages/Vendor/Settings/Settings";
import NotificationsPage from "./pages/Vendor/Notifications/Notifications";

import OrdersPage from "./pages/User/Orders/UserOrders.jsx";
import MyOrderDetailsPage from "./pages/User/Orders/UserOrderDetails.jsx";

import VendorOrdersPlanningPage from "./pages/Vendor/Orders/VendorOrdersPlaningPage.jsx";
import ProductsPage from "./pages/Products/Products";
import StoresPage from "./pages/Stores/StoresPage";
import AccountPage from "./pages/AccountPage/AccountPage";
import MobileCategories from "./pages/Categories/MobileCategories";

import ShopPlanner from "./pages/Vendor/Planner/ShopPlanner";

import VendorOrdersPage from "./pages/Vendor/Orders/Orders";
import OrderDetailsPage from "./pages/Vendor/Orders/OrdersDetailsPage";

import VendorInvoicesPage from "./pages/Vendor/Invoices/InvoicePage.jsx";
import UserInvoicesPage from "./pages/User/Invoices/UserInvoicesPage";
import UserDesktop from "./pages/User/UserDesktop/UserDesktop.jsx";

import AdminDesktop from "./pages/Admin/AdminDesktop/AdminDesktop.jsx";
import AdminMarketingPage from "./pages/Admin/AdminMarketing/AdminMarketingPage.jsx";
import AdminMaintenance from "./pages/Admin/AdminMaintenance/AdminMaintenancePage.jsx";
import RouteIncidentsPage from "./pages/Admin/AdminIncidentsPage/AdminIncidentsPage.jsx";

import UserSettingsPage from "./pages/User/UserSettings/UserSettingsPage.jsx";
import UserNotificationsPage from "./pages/User/Notification/UserNotaificationPage.jsx";

import ServiciiDigitale from "./pages/ServiciiDigitale/ServiciiDigitale.jsx";

import { SEOProvider } from "./components/Seo/SeoProvider";
import { useAuth } from "./pages/Auth/Context/context.js";

/* ================= Helpers ================= */
function ResetOrForgot() {
  const [params] = useSearchParams();
  const token = params.get("token");
  return token ? <ResetPassword /> : <ForgotPassword />;
}

function AtSlugRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/magazin/${slug}`} replace />;
}

/* ================= Guards ================= */
function RequireUser({ children }) {
  const { me, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Se verifică sesiunea…</div>;
  if (!me) return <Navigate to="/autentificare" replace />;
  if (me.role !== "USER") return <Navigate to="/" replace />;
  return children;
}

function RequireVendor({ children }) {
  const { me, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Se verifică sesiunea…</div>;
  if (!me) return <Navigate to="/autentificare" replace />;
  if (me.role !== "VENDOR") return <Navigate to="/" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { me, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Se verifică sesiunea…</div>;
  if (!me) return <Navigate to="/autentificare" replace />;
  if (me.role !== "ADMIN") return <Navigate to="/" replace />;
  return children;
}

/* ================= Admin layout =================
   - îl poți lăsa fără Footer (de obicei așa e mai ok pentru admin)
   - Navbar știe singur să arate “admin navbar” pe /admin/*
*/
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
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "";

/* ================= App ================= */
export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />

      <SEOProvider
        defaults={{
          siteName: "Artfest",
          baseUrl: ORIGIN || "https://artfest.ro",
          titleTemplate: "%s • Artfest",
          defaultTitle: "Artfest — cadouri și produse artizanale",
          defaultDescription:
            "Descoperă produse unicat create de artizani români pe Artfest.",
          defaultImage: `${ORIGIN}/img/share-fallback.jpg`,
          twitterSite: "@artfest_ro",
        }}
      >
        <Routes>
          {/* ================= PUBLIC / USER / VENDOR (cu Navbar+Footer) ================= */}
          <Route element={<AppLayout />}>
            {/* Public */}
            <Route path="/" element={<Home />} />

            {/* Checkout */}
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/multumim" element={<ThankYou />} />

            {/* Legal */}
            <Route path="/politica-cookie" element={<CookiesPolicy />} />
            <Route path="/politica-de-retur" element={<ReturnPolicy />} />
            <Route path="/cookie-banner" element={<CookieBanner />} />
            <Route path="/preferinte-cookie" element={<CookiePreferences />} />

            {/* Servicii digitale */}
            <Route path="/servicii-digitale" element={<ServiciiDigitale />} />

            {/* Auth */}
            <Route path="/autentificare" element={<Login />} />
            <Route path="/inregistrare" element={<Register />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/reset-parola" element={<ResetOrForgot />} />

            {/* User (unele sunt publice la tine, păstrez exact ca ai scris) */}
            <Route path="/wishlist" element={<WishlistPage />} />
            <Route path="/cos" element={<CartPage />} />
            <Route
  path="/comenzile-mele"
  element={
    <RequireUser>
      <OrdersPage />
    </RequireUser>
  }
/>

<Route
  path="/comanda/:id"
  element={
    <RequireUser>
      <MyOrderDetailsPage />
    </RequireUser>
  }
/>

            <Route path="/cont" element={<AccountPage />} />
            <Route path="/cont/setari" element={<UserSettingsPage />} />
            <Route path="/notificari" element={<UserNotificationsPage />} />

            <Route
              path="/cont/mesaje"
              element={
                <RequireUser>
                  <UserMessagesPage />
                </RequireUser>
              }
            />
            <Route path="/desktop-user" element={<UserDesktop />} />

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

            <Route path="/produs/:id" element={<DetaliiProdus />} />

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
              path="/planner"
              element={
                <RequireVendor>
                  <ShopPlanner />
                </RequireVendor>
              }
            />

            {/* Facturi */}
            <Route path="/facturi" element={<UserInvoicesPage />} />
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
            <Route path="/magazin/:slug" element={<ProfilMagazin />} />
            <Route path="/produse" element={<ProductsPage />} />
            <Route path="/magazine" element={<StoresPage />} />

            <Route
              path="/vendor/store"
              element={
                <RequireVendor>
                  <StoreRedirect />
                </RequireVendor>
              }
            />

            <Route path="/categorii" element={<MobileCategories />} />
            <Route path="/@:slug" element={<AtSlugRedirect />} />

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
            <Route path="/support" element={<GuestSupportPage />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>

          {/* ================= ADMIN (layout separat) ================= */}
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<AdminDesktop />} />
            <Route path="marketing" element={<AdminMarketingPage />} />
            <Route path="support" element={<AdminSupportPage />} />
            <Route path="maintenance" element={<AdminMaintenance />} />
            <Route path="incidents" element={<RouteIncidentsPage />} />
          </Route>
        </Routes>
      </SEOProvider>
    </BrowserRouter>
  );
}
