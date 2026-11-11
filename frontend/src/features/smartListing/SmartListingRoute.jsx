// src/features/smartListing/SmartListingRoute.jsx
//
// Ruta /vendor/produs-nou (înregistrată în App.jsx DOAR în `vite dev`).
// Accesul efectiv: smartListingAccess.js (flag + testeri / previzualizare Admin).

import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../../pages/Auth/Context/context.js";
import SmartListingPage from "./SmartListingPage.jsx";

export default function SmartListingRoute() {
  const { me, loading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  if (loading) return <div style={{ padding: 24 }}>Se verifică sesiunea…</div>;
  if (!me) {
    return <Navigate to={`/autentificare?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }

  return <SmartListingPage me={me} initialStoreSlug={params.get("magazin") || ""} onNavigate={(to) => navigate(to)} />;
}
