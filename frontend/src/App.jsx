import React from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";

/* Pagini publice */
import HomePage from "./pages/HomePage";
import Login from "./pages/LoginForm/Login";
import ForgotPassword from "./pages/LoginForm/Password/ForgotPassword";
import ResetPassword from "./pages/LoginForm/Password/ResetPassowrod";
import RegisterForm from "./pages/RegisterForm/RegisterForm";
import Termeni from "./pages/Termeni/Termeni";
import GDPR from "./pages/PoliticaGDPR/PoliticaGDPR";
import DigitalServicesPage from "./pages/DigitalServicesPage/DigitalServicesPage";

/* Magazine & Produse */
import Magazine from "./pages/Magazine/Magazine/Magazine";
import ProductsPage from "./pages/ProductsPage/ProductsPage";
import DetaliiProdus from "./pages/DetaliiProdus/DetaliiProdus";
import ProfilMagazin from "./pages/Vanzator/VanzatorDashboard/ProfilMagazin";

/* User */
import Wishlist from "./pages/Wishlist/Wishlist";
import Cart from "./pages/Cart/Cart";

/* Vânzător (seller) */
import ProtectedSellerRoute from "./components/ProtectedSellerRoute/ProtectedSellerRoute";
import SellerInfo from "./pages/Seller/onboarding/SellerInfo";
import SellerOnboardingTabs from "./pages/Seller/onboarding/SellerOnboardingTabs";
import CompleteProfile from "./pages/Seller/SellerProfile";
import SendOnboarding from "./pages/Seller/Payments/Payments";
import ContractPage from "./pages/Seller/ContractPage/ContractPage";
import ProduseleMele from "./pages/Vanzator/ProduseleMele/ProduseleMele";
import ComenzileMele from "./pages/Vanzator/ComenzileMele/ComenzileMele";
import Vizitatori from "./pages/Vanzator/Vizitatori/Vizitatori";
import Asistenta from "./pages/Vanzator/Asistenta/Asisitenta";
import Setari from "./pages/Vanzator/Setari/Setari";
import AdaugaProdus from "./pages/Vanzator/AdaugaProdus/AdaugaProdus";
import EditeazaProdus from "./pages/Vanzator/EditeazaProdus/EditeazaProdus";

/* Servicii digitale — invitație instant */
import InvitatieInstantLanding from "./pages/ServiciiDigitale/InvitatieInstant/servcii/InvitationLanding/InvitationLanding";
import InvitatieInstantEditor from "./pages/ServiciiDigitale/InvitatieInstant/servcii/InvitatieInstantEditor/InvitatieInstantEditor";

/* IMPORTANT: importă Providerul din src, nu dintr-un folder extern */
import { InvitationProvider } from "../invitation/InvitationProvider";
import { InvitationsApi } from "@/components/services/invitationsApi";

/* 🔁 Redirect vechiul /search → /produse?q=...  */
function SearchRedirect() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const q = params.get("q") || params.get("search") || "";
  const next = q ? `/produse?q=${encodeURIComponent(q)}` : "/produse";
  return <Navigate to={next} replace />;
}

/* Rută care creează un draft nou și te duce la editor/:id (opțional, dar util) */
function CreateInvitationAndGo() {
  const navigate = useNavigate();
  React.useEffect(() => {
    (async () => {
      try {
        const { id } = await InvitationsApi.createDraft({});
        navigate(`/servicii-digitale/invitatie-instant/editor/${id}`, { replace: true });
      } catch (e) {
        console.error("Creare draft a eșuat:", e);
        navigate("/servicii-digitale/invitatie-instant", { replace: true });
      }
    })();
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<HomePage />} />
      <Route path="/search" element={<SearchRedirect />} />
      <Route path="/magazine" element={<Magazine />} />
      <Route path="/produse" element={<ProductsPage />} />
      <Route path="/produs/:id" element={<DetaliiProdus />} />
      <Route path="/magazin/:handle" element={<ProfilMagazin />} />

      {/* Cont / legal */}
      <Route path="/login" element={<Login />} />
      <Route path="/resetare-parola" element={<ForgotPassword />} />
      <Route path="/resetare-parola/:token" element={<ResetPassword />} />
      <Route path="/inregistrare" element={<RegisterForm />} />
      <Route path="/termeni" element={<Termeni />} />
      <Route path="/gdpr" element={<GDPR />} />

      {/* Servicii digitale */}
      <Route path="/servicii-digitale" element={<DigitalServicesPage />} />
      <Route path="/servicii-digitale/invitatie-instant" element={<InvitatieInstantLanding />} />

      {/* a) Editor cu draft existent */}
      <Route
        path="/servicii-digitale/invitatie-instant/editor/:draftId"
        element={
          <InvitationProvider>
            <InvitatieInstantEditor />
          </InvitationProvider>
        }
      />
      {/* b) Intrare „goală” care creează draft și redirecționează automat */}
      <Route
        path="/servicii-digitale/invitatie-instant/editor"
        element={<CreateInvitationAndGo />}
      />

      {/* User */}
      <Route path="/wishlist" element={<Wishlist />} />
      <Route path="/cos" element={<Cart />} />

      {/* Formulare creare profil vanzator */}
      <Route
        path="/vanzator/informatii"
        element={<ProtectedSellerRoute><SellerInfo /></ProtectedSellerRoute>}
      />
      <Route
        path="/vanzator/onboarding"
        element={<ProtectedSellerRoute><SellerOnboardingTabs /></ProtectedSellerRoute>}
      />

      {/* Seller - protejat */}
      <Route
        path="/vanzator/dashboard"
        element={<ProtectedSellerRoute><ProfilMagazin /></ProtectedSellerRoute>}
      />
      <Route path="/vanzator/completare-profil" element={<CompleteProfile />} />
      <Route path="/vanzator/sendonboarding" element={<SendOnboarding />} />
      <Route path="/vanzator/contract/:id" element={<ContractPage />} />

      <Route
        path="/vanzator/produse"
        element={<ProtectedSellerRoute><ProduseleMele /></ProtectedSellerRoute>}
      />
      <Route
        path="/vanzator/comenzi"
        element={<ProtectedSellerRoute><ComenzileMele /></ProtectedSellerRoute>}
      />
      <Route
        path="/vanzator/vizitatori"
        element={<ProtectedSellerRoute><Vizitatori /></ProtectedSellerRoute>}
      />
      <Route
        path="/vanzator/asistenta"
        element={<ProtectedSellerRoute><Asistenta /></ProtectedSellerRoute>}
      />
      <Route
        path="/vanzator/setari"
        element={<ProtectedSellerRoute><Setari /></ProtectedSellerRoute>}
      />
      <Route
        path="/vanzator/adauga-produs"
        element={<ProtectedSellerRoute><AdaugaProdus /></ProtectedSellerRoute>}
      />
      <Route
        path="/vanzator/editeaza-produs/:id"
        element={<ProtectedSellerRoute><EditeazaProdus /></ProtectedSellerRoute>}
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
