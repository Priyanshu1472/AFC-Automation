import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/shared/AppHeader";
import Button from "../../components/ui/Button";
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
              <p>Capture a new opportunity — fill the sections below and save. Your summary updates on the right as you go.</p>
            </div>
            <Button variant="secondary" onClick={() => navigate("/leads")}>
              ← Back
            </Button>
          </div>
        </div>
        <LeadForm mode="create" onSuccess={(data) => navigate(`/leads/${data.id}`)} />
      </div>
    </div>
  );
}
