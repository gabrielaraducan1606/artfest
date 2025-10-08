/**
 * Autosave „inteligent”: debounced, coalesced (trimite doar ce s-a schimbat),
 * are state per-service (saving/saved/error), și izolează profile vs service.
 */
import { useCallback, useRef } from "react";
import { api } from "../../../../../lib/api";

const PROFILE_KEYS = ["displayName","slug","logoUrl","coverUrl","phone","email","address","delivery","tagline","about","city"];

function pickProfilePayload(p) {
  const out = {};
  for (const k of PROFILE_KEYS) {
    if (k === "delivery") {
      out[k] = Array.isArray(p?.delivery) ? p.delivery : [];
    } else if (typeof p?.[k] === "string") {
      const v = p[k].trim();
      out[k] = v || null;
    } else if (p?.[k] !== undefined) {
      out[k] = p[k];
    }
  }
  return out;
}

function pickServicePayload(s) {
  // trimite doar câmpurile de bază acceptate de PATCH-ul tău
  const data = {};
  if ("title" in s) data.title = (s.title || "").trim() || null;
  if ("description" in s) data.description = (s.description || "").trim() || null;
  if ("basePriceCents" in s) data.basePriceCents = s.basePriceCents ?? null;
  if ("currency" in s) data.currency = s.currency || "EUR";
  if ("city" in s) data.city = (s.city || "").trim() || null;
  if ("coverageAreas" in s) data.coverageAreas = Array.isArray(s.coverageAreas) ? s.coverageAreas : [];
  if ("mediaUrls" in s) data.mediaUrls = Array.isArray(s.mediaUrls) ? s.mediaUrls : [];
  if ("attributes" in s) data.attributes = s.attributes || {};
  return data;
}

export function useAutoSave({ services, setSaveState, setSaveError }) {
  // timere distincte pentru fiecare serviceId + tip (profile/service)
  const timers = useRef(new Map());
  // snapshot ca să nu trimitem payload identic inutil
  const lastSent = useRef(new Map());

  const schedule = useCallback((serviceId, type, fn) => {
    const key = `${serviceId}:${type}`;
    if (timers.current.get(key)) clearTimeout(timers.current.get(key));
    timers.current.set(key, setTimeout(fn, 450)); // debounce 450ms
  }, []);

  const mark = useCallback((id, state, error = "") => {
    setSaveState((m) => ({ ...m, [id]: state }));
    if (state === "error") setSaveError((m) => ({ ...m, [id]: error || "Eroare la salvare" }));
  }, [setSaveError, setSaveState]);

  const saveProfile = useCallback((serviceId, idx) => {
    schedule(serviceId, "profile", async () => {
      try {
        mark(serviceId, "saving");
        const svc = services[idx];
        if (!svc?.id) return mark(serviceId, "error", "service inexistent");

        const payload = pickProfilePayload(svc.profile || {});
        const snapKey = `${serviceId}:profile`;
        const prev = lastSent.current.get(snapKey);
        const same = JSON.stringify(prev) === JSON.stringify(payload);
        if (same) return mark(serviceId, "saved");

        await api(`/api/vendors/vendor-services/${serviceId}/profile`, {
          method: "PUT",
          body: payload,
        });
        lastSent.current.set(snapKey, payload);
        mark(serviceId, "saved");
      } catch (e) {
        mark(serviceId, "error", e?.message || "Eroare profil");
      }
    });
  }, [schedule, services, mark]);

  const saveService = useCallback((serviceId, idx) => {
    schedule(serviceId, "service", async () => {
      try {
        mark(serviceId, "saving");
        const svc = services[idx];
        if (!svc?.id) return mark(serviceId, "error", "service inexistent");

        const payload = pickServicePayload(svc);
        const snapKey = `${serviceId}:service`;
        const prev = lastSent.current.get(snapKey);
        const same = JSON.stringify(prev) === JSON.stringify(payload);
        if (same) return mark(serviceId, "saved");

        await api(`/api/vendors/me/services/${serviceId}`, {
          method: "PATCH",
          body: payload,
        });
        lastSent.current.set(snapKey, payload);
        mark(serviceId, "saved");
      } catch (e) {
        mark(serviceId, "error", e?.message || "Eroare serviciu");
      }
    });
  }, [schedule, services, mark]);

  return { saveProfile, saveService };
}
