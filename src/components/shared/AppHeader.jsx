import { Link, useNavigate } from "react-router-dom";
import Button from "../ui/Button";
import { useAuth } from "../../hooks/useAuth";
import { ROLE_LABELS, can } from "../../lib/roles";
import logo from "../../images/Logo.png";

export default function AppHeader() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  if (!profile) return null;

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "var(--space-4) var(--space-6)",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--nav-bg)",
      }}
    >
      <Link to="/home" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <img src={logo} height={32} alt="AFC India Limited" style={{ borderRadius: "var(--radius-sm)" }} />
        <span className="font-display font-semibold text-primary">AFC India Limited</span>
      </Link>

      <nav style={{ display: "flex", gap: "var(--space-4)", marginLeft: "var(--space-6)" }}>
        <Link to="/home" className="text-sm text-secondary">
          Home
        </Link>
        {can.createUsers(profile.role) && (
          <Link to="/create-user" className="text-sm text-secondary">
            Create User
          </Link>
        )}
        {(can.viewAllTeams(profile.role) || can.viewOwnTeam(profile.role)) && (
          <Link to="/users" className="text-sm text-secondary">
            Users
          </Link>
        )}
      </nav>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span className="text-sm text-secondary">
          {profile.full_name} · {ROLE_LABELS[profile.role] || profile.role}
        </span>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
