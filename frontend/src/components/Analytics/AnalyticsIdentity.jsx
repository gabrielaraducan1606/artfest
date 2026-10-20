// src/components/Analytics/AnalyticsIdentity.jsx
//
// Transmite către GA4 rolul (ne-personal) al vizitatorului și marchează
// traficul administratorilor / vânzătorilor ca `traffic_type=internal`
// (services/analytics.js -> setAnalyticsIdentity). Nu randează nimic.
// Doar citește sesiunea - nu modifică autentificarea.

import { useEffect } from "react";

import { useAuth } from "../../pages/Auth/Context/context.js";
import { setAnalyticsIdentity } from "../../../services/analytics.js";

export default function AnalyticsIdentity() {
  const { me, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    setAnalyticsIdentity(me || null);
  }, [me, loading]);

  return null;
}
