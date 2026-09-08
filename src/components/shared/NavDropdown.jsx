import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation } from "react-router-dom";

const MOBILE_BREAKPOINT = 720;

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
  const [panelStyle, setPanelStyle] = useState(null);
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const location = useLocation();
  const isActive = items.some((it) => location.pathname.startsWith(it.to));

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (
        wrapRef.current && !wrapRef.current.contains(e.target) &&
        (!panelRef.current || !panelRef.current.contains(e.target))
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Desktop only: the trigger lives in the left rail, which has
  // overflow-y: auto — per the CSS overflow spec that implicitly forces
  // overflow-x to auto too, silently clipping this panel wherever it
  // spilled past the rail's width. Positioning it via a portal + fixed
  // coordinates (computed from the trigger's on-screen position) escapes
  // that clipping. On mobile the panel instead renders inline inside the
  // drawer (see the position: static override in AppHeader.css) — no
  // portal there, since it's meant to push the drawer's content down.
  useLayoutEffect(() => {
    if (!open || window.innerWidth <= MOBILE_BREAKPOINT) {
      setPanelStyle(null);
      return;
    }
    function updatePosition() {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      setPanelStyle({ position: "fixed", top: rect.bottom + 4, left: rect.left, minWidth: rect.width });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  function handleItemClick() {
    setOpen(false);
    onNavigate?.();
  }

  const panel = (
    <div className="nav-dropdown-panel" role="menu" ref={panelRef} style={panelStyle || undefined}>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} className={({ isActive: navActive }) => `nav-dropdown-item${navActive ? " active" : ""}`} role="menuitem" onClick={handleItemClick}>
          {it.label}
        </NavLink>
      ))}
    </div>
  );

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

      {open && (panelStyle ? createPortal(panel, document.body) : panel)}
    </div>
  );
}
