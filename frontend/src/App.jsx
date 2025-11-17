import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useSearchParams,
  useParams
} from "react-router-dom";

import Navbar from "./components/Navbar/Navbar";
import Footer from "./components/Footer/Footer";
import Home from "./pages/Home";

import Termeni from "./pages/Auth/Register/Legal/pages/TermeniiSiConditiile";
import Confidentialitate from "./pages/Auth/Register/Legal/pages/PoliticaDeConfidentialitate";
import Checkout from "./pages/Checkout/Checkout";
import CookiesPolicy from "./pages/CookieBanner/CookiePolicy";
import ReturnPolicy from "./pages/CookieBanner/ReturnPolicy";
import CookiePreferences from "./pages/CookieBanner/CookiePreferences";
import CookieBanner from "./pages/CookieBanner/CookieBanner";

import VendorTerms from "./pages/Auth/Register/Legal/legalVendor/VendorTerms";
import ShippingAddendum from "./pages/Auth/Register/Legal/legalVendor/ShippingAddendum";
import ReturnsPolicy from "./pages/Auth/Register/Legal/legalVendor/ReturnsPolicy";

import Login from "./pages/Auth/Login/Login";
import Register from "./pages/Auth/Register/Register";
import ForgotPassword from "./pages/Auth/ForgotPassword";
import ResetPassword from "./pages/Auth/ResetPassword";

import Desktop from "./pages/Dasboard/Desktop"; // dacă folderul este "Dashboard", corectează aici
import OnboardingServices from "./pages/Vendor/Onboarding/OnBoardingServices/OnBoardingServices";
import OnboardingDetails from "./pages/Vendor/Onboarding/OnBoardingDetails/OnBoardingDetails";

import ProfilMagazin from "./pages/Vendor/ProfilMagazin/ProfilMagazin";
import StoreRedirect from "./pages/Vendor/ProfilMagazin/StoreRedirect";
import DetaliiProdus from "./pages/Vendor/Produse/ProductDetails";
import WishlistPage from "./pages/Wishlist/Wishlist";
import CartPage from "./pages/Cart/Cart";
import VendorVisitorsPage from "./pages/Vendor/Visitors/Visitors";
import MessagesPage from "./pages/Vendor/Mesaje/Messages";
import SupportPage from "./pages/Vendor/Support/Support";
import SettingsPage from "./pages/Vendor/Settings/Settings";
import NotificationsPage from "./pages/Vendor/Notifications/Notifications";
import OrdersPage from "./pages/User/Orders/Orders";
import ProductsPage from "./pages/Products/Products";
import StoresPage from "./pages/Stores/StoresPage";
import AccountPage from "./pages/AccountPage/AccountPage";
import MobileCategories from "./pages/Categories/MobileCategories";
import ShopPlanner from "./pages/Vendor/Planner/ShopPlanner";
import VerifyEmail from "./pages/Auth/VerifyEmail/VerifyEmail";
import VendorOrdersPage from "./pages/Vendor/Orders/Orders";
import OrderDetailsPage from "./pages/Vendor/Orders/OrdersDetailsPage";

import { SEOProvider } from "./components/Seo/SeoProvider";
import { useAuth } from "./pages/Auth/Context/context.js"; // ✅ import corect din context

function ResetOrForgot() {
  const [params] = useSearchParams();
  const token = params.get("token");
  return token ? <ResetPassword /> : <ForgotPassword />;
}

// redirect simplu /@:slug → /magazin/:slug
function AtSlugRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/magazin/${slug}`} replace />;
}

// ✅ Protecție pentru rutele vendor
function RequireVendor({ children }) {
  const { me, loading } = useAuth();
  if (loading) return <div style={{ padding: 24 }}>Se verifică sesiunea…</div>;
  if (!me) return <Navigate to="/autentificare" replace />;
  if (me.role !== "VENDOR") return <Navigate to="/" replace />;
  return children;
}

const ORIGIN =
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "";

export default function App() {
  return (
    <BrowserRouter>
      <SEOProvider
        defaults={{
          siteName: "Artfest",
          baseUrl: ORIGIN || "https://artfest.ro",
          titleTemplate: "%s • Artfest",
          defaultTitle: "Artfest — cadouri și produse artizanale",
          defaultDescription:
            "Descoperă produse unicat create de artizani români pe Artfest.",
          defaultImage: `${ORIGIN}/img/share-fallback.jpg`,
          twitterSite: "@artfest_ro"
        }}
      >
        <Navbar />
        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/termenii-si-conditiile" element={<Termeni />} />
          <Route path="/confidentialitate" element={<Confidentialitate />} />

          {/* Checkout */}
          <Route path="/checkout" element={<Checkout />} />

          {/* Legal */}
          <Route path="/politica-cookie" element={<CookiesPolicy />} />
          <Route path="/politica-de-retur" element={<ReturnPolicy />} />
          <Route path="/cookie-banner" element={<CookieBanner />} />
          <Route path="/preferinte-cookie" element={<CookiePreferences />} />

          {/* User */}
          <Route path="/wishlist" element={<WishlistPage />} />
          <Route path="/cos" element={<CartPage />} />
          <Route path="/comenzile-mele" element={<OrdersPage />} />
          <Route path="/cont" element={<AccountPage />} />

          {/* Auth */}
          <Route path="/autentificare" element={<Login />} />
          <Route path="/inregistrare" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/reset-parola" element={<ResetOrForgot />} />

          {/* Vendor (protejate) */}
          <Route path="/legal/vendor/terms" element={<VendorTerms />} />
          <Route path="/legal/vendor/expediere" element={<ShippingAddendum />} />
          <Route path="/retur" element={<ReturnsPolicy />} />
          <Route path="/desktop" element={<Desktop />} />
          <Route path="/onboarding" element={<OnboardingServices />} />
          <Route path="/onboarding/details" element={<OnboardingDetails />} />
          <Route path="/produs/:id" element={<DetaliiProdus />} />
          <Route path="/vendor/visitors" element={<VendorVisitorsPage />} />
          <Route path="/mesaje" element={<MessagesPage />} />
          <Route path="/asistenta-tehnica" element={<SupportPage />} />
          <Route path="/setari" element={<SettingsPage />} />
          <Route path="/notificari" element={<NotificationsPage />} />
          <Route path="/categorii" element={<MobileCategories />} />
          <Route path="/planner" element={<ShopPlanner />} />

          {/* ✅ Rute protejate pentru comenzi vendor */}
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

          {/* Magazin public */}
          <Route path="/magazin/:slug" element={<ProfilMagazin />} />
          <Route path="/produse" element={<ProductsPage />} />
          <Route path="/magazine" element={<StoresPage />} />

          {/* Shortcut proprietar */}
          <Route path="/vendor/store" element={<StoreRedirect />} />

          {/* Shortlink */}
          <Route path="/@:slug" element={<AtSlugRedirect />} />

          {/* Fallback final */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Footer />
      </SEOProvider>
    </BrowserRouter>
  );
}
