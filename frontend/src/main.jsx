// frontend/src/main.jsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AuthProvider from "./pages/Auth/Context/AuthProvider";
import "./styles/variables.css";

const root = createRoot(document.getElementById("root"));

const isProd = import.meta.env.PROD; // Vite setează PROD în build
const tree = (
  <AuthProvider>
    <App />
  </AuthProvider>
);

root.render(isProd ? tree : tree); // fără StrictMode în dev
