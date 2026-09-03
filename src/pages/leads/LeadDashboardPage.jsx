import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { can } from "../../lib/roles";
import { STATUS_MAP } from "../../components/leads/leadStatus";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Select from "../../components/ui/Select";
import PageLoader from "../../components/ui/PageLoader";
import "../../styles/LeadDashboardPage.css";

// Structural mirror of EmpanelmentDashboardPage.jsx — same hand-rolled
// chart approach (no charting library anywhere in this app), same
// donut/funnel/spark/insights/team-performance layout, adapted to the
// leads workflow's own status set.
const TERMINAL = ["md_approved", "md_declined", "pa_dropped"];
// The on-track funnel, in STATUS_FLOW order, ending at the terminal
// approval — mirrors Empanelment's PIPELINE (which also ends at its
// terminal "accepted").
const PIPELINE = ["pa_review", "dgm_initial_review", "pmt_review", "pmt_extended_review", "dgm_review", "md_review", "md_approved"];
const IN_PROGRESS_STATUSES = ["pa_review", "dgm_initial_review", "pmt_review", "pmt_extended_review", "dgm_review", "md_review"];
const DATE_RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
];

// Same 8-slot count and adjacency requirement as Empanelment's donut, so
// this reuses that already-validated colorblind-safe sequence (see
// LeadDashboardPage.css) under a page-local variable name, matching this
// codebase's per-page CSS variable convention. dgm_initial_review and
// dgm_review are merged into one "DGM / G3 Review" slot — both are G3
// committee work, same idea as Empanelment merging po_review +
// po_final_review into one "PO Review" slot.
const DONUT_BUCKETS = [
  { key: "pa_review", label: "PR Review", match: (s) => s === "pa_review", colorVar: "--ldb-cat-1" },
  { key: "approved", label: "Approved", match: (s) => s === "md_approved", colorVar: "--ldb-cat-2" },
  { key: "dgm", label: "DGM / G3 Review", match: (s) => s === "dgm_initial_review" || s === "dgm_review", colorVar: "--ldb-cat-3" },
  { key: "pmt", label: "PMT Review", match: (s) => s === "pmt_review", colorVar: "--ldb-cat-4" },
  { key: "pmt_extended", label: "PMT Extended", match: (s) => s === "pmt_extended_review", colorVar: "--ldb-cat-5" },
  { key: "action_dropped", label: "Action Required / Dropped", match: (s) => s === "pa_action_required" || s === "pa_dropped", colorVar: "--ldb-cat-6" },
  { key: "md_pending", label: "MD Pending", match: (s) => s === "md_review", colorVar: "--ldb-cat-7" },
  { key: "declined", label: "Declined", match: (s) => s === "md_declined", colorVar: "--ldb-cat-8" },
];

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function timeAgo(date) {
  if (!date) return "";
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ── Animated counter ──────────────────────────────────────────
function useCountUp(target, duration = 700) {
  const [current, setCurrent] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const numTarget = typeof target === "number" ? target : 0;
    if (numTarget === 0) { setCurrent(0); return; }
    const start = performance.now();
    const animate = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(eased * numTarget));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return current;
}

// ── Icons ─────────────────────────────────────────────────────
const Icon = {
  send: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>,
  clock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  x: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  trash: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>,
  trending: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>,
  refresh: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>,
  alert: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  calendar: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
  close: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
};

function StatTile({ label, value, sub, variant = "neutral", icon, onClick, active }) {
  const isNumeric = typeof value === "number";
  const animated = useCountUp(isNumeric ? value : 0);
  const displayValue = isNumeric ? animated : value;
  return (
    <div
      className={`ldb-stat ldb-stat-${variant}${onClick ? " ldb-stat-clickable" : ""}${active ? " ldb-stat-active" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <div className="ldb-stat-top">
        {icon && <span className={`ldb-stat-icon ldb-stat-icon-${variant}`}>{icon}</span>}
        <span className="ldb-stat-value">{displayValue}</span>
      </div>
      <div className="ldb-stat-label">{label}</div>
      {sub && <div className="ldb-stat-sub">{sub}</div>}
    </div>
  );
}

function DonutChart({ segments, onSegmentClick, activeKey, size = 168 }) {
  const [hovered, setHovered] = useState(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <p className="text-secondary text-sm">No leads yet.</p>;

  const r = size / 2;
  const ri = r * 0.62;
  let cumAngle = -Math.PI / 2;
  const paths = segments.filter((s) => s.value > 0).map((seg) => {
    const angle = (seg.value / total) * 2 * Math.PI;
    const x1o = r + r * Math.cos(cumAngle), y1o = r + r * Math.sin(cumAngle);
    const x1i = r + ri * Math.cos(cumAngle), y1i = r + ri * Math.sin(cumAngle);
    cumAngle += angle;
    const x2o = r + r * Math.cos(cumAngle), y2o = r + r * Math.sin(cumAngle);
    const x2i = r + ri * Math.cos(cumAngle), y2i = r + ri * Math.sin(cumAngle);
    const large = angle > Math.PI ? 1 : 0;
    return { ...seg, d: `M${x1o},${y1o} A${r},${r} 0 ${large} 1 ${x2o},${y2o} L${x2i},${y2i} A${ri},${ri} 0 ${large} 0 ${x1i},${y1i} Z` };
  });

  const centerSeg = hovered ? segments.find((s) => s.key === hovered) : null;

  return (
    <div className="ldb-donut-wrap">
      <div className="ldb-donut-svg-wrap">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {paths.map((p) => {
            const isActive = activeKey === p.key || hovered === p.key;
            return (
              <path
                key={p.key}
                d={p.d}
                fill={`var(${p.colorVar})`}
                stroke="var(--card-bg)"
                strokeWidth="2"
                style={{
                  transform: isActive ? "scale(1.035)" : "scale(1)",
                  transformOrigin: `${r}px ${r}px`,
                  transition: "transform 150ms ease, opacity 150ms ease",
                  opacity: activeKey && activeKey !== p.key ? 0.45 : 1,
                  cursor: "pointer",
                }}
                onMouseEnter={() => setHovered(p.key)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSegmentClick(p.key === activeKey ? null : p.key)}
              />
            );
          })}
          {centerSeg ? (
            <>
              <text x={r} y={r - 4} textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--text-primary)">{centerSeg.value}</text>
              <text x={r} y={r + 13} textAnchor="middle" fontSize="9" fill="var(--text-tertiary)">{centerSeg.label}</text>
            </>
          ) : (
            <>
              <text x={r} y={r - 4} textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text-primary)">{total}</text>
              <text x={r} y={r + 13} textAnchor="middle" fontSize="9" fill="var(--text-tertiary)">Total</text>
            </>
          )}
        </svg>
      </div>
      <div className="ldb-donut-legend">
        {segments.filter((s) => s.value > 0).map((seg) => (
          <button
            key={seg.key}
            type="button"
            className={`ldb-legend-item${activeKey === seg.key ? " ldb-legend-active" : ""}`}
            onClick={() => onSegmentClick(seg.key === activeKey ? null : seg.key)}
            onMouseEnter={() => setHovered(seg.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="ldb-legend-dot" style={{ background: `var(${seg.colorVar})` }} />
            <span className="ldb-legend-label">{seg.label}</span>
            <span className="ldb-legend-val">{seg.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BarRow({ label, count, total, variant, onClick, active }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`ldb-bar-row${onClick ? " ldb-bar-row-clickable" : ""}${active ? " ldb-bar-row-active" : ""}`} onClick={onClick}>
      <span className="ldb-bar-label">{label}</span>
      <span className="ldb-bar-track">
        <span className={`ldb-bar-fill ldb-bar-fill-${variant}`} style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }} />
      </span>
      <span className="ldb-bar-count">{count}</span>
    </Tag>
  );
}

function ChartCard({ title, subtitle, children, action }) {
  return (
    <Card hoverable className="ldb-chart-card">
      <Card.Header title={title} subtitle={subtitle} action={action} />
      <Card.Body>{children}</Card.Body>
    </Card>
  );
}

function DrillDownPanel({ title, leads, onClose, onView }) {
  if (!leads) return null;
  return (
    <div className="ldb-drill-overlay" onClick={onClose}>
      <div className="ldb-drill-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ldb-drill-header">
          <div>
            <div className="ldb-drill-title">{title}</div>
            <div className="ldb-drill-count">{leads.length} lead{leads.length !== 1 ? "s" : ""}</div>
          </div>
          <button type="button" className="ldb-drill-close" onClick={onClose} aria-label="Close">{Icon.close}</button>
        </div>
        <div className="ldb-drill-list">
          {leads.length === 0 ? (
            <div className="ldb-drill-empty">No leads in this group.</div>
          ) : (
            leads.map((l) => (
              <button key={l.id} type="button" className="ldb-drill-row" onClick={() => onView(l.id)}>
                <span className="ldb-drill-left">
                  <span className="ldb-drill-email">{l.title}</span>
                  <span className="ldb-drill-code">{l.lead_number}{l.team ? ` · ${l.team}` : ""}</span>
                </span>
                <Badge variant={STATUS_MAP[l.status]?.variant || "neutral"}>{STATUS_MAP[l.status]?.label || l.status}</Badge>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function LeadDashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const role = profile?.role;

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dateRangeDays, setDateRangeDays] = useState(null);
  const [teamFilter, setTeamFilter] = useState("all");

  const [drillLeads, setDrillLeads] = useState(null);
  const [drillTitle, setDrillTitle] = useState("");
  const [activeDonut, setActiveDonut] = useState(null);
  const [activeStage, setActiveStage] = useState(null);
  const [activeKpi, setActiveKpi] = useState(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    // RLS scopes rows to what this role can already see — md/cfo/cs get
    // every team, others their own team/assignment.
    const { data } = await supabase
      .from("leads")
      .select("id, lead_number, title, status, team, source, lead_type, created_at, decided_at, submission_deadline")
      .order("created_at", { ascending: false })
      .limit(2000);
    setLeads(data || []);
    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const channel = supabase
      .channel("lead-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => fetchData(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const canFilterTeam = can.viewAllTeams(role);
  const allTeams = useMemo(() => [...new Set(leads.map((l) => l.team).filter(Boolean))].sort(), [leads]);

  const filtered = useMemo(() => {
    let list = leads;
    if (dateRangeDays) {
      const cutoff = Date.now() - dateRangeDays * 86400000;
      list = list.filter((l) => new Date(l.created_at).getTime() >= cutoff);
    }
    if (canFilterTeam && teamFilter !== "all") list = list.filter((l) => l.team === teamFilter);
    return list;
  }, [leads, dateRangeDays, teamFilter, canFilterTeam]);

  const total = filtered.length;
  const approved = filtered.filter((l) => l.status === "md_approved").length;
  const declined = filtered.filter((l) => l.status === "md_declined").length;
  const dropped = filtered.filter((l) => l.status === "pa_dropped").length;
  const actionRequired = filtered.filter((l) => l.status === "pa_action_required").length;
  const inReview = filtered.filter((l) => IN_PROGRESS_STATUSES.includes(l.status)).length;
  const approvalRate = approved + declined > 0 ? Math.round((approved / (approved + declined)) * 100) : null;

  const avgTat = useMemo(() => {
    const done = filtered.filter((l) => l.status === "md_approved" && l.decided_at);
    if (!done.length) return null;
    const days = done.map((l) => Math.round((new Date(l.decided_at) - new Date(l.created_at)) / 86400000));
    return Math.round(days.reduce((s, d) => s + d, 0) / days.length);
  }, [filtered]);

  const donutSegments = useMemo(
    () => DONUT_BUCKETS.map((b) => ({ key: b.key, label: b.label, colorVar: b.colorVar, value: filtered.filter((l) => b.match(l.status)).length })),
    [filtered]
  );

  const funnelCounts = useMemo(
    () => PIPELINE.map((s) => ({ key: s, count: filtered.filter((l) => l.status === s).length })),
    [filtered]
  );

  const monthly = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const monthLeads = filtered.filter((l) => {
        const ld = new Date(l.created_at);
        return ld.getFullYear() === d.getFullYear() && ld.getMonth() === d.getMonth();
      });
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString("en-IN", { month: "short" }), count: monthLeads.length, leads: monthLeads };
    });
  }, [filtered]);
  const monthlyMax = Math.max(...monthly.map((m) => m.count), 1);

  const stalled = useMemo(
    () =>
      filtered
        .filter((l) => !TERMINAL.includes(l.status) && l.status !== "pa_action_required")
        .filter((l) => daysSince(l.created_at) >= 5)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, 8),
    [filtered]
  );

  // Leads whose submission deadline is within the next 3 days (or already
  // past) and are still actively moving — no equivalent concept exists on
  // the Empanelment dashboard, since applications don't have a bid
  // deadline of their own.
  const nearDeadline = useMemo(
    () =>
      filtered
        .filter((l) => l.submission_deadline && !TERMINAL.includes(l.status))
        .map((l) => ({ ...l, daysLeft: Math.ceil((new Date(l.submission_deadline) - Date.now()) / 86400000) }))
        .filter((l) => l.daysLeft <= 3)
        .sort((a, b) => a.daysLeft - b.daysLeft),
    [filtered]
  );

  const sourceBreakdown = useMemo(() => {
    const labels = { in_house: "In House", ba: "BA Source", suo_moto: "Suo Moto" };
    return Object.entries(labels).map(([key, label]) => ({ key, label, count: filtered.filter((l) => l.source === key).length }));
  }, [filtered]);

  const typeBreakdown = useMemo(() => {
    const labels = { rfp: "RFP", eoi: "EOI" };
    return Object.entries(labels).map(([key, label]) => ({ key, label, count: filtered.filter((l) => l.lead_type === key).length }));
  }, [filtered]);

  const teamBreakdown = useMemo(() => {
    if (!canFilterTeam) return [];
    const map = {};
    filtered.forEach((l) => {
      if (!l.team) return;
      if (!map[l.team]) map[l.team] = { total: 0, approved: 0, declined: 0 };
      map[l.team].total++;
      if (l.status === "md_approved") map[l.team].approved++;
      if (l.status === "md_declined") map[l.team].declined++;
    });
    return Object.entries(map)
      .map(([team, v]) => ({ team, ...v, rate: v.approved + v.declined > 0 ? Math.round((v.approved / (v.approved + v.declined)) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [filtered, canFilterTeam]);

  const insights = useMemo(() => {
    const list = [];
    if (stalled.length > 0) list.push({ tone: "warn", icon: Icon.alert, text: `${stalled.length} lead${stalled.length > 1 ? "s" : ""} stalled for 5+ days without movement.` });
    if (nearDeadline.length > 0) list.push({ tone: "warn", icon: Icon.calendar, text: `${nearDeadline.length} lead${nearDeadline.length > 1 ? "s have" : " has"} a submission deadline within 3 days.` });
    if (actionRequired > 0) list.push({ tone: "warn", icon: Icon.alert, text: `${actionRequired} lead${actionRequired > 1 ? "s need" : " needs"} changes before it can move on.` });
    if (approvalRate !== null && approvalRate >= 70) list.push({ tone: "good", icon: Icon.check, text: `Strong approval rate of ${approvalRate}% across decided leads.` });
    if (avgTat !== null) list.push({ tone: "info", icon: Icon.trending, text: `Leads take an average of ${avgTat} day${avgTat !== 1 ? "s" : ""} from creation to MD approval.` });
    if (stalled.length === 0 && total > 0) list.push({ tone: "good", icon: Icon.check, text: "No stalled leads — the pipeline is moving well." });
    if (total === 0) list.push({ tone: "info", icon: Icon.send, text: "No leads yet — create one to get started." });
    return list.slice(0, 4);
  }, [stalled, nearDeadline, actionRequired, total, approvalRate, avgTat]);

  function clearDrillTriggers() { setActiveDonut(null); setActiveStage(null); setActiveKpi(null); }
  function openDrill(title, list) { setDrillTitle(title); setDrillLeads(list); }
  function closeDrill() { setDrillLeads(null); clearDrillTriggers(); }

  function handleKpiClick(kpi, title, list) {
    if (activeKpi === kpi) { closeDrill(); return; }
    clearDrillTriggers();
    setActiveKpi(kpi);
    openDrill(title, list);
  }
  function handleDonutClick(key) {
    if (!key) { closeDrill(); return; }
    clearDrillTriggers();
    setActiveDonut(key);
    const bucket = DONUT_BUCKETS.find((b) => b.key === key);
    openDrill(bucket.label, filtered.filter((l) => bucket.match(l.status)));
  }
  function handleStageClick(stageKey) {
    if (activeStage === stageKey) { closeDrill(); return; }
    clearDrillTriggers();
    setActiveStage(stageKey);
    openDrill(STATUS_MAP[stageKey]?.label || stageKey, filtered.filter((l) => l.status === stageKey));
  }
  function handleMonthClick(month) {
    openDrill(`Created in ${month.label}`, month.leads);
  }

  if (loading) return <PageLoader text="Loading dashboard…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>Leads Dashboard</h1>
            </div>
            <div className="ldb-controls">
              <div className="ldb-range-group">
                {DATE_RANGES.map((r) => (
                  <button key={r.label} type="button" className={`ldb-range-btn${dateRangeDays === r.days ? " ldb-range-btn-active" : ""}`} onClick={() => { setDateRangeDays(r.days); closeDrill(); }}>
                    {r.label}
                  </button>
                ))}
              </div>
              {canFilterTeam && allTeams.length > 1 && (
                <Select
                  className="ldb-team-select"
                  value={teamFilter}
                  onChange={(v) => { setTeamFilter(v); closeDrill(); }}
                  placeholder="All Teams"
                  options={[{ value: "all", label: "All Teams" }, ...allTeams.map((t) => ({ value: t, label: t }))]}
                />
              )}
              <button type="button" className={`ldb-refresh-btn${refreshing ? " ldb-refresh-spinning" : ""}`} onClick={() => fetchData(true)} disabled={refreshing} title={lastUpdated ? `Last updated ${timeAgo(lastUpdated)}` : "Refresh"}>
                {Icon.refresh}<span>{lastUpdated ? timeAgo(lastUpdated) : "Refresh"}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="ldb-kpi-row">
          <StatTile label="Total Leads" value={total} sub={dateRangeDays ? `Last ${dateRangeDays} days` : "All time"} variant="brand" icon={Icon.send} onClick={() => handleKpiClick("total", "All Leads", filtered)} active={activeKpi === "total"} />
          <StatTile label="In Review" value={inReview} sub="Active pipeline" variant="warning" icon={Icon.clock} onClick={() => handleKpiClick("progress", "In Review", filtered.filter((l) => IN_PROGRESS_STATUSES.includes(l.status)))} active={activeKpi === "progress"} />
          <StatTile label="Approved" value={approved} sub={approvalRate !== null ? `${approvalRate}% approval rate` : "—"} variant="success" icon={Icon.check} onClick={() => handleKpiClick("approved", "Approved", filtered.filter((l) => l.status === "md_approved"))} active={activeKpi === "approved"} />
          <StatTile label="Declined" value={declined} sub="Final decisions" variant="danger" icon={Icon.x} onClick={() => handleKpiClick("declined", "Declined", filtered.filter((l) => l.status === "md_declined"))} active={activeKpi === "declined"} />
          <StatTile label="Dropped" value={dropped} sub="Withdrawn" variant="neutral" icon={Icon.trash} onClick={() => handleKpiClick("dropped", "Dropped", filtered.filter((l) => l.status === "pa_dropped"))} active={activeKpi === "dropped"} />
          <StatTile label="Action Required" value={actionRequired} sub="Returned for changes" variant="danger" icon={Icon.alert} onClick={() => handleKpiClick("action_required", "Action Required", filtered.filter((l) => l.status === "pa_action_required"))} active={activeKpi === "action_required"} />
          {avgTat !== null && <StatTile label="Avg. Time to Decision" value={`${avgTat}d`} sub="Created → MD approved" variant="info" icon={Icon.trending} />}
        </div>

        <div className="ldb-charts-grid">
          <ChartCard title="Status Distribution" subtitle="Click a segment to see those leads">
            <DonutChart segments={donutSegments} onSegmentClick={handleDonutClick} activeKey={activeDonut} />
          </ChartCard>

          <ChartCard title="Lead Pipeline" subtitle="Leads currently at each stage — click to drill in">
            <div className="ldb-bar-list">
              {funnelCounts.map((f) => (
                <BarRow key={f.key} label={STATUS_MAP[f.key]?.label || f.key} count={f.count} total={total} variant="brand" onClick={() => handleStageClick(f.key)} active={activeStage === f.key} />
              ))}
            </div>
          </ChartCard>

          <ChartCard title="Monthly Trend" subtitle="Hover for exact count, click a bar to drill in">
            <div className="ldb-spark">
              {monthly.map((m) => (
                <button key={m.key} type="button" className="ldb-spark-col" onClick={() => m.count > 0 && handleMonthClick(m)}>
                  <span className="ldb-spark-count">{m.count}</span>
                  <div className="ldb-spark-bar-wrap">
                    <div className="ldb-spark-bar" style={{ height: `${Math.max((m.count / monthlyMax) * 100, m.count > 0 ? 6 : 0)}%` }} />
                  </div>
                  <span className="ldb-spark-label">{m.label}</span>
                </button>
              ))}
            </div>
          </ChartCard>
        </div>

        <div className="ldb-charts-grid ldb-charts-grid-2">
          <ChartCard title="Source & Lead Type" subtitle="Where leads come from, and how they're filed">
            <div className="ldb-mini-charts">
              <div>
                <p className="ldb-mini-label">Source</p>
                <div className="ldb-bar-list">
                  {sourceBreakdown.map((s) => (
                    <BarRow key={s.key} label={s.label} count={s.count} total={Math.max(...sourceBreakdown.map((x) => x.count), 1)} variant="info" />
                  ))}
                </div>
              </div>
              <div>
                <p className="ldb-mini-label">Lead Type</p>
                <div className="ldb-bar-list">
                  {typeBreakdown.map((t) => (
                    <BarRow key={t.key} label={t.label} count={t.count} total={Math.max(...typeBreakdown.map((x) => x.count), 1)} variant="neutral" />
                  ))}
                </div>
              </div>
            </div>
          </ChartCard>

          <ChartCard title="Quick Insights" subtitle="Things that need attention">
            <div className="ldb-insights">
              {insights.map((ins, i) => (
                <div key={i} className={`ldb-insight ldb-insight-${ins.tone}`}>
                  <span className="ldb-insight-icon">{ins.icon}</span>
                  <span>{ins.text}</span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        {canFilterTeam && teamBreakdown.length > 0 && (
          <div className="ldb-bottom-grid ldb-bottom-grid-single">
            <ChartCard title="Team Performance" subtitle="Approval rate per team">
              <div className="ldb-team-list">
                {teamBreakdown.map((t) => (
                  <div key={t.team} className="ldb-team-row">
                    <div className="ldb-team-left">
                      <span className="ldb-team-name">{t.team}</span>
                      <span className="ldb-bar-track ldb-team-track">
                        <span className="ldb-bar-fill ldb-bar-fill-brand" style={{ width: `${Math.max(t.rate, t.total > 0 ? 3 : 0)}%` }} />
                      </span>
                    </div>
                    <div className="ldb-team-right">
                      <span>{t.approved}/{t.total}</span>
                      <span className="ldb-team-rate">{t.rate}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>
        )}
      </div>

      <DrillDownPanel title={drillTitle} leads={drillLeads} onClose={closeDrill} onView={(id) => navigate(`/leads/${id}`)} />
    </div>
  );
}
