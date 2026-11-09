import { createPortal } from "react-dom";
import "../../styles/MissingDetailsModal.css";

/**
 * MissingDetailsModal — shown when a user clicks a project's "Missing
 * Details" button in the Knowledge Repository list. Purely informational:
 * lists exactly which fields (from projectCompleteness.js) are still blank
 * on that project.
 */
export default function MissingDetailsModal({ projectTitle, missingFields, onClose }) {
  return createPortal(
    <div className="md-overlay" onClick={onClose}>
      <div className="md-modal" onClick={(e) => e.stopPropagation()}>
        <div className="md-header">
          <div className="md-header-title">
            <span className="md-badge">⚠ Missing Details</span>
            <p className="md-project-name">{projectTitle}</p>
          </div>
          <button className="md-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="md-body">
          {missingFields.length === 0 ? (
            <p className="md-empty">Nothing missing — every field is filled in.</p>
          ) : (
            <ul className="md-list">
              {missingFields.map((label) => (
                <li key={label} className="md-list-item">{label}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
