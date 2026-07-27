import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { ROLE_LABELS } from "../../lib/roles";
import "../../styles/UserMenu.css";

export default function UserMenu() {
  const { profile, signOut } = useAuth();
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
  const initial = (profile.full_name || "?").trim().charAt(0).toUpperCase();

  function goToProfile() {
    setOpen(false);
    navigate("/profile");
  }

  async function handleSignOut() {
    setOpen(false);
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="user-menu-btn"
        onClick={() => setOpen((p) => !p)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="user-menu-avatar" aria-hidden="true">
          {initial}
        </span>
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
          <button type="button" className="user-menu-item" role="menuitem" onClick={goToProfile}>
            My Profile
          </button>
          <button type="button" className="user-menu-signout" role="menuitem" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
