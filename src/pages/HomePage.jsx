import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/shared/AppHeader";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import PageLoader from "../components/ui/PageLoader";
import { useAuth } from "../hooks/useAuth";
import { supabase } from "../lib/supabase";
import { EMPANELMENT_ROLES, LEAD_GENERATION_NAV_ROLES, MONITORING_ROLES, FINANCIALS_ROLES } from "../lib/roles";
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

// Ticks a number up from 0 to `value` (and between values when it changes
// live). Jumps straight there when the user prefers reduced motion.
function CountUp({ value, duration = 700 }) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    const set = (n) => { shownRef.current = n; setShown(n); };
    if (from === value || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      set(value);
      return;
    }
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      set(Math.round(from + (value - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return shown;
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

function ArrowLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
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

function ActivityIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function RupeeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <path d="M6 3h12" />
      <path d="M6 8h12" />
      <path d="m6 13 8.5 8" />
      <path d="M6 13h3" />
      <path d="M9 13c6.667 0 6.667-10 0-10" />
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

// One box per module on Home. `canSee` mirrors AppHeader's nav gates, so
// nobody gets an always-empty box for a module they can't open.
const ACTION_CATEGORIES = [
  { key: "empanelment", title: "Empanelment", to: "/empanelment", canSee: (role) => EMPANELMENT_ROLES.includes(role), icon: <UsersIcon /> },
  { key: "leads", title: "Leads Approval", to: "/leads", canSee: (role) => LEAD_GENERATION_NAV_ROLES.includes(role), icon: <TargetIcon /> },
  { key: "proposals", title: "Proposals", to: "/proposals", canSee: (role) => LEAD_GENERATION_NAV_ROLES.includes(role), icon: <FileIcon /> },
  { key: "monitoring", title: "Monitoring", to: "/monitoring", canSee: (role) => MONITORING_ROLES.includes(role), icon: <ActivityIcon /> },
  { key: "financials", title: "Financials", to: "/financials", canSee: (role) => FINANCIALS_ROLES.includes(role), icon: <RupeeIcon /> },
];

// Which module an alert belongs to — by the page it links to. Bid Payment
// Requisition (fee) note alerts created before 2026-10-07 linked to the
// plain "/leads" list, so those are recognised by their title instead.
function categoryOf(n) {
  const link = n.link || "";
  if (link.startsWith("/empanelment")) return "empanelment";
  if (link.startsWith("/proposals")) return "proposals";
  if (link.startsWith("/monitoring")) return "monitoring";
  if (link.startsWith("/financials")) return "financials";
  if (link.startsWith("/leads")) return /requisition note|fee note/i.test(n.title || "") ? "proposals" : "leads";
  return "other";
}

// Notifications the recipient hasn't acted on yet (type: "action_required",
// unread) — a review stage waiting on this specific person, not a generic
// activity feed. One box per module with its live pending count; clicking a
// box lists that module's alerts in a table below it (clicking it again
// closes the table). Clicking a row marks the alert read and opens it.
function PendingActionsPanel() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);

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

  const grouped = { empanelment: [], leads: [], proposals: [], monitoring: [], financials: [], other: [] };
  items.forEach((n) => grouped[categoryOf(n)].push(n));

  const boxes = [
    ...ACTION_CATEGORIES.filter((c) => c.canSee(profile?.role) || grouped[c.key].length > 0),
    ...(grouped.other.length ? [{ key: "other", title: "General", icon: <BellIcon /> }] : []),
  ];
  const current = boxes.find((b) => b.key === active) || null;
  const list = current ? grouped[current.key] : [];

  return (
    <section className={`home-actions${current ? " has-active" : ""}`} aria-label="Needs your action">
      <div className="home-boxes">
        {boxes.map((b, i) => {
          const rows = grouped[b.key];
          const isActive = current?.key === b.key;
          return (
            <button
              key={b.key}
              type="button"
              className={`home-box home-box-${b.key}${isActive ? " active" : ""}${rows.length ? " has-items" : ""}`}
              style={{ "--i": i }}
              aria-expanded={isActive}
              onClick={() => setActive(isActive ? null : b.key)}
            >
              <span className="home-box-top">
                <span className="home-box-icon" aria-hidden="true">{b.icon}</span>
                <span className="home-box-title">{b.title}</span>
              </span>
              <span className="home-box-count"><CountUp value={rows.length} /></span>
              <span className="home-box-foot">
                {rows.length === 0 ? "All caught up" : `Latest ${timeAgo(rows[0].created_at)}`}
                <span className="home-box-view">{isActive ? "Hide" : "View"} <ChevronRightIcon /></span>
              </span>
            </button>
          );
        })}
      </div>

      {!current ? (
        <p className="home-actions-hint"><InboxIcon /> Click a box to see its alerts.</p>
      ) : (
        <Card key={current.key} className="home-table-card">
          {/* Mobile only — there the alerts replace the module list in place
              (see HomePage.css), so this is the way back to it. */}
          <button type="button" className="back-link home-table-back" onClick={() => setActive(null)}>
            <ArrowLeftIcon />
            <span>Back</span>
          </button>
          <div className="home-table-head">
            <h3>{current.title}</h3>
            {current.to && (
              <button type="button" className="home-table-open" onClick={() => navigate(current.to)}>
                Open {current.title} <ChevronRightIcon />
              </button>
            )}
          </div>

          {list.length === 0 ? (
            <div className="home-table-empty">
              <span className="home-table-empty-icon" aria-hidden="true"><CheckCircleIcon /></span>
              <p className="home-table-empty-title">All caught up</p>
              <p className="home-table-empty-sub">New items will appear here as soon as they need you.</p>
            </div>
          ) : (
            <div className="home-table-scroll">
              <table className="table home-table">
                <thead>
                  <tr>
                    <th className="home-col-num">#</th>
                    <th>Alert</th>
                    <th>Details</th>
                    <th className="home-col-date">Received</th>
                    <th className="home-col-open" aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((n, i) => (
                    <tr
                      key={n.id}
                      className="home-table-row"
                      style={{ "--i": Math.min(i, 12) }}
                      tabIndex={0}
                      onClick={() => handleClick(n)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(n); }
                      }}
                    >
                      <td className="home-col-num">{i + 1}</td>
                      <td className="home-table-title">{n.title}</td>
                      <td className="home-table-sub">{n.sub_text || "—"}</td>
                      <td className="home-col-date">
                        <span className="home-table-date">{fmtDate(n.created_at)}</span>
                        <span className="home-table-ago">{timeAgo(n.created_at)}</span>
                      </td>
                      <td className="home-col-open"><ChevronRightIcon /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
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
        <div className="page-header home-welcome">
          <h1>Welcome, {profile?.full_name}</h1>
        </div>
        {isBa && <BaStatusCard />}
        {!isBa && <PendingActionsPanel />}
      </div>
    </div>
  );
}
