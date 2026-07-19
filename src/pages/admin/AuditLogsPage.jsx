import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { ROLE_LABELS } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import Input from "../../components/ui/Input";
import PageLoader from "../../components/ui/PageLoader";
import "../../styles/AuditLogsPage.css";

const ACTION_META = {
  user_created:              { label: "User Created",       variant: "success" },
  user_created_email_failed: { label: "User Created (email failed)", variant: "warning" },
  user_activated:            { label: "User Activated",     variant: "success" },
  user_deactivated:          { label: "User Deactivated",   variant: "danger" },
};

const ACTION_OPTIONS = [
  { value: "all", label: "All Actions" },
  ...Object.entries(ACTION_META).map(([k, v]) => ({ value: k, label: v.label })),
];
const ROLE_OPTIONS = [
  { value: "all", label: "All Roles" },
  ...Object.entries(ROLE_LABELS).map(([k, v]) => ({ value: k, label: v })),
];
const PAGE_SIZE = 20;

function ActionBadge({ action }) {
  const meta = ACTION_META[action];
  if (!meta) return <span className="al-action-raw">{action?.replace(/_/g, " ")}</span>;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [banner, setBanner] = useState("");
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("all");
  const [filterRole, setFilterRole] = useState("all");
  const [filterDate, setFilterDate] = useState("");

  const hasActiveFilters = filterAction !== "all" || filterRole !== "all" || !!filterDate || !!search;

  const fetchLogs = useCallback(async (currentPage, opts) => {
    setLoading(true);
    let query = supabase
      .from("application_audit_log")
      .select("*, actor:action_by(full_name, role, team, office)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (opts.action !== "all") query = query.eq("action", opts.action);
    if (opts.role !== "all") query = query.eq("action_by_role", opts.role);
    if (opts.date) query = query.gte("created_at", opts.date + "T00:00:00").lte("created_at", opts.date + "T23:59:59");
    if (opts.search.trim()) query = query.ilike("comment", `%${opts.search.trim()}%`);

    const { data, error, count } = await query;
    if (error) setBanner(error.message);
    else {
      setLogs(data || []);
      setTotal(count || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs(page, { action: filterAction, role: filterRole, date: filterDate, search });
  }, [fetchLogs, page, filterAction, filterRole, filterDate, search]);

  useEffect(() => {
    setPage(0);
  }, [filterAction, filterRole, filterDate, search]);

  function clearFilters() {
    setFilterAction("all");
    setFilterRole("all");
    setFilterDate("");
    setSearch("");
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const hasNextPage = to < total;

  if (loading && page === 0 && logs.length === 0 && !hasActiveFilters) return <PageLoader text="Loading audit logs…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <h1>Audit Logs</h1>
          <p>Complete history of account-management actions across the system.</p>
        </div>

        {banner && (
          <div className="text-danger text-sm" style={{ marginBottom: "var(--space-4)" }}>
            {banner}
          </div>
        )}

        <Card>
          <Card.Body className="al-filter-row">
            <Input
              className="al-search-input"
              placeholder="Search by comment…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select options={ACTION_OPTIONS} value={filterAction} onChange={setFilterAction} placeholder="All Actions" className="al-filter-select" />
            <Select options={ROLE_OPTIONS} value={filterRole} onChange={setFilterRole} placeholder="All Roles" className="al-filter-select" />
            <input
              type="date"
              className="input al-date-input"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </Card.Body>
        </Card>

        <Card>
          {loading ? (
            <div className="al-empty">Loading…</div>
          ) : logs.length === 0 ? (
            <div className="al-empty">No logs found.</div>
          ) : (
            <>
              <div className="table-wrapper al-desktop-table">
                <table className="table al-table">
                  <thead>
                    <tr>
                      <th>Date &amp; Time</th>
                      <th>Actor</th>
                      <th>Role</th>
                      <th>Team</th>
                      <th>Action</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td className="al-date-cell">
                          <span className="al-date">
                            {new Date(log.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          <span className="al-time">
                            {new Date(log.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </td>
                        <td className="al-actor">{log.actor?.full_name || "—"}</td>
                        <td>
                          <Badge variant="info">{ROLE_LABELS[log.action_by_role] || log.action_by_role || "—"}</Badge>
                        </td>
                        <td className="al-team">{log.actor?.team || "—"}</td>
                        <td>
                          <ActionBadge action={log.action} />
                        </td>
                        <td className="al-comment" title={log.comment || ""}>
                          {log.comment ? <span className="al-comment-text">{log.comment}</span> : <span className="al-comment-empty">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="al-mobile-list">
                {logs.map((log) => (
                  <div key={log.id} className="al-mobile-card">
                    <div className="al-mobile-card-top">
                      <span className="al-actor">{log.actor?.full_name || "—"}</span>
                      <ActionBadge action={log.action} />
                    </div>
                    <div className="al-mobile-card-meta">
                      <span className="al-date">
                        {new Date(log.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                        {new Date(log.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <Badge variant="info">{ROLE_LABELS[log.action_by_role] || log.action_by_role || "—"}</Badge>
                      {log.actor?.team && <span className="text-xs text-tertiary">{log.actor.team}</span>}
                    </div>
                    {log.comment && <div className="al-comment-text">{log.comment}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
          {total > 0 && (
            <Card.Footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
              <span className="text-sm text-secondary">
                Showing {from}–{to} of {total}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={!hasNextPage || loading} onClick={() => setPage((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </Card.Footer>
          )}
        </Card>
      </div>
    </div>
  );
}
