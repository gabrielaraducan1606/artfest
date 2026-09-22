// src/hooks/usePublicCollections.js
//
// Colecțiile publice pentru linkuri interne (Home + meniu):
// GET /api/public/collections?placement=homepage|menu.
// Backend-ul întoarce doar colecții active cu flag-ul potrivit
// (showOnHomepage / showInMenu). Cache în memorie 5 min + deduplicare a
// cererilor simultane (Navbar și Home montează pe aceeași pagină).
// La eroare întoarce [] (fără linkuri) - nu afișăm erori pentru o listă
// decorativă.

import { useEffect, useState } from "react";
import { api } from "../lib/api";

const TTL_MS = 5 * 60 * 1000;

const cache = new Map(); // placement -> { at, items }
const inflight = new Map(); // placement -> Promise

function readCache(placement) {
  const hit = cache.get(placement);
  return hit && Date.now() - hit.at < TTL_MS ? hit.items : null;
}

export function fetchPublicCollections(placement) {
  const cached = readCache(placement);
  if (cached) return Promise.resolve(cached);

  if (inflight.has(placement)) return inflight.get(placement);

  const request = api(
    `/api/public/collections?placement=${encodeURIComponent(placement)}`
  )
    .then((data) => {
      const items = Array.isArray(data?.items) ? data.items : [];
      cache.set(placement, { at: Date.now(), items });
      return items;
    })
    .catch(() => [])
    .finally(() => inflight.delete(placement));

  inflight.set(placement, request);
  return request;
}

export function usePublicCollections(placement) {
  const [items, setItems] = useState(() => readCache(placement) || []);

  useEffect(() => {
    let active = true;

    fetchPublicCollections(placement).then((list) => {
      if (active) setItems(list);
    });

    return () => {
      active = false;
    };
  }, [placement]);

  return items;
}
