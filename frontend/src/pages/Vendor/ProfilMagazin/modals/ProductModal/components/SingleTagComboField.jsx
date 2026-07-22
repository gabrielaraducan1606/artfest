import { useEffect, useMemo, useRef, useState } from "react";
import styles from "../../../components/css/ProductModal.module.css";

export default function SingleTagComboField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  note,
}) {
  const [inputValue, setInputValue] = useState(value || "");
  const [openList, setOpenList] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  useEffect(() => {
    if (!openList) return;

    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpenList(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, [openList]);

  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const suggestions = useMemo(() => {
    const q = normalize(inputValue);

    return options
      .filter((opt) => !q || normalize(opt).includes(q))
      .slice(0, 20);
  }, [options, inputValue]);

  return (
    <div ref={wrapRef} style={{ marginBottom: 12 }}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}

      <input
        id={id}
        className={styles.input}
        value={inputValue}
        placeholder={placeholder}
        onFocus={() => setOpenList(true)}
        onChange={(e) => {
          setInputValue(e.target.value);
          onChange(e.target.value);
          setOpenList(true);
        }}
      />

      {note && (
        <div
          style={{
            fontSize: "0.7rem",
            opacity: 0.7,
            marginTop: 4,
          }}
        >
          {note}
        </div>
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
              className={styles.tagsListCloseBtn}
            >
              ×
            </button>
          </div>

          {suggestions.length ? (
            suggestions.map((opt) => (
              <div
                key={opt}
                className={styles.tagsListItem}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setInputValue(opt);
                  onChange(opt);
                  setOpenList(false);
                }}
              >
                {opt}
              </div>
            ))
          ) : (
            <div className={styles.tagsListEmpty}>
              Nicio sugestie.
            </div>
          )}
        </div>
      )}
    </div>
  );
}