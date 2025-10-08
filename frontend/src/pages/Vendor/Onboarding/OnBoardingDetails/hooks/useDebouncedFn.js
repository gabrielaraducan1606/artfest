import { useRef } from "react";

/* Debounce generic cu chei independente */
export function useDebouncedFn(fn, delay = 600) {
  const fnRef = useRef(fn);
  const tRef = useRef({});
  fnRef.current = fn;

  return (key) => (...args) => {
    clearTimeout(tRef.current[key]);
    tRef.current[key] = setTimeout(() => fnRef.current(key, ...args), delay);
  };
}
