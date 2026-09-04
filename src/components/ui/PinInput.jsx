import { useRef } from "react";
import "../../styles/PinInput.css";

/**
 * PinInput — a segmented numeric code entry (one box per digit), digits
 * only. Controlled the same way as a plain text Input: `value` is a single
 * string, `onChange` receives the next full string (not an event) — swap
 * `<Input type="password" inputMode="numeric" .../>` for this directly.
 *
 * Props:
 *  length    — number of boxes (default 4)
 *  value     — the current PIN string, e.g. "12"
 *  onChange  — (nextValue: string) => void
 *  label     — string
 *  required  — bool
 *  hint      — string
 *  error     — string
 *  disabled  — bool
 *  autoFocus — bool (focuses the first box)
 */
export default function PinInput({ length = 4, value = "", onChange, label, required, hint, error, disabled, autoFocus, id }) {
  const inputRefs = useRef([]);
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : "pin-input");
  const digits = Array.from({ length }, (_, i) => value[i] || "");

  function setDigitAt(index, char) {
    const next = digits.slice();
    next[index] = char;
    onChange(next.join("").slice(0, length));
  }

  function handleChange(index, raw) {
    const digitsOnly = raw.replace(/\D/g, "");
    if (!digitsOnly) {
      setDigitAt(index, "");
      return;
    }
    // Distribute a multi-char paste/autofill across boxes starting here.
    if (digitsOnly.length > 1) {
      const next = digits.slice();
      for (let i = 0; i < digitsOnly.length && index + i < length; i++) next[index + i] = digitsOnly[i];
      onChange(next.join("").slice(0, length));
      const nextIndex = Math.min(index + digitsOnly.length, length - 1);
      inputRefs.current[nextIndex]?.focus();
      return;
    }
    setDigitAt(index, digitsOnly);
    if (index < length - 1) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index, e) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(index, e) {
    e.preventDefault();
    handleChange(index, e.clipboardData.getData("text"));
  }

  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={`${inputId}-0`}>
          {label}
          {required && <span className="required" aria-hidden="true"> *</span>}
        </label>
      )}
      <div className={`pin-input-row${error ? " pin-input-row-error" : ""}`} role="group" aria-label={label}>
        {digits.map((digit, i) => (
          <input
            key={i}
            id={`${inputId}-${i}`}
            ref={(el) => (inputRefs.current[i] = el)}
            className="pin-input-box"
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            aria-invalid={!!error}
          />
        ))}
      </div>
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}
