import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../hooks/useTheme";
import { ROLE_LABELS } from "../../lib/roles";
import ProfileAvatar from "./ProfileAvatar";
import "../../styles/UserMenu.css";

// `compact`: the rail is folded, so the theme toggle and Support button
// aren't shown in it — their actions move into this menu as text items.
export default function UserMenu({ compact = false, onOpenSupport }) {
  const { profile, activeTeam, setActiveTeam, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!profile) return null;

  const roleLabel = ROLE_LABELS[profile.role] || profile.role;

  function goToProfile() {
    setOpen(false);
    navigate("/profile");
  }

  function handleToggleTheme() {
    setOpen(false);
    toggleTheme();
  }

  function handleOpenSupport() {
    setOpen(false);
    onOpenSupport?.();
  }

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    navigate("/login", { replace: true });
  }

  function switchTeam(team) {
    if (team === activeTeam) {
      setOpen(false);
      return;
    }
    setActiveTeam(team);
    setOpen(false);
    navigate("/home");
  }

  const teams = profile.teams || [];

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="user-menu-btn"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ProfileAvatar profile={profile} className="user-menu-avatar" />
        <span className="user-menu-text">
          <span className="user-menu-name">{profile.full_name}</span>
          <span className="user-menu-role">{roleLabel}</span>
        </span>
      </button>

      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-panel-header">
            <span className="user-menu-panel-name">{profile.full_name}</span>
            <span className="user-menu-panel-role">{roleLabel}</span>
          </div>
          {teams.length > 1 && (
            <div className="user-menu-teams">
              <span className="user-menu-teams-label">Switch Team</span>
              {teams.map((team) => (
                <button
                  key={team}
                  type="button"
                  className={`user-menu-item user-menu-team-item${team === activeTeam ? " user-menu-team-item-active" : ""}`}
                  role="menuitem"
                  onClick={() => switchTeam(team)}
                >
                  {team}
                  {team === activeTeam && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="user-menu-item" role="menuitem" onClick={goToProfile}>
            My Profile
          </button>
          {compact && (
            <>
              <button type="button" className="user-menu-item" role="menuitem" onClick={handleToggleTheme}>
                {theme === "dark" ? "Light Mode" : "Dark Mode"}
              </button>
              <button type="button" className="user-menu-item" role="menuitem" onClick={handleOpenSupport}>
                Support
              </button>
            </>
          )}
          <button type="button" className="user-menu-signout" role="menuitem" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
