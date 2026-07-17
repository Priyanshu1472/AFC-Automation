// src/components/ui/Divider.jsx

/**
 * Props:
 *  label — string (optional centered label)
 */
export default function Divider({ label, className = "" }) {
  if (label) return <div className={`divider-label ${className}`.trim()}>{label}</div>;
  return <hr className={`divider ${className}`.trim()} />;
}