// src/components/ui/Tooltip.jsx
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Props:
 *  text     — string (tooltip content)
 *  position — "top" | "bottom" | "left" | "right"  (default: "top")
 *  delay    — ms before showing (default: 400)
 */
export default function Tooltip({ text, position = "top", delay = 400, children }) {
  const [visible, setVisible] = useState(false);
  const [coords,  setCoords]  = useState({ top: 0, left: 0 });
  const timerRef              = useRef(null);
  const wrapperRef            = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!text) return children;

  function calcCoords() {
    if (!wrapperRef.current) return;
    const r   = wrapperRef.current.getBoundingClientRect();
    const GAP = 8;
    let top, left;
    switch (position) {
      case "bottom": top = r.bottom + GAP; left = r.left + r.width / 2;  break;
      case "left":   top = r.top + r.height / 2; left = r.left - GAP;   break;
      case "right":  top = r.top + r.height / 2; left = r.right + GAP;  break;
      default:       top = r.top - GAP;   left = r.left + r.width / 2;  break;
    }
    setCoords({ top, left });
  }

  function show() { timerRef.current = setTimeout(() => { calcCoords(); setVisible(true); }, delay); }
  function hide() { clearTimeout(timerRef.current); setVisible(false); }

  return (
    <>
      <span ref={wrapperRef} className="tt-wrapper"
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
        {children}
      </span>
      {visible && createPortal(
        <div className={`tt-box tt-${position}`}
          style={{ position: "fixed", top: coords.top, left: coords.left, zIndex: 99999 }}
          role="tooltip">
          {text}
          <span className="tt-arrow" />
        </div>,
        document.body
      )}
    </>
  );
}