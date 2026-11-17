// EMD after the client's response (proposal_emd_tracking, driven by the
// proposal-emd-action edge function). Shown once the response is recorded
// and the approved Bid Payment Requisition Note carried an EMD.
//
//   Not awarded  -> EMD Refund: Pending / Received toggle. While pending,
//                   the team is reminded every 14 days. Once received, the
//                   team uploads proof + remarks and forwards it to Accounts,
//                   who verify it with their PIN (or raise a Clarification
//                   Request, which sends it back to the team). Setting it
//                   back to Pending removes the uploaded proofs.
//   Awarded      -> the team chooses one of:
//                     EMD Refund        — same as above;
//                     Converted to PBG  — the EMD is adjusted in the PBG
//                                         Note (PbgNotePanel) and settles
//                                         with it;
//                     On Completion     — the client returns the EMD when
//                                         the project completes. No
//                                         reminders. If it comes back
//                                         earlier, switch to EMD Refund.
//
// Errors surface as toasts (bottom of the screen), not a banner in the card.
import { useEffect, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import ConfirmDialog from "../ui/ConfirmDialog";
import FinanceFiles from "./FinanceFiles";
import FinanceActionModal from "./FinanceActionModal";
import FinanceTimeline from "./FinanceTimeline";
import { RupeeIcon, InfoIcon, CheckCircleIcon, RotateCcwIcon, FileTextIcon, CalendarIcon } from "../icons";
import { formatINR } from "../../lib/monitoring";
import { EMD_TRACK_LABELS, EMD_STATUS_LABELS, EMD_STATUS_VARIANTS, PBG_NOTE_STATUS_LABELS } from "../../lib/proposalPrep";

function fmtDateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function openPdf(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) throw new Error(await extractFunctionErrorMessage(error, "Could not open the note."));
  if (!data?.success || !data?.pdf_base64) throw new Error(data?.error || "Could not open the note.");
  const bytes = Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const CHOICES = [
  { track: "refund", icon: <RotateCcwIcon />, title: "EMD Refund", sub: "The client returns the EMD now" },
  { track: "pbg", icon: <CheckCircleIcon />, title: "Converted to PBG", sub: "EMD adjusted towards the Performance Bank Guarantee" },
  { track: "on_completion", icon: <CalendarIcon />, title: "On Completion", sub: "The client returns the EMD when the project completes" },
];

const CHOSEN_TOAST = {
  refund: "EMD Refund chosen — mark it Received once the client returns it.",
  pbg: "Converted to PBG — the EMD will be adjusted in the PBG Note.",
  on_completion: "EMD will be refunded on completion of the project.",
};

export default function EmdPanel({ proposal, feeNote, tracking, pbgNote, financeFiles, events, isTeam, isAccounts, onChanged }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState("");
  const [modal, setModal] = useState(null); // 'verify' | 'clarify'
  const [confirm, setConfirm] = useState(null); // { title, message, label, run }
  const [remarksDraft, setRemarksDraft] = useState("");

  const emd = Number(tracking?.emd_amount ?? feeNote?.emd_amount ?? 0);
  const awarded = proposal.client_response === "awarded";
  const track = tracking?.track || null;
  const status = tracking?.status || null;
  const isRefund = track === "refund";
  const pbgLocked = track === "pbg" && pbgNote && pbgNote.status !== "draft";
  const teamEditable = isTeam && ["draft", "pending", "received", "awaiting_completion"].includes(status) && !pbgLocked;

  useEffect(() => {
    setRemarksDraft(tracking?.remarks || "");
  }, [tracking?.id, tracking?.remarks, tracking?.status]);

  async function act(action, extra = {}, okMsg) {
    setBusy(action);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("proposal-emd-action", { body: { proposal_id: proposal.id, action, ...extra } });
      if (fnErr) { showToast(await extractFunctionErrorMessage(fnErr, "Something went wrong."), "danger"); return false; }
      if (!data?.success) { showToast(data?.error || "Something went wrong.", "danger"); return false; }
      if (okMsg) showToast(okMsg, "success");
      onChanged();
      return true;
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function view() {
    setBusy("view_fee");
    try {
      await openPdf("preview-fee-note", { fee_note_id: feeNote.id });
    } catch (err) {
      showToast(err.message, "danger");
    } finally {
      setBusy("");
    }
  }

  const refundProofCount = financeFiles.filter((f) => f.purpose === "emd_refund").length;
  const emdEvents = events.filter((ev) => ev.scope === "emd");

  function choose(next) {
    if (next === track) return;
    const run = () => act("choose_track", { track: next }, CHOSEN_TOAST[next]);
    if (isRefund && refundProofCount > 0) {
      setConfirm({
        title: `Switch to ${EMD_TRACK_LABELS[next]}?`,
        message: "The refund proofs already uploaded will be removed.",
        label: "Switch",
        run,
      });
      return;
    }
    run();
  }

  function setPending() {
    const run = () => act("set_refund_received", { received: false }, "Marked pending.");
    if (refundProofCount > 0) {
      setConfirm({
        title: "Mark the refund pending again?",
        message: `The ${refundProofCount === 1 ? "uploaded proof" : `${refundProofCount} uploaded proofs`} will be removed. Upload them again once the refund is received.`,
        label: "Mark Pending",
        run,
      });
      return;
    }
    run();
  }

  const headerAction = (
    <div className="pp-fee-note-icons">
      {track && <Badge variant="brand">{EMD_TRACK_LABELS[track]}</Badge>}
      {status && track !== "pbg" && <Badge variant={EMD_STATUS_VARIANTS[status]}>{status === "completed" ? "Refund Verified" : EMD_STATUS_LABELS[status]}</Badge>}
      {track === "pbg" && <Badge variant={status === "completed" ? "success" : "neutral"}>{status === "completed" ? "PBG Done" : pbgNote ? PBG_NOTE_STATUS_LABELS[pbgNote.status] : "PBG Note not created"}</Badge>}
      {!track && <Badge variant="warning">Action Needed</Badge>}
    </div>
  );

  return (
    <Card>
      <Collapsible title={awarded ? "EMD — Refund, PBG or On Completion" : "EMD Refund"} icon={<RupeeIcon />} action={headerAction}>
        <div className="pp-emd-facts">
          <div><span>EMD deposited</span><strong>{formatINR(emd)}</strong></div>
          <div><span>Client response</span><strong>{awarded ? "Awarded" : "Not awarded"}</strong></div>
          {feeNote && (
            <div>
              <span>EMD note</span>
              <button type="button" className="pp-link-btn" disabled={!!busy} onClick={view}>
                <FileTextIcon /> {busy === "view_fee" ? "Opening…" : "View Bid Payment Requisition Note"}
              </button>
            </div>
          )}
        </div>

        {/* ── Choose: awarded only ─────────────────────────────── */}
        {awarded && (!track || teamEditable) && (
          isTeam ? (
            <div className="pp-flow-respond">
              <strong className="pp-flow-respond-title">{track ? "Change what happens to the EMD" : "What happens to the EMD?"}</strong>
              <div className="pp-flow-choices pp-flow-choices-3" role="radiogroup" aria-label="EMD outcome">
                {CHOICES.map((c) => (
                  <button
                    key={c.track}
                    type="button"
                    role="radio"
                    aria-checked={track === c.track}
                    className={`pp-flow-choice is-awarded${track === c.track ? " is-selected" : ""}`}
                    disabled={!!busy}
                    onClick={() => choose(c.track)}
                  >
                    {c.icon}
                    <span><strong>{c.title}</strong><small>{c.sub}</small></span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            !track && <p className="pp-flow-note">Waiting for the Person Responsible, Reviewer or Recommending Authority to choose EMD Refund, Converted to PBG or On Completion.</p>
          )
        )}

        {/* Not awarded, but recorded before EMD tracking existed. */}
        {!awarded && !track && (
          isTeam ? (
            <div className="pp-fin-actions" style={{ justifyContent: "flex-start" }}>
              <Button variant="primary" size="sm" loading={busy === "choose_track"} disabled={!!busy} onClick={() => act("choose_track", { track: "refund" })}>
                Start EMD Refund Tracking
              </Button>
            </div>
          ) : (
            <p className="pp-flow-note">EMD refund tracking hasn't been started yet.</p>
          )
        )}

        {tracking?.accounts_remark && (status === "received" || status === "draft") && (
          <p className="pp-fee-note-remark">Clarification requested by Accounts: {tracking.accounts_remark}</p>
        )}

        {/* ── On Completion ───────────────────────────────────── */}
        {track === "on_completion" && (
          <div className="pp-fin-block">
            <div className="pp-fin-block-head"><strong>Refund on completion</strong></div>
            <p className="pp-note-bar-text pp-fin-hint">
              <InfoIcon /> The EMD of {formatINR(emd)} will be refunded on completion of the project. No reminders are sent until then.
              {isTeam && " If the client returns it earlier, choose EMD Refund above and the normal refund process continues."}
            </p>
          </div>
        )}

        {/* ── Converted to PBG ────────────────────────────────── */}
        {track === "pbg" && status !== "pending_accounts" && (
          <div className="pp-fin-block">
            <div className="pp-fin-block-head"><strong>Converted to PBG</strong></div>
            <p className="pp-note-bar-text pp-fin-hint">
              <InfoIcon /> {status === "completed"
                ? `The EMD of ${formatINR(emd)} was adjusted towards the PBG — PBG Done.`
                : `The EMD of ${formatINR(emd)} is adjusted in the PBG Note below (remaining PBG = PBG − EMD). It's settled when the PBG is paid.`}
            </p>
          </div>
        )}

        {/* ── Refund ──────────────────────────────────────────── */}
        {isRefund && (status === "pending" || status === "received") && (
          <div className="pp-fin-block">
            <div className="pp-fin-block-head">
              <strong>EMD refund</strong>
              {isTeam ? (
                <div className="pp-seg" role="radiogroup" aria-label="EMD refund">
                  <button type="button" role="radio" aria-checked={status === "received"} className={`pp-seg-btn${status === "received" ? " is-on" : ""}`} disabled={!!busy || status === "received"} onClick={() => act("set_refund_received", { received: true }, "Marked received — upload the proof and forward it to Accounts.")}>Received</button>
                  <button type="button" role="radio" aria-checked={status === "pending"} className={`pp-seg-btn${status === "pending" ? " is-on" : ""}`} disabled={!!busy || status === "pending"} onClick={setPending}>Pending</button>
                </div>
              ) : (
                <Badge variant={EMD_STATUS_VARIANTS[status]}>{EMD_STATUS_LABELS[status]}</Badge>
              )}
            </div>
            {status === "pending" && (
              <p className="pp-note-bar-text pp-fin-hint"><InfoIcon /> The EMD has to come back from the client. Until it's marked Received, the Person Responsible, Reviewer and Recommending Authority get a reminder every 14 days.</p>
            )}
            {status === "received" && (
              <>
                <FinanceFiles proposalId={proposal.id} purpose="emd_refund" files={financeFiles} canManage={isTeam} emptyText="Upload the refund proof (bank statement, credit advice, returned BG/DD…)." onChanged={onChanged} />
                {isTeam && (
                  <>
                    <div className="field">
                      <label className="field-label" htmlFor="emd-refund-remarks">Remarks <span className="required">*</span></label>
                      <textarea id="emd-refund-remarks" className="input" rows={2} maxLength={2000} value={remarksDraft} onChange={(e) => setRemarksDraft(e.target.value)} disabled={!!busy} />
                    </div>
                    <div className="pp-fin-actions">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!!busy || refundProofCount === 0 || !remarksDraft.trim()}
                        title={refundProofCount === 0 ? "Upload at least one proof first" : !remarksDraft.trim() ? "Add a remark first" : undefined}
                        loading={busy === "forward"}
                        onClick={() => act("forward", { remark: remarksDraft.trim() }, "Forwarded to Accounts for verification.")}
                      >
                        Forward to Accounts for Verification
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── With Accounts / completed (refund, or a legacy PBG row) ── */}
        {(status === "pending_accounts" || (status === "completed" && track !== "pbg")) && (
          <div className="pp-fin-block">
            <div className="pp-fin-block-head">
              <strong>{isRefund ? "EMD Refund Verification" : "PBG with Accounts"}</strong>
              <span className={status === "completed" ? "pp-fin-done" : "pp-fin-wait"}>
                {status === "completed"
                  ? `Verified by Accounts ${fmtDateTime(tracking.completed_at)}${tracking.completer?.full_name ? ` (${tracking.completer.full_name})` : ""}`
                  : `Forwarded ${fmtDateTime(tracking.forwarded_at)}${tracking.forwarder?.full_name ? ` by ${tracking.forwarder.full_name}` : ""} — waiting for Accounts`}
              </span>
            </div>
            {tracking.remarks && <p className="pp-fee-note-justification"><strong>Team remarks:</strong> {tracking.remarks}</p>}
            {tracking.accounts_remark && status === "completed" && <p className="pp-fee-note-justification"><strong>Accounts remarks:</strong> {tracking.accounts_remark}</p>}
            <span className="pp-fin-sub">Uploaded proofs</span>
            <FinanceFiles proposalId={proposal.id} purpose={isRefund ? "emd_refund" : "pbg"} files={financeFiles} canManage={false} onChanged={onChanged} />
            {isAccounts && status === "pending_accounts" && (
              <div className="pp-fin-actions">
                <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => setModal("clarify")}>Clarification Request</Button>
                <Button variant="primary" size="sm" disabled={!!busy} onClick={() => setModal("verify")}>{isRefund ? "Verify EMD Refund" : "Confirm PBG Processed"}</Button>
              </div>
            )}
          </div>
        )}

        {emdEvents.length > 0 && (
          <div className="pp-fin-history">
            <span className="pp-fin-sub">Timeline</span>
            <FinanceTimeline events={emdEvents} />
          </div>
        )}
      </Collapsible>

      {modal === "verify" && (
        <FinanceActionModal
          title={isRefund ? "Verify EMD Refund" : "Confirm PBG Processed"}
          intro={isRefund
            ? `Confirm the EMD of ${formatINR(emd)} has been received back, as shown in the uploaded proofs.`
            : `Confirm the PBG of ${formatINR(tracking.pbg_amount)} has been processed.`}
          confirmLabel={isRefund ? "Verify Refund" : "Confirm"}
          withPin
          run={({ remark, pin }) => supabase.functions.invoke("proposal-emd-action", { body: { proposal_id: proposal.id, action: "verify", remark, pin } })}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); showToast(isRefund ? "EMD refund verified." : "PBG marked processed.", "success"); onChanged(); }}
        />
      )}
      {modal === "clarify" && (
        <FinanceActionModal
          title="Clarification Request"
          intro="It goes back to the Person Responsible, Reviewer and Recommending Authority. Once they've answered, they forward it to Accounts again."
          confirmLabel="Send Clarification Request"
          remarkLabel="What needs clarifying"
          remarkRequired
          run={({ remark }) => supabase.functions.invoke("proposal-emd-action", { body: { proposal_id: proposal.id, action: "request_clarification", remark } })}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); showToast("Clarification Request sent to the team.", "success"); onChanged(); }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          loading={!!busy}
          onConfirm={async () => { await confirm.run(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Card>
  );
}
