// Lets the Person Responsible fix the submission deadline on a lead that's
// already been MD-approved — every other field is locked once a lead
// reaches md_approved, but a deadline typed in wrong (or needing to be
// pushed because the real submission hasn't actually happened yet) should
// still be fixable. This is a standalone card, not a slot in the generic
// "Your Action" card above — that card is suppressed outright for every
// terminal status (see LeadDetailPage's isTerminal), md_approved included,
// so this needed its own always-checked visibility condition instead.
//
// leads.submission_deadline is the only copy of this date — Proposal
// Preparation reads it straight off the lead via a live join wherever it's
// needed (ProposalPreparationPage's own fetch, can_edit_proposal(), the
// proposal chat's close condition), so saving it here is already "the date
// in the connected proposal" updating too, with nothing to sync.
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import DatePickerCalendar from "../ui/DatePickerCalendar";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function EditDueDatePanel({ leadId, submissionDeadline, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(submissionDeadline || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!value) { setError("Pick a date."); return; }
    setBusy(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("update-lead-due-date", { body: { lead_id: leadId, submission_deadline: value } });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to update the date.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to update the date."); return; }
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err.message || "Failed to update the date.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="ar-action-card">
      <Card.Header title="Submission Deadline" />
      <Card.Body className="ar-action-body">
        {!editing ? (
          <>
            <Alert variant="info">
              This lead has been approved, so every other field is locked — but as Person Responsible you can still correct the submission deadline. The proposal uses this same date, so it updates there too.
            </Alert>
            <div className="ar-field">
              <label className="ar-label">Current Date</label>
              <strong>{fmtDate(submissionDeadline)}</strong>
            </div>
            <Button size="sm" onClick={() => { setValue(submissionDeadline || ""); setEditing(true); }}>Edit Due Date</Button>
          </>
        ) : (
          <>
            <div className="ar-field">
              <label className="ar-label">New Due Date</label>
              <DatePickerCalendar value={value} onChange={setValue} />
            </div>
            {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button size="sm" loading={busy} onClick={handleSave}>Save</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>Cancel</Button>
            </div>
          </>
        )}
      </Card.Body>
    </Card>
  );
}
