import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/shared/AppHeader";
import LeadForm from "./LeadForm";

export default function CreateLeadPage() {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>Add Lead</h1>
              <p>Enter lead details and save to the system.</p>
            </div>
          </div>
        </div>
        <LeadForm mode="create" onSuccess={(data) => navigate(`/leads/${data.id}`)} />
      </div>
    </div>
  );
}
