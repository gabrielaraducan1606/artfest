// src/features/billing/useCurrentSubscription.js
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api"; 

export function useCurrentSubscription() {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const d = await api("/api/vendors/me/subscription", { method: "GET" });
        if (!alive) return;
        setSub(d?.subscription ?? null);
      } catch {
        if (!alive) return;
        setSub(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { sub, loading, setSub };
}
