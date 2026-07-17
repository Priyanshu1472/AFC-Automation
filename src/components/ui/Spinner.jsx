// src/components/ui/Spinner.jsx

/**
 * Props:
 *  size  — "sm" | "md" | "lg"  (default: "md")
 *  label — string (screen-reader text)
 */
export default function Spinner({ size = "md", label = "Loading…" }) {
  const cls = size === "sm" ? "spinner spinner-sm"
            : size === "lg" ? "spinner spinner-lg"
            : "spinner";
  return <span className={cls} role="status" aria-label={label} />;
}