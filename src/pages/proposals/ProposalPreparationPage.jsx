// Proposal Preparation for an MD-approved lead — fee notes, BA document
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
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import FeeNotesPanel from "../../components/proposals/FeeNotesPanel";
import BaDocumentRequestsPanel from "../../components/proposals/BaDocumentRequestsPanel";
import AfcChecklistPanel from "../../components/proposals/AfcChecklistPanel";
import ProposalDocumentsPanel from "../../components/proposals/ProposalDocumentsPanel";
import ProposalLockPanel from "../../components/proposals/ProposalLockPanel";
import { isProposalLocked } from "../../lib/proposalPrep";
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

          <Card>
            <Card.Body>
              <div className="pp-summary">
                <div className="pp-summary-item"><span>Person Responsible</span><strong>{lead.pr?.full_name || "—"}</strong></div>
                <div className="pp-summary-item"><span>Reviewer</span><strong>{lead.rev?.full_name || "—"}</strong></div>
                <div className="pp-summary-item"><span>Approval Authority</span><strong>{lead.aa?.full_name || "—"}</strong></div>
                <div className="pp-summary-item"><span>Business Associate</span><strong>{lead.ba?.full_name || "—"}</strong></div>
                <div className="pp-summary-item"><span>Submission Date</span><strong className={pastDeadline ? "pp-overdue" : ""}>{fmtDate(lead.submission_deadline)}</strong></div>
                <div className="pp-summary-item"><span>Status</span><strong>{proposal.locked ? <Badge variant="neutral">Locked</Badge> : <Badge variant="success">In Progress</Badge>}</strong></div>
              </div>
            </Card.Body>
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
            items={baItems}
            profile={profile}
            canManage={canManage}
            locked={locked}
            hasBa={!!lead.assigned_ba_id}
            onChanged={fetchAll}
          />

          <AfcChecklistPanel
            proposalId={proposal.id}
            items={checklistItems}
            profile={profile}
            canManage={canManage}
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
