import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { LEAD_PA_TIER_ROLES, ROLE_LABELS } from "../../lib/roles";
import { canOpenProposal } from "../../lib/proposalPrep";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Select from "../../components/ui/Select";
import PinInput from "../../components/ui/PinInput";
import PageLoader from "../../components/ui/PageLoader";
import LeadTimeline from "../../components/leads/LeadTimeline";
import { STATUS_MAP, STATUS_FLOW, DELIVERY_TYPE_LABELS } from "../../components/leads/leadStatus";
// Reuses the ar-* detail/action/timeline/document styles already defined
// for Empanelment's review page — generic patterns (label/value rows,
// stepper, action panel, doc list), no Lead-Gen-specific CSS needed yet.
import "../../styles/ApplicationReviewPage.css";

function fmt(v) {
  return v === null || v === undefined || v === "" ? "—" : v;
}
function fmtDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtSize(bytes) {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function Row({ label, value }) {
  if (!value || value === "—") return null;
  return (
    <div className="ar-row">
      <span className="ar-row-label">{label}</span>
      <span className="ar-row-value">{value}</span>
    </div>
  );
}

// Every action the caller *might* be entitled to for the lead's current
// status — the server (advance-lead-stage) is the real authority; this is
// UX only, filtered again below by the caller's actual tags/assignment.
// requiresPin mirrors advance-lead-stage's REQUIRE_PIN exactly — every
// committee/MD decision (accept, approve, escalate/forward, decline, drop)
// except dgm_initial_decline, which is the one explicit exception (DGM
// sending a lead back to the assignee doesn't need one), and never
// edit/resubmit/claim/reject_reassign.
const ACTIONS_BY_STATUS = {
  pa_review: [
    // Replaces the old one-click "Accept" — navigates to the Lead Approval
    // Note form/preview flow, which itself invokes the same "accept" action
    // (still PIN-gated) once the note has been generated.
    { key: "lead_approval_note", label: "Lead Approval Note", variant: "primary" },
    { key: "__edit_resubmit", label: "Edit", variant: "secondary" },
    // "drop" (self-assigned creator, true drop) and "reject_reassign" (PR
    // who isn't the creator) are mutually exclusive per viewer — only one
    // of the two ever survives the availableActions() filter below.
    { key: "drop", label: "Drop", variant: "danger", requiresPin: true },
    { key: "reject_reassign", label: "Reject", variant: "danger" },
  ],
  pa_dropped: [{ key: "claim", label: "Claim Lead", variant: "primary" }],
  dgm_initial_review: [
    { key: "dgm_initial_approve", label: "Approve → PMT", variant: "primary", requiresReason: true, requiresPin: true },
    { key: "dgm_initial_decline", label: "Decline (return to creator)", variant: "danger", requiresReason: true },
    { key: "drop", label: "Withdraw Lead", variant: "danger", requiresPin: true },
  ],
  pmt_review: [
    { key: "pmt_approve", label: "Approve → MD", variant: "primary", requiresReason: true, requiresPin: true },
    { key: "pmt_escalate", label: "Escalate to PMT Extended", variant: "secondary", requiresReason: true, requiresPin: true },
    { key: "pmt_decline", label: "Decline (return to creator)", variant: "danger", requiresReason: true, requiresPin: true },
    { key: "drop", label: "Withdraw Lead", variant: "danger", requiresPin: true },
  ],
  pmt_extended_review: [
    { key: "pmt_extended_approve", label: "Approve → MD", variant: "primary", requiresReason: true, requiresPin: true },
    { key: "pmt_extended_forward_dgm", label: "Forward to G3", variant: "secondary", requiresPin: true },
    { key: "pmt_extended_decline", label: "Decline (return to creator)", variant: "danger", requiresReason: true, requiresPin: true },
    { key: "drop", label: "Withdraw Lead", variant: "danger", requiresPin: true },
  ],
  dgm_review: [
    { key: "dgm_accept", label: "Accept → MD", variant: "primary", requiresReason: true, requiresPin: true },
    { key: "dgm_decline", label: "Decline (return to creator)", variant: "danger", requiresReason: true, requiresPin: true },
    { key: "drop", label: "Withdraw Lead", variant: "danger", requiresPin: true },
  ],
  md_review: [
    { key: "md_approve", label: "Approve", variant: "primary", requiresPin: true },
    { key: "md_decline", label: "Decline (return to creator)", variant: "danger", requiresReason: true, requiresPin: true },
    { key: "drop", label: "Withdraw Lead", variant: "danger", requiresPin: true },
  ],
  pa_action_required: [
    { key: "__edit_resubmit", label: "Edit & Resubmit", variant: "primary" },
    { key: "drop", label: "Drop", variant: "danger", requiresPin: true },
  ],
};

function DocItem({ doc, leadId }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  async function open() {
    setErr(false);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-lead-document-url", { body: { lead_id: leadId, path: doc.path } });
      if (error || !data?.url) {
        setErr(true);
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ar-doc-item" onClick={!loading ? open : undefined} style={{ cursor: loading ? "wait" : "pointer" }} title={doc.name}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className="ar-doc-label" style={{ fontWeight: 500, fontSize: 13 }}>{doc.name}</span>
        <span style={{ fontSize: 11, opacity: 0.55 }}>{fmtSize(doc.size)}</span>
        {err && <span style={{ fontSize: 11, color: "var(--danger)" }}>Could not open — try again</span>}
      </div>
      <span className="ar-doc-open">{loading ? "Opening…" : "Open"}</span>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [lead, setLead] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState(null);
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [selectedReassignId, setSelectedReassignId] = useState("");
  const [reassignOptions, setReassignOptions] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchLead = useCallback(async () => {
    const { data } = await supabase
      .from("leads")
      .select(
        "*, creator:created_by(full_name), assignee:person_responsible_id(full_name, role), reviewer:reviewer_id(full_name), authority:approval_authority_id(full_name), dgm:handled_by_dgm_id(full_name), ba:assigned_ba_id(full_name)"
      )
      .eq("id", id)
      .maybeSingle();
    setLead(data);
    const { data: activity } = await supabase
      .from("lead_activity_log")
      .select("*, actor:actor_id(full_name)")
      .eq("lead_id", id)
      .order("created_at", { ascending: true });
    setLogs(activity || []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchLead();
  }, [fetchLead]);

  useEffect(() => {
    const channel = supabase
      .channel(`lead-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `id=eq.${id}` }, () => fetchLead())
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_activity_log", filter: `lead_id=eq.${id}` }, () => fetchLead())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [id, fetchLead]);

  function availableActions() {
    if (!lead) return [];
    const candidates = ACTIONS_BY_STATUS[lead.status] || [];
    return candidates.filter((a) => {
      switch (a.key) {
        // Generating/editing the note itself is open to creator or PR (same
        // as Edit), but only PR can actually Submit for DGM Approval from
        // the preview page — enforced there and, ultimately, server-side.
        case "lead_approval_note":
          return lead.status === "pa_review" && (profile?.id === lead.created_by || profile?.id === lead.person_responsible_id);
        // A true drop, no reassignment. At pa_review, only the creator can
        // drop (whether or not they're also PR) — a non-creator PR has no
        // Drop here at all, only Accept/Reject; PR gains Drop once they've
        // actually accepted (pmt_review onward), never before. Creator or
        // PR at every other non-terminal status.
        case "drop":
          if (lead.status === "pa_review") return profile?.id === lead.created_by;
          // DGM sent this back for changes — only they should re-review it,
          // so there's no Withdraw here, only Edit & Resubmit.
          if (lead.status === "pa_action_required" && lead.declined_from_status === "dgm_initial_review") return false;
          return profile?.id === lead.created_by || profile?.id === lead.person_responsible_id;
        // The PR rejecting a lead they didn't create — hands it to a
        // teammate instead of dropping it.
        case "reject_reassign":
          return lead.status === "pa_review" && profile?.id === lead.person_responsible_id && profile?.id !== lead.created_by;
        case "claim":
          return LEAD_PA_TIER_ROLES.includes(profile?.role) && profile?.team === lead.team;
        case "dgm_initial_approve":
        case "dgm_initial_decline":
          return profile?.committee === "G3";
        // PMT / PMT Extended / G3 are all org-wide committees (each spans
        // all 4 teams) — membership alone qualifies, no team match needed.
        case "pmt_approve":
        case "pmt_escalate":
        case "pmt_decline":
          return profile?.committee === "PMT";
        case "pmt_extended_approve":
        case "pmt_extended_forward_dgm":
        case "pmt_extended_decline":
          return profile?.committee === "PMT Extended";
        case "dgm_accept":
        case "dgm_decline":
          return profile?.committee === "G3";
        case "md_approve":
        case "md_decline":
          return profile?.role === "md";
        case "__edit_resubmit":
          return profile?.id === lead.created_by || profile?.id === lead.person_responsible_id;
        default:
          return false;
      }
    });
  }

  // Rejecting before PMT review (as PR, not the creator) hands the lead
  // straight to a chosen teammate instead of releasing it into an open pool.
  const needsReassignSelection = pendingAction?.key === "reject_reassign";

  function startAction(action) {
    if (action.key === "__edit_resubmit") {
      navigate(`/leads/${id}/edit`);
      return;
    }
    if (action.key === "lead_approval_note") {
      navigate(`/leads/${id}/approval-note`);
      return;
    }
    setReason("");
    setPin("");
    setSelectedReassignId("");
    setPendingAction(action);
    if (action.key === "reject_reassign" && lead?.team) {
      supabase
        .from("afc_users")
        .select("id, full_name")
        .in("role", LEAD_PA_TIER_ROLES)
        .eq("team", lead.team)
        .eq("is_active", true)
        .order("full_name")
        .then(({ data }) => setReassignOptions((data || []).filter((u) => u.id !== profile?.id)));
    }
  }

  async function confirmAction() {
    if (!pendingAction) return;
    if (pendingAction.requiresReason && !reason.trim()) {
      showToast("Comment/Description is required", "danger");
      return;
    }
    if (pendingAction.requiresPin && !/^\d{4}$/.test(pin)) {
      showToast("Enter your 4-digit PIN.", "danger");
      return;
    }
    if (needsReassignSelection && !selectedReassignId) {
      showToast("Select a team member to assign this lead to.", "danger");
      return;
    }
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("advance-lead-stage", {
        body: {
          lead_id: id,
          action: pendingAction.key,
          comment: reason.trim(),
          ...(pendingAction.requiresPin ? { pin } : {}),
          ...(needsReassignSelection ? { reassign_to_id: selectedReassignId } : {}),
        },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Action failed."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Action failed.", "danger");
        return;
      }
      showToast(
        needsReassignSelection
          ? "Lead reassigned successfully."
          : `Lead moved to "${(STATUS_MAP[data.status] || { label: data.status }).label}".`,
        "success"
      );
      setPendingAction(null);
      setReason("");
      setPin("");
      setSelectedReassignId("");
      fetchLead();
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <PageLoader text="Loading lead..." />;

  if (!lead) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="ar-not-found"><Alert variant="danger">Lead not found.</Alert></div>
      </div>
    );
  }

  const statusCfg = STATUS_MAP[lead.status] || { label: lead.status, variant: "neutral" };
  const isTerminal = ["md_approved", "md_declined", "pa_dropped"].includes(lead.status);
  const actions = availableActions();
  const currentFlowIdx = STATUS_FLOW.findIndex((s) => s.key === lead.status);
  const allDocuments = lead.documents || [];
  const leadRecords = allDocuments.filter((d) => d.category === "approval_note" || d.category === "final_approval_note");
  const otherDocuments = allDocuments.filter((d) => d.category !== "approval_note" && d.category !== "final_approval_note");

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="ar-page">
          <button className="ar-back-btn" onClick={() => navigate("/leads")}>← Back to Leads</button>

          <Card className="ar-header-card">
            <Card.Body className="ar-header-body">
              <div className="ar-header-left">
                <div className="ar-header-badges">
                  <Badge variant="brand">Lead</Badge>
                  <Badge variant={statusCfg.variant} dot>{statusCfg.label}</Badge>
                </div>
                <h1 className="ar-header-email">{lead.title}</h1>
                <p className="ar-header-meta">
                  {lead.lead_number} · Team: <strong>{lead.team}</strong> · Created: <strong>{fmtDate(lead.created_at)}</strong>
                </p>
              </div>
            </Card.Body>
          </Card>

          {currentFlowIdx >= 0 && (
            <Card>
              <Card.Body className="ar-stepper-body">
                <p className="ar-stepper-heading">Lead Progress</p>
                <div className="ar-stepper">
                  {STATUS_FLOW.map((step, i) => {
                    // The first step is generically "PA" in the shared config,
                    // but here we know exactly who accepted it — show their
                    // actual designation instead.
                    const label = step.key === "pa_review" && lead.assignee?.role
                      ? ROLE_LABELS[lead.assignee.role] || step.label
                      : step.label;
                    return (
                      <div key={step.key} className={`ar-step-outer${i < currentFlowIdx ? " ar-step-done-outer" : ""}`}>
                        <div className="ar-step">
                          <div className={["ar-step-dot", i === currentFlowIdx ? "ar-step-current" : "", i < currentFlowIdx ? "ar-step-done" : ""].filter(Boolean).join(" ")} />
                          <span className={["ar-step-label", i === currentFlowIdx ? "ar-step-label-current" : "", i < currentFlowIdx ? "ar-step-label-done" : ""].filter(Boolean).join(" ")}>{label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card.Body>
            </Card>
          )}

          <div className="ar-grid">
            <div className="ar-left">
              {leadRecords.length > 0 && (
                <Card>
                  <Card.Header title="Lead Records" />
                  <Card.Body>
                    {leadRecords.map((doc, i) => <DocItem key={`${doc.path}-${i}`} doc={doc} leadId={lead.id} />)}
                  </Card.Body>
                </Card>
              )}

              <Card>
                <Card.Header title="Overview" />
                <Card.Body className="ar-detail-body">
                  <Row label="Lead Number" value={lead.lead_number} />
                  <Row label="Lead Type" value="RFP" />
                  <Row label="Portal" value={fmt(lead.portal_name)} />
                  <Row label="Bid / Ref. No." value={fmt(lead.bid_number)} />
                  <Row label="Client / Department" value={fmt(lead.client_name)} />
                  <Row label="State" value={fmt(lead.state)} />
                  <Row label="Last Date of Submission" value={fmtDate(lead.submission_deadline)} />
                  <Row label="Delivery Type" value={lead.delivery_type ? DELIVERY_TYPE_LABELS[lead.delivery_type] || lead.delivery_type : null} />
                  <Row label="Remark" value={fmt(lead.remark)} />
                </Card.Body>
              </Card>

              <Card>
                <Card.Header title="Assignment" />
                <Card.Body className="ar-detail-body">
                  <Row label="Creator" value={fmt(lead.creator?.full_name)} />
                  <Row label="Person Responsible" value={fmt(lead.assignee?.full_name)} />
                  <Row label="Reviewer (PMT)" value={fmt(lead.reviewer?.full_name)} />
                  <Row label="Approval Authority (PMT Extended)" value={fmt(lead.authority?.full_name)} />
                  <Row label="DGM" value={fmt(lead.dgm?.full_name)} />
                  <Row label="Business Associate" value={fmt(lead.ba?.full_name)} />
                </Card.Body>
              </Card>

              <Card>
                <Card.Header title="Documents" />
                <Card.Body>
                  {otherDocuments.length === 0 ? (
                    <p className="ar-empty-text">No documents uploaded.</p>
                  ) : (
                    otherDocuments.map((doc, i) => <DocItem key={`${doc.path}-${i}`} doc={doc} leadId={lead.id} />)
                  )}
                </Card.Body>
              </Card>
            </div>

            <div className="ar-right">
              {actions.length > 0 && !isTerminal && (
                <Card className="ar-action-card">
                  <Card.Header title="Your Action" />
                  <Card.Body className="ar-action-body">
                    {pendingAction ? (
                      <>
                        {needsReassignSelection && (
                          <div className="ar-field">
                            <label className="ar-label">
                              Reassign To <span className="ar-required">*</span>
                            </label>
                            <Select
                              options={reassignOptions.map((u) => ({ value: u.id, label: u.full_name }))}
                              value={selectedReassignId}
                              onChange={setSelectedReassignId}
                              placeholder={reassignOptions.length ? "Select a team member" : "No other active team members found."}
                              disabled={actionLoading}
                            />
                          </div>
                        )}
                        <div className="ar-field">
                          <label className="ar-label">
                            Remarks / Comment {pendingAction.requiresReason && <span className="ar-required">*</span>}
                          </label>
                          <textarea
                            className="input"
                            rows={4}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={pendingAction.requiresReason ? "Enter Remarks" : "Optional comment…"}
                          />
                        </div>
                        {pendingAction.requiresPin && (
                          <div className="ar-field">
                            <PinInput
                              label="Your Action PIN"
                              required
                              value={pin}
                              onChange={setPin}
                              disabled={actionLoading}
                              hint="Confirms it's really you — set or change this from My Profile."
                            />
                          </div>
                        )}
                        <Button variant={pendingAction.variant} block loading={actionLoading} onClick={confirmAction}>
                          Confirm: {pendingAction.label}
                        </Button>
                        <Button variant="secondary" block disabled={actionLoading} onClick={() => setPendingAction(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      actions.map((a) => (
                        <Button key={a.key} variant={a.variant} block onClick={() => startAction(a)}>
                          {a.label}
                        </Button>
                      ))
                    )}
                  </Card.Body>
                </Card>
              )}

              {actions.length === 0 && !isTerminal && (
                <Card><Card.Body className="ar-view-only"><span>Viewing only. Action pending from <strong>{statusCfg.label}</strong>.</span></Card.Body></Card>
              )}

              {isTerminal && (
                <Card className={`ar-final-card ar-final-${lead.status === "md_approved" ? "accepted" : "rejected"}`}>
                  <Card.Body>
                    <p className="ar-final-title">
                      {lead.status === "md_approved" ? "Lead Approved" : lead.status === "md_declined" ? "Lead Declined" : "Lead Dropped"}
                    </p>
                    {lead.status === "md_approved" && canOpenProposal(lead, profile) && (
                      <Button variant="primary" onClick={() => navigate(`/proposals/${lead.id}`)} style={{ marginTop: "var(--space-3)" }}>
                        Open Proposal
                      </Button>
                    )}
                  </Card.Body>
                </Card>
              )}

              <Card>
                <Card.Header title="Timeline" />
                <Card.Body className="ar-timeline-body">
                  <LeadTimeline logs={logs} />
                </Card.Body>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
