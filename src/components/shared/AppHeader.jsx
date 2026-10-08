import { useEffect, useLayoutEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import NotificationBell from "./NotificationBell";
import SupportWidget from "./SupportWidget";
import NavDropdown from "./NavDropdown";
import UserMenu from "./UserMenu";
import Tooltip from "../ui/Tooltip";
import ProfileAvatar from "./ProfileAvatar";
import { useAuth } from "../../hooks/useAuth";
import { USERS_VIEW_ROLES, AUDIT_LOG_ROLES, EMPANELMENT_ROLES, KNOWLEDGE_REPOSITORY_ROLES, LEAD_GENERATION_NAV_ROLES, MONITORING_ROLES, FINANCIALS_ROLES, ROLE_LABELS } from "../../lib/roles";
import {
  MenuIcon, CloseIcon, HomeIcon, BookIcon, UsersIcon, TargetIcon, FileTextIcon, ActivityIcon, RupeeIcon,
  UserCogIcon, ClipboardListIcon, LayoutGridIcon, BarChartIcon, ChevronLeftIcon,
} from "../icons";
import logo from "../../images/Logo.png";
import "../../styles/AppHeader.css";

// Desktop rail folded to icons only — remembered per browser. Applied as
// data-nav="collapsed" on <html>, which narrows --sidebar-nav-w (App.css),
// so the page offset and the rail's own popovers all follow it.
const NAV_COLLAPSED_KEY = "afc-nav-collapsed";
const MOBILE_QUERY = "(max-width: 720px)";

function readCollapsed() {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

// A rail link: icon + label. When folded, the label is hidden and shown as
// a tooltip instead (portaled, so the narrow rail can't clip it).
function NavItem({ to, label, icon, collapsed, onClick }) {
  const link = (
    <NavLink to={to} className={({ isActive }) => (isActive ? "active" : "")} onClick={onClick} aria-label={collapsed ? label : undefined}>
      <span className="app-header-nav-icon" aria-hidden="true">{icon}</span>
      <span className="app-header-nav-label">{label}</span>
    </NavLink>
  );
  return collapsed ? <Tooltip text={label} position="right" delay={150}>{link}</Tooltip> : link;
}

export default function AppHeader() {
  const { profile, activeTeam, setActiveTeam, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsedPref, setCollapsedPref] = useState(readCollapsed);
  const [supportOpen, setSupportOpen] = useState(false);
  const isMobile = useIsMobile();
  // The mobile drawer always shows full labels, whatever the desktop choice.
  const collapsed = collapsedPref && !isMobile;

  useLayoutEffect(() => {
    if (collapsedPref) document.documentElement.dataset.nav = "collapsed";
    else delete document.documentElement.dataset.nav;
  }, [collapsedPref]);

  function toggleCollapsed() {
    setCollapsedPref((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Storage blocked — the choice just won't survive a reload.
      }
      return next;
    });
  }

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

  function switchTeam(team) {
    if (team === activeTeam) {
      closeMenu();
      return;
    }
    setActiveTeam(team);
    closeMenu();
    navigate("/home");
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

  const canSeeUsers = USERS_VIEW_ROLES.includes(profile.role);
  const canSeeAuditLogs = AUDIT_LOG_ROLES.includes(profile.role);
  const canSeeEmpanelment = EMPANELMENT_ROLES.includes(profile.role);
  const canSeeKnowledge = KNOWLEDGE_REPOSITORY_ROLES.includes(profile.role);
  const canSeeLeads = LEAD_GENERATION_NAV_ROLES.includes(profile.role);
  const canSeeMonitoring = MONITORING_ROLES.includes(profile.role);
  const canSeeFinancials = FINANCIALS_ROLES.includes(profile.role);
  const navItems = [
    { to: "/home", label: "Home", icon: <HomeIcon />, show: true },
    { to: "/knowledge", label: "Knowledge Repository", icon: <BookIcon />, show: canSeeKnowledge },
    { to: "/empanelment", label: "Empanelment", icon: <UsersIcon />, show: canSeeEmpanelment },
    { to: "/leads", label: "Leads Approval", icon: <TargetIcon />, show: canSeeLeads },
    { to: "/proposals", label: "Proposals", icon: <FileTextIcon />, show: canSeeLeads },
    { to: "/monitoring", label: "Monitoring", icon: <ActivityIcon />, show: canSeeMonitoring },
    { to: "/financials", label: "Financials", icon: <RupeeIcon />, show: canSeeFinancials },
    { to: "/users", label: "Users", icon: <UserCogIcon />, show: canSeeUsers },
    { to: "/audit-logs", label: "Audit Logs", icon: <ClipboardListIcon />, show: canSeeAuditLogs },
  ].filter((it) => it.show);
  const roleLabel = ROLE_LABELS[profile.role] || profile.role;
  const teams = profile.teams || [];

  return (
    <header className={`app-header${collapsed ? " collapsed" : ""}`}>
      <Link to="/home" className="app-header-brand">
        <img src={logo} className="app-header-logo" alt="AFC India Limited" />
        <span className="font-display font-semibold text-primary">AFC India Limited</span>
      </Link>

      {/* Desktop-only fold/unfold handle, sitting on the rail's right edge. */}
      <Tooltip text={collapsed ? "Expand sidebar" : "Collapse sidebar"} position="right" delay={300}>
        <button
          type="button"
          className="app-header-collapse-btn"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
        >
          <ChevronLeftIcon />
        </button>
      </Tooltip>

      {/* Mobile-only — mirrors the desktop utilities row's Notifications
          button but sits in the top bar itself, not inside the off-canvas
          drawer, so it stays reachable without opening the hamburger menu.
          Hidden above the mobile breakpoint, where the equivalent icon
          already lives in the sidebar. */}
      <div className="app-header-mobile-utilities">
        <SupportWidget />
        <NotificationBell />
      </div>

      {menuOpen && <div className="app-header-backdrop" onClick={closeMenu} aria-hidden="true" />}

      <nav id="app-header-drawer" className={`app-header-nav${menuOpen ? " open" : ""}`}>
        {/* Mobile-drawer-only — hidden on desktop via CSS, where the
            equivalent info lives in UserMenu's chip + dropdown instead. */}
        <div className="app-header-nav-profile-mobile">
          <ProfileAvatar profile={profile} className="app-header-nav-profile-avatar" />
          <span className="app-header-nav-profile-text">
            <span className="app-header-nav-profile-name">{profile.full_name}</span>
            <span className="app-header-nav-profile-role">{roleLabel}</span>
          </span>
        </div>

        <div className="app-header-nav-links">
          {navItems.map((it) => (
            <NavItem key={it.to} to={it.to} label={it.label} icon={it.icon} collapsed={collapsed} onClick={closeMenu} />
          ))}
        </div>

        {/* Dashboard / Reports dropdowns — kept as their own group, pushed to
            the far right of the module links (see .app-header-nav-dropdowns),
            so they read as reporting tools rather than another module button. */}
        <div className="app-header-nav-dropdowns">
          {(canSeeEmpanelment || canSeeLeads) && (
            <NavDropdown
              label="Dashboard"
              icon={<LayoutGridIcon />}
              collapsed={collapsed}
              items={[
                ...(canSeeEmpanelment ? [{ to: "/dashboard/empanelment", label: "Empanelment" }] : []),
                ...(canSeeLeads ? [{ to: "/dashboard/leads", label: "Leads" }] : []),
              ]}
              onNavigate={closeMenu}
            />
          )}
          {(canSeeEmpanelment || canSeeLeads) && (
            <NavDropdown
              label="Reports"
              icon={<BarChartIcon />}
              collapsed={collapsed}
              items={[
                ...(canSeeEmpanelment ? [{ to: "/reports/empanelment", label: "Empanelment" }] : []),
                ...(canSeeLeads ? [{ to: "/reports/leads", label: "Leads" }] : []),
              ]}
              onNavigate={closeMenu}
            />
          )}
        </div>

        {/* Folded rail keeps only the bell + profile here; theme and Support
            move into the profile menu as text items (UserMenu `compact`). */}
        <div className="app-header-nav-utilities">
          {!collapsed && <ThemeToggle />}
          <span className="app-header-notif-desktop-only">
            <SupportWidget showTrigger={!collapsed} open={supportOpen} onOpenChange={setSupportOpen} />
            <NotificationBell />
          </span>
          <UserMenu compact={collapsed} onOpenSupport={() => setSupportOpen(true)} />
        </div>

        {/* Mobile-drawer-only — mirrors UserMenu's desktop team switcher
            (see AppHeader's own profile block above, not UserMenu, since
            UserMenu is hidden below this breakpoint). */}
        {teams.length > 1 && (
          <div className="app-header-nav-teams-mobile">
            <span className="app-header-nav-teams-label-mobile">Switch Team</span>
            {teams.map((team) => (
              <button
                key={team}
                type="button"
                className={`app-header-nav-team-item-mobile${team === activeTeam ? " app-header-nav-team-item-mobile-active" : ""}`}
                onClick={() => switchTeam(team)}
              >
                {team}
              </button>
            ))}
          </div>
        )}

        {/* Mobile-drawer-only — profile link + sign out, pinned to the
            bottom of the drawer so neither requires opening UserMenu's
            dropdown first (UserMenu itself is desktop-only). Change
            Password lives inside the My Profile page, not as its own
            link — no need to duplicate it here. */}
        <Link to="/profile" className="app-header-nav-profile-link-mobile" onClick={closeMenu}>
          My Profile
        </Link>
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
