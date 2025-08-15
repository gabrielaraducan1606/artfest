import { useEffect, useState } from "react";

const LS_KEY = "theme"; // "light" | "dark"

export function getSystemPref() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
}

export default function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    return saved || null; // null => lasă sistemul să decidă
  });

  useEffect(() => {
    const html = document.documentElement;

    if (theme === "light" || theme === "dark") {
      html.setAttribute("data-theme", theme);
      localStorage.setItem(LS_KEY, theme);
    } else {
      // reset la alegerea sistemului
      html.removeAttribute("data-theme");
      localStorage.removeItem(LS_KEY);
    }
  }, [theme]);

  const effectiveTheme = theme || getSystemPref();
  const toggle = () => setTheme(effectiveTheme === "dark" ? "light" : "dark");
  const setLight = () => setTheme("light");
  const setDark = () => setTheme("dark");
  const setSystem = () => setTheme(null);

  return { theme, effectiveTheme, toggle, setLight, setDark, setSystem };
}
