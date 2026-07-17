import AppHeader from "../components/shared/AppHeader";
import { useAuth } from "../hooks/useAuth";
import { ROLE_LABELS } from "../lib/roles";

// Placeholder landing page for Phase 1. Real dashboards (Empanelment,
// Leads, Reports, etc.) come in later phases.
export default function HomePage() {
  const { profile } = useAuth();

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <h1>Welcome, {profile?.full_name}</h1>
          <p>Signed in as {ROLE_LABELS[profile?.role] || profile?.role}.</p>
        </div>
      </div>
    </div>
  );
}
