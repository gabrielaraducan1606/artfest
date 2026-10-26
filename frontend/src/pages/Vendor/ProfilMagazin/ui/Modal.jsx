// client/src/pages/Store/ProfilMagazin/ui/Modal.jsx
import { useEffect } from "react";
import { createPortal } from "react-dom";
import styles from "../ProfilMagazin.module.css";

// zIndex: doar când modalul se deschide peste un overlay cu z-index mai mare
// decât .modalBackdrop (ex. fereastra de editare din Admin)
export default function Modal({ open, onClose, children, maxWidth = 640, zIndex }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={styles.modalBackdrop}
      style={zIndex ? { zIndex } : undefined}
      onClick={() => onClose?.()}
      role="presentation"
    >
      <div
        className={styles.modalContent}
        style={{ ["--modal-w"]: `${maxWidth}px` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>,
    document.body
  );
}