import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/shared/AppHeader";
import LeadForm from "./LeadForm";

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
              <button type="button" className="lf-back" onClick={() => navigate("/leads")}>
                ← Back to Leads
              </button>
              <h1>Add Lead</h1>
            </div>
          }
        />
      </div>
    </div>
  );
}
