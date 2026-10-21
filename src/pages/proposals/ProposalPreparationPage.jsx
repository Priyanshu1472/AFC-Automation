// Proposal Preparation for an MD-approved lead — fee notes, BP document
// requests, the proposal files, the proposed value (Financial), and the
// lock + client-outcome step. Reached from "Open Proposal" once a lead's
// status is 'md_approved'. Attaches directly to the existing `leads` row
// (see 20260820040000_proposal_preparation_schema.sql). An awarded
// proposal continues in Monitoring (monitoring_projects, opened by a DB
// trigger the moment the outcome is recorded).
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Collapsible from "../../components/ui/Collapsible";
import Badge from "../../components/ui/Badge";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import FeeNotesPanel from "../../components/proposals/FeeNotesPanel";
import BaDocumentRequestsPanel from "../../components/proposals/BaDocumentRequestsPanel";
import ProposalDocumentsPanel from "../../components/proposals/ProposalDocumentsPanel";
import ProposalLockPanel from "../../components/proposals/ProposalLockPanel";
import ProposalValuePanel from "../../components/proposals/ProposalValuePanel";
import ProposalChatPanel from "../../components/proposals/ProposalChatPanel";
import { FileTextIcon, UsersIcon } from "../../components/icons";
import { isProposalLocked } from "../../lib/proposalPrep";
import "../../styles/ApplicationReviewPage.css";
import "../../styles/ProposalPreparationPage.css";
import BackButton from "../../components/ui/BackButton";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    setError("");
    const { data: leadRow, error: leadErr } = await supabase
      .from("leads")
      .select("*, pr:person_responsible_id(full_name), rev:reviewer_id(full_name), aa:recommending_authority_id(full_name), ba:assigned_ba_id(full_name)")
      .eq("id", leadId)
      .maybeSingle();
    if (leadErr || !leadRow) { setError(leadErr?.message || "Lead not found."); setLoading(false); return; }
    setLead(leadRow);

    const { data: created, error: createErr } = await supabase.functions.invoke("create-proposal-preparation", { body: { lead_id: leadId } });
    if (createErr) { setError(await extractFunctionErrorMessage(createErr, "Failed to open this proposal.")); setLoading(false); return; }
    if (!created?.success) { setError(created?.error || "Failed to open this proposal."); setLoading(false); return; }
    const proposalId = created.proposal_id;

    const [
      { data: proposalRow, error: proposalErr },
      { data: feeNoteRows },
      { data: baItemRows },
      { data: monitoringRow },
      { data: docRows },
    ] = await Promise.all([
      supabase.from("proposal_preparations").select("*, locker:locked_by(full_name), responder:client_response_by(full_name)").eq("id", proposalId).maybeSingle(),
      supabase.from("fee_notes").select("*").eq("proposal_id", proposalId),
      supabase.from("proposal_document_requests").select("*").eq("proposal_id", proposalId).order("created_at"),
      supabase.from("monitoring_projects").select("id").eq("proposal_id", proposalId).maybeSingle(),
      supabase.from("proposal_documents").select("*").eq("proposal_id", proposalId),
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
    setLoading(false);
  }, [leadId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!proposal?.id) return;
    const channel = supabase
      .channel(`proposal-${proposal.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_preparations", filter: `id=eq.${proposal.id}` }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "fee_notes", filter: `proposal_id=eq.${proposal.id}` }, () => fetchAll())
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

  const canManage = profile && (
    ["md", "admin"].includes(profile.role) ||
    [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(profile.id)
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
  const canManageDocs = profile && [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(profile.id);
  const locked = isProposalLocked(proposal, lead);
  const pastDeadline = !!lead.submission_deadline && new Date(lead.submission_deadline) < new Date() && !proposal.locked;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="pp-page animate-fadeUp">
          <BackButton to="/proposals" label="Back to Proposals" />

          <Card className="ar-header-card">
            <Card.Body className="ar-header-body">
              <div className="ar-header-left">
                <div className="ar-header-badges">
                  <Badge variant="brand">Proposal</Badge>
                  <Badge variant={proposal.locked ? "neutral" : "success"} dot>{proposal.locked ? "Locked" : "In Progress"}</Badge>
                </div>
                <h1 className="ar-header-email">{lead.title}</h1>
                <p className="ar-header-meta">
                  {lead.lead_number}
                  {lead.client_name ? <> · {lead.client_name}</> : ""}
                  {lead.portal_name ? <> · {lead.portal_name}</> : ""}
                  {" "}· Created: <strong>{fmtDate(proposal.created_at)}</strong>
                </p>
              </div>
            </Card.Body>
          </Card>

          <ProposalChatPanel
            proposalId={proposal.id}
            chatOpenedAt={proposal.chat_opened_at}
            locked={locked}
          />

          {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

          {!proposal.locked && pastDeadline && (
            <Alert variant="warning">
              The submission deadline ({fmtDate(lead.submission_deadline)}) has passed, so Fee Notes, BP Documents and Proposal Documents are now read-only. Lock the proposal below to record the client's response.
            </Alert>
          )}

          <div className="pp-summary-row">
            <Card className="pp-summary-card">
              <Collapsible title="Lead Details" icon={<FileTextIcon />} expandable={false}>
                <div className="pp-summary">
                  <div className="pp-summary-item">
                    <span>Lead Number</span>
                    <strong><button type="button" className="pp-lead-number-link" onClick={() => navigate(`/leads/${lead.id}`, { state: { from: "proposal" } })}>{lead.lead_number}</button></strong>
                  </div>
                  <div className="pp-summary-item"><span>Client Name</span><strong>{lead.client_name || "—"}</strong></div>
                  <div className="pp-summary-item"><span>Reference Number</span><strong>{lead.bid_number || "—"}</strong></div>
                  <div className="pp-summary-item"><span>Last Date</span><strong className={pastDeadline ? "pp-overdue" : ""}>{fmtDate(lead.submission_deadline)}</strong></div>
                </div>
              </Collapsible>
            </Card>

            <Card className="pp-summary-card">
              <Collapsible title="Responsibles" icon={<UsersIcon />} expandable={false}>
                <div className="pp-summary">
                  <div className="pp-summary-item"><span>Person Responsible</span><strong>{lead.pr?.full_name || "—"}</strong></div>
                  <div className="pp-summary-item"><span>Reviewer</span><strong>{lead.rev?.full_name || "—"}</strong></div>
                  <div className="pp-summary-item"><span>Recommending Authority</span><strong>{lead.aa?.full_name || "—"}</strong></div>
                  <div className="pp-summary-item"><span>Business Partner</span><strong>{lead.ba?.full_name || "—"}</strong></div>
                </div>
              </Collapsible>
            </Card>
          </div>

          <ProposalLockPanel
            proposal={proposal}
            pastDeadline={pastDeadline}
            canManage={canManage}
            monitoringProjectId={monitoringProjectId}
            onChanged={fetchAll}
          />

          <FeeNotesPanel
            proposalId={proposal.id}
            feeNotes={feeNotes}
            lead={lead}
            profile={profile}
            isMd={isMd}
            locked={locked}
            onChanged={fetchAll}
          />

          <BaDocumentRequestsPanel
            proposalId={proposal.id}
            proposal={proposal}
            items={baItems}
            profile={profile}
            canManage={canManageDocs}
            locked={locked}
            hasBa={!!lead.assigned_ba_id}
            onChanged={fetchAll}
          />

          <ProposalDocumentsPanel
            proposalId={proposal.id}
            documents={documents}
            canManage={canManage}
            locked={locked}
            onChanged={fetchAll}
          />

          <ProposalValuePanel proposal={proposal} canManage={canManage} onChanged={fetchAll} />
        </div>
      </div>
    </div>
  );
}
