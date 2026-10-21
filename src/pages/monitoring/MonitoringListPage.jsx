// Monitoring landing page — every awarded project the caller can see
// (RLS: can_view_monitoring_project), with progress, the next due date,
// and what needs attention (overdue items, invoices to raise). Rejected
// proposals never reach here; a project appears the moment its proposal
// is recorded as Awarded.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { can } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Select from "../../components/ui/Select";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import { ArrowRightIcon } from "../../components/icons";
import {
  PROJECT_SELECT, PROJECT_STATUS_LABELS, PROJECT_STATUS_VARIANTS,
  formatINR, fmtDate, itemTiming, needsInvoice, syncDueAlerts,
} from "../../lib/monitoring";
import "../../styles/ProposalPreparationPage.css";
import "../../styles/Monitoring.css";

const QUICK_FILTERS = {
  all: { label: "Active Projects", match: (p) => p.status === "active" },
  overdue: { label: "With Overdue Items", match: (p) => p.overdue > 0 },
  due_soon: { label: "Due in 7 Days", match: (p) => p.dueSoon > 0 },
  to_invoice: { label: "Invoices to Raise", match: (p) => p.toInvoice > 0 },
};

const STATUS_OPTIONS = [{ value: "all", label: "All Statuses" }, ...Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({ value, label }))];

export default function MonitoringListPage() {
  const navigate = useNavigate();
  const { profile, activeTeam } = useAuth();
  const [projects, setProjects] = useState([]);
  const [items, setItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [quick, setQuick] = useState(null);
  const [status, setStatus] = useState("all");

  const fetchAll = useCallback(async () => {
    const [p, it, inv] = await Promise.all([
      supabase.from("monitoring_projects").select(PROJECT_SELECT).order("created_at", { ascending: false }),
      supabase.from("monitoring_items").select("id, project_id, kind, parent_id, title, status, due_date, invoice_on_completion"),
      supabase.from("client_invoices").select("id, project_id, status, total_amount, payment_amount, lines:client_invoice_lines(item_id)"),
    ]);
    if (p.error) setError(p.error.message);
    setProjects(p.data || []);
    setItems(it.data || []);
    setInvoices(inv.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { syncDueAlerts().then(fetchAll); }, [fetchAll]);

  const rows = useMemo(() => projects.map((p) => {
    const its = items.filter((i) => i.project_id === p.id);
    const invs = invoices.filter((i) => i.project_id === p.id);
    const open = its.filter((i) => i.status !== "completed" && i.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
    // A completed project has no deadlines left to chase.
    const live = p.status !== "completed";
    return {
      ...p,
      total: its.length,
      done: its.filter((i) => i.status === "completed").length,
      overdue: live ? its.filter((i) => itemTiming(i) === "overdue").length : 0,
      dueSoon: live ? its.filter((i) => itemTiming(i) === "due_soon").length : 0,
      toInvoice: its.filter((i) => needsInvoice(i, invs, its)).length,
      nextDue: live ? open[0] || null : null,
      outstanding: invs.filter((i) => i.status === "raised").reduce((s, i) => s + Number(i.total_amount || 0), 0),
    };
  }), [projects, items, invoices]);

  // Team-scoped roles see only their active team, same as Proposals.
  const teamScoped = useMemo(
    () => (can.viewAllTeams(profile?.role) || !activeTeam ? rows : rows.filter((r) => r.lead?.team === activeTeam)),
    [rows, profile?.role, activeTeam]
  );

  const stats = useMemo(
    () => Object.fromEntries(Object.entries(QUICK_FILTERS).map(([k, f]) => [k, teamScoped.filter(f.match).length])),
    [teamScoped]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return teamScoped.filter((r) => {
      if (quick && !QUICK_FILTERS[quick].match(r)) return false;
      if (status !== "all" && r.status !== status) return false;
      if (!s) return true;
      return [r.lead?.title, r.lead?.lead_number, r.lead?.client_name, r.lead?.ba?.full_name].some((v) => (v || "").toLowerCase().includes(s));
    });
  }, [teamScoped, quick, status, search]);

  if (loading) return <PageLoader text="Loading projects…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="pp-page animate-fadeUp">
          <div className="page-header">
            <div className="page-title-row">
              <div>
                <h1>Monitoring</h1>
                <p>Awarded projects — MoUs, milestones, deliverables and their deadlines.</p>
              </div>
            </div>
          </div>

          {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

          <div className="pp-stats-grid">
            {[
              ["all", "pp-stat-blue"], ["overdue", "pp-stat-red"], ["due_soon", "pp-stat-purple"], ["to_invoice", "pp-stat-green"],
            ].map(([key, color]) => (
              <button
                key={key}
                type="button"
                className={`pp-stat-card ${color}${quick === key ? " pp-stat-active" : ""}`}
                onClick={() => setQuick((q) => (q === key ? null : key))}
              >
                <div className="pp-stat-value">{stats[key]}</div>
                <div className="pp-stat-label">{QUICK_FILTERS[key].label}</div>
              </button>
            ))}
          </div>

          <Card className="pp-filter-card">
            <Card.Body className="pp-filters">
              <input type="text" className="input pp-search" placeholder="Search by project, lead number, client, or BP…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div style={{ minWidth: 170 }}>
                <Select options={STATUS_OPTIONS} value={status} onChange={setStatus} />
              </div>
            </Card.Body>
          </Card>

          <Card>
            {filtered.length === 0 ? (
              <div className="pp-empty">
                {teamScoped.length === 0 ? "No projects in Monitoring yet — a proposal appears here once it's recorded as Awarded." : "No projects match these filters."}
              </div>
            ) : (
              <div className="pp-table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Project</th><th>Client</th><th>BP</th><th>Contract Value</th><th>Progress</th><th>Next Due</th><th>Attention</th><th>Status</th><th aria-label="Open" /></tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => {
                      const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
                      return (
                        <tr key={r.id} className="pp-row-clickable" onClick={() => navigate(`/monitoring/${r.id}`)}>
                          <td>
                            <div className="mon-cell-title">{r.lead?.title}</div>
                            <div className="pp-td-muted mon-cell-sub">{r.lead?.lead_number}</div>
                          </td>
                          <td>{r.lead?.client_name || <span className="pp-td-muted">—</span>}</td>
                          <td className="pp-td-muted">{r.lead?.ba?.full_name || "—"}</td>
                          <td>{formatINR(r.contract_value, { decimals: false })}</td>
                          <td>
                            {r.total ? (
                              <div className="mon-mini-progress" title={`${r.done} of ${r.total} complete`}>
                                <div className="mon-progress-bar"><span style={{ width: `${pct}%` }} /></div>
                                <span>{r.done}/{r.total}</span>
                              </div>
                            ) : <span className="pp-td-muted">Not planned</span>}
                          </td>
                          <td className={r.nextDue && itemTiming(r.nextDue) === "overdue" ? "pp-td-date--overdue" : ""}>
                            {r.nextDue ? fmtDate(r.nextDue.due_date) : <span className="pp-td-muted">—</span>}
                          </td>
                          <td>
                            <div className="mon-attn">
                              {r.overdue > 0 && <span className="mon-tag is-overdue">{r.overdue} overdue</span>}
                              {r.toInvoice > 0 && <span className="mon-tag is-overdue">{r.toInvoice} to invoice</span>}
                              {r.dueSoon > 0 && <span className="mon-tag is-due_soon">{r.dueSoon} due soon</span>}
                              {r.outstanding > 0 && <span className="mon-tag is-billable">{formatINR(r.outstanding, { decimals: false })} unpaid</span>}
                              {!r.overdue && !r.toInvoice && !r.dueSoon && !r.outstanding && <span className="pp-td-muted">—</span>}
                            </div>
                          </td>
                          <td><Badge variant={PROJECT_STATUS_VARIANTS[r.status]}>{PROJECT_STATUS_LABELS[r.status]}</Badge></td>
                          <td><span className="pp-icon-btn" aria-hidden="true"><ArrowRightIcon /></span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
