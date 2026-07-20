import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/shared/AppHeader";
import Card from "../components/ui/Card";
import Badge from "../components/ui/Badge";
import PageLoader from "../components/ui/PageLoader";
import { useAuth } from "../hooks/useAuth";
import { ROLE_LABELS } from "../lib/roles";
import { supabase } from "../lib/supabase";
import { fetchPendingActionNotifications, subscribeToNotifications, markNotificationRead } from "../lib/notifications";
import "../styles/HomePage.css";

const STATUS_MAP = {
  sent: { label: "Sent", variant: "info" },
  filled: { label: "Form Filled", variant: "warning" },
  po_review: { label: "Under Review — Project Officer", variant: "warning" },
  cfo_cs_review: { label: "Under Review — CFO / CS", variant: "info" },
  po_final_review: { label: "Under Review — Project Officer", variant: "warning" },
  dgm_review: { label: "Under Review — DGM", variant: "neutral" },
  md_review: { label: "Under Review — Managing Director", variant: "neutral" },
  accepted: { label: "Accepted", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  on_hold: { label: "Correction Needed", variant: "warning" },
};

function fmtDate(val) {
  if (!val) return "—";
  return new Date(val).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// RLS (can_view_empanelment_application) scopes this to exactly the one
// application tied to this BA's account via ba_user_id — no client filter
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

// Notifications the recipient hasn't acted on yet (type: "action_required",
// unread) — a review stage waiting on this specific person, not a generic
// activity feed. Clicking one marks it read and jumps to the application.
function PendingActionsPanel() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;

    fetchPendingActionNotifications(profile.id)
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
    if (n.link) navigate(n.link);
  }

  if (loading || items.length === 0) return null;

  return (
    <Card className="pending-actions-card">
      <Card.Header
        title="Needs your action"
        subtitle={`${items.length} application${items.length !== 1 ? "s" : ""} waiting on you`}
      />
      <div className="pending-actions-list">
        {items.map((n) => (
          <button key={n.id} type="button" className="pending-action-item" onClick={() => handleClick(n)}>
            <span className="pending-action-dot" aria-hidden="true" />
            <span className="pending-action-body">
              <span className="pending-action-title">{n.title}</span>
              {n.sub_text && <span className="pending-action-sub">{n.sub_text}</span>}
            </span>
          </button>
        ))}
      </div>
    </Card>
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
          <p>Signed in as {ROLE_LABELS[profile?.role] || profile?.role}.</p>
        </div>
        {isBa && <BaStatusCard />}
        {!isBa && <PendingActionsPanel />}
      </div>
    </div>
  );
}
