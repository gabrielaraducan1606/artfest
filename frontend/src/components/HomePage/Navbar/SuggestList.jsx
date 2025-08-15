import styles from "./Navbar.module.css";

export default function SuggestList({ items, activeIdx, onPick, onHover }) {
  if (!items?.length) return null;

  return (
    <ul className={styles.suggestList} role="listbox" aria-label="Sugestii">
      {items.map((s, idx) => (
        <li
          key={s.id || `${idx}-${s.value || s.label}`}
          role="option"
          aria-selected={activeIdx === idx}
          className={`${styles.suggestItem} ${activeIdx === idx ? styles.activeItem : ""}`}
          onMouseDown={(e) => { e.preventDefault(); onPick(s); }}
          onMouseEnter={() => onHover(idx)}
        >
          {s.parts
            ? s.parts.map((part, i) => (
                <span key={i} style={part.highlight ? { fontWeight: 700, color: "var(--color-primary)" } : undefined}>
                  {part.text}
                </span>
              ))
            : (s.label || s.value)}
        </li>
      ))}
    </ul>
  );
}
