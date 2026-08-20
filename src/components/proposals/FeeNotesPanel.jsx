// Fee Notes card for Proposal Preparation — EMD / Tender Fee / PBG,
// independently tracked (unique proposal_id+note_type) but creatable
// together: "Prepare Fee Notes" opens one form where any combination of the
// three can be checked and saved/submitted in a single call. MD approval
// happens inline per-note via FeeNoteOtpModal (OTP-gated, mirrors the lead
// conversion MD approval flow).
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Modal from "../../components/ui/Modal";
import FeeNoteOtpModal from "./FeeNoteOtpModal";
import { FEE_NOTE_TYPES, FEE_NOTE_STATUS_LABELS, FEE_NOTE_STATUS_VARIANTS } from "../../lib/proposalPrep";

function FeeNoteForm({ proposalId, feeNotes, onClose, onSaved }) {
  const byType = Object.fromEntries(feeNotes.map((n) => [n.note_type, n]));
  const editableTypes = FEE_NOTE_TYPES.filter((t) => !byType[t.key] || ["draft", "rejected"].includes(byType[t.key].status));
  const lockedTypes = FEE_NOTE_TYPES.filter((t) => byType[t.key] && ["pending_md", "approved"].includes(byType[t.key].status));

  const [selected, setSelected] = useState(() => new Set(editableTypes.filter((t) => byType[t.key]).map((t) => t.key)));
  const [fields, setFields] = useState(() =>
    Object.fromEntries(editableTypes.map((t) => [t.key, {
      amount: byType[t.key]?.amount ?? "",
      justification: byType[t.key]?.justification ?? "",
    }]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function setField(key, field, value) {
    setFields((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function handleSave(submit) {
    if (selected.size === 0) { setError("Select at least one fee note type."); return; }
    for (const key of selected) {
      if (!fields[key]?.justification?.trim()) {
        setError(`Justification is required for ${FEE_NOTE_TYPES.find((t) => t.key === key)?.label}.`);
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      const notes = [...selected].map((key) => ({
        note_type: key,
        amount: fields[key].amount === "" ? null : Number(fields[key].amount),
        justification: fields[key].justification.trim(),
        submit,
      }));
      const { data, error: fnError } = await supabase.functions.invoke("save-fee-notes", {
        body: { proposal_id: proposalId, notes },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to save fee notes.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to save fee notes."); return; }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={!saving ? onClose : undefined} size="lg" closeOnBackdrop={!saving}>
      <Modal.Header title="Prepare Fee Notes" subtitle="Check the notes this project needs — save as draft, or submit straight for MD approval." onClose={!saving ? onClose : undefined} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        {lockedTypes.length > 0 && (
          <Alert variant="info">
            {lockedTypes.map((t) => `${t.label} is ${byType[t.key].status === "pending_md" ? "awaiting MD approval" : "already approved"}.`).join(" ")}
          </Alert>
        )}
        {editableTypes.map((t) => (
          <div key={t.key} className="pp-fee-note-field">
            <label className="pp-fee-note-check">
              <input type="checkbox" checked={selected.has(t.key)} onChange={() => toggle(t.key)} />
              <span>{t.label}</span>
            </label>
            {selected.has(t.key) && (
              <div className="pp-fee-note-inputs">
                <div className="field">
                  <label className="field-label">Amount (₹)</label>
                  <input type="number" min="0" step="0.01" className="input" value={fields[t.key].amount} onChange={(e) => setField(t.key, "amount", e.target.value)} placeholder="Optional" />
                </div>
                <div className="field">
                  <label className="field-label">Justification <span className="required">*</span></label>
                  <textarea className="input" rows={2} value={fields[t.key].justification} onChange={(e) => setField(t.key, "justification", e.target.value)} placeholder="Why this note is needed for this project" />
                </div>
              </div>
            )}
          </div>
        ))}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button variant="secondary" loading={saving} onClick={() => handleSave(false)}>Save Draft</Button>
        <Button variant="primary" loading={saving} onClick={() => handleSave(true)}>Submit for MD Approval</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default function FeeNotesPanel({ proposalId, feeNotes, canManage, isMd, locked, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [mdAction, setMdAction] = useState(null); // { feeNoteId, decision, remark }
  const byType = Object.fromEntries(feeNotes.map((n) => [n.note_type, n]));

  return (
    <Card>
      <Card.Header
        title="Fee Notes"
        subtitle="EMD, Tender Fee, and PBG notes go to the MD for approval — independently, or all together."
        action={canManage && !locked && <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>Prepare Fee Notes</Button>}
      />
      <Card.Body>
        <div className="pp-fee-note-grid">
          {FEE_NOTE_TYPES.map((t) => {
            const note = byType[t.key];
            return (
              <div key={t.key} className="pp-fee-note-card">
                <div className="pp-fee-note-card-head">
                  <span className="pp-fee-note-card-title">{t.label}</span>
                  <Badge variant={note ? FEE_NOTE_STATUS_VARIANTS[note.status] : "neutral"}>
                    {note ? FEE_NOTE_STATUS_LABELS[note.status] : "Not started"}
                  </Badge>
                </div>
                {note && (
                  <div className="pp-fee-note-card-body">
                    {note.amount != null && <div className="pp-fee-note-amount">₹{Number(note.amount).toLocaleString("en-IN")}</div>}
                    {note.justification && <p className="pp-fee-note-justification">{note.justification}</p>}
                    {note.status === "rejected" && note.md_remark && (
                      <p className="pp-fee-note-remark">MD remark: {note.md_remark}</p>
                    )}
                  </div>
                )}
                {isMd && note?.status === "pending_md" && (
                  <div className="pp-fee-note-md-actions">
                    <Button variant="secondary" size="sm" onClick={() => setMdAction({ feeNoteId: note.id, decision: "rejected", remark: "" })}>Reject</Button>
                    <Button variant="primary" size="sm" onClick={() => setMdAction({ feeNoteId: note.id, decision: "approved", remark: "" })}>Approve</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card.Body>

      {showForm && (
        <FeeNoteForm proposalId={proposalId} feeNotes={feeNotes} onClose={() => setShowForm(false)} onSaved={onChanged} />
      )}

      {mdAction && (
        <FeeNoteOtpModal
          feeNoteId={mdAction.feeNoteId}
          decision={mdAction.decision}
          remark={mdAction.remark}
          onClose={() => setMdAction(null)}
          onSuccess={() => { setMdAction(null); onChanged(); }}
        />
      )}
    </Card>
  );
}
