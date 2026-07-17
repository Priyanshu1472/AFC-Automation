// src/components/ui/Input.jsx
import { forwardRef } from "react";

/**
 * Input
 *
 * Props:
 *  label     — string
 *  hint      — string  (small helper text below)
 *  error     — string  (shows red error text, red border)
 *  required  — bool    (shows * on label)
 *  icon      — ReactNode (left icon inside input)
 *  iconRight — ReactNode (right icon inside input)
 *  fullWidth — bool (default true)
 */
const Input = forwardRef(function Input(
  { label, hint, error, required, icon, iconRight, fullWidth = true, className = "", id, ...rest },
  ref
) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div className={`field${fullWidth ? " w-full" : ""} ${className}`.trim()}>
      {label && (
        <label className="field-label" htmlFor={inputId}>
          {label}
          {required && <span className="required" aria-hidden="true"> *</span>}
        </label>
      )}

      <div className={["input-wrapper", icon ? "has-icon-left" : "", iconRight ? "has-icon-right" : ""].filter(Boolean).join(" ")}>
        {icon      && <span className="input-icon input-icon-left"  aria-hidden="true">{icon}</span>}
        <input
          ref={ref}
          id={inputId}
          className={`input${error ? " input-error" : ""}${iconRight ? " input-pr" : ""}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...rest}
        />
        {iconRight && <span className="input-icon input-icon-right" aria-hidden="true">{iconRight}</span>}
      </div>

      {hint  && !error && <span id={`${inputId}-hint`}  className="field-hint"               >{hint}</span>}
      {error &&           <span id={`${inputId}-error`} className="field-error" role="alert">{error}</span>}
    </div>
  );
});

export default Input;