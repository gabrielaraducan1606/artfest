/**
 * Verifică disponibilitatea „brand name” (convertit în slug server-side).
 * Primește colecția de servicii (debounced) și întoarce un map { serviceId: {state, available, slug, suggestion} }.
 */
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api";

export function useAvailability(services) {
  const [map, setMap] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!Array.isArray(services) || !services.length) {
        if (!cancelled) setMap({});
        return;
      }

      const checks = await Promise.all(
        services.map(async (s) => {
          const id = s?.id;
          const name = (s?.profile?.displayName || "").trim();
          if (!id || !name) return [id, { state: "idle", available: null }];

          try {
            const qs = new URLSearchParams({
              name,
              excludeServiceId: String(id),
            }).toString();
            const d = await api(`/api/vendors/vendor-services/brand/check?${qs}`);
            return [id, { state: "done", available: !!d.available, slug: d.slug, suggestion: d.suggestion || null }];
          } catch {
            return [id, { state: "error", available: null }];
          }
        })
      );

      if (cancelled) return;
      const out = {};
      for (const [id, v] of checks) out[id] = v;
      setMap(out);
    }

    run();
    return () => { cancelled = true; };
  }, [services]);

  return map;
}
