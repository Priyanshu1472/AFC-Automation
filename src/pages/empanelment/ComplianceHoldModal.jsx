import { useState } from "react";
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
          className="input"
          rows={2}
          placeholder="Explain what's wrong with this field..."
          value={comment}
          onChange={(e) => onCommentChange(fieldKey, e.target.value)}
        />
      )}
    </div>
  );
}

export default function ComplianceHoldModal({ applicationId, onClose, onSuccess }) {
  const [selected, setSelected] = useState({}); // { fieldKey: commentText }
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
    <Modal onClose={onClose} size="lg" closeOnBackdrop={!submitting}>
      <Modal.Header title="Raise Compliance Hold" subtitle="Flag the specific fields or documents that need correction. The BA will be emailed and can only edit what you flag here." onClose={!submitting ? onClose : undefined} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <div className="chm-section">
          <h4 className="chm-section-title">Form Fields</h4>
          <div className="chm-list">
            {Object.entries(FLAGGABLE_TEXT_FIELDS).map(([key, label]) => (
              <FieldRow key={key} fieldKey={key} label={label} checked={key in selected} comment={selected[key] || ""} onToggle={toggle} onCommentChange={setComment} />
            ))}
          </div>
        </div>
        <div className="chm-section">
          <h4 className="chm-section-title">Documents</h4>
          <div className="chm-list">
            {Object.entries(FLAGGABLE_DOCUMENT_SLOTS).map(([slot, label]) => (
              <FieldRow key={`doc:${slot}`} fieldKey={`doc:${slot}`} label={label} checked={`doc:${slot}` in selected} comment={selected[`doc:${slot}`] || ""} onToggle={toggle} onCommentChange={setComment} />
            ))}
          </div>
        </div>
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
