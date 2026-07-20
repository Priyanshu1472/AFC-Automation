import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// items: [{ to, label }]
export default function NavDropdown({ label, items, onNavigate }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const location = useLocation();
  const isActive = items.some((it) => location.pathname.startsWith(it.to));

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleItemClick() {
    setOpen(false);
    onNavigate?.();
  }

  return (
    <div className="nav-dropdown-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`nav-dropdown-trigger${isActive ? " active" : ""}`}
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <span className={`nav-dropdown-chevron${open ? " nav-dropdown-chevron-open" : ""}`} aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div className="nav-dropdown-panel" role="menu">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} className={({ isActive: navActive }) => `nav-dropdown-item${navActive ? " active" : ""}`} role="menuitem" onClick={handleItemClick}>
              {it.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
