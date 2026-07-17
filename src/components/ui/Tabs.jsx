// src/components/ui/Tabs.jsx

/**
 * Tabs — pill-style tab switcher
 *
 * Props:
 *  tabs      — [{ id, label, icon? }]
 *  active    — current active id
 *  onChange  — (id) => void
 *  fullWidth — bool (each tab stretches equally)
 */
export default function Tabs({ tabs = [], active, onChange, fullWidth = false, className = "" }) {
  return (
    <div className={`tabs ${fullWidth ? "tabs-full" : ""} ${className}`.trim()} role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={`tab-item${active === t.id ? " tab-active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <span className="tab-icon" aria-hidden="true">{t.icon}</span>}
          {t.label}
        </button>
      ))}
    </div>
  );
}