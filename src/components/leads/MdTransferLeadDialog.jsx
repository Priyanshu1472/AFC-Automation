// MD's own, standalone "Transfer Lead" dialog — available on every lead's
// detail page, org-wide, with no Cross-Team Query needed first. Picks a
// team, then (once that team's loaded) a specific person on it, same
// get_team_members pool the Cross-Team Query transfer picker already uses.
// Calls the new md-transfer-lead edge function, which reuses the exact same
// performLeadTransfer engine as a query-triggered transfer.
import { useState, useEffect } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import { useTeamOptions } from "../../hooks/useTeamOptions";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Select from "../ui/Select";
import PinInput from "../ui/PinInput";

export default function MdTransferLeadDialog({ leadId, currentTeam, onClose, onTransferred }) {
  const { showToast } = useToast();
  const teamOptions = useTeamOptions();

  const [team, setTeam] = useState("");
  const [forwardOptions, setForwardOptions] = useState([]);
  const [forwardToId, setForwardToId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!team) {
      setForwardOptions([]);
      return;
    }
    setForwardToId("");
    supabase
      .rpc("get_team_members", { p_team: team })
      .then(({ data }) => setForwardOptions((data || []).map((u) => ({ value: u.user_id, label: u.full_name, hint: u.role }))));
  }, [team]);

  async function confirm() {
    if (!team) {
      showToast("Select a team to transfer to.", "danger");
      return;
    }
    if (!forwardToId) {
      showToast("Select who to forward the lead to.", "danger");
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
      const { data, error } = await supabase.functions.invoke("md-transfer-lead", {
        body: { lead_id: leadId, target_team: team, forwarded_to_id: forwardToId, comment: remarks.trim(), pin },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to transfer the lead."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to transfer the lead.", "danger");
        return;
      }
      showToast(`Lead transferred to ${team} as ${data.lead_number}.`, "success");
      onTransferred?.();
      onClose();
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={busy ? undefined : onClose} closeOnBackdrop={!busy}>
      <Modal.Header title="Transfer Lead" subtitle="Moves this lead to another team, under a specific person, right away." onClose={busy ? undefined : onClose} />
      <Modal.Body>
        <div className="ar-field">
          <label className="ar-label">
            Team Name <span className="ar-required">*</span>
          </label>
          <Select
            options={teamOptions.filter((t) => t !== currentTeam).map((t) => ({ value: t, label: t }))}
            value={team}
            onChange={setTeam}
            placeholder="Select a team"
            disabled={busy}
          />
        </div>
        <div className="ar-field">
          <label className="ar-label">
            Forward To: <span className="ar-required">*</span>
          </label>
          <Select
            options={forwardOptions}
            value={forwardToId}
            onChange={setForwardToId}
            placeholder={team ? (forwardOptions.length ? "Select a person on that team" : "No eligible team members found.") : "Select a team first"}
            disabled={busy || !team}
            searchable
          />
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
            placeholder="Reason for the transfer…"
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
          Confirm: Transfer Lead
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
