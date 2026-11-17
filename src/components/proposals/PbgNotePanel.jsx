// PBG Note on an awarded proposal (proposal_pbg_notes, driven by the
// proposal-pbg-note edge function):
//
//   Draft            team prepares it (PbgNoteEditPage), uploads the proof
//                    and forwards it (PIN — signs as PR)
//   Pending RA       Recommending Authority approves (PIN) or raises a
//                    Clarification Request
//   Pending MD       MD approves (PIN) or raises a Clarification Request
//   With Accounts    Accounts approves (PIN) or raises a Clarification Request
//   Payment Pending  Accounts — or the team — uploads the payment proof and
//                    marks the payment done (PIN)
//   PBG Done
//
// A Clarification Request sends it back to the team; their next forward
// goes straight back to whoever asked, not to the start of the chain.
//
// `embedded` renders it as a section inside the EMD card (EmdPanel) — the
// usual case, so EMD and PBG sit together. Without an EMD on the proposal
// it's its own card, with its own Timeline button.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import { openPdfFromFunction } from "../../lib/openPdf";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import FinanceFiles from "./FinanceFiles";
import FinanceActionModal from "./FinanceActionModal";
import FinanceTimelineDrawer from "./FinanceTimelineDrawer";
import { ShieldIcon, EyeIcon, PencilIcon, ClockIcon } from "../icons";
import { formatINR } from "../../lib/monitoring";
import { PBG_NOTE_STATUS_LABELS, PBG_NOTE_STATUS_VARIANTS, PBG_STAGE_LABELS } from "../../lib/proposalPrep";

function fmtDateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STEPS = [
  { key: "draft", label: "Draft" },
  { key: "pending_ra", label: "RA" },
  { key: "pending_md", label: "MD" },
  { key: "pending_accounts", label: "Accounts" },
  { key: "pending_payment", label: "Payment" },
  { key: "completed", label: "Done" },
];

export default function PbgNotePanel({ proposal, lead, note, financeFiles, events, profile, isAccounts, additionalResponsibleIds = [], embedded = false, onChanged }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState(false);
  const [modal, setModal] = useState(null); // forward | ra_approve | md_approve | accounts_approve | mark_paid | clarify
  const [timelineOpen, setTimelineOpen] = useState(false);

  const me = profile?.id;
  const isPreparer = !!me && ([lead.person_responsible_id, lead.reviewer_id].includes(me) || additionalResponsibleIds.includes(me));
  const isTeam = isPreparer || me === lead.recommending_authority_id;
  const canEditDraft = isTeam || ["admin", "md"].includes(profile?.role);
  const isRA = me === lead.recommending_authority_id;
  const isMd = profile?.role === "md";
  const status = note?.status || null;

  const proofCount = financeFiles.filter((f) => f.purpose === "pbg").length;
  const paymentProofCount = financeFiles.filter((f) => f.purpose === "pbg_payment").length;
  const pbgEvents = events.filter((ev) => ev.scope === "pbg");

  const pbg = Number(note?.pbg_amount) || 0;
  const adjusted = Math.min(Number(note?.emd_adjusted) || 0, pbg);
  const toFurnish = Math.max(0, pbg - adjusted);

  const reviewer = (status === "pending_ra" && isRA) || (status === "pending_md" && isMd) || (status === "pending_accounts" && isAccounts);
  const canPay = status === "pending_payment" && (isAccounts || isTeam || ["md", "admin"].includes(profile?.role));
  const stepIndex = STEPS.findIndex((s) => s.key === status);

  async function view() {
    if (viewing) return;
    setViewing(true);
    try {
      await openPdfFromFunction("preview-pbg-note", { proposal_id: proposal.id });
    } catch (err) {
      showToast(err.message, "danger");
    } finally {
      setViewing(false);
    }
  }

  const run = (action) => ({ remark, pin, reference }) => supabase.functions.invoke("proposal-pbg-note", {
    body: { proposal_id: proposal.id, action, remark, pin, payment_reference: reference },
  });
  const done = (msg) => () => { setModal(null); showToast(msg, "success"); onChanged(); };
  const nextStageLabel = note?.return_to ? PBG_STAGE_LABELS[note.return_to] : "Recommending Authority";

  const headTools = note ? (
    <>
      <Badge variant={PBG_NOTE_STATUS_VARIANTS[status]}>{PBG_NOTE_STATUS_LABELS[status]}</Badge>
      <button type="button" className="pp-row-icon-btn" title={viewing ? "Loading…" : "View PBG Note"} aria-label="View PBG Note" onClick={view} disabled={viewing}>
        {viewing ? <span className="spinner spinner-sm" aria-hidden="true" /> : <EyeIcon />}
      </button>
      {canEditDraft && status === "draft" && (
        <button type="button" className="pp-row-icon-btn" title="Edit PBG Note" aria-label="Edit PBG Note" onClick={() => navigate(`/proposals/${lead.id}/pbg-note`)}>
          <PencilIcon />
        </button>
      )}
    </>
  ) : (
    canEditDraft
      ? <Button variant="primary" size="sm" onClick={() => navigate(`/proposals/${lead.id}/pbg-note`)}>Create PBG Note</Button>
      : <Badge variant="neutral">Not Created</Badge>
  );

  const body = !note ? (
    <p className="pp-pbg-empty">
      {canEditDraft
        ? "Create the PBG Note once the client asks for the Performance Bank Guarantee. The amount comes from the Lead Approval Note and can be changed."
        : "The PBG Note hasn't been created yet."}
    </p>
  ) : (
    <>
      <div className="pp-pbg-stats">
        <div><span>PBG amount</span><strong>{formatINR(pbg)}</strong></div>
        <div><span>EMD adjusted</span><strong>{adjusted > 0 ? formatINR(adjusted) : "—"}</strong></div>
        <div className="is-key"><span>{adjusted > 0 ? "To submit" : "Full PBG to submit"}</span><strong>{formatINR(toFurnish)}</strong></div>
      </div>

      <ol className="pp-steps" aria-label="PBG Note progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i < stepIndex || status === "completed" ? "is-done" : i === stepIndex ? "is-current" : ""}>
            <span className="pp-steps-dot" aria-hidden="true" />
            <span className="pp-steps-label">{s.label}</span>
          </li>
        ))}
      </ol>

      {status === "draft" && note.return_to && note.clarification_remark && (
        <div className="pp-callout is-warning">
          <strong>Clarification requested by {PBG_STAGE_LABELS[note.return_to]}</strong>
          <span>{note.clarification_remark}</span>
        </div>
      )}

      {/* ── Draft: proof + forward ─────────────────────────────── */}
      {status === "draft" && (
        <div className="pp-fin-step">
          <span className="pp-fin-sub">Proof</span>
          <FinanceFiles
            proposalId={proposal.id}
            purpose="pbg"
            files={financeFiles}
            canManage={canEditDraft}
            emptyText="Upload the Letter of Award and the EMD conversion / refund proof."
            onChanged={onChanged}
          />
          {isPreparer && (
            <div className="pp-fin-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={proofCount === 0}
                title={proofCount === 0 ? "Upload at least one proof first" : undefined}
                onClick={() => setModal("forward")}
              >
                {note.return_to ? `Forward back to ${nextStageLabel}` : "Forward to Recommending Authority"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── In review ───────────────────────────────────────────── */}
      {["pending_ra", "pending_md", "pending_accounts"].includes(status) && (
        <div className="pp-fin-step">
          {note.remarks && <p className="pp-fin-quote"><span>Team remarks</span>{note.remarks}</p>}
          <span className="pp-fin-sub">Proofs</span>
          <FinanceFiles proposalId={proposal.id} purpose="pbg" files={financeFiles} canManage={false} onChanged={onChanged} />
          {reviewer ? (
            <div className="pp-fin-actions">
              <Button variant="secondary" size="sm" onClick={() => setModal("clarify")}>Clarification Request</Button>
              <Button variant="primary" size="sm" onClick={() => setModal(status === "pending_ra" ? "ra_approve" : status === "pending_md" ? "md_approve" : "accounts_approve")}>
                {status === "pending_ra" ? "Approve & Forward to MD" : status === "pending_md" ? "Approve" : "Approve for Payment"}
              </Button>
            </div>
          ) : (
            <p className="pp-fin-wait">Waiting for the {status === "pending_ra" ? "Recommending Authority" : status === "pending_md" ? "MD" : "Accounts Committee"}.</p>
          )}
        </div>
      )}

      {/* ── Payment ─────────────────────────────────────────────── */}
      {(status === "pending_payment" || status === "completed") && (
        <div className="pp-fin-step">
          {status === "completed" ? (
            <p className="pp-fin-done">
              Paid {fmtDateTime(note.payment_done_at)}{note.payer?.full_name ? ` · recorded by ${note.payer.full_name}` : ""}
              {note.payment_reference ? ` · Ref: ${note.payment_reference}` : ""}
            </p>
          ) : (
            <p className="pp-fin-wait">Approved by Accounts — upload the payment proof and mark the payment done.</p>
          )}
          {note.accounts_remark && <p className="pp-fin-quote"><span>Accounts remarks</span>{note.accounts_remark}</p>}
          <span className="pp-fin-sub">Payment proof</span>
          <FinanceFiles
            proposalId={proposal.id}
            purpose="pbg_payment"
            files={financeFiles}
            canManage={canPay}
            emptyText={status === "completed" ? "No payment proof was attached." : "Upload the FDR / DD / BG copy or bank advice."}
            onChanged={onChanged}
          />
          {canPay && (
            <div className="pp-fin-actions">
              <Button
                variant="primary"
                size="sm"
                disabled={paymentProofCount === 0}
                title={paymentProofCount === 0 ? "Upload the payment proof first" : undefined}
                onClick={() => setModal("mark_paid")}
              >
                Mark Payment Done
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );

  const modals = (
    <>
      {modal === "forward" && (
        <FinanceActionModal
          title={note.return_to ? `Forward back to ${nextStageLabel}` : "Forward to Recommending Authority"}
          intro={`You're signing the PBG Note as Person Responsible.${note.return_to ? ` It goes straight back to the ${nextStageLabel}, who asked for the clarification.` : ""}`}
          confirmLabel="Forward"
          remarkLabel="Remarks"
          remarkRequired
          withPin
          run={run("forward")}
          onClose={() => setModal(null)}
          onSuccess={done(`PBG Note forwarded to the ${nextStageLabel}.`)}
        />
      )}
      {modal === "ra_approve" && (
        <FinanceActionModal title="Approve PBG Note" intro="Your signature goes on the note as Recommending Authority, and it moves to the MD." confirmLabel="Approve & Forward" withPin
          run={run("ra_approve")} onClose={() => setModal(null)} onSuccess={done("Approved — sent to the MD.")} />
      )}
      {modal === "md_approve" && (
        <FinanceActionModal title="Approve PBG Note" intro="Your signature goes on the note, and it moves to the Accounts Committee." confirmLabel="Approve" withPin
          run={run("md_approve")} onClose={() => setModal(null)} onSuccess={done("Approved — sent to Accounts.")} />
      )}
      {modal === "accounts_approve" && (
        <FinanceActionModal title="Approve for Payment" intro="Confirm the note and proofs are in order. The PBG then waits for payment." confirmLabel="Approve" withPin
          run={run("accounts_approve")} onClose={() => setModal(null)} onSuccess={done("Approved for payment.")} />
      )}
      {modal === "mark_paid" && (
        <FinanceActionModal title="Mark Payment Done" intro="Confirm the PBG has been paid and the proof is uploaded. This marks it PBG Done." confirmLabel="Confirm Payment" withReference withPin
          run={run("mark_paid")} onClose={() => setModal(null)} onSuccess={done("PBG Done.")} />
      )}
      {modal === "clarify" && (
        <FinanceActionModal
          title="Clarification Request"
          intro="It goes back to the Person Responsible, Reviewer and Recommending Authority. Once they've answered, it comes straight back to you."
          confirmLabel="Send Clarification Request"
          remarkLabel="What needs clarifying"
          remarkRequired
          run={run("request_clarification")}
          onClose={() => setModal(null)}
          onSuccess={done("Clarification Request sent to the team.")}
        />
      )}
      {timelineOpen && <FinanceTimelineDrawer title="PBG Timeline" events={pbgEvents} onClose={() => setTimelineOpen(false)} />}
    </>
  );

  if (embedded) {
    return (
      <section className="pp-fin-section" id="pbg-note" aria-label="PBG Note">
        <div className="pp-fin-section-head">
          <span className="pp-fin-section-title"><ShieldIcon /> PBG Note</span>
          <div className="pp-fee-note-icons">{headTools}</div>
        </div>
        {body}
        {modals}
      </section>
    );
  }

  return (
    <Card>
      <Collapsible
        title="PBG Note"
        icon={<ShieldIcon />}
        action={
          <div className="pp-fee-note-icons">
            {headTools}
            <button type="button" className="pp-chip-btn" onClick={() => setTimelineOpen(true)}>
              <ClockIcon /> Timeline{pbgEvents.length ? <span className="pp-chip-count">{pbgEvents.length}</span> : null}
            </button>
          </div>
        }
      >
        {body}
      </Collapsible>
      {modals}
    </Card>
  );
}
