// EMD after the client's response (proposal_emd_tracking, driven by the
// proposal-emd-action edge function) — and, on an awarded proposal, the PBG
// Note (PbgNotePanel, embedded) in the same card so both are in one place.
//
//   Not awarded  -> EMD Refund: Pending / Received toggle (reminder every 14
//                   days while pending). Once received, the team uploads
//                   proof + remarks and forwards it to Accounts, who verify
//                   it (PIN) or raise a Clarification Request. Setting it
//                   back to Pending removes the uploaded proofs.
//   Moves to RFP / Tender (EOI) or Empanelled -> EMD Refund, as above (no
//                   project to hold it against).
//   Project awarded -> EMD Refund (as above) / Converted to PBG (adjusted in
//                   the PBG Note) / On Completion (refunded when the project
//                   completes, no reminders — switch to EMD Refund if it
//                   comes back earlier).
//
// The top row carries the three things people look for: the Bid Payment
// Requisition Note, the PBG Note, and the Timeline (opens as a side panel
// like the chat). Errors show as toasts.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import { openPdfFromFunction } from "../../lib/openPdf";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import ConfirmDialog from "../ui/ConfirmDialog";
import FinanceFiles from "./FinanceFiles";
import FinanceActionModal from "./FinanceActionModal";
import FinanceTimelineDrawer from "./FinanceTimelineDrawer";
import PbgNotePanel from "./PbgNotePanel";
import { RupeeIcon, CheckCircleIcon, RotateCcwIcon, FileTextIcon, CalendarIcon, ShieldIcon, ClockIcon } from "../icons";
import { formatINR } from "../../lib/monitoring";
import { EMD_TRACK_LABELS, EMD_STATUS_LABELS, EMD_STATUS_VARIANTS, PBG_NOTE_STATUS_LABELS, isProjectAward, outcomeLabel } from "../../lib/proposalPrep";

function fmtDateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const CHOICES = [
  { track: "refund", icon: <RotateCcwIcon />, title: "EMD Refund" },
  { track: "pbg", icon: <CheckCircleIcon />, title: "Converted to PBG" },
  { track: "on_completion", icon: <CalendarIcon />, title: "On Completion" },
];

const CHOSEN_TOAST = {
  refund: "EMD Refund chosen — mark it Received once the client returns it.",
  pbg: "Converted to PBG — the EMD will be adjusted in the PBG Note.",
  on_completion: "EMD will be refunded on completion of the project.",
};

export default function EmdPanel({ bare = false,
  proposal, lead, profile, feeNote, tracking, pbgNote, financeFiles, events, isTeam, isAccounts,
  additionalResponsibleIds = [], onChanged,
}) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState("");
  const [modal, setModal] = useState(null); // 'verify' | 'clarify'
  const [confirm, setConfirm] = useState(null); // { title, message, label, run }
  const [remarksDraft, setRemarksDraft] = useState("");
  const [timelineOpen, setTimelineOpen] = useState(false);

  const emd = Number(tracking?.emd_amount ?? feeNote?.emd_amount ?? 0);
  // Only a project award can convert the EMD to a PBG or hold it until
  // completion; every other result simply refunds it.
  const awarded = isProjectAward(proposal);
  const track = tracking?.track || null;
  const status = tracking?.status || null;
  const isRefund = track === "refund";
  const pbgLocked = track === "pbg" && pbgNote && pbgNote.status !== "draft";
  const teamEditable = isTeam && ["draft", "pending", "received", "awaiting_completion"].includes(status) && !pbgLocked;
  const canCreatePbg = isTeam || ["admin", "md"].includes(profile?.role);

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

  async function openNote(kind) {
    setBusy(`view_${kind}`);
    try {
      if (kind === "fee") await openPdfFromFunction("preview-fee-note", { fee_note_id: feeNote.id });
      else await openPdfFromFunction("preview-pbg-note", { proposal_id: proposal.id });
    } catch (err) {
      showToast(err.message, "danger");
    } finally {
      setBusy("");
    }
  }

  function pbgButton() {
    if (pbgNote) return openNote("pbg");
    if (canCreatePbg) return navigate(`/proposals/${lead.id}/pbg-note`);
    document.getElementById("pbg-note")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const refundProofCount = financeFiles.filter((f) => f.purpose === "emd_refund").length;
  const timelineEvents = events.filter((ev) => ev.scope === "emd" || ev.scope === "pbg");

  function choose(next) {
    if (next === track) return;
    const run = () => act("choose_track", { track: next }, CHOSEN_TOAST[next]);
    if (isRefund && refundProofCount > 0) {
      setConfirm({ title: `Switch to ${EMD_TRACK_LABELS[next]}?`, message: "The refund proofs already uploaded will be removed.", label: "Switch", run });
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

  const statusBadge = !track
    ? <Badge variant="warning">Action Needed</Badge>
    : track === "pbg"
      ? <Badge variant={status === "completed" ? "success" : "neutral"}>{status === "completed" ? "PBG Done" : pbgNote ? PBG_NOTE_STATUS_LABELS[pbgNote.status] : "PBG Note pending"}</Badge>
      : <Badge variant={EMD_STATUS_VARIANTS[status]}>{status === "completed" ? "Refund Verified" : EMD_STATUS_LABELS[status]}</Badge>;

  const headerAction = (
    <div className="pp-fee-note-icons">
      {track && <Badge variant="brand">{EMD_TRACK_LABELS[track]}</Badge>}
      {statusBadge}
    </div>
  );

  return (
    <Card className={bare ? "pp-bare" : ""}>
      <Collapsible expandable={!bare} title={awarded ? "EMD & PBG" : "EMD Refund"} icon={<RupeeIcon />} action={headerAction}>
        {/* ── Summary + quick buttons ─────────────────────────────── */}
        <div className="pp-emd-top">
          <div className="pp-emd-stats">
            <div><span>EMD deposited</span><strong>{formatINR(emd)}</strong></div>
            <div><span>Client response</span><strong className={proposal.client_response === "awarded" ? "is-good" : ""}>{outcomeLabel(proposal)}</strong></div>
          </div>
          <div className="pp-chip-row">
            {feeNote && (
              <button type="button" className="pp-chip-btn" disabled={!!busy} onClick={() => openNote("fee")}>
                <FileTextIcon /> {busy === "view_fee" ? "Opening…" : "Bid Payment Requisition Note"}
              </button>
            )}
            {awarded && (pbgNote || canCreatePbg) && (
              <button type="button" className="pp-chip-btn" disabled={!!busy} onClick={pbgButton}>
                <ShieldIcon /> {busy === "view_pbg" ? "Opening…" : pbgNote ? "PBG Note" : "Create PBG Note"}
              </button>
            )}
            <button type="button" className="pp-chip-btn" onClick={() => setTimelineOpen(true)}>
              <ClockIcon /> Timeline{timelineEvents.length ? <span className="pp-chip-count">{timelineEvents.length}</span> : null}
            </button>
          </div>
        </div>

        {/* ── Choose: awarded only ───────────────────────────────── */}
        {/* Always visible on an awarded proposal so everyone can see which
            way the EMD went; only the lead's team can change it, and only
            until it's forwarded / the PBG Note has left draft. */}
        {awarded && (
          <div className="pp-emd-choose">
            <span className="pp-fin-sub">What happens to the EMD</span>
            <div className="pp-choice-row" role="radiogroup" aria-label="EMD outcome">
              {CHOICES.map((c) => {
                const canChange = isTeam && (!track || teamEditable);
                return (
                  <button
                    key={c.track}
                    type="button"
                    role="radio"
                    aria-checked={track === c.track}
                    className={`pp-choice${track === c.track ? " is-selected" : ""}${canChange ? "" : " is-readonly"}`}
                    disabled={!!busy || !canChange}
                    onClick={() => choose(c.track)}
                  >
                    {c.icon}
                    <span>{c.title}</span>
                  </button>
                );
              })}
            </div>
            {!isTeam && (
              <span className="pp-choice-note">
                {track ? "Only the lead's Person Responsible, Reviewer or Recommending Authority can change this." : "Waiting for the lead's Person Responsible, Reviewer or Recommending Authority to choose."}
              </span>
            )}
            {isTeam && track && !teamEditable && (
              <span className="pp-choice-note">Locked — it has already gone forward for approval.</span>
            )}
          </div>
        )}

        {/* No choice to make (not a project award), but recorded before EMD
            tracking existed. */}
        {!awarded && !track && (
          isTeam ? (
            <div className="pp-fin-actions" style={{ justifyContent: "flex-start" }}>
              <Button variant="primary" size="sm" loading={busy === "choose_track"} disabled={!!busy} onClick={() => act("choose_track", { track: "refund" })}>
                Start EMD Refund Tracking
              </Button>
            </div>
          ) : (
            <p className="pp-fin-wait">EMD refund tracking hasn't been started yet.</p>
          )
        )}

        {tracking?.accounts_remark && (status === "received" || status === "draft") && (
          <div className="pp-callout is-warning">
            <strong>Clarification requested by Accounts</strong>
            <span>{tracking.accounts_remark}</span>
          </div>
        )}

        {track === "on_completion" && (
          <p className="pp-fin-wait">The EMD will be refunded on completion of the project.</p>
        )}

        {/* ── Refund ─────────────────────────────────────────────── */}
        {isRefund && (status === "pending" || status === "received") && (
          <div className="pp-fin-step">
            <div className="pp-fin-step-head">
              <strong>EMD refund from the client</strong>
              {isTeam ? (
                <div className="pp-seg" role="radiogroup" aria-label="EMD refund">
                  <button type="button" role="radio" aria-checked={status === "pending"} className={`pp-seg-btn${status === "pending" ? " is-on" : ""}`} disabled={!!busy || status === "pending"} onClick={setPending}>Pending</button>
                  <button type="button" role="radio" aria-checked={status === "received"} className={`pp-seg-btn${status === "received" ? " is-on" : ""}`} disabled={!!busy || status === "received"} onClick={() => act("set_refund_received", { received: true }, "Marked received — upload the proof and forward it to Accounts.")}>Received</button>
                </div>
              ) : (
                <Badge variant={EMD_STATUS_VARIANTS[status]}>{EMD_STATUS_LABELS[status]}</Badge>
              )}
            </div>
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
                        Forward to Accounts
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── With Accounts / verified (refund, or a legacy PBG row) ── */}
        {(status === "pending_accounts" || (status === "completed" && track !== "pbg")) && (
          <div className="pp-fin-step">
            <div className="pp-fin-step-head">
              <strong>{isRefund ? "Refund verification" : "PBG with Accounts"}</strong>
              <span className={status === "completed" ? "pp-fin-done" : "pp-fin-wait"}>
                {status === "completed"
                  ? `Verified ${fmtDateTime(tracking.completed_at)}${tracking.completer?.full_name ? ` · ${tracking.completer.full_name}` : ""}`
                  : `Forwarded ${fmtDateTime(tracking.forwarded_at)}${tracking.forwarder?.full_name ? ` by ${tracking.forwarder.full_name}` : ""}`}
              </span>
            </div>
            {tracking.remarks && <p className="pp-fin-quote"><span>Team remarks</span>{tracking.remarks}</p>}
            {tracking.accounts_remark && status === "completed" && <p className="pp-fin-quote"><span>Accounts remarks</span>{tracking.accounts_remark}</p>}
            <FinanceFiles proposalId={proposal.id} purpose={isRefund ? "emd_refund" : "pbg"} files={financeFiles} canManage={false} onChanged={onChanged} />
            {isAccounts && status === "pending_accounts" && (
              <div className="pp-fin-actions">
                <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => setModal("clarify")}>Clarification Request</Button>
                <Button variant="primary" size="sm" disabled={!!busy} onClick={() => setModal("verify")}>{isRefund ? "Verify EMD Refund" : "Confirm PBG Processed"}</Button>
              </div>
            )}
          </div>
        )}

        {/* ── PBG Note, in the same card ─────────────────────────── */}
        {awarded && (
          <PbgNotePanel
            embedded
            proposal={proposal}
            lead={lead}
            note={pbgNote}
            financeFiles={financeFiles}
            events={events}
            profile={profile}
            isAccounts={isAccounts}
            additionalResponsibleIds={additionalResponsibleIds}
            onChanged={onChanged}
          />
        )}
      </Collapsible>

      {timelineOpen && <FinanceTimelineDrawer title="EMD & PBG Timeline" events={timelineEvents} onClose={() => setTimelineOpen(false)} />}
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
