// src/components/ui/Badge.jsx

/**
 * Badge
 *
 * Props:
 *  variant — "success" | "warning" | "danger" | "info" | "neutral" | "brand"
 *  dot     — bool (shows colored dot before text)
 *  children
 */
export default function Badge({ variant = "neutral", dot = false, children, className = "" }) {
  return (
    <span className={`badge badge-${variant} ${className}`.trim()}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}