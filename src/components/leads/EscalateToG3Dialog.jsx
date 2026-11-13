// PMT's "Escalate to G3" dialog — shared by two trigger points:
//  - Directly from a pmt_review lead's own "Your Action" panel
//    (requireConflictLeads=true — PMT must name at least one other lead
//    it conflicts with).
//  - From the Cross-Team Query panel, forwarding an open query straight
//    to G3 instead of Add to Chat / Forward to MD (requireConflictLeads
//    =false and queryId set — the raiser already flagged a conflict with
//    THIS lead; PMT may optionally add a further specific one, but isn't
//    required to).
// Either way it calls the same escalate-lead-to-g3 edge function.
import { useState, useEffect } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import MultiSelect from "../ui/MultiSelect";
import PinInput from "../ui/PinInput";

export default function EscalateToG3Dialog({ leadId, queryId, requireConflictLeads = true, onClose, onEscalated }) {
  const { showToast } = useToast();

  const [conflictLeadOptions, setConflictLeadOptions] = useState([]);
  const [selectedConflictIds, setSelectedConflictIds] = useState([]);
  const [g3MemberOptions, setG3MemberOptions] = useState([]);
  const [selectedG3Ids, setSelectedG3Ids] = useState([]);
  const [remarks, setRemarks] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Any other lead org-wide, any team, any eligible stage (mirrors
    // escalate-lead-to-g3's own INELIGIBLE_CONFLICT_STATUSES) — PMT
    // already has org-wide can_view_lead, no new RPC needed.
    supabase
      .from("leads")
      .select("id, lead_number, title, team")
      .not("status", "in", "(po_assignment,g3_review,md_approved,md_declined,pa_dropped)")
      .neq("id", leadId)
      .order("team")
      .order("lead_number")
      .then(({ data }) => setConflictLeadOptions(data || []));
    supabase
      .from("afc_users")
      .select("id, full_name, team")
      .eq("committee", "G3")
      .eq("is_active", true)
      .order("full_name")
      .then(({ data }) => setG3MemberOptions(data || []));
  }, [leadId]);

  async function confirm() {
    if (requireConflictLeads && !selectedConflictIds.length) {
      showToast("Select at least one conflicting lead to escalate to G3.", "danger");
      return;
    }
    if (!selectedG3Ids.length) {
      showToast("Select at least one G3 committee member to escalate to.", "danger");
      return;
    }
    if (!remarks.trim()) {
      showToast("Remarks are required.", "danger");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      showToast("Enter your 4-digit PIN.", "danger");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("escalate-lead-to-g3", {
        body: {
          lead_id: leadId,
          conflict_lead_ids: selectedConflictIds,
          assigned_g3_ids: selectedG3Ids,
          comment: remarks.trim(),
          pin,
          ...(queryId ? { query_id: queryId } : {}),
        },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to escalate to G3."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to escalate to G3.", "danger");
        return;
      }
      showToast("Lead escalated to G3 for conflict review.", "success");
      onEscalated?.();
      onClose();
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={busy ? undefined : onClose} closeOnBackdrop={!busy}>
      <Modal.Header title="Escalate to G3" subtitle="Sends this lead to the G3 committee for conflict review; the MD picks which lead wins." onClose={busy ? undefined : onClose} />
      <Modal.Body>
        <div className="ar-field">
          <label className="ar-label">
            Conflicting Leads {requireConflictLeads && <span className="ar-required">*</span>}
          </label>
          <MultiSelect
            options={conflictLeadOptions.map((l) => ({ value: l.id, label: `${l.lead_number} — ${l.title}`, group: l.team }))}
            value={selectedConflictIds}
            onChange={setSelectedConflictIds}
            placeholder={conflictLeadOptions.length ? "Search by lead number or title" : "No other eligible leads found."}
            disabled={busy}
          />
          <span className="field-hint">
            {requireConflictLeads
              ? "Select the leads this one conflicts with."
              : "Optional — add a specific conflicting lead if you know of one."}
          </span>
        </div>
        <div className="ar-field">
          <label className="ar-label">
            Escalate To <span className="ar-required">*</span>
          </label>
          <MultiSelect
            options={g3MemberOptions.map((u) => ({ value: u.id, label: `${u.full_name} — ${u.team || "—"}` }))}
            value={selectedG3Ids}
            onChange={setSelectedG3Ids}
            placeholder={g3MemberOptions.length ? "Search G3 committee members" : "No active G3 committee members found."}
            disabled={busy}
          />
          <span className="field-hint">Only the G3 members selected here will see this escalation.</span>
        </div>
        <div className="ar-field">
          <label className="ar-label">
            Remarks <span className="ar-required">*</span>
          </label>
          <textarea
            className="input"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Reason for escalating to G3…"
            disabled={busy}
          />
        </div>
        <div className="ar-field">
          <PinInput label="Your Action PIN" required value={pin} onChange={setPin} disabled={busy} hint="Confirms it's really you" />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} disabled={busy} onClick={confirm}>
          Confirm: Escalate to G3
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
