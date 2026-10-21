// Lock & Client Response — one card that walks the proposal through
// Preparation → Submitted & Locked → Client Response → Monitoring, with the
// single action due at each step shown inline (no overlay). A proposal
// locks manually once submitted (lock-proposal, which also requires the
// proposed value); the deadline passing only blocks edits via
// can_edit_proposal(), so someone still confirms the lock before the
// outcome can be recorded. The outcome is recorded once
// (set-proposal-outcome); "Awarded" opens the project in Monitoring.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ConfirmDialog from "../ui/ConfirmDialog";
import { LockIcon, CheckCircleIcon, CloseIcon, ActivityIcon, ArrowRightIcon } from "../icons";
import { formatINR } from "../../lib/monitoring";

function fmtDateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ProposalLockPanel({ proposal, pastDeadline, canManage, monitoringProjectId, onChanged }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(null); // 'lock' | 'outcome'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState(null); // 'awarded' | 'rejected'
  const [remark, setRemark] = useState("");

  const response = proposal.client_response;
  const steps = [
    { key: "prep", label: "Preparation", sub: proposal.locked ? "Done" : pastDeadline ? "Deadline passed" : "In progress" },
    { key: "lock", label: "Submitted & Locked", sub: proposal.locked ? fmtDateTime(proposal.locked_at) : "Pending" },
    {
      key: "response",
      label: "Client Response",
      sub: response === "awarded" ? "Awarded" : response === "rejected" ? "Not awarded" : proposal.locked ? "Awaiting" : "—",
    },
    { key: "monitoring", label: "Monitoring", sub: response === "awarded" ? "Open" : response === "rejected" ? "Not applicable" : "After award" },
  ];
  const currentIndex = !proposal.locked ? 0 : response === "pending" ? 2 : 3;

  function stepState(i) {
    if (response === "rejected" && i === 3) return "skipped";
    if (response === "rejected" && i === 2) return "failed";
    if (i < currentIndex || (i === 3 && response === "awarded")) return "done";
    if (i === currentIndex) return "current";
    return "upcoming";
  }

  async function run(fn, body, fallback) {
    setBusy(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke(fn, { body });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, fallback)); return false; }
      if (!data?.success) { setError(data?.error || fallback); return false; }
      onChanged();
      return true;
    } catch (err) {
      setError(err.message || fallback);
      return false;
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const needsValue = proposal.proposed_value == null;

  return (
    <Card className="pp-flow-card">
      <div className="pp-flow-head">
        <span className="pp-flow-head-icon" aria-hidden="true"><LockIcon /></span>
        <div>
          <h2>Lock &amp; Client Response</h2>
          <p>Lock the proposal once it’s submitted, then record what the client decided.</p>
        </div>
      </div>

      <ol className="pp-flow-steps">
        {steps.map((s, i) => (
          <li key={s.key} className={`pp-flow-step is-${stepState(i)}`}>
            <span className="pp-flow-dot" aria-hidden="true">
              {stepState(i) === "done" ? <CheckCircleIcon /> : stepState(i) === "failed" ? <CloseIcon /> : i + 1}
            </span>
            <span className="pp-flow-label">{s.label}</span>
            <span className="pp-flow-sub">{s.sub}</span>
          </li>
        ))}
      </ol>

      <div className="pp-flow-body">
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        {!proposal.locked && (
          <div className="pp-flow-action">
            <div className="pp-flow-action-text">
              <strong>{pastDeadline ? "The submission deadline has passed." : "Submitted the proposal to the client?"}</strong>
              <span>
                {needsValue
                  ? "Enter the proposed value in the Financial section first — it's needed to lock."
                  : `Proposed value ${formatINR(proposal.proposed_value)}. Locking stops all further edits.`}
              </span>
            </div>
            {canManage && (
              <Button variant="danger" icon={<LockIcon />} disabled={needsValue} onClick={() => setConfirm("lock")}>Lock Proposal</Button>
            )}
          </div>
        )}

        {proposal.locked && response === "pending" && (
          canManage ? (
            <div className="pp-flow-respond">
              <strong className="pp-flow-respond-title">What did the client decide?</strong>
              <div className="pp-flow-choices" role="radiogroup" aria-label="Client response">
                <button
                  type="button"
                  role="radio"
                  aria-checked={choice === "awarded"}
                  className={`pp-flow-choice is-awarded${choice === "awarded" ? " is-selected" : ""}`}
                  onClick={() => setChoice("awarded")}
                  disabled={busy}
                >
                  <CheckCircleIcon />
                  <span><strong>Awarded</strong><small>Project moves to Monitoring</small></span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={choice === "rejected"}
                  className={`pp-flow-choice is-rejected${choice === "rejected" ? " is-selected" : ""}`}
                  onClick={() => setChoice("rejected")}
                  disabled={busy}
                >
                  <CloseIcon />
                  <span><strong>Not Awarded</strong><small>Closes the proposal here</small></span>
                </button>
              </div>
              {choice && (
                <div className="pp-flow-remark">
                  <textarea className="input" rows={2} placeholder="Remark (optional)" value={remark} onChange={(e) => setRemark(e.target.value)} disabled={busy} />
                  <Button loading={busy} onClick={() => setConfirm("outcome")}>Save Response</Button>
                </div>
              )}
            </div>
          ) : (
            <p className="pp-flow-note">Locked {fmtDateTime(proposal.locked_at)}{proposal.locker?.full_name ? ` by ${proposal.locker.full_name}` : ""}. Waiting for the Person Responsible, Reviewer, or Recommending Authority to record the client’s response.</p>
          )
        )}

        {response !== "pending" && (
          <div className={`pp-flow-result is-${response}`}>
            <span className="pp-flow-result-icon" aria-hidden="true">{response === "awarded" ? <CheckCircleIcon /> : <CloseIcon />}</span>
            <div className="pp-flow-result-text">
              <strong>{response === "awarded" ? "Awarded" : "Not awarded"}</strong>
              <span>
                Recorded {fmtDateTime(proposal.client_response_at)}{proposal.responder?.full_name ? ` by ${proposal.responder.full_name}` : ""}.
                {proposal.client_response_remark ? ` “${proposal.client_response_remark}”` : ""}
                {response === "rejected" ? " This proposal does not move to Monitoring." : ""}
              </span>
            </div>
            {response === "awarded" && monitoringProjectId && (
              <Button icon={<ActivityIcon />} iconRight={<ArrowRightIcon />} onClick={() => navigate(`/monitoring/${monitoringProjectId}`)}>
                Open Monitoring
              </Button>
            )}
          </div>
        )}
      </div>

      {confirm === "lock" && (
        <ConfirmDialog
          title="Lock this proposal?"
          message="Fee notes, documents and the proposed value can no longer be changed after locking."
          confirmLabel="Lock Proposal"
          loading={busy}
          onConfirm={() => run("lock-proposal", { proposal_id: proposal.id }, "Failed to lock the proposal.")}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "outcome" && (
        <ConfirmDialog
          title={choice === "awarded" ? "Record as Awarded?" : "Record as Not Awarded?"}
          message={choice === "awarded"
            ? "The project will open in Monitoring. The response can't be changed afterwards."
            : "The proposal will be closed and won't move to Monitoring. The response can't be changed afterwards."}
          confirmLabel="Save Response"
          variant={choice === "awarded" ? "primary" : "danger"}
          loading={busy}
          onConfirm={() => run("set-proposal-outcome", { proposal_id: proposal.id, outcome: choice, remark: remark.trim() || null }, "Failed to save the client's response.")}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Card>
  );
}
