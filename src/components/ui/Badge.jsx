// src/components/ui/Badge.jsx

/**
 * Badge
 *
 * Props:
 *  variant — "success" | "warning" | "danger" | "info" | "neutral" | "brand" | "yellow" | "pale-green"
 *  dot     — bool (shows colored dot before text)
 *  children
 */
export default function Badge({ variant = "neutral", dot = false, children, className = "", title }) {
  return (
    <span className={`badge badge-${variant} ${className}`.trim()} title={title}>
      {dot && <span className="badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}