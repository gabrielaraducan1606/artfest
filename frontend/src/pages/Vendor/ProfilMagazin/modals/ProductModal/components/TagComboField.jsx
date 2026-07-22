import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../../../components/css/ProductModal.module.css";

export default function TagComboField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  note,
}) {
  const [inputValue, setInputValue] = useState("");
  const [openList, setOpenList] = useState(false);
  const wrapRef = useRef(null);

  const tags = useMemo(
    () =>
      String(value || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [value]
  );

  useEffect(() => {
    if (!openList) return;

    const handleClickOutside = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) {
        setOpenList(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openList]);

  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const addTag = (token) => {
    const norm = String(token || "").trim();
    if (!norm) return;

    const existing = new Set(tags);
    if (existing.has(norm)) {
      setInputValue("");
      return;
    }

    onChange([...tags, norm].join(", "));
    setInputValue("");
  };

  const removeTag = (tag) => {
    onChange(tags.filter((t) => t !== tag).join(", "));
  };

  const suggestions = useMemo(() => {
    const q = normalize(inputValue);
    const existing = new Set(tags.map((t) => normalize(t)));

    return options
      .filter((opt) => !existing.has(normalize(opt)))
      .filter((opt) => !q || normalize(opt).includes(q))
      .slice(0, 20);
  }, [options, tags, inputValue]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
      return;
    }

    if (e.key === "Backspace" && !inputValue && tags.length > 0) {
      e.preventDefault();
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div ref={wrapRef} style={{ marginBottom: 12 }}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}

      <div
        className={styles.input}
        style={{
          minHeight: 40,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
          paddingTop: 6,
          paddingBottom: 6,
        }}
        onClick={() => {
          setOpenList(true);
          document.getElementById(id)?.focus();
        }}
      >
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: "0.75rem",
              background: "rgba(0,0,0,0.06)",
            }}
          >
            {tag}

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
              }}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: "0.8rem",
                lineHeight: 1,
                padding: 0,
              }}
              aria-label={`Șterge tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}

        <input
          id={id}
          value={inputValue}
          onFocus={() => setOpenList(true)}
          onChange={(e) => {
            setInputValue(e.target.value);
            setOpenList(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={tags.length ? "" : placeholder}
          style={{
            flex: 1,
            minWidth: 80,
            border: "none",
            outline: "none",
            fontSize: "0.85rem",
            background: "transparent",
          }}
        />
      </div>

      {note && (
        <div style={{ fontSize: "0.7rem", opacity: 0.7, marginTop: 4 }}>
          {note}
        </div>
      )}

      {tags.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          style={{
            marginTop: 4,
            fontSize: "0.7rem",
            textDecoration: "underline",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            opacity: 0.7,
          }}
        >
          Șterge toate valorile
        </button>
      )}

      {openList && (
        <div className={styles.tagsList}>
          <div className={styles.tagsListHeader}>
            <span className={styles.tagsListHeaderTitle}>
              {label || "Sugestii"}
            </span>

            <button
              type="button"
              onClick={() => setOpenList(false)}
              aria-label="Închide lista de sugestii"
              className={styles.tagsListCloseBtn}
            >
              ×
            </button>
          </div>

          {suggestions.length > 0 ? (
            suggestions.map((opt) => (
              <div
                key={opt}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addTag(opt)}
                className={styles.tagsListItem}
              >
                {opt}
              </div>
            ))
          ) : (
            <div className={styles.tagsListEmpty}>
              Nicio sugestie – poți folosi varianta tastată de tine.
            </div>
          )}
        </div>
      )}
    </div>
  );
}