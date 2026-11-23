// "Next Step" — the one card that tells you where the proposal stands and
// what has to happen now:
//   • a compact track: Preparation → Locked → Client Response → next
//   • before locking: a checklist of what locking needs (Bid Payment
//     Requisition Note, documents, proposed value), each line saying who
//     it's waiting on; click a line to jump to its section
//   • then: lock, record the client's response, and the result.
//
// Locking (lock-proposal) needs the Bid Payment Requisition Note approved,
// the proposal documents uploaded and — for an RFP / Suo Moto that isn't
// Empanelment only — the proposed value. Locking also closes the proposal
// chat. The client's response is recorded once (set-proposal-outcome) by
// the Person Responsible, Reviewer, Recommending Authority or an additional
// Person Responsible:
//   RFP / Suo Moto    Awarded (→ Monitoring) / Not Awarded
//   EOI               Project Awarded (→ Monitoring) / Moves to RFP / Tender
//                     (shortlisted; nothing to deliver yet) / Not Awarded
//   Empanelment only  Empanelled / Not Empanelled
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../ui/Card";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ConfirmDialog from "../ui/ConfirmDialog";
import { LockIcon, CheckCircleIcon, CloseIcon, ActivityIcon, ArrowRightIcon, TargetIcon, ShieldIcon, ClockIcon } from "../icons";
import { isEoiLead, isProjectAward } from "../../lib/proposalPrep";

function fmtDateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CHOICE = {
  project: {
    outcome: "awarded", awardKind: "project", tone: "good", icon: <CheckCircleIcon />,
    title: "Awarded", sub: "Project moves to Monitoring",
    confirm: "The project will open in Monitoring.",
  },
  eoi_project: {
    outcome: "awarded", awardKind: "project", tone: "good", icon: <CheckCircleIcon />,
    title: "Project Awarded", sub: "Work awarded, moves to Monitoring",
    confirm: "The project will open in Monitoring.",
  },
  next_stage: {
    outcome: "awarded", awardKind: "next_stage", tone: "info", icon: <TargetIcon />,
    title: "Moves to RFP / Tender", sub: "Shortlisted, nothing to deliver yet",
    confirm: "It's recorded as shortlisted. No Monitoring project opens, since there's nothing to deliver yet. Add the RFP / tender as a new lead when the client issues it.",
  },
  empanelled: {
    outcome: "awarded", awardKind: null, tone: "good", icon: <ShieldIcon />,
    title: "Empanelled", sub: "No Monitoring project",
    confirm: "It's recorded as empanelled. No Monitoring project opens.",
  },
  rejected: {
    outcome: "rejected", awardKind: null, tone: "bad", icon: <CloseIcon />,
    title: "Not Awarded", sub: "Closes the proposal",
    confirm: "The proposal will be closed and won't move to Monitoring.",
  },
  not_empanelled: {
    outcome: "rejected", awardKind: null, tone: "bad", icon: <CloseIcon />,
    title: "Not Empanelled", sub: "Closes the proposal",
    confirm: "The proposal will be closed.",
  },
};

function jumpTo(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  const details = el.querySelector("details");
  if (details && !details.open) details.open = true;
}

export default function ProposalLockPanel({ proposal, lead, pastDeadline, canManage, monitoringProjectId, checklist = [], onJump, bare = false, onChanged }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(null); // 'lock' | 'outcome'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState(null);
  const [remark, setRemark] = useState("");

  const response = proposal.client_response;
  const awardKind = response === "awarded" ? (proposal.award_kind || "project") : null;
  const projectAward = isProjectAward(proposal);
  const choices = proposal.empanelment_only
    ? ["empanelled", "not_empanelled"]
    : isEoiLead(lead) ? ["eoi_project", "next_stage", "rejected"] : ["project", "rejected"];

  const resultLabel = response === "rejected"
    ? (proposal.empanelment_only ? "Not Empanelled" : "Not Awarded")
    : awardKind === "next_stage" ? "Shortlisted: moves to RFP / Tender"
      : awardKind === "empanelled" ? "Empanelled" : "Awarded";

  const lastLabel = proposal.empanelment_only ? "Empanelment" : awardKind === "next_stage" ? "RFP / Tender" : "Monitoring";
  const track = [
    { key: "prep", label: "Preparation" },
    { key: "lock", label: "Locked" },
    { key: "response", label: "Client Response" },
    { key: "next", label: lastLabel },
  ];
  const currentIndex = !proposal.locked ? 0 : response === "pending" ? 2 : 3;
  function trackState(i) {
    if (response === "rejected") return i <= 1 ? "done" : i === 2 ? "failed" : "skipped";
    if (i < currentIndex) return "done";
    if (i === 3 && response === "awarded" && awardKind !== "next_stage") return "done";
    return i === currentIndex ? "current" : "upcoming";
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

  const blocking = checklist.filter((c) => c.state === "todo" || c.state === "wait");
  const canLock = blocking.length === 0;
  const picked = choice ? CHOICE[choice] : null;

  let headline;
  let subline;
  if (!proposal.locked) {
    headline = canLock ? "Ready to lock" : `${blocking.length} thing${blocking.length === 1 ? "" : "s"} left before locking`;
    subline = canLock
      ? "Lock once the proposal is submitted to the client. Locking stops all edits and closes the chat."
      : pastDeadline ? "The deadline has passed. Finish these, then lock the proposal." : "Lock the proposal once these are done and it's submitted to the client.";
  } else if (response === "pending") {
    headline = "Record the client's response";
    subline = canManage
      ? "Pick what the client decided. It can't be changed afterwards."
      : "Waiting on the Person Responsible, Reviewer or Recommending Authority.";
  } else {
    headline = resultLabel;
    subline = null;
  }

  return (
    <Card className={`pp-next-card${bare ? " pp-bare" : ""}`}>
      <div className="pp-next-head">
        <div className="pp-next-title">
          <span className="pp-next-kicker">{proposal.locked ? "Client result" : "Before locking"}</span>
          <h2>{headline}</h2>
          {subline && <p>{subline}</p>}
        </div>
        <ol className="pp-track" aria-label="Proposal progress">
          {track.map((t, i) => (
            <li key={t.key} className={`is-${trackState(i)}`}>
              <span className="pp-track-dot" aria-hidden="true">
                {trackState(i) === "done" ? <CheckCircleIcon /> : trackState(i) === "failed" ? <CloseIcon /> : null}
              </span>
              <span className="pp-track-label">{t.label}</span>
            </li>
          ))}
        </ol>
      </div>

      {error && <div className="pp-next-error"><Alert variant="danger" onClose={() => setError("")}>{error}</Alert></div>}

      {!proposal.locked && (
        <>
          <ul className="pp-checklist">
            {checklist.map((c) => (
              <li key={c.key}>
                <button type="button" className={`pp-check is-${c.state}`} onClick={() => (onJump ? onJump(c.target) : jumpTo(c.target))}>
                  <span className="pp-check-icon" aria-hidden="true">
                    {c.state === "done" ? <CheckCircleIcon /> : c.state === "wait" ? <ClockIcon /> : c.state === "na" ? <span className="pp-check-dash" /> : <span className="pp-check-ring" />}
                  </span>
                  <span className="pp-check-text">
                    <strong>{c.label}</strong>
                    <span>{c.note}</span>
                  </span>
                  <ArrowRightIcon />
                </button>
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="pp-next-actions">
              <Button
                variant={canLock ? "primary" : "secondary"}
                icon={<LockIcon />}
                disabled={!canLock}
                title={canLock ? undefined : "Finish the items above first"}
                onClick={() => setConfirm("lock")}
              >
                Lock Proposal
              </Button>
            </div>
          )}
        </>
      )}

      {proposal.locked && response === "pending" && canManage && (
        <div className="pp-next-body">
          <div className={`pp-flow-choices${choices.length === 3 ? " pp-flow-choices-3" : ""}`} role="radiogroup" aria-label="Client response">
            {choices.map((key) => {
              const c = CHOICE[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={choice === key}
                  className={`pp-flow-choice is-${c.tone}${choice === key ? " is-selected" : ""}`}
                  onClick={() => setChoice(key)}
                  disabled={busy}
                >
                  {c.icon}
                  <span><strong>{c.title}</strong><small>{c.sub}</small></span>
                </button>
              );
            })}
          </div>
          {choice && (
            <div className="pp-flow-remark">
              <textarea className="input" rows={2} maxLength={2000} placeholder="Remark (optional)" value={remark} onChange={(e) => setRemark(e.target.value)} disabled={busy} />
              <Button loading={busy} onClick={() => setConfirm("outcome")}>Save Response</Button>
            </div>
          )}
          <p className="pp-next-foot">Locked {fmtDateTime(proposal.locked_at)}{proposal.locker?.full_name ? ` by ${proposal.locker.full_name}` : ""}.</p>
        </div>
      )}

      {proposal.locked && response === "pending" && !canManage && (
        <p className="pp-next-body pp-next-foot">Locked {fmtDateTime(proposal.locked_at)}{proposal.locker?.full_name ? ` by ${proposal.locker.full_name}` : ""}.</p>
      )}

      {response !== "pending" && (
        <div className="pp-next-body">
          <div className={`pp-flow-result is-${response === "rejected" ? "rejected" : awardKind === "next_stage" ? "next" : "awarded"}`}>
            <span className="pp-flow-result-icon" aria-hidden="true">
              {response === "rejected" ? <CloseIcon /> : awardKind === "next_stage" ? <TargetIcon /> : <CheckCircleIcon />}
            </span>
            <div className="pp-flow-result-text">
              <span>
                Recorded {fmtDateTime(proposal.client_response_at)}{proposal.responder?.full_name ? ` by ${proposal.responder.full_name}` : ""}.
                {awardKind === "next_stage" ? " Add the RFP / tender as a new lead when the client issues it." : ""}
              </span>
              {proposal.client_response_remark && <p className="pp-flow-result-remark">{proposal.client_response_remark}</p>}
            </div>
            {projectAward && monitoringProjectId && (
              <Button size="sm" icon={<ActivityIcon />} iconRight={<ArrowRightIcon />} onClick={() => navigate(`/monitoring/${monitoringProjectId}`)}>
                Open Monitoring
              </Button>
            )}
          </div>
        </div>
      )}

      {confirm === "lock" && (
        <ConfirmDialog
          title="Lock this proposal?"
          message="The fee note, documents and proposed value can no longer be changed, and the proposal chat closes."
          confirmLabel="Lock Proposal"
          loading={busy}
          onConfirm={() => run("lock-proposal", { proposal_id: proposal.id }, "Failed to lock the proposal.")}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === "outcome" && picked && (
        <ConfirmDialog
          title={`Record as ${picked.title}?`}
          message={`${picked.confirm} The response can't be changed afterwards.`}
          confirmLabel="Save Response"
          variant={picked.tone === "bad" ? "danger" : "primary"}
          loading={busy}
          onConfirm={() => run(
            "set-proposal-outcome",
            { proposal_id: proposal.id, outcome: picked.outcome, award_kind: picked.awardKind, remark: remark.trim() || null },
            "Failed to save the client's response.",
          )}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Card>
  );
}
