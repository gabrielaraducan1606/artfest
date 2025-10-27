// client/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, useSearchParams, useParams } from "react-router-dom";

import Navbar from "./components/Navbar/Navbar";
import Footer from "./components/Footer/Footer"; 
import Home from "./pages/Home";

import Termeni from "./pages/Auth/Register/Legal/pages/TermeniiSiConditiile";
import Confidentialitate from "./pages/Auth/Register/Legal/pages/PoliticaDeConfidentialitate";
import Checkout from "./pages/Checkout/Checkout";         // ⬅ nou
import CookiesPolicy from "./pages/CookieBanner/CookiePolicy";   // ⬅ nou
import ReturnPolicy from "./pages/CookieBanner/ReturnPolicy";     // ⬅ nou
import CookiePreferences from "./pages/CookieBanner/CookiePreferences"; // ⬅ nou
import CookieBanner from "./pages/CookieBanner/CookieBanner"; // ⬅ nou

import VendorTerms from "./pages/Auth/Register/Legal/legalVendor/VendorTerms";
import ShippingAddendum from "./pages/Auth/Register/Legal/legalVendor/ShippingAddendum";
import ReturnsPolicy from "./pages/Auth/Register/Legal/legalVendor/ReturnsPolicy";

import Login from "./pages/Auth/Login/Login";
import Register from "./pages/Auth/Register/Register";
import ForgotPassword from "./pages/Auth/ForgotPassword";
import ResetPassword from "./pages/Auth/ResetPassword";

import Desktop from "./pages/Dasboard/Desktop";
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

// import Furnizori from "./pages/Furnizori";
// import Despre from "./pages/Despre";

function ResetOrForgot() {
  const [params] = useSearchParams();
  const token = params.get("token");
  return token ? <ResetPassword /> : <ForgotPassword />;
}

// (opțional) front-only shortlink: /@:slug -> /magazin/:slug
function AtSlugRedirect() {
  const { slug } = useParams();
  return <Navigate to={`/magazin/${slug}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Navbar />

      <Routes>
        {/* Public */}
        <Route path="/" element={<Home />} />
        {/* <Route path="/furnizori" element={<Furnizori />} /> */}
        {/* <Route path="/despre" element={<Despre />} /> */}
        <Route path="/termenii-si-conditiile" element={<Termeni />} />
      <Route path="/confidentialitate" element={<Confidentialitate />} />
       {/* Checkout (utilizator logat; Cart deja redirecționează spre login dacă nu) */}
        <Route path="/checkout" element={<Checkout />} />

        {/* Legal */}
        <Route path="/politica-cookie" element={<CookiesPolicy />} />
        <Route path="/politica-de-retur" element={<ReturnPolicy />} />
<Route path="/cookie-banner" element={<CookieBanner />} />
        {/* Preferințe cookie – panou de consimțământ */}
        <Route path="/preferinte-cookie" element={<CookiePreferences />} />

       <Route path="/wishlist" element={<WishlistPage />} />
        <Route path="/cos" element={<CartPage />} />
        {/* Auth */}
        <Route path="/autentificare" element={<Login />} />
        <Route path="/inregistrare" element={<Register />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/reset-parola" element={<ResetOrForgot />} />

        {/* Vendor */}
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
        <Route path="/cont" element={<AccountPage />} />
        <Route path="/categorii" element={<MobileCategories />} />
<Route path="/planner" element={<ShopPlanner />} />

        {/* Magazin public */}
        <Route path="/magazin/:slug" element={<ProfilMagazin />} />
        
        <Route path="/comenzile-mele" element={<OrdersPage />} />
        <Route path="/produse" element={<ProductsPage />} />
        <Route path="/magazine" element={<StoresPage />} />
        
        {/* Shortcut proprietar */}
        <Route path="/vendor/store" element={<StoreRedirect />} />

        {/* (opțional) shortlink */}
        <Route path="/@:slug" element={<AtSlugRedirect />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer />
    </BrowserRouter>
  );
}
