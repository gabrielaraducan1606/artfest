// src/pages/ProductDetails/hooks/useIsMobile.js
import { useEffect, useState } from "react";

/**
 * Hook simplu pentru a detecta dacă ecranul e "mobil" pe baza unui breakpoint.
 * Evită repetarea logicii cu resize în fiecare componentă.
 */
export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const check = () => {
      setIsMobile(window.innerWidth <= breakpoint);
    };

    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);

  return isMobile;
}
