// frontend/src/main.jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AuthProvider from "./pages/Auth/Context/AuthProvider";
import { HelmetProvider } from "react-helmet-async";
import "./styles/variables.css";

const root = createRoot(document.getElementById("root"));
const isProd = import.meta.env.PROD;

const tree = (
  <HelmetProvider>
    <AuthProvider>
      <App />
    </AuthProvider>
  </HelmetProvider>
);

root.render(isProd ? tree : tree);
