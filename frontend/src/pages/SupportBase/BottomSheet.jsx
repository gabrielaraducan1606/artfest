// ./src/pages/Support/BottomSheet.jsx
import { useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { X } from "lucide-react";
import styles from "./Support.module.css";

export default function BottomSheet({
  open,
  onClose,
  title = "",
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
}) {
  const sheetRef = useRef(null);
  const startY = useRef(null);
  const delta = useRef(0);
  const titleId = useRef(
    `sheet-title-${Math.random().toString(36).slice(2)}`
  );

  /* ==== Escape pentru închidere ==== */
  useEffect(() => {
    if (!open || !closeOnEscape) return;

    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  /* ==== Lock scroll pe body când sheet-ul e deschis ==== */
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  /* ==== Focus în sheet la deschidere ==== */
  useEffect(() => {
    if (!open) return;
    const el = sheetRef.current;
    if (!el) return;

    const focusable = el.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (focusable || el).focus();
  }, [open]);

  if (!open) return null;

  // Protecție simplă pentru SSR (dacă vreodată ai server render)
  if (typeof document === "undefined") return null;

  /* ==== handlers touch pentru swipe down ==== */
  const handleTouchStart = (e) => {
    startY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e) => {
    if (startY.current == null) return;
    const currentY = e.touches[0].clientY;
    delta.current = Math.max(0, currentY - startY.current);

    const el = sheetRef.current;
    if (!el) return;

    el.style.transform = `translateY(${delta.current}px)`;
    el.style.transition = "none";
  };

  const handleTouchEnd = () => {
    const el = sheetRef.current;
    if (!el) return;

    el.style.transition = "";
    if (delta.current > 80) {
      onClose?.();
    } else {
      el.style.transform = "";
    }

    startY.current = null;
    delta.current = 0;
  };

  const handleBackdropClick = () => {
    if (closeOnBackdrop) onClose?.();
  };

  return ReactDOM.createPortal(
    <div
      className={styles.sheetBackdrop}
      onClick={handleBackdropClick}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId.current : undefined}
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className={styles.sheetGrab} />
        <div className={styles.sheetHead}>
          <div
            id={titleId.current}
            className={styles.sheetTitle}
          >
            {title}
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Închide"
          >
            <X size={18} />
          </button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
