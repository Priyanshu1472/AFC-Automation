import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { can } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Select from "../../components/ui/Select";
import PageLoader from "../../components/ui/PageLoader";
import "../../styles/EmpanelmentDashboardPage.css";

// Same shape as every other empanelment page's local status map (see
// EmpanelmentListPage / ApplicationReviewPage) — kept per-page rather than
// shared, matching the existing convention in this codebase.
const STATUS_MAP = {
  sent: { label: "Sent", variant: "info" },
  filled: { label: "BA Filled", variant: "warning" },
  po_review: { label: "PO Review", variant: "warning" },
  cfo_cs_review: { label: "CFO / CS", variant: "info" },
  po_final_review: { label: "PO Final", variant: "warning" },
  dgm_review: { label: "DGM Review", variant: "neutral" },
  md_review: { label: "MD Review", variant: "neutral" },
  accepted: { label: "Accepted", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  on_hold: { label: "On Hold", variant: "warning" },
};
const PIPELINE = ["sent", "po_review", "cfo_cs_review", "po_final_review", "dgm_review", "md_review", "accepted"];
const TERMINAL = ["accepted", "rejected"];
const IN_PROGRESS_STATUSES = ["po_review", "cfo_cs_review", "po_final_review", "dgm_review", "md_review", "on_hold"];
const DATE_RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
];

// Status buckets rendered around the donut, in this exact order — the
// adjacency between consecutive slots (including wrap-around 8→1) is what's
// colorblind-validated (see EmpanelmentDashboardPage.css), so this sequence
// must not be reshuffled at render time.
const DONUT_BUCKETS = [
  { key: "awaiting", label: "Awaiting BA", match: (s) => s === "sent" || s === "filled", colorVar: "--edb-cat-1" },
  { key: "accepted", label: "Accepted", match: (s) => s === "accepted", colorVar: "--edb-cat-2" },
  { key: "cfo_cs", label: "CFO / CS Review", match: (s) => s === "cfo_cs_review", colorVar: "--edb-cat-3" },
  { key: "po", label: "PO Review", match: (s) => s === "po_review" || s === "po_final_review", colorVar: "--edb-cat-4" },
  { key: "dgm", label: "DGM Review", match: (s) => s === "dgm_review", colorVar: "--edb-cat-5" },
  { key: "hold", label: "On Hold", match: (s) => s === "on_hold", colorVar: "--edb-cat-6" },
  { key: "md", label: "MD Review", match: (s) => s === "md_review", colorVar: "--edb-cat-7" },
  { key: "rejected", label: "Rejected", match: (s) => s === "rejected", colorVar: "--edb-cat-8" },
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
  pause: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>,
  trending: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>,
  mail: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z" /><path d="m4 6 8 7 8-7" /></svg>,
  refresh: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>,
  alert: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>,
  bulb: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" /></svg>,
  close: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  arrow: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>,
};

function StatTile({ label, value, sub, variant = "neutral", icon, onClick, active }) {
  const isNumeric = typeof value === "number";
  const animated = useCountUp(isNumeric ? value : 0);
  const displayValue = isNumeric ? animated : value;
  return (
    <div
      className={`edb-stat edb-stat-${variant}${onClick ? " edb-stat-clickable" : ""}${active ? " edb-stat-active" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <div className="edb-stat-top">
        {icon && <span className={`edb-stat-icon edb-stat-icon-${variant}`}>{icon}</span>}
        <span className="edb-stat-value">{displayValue}</span>
      </div>
      <div className="edb-stat-label">{label}</div>
      {sub && <div className="edb-stat-sub">{sub}</div>}
    </div>
  );
}

// ── Donut chart — hover shows the segment's count+label at center,
// click opens the drill-down panel for that bucket. ──────────────
function DonutChart({ segments, onSegmentClick, activeKey, size = 168 }) {
  const [hovered, setHovered] = useState(null);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <p className="text-secondary text-sm">No applications yet.</p>;

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
    <div className="edb-donut-wrap">
      <div className="edb-donut-svg-wrap">
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
      <div className="edb-donut-legend">
        {segments.filter((s) => s.value > 0).map((seg) => (
          <button
            key={seg.key}
            type="button"
            className={`edb-legend-item${activeKey === seg.key ? " edb-legend-active" : ""}`}
            onClick={() => onSegmentClick(seg.key === activeKey ? null : seg.key)}
            onMouseEnter={() => setHovered(seg.key)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className="edb-legend-dot" style={{ background: `var(${seg.colorVar})` }} />
            <span className="edb-legend-label">{seg.label}</span>
            <span className="edb-legend-val">{seg.value}</span>
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
    <Tag type={onClick ? "button" : undefined} className={`edb-bar-row${onClick ? " edb-bar-row-clickable" : ""}${active ? " edb-bar-row-active" : ""}`} onClick={onClick}>
      <span className="edb-bar-label">{label}</span>
      <span className="edb-bar-track">
        <span className={`edb-bar-fill edb-bar-fill-${variant}`} style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }} />
      </span>
      <span className="edb-bar-count">{count}</span>
    </Tag>
  );
}

function ChartCard({ title, subtitle, children, action }) {
  return (
    <Card hoverable className="edb-chart-card">
      <Card.Header title={title} subtitle={subtitle} action={action} />
      <Card.Body>{children}</Card.Body>
    </Card>
  );
}

// ── Drill-down slide-over — lists the applications behind whatever KPI,
// donut segment, funnel stage, or bar the user clicked. ──────────────
function DrillDownPanel({ title, apps, onClose, onView }) {
  if (!apps) return null;
  return (
    <div className="edb-drill-overlay" onClick={onClose}>
      <div className="edb-drill-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="edb-drill-header">
          <div>
            <div className="edb-drill-title">{title}</div>
            <div className="edb-drill-count">{apps.length} application{apps.length !== 1 ? "s" : ""}</div>
          </div>
          <button type="button" className="edb-drill-close" onClick={onClose} aria-label="Close">{Icon.close}</button>
        </div>
        <div className="edb-drill-list">
          {apps.length === 0 ? (
            <div className="edb-drill-empty">No applications in this group.</div>
          ) : (
            apps.map((a) => (
              <button key={a.id} type="button" className="edb-drill-row" onClick={() => onView(a.id)}>
                <span className="edb-drill-left">
                  <span className="edb-drill-email">{a.ba_email}</span>
                  <span className="edb-drill-code">{a.application_code}{a.team ? ` · ${a.team}` : ""}</span>
                </span>
                <Badge variant={STATUS_MAP[a.status]?.variant || "neutral"}>{STATUS_MAP[a.status]?.label || a.status}</Badge>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function EmpanelmentDashboardPage() {
  const { profile, activeTeam } = useAuth();
  const navigate = useNavigate();
  const role = profile?.role;

  const [apps, setApps] = useState([]);
  const [sectorsByApp, setSectorsByApp] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dateRangeDays, setDateRangeDays] = useState(null);
  const [teamFilter, setTeamFilter] = useState("all");

  const [drillApps, setDrillApps] = useState(null);
  const [drillTitle, setDrillTitle] = useState("");
  const [activeDonut, setActiveDonut] = useState(null);
  const [activeStage, setActiveStage] = useState(null);
  const [activeKpi, setActiveKpi] = useState(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    // RLS scopes rows to what this role can already see — md/cfo/cs get
    // every team, dgm their own team, po/ac their own applications.
    const { data: appRows } = await supabase
      .from("empanelment_applications")
      .select("id, status, team, office, ba_email, application_code, created_at, decided_at, provisional_letter_sent")
      .order("created_at", { ascending: false })
      .limit(2000);
    const list = appRows || [];
    setApps(list);

    const ids = list.map((a) => a.id);
    const sectorMap = {};
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from("ba_registrations").select("application_id, sectors_served").in("application_id", ids.slice(i, i + 300));
      (data || []).forEach((r) => { sectorMap[r.application_id] = Array.isArray(r.sectors_served) ? r.sectors_served : []; });
    }
    setSectorsByApp(sectorMap);

    setLastUpdated(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const channel = supabase
      .channel("empanelment-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "empanelment_applications" }, () => fetchData(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  const canFilterTeam = can.viewAllTeams(role);
  const allTeams = useMemo(() => [...new Set(apps.map((a) => a.team).filter(Boolean))].sort(), [apps]);

  const filtered = useMemo(() => {
    let list = apps;
    if (dateRangeDays) {
      const cutoff = Date.now() - dateRangeDays * 86400000;
      list = list.filter((a) => new Date(a.created_at).getTime() >= cutoff);
    }
    if (canFilterTeam && teamFilter !== "all") list = list.filter((a) => a.team === teamFilter);
    // A multi-team viewer with no visible team filter (team-scoped roles
    // don't get one — see canFilterTeam) still needs narrowing down to
    // their currently active team; a no-op for single-team/org-wide users.
    else if (!canFilterTeam && activeTeam) list = list.filter((a) => a.team === activeTeam);
    return list;
  }, [apps, dateRangeDays, teamFilter, canFilterTeam, activeTeam]);

  const total = filtered.length;
  const accepted = filtered.filter((a) => a.status === "accepted").length;
  const rejected = filtered.filter((a) => a.status === "rejected").length;
  const inProgress = filtered.filter((a) => IN_PROGRESS_STATUSES.includes(a.status)).length;
  const onHold = filtered.filter((a) => a.status === "on_hold").length;
  const acceptRate = accepted + rejected > 0 ? Math.round((accepted / (accepted + rejected)) * 100) : null;

  const avgTat = useMemo(() => {
    const done = filtered.filter((a) => a.status === "accepted" && a.decided_at);
    if (!done.length) return null;
    const days = done.map((a) => Math.round((new Date(a.decided_at) - new Date(a.created_at)) / 86400000));
    return Math.round(days.reduce((s, d) => s + d, 0) / days.length);
  }, [filtered]);

  const donutSegments = useMemo(
    () => DONUT_BUCKETS.map((b) => ({ key: b.key, label: b.label, colorVar: b.colorVar, value: filtered.filter((a) => b.match(a.status)).length })),
    [filtered]
  );

  // on_hold applications sit outside this single-track funnel (they're
  // paused, not at a numbered stage) — surfaced separately via the "On
  // Hold" KPI tile and the donut instead.
  const funnelCounts = useMemo(
    () => PIPELINE.map((s) => ({ key: s, count: filtered.filter((a) => a.status === s).length })),
    [filtered]
  );

  const monthly = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const monthApps = filtered.filter((a) => {
        const ad = new Date(a.created_at);
        return ad.getFullYear() === d.getFullYear() && ad.getMonth() === d.getMonth();
      });
      return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString("en-IN", { month: "short" }), count: monthApps.length, apps: monthApps };
    });
  }, [filtered]);
  const monthlyMax = Math.max(...monthly.map((m) => m.count), 1);

  const stalled = useMemo(
    () =>
      filtered
        .filter((a) => !TERMINAL.includes(a.status) && a.status !== "sent")
        .filter((a) => daysSince(a.created_at) >= 5)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .slice(0, 8),
    [filtered]
  );

  const teamBreakdown = useMemo(() => {
    if (!canFilterTeam) return [];
    const map = {};
    filtered.forEach((a) => {
      if (!a.team) return;
      if (!map[a.team]) map[a.team] = { total: 0, accepted: 0, rejected: 0 };
      map[a.team].total++;
      if (a.status === "accepted") map[a.team].accepted++;
      if (a.status === "rejected") map[a.team].rejected++;
    });
    return Object.entries(map)
      .map(([team, v]) => ({ team, ...v, rate: v.accepted + v.rejected > 0 ? Math.round((v.accepted / (v.accepted + v.rejected)) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [filtered, canFilterTeam]);

  const sectorBreakdown = useMemo(() => {
    const map = {};
    filtered
      .filter((a) => a.status === "accepted")
      .forEach((a) => (sectorsByApp[a.id] || []).forEach((s) => { map[s] = (map[s] || 0) + 1; }));
    return Object.entries(map).map(([sector, count]) => ({ sector, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [filtered, sectorsByApp]);

  const provisionalSent = filtered.filter((a) => a.provisional_letter_sent).length;

  const insights = useMemo(() => {
    const list = [];
    if (stalled.length > 0) list.push({ tone: "warn", icon: Icon.alert, text: `${stalled.length} application${stalled.length > 1 ? "s" : ""} stalled for 5+ days without movement.` });
    if (onHold > 0) list.push({ tone: "warn", icon: Icon.pause, text: `${onHold} application${onHold > 1 ? "s are" : " is"} on hold awaiting a BA correction.` });
    if (total - provisionalSent > 0 && (role === "dgm" || role === "md")) list.push({ tone: "info", icon: Icon.mail, text: `${total - provisionalSent} application${total - provisionalSent > 1 ? "s haven't" : " hasn't"} had a provisional letter sent yet.` });
    if (acceptRate !== null && acceptRate >= 70) list.push({ tone: "good", icon: Icon.check, text: `Strong acceptance rate of ${acceptRate}% across decided applications.` });
    if (avgTat !== null) list.push({ tone: "info", icon: Icon.trending, text: `Applications take an average of ${avgTat} day${avgTat !== 1 ? "s" : ""} from being sent to being accepted.` });
    if (stalled.length === 0 && total > 0) list.push({ tone: "good", icon: Icon.check, text: "No stalled applications — the pipeline is moving well." });
    if (total === 0) list.push({ tone: "info", icon: Icon.send, text: "No applications yet — start by sending an empanelment form." });
    return list.slice(0, 4);
  }, [stalled, onHold, total, provisionalSent, role, acceptRate, avgTat]);

  function clearDrillTriggers() { setActiveDonut(null); setActiveStage(null); setActiveKpi(null); }
  function openDrill(title, list) { setDrillTitle(title); setDrillApps(list); }
  function closeDrill() { setDrillApps(null); clearDrillTriggers(); }

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
    openDrill(bucket.label, filtered.filter((a) => bucket.match(a.status)));
  }
  function handleStageClick(stageKey) {
    if (activeStage === stageKey) { closeDrill(); return; }
    clearDrillTriggers();
    setActiveStage(stageKey);
    openDrill(STATUS_MAP[stageKey]?.label || stageKey, filtered.filter((a) => a.status === stageKey));
  }
  function handleMonthClick(month) {
    openDrill(`Sent in ${month.label}`, month.apps);
  }

  if (loading) return <PageLoader text="Loading dashboard…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>Empanelment Dashboard</h1>
            </div>
            <div className="edb-controls">
              <div className="edb-range-group">
                {DATE_RANGES.map((r) => (
                  <button key={r.label} type="button" className={`edb-range-btn${dateRangeDays === r.days ? " edb-range-btn-active" : ""}`} onClick={() => { setDateRangeDays(r.days); closeDrill(); }}>
                    {r.label}
                  </button>
                ))}
              </div>
              {canFilterTeam && allTeams.length > 1 && (
                <Select
                  className="edb-team-select"
                  value={teamFilter}
                  onChange={(v) => { setTeamFilter(v); closeDrill(); }}
                  placeholder="All Teams"
                  options={[{ value: "all", label: "All Teams" }, ...allTeams.map((t) => ({ value: t, label: t }))]}
                />
              )}
              <button type="button" className={`edb-refresh-btn${refreshing ? " edb-refresh-spinning" : ""}`} onClick={() => fetchData(true)} disabled={refreshing} title={lastUpdated ? `Last updated ${timeAgo(lastUpdated)}` : "Refresh"}>
                {Icon.refresh}<span>{lastUpdated ? timeAgo(lastUpdated) : "Refresh"}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="edb-kpi-row">
          <StatTile label="Total Applications" value={total} sub={dateRangeDays ? `Last ${dateRangeDays} days` : "All time"} variant="brand" icon={Icon.send} onClick={() => handleKpiClick("total", "All Applications", filtered)} active={activeKpi === "total"} />
          <StatTile label="In Progress" value={inProgress} sub="Active pipeline" variant="warning" icon={Icon.clock} onClick={() => handleKpiClick("progress", "In Progress", filtered.filter((a) => IN_PROGRESS_STATUSES.includes(a.status)))} active={activeKpi === "progress"} />
          <StatTile label="Empanelled" value={accepted} sub={acceptRate !== null ? `${acceptRate}% acceptance rate` : "—"} variant="success" icon={Icon.check} onClick={() => handleKpiClick("accepted", "Empanelled", filtered.filter((a) => a.status === "accepted"))} active={activeKpi === "accepted"} />
          <StatTile label="Rejected" value={rejected} sub="Final decisions" variant="danger" icon={Icon.x} onClick={() => handleKpiClick("rejected", "Rejected", filtered.filter((a) => a.status === "rejected"))} active={activeKpi === "rejected"} />
          <StatTile label="On Hold" value={onHold} sub="Awaiting BA correction" variant="neutral" icon={Icon.pause} onClick={() => handleKpiClick("hold", "On Hold", filtered.filter((a) => a.status === "on_hold"))} active={activeKpi === "hold"} />
          {avgTat !== null && <StatTile label="Avg. Time to Accept" value={`${avgTat}d`} sub="Sent → accepted" variant="info" icon={Icon.trending} />}
          <StatTile label="Provisional Letters Sent" value={provisionalSent} sub={`${total - provisionalSent} not yet sent`} variant="info" icon={Icon.mail} />
        </div>

        <div className="edb-charts-grid">
          <ChartCard title="Status Distribution" subtitle="Click a segment to see those applications">
            <DonutChart segments={donutSegments} onSegmentClick={handleDonutClick} activeKey={activeDonut} />
          </ChartCard>

          <ChartCard title="Application Pipeline" subtitle="Applications currently at each stage — click to drill in">
            <div className="edb-bar-list">
              {funnelCounts.map((f) => (
                <BarRow key={f.key} label={STATUS_MAP[f.key]?.label || f.key} count={f.count} total={total} variant="brand" onClick={() => handleStageClick(f.key)} active={activeStage === f.key} />
              ))}
            </div>
          </ChartCard>

          <ChartCard title="Monthly Trend" subtitle="Hover for exact count, click a bar to drill in">
            <div className="edb-spark">
              {monthly.map((m) => (
                <button key={m.key} type="button" className="edb-spark-col" onClick={() => m.count > 0 && handleMonthClick(m)}>
                  <span className="edb-spark-count">{m.count}</span>
                  <div className="edb-spark-bar-wrap">
                    <div className="edb-spark-bar" style={{ height: `${Math.max((m.count / monthlyMax) * 100, m.count > 0 ? 6 : 0)}%` }} />
                  </div>
                  <span className="edb-spark-label">{m.label}</span>
                </button>
              ))}
            </div>
          </ChartCard>
        </div>

        <div className="edb-charts-grid edb-charts-grid-2">
          <ChartCard title="Sector-wise Coverage" subtitle="Top sectors served by empanelled BAs">
            {sectorBreakdown.length === 0 ? <p className="text-secondary text-sm">No sector data yet.</p> : (
              <div className="edb-bar-list">
                {sectorBreakdown.map((s) => (
                  <BarRow key={s.sector} label={s.sector} count={s.count} total={Math.max(...sectorBreakdown.map((x) => x.count), 1)} variant="info" />
                ))}
              </div>
            )}
          </ChartCard>

          <ChartCard title="Quick Insights" subtitle="Things that need attention">
            <div className="edb-insights">
              {insights.map((ins, i) => (
                <div key={i} className={`edb-insight edb-insight-${ins.tone}`}>
                  <span className="edb-insight-icon">{ins.icon}</span>
                  <span>{ins.text}</span>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        {canFilterTeam && teamBreakdown.length > 0 && (
          <div className="edb-bottom-grid edb-bottom-grid-single">
            <ChartCard title="Team Performance" subtitle="Acceptance rate per team">
              <div className="edb-team-list">
                {teamBreakdown.map((t) => (
                  <div key={t.team} className="edb-team-row">
                    <div className="edb-team-left">
                      <span className="edb-team-name">{t.team}</span>
                      <span className="edb-bar-track edb-team-track">
                        <span className="edb-bar-fill edb-bar-fill-brand" style={{ width: `${Math.max(t.rate, t.total > 0 ? 3 : 0)}%` }} />
                      </span>
                    </div>
                    <div className="edb-team-right">
                      <span>{t.accepted}/{t.total}</span>
                      <span className="edb-team-rate">{t.rate}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </ChartCard>
          </div>
        )}
      </div>

      <DrillDownPanel title={drillTitle} apps={drillApps} onClose={closeDrill} onView={(id) => navigate(`/empanelment/${id}`)} />
    </div>
  );
}
