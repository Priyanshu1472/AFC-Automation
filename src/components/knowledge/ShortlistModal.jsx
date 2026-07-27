import { useState } from "react";
import { createPortal } from "react-dom";
import "../../styles/ShortlistModal.css";

/**
 * ShortlistModal — shown when a user clicks "Shortlist" on a project.
 * Lets them add the project to an existing shortlist or create a new one.
 */
export default function ShortlistModal({ projectTitle, shortlists, alreadyIn = [], onAddToExisting, onCreateNew, onClose }) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState(shortlists.length > 0 ? "existing" : "new");

  const handleAddExisting = async (id) => {
    setBusy(true);
    setError("");
    try {
      await onAddToExisting(id);
      onClose();
    } catch {
      setError("Failed to add. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      setError("Please enter a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onCreateNew(newName.trim());
      onClose();
    } catch {
      setError("Failed to create. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="sl-overlay" onClick={onClose}>
      <div className="sl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sl-header">
          <div className="sl-header-title">
            <span className="sl-badge">Shortlist</span>
            <p className="sl-project-name">{projectTitle}</p>
          </div>
          <button className="sl-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="sl-tabs">
          {shortlists.length > 0 && (
            <button className={`sl-tab ${tab === "existing" ? "sl-tab-active" : ""}`} onClick={() => setTab("existing")}>
              Add to existing
            </button>
          )}
          <button className={`sl-tab ${tab === "new" ? "sl-tab-active" : ""}`} onClick={() => setTab("new")}>
            Create new
          </button>
        </div>

        <div className="sl-body">
          {tab === "existing" && (
            <div className="sl-list">
              {shortlists.length === 0 ? (
                <p className="sl-empty">No shortlists yet. Create one first.</p>
              ) : (
                shortlists.map((sl) => {
                  const added = alreadyIn.includes(sl.id);
                  return (
                    <button
                      key={sl.id}
                      className={`sl-list-item ${added ? "sl-list-item-added" : ""}`}
                      onClick={() => !added && handleAddExisting(sl.id)}
                      disabled={busy || added}
                    >
                      <span className="sl-list-icon">{added ? "✓" : "+"}</span>
                      <span className="sl-list-name">{sl.name}</span>
                      {added && <span className="sl-list-badge">Already added</span>}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {tab === "new" && (
            <div className="sl-new-form">
              <label className="sl-new-label">Shortlist name</label>
              <input
                className="sl-new-input"
                placeholder="e.g. Smart City Projects, Q1 Proposals…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
              <button className="sl-create-btn" onClick={handleCreate} disabled={busy || !newName.trim()}>
                {busy ? "Creating…" : "Create & Add Project"}
              </button>
            </div>
          )}

          {error && <p className="sl-error">{error}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
