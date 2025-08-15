import { useEffect, useRef, useState } from "react";
import { getSuggestions } from "../services/search";
import { createLRU } from "../utils/lruCache";

export default function useAutosuggest(minLen = 2, delay = 250) {
  const [term, setTerm] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const abortRef = useRef(null);
  const cacheRef = useRef(createLRU(100));

  useEffect(() => {
    const q = term.trim();
    if (abortRef.current) abortRef.current.abort();

    if (q.length < minLen) {
      setSuggestions([]);
      setOpen(false);
      setActiveIdx(-1);
      return;
    }

    const t = setTimeout(async () => {
      const cached = cacheRef.current.get(q);
      if (cached) {
        setSuggestions(cached);
        setOpen(true);
        setActiveIdx(-1);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const data = await getSuggestions(q, controller.signal);
        cacheRef.current.set(q, data);
        setSuggestions(data);
        setOpen(true);
        setActiveIdx(-1);
      } catch (err) {
        if (err.name !== "AbortError") console.error("Sugestii:", err);
      }
    }, delay);

    return () => clearTimeout(t);
  }, [term, minLen, delay]);

  const onKeyDown = (e, onPick) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      if (activeIdx >= 0) {
        e.preventDefault();
        const s = suggestions[activeIdx];
        onPick(s);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return {
    term, setTerm,
    suggestions, open, setOpen,
    activeIdx, setActiveIdx,
    onKeyDown,
  };
}
