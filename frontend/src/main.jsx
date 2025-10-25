import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AuthProvider from "./pages/Auth/Context/AuthProvider";
import "./styles/variables.css";

// în dev (vite dev server) montăm mereu aplicația
const isDev = import.meta.env.DEV === true;
// în prod, montăm doar dacă flag-ul a fost setat în index.html (unlock)
const allowed = isDev || window.__ARTFEST_ALLOWED__ === true;

if (allowed) {
  // ascunde landing-ul și arată containerul aplicației
  document.getElementById("landing")?.classList.add("hide");
  const rootEl = document.getElementById("root");
  rootEl?.classList.remove("hide");

  const root = createRoot(rootEl);
  root.render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );
}
// dacă NU e allowed (prod fără unlock) nu montăm React => rămâne landing-ul indexabil
