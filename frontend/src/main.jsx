// src/main.jsx

import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import AuthProvider from "./pages/Auth/Context/AuthProvider";

import {
  setupAnalyticsConsentListener,
  trackPageView,
} from "../services/analytics.js";

import "./styles/variables.css";

/* =========================================================
   ANALYTICS + COOKIE CONSENT
========================================================= */

/*
 * Pornește listenerul pentru modificarea
 * preferințelor de cookies.
 *
 * Dacă marketing === false:
 * Meta Pixel NU este încărcat.
 *
 * Dacă utilizatorul apasă ulterior
 * "Accept toate", Pixelul va fi
 * inițializat automat.
 */
setupAnalyticsConsentListener();

/*
 * PageView inițial.
 *
 * Dacă marketingul nu este acceptat,
 * funcția nu trimite nimic către Meta.
 */
trackPageView();

/* =========================================================
   REACT
========================================================= */

const root = createRoot(
  document.getElementById("root")
);

const isProd =
  import.meta.env.PROD;

const tree = (
  <AuthProvider>
    <App />
  </AuthProvider>
);

root.render(
  isProd
    ? tree
    : tree
);