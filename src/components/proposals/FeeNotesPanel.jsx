// Bid Payment Requisition Note card for Proposal Preparation — one note per
// proposal carrying whichever of EMD / Tender Fee / Processing Fee apply.
// Created lazily: it doesn't exist until Person Responsible fills in the
// edit form and generates its PDF the first time (see save-fee-note's
// create-or-update branch) — never as an empty stub. From there it's a
// 3-stage PIN sign-off chain — Person Responsible edits and forwards,
// Recommending Authority forwards to MD or sends it back, MD gives the
// final approval — mirroring the eye-icon + PDF pattern shipped for
// Empanelment letters.
//
// Once the MD approves it, the note goes straight to the Accounts Committee
// (who also join the proposal chat to clear doubts with the team), who
// check the signatures, upload the payment proof and record the payment
// (mark-fee-note-paid, PIN-gated). The lead's own team can upload the
// payment proof too, in case it's with them; until a proof is uploaded a
// reminder goes out daily up to the submission date, and on that date the
// PR / Reviewer / RA get an email (proposal-finance-daily).
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import Card from "../../components/ui/Card";
import Collapsible from "../../components/ui/Collapsible";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import FeeNotePinActionModal from "./FeeNotePinActionModal";
import FeeNoteSendBackModal from "./FeeNoteSendBackModal";
import FinanceActionModal from "./FinanceActionModal";
import FinanceFiles from "./FinanceFiles";
import { ReceiptIcon, InfoIcon } from "../icons";
import {
  FEE_LINES, FEE_NOTE_TITLE, FEE_NOTE_STATUS_LABELS, FEE_NOTE_STATUS_VARIANTS,
  PAYMENT_MODE_LABELS, BORNE_BY_LABELS,
} from "../../lib/proposalPrep";

function EyeIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function EditIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
}

const RETURN_ACTIONS = new Set(["returned_by_ra", "md_rejected"]);

function fmtDateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function FeeNotesPanel({ proposalId, feeNotes, lead, profile, isMd, isAccounts = false, isTeam = false, financeFiles = [], locked, onChanged }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const note = feeNotes[0] || null;
  const [pinAction, setPinAction] = useState(null); // { feeNoteId, action }
  const [sendBackAction, setSendBackAction] = useState(null); // { feeNoteId, action }
  const [viewing, setViewing] = useState(false);
  const [latestEvent, setLatestEvent] = useState(null);
  const [payOpen, setPayOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadEvent() {
      if (!note) { setLatestEvent(null); return; }
      const { data } = await supabase
        .from("fee_note_events")
        .select("action, remark, created_at")
        .eq("fee_note_id", note.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (!cancelled) setLatestEvent((data || [])[0] || null);
    }
    loadEvent();
    return () => { cancelled = true; };
  }, [note]);

  // isPR gates creating/editing a draft — only this lead's actual named
  // Person Responsible/Reviewer, plus admin for data-entry help. The MD is
  // deliberately excluded here (unlike save-fee-note's own check): the MD's
  // role on this note is to review and decide once it reaches them, not to
  // draft it, so their card only ever shows status + the eye/approve
  // actions below, never Create/Edit. Forwarding and Recommending-Authority
  // actions are stricter still — they stamp pr_signed_by / ra_signed_by,
  // which print under "Person Responsible" / "Recommending Authority" on
  // the PDF — so only this lead's actual named PR/Reviewer/RA may do those.
  const isPR = !!profile && (profile.role === "admin" || [lead.person_responsible_id, lead.reviewer_id].includes(profile.id));
  const canForwardAsPR = !!profile && [lead.person_responsible_id, lead.reviewer_id].includes(profile.id);
  const isRA = !!profile && profile.id === lead.recommending_authority_id;

  async function handleView() {
    if (viewing || !note) return;
    setViewing(true);
    try {
      const { data, error } = await supabase.functions.invoke("preview-fee-note", { body: { fee_note_id: note.id } });
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

  const activeLines = note ? FEE_LINES.filter((f) => note[`${f.key}_amount`] != null) : [];
  const showReturnBanner = note && note.status === "draft" && latestEvent && RETURN_ACTIONS.has(latestEvent.action);

  const headerAction = (
    <div className="pp-fee-note-icons">
      {note ? (
        <>
          <Badge variant={FEE_NOTE_STATUS_VARIANTS[note.status]}>{FEE_NOTE_STATUS_LABELS[note.status]}</Badge>
          {note.status === "approved" && (
            <Badge variant={note.payment_status === "paid" ? "success" : "warning"}>{note.payment_status === "paid" ? "Paid" : "Payment Pending"}</Badge>
          )}
          <button type="button" className="pp-row-icon-btn" title={viewing ? "Loading…" : "View note"} aria-label={viewing ? "Loading note" : "View note"} onClick={handleView} disabled={viewing}>
            {viewing ? <span className="spinner spinner-sm" aria-hidden="true" /> : <EyeIcon />}
          </button>
          {isPR && note.status === "draft" && !locked && (
            <button type="button" className="pp-row-icon-btn" title="Edit note" aria-label="Edit note" onClick={() => navigate(`/proposals/${lead.id}/fee-note`)}>
              <EditIcon />
            </button>
          )}
        </>
      ) : (
        <>
          <Badge variant="neutral">Not Created</Badge>
          {isPR && !locked && (
            <Button variant="primary" size="sm" onClick={() => navigate(`/proposals/${lead.id}/fee-note`)}>
              Create Note
            </Button>
          )}
        </>
      )}
    </div>
  );

  return (
    <Card>
      <Collapsible title={FEE_NOTE_TITLE} icon={<ReceiptIcon />} action={headerAction}>
        <>
          <div>
            {!note && <p className="pp-fee-note-justification">Not created yet.</p>}
            {note && (
              <>
                {activeLines.length > 0 && (
                  <div className="pp-table-wrap">
                    <table className="pp-table">
                      <thead>
                        <tr>
                          <th>Fee Line</th>
                          <th>Amount (₹)</th>
                          <th>Borne By</th>
                          <th>Payment Mode</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeLines.map((f) => (
                          <tr key={f.key}>
                            <td>{f.label}</td>
                            <td>{Number(note[`${f.key}_amount`]).toLocaleString("en-IN")}</td>
                            <td>{BORNE_BY_LABELS[note[`${f.key}_borne_by`]] || "AFC"}</td>
                            <td>{note[`${f.key}_payment_mode`] ? PAYMENT_MODE_LABELS[note[`${f.key}_payment_mode`]] : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {note.justification && <p className="pp-fee-note-justification">{note.justification}</p>}
                {showReturnBanner && (
                  <p className="pp-fee-note-remark">
                    Sent back by {latestEvent.action === "md_rejected" ? "MD" : "Recommending Authority"}: {latestEvent.remark}
                  </p>
                )}
              </>
            )}
          </div>

          {note && note.status === "approved" && (
            <div className="pp-fin-block">
              <div className="pp-fin-block-head">
                <strong>Payment by Accounts</strong>
                {note.payment_status === "paid" ? (
                  <span className="pp-fin-done">
                    Paid {fmtDateTime(note.payment_done_at)}{note.payer?.full_name ? ` by ${note.payer.full_name}` : ""}
                    {note.payment_reference ? ` · Ref: ${note.payment_reference}` : ""}
                  </span>
                ) : (
                  <span className="pp-fin-wait">
                    {isAccounts
                      ? "Check the signatures on the note (eye icon above), upload the payment proof and mark it done."
                      : isTeam
                        ? "Approved — with the Accounts Committee for payment. If the payment proof is with you, upload it here."
                        : "Approved — waiting for the Accounts Committee to make the payment."}
                  </span>
                )}
              </div>
              {note.payment_remark && <p className="pp-fee-note-justification">“{note.payment_remark}”</p>}
              {note.payment_status !== "paid" && (isAccounts || isTeam) && financeFiles.every((f) => f.purpose !== "fee_payment") && (
                <p className="pp-note-bar-text pp-fin-hint"><InfoIcon /> Until a payment proof is uploaded, a reminder goes out every day up to the submission date.</p>
              )}
              {(note.payment_status === "paid" || isAccounts || isTeam) && (
                <FinanceFiles
                  proposalId={proposalId}
                  purpose="fee_payment"
                  files={financeFiles}
                  canManage={(isAccounts || isTeam) && note.payment_status !== "paid"}
                  emptyText={note.payment_status === "paid" ? "No payment proof was attached." : "No payment proof uploaded yet."}
                  onChanged={onChanged}
                />
              )}
              {isAccounts && note.payment_status !== "paid" && (
                <div className="pp-fin-actions">
                  <Button variant="primary" size="sm" onClick={() => setPayOpen(true)}>Mark Payment Done</Button>
                </div>
              )}
            </div>
          )}

          {note && canForwardAsPR && note.status === "draft" && !locked && (
            <div style={{ marginTop: "var(--space-4)" }}>
              <Button variant="primary" size="sm" onClick={() => setPinAction({ feeNoteId: note.id, action: "pr_forward" })}>
                Forward to Recommending Authority
              </Button>
            </div>
          )}

          {note && isRA && note.status === "pending_recommending_authority" && !locked && (
            <div className="pp-note-bar">
              <span className="pp-note-bar-text"><InfoIcon /> This note is pending your review. Forward it to the MD, or send it back.</span>
              <div className="pp-icon-btn-row">
                <Button variant="secondary" size="sm" onClick={() => setSendBackAction({ feeNoteId: note.id, action: "ra_send_back" })}>
                  Send Back
                </Button>
                <Button variant="primary" size="sm" onClick={() => setPinAction({ feeNoteId: note.id, action: "ra_forward" })}>
                  Forward to MD
                </Button>
              </div>
            </div>
          )}

          {note && isMd && note.status === "pending_md" && !locked && (
            <div className="pp-note-bar">
              <span className="pp-note-bar-text"><InfoIcon /> This note is awaiting your final approval.</span>
              <div className="pp-icon-btn-row">
                <Button variant="secondary" size="sm" onClick={() => setSendBackAction({ feeNoteId: note.id, action: "md_reject" })}>
                  Send Back
                </Button>
                <Button variant="primary" size="sm" onClick={() => setPinAction({ feeNoteId: note.id, action: "md_approve" })}>
                  Approve
                </Button>
              </div>
            </div>
          )}
        </>
      </Collapsible>

      {pinAction && (
        <FeeNotePinActionModal
          feeNoteId={pinAction.feeNoteId}
          action={pinAction.action}
          onClose={() => setPinAction(null)}
          onSuccess={() => { setPinAction(null); onChanged(); }}
        />
      )}

      {payOpen && note && (
        <FinanceActionModal
          title="Mark Payment Done"
          intro="Confirm that the note carries every required signature and the payment has been made. This can't be undone."
          confirmLabel="Confirm Payment"
          withReference
          withPin
          run={({ remark, reference, pin }) => supabase.functions.invoke("mark-fee-note-paid", { body: { fee_note_id: note.id, payment_reference: reference, remark, pin } })}
          onClose={() => setPayOpen(false)}
          onSuccess={() => { setPayOpen(false); showToast("Payment recorded.", "success"); onChanged(); }}
        />
      )}

      {sendBackAction && (
        <FeeNoteSendBackModal
          feeNoteId={sendBackAction.feeNoteId}
          action={sendBackAction.action}
          onClose={() => setSendBackAction(null)}
          onSuccess={() => { setSendBackAction(null); onChanged(); }}
        />
      )}
    </Card>
  );
}
