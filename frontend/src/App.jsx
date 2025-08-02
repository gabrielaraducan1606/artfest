import React from "react";
import { Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import Login from "../src/pages/LoginForm/Login"; 
import RegisterForm from "../src/pages/RegisterForm/RegisterForm"; 
import Termeni from "../src/pages/Termeni/Termeni";
import GDPR from "./pages/PoliticaGDPR/PoliticaGDPR";
import SellerDashboard from './pages/VanzatorDashboard/VanzatorDashboard';
import CompleteProfile from './pages/Seller/SellerProfile';
import SendOnboarding from "./pages/Seller/Payments/Payments";
import ContractPage from "./pages/Seller/ContractPage/ContractPage";

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
       <Route path="/vanzator/dashboard" element={<SellerDashboard />} />
       <Route path="/vanzator/contract/:id" element={<ContractPage />} />

    </Routes>
  );
}
