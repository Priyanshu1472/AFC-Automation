// src/components/ui/Modal.jsx
// Built on the .modal-backdrop/.modal/.modal-header/.modal-body/.modal-footer
// classes already defined in App.css (previously unused by any component).
import { createPortal } from "react-dom";

/**
 * Modal, Modal.Header, Modal.Body, Modal.Footer
 *
 * Usage:
 *  <Modal onClose={...} size="lg">
 *    <Modal.Header title="Raise Compliance Hold" onClose={...} />
 *    <Modal.Body>...</Modal.Body>
 *    <Modal.Footer>...</Modal.Footer>
 *  </Modal>
 */
function Modal({ children, onClose, size, closeOnBackdrop = true }) {
  return createPortal(
    <div className="modal-backdrop" onClick={() => closeOnBackdrop && onClose?.()}>
      <div className={`modal${size ? ` modal-${size}` : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body
  );
}

Modal.Header = function ModalHeader({ title, subtitle, onClose }) {
  return (
    <div className="modal-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", marginTop: 2 }}>{subtitle}</p>}
      </div>
      {onClose && (
        <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", display: "flex" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      )}
    </div>
  );
};

Modal.Body = function ModalBody({ children, className = "" }) {
  return <div className={`modal-body ${className}`.trim()}>{children}</div>;
};

Modal.Footer = function ModalFooter({ children }) {
  return <div className="modal-footer">{children}</div>;
};

export default Modal;
