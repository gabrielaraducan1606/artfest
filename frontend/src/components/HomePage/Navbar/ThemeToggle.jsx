import React from "react";
import useTheme from "../../hooks/useTheme";
import styles from "./Navbar.module.css"; // pentru .iconWrapper și culorile din variabile

export default function ThemeToggle({ className = "" }) {
  const { effectiveTheme, toggle } = useTheme();
  const isDark = effectiveTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Schimbă pe tema deschisă" : "Schimbă pe tema închisă"}
      title={isDark ? "Light mode" : "Dark mode"}
      className={`${styles.iconWrapper} ${className}`}
      style={{
        width: "36px",
        height: "36px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        border: `1px solid var(--color-border)`,
        background: "var(--surface)",
        fontFamily: "var(--font-body)",
        fontWeight: 400,
        fontSize: "1rem",
        transition: "background-color 0.2s ease, color 0.2s ease"
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
        {isDark ? "☀️" : "🌙"}
      </span>
    </button>
  );
}
