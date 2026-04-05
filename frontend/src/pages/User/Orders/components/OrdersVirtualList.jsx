import React, { useMemo, useRef, useState, useEffect, useCallback } from "react";

/**
 * Virtual list simplu (fără deps).
 * - itemHeight FIX (rapid și stabil)
 * - render doar ce e vizibil
 *
 * Ajustează ROW_HEIGHT să se potrivească cu cardurile tale.
 */
const ROW_HEIGHT = 260;
const OVERSCAN = 4;

export default function OrdersVirtualList({ items, renderRow, height = "70vh" }) {
  const wrapRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  // măsurăm viewport-ul containerului
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const measure = () => setViewportH(el.clientHeight || 600);
    measure();

    // ResizeObserver dacă există
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } else {
      window.addEventListener("resize", measure);
    }

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", measure);
    };
  }, []);

  const onScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalH = items.length * ROW_HEIGHT;

  const { start, end, offsetY } = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2;
    const endIndex = Math.min(items.length - 1, startIndex + visibleCount);
    return {
      start: startIndex,
      end: endIndex,
      offsetY: startIndex * ROW_HEIGHT,
    };
  }, [scrollTop, viewportH, items.length]);

  const slice = useMemo(() => items.slice(start, end + 1), [items, start, end]);

  return (
    <div
      ref={wrapRef}
      onScroll={onScroll}
      style={{
        height,
        overflow: "auto",
        position: "relative",
        willChange: "transform",
      }}
    >
      <div style={{ height: totalH, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {slice.map((item, i) => (
            <div key={item?.id ?? `${start + i}`} style={{ height: ROW_HEIGHT }}>
              {renderRow(item)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
