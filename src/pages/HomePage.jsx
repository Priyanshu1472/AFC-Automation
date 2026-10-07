import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/shared/AppHeader";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import PageLoader from "../components/ui/PageLoader";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import { EMPANELMENT_ROLES, LEAD_GENERATION_NAV_ROLES } from "../lib/roles";
import { fetchPendingActionNotifications, subscribeToNotifications, markNotificationRead } from "../lib/notifications";
import "../styles/HomePage.css";

const STATUS_MAP = {
  sent: { label: "Sent", variant: "info" },
  filled: { label: "Form Filled", variant: "warning" },
  po_review: { label: "Under Review — Project Officer", variant: "warning" },
  cfo_cs_review: { label: "Under Review — CS / CFO", variant: "info" },
  po_final_review: { label: "Under Review — Project Officer", variant: "warning" },
  dgm_review: { label: "Under Review — DGM", variant: "neutral" },
  md_review: { label: "Under Review — Managing Director", variant: "neutral" },
  accepted: { label: "Accepted", variant: "success" },
  rejected: { label: "Ineligible", variant: "neutral" },
  on_hold: { label: "Correction Needed", variant: "warning" },
};

function fmtDate(val) {
  if (!val) return "—";
  return new Date(val).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function timeAgo(val) {
  if (!val) return "";
  const diffMs = Date.now() - new Date(val).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(val).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

// RLS (can_view_empanelment_application) scopes this to exactly the one
// application tied to this BP's account via ba_user_id — no client filter
// needed.
function BaStatusCard() {
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("empanelment_applications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) { setApp(data || null); setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <PageLoader text="Loading your application…" />;

  if (!app) {
    return (
      <Card>
        <Card.Body><p className="text-secondary">No empanelment application is linked to this account yet.</p></Card.Body>
      </Card>
    );
  }

  const status = STATUS_MAP[app.status] || { label: app.status, variant: "neutral" };

  return (
    <Card>
      <Card.Header title="Your Empanelment Application" action={<Badge variant={status.variant} dot>{status.label}</Badge>} />
      <Card.Body>
        <p className="text-secondary" style={{ marginBottom: 8 }}>Application Code: <strong>{app.application_code}</strong></p>
        <p className="text-secondary" style={{ marginBottom: 8 }}>Submitted: {fmtDate(app.form_submitted_at || app.created_at)}</p>
        {app.status === "on_hold" && (
          <p className="text-secondary">AFC India Limited has requested a correction on your application. Please check your email for details, or use the &quot;Submit a Correction&quot; link on the login page.</p>
        )}
        {app.status === "accepted" && app.md_remarks && <p className="text-secondary">{app.md_remarks}</p>}
        {app.status === "rejected" && (app.md_remarks || app.dgm_comment) && <p className="text-secondary">{app.md_remarks || app.dgm_comment}</p>}
      </Card.Body>
    </Card>
  );
}

// Module boxes on Home. `canSee` mirrors AppHeader's nav gates, so nobody
// gets an always-empty box for a module they can't open.
const ACTION_CATEGORIES = [
  { key: "empanelment", title: "Empanelment", to: "/empanelment", canSee: (role) => EMPANELMENT_ROLES.includes(role), icon: <UsersIcon /> },
  { key: "leads", title: "Leads Approval", to: "/leads", canSee: (role) => LEAD_GENERATION_NAV_ROLES.includes(role), icon: <TargetIcon /> },
  { key: "proposals", title: "Proposals", to: "/proposals", canSee: (role) => LEAD_GENERATION_NAV_ROLES.includes(role), icon: <FileIcon /> },
];

// Which box an alert belongs in — by the page it links to. Bid Payment
// Requisition (fee) note alerts created before 2026-10-07 linked to the
// plain "/leads" list, so those are recognised by their title instead.
function categoryOf(n) {
  const link = n.link || "";
  if (link.startsWith("/empanelment")) return "empanelment";
  if (link.startsWith("/proposals")) return "proposals";
  if (link.startsWith("/leads")) return /requisition note|fee note/i.test(n.title || "") ? "proposals" : "leads";
  return "other";
}

// Notifications the recipient hasn't acted on yet (type: "action_required",
// unread) — a review stage waiting on this specific person, not a generic
// activity feed — grouped into one box per module. Clicking one marks it
// read and jumps to the item.
function PendingActionsPanel() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;

    fetchPendingActionNotifications(profile.id, 200)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const unsubscribe = subscribeToNotifications(profile.id, (row) => {
      if (row.type === "action_required") setItems((prev) => [row, ...prev]);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [profile?.id]);

  function handleClick(n) {
    setItems((prev) => prev.filter((it) => it.id !== n.id));
    markNotificationRead(n.id).catch(() => {});
    // Marks where we came from so the detail page's own "Back"/exit lands
    // on Home instead of the module's list page — see LeadDetailPage's and
    // ApplicationReviewPage's own back-button logic.
    if (n.link) navigate(n.link, { state: { from: "home" } });
  }

  if (loading) return <PageLoader text="Loading your alerts…" />;

  const grouped = { empanelment: [], leads: [], proposals: [], other: [] };
  items.forEach((n) => grouped[categoryOf(n)].push(n));

  const boxes = ACTION_CATEGORIES.filter((c) => c.canSee(profile?.role) || grouped[c.key].length > 0);
  if (grouped.other.length > 0) boxes.push({ key: "other", title: "General", to: null, icon: <BellIcon /> });

  return (
    <section className="home-actions" aria-labelledby="home-actions-title">
      <div className="home-actions-head">
        <h2 id="home-actions-title">Needs your action</h2>
        <p>{items.length === 0 ? "You're all caught up." : `${items.length} item${items.length !== 1 ? "s" : ""} waiting on you`}</p>
      </div>

      <div className="home-boxes">
        {boxes.map((c) => {
          const list = grouped[c.key];
          return (
            <div key={c.key} className={`home-box home-box-${c.key}${list.length ? " home-box-has" : ""}`}>
              <div className="home-box-head">
                <span className="home-box-icon" aria-hidden="true">{c.icon}</span>
                <h3 className="home-box-title">{c.title}</h3>
                <span className={`home-box-count${list.length ? " home-box-count-has" : ""}`}>{list.length}</span>
              </div>

              {list.length === 0 ? (
                <div className="home-box-empty">
                  <CheckCircleIcon />
                  <span>Nothing pending</span>
                </div>
              ) : (
                <div className="home-box-list">
                  {list.map((n) => (
                    <button key={n.id} type="button" className="home-alert" onClick={() => handleClick(n)}>
                      <span className="home-alert-body">
                        <span className="home-alert-title">{n.title}</span>
                        {n.sub_text && <span className="home-alert-sub">{n.sub_text}</span>}
                      </span>
                      <span className="home-alert-right">
                        {n.created_at && <span className="home-alert-time">{timeAgo(n.created_at)}</span>}
                        <ChevronRightIcon />
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {c.to && (
                <button type="button" className="home-box-foot" onClick={() => navigate(c.to)}>
                  Open {c.title} <ChevronRightIcon />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function HomePage() {
  const { profile } = useAuth();
  const isBa = profile?.role === "business_associate";

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <h1>Welcome, {profile?.full_name}</h1>
        </div>
        {isBa && <BaStatusCard />}
        {!isBa && <PendingActionsPanel />}
      </div>
    </div>
  );
}
