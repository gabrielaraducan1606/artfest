// src/utils/useDraft.js
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * useDraft — salvează/restaurează un draft în localStorage,
 * cu debounce și „namespacing” per utilizator.
 *
 * @param {string} keyBase - ex: "onboarding:step1"
 * @param {object} initial - starea inițială (fallback)
 * @param {object} opts
 *  - userKey: string unic pt. utilizator (ex: userId sau prefix token)
 *  - debounce: ms (default 500)
 *  - filter: (obj)=>obj — pentru a elimina câmpuri ne-stocabile (ex: File)
 */
export default function useDraft(keyBase, initial, opts = {}) {
  const { userKey = "anon", debounce = 500, filter } = opts;
  const storageKey = useMemo(() => `${keyBase}:${userKey}`, [keyBase, userKey]);
  const [state, setState] = useState(initial);
  const t = useRef();

  // HYDRATE din localStorage (o singură dată)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed._ts) {
        setState((prev) => ({ ...prev, ...parsed.data }));
      }
    } catch {" "}
  }, [storageKey]);

  // SAVE (debounce)
  useEffect(() => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => {
      try {
        const data = filter ? filter(state) : state;
        localStorage.setItem(
          storageKey,
          JSON.stringify({ _ts: Date.now(), data })
        );
      } catch {" "}
    }, debounce);
    return () => window.clearTimeout(t.current);
  }, [state, storageKey, debounce, filter]);

  // flush la unload (safety)
  useEffect(() => {
    const flush = () => {
      try {
        const data = filter ? filter(state) : state;
        localStorage.setItem(storageKey, JSON.stringify({ _ts: Date.now(), data }));
      } catch {" "}
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [state, storageKey, filter]);

  return [state, setState, storageKey];
}
