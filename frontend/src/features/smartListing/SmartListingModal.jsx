// src/features/smartListing/SmartListingModal.jsx
//
// Smart Listing ca fereastră peste pagina curentă. Montat o singură dată în App.jsx,
// doar în `vite dev`; butoanele „Adaugă produs” îl deschid prin openSmartListing(),
// fără navigare, deci la închidere vânzătorul rămâne exact unde era.
// Formularul e același SmartListingPage; aici stau doar fereastra, focusul și închiderea.

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../pages/Auth/Context/context.js";
import {
  SMART_LISTING_ADVANCED_EVENT,
  SMART_LISTING_EDIT_ADVANCED_EVENT,
  SMART_LISTING_EDIT_EVENT,
  SMART_LISTING_OPEN_EVENT,
  smartListingAccessFor,
} from "./smartListingAccess.js";
import styles from "./SmartListing.module.css";

const SmartListingPage = lazy(() => import("./SmartListingPage.jsx"));
// editarea unui produs existent: aceeași fereastră, alt conținut
const SmartListingEditPage = lazy(() => import("./SmartListingEditPage.jsx"));

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

function ModalShell({ me, storeSlug, productId = "", onClose, onOpenAdvanced, onOpenEditAdvanced, onNavigate }) {
  const dialogRef = useRef(null);
  const closeApiRef = useRef(null);
  const [sessionKey, setSessionKey] = useState(0);

  const requestClose = useCallback(
    (source) => {
      if (closeApiRef.current) closeApiRef.current.requestClose(source);
      else onClose();
    },
    [onClose]
  );

  // fără scroll dublu: pagina din spate nu se mișcă
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // focusul intră în fereastră și revine pe butonul care a deschis-o
  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        requestClose("escape");
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      // Tab rămâne în fereastra de deasupra (formularul sau o fereastră din el)
      const scope = [...dialogRef.current.querySelectorAll('[role="dialog"]')].pop() || dialogRef.current;
      const items = [...scope.querySelectorAll(FOCUSABLE)].filter((item) => item.getClientRects().length);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !scope.contains(active) || active === scope)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !scope.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  return createPortal(
    <div
      className={styles.modalBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose("outside");
      }}
    >
      <div ref={dialogRef} className={styles.modalDialog} role="dialog" aria-modal="true" aria-labelledby="sl-modal-title" tabIndex={-1}>
        <Suspense fallback={<div className={styles.modalLoading}>Se deschide formularul…</div>}>
          {productId ? (
            <SmartListingEditPage
              productId={productId}
              storeSlug={storeSlug}
              embedded
              closeApiRef={closeApiRef}
              onClose={onClose}
              onOpenAdvanced={onOpenEditAdvanced}
            />
          ) : (
            <SmartListingPage
              key={sessionKey}
              me={me}
              embedded
              closeApiRef={closeApiRef}
              initialStoreSlug={storeSlug}
              onClose={onClose}
              onRestart={() => setSessionKey((current) => current + 1)}
              onOpenAdvanced={onOpenAdvanced}
              onNavigate={onNavigate}
            />
          )}
        </Suspense>
      </div>
    </div>,
    document.body
  );
}

export default function SmartListingModal() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [request, setRequest] = useState(null);
  const canOpen = smartListingAccessFor(me).canSave;
  const userId = me?.id || me?.sub || "";

  useEffect(() => {
    const onOpen = (event) => setRequest({ storeSlug: event.detail?.storeSlug || "" });
    const onEdit = (event) =>
      event.detail?.productId && setRequest({ storeSlug: event.detail?.storeSlug || "", productId: String(event.detail.productId) });
    window.addEventListener(SMART_LISTING_OPEN_EVENT, onOpen);
    window.addEventListener(SMART_LISTING_EDIT_EVENT, onEdit);
    return () => {
      window.removeEventListener(SMART_LISTING_OPEN_EVENT, onOpen);
      window.removeEventListener(SMART_LISTING_EDIT_EVENT, onEdit);
    };
  }, []);

  // schimbarea paginii sau a contului închide fereastra; ciorna se salvează la închidere
  useEffect(() => setRequest(null), [pathname, userId]);

  const close = useCallback(() => setRequest(null), []);

  const openAdvanced = useCallback(
    (storeSlug) => {
      setRequest(null);
      // pe pagina magazinului editorul se deschide pe loc; altfel mergem la magazin
      const handled = !window.dispatchEvent(new CustomEvent(SMART_LISTING_ADVANCED_EVENT, { cancelable: true, detail: { storeSlug } }));
      if (!handled) navigate(`/magazin/${encodeURIComponent(storeSlug)}?editorAvansat=1`);
    },
    [navigate]
  );

  // editare -> editorul avansat (ProductModal) pentru același produs: întâi se închide fereastra
  const openEditAdvanced = useCallback(
    (productId) => {
      const storeSlug = request?.storeSlug || "";
      setRequest(null);
      const handled = !window.dispatchEvent(
        new CustomEvent(SMART_LISTING_EDIT_ADVANCED_EVENT, { cancelable: true, detail: { storeSlug, productId } })
      );
      if (!handled && storeSlug) navigate(`/magazin/${encodeURIComponent(storeSlug)}`);
    },
    [navigate, request?.storeSlug]
  );

  const leaveTo = useCallback(
    (to) => {
      setRequest(null);
      navigate(to);
    },
    [navigate]
  );

  if (!request || !canOpen) return null;

  return (
    <ModalShell
      key={request.productId || "create"}
      me={me}
      storeSlug={request.storeSlug}
      productId={request.productId || ""}
      onClose={close}
      onOpenAdvanced={openAdvanced}
      onOpenEditAdvanced={openEditAdvanced}
      onNavigate={leaveTo}
    />
  );
}
