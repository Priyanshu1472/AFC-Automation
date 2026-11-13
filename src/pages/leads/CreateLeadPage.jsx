import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/shared/AppHeader";
import LeadForm from "./LeadForm";
import BackButton from "../../components/ui/BackButton";

export default function CreateLeadPage() {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <LeadForm
          mode="create"
          onSuccess={(data) => navigate(`/leads/${data.id}`)}
          header={
            <div className="lf-page-head">
              <BackButton to="/leads" label="Back to Leads" />
              <h1>Add Lead</h1>
            </div>
          }
        />
      </div>
    </div>
  );
}
