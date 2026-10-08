import AppHeader from "../components/shared/AppHeader";
import Card from "../components/ui/Card";

// Placeholder for a module that has a nav entry but isn't built yet
// (Monitoring, Financials).
export default function ComingSoonPage({ title, description }) {
  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <h1>{title}</h1>
        </div>
        <Card>
          <Card.Body>
            <div style={{ padding: "40px 16px", textAlign: "center" }}>
              <h2 style={{ marginBottom: 8 }}>Coming soon</h2>
              <p className="text-secondary text-sm">{description}</p>
            </div>
          </Card.Body>
        </Card>
      </div>
    </div>
  );
}
