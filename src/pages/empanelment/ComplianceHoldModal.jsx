import { useMemo, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { FLAGGABLE_TEXT_FIELDS, FLAGGABLE_DOCUMENT_SLOTS } from "../../lib/empanelmentFields";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";

function FieldRow({ fieldKey, label, checked, comment, onToggle, onCommentChange }) {
  return (
    <div className={`chm-row${checked ? " chm-row-checked" : ""}`}>
      <label className="chm-row-label">
        <input type="checkbox" checked={checked} onChange={() => onToggle(fieldKey)} />
        <span>{label}</span>
      </label>
      {checked && (
        <textarea
          className="input chm-row-comment"
          rows={2}
          placeholder="Explain what needs correcting — the BP sees this exact note…"
          value={comment}
          onChange={(e) => onCommentChange(fieldKey, e.target.value)}
          autoFocus
        />
      )}
    </div>
  );
}

function SearchIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
}

export default function ComplianceHoldModal({ applicationId, onClose, onSuccess }) {
  const [selected, setSelected] = useState({}); // { fieldKey: commentText }
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggle(fieldKey) {
    setSelected((prev) => {
      const next = { ...prev };
      if (fieldKey in next) delete next[fieldKey];
      else next[fieldKey] = "";
      return next;
    });
  }

  function setComment(fieldKey, value) {
    setSelected((prev) => ({ ...prev, [fieldKey]: value }));
  }

  const selectedKeys = Object.keys(selected);
  const allCommented = selectedKeys.length > 0 && selectedKeys.every((k) => selected[k].trim());

  const q = query.trim().toLowerCase();
  const fieldEntries = useMemo(
    () => Object.entries(FLAGGABLE_TEXT_FIELDS).filter(([, label]) => !q || label.toLowerCase().includes(q)),
    [q]
  );
  const docEntries = useMemo(
    () => Object.entries(FLAGGABLE_DOCUMENT_SLOTS).filter(([, label]) => !q || label.toLowerCase().includes(q)),
    [q]
  );
  const noMatches = q && fieldEntries.length === 0 && docEntries.length === 0;

  async function handleSubmit() {
    if (!allCommented) { setError("Select at least one item and explain the issue for each."); return; }
    setSubmitting(true);
    setError("");
    try {
      const flags = selectedKeys.map((field_key) => ({ field_key, comment: selected[field_key].trim() }));
      const { data, error: fnError } = await supabase.functions.invoke("raise-empanelment-hold", { body: { application_id: applicationId, flags } });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to raise hold.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to raise hold."); return; }
      onSuccess(data);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose} size="lg" className="chm-modal" closeOnBackdrop={!submitting}>
      <Modal.Header title="Raise Compliance Hold" subtitle="Tick every field or document that needs correction and explain each one. The BP is emailed and can only edit what you flag here." onClose={!submitting ? onClose : undefined} />

      <div className="chm-toolbar">
        <div className="chm-search">
          <span className="chm-search-icon"><SearchIcon /></span>
          <input
            type="text"
            className="input"
            placeholder="Filter fields and documents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="chm-count">{selectedKeys.length} flagged</span>
      </div>

      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        {noMatches && <p className="chm-empty">No fields or documents match “{query}”.</p>}

        {fieldEntries.length > 0 && (
          <div className="chm-section">
            <h4 className="chm-section-title">Form Fields</h4>
            <div className="chm-list">
              {fieldEntries.map(([key, label]) => (
                <FieldRow key={key} fieldKey={key} label={label} checked={key in selected} comment={selected[key] || ""} onToggle={toggle} onCommentChange={setComment} />
              ))}
            </div>
          </div>
        )}

        {docEntries.length > 0 && (
          <div className="chm-section">
            <h4 className="chm-section-title">Documents</h4>
            <div className="chm-list">
              {docEntries.map(([slot, label]) => (
                <FieldRow key={`doc:${slot}`} fieldKey={`doc:${slot}`} label={label} checked={`doc:${slot}` in selected} comment={selected[`doc:${slot}`] || ""} onToggle={toggle} onCommentChange={setComment} />
              ))}
            </div>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" disabled={submitting} onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={submitting} disabled={!allCommented} onClick={handleSubmit}>
          {submitting ? "Raising hold..." : `Raise Hold${selectedKeys.length ? ` (${selectedKeys.length})` : ""}`}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
