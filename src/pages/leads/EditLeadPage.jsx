import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { isLeadOverdue, overdueEditorId } from "../../components/leads/leadStatus";
import AppHeader from "../../components/shared/AppHeader";
import Alert from "../../components/ui/Alert";
import Button from "../../components/ui/Button";
import PageLoader from "../../components/ui/PageLoader";
import LeadForm from "./LeadForm";

export default function EditLeadPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchLead = useCallback(async () => {
    const { data } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
    setLead(data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchLead();
  }, [fetchLead]);

  if (loading) return <PageLoader text="Loading lead..." />;

  const overdue = lead && isLeadOverdue(lead);
  // Overdue: only the Person Responsible (or the creator, if none is
  // assigned yet — e.g. a po_assignment lead) can edit, regardless of
  // status — everything else is frozen until they fix the submission date
  // (see advance-lead-stage's blanket guard). Otherwise, the normal rule: a
  // just-transferred lead (person_responsible_id null) can be picked up and
  // edited by anyone on its new team — there is no PR yet until someone
  // fills the form (see _shared/leadTransfer.ts) — and editing only applies
  // at pa_review/pa_action_required.
  const canEdit =
    lead &&
    (overdue
      ? profile?.id === overdueEditorId(lead)
      : (lead.status === "pa_review" || lead.status === "pa_action_required") &&
        (profile?.id === lead.created_by ||
          profile?.id === lead.person_responsible_id ||
          (!lead.person_responsible_id && !!profile?.teams?.includes(lead.team))));
  // A returned (pa_action_required) lead's fields can be edited here same as
  // any other lead — saving does NOT resubmit it into the approval
  // pipeline. Getting it back to the Recommending Authority is a separate,
  // deliberate step: the Lead Approval Note's "Resubmit Lead Approval Form"
  // action from the lead's detail page.

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>Edit Lead</h1>
              {lead && <p>{lead.lead_number} — {lead.title}</p>}
            </div>
            <Button variant="secondary" onClick={() => navigate(lead ? `/leads/${lead.id}` : "/leads")}>
              ← Back
            </Button>
          </div>
        </div>

        {!lead && <Alert variant="danger">Lead not found.</Alert>}
        {lead && !canEdit && <Alert variant="danger">This lead can&apos;t be edited right now.</Alert>}
        {lead && canEdit && <LeadForm mode="edit" lead={lead} onSuccess={() => navigate(`/leads/${lead.id}`)} />}
      </div>
    </div>
  );
}
