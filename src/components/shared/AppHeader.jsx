import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import NotificationBell from "./NotificationBell";
import NavDropdown from "./NavDropdown";
import UserMenu from "./UserMenu";
import { useAuth } from "../../hooks/useAuth";
import { USERS_PAGE_ROLES, AUDIT_LOG_ROLES, EMPANELMENT_ROLES, ROLE_LABELS } from "../../lib/roles";
import { MenuIcon, CloseIcon } from "../icons";
import logo from "../../images/Logo.png";
import "../../styles/AppHeader.css";

export default function AppHeader() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  function closeMenu() {
    setMenuOpen(false);
  }

  // Mobile-drawer-only: Users tapping Sign out here shouldn't need to open
  // UserMenu's dropdown first — see UserMenu (desktop-only from this
  // breakpoint down) for the equivalent click-to-reveal action.
  async function handleSignOut() {
    closeMenu();
    await signOut();
    navigate("/login", { replace: true });
  }

  // Close on Escape — standard drawer a11y behavior.
  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  if (!profile) return null;

  const canSeeUsers = USERS_PAGE_ROLES.includes(profile.role);
  const canSeeAuditLogs = AUDIT_LOG_ROLES.includes(profile.role);
  const canSeeEmpanelment = EMPANELMENT_ROLES.includes(profile.role);
  const navLinkClass = ({ isActive }) => (isActive ? "active" : "");
  const roleLabel = ROLE_LABELS[profile.role] || profile.role;
  const initial = (profile.full_name || "?").trim().charAt(0).toUpperCase();

  return (
    <header className="app-header">
      <Link to="/home" className="app-header-brand">
        <img src={logo} height={32} alt="AFC India Limited" />
        <span className="font-display font-semibold text-primary">AFC India Limited</span>
      </Link>

      {menuOpen && <div className="app-header-backdrop" onClick={closeMenu} aria-hidden="true" />}

      <nav id="app-header-drawer" className={`app-header-nav${menuOpen ? " open" : ""}`}>
        {/* Mobile-drawer-only — hidden on desktop via CSS, where the
            equivalent info lives in UserMenu's chip + dropdown instead. */}
        <div className="app-header-nav-profile-mobile">
          <span className="app-header-nav-profile-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="app-header-nav-profile-text">
            <span className="app-header-nav-profile-name">{profile.full_name}</span>
            <span className="app-header-nav-profile-role">{roleLabel}</span>
          </span>
        </div>

        <div className="app-header-nav-links">
          <NavLink to="/home" className={navLinkClass} onClick={closeMenu}>
            Home
          </NavLink>
          {canSeeEmpanelment && (
            <NavLink to="/empanelment" className={navLinkClass} onClick={closeMenu}>
              Empanelment
            </NavLink>
          )}
          {canSeeEmpanelment && (
            <NavDropdown label="Dashboard" items={[{ to: "/dashboard/empanelment", label: "Empanelment" }]} onNavigate={closeMenu} />
          )}
          {canSeeEmpanelment && (
            <NavDropdown label="Reports" items={[{ to: "/reports/empanelment", label: "Empanelment" }]} onNavigate={closeMenu} />
          )}
          {canSeeUsers && (
            <NavLink to="/users" className={navLinkClass} onClick={closeMenu}>
              Users
            </NavLink>
          )}
          {canSeeAuditLogs && (
            <NavLink to="/audit-logs" className={navLinkClass} onClick={closeMenu}>
              Audit Logs
            </NavLink>
          )}
        </div>

        <div className="app-header-nav-divider" aria-hidden="true" />

        <div className="app-header-nav-utilities">
          <ThemeToggle />
          <NotificationBell />
          <UserMenu />
        </div>

        {/* Mobile-drawer-only — pinned to the bottom of the drawer so
            signing out never requires opening UserMenu's dropdown first. */}
        <button type="button" className="app-header-nav-signout-mobile" onClick={handleSignOut}>
          Sign out
        </button>
      </nav>

      <button
        className="app-header-menu-btn"
        onClick={() => setMenuOpen((p) => !p)}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        aria-controls="app-header-drawer"
      >
        {menuOpen ? <CloseIcon /> : <MenuIcon />}
      </button>
    </header>
  );
}
