import { useMemo, useRef, useState, useEffect } from "react";

/**
 * ChipsInput – multi-value text cu sugestii (autocomplete).
 * Props:
 * - value: string[]
 * - onChange(next: string[])
 * - suggestions?: string[]
 * - placeholder?: string
 * - addOnComma?: boolean
 * - maxChips?: number
 */
export default function ChipsInput({
  value = [],
  onChange,
  suggestions = [],
  placeholder = "Adaugă și apasă Enter",
  addOnComma = true,
  maxChips,
}) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // click în afara listei -> închide
  useEffect(() => {
    function onDocClick(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) {
        setFocused(false);
        setHovering(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const lower = (s) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const filteredSuggs = useMemo(() => {
    const q = lower(input);
    return suggestions
      .filter((s) => !value.includes(s))
      .filter((s) => !q || lower(s).includes(q))
      .slice(0, 8);
  }, [suggestions, value, input]);

  function addChip(raw) {
    const chip = (raw || "").trim();
    if (!chip) return;
    if (maxChips && value.length >= maxChips) return;
    if (value.includes(chip)) return;
    onChange?.([...value, chip]);
    setInput("");
    inputRef.current?.focus();
  }

  function removeChip(chip) {
    onChange?.(value.filter((v) => v !== chip));
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addChip(input);
    } else if (addOnComma && e.key === ",") {
      e.preventDefault();
      addChip(input);
    } else if (e.key === "Backspace" && !input && value.length) {
      removeChip(value[value.length - 1]);
    }
  }

  return (
    <div
      ref={wrapRef}
      className="chips-wrap"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: 6,
        position: "relative",
        background: "white",
      }}
    >
      {value.map((v) => (
        <span
          key={v}
          className="chip"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            borderRadius: 999,
            background: "var(--color-bg-muted)",
            fontSize: 12,
          }}
        >
          {v}
          <button
            type="button"
            onClick={() => removeChip(v)}
            aria-label={`Elimină ${v}`}
            style={{ border: 0, background: "transparent", cursor: "pointer" }}
          >
            ×
          </button>
        </span>
      ))}

      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // mic delay: permite click pe sugestie
          setTimeout(() => {
            if (!hovering) setFocused(false);
          }, 120);
        }}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 160,
          border: 0,
          outline: "none",
          font: "inherit",
          padding: "4px 6px",
          background: "transparent",
        }}
        aria-label="Adaugă element"
        aria-expanded={focused && filteredSuggs.length > 0}
        aria-haspopup="listbox"
      />

      {focused && filteredSuggs.length > 0 && (
        <div
          role="listbox"
          aria-label="Sugestii"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 6,
            background: "white",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            boxShadow: "0 6px 24px rgba(0,0,0,.06)",
            padding: 6,
            zIndex: 1000,
            minWidth: 260,
          }}
        >
          {filteredSuggs.map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              onMouseDown={(e) => e.preventDefault()} // previne blur
              onClick={() => addChip(s)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 8px",
                border: 0,
                background: "transparent",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
