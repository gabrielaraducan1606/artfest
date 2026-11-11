// src/pages/Checkout/useCheckoutChrome.js
//
// Comportamentul „de pagină” al checkout-ului:
//  - desktop: sumarul din dreapta e sticky DOAR dacă încape în ecran
//    (altfel butonul de plasare ar rămâne inaccesibil sub marginea ecranului);
//  - mobil (o coloană): bară fixă jos cu totalul + „Plasează comanda”,
//    ascunsă cât timp butonul real e vizibil și cât timp tastatura e deschisă
//    (un câmp de formular are focus) - fără suprapunere cu tastatura.

import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 980px)";
const STICKY_TOP = 84; // înălțimea barei de sus + spațiu

export default function useCheckoutChrome({ asideRef, placeButtonRef, enabled = true }) {
  const [stickySummary, setStickySummary] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia?.(MOBILE_QUERY).matches);
  const [placeButtonVisible, setPlaceButtonVisible] = useState(true);
  const [typing, setTyping] = useState(false);

  // o coloană / două coloane
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // sumar sticky doar dacă încape în ecran
  useEffect(() => {
    const el = asideRef.current;
    if (!enabled || !el || isMobile) {
      setStickySummary(false);
      return undefined;
    }
    const measure = () => setStickySummary(el.scrollHeight + STICKY_TOP + 16 <= window.innerHeight);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [asideRef, enabled, isMobile]);

  // butonul real e pe ecran? (atunci bara fixă nu mai e necesară)
  useEffect(() => {
    const el = placeButtonRef.current;
    if (!enabled || !el || !isMobile || typeof IntersectionObserver === "undefined") {
      setPlaceButtonVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver(([entry]) => setPlaceButtonVisible(entry.isIntersecting), { threshold: 0.1 });
    io.observe(el);
    return () => io.disconnect();
  }, [placeButtonRef, enabled, isMobile]);

  // tastatură deschisă = un câmp editabil are focus
  useEffect(() => {
    if (!isMobile) return undefined;
    const editable = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const onIn = (e) => editable(e.target) && setTyping(true);
    const onOut = () => setTimeout(() => setTyping(editable(document.activeElement)), 50);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, [isMobile]);

  return {
    stickySummary,
    showMobileBar: Boolean(enabled && isMobile && !placeButtonVisible && !typing),
  };
}
