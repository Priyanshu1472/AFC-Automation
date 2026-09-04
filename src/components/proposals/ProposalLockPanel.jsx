// Lock ("block") step + client outcome. A proposal locks manually (once
// submitted to the client) or automatically once the lead's own deadline
// passes — the latter only blocks further edits via can_edit_proposal()'s
// deadline check; `locked` itself still needs an explicit manual lock (via
// lock-proposal, which has no deadline guard) before the outcome can be
// recorded, so there's always a clear moment someone confirms the case is
// closed for editing.
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import { CLIENT_RESPONSE_LABELS, CLIENT_RESPONSE_VARIANTS } from "../../lib/proposalPrep";

function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ProposalLockPanel({ proposalId, proposal, pastDeadline, canManage, onChanged }) {
  const [locking, setLocking] = useState(false);
  const [outcomeChoice, setOutcomeChoice] = useState(null); // 'awarded' | 'rejected'
  const [remark, setRemark] = useState("");
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [error, setError] = useState("");

  async function handleLock() {
    setLocking(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("lock-proposal", { body: { proposal_id: proposalId } });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to lock proposal.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to lock proposal."); return; }
      onChanged();
    } finally {
      setLocking(false);
    }
  }

  async function handleSetOutcome() {
    if (!outcomeChoice) return;
    setSavingOutcome(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("set-proposal-outcome", {
        body: { proposal_id: proposalId, outcome: outcomeChoice, remark: remark.trim() || null },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to save the client's response.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to save the client's response."); return; }
      setOutcomeChoice(null); setRemark("");
      onChanged();
    } finally {
      setSavingOutcome(false);
    }
  }

  return (
    <Card>
      <Card.Header title="Lock & Client Response" subtitle="Lock once submitted to the client, then record their answer." />
      <Card.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        {proposal.locked ? (
          <p className="text-secondary text-sm" style={{ margin: "0 0 var(--space-4)" }}>
            Locked {proposal.lock_reason === "manual" ? "manually" : "automatically (deadline passed)"} on {fmtDateTime(proposal.locked_at)}
            {proposal.locker?.full_name ? ` by ${proposal.locker.full_name}` : ""}.
          </p>
        ) : pastDeadline ? (
          <Alert variant="warning">
            The submission deadline has passed — further edits are blocked. Lock the proposal to record the client&apos;s response.
          </Alert>
        ) : (
          <p className="text-secondary text-sm" style={{ margin: "0 0 var(--space-4)" }}>
            Once the proposal is submitted to the client, lock it here — editing stops immediately either way.
          </p>
        )}

        {!proposal.locked && canManage && (
          <Button variant="danger" loading={locking} onClick={handleLock}>Lock Proposal</Button>
        )}

        {proposal.locked && (
          <div className="pp-outcome">
            <div className="pp-outcome-status">
              <span>Client Response:</span>
              <Badge variant={CLIENT_RESPONSE_VARIANTS[proposal.client_response]}>{CLIENT_RESPONSE_LABELS[proposal.client_response]}</Badge>
            </div>
            {proposal.client_response !== "pending" && (
              <p className="text-secondary text-sm" style={{ margin: "var(--space-2) 0 0" }}>
                Recorded {fmtDateTime(proposal.client_response_at)}
                {proposal.responder?.full_name ? ` by ${proposal.responder.full_name}` : ""}.
                {proposal.client_response_remark ? ` "${proposal.client_response_remark}"` : ""}
              </p>
            )}
            {proposal.client_response === "pending" && canManage && (
              <div className="pp-outcome-form">
                <div className="pp-outcome-buttons">
                  <Button variant={outcomeChoice === "awarded" ? "primary" : "secondary"} size="sm" onClick={() => setOutcomeChoice("awarded")}>Awarded</Button>
                  <Button variant={outcomeChoice === "rejected" ? "danger" : "secondary"} size="sm" onClick={() => setOutcomeChoice("rejected")}>Rejected</Button>
                </div>
                {outcomeChoice && (
                  <>
                    <textarea className="input" rows={2} placeholder="Remark (optional)" value={remark} onChange={(e) => setRemark(e.target.value)} style={{ marginTop: 8 }} />
                    <Button variant="primary" size="sm" loading={savingOutcome} onClick={handleSetOutcome} style={{ marginTop: 8 }}>Save Response</Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
