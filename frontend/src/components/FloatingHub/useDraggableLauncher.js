// frontend/src/components/FloatingHub/useDraggableLauncher.js
//
// Extras din mecanismul de drag/poziție care exista deja în
// AiAssistant.jsx (getDefaultPosition/getSavedPosition/clampPosition,
// handlePointerDown/Move/Up, persistență în localStorage) - matematica
// de clamp, pragul de click-vs-drag și persistența în localStorage sunt
// reproduse IDENTIC, nu reimplementate aproximativ.
//
// O SINGURĂ implementare pentru desktop ȘI mobil - Pointer Events (nu
// mouse/touch separate) fac asta posibil nativ: `pointerdown` pe touch
// are `button === 0` la fel ca mouse-ul, iar `touch-action: none` (pus
// în CSS pe `.bubble`) oprește gestul de scroll al browserului cât se
// trage bula. Diferența dintre desktop și touch e doar pragul de
// click-vs-drag (mai mare pe touch, unde degetul se mișcă natural mai
// mult decât un mouse) - vezi `thresholdFor`.
//
// Apelantul (FloatingHub.jsx) decide CE `storageKey` se folosește
// (desktop vs mobil - chei separate, poziția de pe desktop nu se
// reutilizează pe mobil) - hook-ul doar reacționează dacă acea cheie se
// schimbă în timpul sesiunii (ex. resize peste breakpoint-ul mobil),
// reîncărcând poziția salvată pentru noua cheie.
import { useCallback, useEffect, useRef, useState } from "react";
import { getSafeAreaInsets } from "./safeArea";

const DRAG_THRESHOLD_MOUSE_PX = 4;
const DRAG_THRESHOLD_TOUCH_PX = 6;
const CLAMP_PADDING = 12;

function thresholdFor(pointerType) {
  return pointerType === "touch" || pointerType === "pen"
    ? DRAG_THRESHOLD_TOUCH_PX
    : DRAG_THRESHOLD_MOUSE_PX;
}

function clampPosition(position, elementWidth, elementHeight, insets) {
  if (typeof window === "undefined") return position;

  const safe = insets || { top: 0, bottom: 0, left: 0, right: 0 };
  const padLeft = CLAMP_PADDING + safe.left;
  const padRight = CLAMP_PADDING + safe.right;
  const padTop = CLAMP_PADDING + safe.top;
  const padBottom = CLAMP_PADDING + safe.bottom;

  const minX = padLeft;
  const maxX = Math.max(minX, window.innerWidth - elementWidth - padRight);
  const minY = padTop;
  const maxY = Math.max(minY, window.innerHeight - elementHeight - padBottom);

  return {
    x: Math.min(Math.max(position.x, minX), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
  };
}

function getDefaultPosition(collapsedSize, insets) {
  if (typeof window === "undefined") return { x: 24, y: 24 };

  const safe = insets || { top: 0, bottom: 0, left: 0, right: 0 };
  return {
    x: Math.max(CLAMP_PADDING, window.innerWidth - collapsedSize - CLAMP_PADDING - 8 - safe.right),
    y: Math.max(CLAMP_PADDING, window.innerHeight - collapsedSize - CLAMP_PADDING - 8 - safe.bottom),
  };
}

function getSavedPosition(storageKey, collapsedSize, insets) {
  if (typeof window === "undefined") return getDefaultPosition(collapsedSize, insets);

  try {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return getDefaultPosition(collapsedSize, insets);

    const parsed = JSON.parse(saved);
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") {
      return getDefaultPosition(collapsedSize, insets);
    }

    return parsed;
  } catch {
    return getDefaultPosition(collapsedSize, insets);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.storageKey - cheie localStorage. Apelantul e cel
 *   care alege desktop vs mobil - hook-ul doar reîncarcă poziția dacă
 *   această cheie se schimbă în timpul sesiunii.
 * @param {number} [opts.collapsedSize=64] - latura bulei (pătrat).
 * @param {boolean} opts.isOpen - dacă panelul (mai mare) e deschis acum.
 * @param {{width:number, height:number}} opts.expandedSize - dimensiunea
 *   folosită la clamp când `isOpen` (dacă bula însăși crește - în
 *   FloatingHub nu e cazul, bula rămâne mereu `collapsedSize`).
 * @param {() => void} [opts.onClick] - apelat la un tap/click FĂRĂ drag
 *   (indiferent de `isOpen`) - apelantul decide deschide/închide.
 */
export function useDraggableLauncher({
  storageKey = "artfest-assistant-position",
  collapsedSize = 64,
  isOpen,
  expandedSize,
  onClick,
}) {
  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: null,
    pointerType: "mouse",
    startPointerX: 0,
    startPointerY: 0,
    startElementX: 0,
    startElementY: 0,
  });

  const [position, setPosition] = useState(() =>
    getSavedPosition(storageKey, collapsedSize, getSafeAreaInsets())
  );

  const currentSize = isOpen
    ? expandedSize || { width: collapsedSize, height: collapsedSize }
    : { width: collapsedSize, height: collapsedSize };

  // Persistență - scrie la fiecare schimbare de poziție, sub cheia
  // curentă (desktop sau mobil, oricare e activă acum).
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(position));
  }, [position, storageKey]);

  // Dacă `storageKey` se schimbă în timpul sesiunii (ex. resize peste
  // breakpoint-ul mobil/desktop), reîncarcă poziția salvată pentru NOUA
  // cheie - nu continua să folosești coordonatele celeilalte chei.
  // Prima rulare (la mount) e ignorată - poziția inițială e deja corectă,
  // luată din `useState` de mai sus.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    setPosition(getSavedPosition(storageKey, collapsedSize, getSafeAreaInsets()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Re-clamp la resize/rotate - ține bula în viewport (incl. safe-area).
  useEffect(() => {
    function handleViewportChange() {
      setPosition((current) =>
        clampPosition(current, currentSize.width, currentSize.height, getSafeAreaInsets())
      );
    }
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
    };
  }, [currentSize.width, currentSize.height]);

  // Re-clamp când se schimbă isOpen (bulă -> panel sau invers).
  useEffect(() => {
    setPosition((current) =>
      clampPosition(current, currentSize.width, currentSize.height, getSafeAreaInsets())
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handlePointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return;

      dragRef.current = {
        active: true,
        moved: false,
        pointerId: event.pointerId,
        pointerType: event.pointerType || "mouse",
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        startElementX: position.x,
        startElementY: position.y,
      };

      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [position]
  );

  const handlePointerMove = useCallback(
    (event) => {
      const dragState = dragRef.current;
      if (!dragState.active || dragState.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - dragState.startPointerX;
      const deltaY = event.clientY - dragState.startPointerY;
      const threshold = thresholdFor(dragState.pointerType);

      if (Math.abs(deltaX) > threshold || Math.abs(deltaY) > threshold) {
        dragRef.current.moved = true;
      }

      setPosition(
        clampPosition(
          { x: dragState.startElementX + deltaX, y: dragState.startElementY + deltaY },
          currentSize.width,
          currentSize.height,
          getSafeAreaInsets()
        )
      );
    },
    [currentSize.width, currentSize.height]
  );

  const handlePointerUp = useCallback(
    (event) => {
      const dragState = dragRef.current;
      if (dragState.pointerId !== event.pointerId) return;

      const wasMoved = dragState.moved;
      dragRef.current.active = false;
      dragRef.current.pointerId = null;

      if (!wasMoved) {
        onClick?.();
      }
    },
    [onClick]
  );

  return {
    position,
    dragHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    },
  };
}
