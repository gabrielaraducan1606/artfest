import { useCallback, useEffect, useMemo, useState } from "react";

function makeId() {
  try {
    return (
      (globalThis.crypto?.randomUUID && globalThis.crypto.randomUUID()) ||
      Date.now().toString(36) + Math.random().toString(36).slice(2)
    );
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }
}

function getSessionId() {
  try {
    const key = "visitor_sid";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;

    const next = makeId();
    window.localStorage.setItem(key, next);
    return next;
  } catch {
    return undefined;
  }
}

const VALID_TYPES = new Set(["PAGEVIEW", "CTA_CLICK", "MESSAGE"]);

export default function useStoreTracking(vendorId) {
  const sessionId = useMemo(() => getSessionId(), []);
  const [viewId] = useState(() => makeId());

  const send = useCallback(
    (payload) => {
      if (!payload?.vendorId || typeof payload.vendorId !== "string") return;
      if (!VALID_TYPES.has(payload?.type)) return;

      const body = {
        vendorId: payload.vendorId,
        type: payload.type,
        ctaLabel: payload.ctaLabel,
        sessionId,
        viewId,
        pageUrl:
          typeof window !== "undefined"
            ? window.location.pathname + window.location.search
            : undefined,
        referrer:
          typeof document !== "undefined" ? document.referrer || "" : "",
      };

      try {
        const blob = new Blob([JSON.stringify(body)], {
          type: "application/json",
        });

        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          const ok = navigator.sendBeacon("/api/visitors/track", blob);
          if (ok) return;
        }
      } catch {
        // noop
      }

      fetch("/api/visitors/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    },
    [sessionId, viewId]
  );

  useEffect(() => {
    if (!vendorId) return;

    send({
      vendorId,
      type: "PAGEVIEW",
    });
  }, [vendorId, send]);

  const trackCTA = useCallback(
    (label) => {
      if (!vendorId) return;
      send({
        vendorId,
        type: "CTA_CLICK",
        ctaLabel: label,
      });
    },
    [vendorId, send]
  );

  const trackMESSAGE = useCallback(
    (label) => {
      if (!vendorId) return;
      send({
        vendorId,
        type: "MESSAGE",
        ctaLabel: label,
      });
    },
    [vendorId, send]
  );

  return { trackCTA, trackMESSAGE };
}