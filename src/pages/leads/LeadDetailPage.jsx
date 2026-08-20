import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { LEAD_PA_TIER_ROLES } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Select from "../../components/ui/Select";
import PageLoader from "../../components/ui/PageLoader";
import LeadTimeline from "../../components/leads/LeadTimeline";
import { STATUS_MAP, STATUS_FLOW } from "../../components/leads/leadStatus";
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
const ACTIONS_BY_STATUS = {
  pa_review: [
    { key: "accept", label: "Accept", variant: "primary" },
    { key: "__edit_resubmit", label: "Edit", variant: "secondary" },
    // "drop" (self-assigned creator, true drop) and "reject_reassign" (PR
    // who isn't the creator) are mutually exclusive per viewer — only one
    // of the two ever survives the availableActions() filter below.
    { key: "drop", label: "Drop", variant: "danger" },
    { key: "reject_reassign", label: "Reject", variant: "danger" },
  ],
  pa_dropped: [{ key: "claim", label: "Claim Lead", variant: "primary" }],
  pmt_review: [
    { key: "pmt_approve", label: "Approve → MD", variant: "primary", requiresReason: true },
    { key: "pmt_escalate", label: "Escalate to PMT Extended", variant: "secondary", requiresReason: true },
    { key: "pmt_decline", label: "Decline (return to creator)", variant: "danger", requiresReason: true },
    { key: "drop", label: "Withdraw Lead", variant: "danger" },
  ],
  pmt_extended_review: [
    { key: "pmt_extended_approve", label: "Approve → MD", variant: "primary", requiresReason: true },
    { key: "pmt_extended_forward_dgm", label: "Forward to G3", variant: "secondary" },
    { key: "pmt_extended_decline", label: "Decline (return to creator)", variant: "danger", requiresReason: true },
    { key: "drop", label: "Withdraw Lead", variant: "danger" },
  ],
  dgm_review: [
    { key: "dgm_accept", label: "Accept → MD", variant: "primary", requiresReason: true },
    { key: "dgm_decline", label: "Decline (return to creator)", variant: "danger", requiresReason: true },
    { key: "drop", label: "Withdraw Lead", variant: "danger" },
  ],
  md_review: [
    { key: "md_approve", label: "Approve", variant: "primary" },
    { key: "md_decline", label: "Decline", variant: "danger", requiresReason: true },
    { key: "drop", label: "Withdraw Lead", variant: "danger" },
  ],
  pa_action_required: [
    { key: "__edit_resubmit", label: "Edit & Resubmit", variant: "primary" },
    { key: "drop", label: "Drop", variant: "danger" },
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

  const [lead, setLead] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState(null);
  const [reason, setReason] = useState("");
  const [selectedBaId, setSelectedBaId] = useState("");
  const [baOptions, setBaOptions] = useState([]);
  const [selectedReassignId, setSelectedReassignId] = useState("");
  const [reassignOptions, setReassignOptions] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [banner, setBanner] = useState(null);

  const fetchLead = useCallback(async () => {
    const { data } = await supabase
      .from("leads")
      .select(
        "*, creator:created_by(full_name), assignee:person_responsible_id(full_name), reviewer:reviewer_id(full_name), authority:approval_authority_id(full_name), dgm:handled_by_dgm_id(full_name), ba:assigned_ba_id(full_name)"
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
        case "accept":
          return lead.status === "pa_review" && profile?.id === lead.person_responsible_id;
        // A true drop, no reassignment. At pa_review, only the creator can
        // drop (whether or not they're also PR) — a non-creator PR has no
        // Drop here at all, only Accept/Reject; PR gains Drop once they've
        // actually accepted (pmt_review onward), never before. Creator or
        // PR at every other non-terminal status.
        case "drop":
          if (lead.status === "pa_review") return profile?.id === lead.created_by;
          return profile?.id === lead.created_by || profile?.id === lead.person_responsible_id;
        // The PR rejecting a lead they didn't create — hands it to a
        // teammate instead of dropping it.
        case "reject_reassign":
          return lead.status === "pa_review" && profile?.id === lead.person_responsible_id && profile?.id !== lead.created_by;
        case "claim":
          return LEAD_PA_TIER_ROLES.includes(profile?.role) && profile?.team === lead.team;
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

  // A BA is optional at creation but required before the Person Responsible
  // can accept a lead into PMT review — only relevant for "accept" and only
  // when the lead doesn't already have one.
  const needsBaSelection = pendingAction?.key === "accept" && !lead?.assigned_ba_id;
  // Rejecting before PMT review (as PR, not the creator) hands the lead
  // straight to a chosen teammate instead of releasing it into an open pool.
  const needsReassignSelection = pendingAction?.key === "reject_reassign";

  function startAction(action) {
    if (action.key === "__edit_resubmit") {
      navigate(`/leads/${id}/edit`);
      return;
    }
    setBanner(null);
    setReason("");
    setSelectedBaId("");
    setSelectedReassignId("");
    setPendingAction(action);
    if (action.key === "accept" && !lead?.assigned_ba_id && lead?.team) {
      supabase
        .rpc("get_team_business_associates", { p_team: lead.team })
        .then(({ data }) => setBaOptions(data || []));
    }
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
      setBanner({ type: "danger", text: "Comment/Description is required" });
      return;
    }
    if (needsBaSelection && !selectedBaId) {
      setBanner({ type: "danger", text: "Select a BA" });
      return;
    }
    if (needsReassignSelection && !selectedReassignId) {
      setBanner({ type: "danger", text: "Select a team member to assign this lead to." });
      return;
    }
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("advance-lead-stage", {
        body: {
          lead_id: id,
          action: pendingAction.key,
          comment: reason.trim(),
          ...(needsBaSelection ? { assigned_ba_id: selectedBaId } : {}),
          ...(needsReassignSelection ? { reassign_to_id: selectedReassignId } : {}),
        },
      });
      if (error) {
        setBanner({ type: "danger", text: await extractFunctionErrorMessage(error, "Action failed.") });
        return;
      }
      if (!data?.success) {
        setBanner({ type: "danger", text: data?.error || "Action failed." });
        return;
      }
      setBanner({
        type: "success",
        text: needsReassignSelection
          ? "Lead reassigned successfully."
          : `Lead moved to "${(STATUS_MAP[data.status] || { label: data.status }).label}".`,
      });
      setPendingAction(null);
      setReason("");
      setSelectedBaId("");
      setSelectedReassignId("");
      fetchLead();
    } catch (err) {
      setBanner({ type: "danger", text: err.message || "Something went wrong." });
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

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="ar-page">
          <button className="ar-back-btn" onClick={() => navigate("/leads")}>← Back to Leads</button>

          {banner && (
            <Alert variant={banner.type} onClose={() => setBanner(null)}>
              {banner.text}
            </Alert>
          )}

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
                  {STATUS_FLOW.map((step, i) => (
                    <div key={step.key} className={`ar-step-outer${i < currentFlowIdx ? " ar-step-done-outer" : ""}`}>
                      <div className="ar-step">
                        <div className={["ar-step-dot", i === currentFlowIdx ? "ar-step-current" : "", i < currentFlowIdx ? "ar-step-done" : ""].filter(Boolean).join(" ")} />
                        <span className={["ar-step-label", i === currentFlowIdx ? "ar-step-label-current" : "", i < currentFlowIdx ? "ar-step-label-done" : ""].filter(Boolean).join(" ")}>{step.label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card.Body>
            </Card>
          )}
          {["pmt_extended_review", "dgm_review"].includes(lead.status) && (
            <Alert variant="info">This lead is on an escalated review path ({statusCfg.label}).</Alert>
          )}

          <div className="ar-grid">
            <div className="ar-left">
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
                  <Row label="Delivery Type" value={lead.delivery_type ? lead.delivery_type.replace(/\b\w/g, (c) => c.toUpperCase()) : null} />
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
                  {!lead.documents || lead.documents.length === 0 ? (
                    <p className="ar-empty-text">No documents uploaded.</p>
                  ) : (
                    lead.documents.map((doc, i) => <DocItem key={`${doc.path}-${i}`} doc={doc} leadId={lead.id} />)
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
                        {needsBaSelection && (
                          <div className="ar-field">
                            <label className="ar-label">
                              Business Associate <span className="ar-required">*</span>
                            </label>
                            <Select
                              options={baOptions.map((u) => ({ value: u.id, label: u.org_name }))}
                              value={selectedBaId}
                              onChange={setSelectedBaId}
                              placeholder={baOptions.length ? "Select a BA" : "No active BAs found on your team."}
                              disabled={actionLoading}
                            />
                          </div>
                        )}
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
                            Reason / Comment {pendingAction.requiresReason && <span className="ar-required">*</span>}
                          </label>
                          <textarea
                            className="input"
                            rows={4}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={pendingAction.requiresReason ? "Explain why…" : "Optional comment…"}
                          />
                        </div>
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
