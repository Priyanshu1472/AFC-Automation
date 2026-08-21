import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
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

  const canEdit =
    lead &&
    (lead.status === "pa_review" || lead.status === "pa_action_required") &&
    (profile?.id === lead.created_by || profile?.id === lead.person_responsible_id);
  const isResubmit = lead?.status === "pa_action_required";

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>{isResubmit ? "Edit & Resubmit Lead" : "Edit Lead"}</h1>
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
