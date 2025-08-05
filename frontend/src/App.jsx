import React from "react";
import { Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import Login from "../src/pages/LoginForm/Login"; 
import RegisterForm from "../src/pages/RegisterForm/RegisterForm"; 
import Termeni from "../src/pages/Termeni/Termeni";
import GDPR from "./pages/PoliticaGDPR/PoliticaGDPR";
import SellerDashboard from './pages/Vanzator/VanzatorDashboard/VanzatorDashboard';
import CompleteProfile from './pages/Seller/SellerProfile';
import SendOnboarding from "./pages/Seller/Payments/Payments";
import ContractPage from "./pages/Seller/ContractPage/ContractPage";
import ProduseleMele from "./pages/Vanzator/ProduseleMele/ProduseleMele";
import ComenzileMele from "./pages/Vanzator/ComenzileMele/ComenzileMele";
import Vizitatori from "./pages/Vanzator/Vizitatori/Vizitatori";
import Asistenta from "./pages/Vanzator/Asistenta/Asisitenta";
import Setari from "./pages/Vanzator/Setari/Setari";
import ProtectedSellerRoute from "./components/ProtectedSellerRoute/ProtectedSellerRoute";
import AdaugaProdus from "./pages/Vanzator/AdaugaProdus/AdaugaProdus";
import EditeazaProdus from "./pages/Vanzator/EditeazaProdus/EditeazaProdus";
import VanzatorDashboard from "./pages/Vanzator/VanzatorDashboard/VanzatorDashboard";
import DetaliiProdus from "./pages/DetaliiProdus/DetaliiProdus";
import Wishlist from "./pages/Wishlist/Wishlist";
import Cart from "./pages/Cart/Cart";
import Magazine from "./pages/Magazine/Magazine/Magazine";
import PublicMagazin from "./pages/Magazine/ProfilMagazinPublic/ProfilMagazinPublic";
import ProductsPage from "./pages/ProductsPage/ProductsPage";

import InvitatieInstantLanding from "./pages/ServiciiDigitale/InvitatieInstant/servcii/InvitationLanding/InvitationLanding";
import InvitatieInstantEditor from "./pages/ServiciiDigitale/InvitatieInstant/servcii/InvitatieInstantEditor/InvitatieInstantEditor";
import { InvitationProvider } from "../invitation/InvitationProvider";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/inregistrare" element={<RegisterForm />} />
      <Route path="/termeni" element={<Termeni />} />
      <Route path="/gdpr" element={<GDPR />} />
       <Route path="/vanzator/completare-profil" element={<CompleteProfile />} />
       <Route path="/vanzator/sendonboarding" element={<SendOnboarding />} />
       <Route path="/vanzator/dashboard" element={<VanzatorDashboard />} />
       <Route path="/vanzator/contract/:id" element={<ContractPage />} />
       <Route path="/produs/:id" element={<DetaliiProdus />} />
       <Route path="/cos" element={<Cart />} />
      <Route path="/wishlist" element={<Wishlist />} />
      <Route path="/magazine" element={<Magazine />} />
      <Route path="/magazin/:id" element={<PublicMagazin />} />
      <Route path="/produse" element={<ProductsPage />} />

  <Route path="/servicii-digitale/invitatie-instant" element={<InvitatieInstantLanding />} />
      <Route
        path="/servicii-digitale/invitatie-instant/editor/:draftId"
        element={
          <InvitationProvider>
            <InvitatieInstantEditor />
          </InvitationProvider>
        }
      />
      {/* public view: nu are nevoie de provider */}
      {/* <Route path="/i/:slug" element={<InvitatiePublicView />} /> */}

       <Route
  path="/vanzator/produse"
  element={
    <ProtectedSellerRoute>
      <ProduseleMele />
    </ProtectedSellerRoute>
  }
/>
<Route
  path="/vanzator/comenzi"
  element={
    <ProtectedSellerRoute>
      <ComenzileMele />
    </ProtectedSellerRoute>
  }
/>
<Route
  path="/vanzator/vizitatori"
  element={
    <ProtectedSellerRoute>
      <Vizitatori />
    </ProtectedSellerRoute>
  }
/>
<Route
  path="/vanzator/asistenta"
  element={
    <ProtectedSellerRoute>
      <Asistenta />
    </ProtectedSellerRoute>
  }
/>
<Route
  path="/vanzator/setari"
  element={
    <ProtectedSellerRoute>
      <Setari />
    </ProtectedSellerRoute>
  }
/>

<Route
  path="/vanzator/adauga-produs"
  element={
    <ProtectedSellerRoute>
      <AdaugaProdus />
    </ProtectedSellerRoute>
  }
/>

<Route
  path="/vanzator/editeaza-produs/:id"
  element={
    <ProtectedSellerRoute>
      <EditeazaProdus />
    </ProtectedSellerRoute>
  }
/>

    </Routes>
  );
}
