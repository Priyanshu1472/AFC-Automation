import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Button from "../ui/Button";
import { useAuth } from "../../hooks/useAuth";
import { ROLE_LABELS, can } from "../../lib/roles";
import { MenuIcon, CloseIcon } from "../icons";
import logo from "../../images/Logo.png";
import "../../styles/AppHeader.css";

export default function AppHeader() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  if (!profile) return null;

  const canSeeUsers = can.viewAllTeams(profile.role) || can.viewOwnTeam(profile.role);

  return (
    <header className="app-header">
      <Link to="/home" className="app-header-brand">
        <img src={logo} height={32} alt="AFC India Limited" />
        <span className="font-display font-semibold text-primary">AFC India Limited</span>
      </Link>

      <nav className={`app-header-nav${menuOpen ? " open" : ""}`}>
        <Link to="/home" className={location.pathname === "/home" ? "active" : ""} onClick={() => setMenuOpen(false)}>
          Home
        </Link>
        {canSeeUsers && (
          <Link to="/users" className={location.pathname === "/users" ? "active" : ""} onClick={() => setMenuOpen(false)}>
            Users
          </Link>
        )}
      </nav>

      <div className="app-header-right">
        <span className="app-header-user">
          {profile.full_name} · {ROLE_LABELS[profile.role] || profile.role}
        </span>
        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
        <button
          className="app-header-menu-btn"
          onClick={() => setMenuOpen((p) => !p)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>
    </header>
  );
}
