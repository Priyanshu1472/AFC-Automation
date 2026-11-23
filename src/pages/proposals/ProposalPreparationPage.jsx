// Proposal Preparation for an MD-approved lead, built to be followed step
// by step:
//   header            title, type badges, key facts and people
//   Your next action  the one thing the logged-in user should do now (or
//                     who it's waiting on), with a Go button to that stage
//   stage tabs        Fee Note → Documents → Financial → Lock & Result →
//                     EMD & PBG, each with its status; only the open stage
//                     is shown, and it opens on the one that needs you
//   Timeline          right-hand column (same look as the Lead page)
// The proposal chat is the floating bubble. Reached from "Open Proposal" once a lead's
// status is 'md_approved'. Attaches directly to the existing `leads` row
// (see 20260820040000_proposal_preparation_schema.sql). An awarded
// proposal continues in Monitoring (monitoring_projects, opened by a DB
// trigger the moment the outcome is recorded).
//
// After the MD approves the Bid Payment Requisition Note, the Accounts
// Committee opens this same page to make the payment, and later to verify
// the EMD refund (EmdPanel) and review/pay the PBG (PbgNotePanel). They see
// the whole page (read-only outside those steps), plus the proposal chat
// they're added to when work reaches them.
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import FeeNotesPanel from "../../components/proposals/FeeNotesPanel";
import BaDocumentRequestsPanel from "../../components/proposals/BaDocumentRequestsPanel";
import ProposalDocumentsPanel from "../../components/proposals/ProposalDocumentsPanel";
import ProposalLockPanel from "../../components/proposals/ProposalLockPanel";
import ProposalValuePanel from "../../components/proposals/ProposalValuePanel";
import ProposalChatPanel from "../../components/proposals/ProposalChatPanel";
import ProposalTimeline from "../../components/proposals/ProposalTimeline";
import AdditionalResponsiblesPanel from "../../components/proposals/AdditionalResponsiblesPanel";
import Button from "../../components/ui/Button";
import { ArrowRightIcon, ClockIcon, CheckCircleIcon, UserPlusIcon } from "../../components/icons";
import EmdPanel from "../../components/proposals/EmdPanel";
import PbgNotePanel from "../../components/proposals/PbgNotePanel";
import {
  isProposalLocked, isAccountsCommittee, isProposalTeam, proposedValueRule, isProjectAward, outcomeLabel, leadTypeLabel, FEE_NOTE_TITLE,
  PBG_NOTE_STATUS_LABELS, EMD_STATUS_LABELS,
} from "../../lib/proposalPrep";
import { formatINR } from "../../lib/monitoring";
import "../../styles/ApplicationReviewPage.css";
import "../../styles/ProposalPreparationPage.css";
import BackButton from "../../components/ui/BackButton";
import { isDeadlinePassed } from "../../lib/deadline";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function ProposalPreparationPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [lead, setLead] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [feeNotes, setFeeNotes] = useState([]);
  const [baItems, setBaItems] = useState([]);
  const [monitoringProjectId, setMonitoringProjectId] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [additionalResponsibles, setAdditionalResponsibles] = useState([]);
  const [emdTracking, setEmdTracking] = useState(null);
  const [pbgNote, setPbgNote] = useState(null);
  const [financeFiles, setFinanceFiles] = useState([]);
  const [financeEvents, setFinanceEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Bumped on every re-fetch so the Activity Timeline picks up new steps.
  const [refreshKey, setRefreshKey] = useState(0);
  const proposalIdRef = useRef(null);
  // Which stage tab is open; null = the one that needs attention.
  const [activeStage, setActiveStage] = useState(null);
  const [addingPr, setAddingPr] = useState(false);

  const fetchAll = useCallback(async () => {
    setError("");
    const { data: leadRow, error: leadErr } = await supabase
      .from("leads")
      .select("*, pr:person_responsible_id(full_name), rev:reviewer_id(full_name), aa:recommending_authority_id(full_name), ba:assigned_ba_id(full_name)")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !leadRow) { setError(leadErr?.message || "Lead not found."); setLoading(false); return; }
    setLead(leadRow);

    // Create/open the proposal once per visit. Re-fetches (realtime events)
    // reuse the id — calling the create function on every refresh let two
    // calls race and trip the one-proposal-per-lead constraint.
    let proposalId = proposalIdRef.current?.leadId === leadId ? proposalIdRef.current.id : null;
    if (!proposalId) {
      const { data: created, error: createErr } = await supabase.functions.invoke("create-proposal-preparation", { body: { lead_id: leadId } });
      if (createErr) { setError(await extractFunctionErrorMessage(createErr, "Failed to open this proposal.")); setLoading(false); return; }
      if (!created?.success) { setError(created?.error || "Failed to open this proposal."); setLoading(false); return; }
      proposalId = created.proposal_id;
      proposalIdRef.current = { leadId, id: proposalId };
    }

    const [
      { data: proposalRow, error: proposalErr },
      { data: feeNoteRows },
      { data: baItemRows },
      { data: monitoringRow },
      { data: docRows },
      { data: additionalRows },
      { data: emdRow },
      { data: financeFileRows },
      { data: financeEventRows },
      { data: pbgNoteRow },
    ] = await Promise.all([
      supabase.from("proposal_preparations").select("*, locker:locked_by(full_name), responder:client_response_by(full_name)").eq("id", proposalId).maybeSingle(),
      supabase.from("fee_notes").select("*, payer:payment_done_by(full_name)").eq("proposal_id", proposalId),
      supabase.from("proposal_document_requests").select("*").eq("proposal_id", proposalId).order("created_at"),
      supabase.from("monitoring_projects").select("id").eq("proposal_id", proposalId).maybeSingle(),
      supabase.from("proposal_documents").select("*").eq("proposal_id", proposalId),
      supabase.from("proposal_additional_responsibles").select("user_id, user:user_id(full_name)").eq("proposal_id", proposalId).order("created_at"),
      supabase.from("proposal_emd_tracking").select("*, forwarder:forwarded_by(full_name), completer:completed_by(full_name)").eq("proposal_id", proposalId).maybeSingle(),
      supabase.from("proposal_finance_files").select("*").eq("proposal_id", proposalId),
      supabase.from("proposal_finance_events").select("*, actor:actor_id(full_name, role)").eq("proposal_id", proposalId).order("created_at"),
      supabase.from("proposal_pbg_notes").select("*, payer:payment_done_by(full_name)").eq("proposal_id", proposalId).maybeSingle(),
    ]);
    if (proposalErr || !proposalRow) {
      setError(proposalErr?.message || "This proposal could not be loaded. It may have just been created — try refreshing.");
      setLoading(false);
      return;
    }

    setProposal(proposalRow);
    setFeeNotes(feeNoteRows || []);
    setBaItems(baItemRows || []);
    setMonitoringProjectId(monitoringRow?.id || null);
    setDocuments(docRows || []);
    setAdditionalResponsibles((additionalRows || []).map((r) => ({ user_id: r.user_id, full_name: r.user?.full_name || "—" })));
    setEmdTracking(emdRow || null);
    setFinanceFiles(financeFileRows || []);
    setFinanceEvents(financeEventRows || []);
    setPbgNote(pbgNoteRow || null);
    setRefreshKey((k) => k + 1);
    setLoading(false);
  }, [leadId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!proposal?.id) return;
    const channel = supabase
      .channel(`proposal-${proposal.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_preparations", filter: `id=eq.${proposal.id}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "fee_notes", filter: `proposal_id=eq.${proposal.id}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_emd_tracking", filter: `proposal_id=eq.${proposal.id}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_pbg_notes", filter: `proposal_id=eq.${proposal.id}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_finance_files", filter: `proposal_id=eq.${proposal.id}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_documents", filter: `proposal_id=eq.${proposal.id}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_activity", filter: `proposal_id=eq.${proposal.id}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_additional_responsibles", filter: `proposal_id=eq.${proposal.id}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_document_requests", filter: `proposal_id=eq.${proposal.id}` }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.id]);

  if (loading) return <PageLoader text="Loading proposal…" />;

  if (error && (!lead || !proposal)) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="app-container">
          <Alert variant="danger">{error}</Alert>
        </div>
      </div>
    );
  }

  const additionalResponsibleIds = additionalResponsibles.map((a) => a.user_id);
  const canManage = profile && (
    ["md", "admin"].includes(profile.role) ||
    [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(profile.id) ||
    additionalResponsibleIds.includes(profile.id)
  );
  // Strictly "md" (no admin override) — only used by FeeNotesPanel, where
  // md_decided_by prints under "Managing Director" on the note itself, so
  // whoever approves must actually hold that role.
  const isMd = profile && profile.role === "md";
  // The BP-requests list is a day-to-day working document for the lead's
  // own team (Person Responsible, Reviewer,
  // Recommending Authority) — MD/Admin can see them but never add/edit/
  // delete, unlike the rest of this page where MD/Admin get the usual
  // override.
  const canManageDocs = profile && (
    [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(profile.id) ||
    additionalResponsibleIds.includes(profile.id)
  );
  const locked = isProposalLocked(proposal, lead);
  const isAccounts = isAccountsCommittee(profile);
  // The lead's own team (PR / Reviewer / RA / additional PR), without the
  // md/admin override canManage carries.
  const isTeam = isProposalTeam(profile, lead, additionalResponsibleIds);
  // An Accounts Committee member who isn't otherwise on this lead: sees every
  // card (read-only outside the money steps), just not the "deadline passed,
  // lock it" nudge meant for the team.
  const accountsOnly = isAccounts && !canManage && !isMd;
  const approvedNote = feeNotes.find((n) => n.status === "approved") || null;
  const valueRule = proposedValueRule(lead, proposal);
  const showEmd = proposal.client_response !== "pending" && Number(approvedNote?.emd_amount) > 0;
  const projectAward = isProjectAward(proposal);
  const pastDeadline = !!lead.submission_deadline && isDeadlinePassed(lead.submission_deadline) && !proposal.locked;
  const showBaDocs = !!lead.assigned_ba_id || baItems.length > 0;
  const responded = proposal.client_response !== "pending";
  const raName = lead.aa?.full_name || "the Recommending Authority";
  const prName = lead.pr?.full_name || "the Person Responsible";
  const me = profile?.id;
  const isRaUser = !!me && me === lead.recommending_authority_id;
  const isPrUser = !!me && ([lead.person_responsible_id, lead.reviewer_id].includes(me) || additionalResponsibleIds.includes(me));
  // Accounts pays the approved note; the Person Responsible (or an additional
  // one) can also record it, in case the payment was made through them.
  const canMarkFeePaid = isAccounts || (!!me && (me === lead.person_responsible_id || additionalResponsibleIds.includes(me)));

  // ── What locking needs (shown in the Lock & Result stage) ────────────
  const fee = feeNotes[0] || null;
  const feeItem = { key: "fee", label: FEE_NOTE_TITLE, target: "fee" };
  if (!fee) Object.assign(feeItem, { state: "todo", note: `Not started. ${prName} prepares it.`, short: "Not started" });
  else if (fee.status === "draft") Object.assign(feeItem, { state: "todo", note: `Draft. ${prName} forwards it to ${raName}.`, short: "Draft" });
  else if (fee.status === "pending_recommending_authority") Object.assign(feeItem, { state: "wait", note: `Waiting on ${raName} (Recommending Authority).`, short: "With RA" });
  else if (fee.status === "pending_md") Object.assign(feeItem, { state: "wait", note: "Waiting on the MD's approval.", short: "With MD" });
  else if (fee.status === "rejected") Object.assign(feeItem, { state: "todo", note: "Rejected by the MD.", short: "Rejected" });
  else Object.assign(feeItem, {
    state: "done",
    note: fee.payment_status === "paid" ? "Approved by the MD and paid by Accounts." : "Approved by the MD. Payment pending with Accounts.",
    short: fee.payment_status === "paid" ? "Approved · Paid" : "Approved · Payment pending",
  });

  const docsItem = documents.length
    ? { key: "docs", label: "Proposal documents", target: "docs", state: "done", note: `${documents.length} uploaded.`, short: `${documents.length} file${documents.length === 1 ? "" : "s"}` }
    : { key: "docs", label: "Proposal documents", target: "docs", state: "todo", note: "Upload at least one document.", short: "None yet" };

  const valueItem = { key: "value", label: "Proposed value", target: "value" };
  if (valueRule === "none") Object.assign(valueItem, { state: "na", note: "Not needed: marked Empanelment only.", short: "Not needed" });
  else if (proposal.proposed_value != null) Object.assign(valueItem, { state: "done", note: formatINR(proposal.proposed_value), short: formatINR(proposal.proposed_value) });
  else if (valueRule === "optional") Object.assign(valueItem, { state: "na", note: "Optional for an EOI.", short: "Optional" });
  else Object.assign(valueItem, { state: "todo", note: "Enter it in Financial, or tick Empanelment only.", short: "Required" });

  const checklist = [feeItem, docsItem, valueItem];
  const readyToLock = checklist.every((c) => c.state === "done" || c.state === "na");

  // ── After the result: EMD / PBG ───────────────────────────────────────
  const showMoney = showEmd || projectAward;
  const tStatus = emdTracking?.status;
  const pStatus = pbgNote?.status;
  let moneyState = "todo";
  let moneyShort = "To do";
  if (showEmd) {
    if (emdTracking?.track === "pbg") {
      moneyState = tStatus === "completed" || pStatus === "completed" ? "done" : pStatus && pStatus !== "draft" ? "wait" : "todo";
      moneyShort = moneyState === "done" ? "PBG done" : pStatus ? PBG_NOTE_STATUS_LABELS[pStatus] : "PBG Note to prepare";
    } else if (!emdTracking) { moneyShort = "Choose EMD path"; }
    else if (tStatus === "completed") { moneyState = "done"; moneyShort = "Refund verified"; }
    else if (tStatus === "awaiting_completion") { moneyState = "na"; moneyShort = "On completion"; }
    else if (tStatus === "pending_accounts") { moneyState = "wait"; moneyShort = "With Accounts"; }
    else moneyShort = EMD_STATUS_LABELS[tStatus] || "To do";
  } else if (projectAward) {
    moneyState = pStatus === "completed" ? "done" : pStatus && pStatus !== "draft" ? "wait" : "todo";
    moneyShort = pStatus ? PBG_NOTE_STATUS_LABELS[pStatus] : "PBG Note if needed";
  }

  const stages = [
    { key: "fee", label: "Fee Note", state: feeItem.state, short: feeItem.short },
    { key: "docs", label: "Documents", state: docsItem.state, short: docsItem.short },
    { key: "value", label: "Financial", state: valueItem.state === "na" ? "done" : valueItem.state, short: valueItem.short },
    {
      key: "lock",
      label: "Lock & Result",
      state: responded ? "done" : proposal.locked ? "todo" : readyToLock ? "todo" : "upcoming",
      short: responded ? outcomeLabel(proposal) : proposal.locked ? "Record result" : readyToLock ? "Ready to lock" : "After the above",
    },
    ...(showMoney ? [{ key: "money", label: showEmd ? "EMD & PBG" : "PBG", state: moneyState, short: moneyShort }] : []),
  ];

  // ── The one thing this user should do next ────────────────────────────
  let action = null;
  const team = canManage;
  if (!locked && !fee && (isPrUser || profile?.role === "admin")) action = { stage: "fee", title: "Prepare the Bid Payment Requisition Note", text: "Fill in the EMD, tender fee and processing fee, then forward it for approval." };
  else if (!locked && fee?.status === "draft" && isPrUser) action = { stage: "fee", title: "Forward the fee note to the Recommending Authority", text: `Check the note, then send it to ${raName}.` };
  else if (!locked && fee?.status === "pending_recommending_authority" && isRaUser) action = { stage: "fee", title: "Review the Bid Payment Requisition Note", text: "Forward it to the MD, or send it back with a remark." };
  else if (!locked && fee?.status === "pending_md" && isMd) action = { stage: "fee", title: "Approve the Bid Payment Requisition Note", text: "Approve it, or send it back with a remark." };
  else if (fee?.status === "approved" && fee.payment_status !== "paid" && canMarkFeePaid) action = { stage: "fee", title: "Make the payment and mark it done", text: "Upload the payment proof and confirm with your PIN." };
  else if (team && !locked && !documents.length) action = { stage: "docs", title: "Upload the proposal documents", text: "Add the files you're submitting to the client." };
  else if (team && !locked && valueItem.state === "todo") action = { stage: "value", title: "Enter the proposed value", text: "Or tick Empanelment only if this tender has no value." };
  else if (team && !proposal.locked && readyToLock) action = { stage: "lock", title: "Lock the proposal", text: "Once it's submitted to the client. This stops edits and closes the chat." };
  else if (team && proposal.locked && !responded) action = { stage: "lock", title: "Record the client's response", text: "Awarded, not awarded, or (for an EOI) moves to the RFP stage." };
  else if (showEmd && team && !emdTracking && projectAward) action = { stage: "money", title: "Choose what happens to the EMD", text: "Refund, convert to PBG, or refund on completion." };
  else if (showEmd && team && emdTracking?.track === "refund" && ["pending", "received"].includes(tStatus)) action = { stage: "money", title: tStatus === "pending" ? "Follow up the EMD refund" : "Forward the EMD refund to Accounts", text: tStatus === "pending" ? "Mark it Received once the client returns it." : "Upload the proof, add a remark and forward it." };
  else if (showEmd && isAccounts && tStatus === "pending_accounts") action = { stage: "money", title: "Verify the EMD refund", text: "Check the proof and verify with your PIN, or ask for clarification." };
  else if (projectAward && pStatus === "pending_ra" && isRaUser) action = { stage: "money", title: "Review the PBG Note", text: "Approve it or ask for clarification." };
  else if (projectAward && pStatus === "pending_md" && isMd) action = { stage: "money", title: "Approve the PBG Note", text: "Approve it or ask for clarification." };
  else if (projectAward && pStatus === "pending_accounts" && isAccounts) action = { stage: "money", title: "Review the PBG Note", text: "Approve it or ask for clarification." };
  else if (projectAward && pStatus === "pending_payment" && (isAccounts || team)) action = { stage: "money", title: "Mark the PBG payment done", text: "Upload the payment proof and confirm." };
  else if (projectAward && pStatus === "draft" && isPrUser) action = { stage: "money", title: "Forward the PBG Note", text: "Upload the proof and forward it to the Recommending Authority." };

  // Not on you: say who it's waiting on.
  const firstOpen = stages.find((s) => s.state !== "done");
  const waitingText = !firstOpen
    ? "Everything on this proposal is complete."
    : firstOpen.key === "fee" ? feeItem.note
      : firstOpen.key === "docs" ? "Waiting for the team to upload the proposal documents."
        : firstOpen.key === "value" ? "Waiting for the team to enter the proposed value."
          : firstOpen.key === "lock" ? (proposal.locked ? "Waiting for the team to record the client's response." : "Waiting for the team to lock the proposal.")
            : `EMD / PBG: ${firstOpen.short}.`;

  const defaultStage = action?.stage || firstOpen?.key || stages[stages.length - 1].key;
  const current = stages.some((s) => s.key === activeStage) ? activeStage : defaultStage;

  const valueText = proposal.empanelment_only
    ? "Empanelment only"
    : proposal.proposed_value != null
      ? formatINR(proposal.proposed_value)
      : valueRule === "optional" ? "Optional (EOI)" : "Not entered";

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="pp-page animate-fadeUp">
          <BackButton to="/proposals" label="Back to Proposals" />

          <div className="pp-layout">
            <div className="pp-main">
              {/* ── Header ───────────────────────────────────────── */}
              <Card className="pp-head-card">
                <div className="pp-head-badges">
                  <Badge variant="brand">{leadTypeLabel(lead)}</Badge>
                  {proposal.empanelment_only && <Badge variant="neutral">Empanelment only</Badge>}
                  <Badge variant={proposal.locked ? "neutral" : "success"} dot>{proposal.locked ? "Locked" : "In Progress"}</Badge>
                  {responded && (
                    <Badge variant={proposal.client_response === "rejected" ? "danger" : "success"}>{outcomeLabel(proposal)}</Badge>
                  )}
                </div>
                <h1 className="pp-head-title">{lead.title}</h1>
                <p className="pp-head-meta">
                  <button type="button" className="pp-lead-number-link" onClick={() => navigate(`/leads/${lead.id}`, { state: { from: "proposal" } })}>{lead.lead_number}</button>
                  {lead.client_name && <span>{lead.client_name}</span>}
                  {lead.portal_name && <span>{lead.portal_name}</span>}
                </p>

                <dl className="pp-facts">
                  <div><dt>Last Date</dt><dd className={pastDeadline ? "pp-overdue" : ""}>{fmtDate(lead.submission_deadline)}</dd></div>
                  <div><dt>Proposed Value</dt><dd>{valueText}</dd></div>
                  <div><dt>Reference No.</dt><dd>{lead.bid_number || "—"}</dd></div>
                  <div><dt>Business Partner</dt><dd>{lead.ba?.full_name || "—"}</dd></div>
                </dl>

                <div className="pp-people">
                  <div className="pp-person pp-person-pr">
                    <span className="pp-person-label">
                      Person Responsible
                      {canManage && !locked && (
                        <button
                          type="button"
                          className="pp-person-add"
                          title="Add another Person Responsible"
                          aria-label="Add another Person Responsible"
                          aria-expanded={addingPr}
                          onClick={() => setAddingPr((v) => !v)}
                        >
                          <UserPlusIcon />
                        </button>
                      )}
                    </span>
                    <strong>{lead.pr?.full_name || "—"}</strong>
                    <AdditionalResponsiblesPanel
                      leadId={lead.id}
                      team={lead.team}
                      existingIds={[lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id]}
                      additional={additionalResponsibles}
                      canManage={canManage}
                      locked={locked}
                      onChanged={fetchAll}
                      adding={addingPr}
                      onAddingChange={setAddingPr}
                    />
                  </div>
                  <div className="pp-person"><span>Reviewer</span><strong>{lead.rev?.full_name || "—"}</strong></div>
                  <div className="pp-person"><span>Recommending Authority</span><strong>{lead.aa?.full_name || "—"}</strong></div>
                </div>
              </Card>

              {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
              {!proposal.locked && pastDeadline && !accountsOnly && (
                <Alert variant="warning">
                  The submission deadline ({fmtDate(lead.submission_deadline)}) has passed, so the fee note and documents are read-only now.
                </Alert>
              )}

              {/* ── Your next action ─────────────────────────────── */}
              {action ? (
                <div className="pp-todo">
                  <span className="pp-todo-icon" aria-hidden="true"><ArrowRightIcon /></span>
                  <div className="pp-todo-text">
                    <span className="pp-todo-kicker">Your next action</span>
                    <strong>{action.title}</strong>
                    <span>{action.text}</span>
                  </div>
                  {current !== action.stage && (
                    <Button size="sm" onClick={() => setActiveStage(action.stage)}>Go</Button>
                  )}
                </div>
              ) : (
                <div className={`pp-todo is-quiet${!firstOpen ? " is-complete" : ""}`}>
                  <span className="pp-todo-icon" aria-hidden="true">{firstOpen ? <ClockIcon /> : <CheckCircleIcon />}</span>
                  <div className="pp-todo-text">
                    <span className="pp-todo-kicker">{firstOpen ? "Nothing waiting on you" : "All done"}</span>
                    <strong>{waitingText}</strong>
                  </div>
                </div>
              )}

              {/* ── Stages ───────────────────────────────────────── */}
              <nav className="pp-stages" aria-label="Proposal stages">
                {stages.map((s, i) => (
                  <button
                    key={s.key}
                    type="button"
                    className={`pp-stage is-${s.state}${current === s.key ? " is-active" : ""}`}
                    aria-current={current === s.key ? "step" : undefined}
                    onClick={() => setActiveStage(s.key)}
                  >
                    <span className="pp-stage-num" aria-hidden="true">
                      {s.state === "done" ? <CheckCircleIcon /> : s.state === "wait" ? <ClockIcon /> : i + 1}
                    </span>
                    <span className="pp-stage-text">
                      <strong>{s.label}</strong>
                      <span>{s.short}</span>
                    </span>
                  </button>
                ))}
              </nav>

              <section className="pp-stage-card" aria-label={stages.find((s) => s.key === current)?.label}>
                {current === "fee" && (
                  <FeeNotesPanel
                    bare
                    proposalId={proposal.id}
                    feeNotes={feeNotes}
                    lead={lead}
                    profile={profile}
                    isMd={isMd}
                    isAccounts={isAccounts}
                    canMarkPaid={canMarkFeePaid}
                    isTeam={isTeam}
                    financeFiles={financeFiles}
                    locked={locked}
                    onChanged={fetchAll}
                  />
                )}

                {current === "docs" && (
                  <>
                    <ProposalDocumentsPanel bare proposalId={proposal.id} documents={documents} canManage={canManage} locked={locked} onChanged={fetchAll} />
                    {showBaDocs && (
                      <div className="pp-stage-split">
                        <BaDocumentRequestsPanel
                          bare
                          proposalId={proposal.id}
                          proposal={proposal}
                          items={baItems}
                          profile={profile}
                          canManage={canManageDocs}
                          locked={locked}
                          hasBa={!!lead.assigned_ba_id}
                          onChanged={fetchAll}
                        />
                      </div>
                    )}
                  </>
                )}

                {current === "value" && (
                  <ProposalValuePanel bare proposal={proposal} canManage={canManage} valueRule={valueRule} onChanged={fetchAll} />
                )}

                {current === "lock" && (
                  <ProposalLockPanel
                    bare
                    proposal={proposal}
                    lead={lead}
                    pastDeadline={pastDeadline}
                    canManage={canManage}
                    monitoringProjectId={monitoringProjectId}
                    checklist={checklist}
                    onJump={setActiveStage}
                    onChanged={fetchAll}
                  />
                )}

                {current === "money" && showEmd && (
                  <EmdPanel
                    bare
                    proposal={proposal}
                    lead={lead}
                    profile={profile}
                    additionalResponsibleIds={additionalResponsibleIds}
                    feeNote={approvedNote}
                    tracking={emdTracking}
                    pbgNote={pbgNote}
                    financeFiles={financeFiles}
                    events={financeEvents}
                    isTeam={canManage}
                    isAccounts={isAccounts}
                    onChanged={fetchAll}
                  />
                )}
                {current === "money" && !showEmd && projectAward && (
                  <PbgNotePanel
                    bare
                    proposal={proposal}
                    lead={lead}
                    note={pbgNote}
                    financeFiles={financeFiles}
                    events={financeEvents}
                    profile={profile}
                    isAccounts={isAccounts}
                    additionalResponsibleIds={additionalResponsibleIds}
                    onChanged={fetchAll}
                  />
                )}
              </section>
            </div>

            <aside className="pp-aside">
              <ProposalTimeline proposalId={proposal.id} refreshKey={refreshKey} />
            </aside>
          </div>

          {/* Floating chat bubble, for people on the chat roster (the panel
              checks that itself). Read-only once the proposal is locked. */}
          <ProposalChatPanel proposalId={proposal.id} chatOpenedAt={proposal.chat_opened_at} locked={!!proposal.locked} />
        </div>
      </div>
    </div>
  );
}
