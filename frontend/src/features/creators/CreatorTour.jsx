// src/features/creators/CreatorTour.jsx
//
// Turul ghidat Artfest Creators (4 pași). NON-modal: fără fundal care blochează
// pagina, fără focus trap; evidențiază secțiunea curentă (data-tour) și o aduce
// în ecran. „Omite turul” / finalizarea sunt salvate pe server per versiune,
// deci turul nu mai reapare; reluarea manuală nu schimbă starea salvată.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { TOUR_STEPS, tourReducer } from "./creatorsLogic.js";
import { cx } from "./creatorsClient.js";
import styles from "./Creators.module.css";

export default function CreatorTour({ onFinish, onStepChange }) {
  const [state, setState] = useState({ index: 0, done: false, outcome: null });
  const titleRef = useRef(null);
  const step = TOUR_STEPS[state.index];

  useEffect(() => {
    onStepChange?.(state.done ? null : step.target);
    if (state.done) return;
    const target = document.querySelector(`[data-tour="${step.target}"]`);
    target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    titleRef.current?.focus({ preventScroll: true });
  }, [state.index, state.done, step.target, onStepChange]);

  useEffect(() => {
    if (state.done) onFinish(state.outcome);
  }, [state.done, state.outcome, onFinish]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") setState((s) => tourReducer(s, "skip"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (state.done) return null;
  const last = state.index === TOUR_STEPS.length - 1;

  return (
    <aside className={styles.tour} role="dialog" aria-modal="false" aria-labelledby="creator-tour-title" aria-describedby="creator-tour-text">
      <div className={styles.cardHead} style={{ marginBottom: 4 }}>
        <span className={styles.tourStepCount}>
          Pasul {state.index + 1} din {TOUR_STEPS.length}
        </span>
        <button type="button" className={styles.btnGhost} style={{ minHeight: 32, padding: 4 }} onClick={() => setState((s) => tourReducer(s, "skip"))} aria-label="Omite turul">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <h2 id="creator-tour-title" className={styles.cardTitle} ref={titleRef} tabIndex={-1}>
        {step.title}
      </h2>
      <p id="creator-tour-text" className={styles.lead} style={{ marginTop: 6 }}>
        {step.text}
      </p>
      <div className={styles.tourDots} aria-hidden="true">
        {TOUR_STEPS.map((s, i) => (
          <span key={s.target} className={cx(styles.tourDot, i === state.index && styles.tourDotActive)} />
        ))}
      </div>
      <div className={styles.actions} style={{ justifyContent: "space-between" }}>
        <button type="button" className={styles.btnGhost} onClick={() => setState((s) => tourReducer(s, "skip"))}>
          Omite turul
        </button>
        <div className={styles.actions}>
          {state.index > 0 && (
            <button type="button" className={styles.btn} onClick={() => setState((s) => tourReducer(s, "back"))}>
              Înapoi
            </button>
          )}
          <button type="button" className={styles.btnPrimary} onClick={() => setState((s) => tourReducer(s, "next"))}>
            {last ? "Am înțeles" : "Continuă"}
          </button>
        </div>
      </div>
    </aside>
  );
}
