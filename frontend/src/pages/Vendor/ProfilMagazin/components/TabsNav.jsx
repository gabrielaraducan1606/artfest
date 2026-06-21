import React, { useEffect, useRef, useState, useCallback } from "react";
import styles from "./css/TabsNav.module.css";

export default function TabsNav({ items = [], activeKey, onJump }) {
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const startYRef = useRef(0);

  const [isStuck, setIsStuck] = useState(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const calcStart = () => {
      startYRef.current = wrap.getBoundingClientRect().top + window.scrollY;
    };

    const onScroll = () => {
      setIsStuck(window.scrollY >= startYRef.current - 64);
    };

    calcStart();
    onScroll();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", calcStart);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", calcStart);
    };
  }, []);

  const updateArrows = useCallback(() => {
    const el = listRef.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    const max = Math.max(1, scrollWidth - clientWidth);
    const ratio = Math.min(1, Math.max(0, scrollLeft / max));

    setCanLeft(scrollLeft > 8);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 8);

    const hoverPct = 6 + ratio * 8;
    const edge = 24 - ratio * 8;

    wrap.style.setProperty("--scroll-x", ratio.toFixed(4));
    wrap.style.setProperty("--hover-pct", `${hoverPct.toFixed(2)}%`);
    wrap.style.setProperty("--edge-fade", `${edge.toFixed(0)}px`);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = listRef.current;
    if (!el) return;

    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const active = list.querySelector(`[data-key="${activeKey}"]`);
    if (!active) return;

    const activeCenter = active.offsetLeft + active.offsetWidth / 2;
    const targetLeft = activeCenter - list.clientWidth / 2;

    list.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: "smooth",
    });
  }, [activeKey]);

  const scrollByAmount = (dir) => {
    const el = listRef.current;
    if (!el) return;

    const amount = Math.round(el.clientWidth * 0.6) * (dir === "left" ? -1 : 1);
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  return (
    <div
      ref={wrapRef}
      className={`${styles.tabsWrap} ${isStuck ? styles.isStuck : ""}`}
      role="tablist"
      aria-label="Secțiuni magazin"
    >
      <button
        type="button"
        className={`${styles.navBtn} ${styles.left} ${
          canLeft ? styles.show : ""
        }`}
        aria-label="Derulează la stânga"
        onClick={() => scrollByAmount("left")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M15.5 19 8.5 12l7-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div ref={listRef} className={styles.tabs}>
        {items.map((it) => {
          const current = it.key === activeKey;

          return (
            <button
              key={it.key}
              type="button"
              data-key={it.key}
              className={styles.tabBtn}
              aria-current={current ? "page" : undefined}
              onClick={() => onJump?.(it.key)}
            >
              {it.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={`${styles.navBtn} ${styles.right} ${
          canRight ? styles.show : ""
        }`}
        aria-label="Derulează la dreapta"
        onClick={() => scrollByAmount("right")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M8.5 5 15.5 12l-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}