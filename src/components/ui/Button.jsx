// src/components/ui/Button.jsx

/**
 * Button
 *
 * Props:
 *  variant   — "primary" | "secondary" | "ghost" | "danger"  (default: "primary")
 *  size      — "sm" | "md" | "lg"                            (default: "md")
 *  loading   — bool  (shows spinner, disables click)
 *  disabled  — bool
 *  block     — bool  (full width)
 *  icon      — ReactNode  (placed before children)
 *  iconRight — ReactNode  (placed after children)
 *  type      — "button" | "submit" | "reset"                 (default: "button")
 *  onClick, className, style, ...rest passed through
 */
export default function Button({
  children,
  variant   = "primary",
  size      = "md",
  loading   = false,
  disabled  = false,
  block     = false,
  icon,
  iconRight,
  type      = "button",
  className = "",
  style,
  ...rest
}) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "",
    block   ? "btn-block"   : "",
    loading ? "btn-loading" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      style={style}
      {...rest}
    >
      {loading ? (
        <>
          <span className="spinner spinner-sm" aria-hidden="true" />
          <span>{children}</span>
        </>
      ) : (
        <>
          {icon      && <span className="btn-icon-left"  aria-hidden="true">{icon}</span>}
          {children  && <span>{children}</span>}
          {iconRight && <span className="btn-icon-right" aria-hidden="true">{iconRight}</span>}
        </>
      )}
    </button>
  );
}