// src/pages/Vendor/Subscription/useVendorSubscriptionStatus.js
import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { resolveCurrentPlanView } from "./subscriptionPlansContent.js";

/*
 * Planul REAL al vendorului - același endpoint ca Dashboard-ul
 * (Desktop.jsx > useSubscriptionStatus), fără endpointuri noi.
 */
export default function useVendorSubscriptionStatus() {
  const [view, setView] = useState({ state: "loading" });
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setError("");
    try {
      const d = await api("/api/vendors/me/subscription/status", { method: "GET" });
      setView(resolveCurrentPlanView(d));
    } catch (e) {
      setView({ state: "unknown" });
      setError(e?.message || "Nu am putut citi abonamentul.");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { view, error, reload };
}
