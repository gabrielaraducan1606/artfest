import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AuthProvider from "./pages/Auth/Context/AuthProvider";
import "./styles/variables.css";

// flag-ul e setat în index.html înainte de acest script
const allowed = window.__ARTFEST_ALLOWED__ === true;

// dacă nu e „unlocked”, NU montăm React -> rămâne landing-ul din index.html
if (allowed) {
  // ascunde landing-ul și arată containerul aplicației
  document.getElementById("landing")?.classList.add("hide");
  const rootEl = document.getElementById("root");
  rootEl?.classList.remove("hide");

  const root = createRoot(rootEl);
  const tree = (
    <AuthProvider>
      <App />
    </AuthProvider>
  );
  root.render(tree);
}

// dacă vrei, poți atașa aici mici handlers pentru landing (ex: butoane), dar fără să montezi React când !allowed
