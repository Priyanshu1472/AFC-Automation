// EMD after the client's response (proposal_emd_tracking, driven by the
// proposal-emd-action edge function). Shown once the response is recorded
// and the approved Bid Payment Requisition Note carried an EMD.
//
//   Not awarded  -> EMD Refund: Pending / Received toggle. While pending,
//                   the team is reminded every 14 days. Once received, the
//                   team uploads proof + remarks and forwards it to Accounts,
//                   who verify it with their PIN (or send it back).
//   Awarded      -> the team chooses EMD Refund (same as above) or
//                   Converted to PBG: proof, EMD amount (from the note), PBG
//                   amount, remaining PBG = PBG − EMD, the PBG Note, remarks,
//                   then forward to Accounts, who process it with their PIN.
import { useEffect, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import FinanceFiles from "./FinanceFiles";
import FinanceActionModal from "./FinanceActionModal";
import FinanceTimeline from "./FinanceTimeline";
import { RupeeIcon, InfoIcon, CheckCircleIcon, RotateCcwIcon, FileTextIcon } from "../icons";
import { formatINR } from "../../lib/monitoring";
import { EMD_TRACK_LABELS, EMD_STATUS_LABELS, EMD_STATUS_VARIANTS } from "../../lib/proposalPrep";

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

export default function EmdPanel({ proposal, feeNote, tracking, financeFiles, events, isTeam, isAccounts, onChanged }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null); // 'verify' | 'send_back' | 'forward'
  const [pbgDraft, setPbgDraft] = useState("");
  const [remarksDraft, setRemarksDraft] = useState("");

  const emd = Number(tracking?.emd_amount ?? feeNote?.emd_amount ?? 0);
  const awarded = proposal.client_response === "awarded";
  const track = tracking?.track || null;
  const status = tracking?.status || null;
  const isRefund = track === "refund";
  const teamEditable = isTeam && (status === "draft" || status === "pending" || status === "received");

  // Keep the PBG/remarks inputs in step with what's saved whenever the row
  // changes (realtime refresh, another user's edit).
  useEffect(() => {
    setPbgDraft(tracking?.pbg_amount != null ? String(tracking.pbg_amount) : "");
    setRemarksDraft(tracking?.remarks || "");
  }, [tracking?.id, tracking?.pbg_amount, tracking?.remarks, tracking?.status]);

  async function act(action, extra = {}, okMsg) {
    setBusy(action);
    setError("");
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("proposal-emd-action", { body: { proposal_id: proposal.id, action, ...extra } });
      if (fnErr) { setError(await extractFunctionErrorMessage(fnErr, "Something went wrong.")); return false; }
      if (!data?.success) { setError(data?.error || "Something went wrong."); return false; }
      if (okMsg) showToast(okMsg, "success");
      onChanged();
      return true;
    } catch (err) {
      setError(err.message || "Something went wrong.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function view(kind) {
    setBusy(`view_${kind}`);
    setError("");
    try {
      if (kind === "pbg") await openPdf("preview-pbg-note", { proposal_id: proposal.id });
      else await openPdf("preview-fee-note", { fee_note_id: feeNote.id });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const pbgNum = Number(pbgDraft);
  const pbgValid = pbgDraft !== "" && Number.isFinite(pbgNum) && pbgNum > 0;
  const pbgDirty = String(tracking?.pbg_amount ?? "") !== pbgDraft.trim() || (tracking?.remarks || "") !== remarksDraft.trim();
  const remaining = pbgValid ? pbgNum - emd : null;

  async function createPbgNote() {
    if (!pbgValid) { setError("Enter the PBG amount."); return; }
    const ok = await act("save_pbg", { pbg_amount: pbgNum, remark: remarksDraft.trim() });
    if (ok) await view("pbg");
  }

  const proofPurpose = isRefund ? "emd_refund" : "pbg";
  const proofCount = financeFiles.filter((f) => f.purpose === proofPurpose).length;
  const emdEvents = events.filter((ev) => ev.scope === "emd");

  const headerAction = (
    <div className="pp-fee-note-icons">
      {track && <Badge variant="brand">{EMD_TRACK_LABELS[track]}</Badge>}
      {status && <Badge variant={EMD_STATUS_VARIANTS[status]}>{status === "completed" ? (isRefund ? "Refund Verified" : "PBG Processed") : EMD_STATUS_LABELS[status]}</Badge>}
      {!track && <Badge variant="warning">Action Needed</Badge>}
    </div>
  );

  return (
    <Card>
      <Collapsible title={awarded ? "EMD — Refund or PBG" : "EMD Refund"} icon={<RupeeIcon />} action={headerAction}>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        <div className="pp-emd-facts">
          <div><span>EMD deposited</span><strong>{formatINR(emd)}</strong></div>
          <div><span>Client response</span><strong>{awarded ? "Awarded" : "Not awarded"}</strong></div>
          {feeNote && (
            <div>
              <span>EMD note</span>
              <button type="button" className="pp-link-btn" disabled={!!busy} onClick={() => view("fee")}>
                <FileTextIcon /> {busy === "view_fee" ? "Opening…" : "View Bid Payment Requisition Note"}
              </button>
            </div>
          )}
        </div>

        {/* ── Choose: awarded only ─────────────────────────────── */}
        {awarded && (!track || (teamEditable && proofCount === 0)) && (
          isTeam ? (
            <div className="pp-flow-respond">
              <strong className="pp-flow-respond-title">{track ? "Change what happens to the EMD" : "What happens to the EMD?"}</strong>
              <div className="pp-flow-choices" role="radiogroup" aria-label="EMD outcome">
                <button type="button" role="radio" aria-checked={track === "refund"} className={`pp-flow-choice is-awarded${track === "refund" ? " is-selected" : ""}`} disabled={!!busy} onClick={() => track !== "refund" && act("choose_track", { track: "refund" })}>
                  <RotateCcwIcon />
                  <span><strong>EMD Refund</strong><small>The client returns the EMD</small></span>
                </button>
                <button type="button" role="radio" aria-checked={track === "pbg"} className={`pp-flow-choice is-awarded${track === "pbg" ? " is-selected" : ""}`} disabled={!!busy} onClick={() => track !== "pbg" && act("choose_track", { track: "pbg" })}>
                  <CheckCircleIcon />
                  <span><strong>Converted to PBG</strong><small>EMD adjusted towards the Performance Bank Guarantee</small></span>
                </button>
              </div>
            </div>
          ) : (
            !track && <p className="pp-flow-note">Waiting for the Person Responsible, Reviewer or Recommending Authority to choose EMD Refund or Converted to PBG.</p>
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
          <p className="pp-fee-note-remark">Sent back by Accounts: {tracking.accounts_remark}</p>
        )}

        {/* ── Refund ──────────────────────────────────────────── */}
        {isRefund && (status === "pending" || status === "received") && (
          <div className="pp-fin-block">
            <div className="pp-fin-block-head">
              <strong>EMD refund</strong>
              {isTeam ? (
                <div className="pp-seg" role="radiogroup" aria-label="EMD refund">
                  <button type="button" role="radio" aria-checked={status === "received"} className={`pp-seg-btn${status === "received" ? " is-on" : ""}`} disabled={!!busy || status === "received"} onClick={() => act("set_refund_received", { received: true })}>Received</button>
                  <button type="button" role="radio" aria-checked={status === "pending"} className={`pp-seg-btn${status === "pending" ? " is-on" : ""}`} disabled={!!busy || status === "pending"} onClick={() => act("set_refund_received", { received: false })}>Pending</button>
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
                        disabled={!!busy || proofCount === 0 || !remarksDraft.trim()}
                        title={proofCount === 0 ? "Upload at least one proof first" : !remarksDraft.trim() ? "Add a remark first" : undefined}
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

        {/* ── PBG draft ───────────────────────────────────────── */}
        {track === "pbg" && status === "draft" && (
          <div className="pp-fin-block">
            <div className="pp-fin-block-head"><strong>Converted to PBG</strong></div>
            <FinanceFiles proposalId={proposal.id} purpose="pbg" files={financeFiles} canManage={isTeam} emptyText="Upload the proof (PDF, Word or image)." onChanged={onChanged} />
            {isTeam ? (
              <>
                <div className="pp-pbg-grid">
                  <div className="field">
                    <label className="field-label">EMD amount</label>
                    <div className="pp-pbg-static">{formatINR(emd)}</div>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="pbg-amount">PBG amount (₹)</label>
                    <input id="pbg-amount" className="input" type="number" min="0" step="0.01" inputMode="decimal" value={pbgDraft} onChange={(e) => setPbgDraft(e.target.value)} disabled={!!busy} placeholder="e.g. 500000" />
                  </div>
                  <div className="field">
                    <label className="field-label">{remaining != null && remaining < 0 ? "Excess EMD (EMD − PBG)" : "Remaining PBG (PBG − EMD)"}</label>
                    <div className={`pp-pbg-static${remaining != null && remaining < 0 ? " is-neg" : ""}`}>{remaining != null ? formatINR(Math.abs(remaining)) : "—"}</div>
                  </div>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="pbg-remarks">Remarks <span className="required">*</span></label>
                  <textarea id="pbg-remarks" className="input" rows={2} maxLength={2000} value={remarksDraft} onChange={(e) => setRemarksDraft(e.target.value)} disabled={!!busy} />
                </div>
                <div className="pp-fin-actions">
                  <Button variant="secondary" size="sm" icon={<FileTextIcon />} disabled={!!busy || !pbgValid} loading={busy === "save_pbg" || busy === "view_pbg"} onClick={createPbgNote}>
                    {tracking?.pbg_amount != null && !pbgDirty ? "View PBG Note" : "Create PBG Note"}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!!busy || tracking?.pbg_amount == null || pbgDirty || proofCount === 0 || !remarksDraft.trim()}
                    title={tracking?.pbg_amount == null || pbgDirty ? "Create the PBG note first" : proofCount === 0 ? "Upload at least one proof first" : !remarksDraft.trim() ? "Add a remark first" : undefined}
                    loading={busy === "forward"}
                    onClick={() => act("forward", { remark: remarksDraft.trim() }, "Forwarded to Accounts.")}
                  >
                    Forward to Accounts
                  </Button>
                </div>
              </>
            ) : (
              <p className="pp-flow-note">The team is preparing the PBG note.</p>
            )}
          </div>
        )}

        {/* ── With Accounts / completed ───────────────────────── */}
        {(status === "pending_accounts" || status === "completed") && (
          <div className="pp-fin-block">
            <div className="pp-fin-block-head">
              <strong>{isRefund ? "EMD Refund Verification" : "PBG with Accounts"}</strong>
              <span className={status === "completed" ? "pp-fin-done" : "pp-fin-wait"}>
                {status === "completed"
                  ? `${isRefund ? "Verified" : "Processed"} by Accounts ${fmtDateTime(tracking.completed_at)}${tracking.completer?.full_name ? ` (${tracking.completer.full_name})` : ""}`
                  : `Forwarded ${fmtDateTime(tracking.forwarded_at)}${tracking.forwarder?.full_name ? ` by ${tracking.forwarder.full_name}` : ""} — waiting for Accounts`}
              </span>
            </div>
            {!isRefund && (
              <div className="pp-pbg-grid">
                <div className="field"><label className="field-label">EMD amount</label><div className="pp-pbg-static">{formatINR(emd)}</div></div>
                <div className="field"><label className="field-label">PBG amount</label><div className="pp-pbg-static">{formatINR(tracking.pbg_amount)}</div></div>
                <div className="field">
                  <label className="field-label">{Number(tracking.pbg_amount) - emd < 0 ? "Excess EMD (EMD − PBG)" : "Remaining PBG (PBG − EMD)"}</label>
                  <div className="pp-pbg-static">{formatINR(Math.abs(Number(tracking.pbg_amount) - emd))}</div>
                </div>
              </div>
            )}
            {tracking.remarks && <p className="pp-fee-note-justification"><strong>Team remarks:</strong> {tracking.remarks}</p>}
            {tracking.accounts_remark && status === "completed" && <p className="pp-fee-note-justification"><strong>Accounts remarks:</strong> {tracking.accounts_remark}</p>}
            <span className="pp-fin-sub">Uploaded proofs</span>
            <FinanceFiles proposalId={proposal.id} purpose={proofPurpose} files={financeFiles} canManage={false} onChanged={onChanged} />
            <div className="pp-fin-actions">
              {!isRefund && (
                <Button variant="secondary" size="sm" icon={<FileTextIcon />} loading={busy === "view_pbg"} disabled={!!busy} onClick={() => view("pbg")}>View PBG Note</Button>
              )}
              {isAccounts && status === "pending_accounts" && (
                <>
                  <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => setModal("send_back")}>Send Back</Button>
                  <Button variant="primary" size="sm" disabled={!!busy} onClick={() => setModal("verify")}>{isRefund ? "Verify EMD Refund" : "Confirm PBG Processed"}</Button>
                </>
              )}
            </div>
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
      {modal === "send_back" && (
        <FinanceActionModal
          title="Send Back to the Team"
          intro="The team can fix it and forward it again."
          confirmLabel="Send Back"
          confirmVariant="danger"
          remarkLabel="What needs fixing"
          remarkRequired
          run={({ remark }) => supabase.functions.invoke("proposal-emd-action", { body: { proposal_id: proposal.id, action: "send_back", remark } })}
          onClose={() => setModal(null)}
          onSuccess={() => { setModal(null); showToast("Sent back to the team.", "success"); onChanged(); }}
        />
      )}
    </Card>
  );
}
