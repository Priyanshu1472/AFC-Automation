// PBG Note card on an awarded proposal (proposal_pbg_notes, driven by the
// proposal-pbg-note edge function):
//
//   Draft            team prepares it (PbgNoteEditPage), uploads the proof,
//                    adds remarks and forwards it (PIN — signs as PR)
//   Pending RA       Recommending Authority approves (PIN) or raises a
//                    Clarification Request
//   Pending MD       MD approves (PIN) or raises a Clarification Request
//   With Accounts    Accounts reviews (PIN) or raises a Clarification Request
//   Payment Pending  Accounts — or the team — uploads the payment proof and
//                    marks the payment done (PIN)
//   PBG Done
//
// A Clarification Request sends it back to the team; their next forward
// goes straight back to whoever asked, not to the start of the chain.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import FinanceFiles from "./FinanceFiles";
import FinanceActionModal from "./FinanceActionModal";
import FinanceTimeline from "./FinanceTimeline";
import { ShieldIcon, InfoIcon, EyeIcon, PencilIcon } from "../icons";
import { formatINR } from "../../lib/monitoring";
import { PBG_NOTE_STATUS_LABELS, PBG_NOTE_STATUS_VARIANTS, PBG_STAGE_LABELS } from "../../lib/proposalPrep";

function fmtDateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function PbgNotePanel({ proposal, lead, note, financeFiles, events, profile, isAccounts, additionalResponsibleIds = [], onChanged }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [viewing, setViewing] = useState(false);
  const [modal, setModal] = useState(null); // forward | ra_approve | md_approve | accounts_approve | mark_paid | clarify

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

  async function view() {
    if (viewing) return;
    setViewing(true);
    try {
      const { data, error } = await supabase.functions.invoke("preview-pbg-note", { body: { proposal_id: proposal.id } });
      if (error) { showToast(await extractFunctionErrorMessage(error, "Could not open the note."), "danger"); return; }
      if (!data?.success || !data?.pdf_base64) { showToast(data?.error || "Could not open the note.", "danger"); return; }
      const bytes = Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      showToast(err.message || "Could not open the note.", "danger");
    } finally {
      setViewing(false);
    }
  }

  const run = (action) => ({ remark, pin, reference }) => supabase.functions.invoke("proposal-pbg-note", {
    body: { proposal_id: proposal.id, action, remark, pin, payment_reference: reference },
  });
  const done = (msg) => () => { setModal(null); showToast(msg, "success"); onChanged(); };

  const headerAction = (
    <div className="pp-fee-note-icons">
      {note ? (
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
        <>
          <Badge variant="neutral">Not Created</Badge>
          {canEditDraft && <Button variant="primary" size="sm" onClick={() => navigate(`/proposals/${lead.id}/pbg-note`)}>Create PBG Note</Button>}
        </>
      )}
    </div>
  );

  const nextStageLabel = note?.return_to ? PBG_STAGE_LABELS[note.return_to] : "Recommending Authority";

  return (
    <Card>
      <Collapsible title="PBG Note" icon={<ShieldIcon />} action={headerAction}>
        {!note ? (
          <p className="pp-fee-note-justification">
            Not created yet. The PBG amount is taken from the Lead Approval Note (editable), and the note's wording is picked from the amounts: an EMD converted to PBG is adjusted (remaining PBG = PBG − EMD), otherwise the full PBG is submitted.
          </p>
        ) : (
          <>
            <div className="pp-emd-facts">
              <div><span>PBG amount</span><strong>{formatINR(pbg)}</strong></div>
              <div><span>EMD adjusted</span><strong>{adjusted > 0 ? formatINR(adjusted) : "None"}</strong></div>
              <div><span>{adjusted > 0 ? "Remaining PBG to submit" : "Full PBG to submit"}</span><strong>{formatINR(toFurnish)}</strong></div>
            </div>

            {status === "draft" && note.return_to && note.clarification_remark && (
              <p className="pp-fee-note-remark">
                Clarification requested by {PBG_STAGE_LABELS[note.return_to]}: {note.clarification_remark}
              </p>
            )}

            {/* ── Draft: proof + remarks + forward ─────────────────── */}
            {status === "draft" && (
              <div className="pp-fin-block">
                <div className="pp-fin-block-head"><strong>Proof</strong></div>
                <FinanceFiles
                  proposalId={proposal.id}
                  purpose="pbg"
                  files={financeFiles}
                  canManage={canEditDraft}
                  emptyText="Upload the proof — the Letter of Award, and the EMD conversion / refund proof."
                  onChanged={onChanged}
                />
                {isPreparer ? (
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
                ) : (
                  <p className="pp-flow-note">The Person Responsible or Reviewer forwards it once the proof is uploaded.</p>
                )}
              </div>
            )}

            {/* ── In review ────────────────────────────────────────── */}
            {["pending_ra", "pending_md", "pending_accounts"].includes(status) && (
              <div className="pp-fin-block">
                <div className="pp-fin-block-head">
                  <strong>{status === "pending_ra" ? "With the Recommending Authority" : status === "pending_md" ? "With the MD" : "With Accounts"}</strong>
                  {note.pr_signed_at && <span className="pp-fin-wait">Forwarded {fmtDateTime(note.pr_signed_at)}</span>}
                </div>
                {note.remarks && <p className="pp-fee-note-justification"><strong>Team remarks:</strong> {note.remarks}</p>}
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
                  <p className="pp-note-bar-text pp-fin-hint"><InfoIcon /> Waiting for the {status === "pending_ra" ? "Recommending Authority" : status === "pending_md" ? "MD" : "Accounts Committee"}.</p>
                )}
              </div>
            )}

            {/* ── Payment ──────────────────────────────────────────── */}
            {(status === "pending_payment" || status === "completed") && (
              <div className="pp-fin-block">
                <div className="pp-fin-block-head">
                  <strong>PBG payment</strong>
                  {status === "completed" ? (
                    <span className="pp-fin-done">
                      PBG Done — paid {fmtDateTime(note.payment_done_at)}{note.payer?.full_name ? ` (recorded by ${note.payer.full_name})` : ""}
                      {note.payment_reference ? ` · Ref: ${note.payment_reference}` : ""}
                    </span>
                  ) : (
                    <span className="pp-fin-wait">Cleared by Accounts — upload the payment proof and mark the payment done.</span>
                  )}
                </div>
                {note.accounts_remark && <p className="pp-fee-note-justification"><strong>Accounts remarks:</strong> {note.accounts_remark}</p>}
                <FinanceFiles
                  proposalId={proposal.id}
                  purpose="pbg_payment"
                  files={financeFiles}
                  canManage={canPay}
                  emptyText={status === "completed" ? "No payment proof was attached." : "Upload the payment proof (FDR / DD / BG copy, bank advice…)."}
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

            {pbgEvents.length > 0 && (
              <div className="pp-fin-history">
                <span className="pp-fin-sub">Timeline</span>
                <FinanceTimeline events={pbgEvents} />
              </div>
            )}
          </>
        )}
      </Collapsible>

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
    </Card>
  );
}
