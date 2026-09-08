// Proposal Preparation for an MD-approved lead — fee notes, BP document
// requests, an internal AFC checklist, the three proposal document slots,
// and the lock + client-outcome step. Reached from "Open Proposal" once a
// lead's status is 'md_approved'. Attaches directly to the existing `leads`
// row (see 20260820040000_proposal_preparation_schema.sql) rather than a
// separate "project" entity, since nothing downstream of an approved lead
// exists yet.
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Collapsible from "../../components/ui/Collapsible";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import FeeNotesPanel from "../../components/proposals/FeeNotesPanel";
import BaDocumentRequestsPanel from "../../components/proposals/BaDocumentRequestsPanel";
import AfcChecklistPanel from "../../components/proposals/AfcChecklistPanel";
import ProposalDocumentsPanel from "../../components/proposals/ProposalDocumentsPanel";
import MergeProposalModal from "../../components/proposals/MergeProposalModal";
import ProposalLockPanel from "../../components/proposals/ProposalLockPanel";
import ClientResponseBanner from "../../components/proposals/ClientResponseBanner";
import { isProposalLocked, CLIENT_RESPONSE_LABELS, CLIENT_RESPONSE_VARIANTS } from "../../lib/proposalPrep";
import "../../styles/ProposalPreparationPage.css";

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
  const [checklistItems, setChecklistItems] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showMerge, setShowMerge] = useState(false);

  const fetchAll = useCallback(async () => {
    setError("");
    const { data: leadRow, error: leadErr } = await supabase
      .from("leads")
      .select("*, pr:person_responsible_id(full_name), rev:reviewer_id(full_name), aa:approval_authority_id(full_name), ba:assigned_ba_id(full_name)")
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
      { data: checklistRows },
      { data: docRows },
    ] = await Promise.all([
      supabase.from("proposal_preparations").select("*, locker:locked_by(full_name), responder:client_response_by(full_name)").eq("id", proposalId).maybeSingle(),
      supabase.from("fee_notes").select("*").eq("proposal_id", proposalId),
      supabase.from("proposal_document_requests").select("*").eq("proposal_id", proposalId).order("created_at"),
      supabase.from("proposal_afc_checklist_items").select("*").eq("proposal_id", proposalId).order("created_at"),
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
    setChecklistItems(checklistRows || []);
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
    [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id].includes(profile.id)
  );
  const isMd = profile && ["md", "admin"].includes(profile.role);
  // The BP-requests and AFC checklist lists are day-to-day working
  // documents for the lead's own team (Person Responsible, Reviewer,
  // Approval Authority) — MD/Admin can see them but never add/edit/delete,
  // unlike the rest of this page where MD/Admin get the usual override.
  const canManageDocs = profile && [lead.person_responsible_id, lead.reviewer_id, lead.approval_authority_id].includes(profile.id);
  const locked = isProposalLocked(proposal, lead);
  const pastDeadline = !!lead.submission_deadline && new Date(lead.submission_deadline) < new Date() && !proposal.locked;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="pp-page animate-fadeUp">
          <div className="page-header">
            <div className="page-title-row">
              <div>
                <h1>{lead.title}</h1>
                <p>Proposal Preparation{lead.client_name ? ` · ${lead.client_name}` : ""}{lead.portal_name ? ` · ${lead.portal_name}` : ""}</p>
              </div>
              <Button variant="secondary" onClick={() => navigate("/leads")}>Back to Leads</Button>
            </div>
          </div>

          {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

          {proposal.locked && proposal.client_response === "pending" && canManage && (
            <ClientResponseBanner proposalId={proposal.id} onChanged={fetchAll} />
          )}

          {proposal.locked && proposal.client_response !== "pending" && (
            <div className="pp-outcome-status">
              <span>Client Response:</span>
              <Badge variant={CLIENT_RESPONSE_VARIANTS[proposal.client_response]}>{CLIENT_RESPONSE_LABELS[proposal.client_response]}</Badge>
            </div>
          )}

          {proposal.locked && proposal.client_response === "pending" && !canManage && (
            <Alert variant="warning">
              This proposal is locked and waiting for its Person Responsible, Reviewer, or Approval Authority to record the client's response.
            </Alert>
          )}

          {!proposal.locked && pastDeadline && (
            <Alert variant="warning">
              The submission deadline ({fmtDate(lead.submission_deadline)}) has passed, so this proposal is now read-only — that's why Fee Notes, BP Documents, the AFC Checklist, and Proposal Documents show no add/edit options for anyone. Lock it in "Lock &amp; Client Response" below to record the client's outcome.
            </Alert>
          )}

          <Card>
            <Collapsible title="Lead Details">
              <div className="pp-summary">
                <div className="pp-summary-item"><span>Title of Proposal</span><strong>{lead.title}</strong></div>
                <div className="pp-summary-item">
                  <span>Lead Number</span>
                  <strong><button type="button" className="pp-lead-number-link" onClick={() => navigate(`/leads/${lead.id}`)}>{lead.lead_number}</button></strong>
                </div>
                <div className="pp-summary-item"><span>Client Name</span><strong>{lead.client_name || "—"}</strong></div>
                <div className="pp-summary-item"><span>Reference Number (if any)</span><strong>{lead.bid_number || "—"}</strong></div>
                <div className="pp-summary-item"><span>Status</span><strong>{proposal.locked ? <Badge variant="neutral">Locked</Badge> : <Badge variant="success">In Progress</Badge>}</strong></div>
                <div className="pp-summary-item"><span>Last Date</span><strong className={pastDeadline ? "pp-overdue" : ""}>{fmtDate(lead.submission_deadline)}</strong></div>
              </div>
            </Collapsible>
          </Card>

          <Card>
            <Collapsible title="Responsibles">
              <div className="pp-summary">
                <div className="pp-summary-item"><span>Person Responsible</span><strong>{lead.pr?.full_name || "—"}</strong></div>
                <div className="pp-summary-item"><span>Reviewer</span><strong>{lead.rev?.full_name || "—"}</strong></div>
                <div className="pp-summary-item"><span>Approval Authority</span><strong>{lead.aa?.full_name || "—"}</strong></div>
                <div className="pp-summary-item"><span>Business Partner</span><strong>{lead.ba?.full_name || "—"}</strong></div>
              </div>
            </Collapsible>
          </Card>

          <FeeNotesPanel
            proposalId={proposal.id}
            feeNotes={feeNotes}
            canManage={canManage}
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

          <AfcChecklistPanel
            proposalId={proposal.id}
            items={checklistItems}
            profile={profile}
            canManage={canManageDocs}
            locked={locked}
            onChanged={fetchAll}
          />

          <ProposalDocumentsPanel
            proposalId={proposal.id}
            documents={documents}
            canManage={canManage}
            locked={locked}
            onChanged={fetchAll}
          />

          <Card>
            <Collapsible title="Merge Proposal" subtitle="Assemble the documents you've collected into one final, editable .docx.">
              {canManage && <Button variant="primary" onClick={() => setShowMerge(true)}>Merge Proposal</Button>}
            </Collapsible>
          </Card>

          {showMerge && (
            <MergeProposalModal
              proposalId={proposal.id}
              baItems={baItems}
              checklistItems={checklistItems}
              documents={documents}
              profile={profile}
              onClose={() => setShowMerge(false)}
            />
          )}

          <ProposalLockPanel
            proposalId={proposal.id}
            proposal={proposal}
            pastDeadline={pastDeadline}
            canManage={canManage}
            onChanged={fetchAll}
          />
        </div>
      </div>
    </div>
  );
}
