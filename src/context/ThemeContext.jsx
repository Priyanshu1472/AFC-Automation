import { createContext, useCallback, useEffect, useRef, useState } from "react";

export const ThemeContext = createContext(null);

const STORAGE_KEY = "afc-theme";

function getInitialTheme() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);
  // Whether the user has explicitly toggled (vs. still following the OS
  // setting). Read once at mount, not re-derived from an effect that also
  // writes storage, to avoid a same-render race between the two effects.
  const explicitRef = useRef(window.localStorage.getItem(STORAGE_KEY) !== null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (explicitRef.current) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange(e) {
      setTheme(e.matches ? "dark" : "light");
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      explicitRef.current = true;
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
