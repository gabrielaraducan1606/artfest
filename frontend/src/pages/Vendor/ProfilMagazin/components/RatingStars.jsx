import { useState } from "react";
import { FaStar } from "react-icons/fa";
import styles from "./css/Reviews.module.css";

/**
 * Stele 1..5 cu accesibilitate + hover preview
 * value: number (0..5)
 * onChange?: (n:1..5) => void
 */
export default function RatingsStars({ value = 0, ariaLabel, onChange }) {
  const v = Number.isFinite(value) ? value : 0;
  const [hover, setHover] = useState(0);
  const live = hover || v; // preview la hover
  const label = ariaLabel || `${live} din 5 stele`;

  return (
    <span className={styles.stars} role="group" aria-label="Rating stele">
      <span className="sr-only" aria-live="polite">{label}</span>
      {[...Array(5)].map((_, i) => {
        const idx = i + 1;
        const active = i < live;
        return (
          <button
            key={i}
            type="button"
            className={styles.starBtn}
            onMouseEnter={() => onChange && setHover(idx)}
            onMouseLeave={() => onChange && setHover(0)}
            onFocus={() => onChange && setHover(idx)}
            onBlur={() => onChange && setHover(0)}
            onClick={onChange ? () => onChange(idx) : undefined}
            onKeyDown={(e) => {
              if (!onChange) return;
              if (e.key >= "1" && e.key <= "5") onChange(Number(e.key));
              if (e.key === "ArrowRight") onChange(Math.min(5, (v || 0) + 1));
              if (e.key === "ArrowLeft") onChange(Math.max(1, (v || 0) - 1));
            }}
            aria-label={`Setează ${idx} stele`}
            aria-pressed={active}
          >
            <FaStar className={active ? styles.starFull : styles.starEmpty} />
          </button>
        );
      })}
    </span>
  );
}
