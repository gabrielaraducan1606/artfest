// src/hooks/useSmartPrefetch.js
//
// Conectează React (lifecycle de listă, hover/focus/touch,
// IntersectionObserver) la serviciul central din
// `src/lib/smartPrefetch.js`. Reutilizabil pentru orice listă de
// carduri către o rută publică (ProductDetails, Store/Profile,
// CustomerRequestDetails, Collections, Campaign etc) - fiecare pagină
// descrie doar forma proprie a datelor prin `descriptor`, restul
// (coadă, dedup, cache, gating pe conexiune) vine din serviciu.

import { useCallback, useEffect, useRef } from "react";
import {
  prefetchChunk,
  prefetchData,
  prefetchImage,
} from "../lib/smartPrefetch";

const DEFAULT_STABLE_MS = 400;

/**
 * Prefetch predictiv pentru UN element dintr-o listă.
 *
 * `descriptor`:
 * - getKey(item): cheie unică de dedup, ex. `product:${item.id}`
 * - routeChunk?(item): () => import(...) pentru chunk-ul rutei
 * - fetchData?(item): () => Promise cu datele reale ale paginii
 * - getDataUrl?(item): url-ul folosit de fetchData (opțional, doar
 *   pentru estimarea de bytes prefetched)
 * - getImageUrl?(item): url-ul imaginii principale (opțional)
 *
 * Întoarce `trigger(mode)`, de atașat la onMouseEnter/onFocus/
 * onTouchStart (mode implicit "intent") sau de apelat din codul de
 * vizibilitate/idle (mode "auto").
 */
export function useSmartPrefetchItem(item, descriptor, { enabled = true } = {}) {
  const triggeredRef = useRef(false);
  const key = item ? descriptor.getKey(item) : null;

  useEffect(() => {
    triggeredRef.current = false;
  }, [key]);

  const trigger = useCallback(
    (mode = "intent") => {
      if (!enabled || !item || triggeredRef.current) return;
      if (!key) return;
      triggeredRef.current = true;

      if (descriptor.routeChunk) {
        prefetchChunk(key, () => descriptor.routeChunk(item), { mode });
      }
      if (descriptor.fetchData) {
        prefetchData(key, () => descriptor.fetchData(item), {
          mode,
          url: descriptor.getDataUrl?.(item),
        });
      }
      if (descriptor.getImageUrl) {
        const imgUrl = descriptor.getImageUrl(item);
        if (imgUrl) prefetchImage(imgUrl, { mode });
      }
    },
    [enabled, item, key, descriptor]
  );

  return trigger;
}

/**
 * Observă un element DOM și apelează `onVisible` o singură dată, doar
 * după ce elementul a fost vizibil ȘI a rămas stabil (nu doar "a
 * trecut prin viewport" la un scroll rapid).
 */
export function useVisibleStableTrigger(
  ref,
  onVisible,
  { enabled = true, stableMs = DEFAULT_STABLE_MS } = {}
) {
  useEffect(() => {
    if (!enabled) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;

    let timer = null;
    let fired = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (fired) return;
        if (entry.isIntersecting) {
          timer = setTimeout(() => {
            if (fired) return;
            fired = true;
            onVisible();
            observer.disconnect();
          }, stableMs);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);

    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, onVisible, enabled, stableMs]);
}
