import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { ROLE_LABELS } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import Input from "../../components/ui/Input";
import PageLoader from "../../components/ui/PageLoader";
import FilterDrawer, { FilterButton, FilterField } from "../../components/ui/FilterDrawer";
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

// Empanelment pipeline actions log to a separate table
// (empanelment_activity_log) — different action vocabulary, so its own
// meta map rather than merging into ACTION_META above.
const EMP_ACTION_META = {
  po_forwarded:              { label: "PO Forwarded to CFO/CS",  variant: "info" },
  cfo_reviewed:               { label: "CFO Reviewed",            variant: "info" },
  cs_reviewed:                { label: "CS Reviewed",             variant: "info" },
  po_resent_cfo_cs:           { label: "PO Sent Back to CFO/CS",  variant: "warning" },
  po_final_forwarded:         { label: "PO Forwarded to DGM",     variant: "info" },
  dgm_recommended:            { label: "DGM Recommended to MD",   variant: "info" },
  dgm_sent_back:               { label: "DGM Sent Back to PO",     variant: "warning" },
  dgm_rejected:                { label: "DGM Rejected",            variant: "danger" },
  md_sent_back:                { label: "MD Sent Back to DGM",     variant: "warning" },
  md_rejected:                 { label: "MD Rejected",             variant: "danger" },
  md_accepted:                 { label: "MD Accepted",             variant: "success" },
  md_accepted_email_failed:    { label: "MD Accepted (email failed)", variant: "warning" },
  hold_raised:                 { label: "Compliance Hold Raised",  variant: "warning" },
  ba_corrected:                { label: "BA Submitted Correction", variant: "info" },
  provisional_letter_sent:     { label: "Provisional Letter Sent", variant: "success" },
};
const EMP_ACTION_OPTIONS = [
  { value: "all", label: "All Actions" },
  ...Object.entries(EMP_ACTION_META).map(([k, v]) => ({ value: k, label: v.label })),
];
const EMP_ROLE_OPTIONS = [
  { value: "all", label: "All Roles" },
  ...Object.entries(ROLE_LABELS).map(([k, v]) => ({ value: k, label: v })),
  { value: "ba", label: "Business Associate" },
];

const PAGE_SIZE = 20;

function ActionBadge({ action, meta }) {
  const m = meta[action];
  if (!m) return <span className="al-action-raw">{action?.replace(/_/g, " ")}</span>;
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

const TABS = [
  { key: "account", label: "Account Management" },
  { key: "empanelment", label: "Empanelment Activity" },
];

export default function AuditLogsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("account");

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [banner, setBanner] = useState("");
  const [search, setSearch] = useState("");
  const [filterAction, setFilterAction] = useState("all");
  const [filterRole, setFilterRole] = useState("all");
  const [filterDate, setFilterDate] = useState("");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const isEmp = tab === "empanelment";
  const actionOptions = isEmp ? EMP_ACTION_OPTIONS : ACTION_OPTIONS;
  const roleOptions = isEmp ? EMP_ROLE_OPTIONS : ROLE_OPTIONS;
  const actionMeta = isEmp ? EMP_ACTION_META : ACTION_META;

  const activeFilterCount = [filterAction !== "all", filterRole !== "all", !!filterDate].filter(Boolean).length;

  const fetchAccountLogs = useCallback(async (currentPage, opts) => {
    let query = supabase
      .from("application_audit_log")
      .select("*, actor:action_by(full_name, role, team, office)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (opts.action !== "all") query = query.eq("action", opts.action);
    if (opts.role !== "all") query = query.eq("action_by_role", opts.role);
    if (opts.date) query = query.gte("created_at", opts.date + "T00:00:00").lte("created_at", opts.date + "T23:59:59");
    if (opts.search.trim()) query = query.ilike("comment", `%${opts.search.trim()}%`);
    return query;
  }, []);

  const fetchEmpLogs = useCallback(async (currentPage, opts) => {
    let query = supabase
      .from("empanelment_activity_log")
      .select("*, actor:actor_id(full_name, team), application:application_id(application_code, ba_email)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

    if (opts.action !== "all") query = query.eq("action", opts.action);
    if (opts.role !== "all") query = query.eq("actor_role", opts.role);
    if (opts.date) query = query.gte("created_at", opts.date + "T00:00:00").lte("created_at", opts.date + "T23:59:59");
    if (opts.search.trim()) query = query.ilike("comment", `%${opts.search.trim()}%`);
    return query;
  }, []);

  const fetchLogs = useCallback(
    async (currentPage, opts) => {
      setLoading(true);
      const { data, error, count } = await (isEmp ? fetchEmpLogs(currentPage, opts) : fetchAccountLogs(currentPage, opts));
      if (error) setBanner(error.message);
      else {
        setLogs(data || []);
        setTotal(count || 0);
      }
      setLoading(false);
    },
    [isEmp, fetchAccountLogs, fetchEmpLogs]
  );

  useEffect(() => {
    fetchLogs(page, { action: filterAction, role: filterRole, date: filterDate, search });
  }, [fetchLogs, page, filterAction, filterRole, filterDate, search]);

  useEffect(() => {
    setPage(0);
  }, [filterAction, filterRole, filterDate, search]);

  // Switching tabs resets the filters — the two logs have different action
  // and role vocabularies, so a carried-over "all" value can be stale but a
  // specific one (e.g. action=user_created) wouldn't mean anything on the
  // other tab.
  function switchTab(key) {
    setTab(key);
    setFilterAction("all");
    setFilterRole("all");
    setFilterDate("");
    setSearch("");
    setPage(0);
  }

  function clearFilters() {
    setFilterAction("all");
    setFilterRole("all");
    setFilterDate("");
  }

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const hasNextPage = to < total;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <h1>Audit Logs</h1>
          <p>Complete history of account-management and empanelment pipeline actions across the system.</p>
        </div>

        <div className="al-tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={`al-tab${tab === t.key ? " al-tab-active" : ""}`} onClick={() => switchTab(t.key)}>
              {t.label}
            </button>
          ))}
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
            <FilterButton onClick={() => setFilterDrawerOpen(true)} activeCount={activeFilterCount} />
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
                      {isEmp ? <th>Application</th> : <th>Team</th>}
                      <th>Action</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className={isEmp && log.application_id ? "al-row-clickable" : ""}
                        onClick={isEmp && log.application_id ? () => navigate(`/empanelment/${log.application_id}`) : undefined}
                      >
                        <td className="al-date-cell">
                          <span className="al-date">
                            {new Date(log.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                          <span className="al-time">
                            {new Date(log.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </td>
                        <td className="al-actor">{log.actor?.full_name || (isEmp ? "Business Associate" : "—")}</td>
                        <td>
                          <Badge variant="info">{ROLE_LABELS[isEmp ? log.actor_role : log.action_by_role] || (isEmp ? log.actor_role : log.action_by_role) || "—"}</Badge>
                        </td>
                        {isEmp ? (
                          <td className="al-team">{log.application?.application_code || "—"}</td>
                        ) : (
                          <td className="al-team">{log.actor?.team || "—"}</td>
                        )}
                        <td>
                          <ActionBadge action={log.action} meta={actionMeta} />
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
                  <div
                    key={log.id}
                    className="al-mobile-card"
                    onClick={isEmp && log.application_id ? () => navigate(`/empanelment/${log.application_id}`) : undefined}
                  >
                    <div className="al-mobile-card-top">
                      <span className="al-actor">{log.actor?.full_name || (isEmp ? "Business Associate" : "—")}</span>
                      <ActionBadge action={log.action} meta={actionMeta} />
                    </div>
                    <div className="al-mobile-card-meta">
                      <span className="al-date">
                        {new Date(log.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                        {new Date(log.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <Badge variant="info">{ROLE_LABELS[isEmp ? log.actor_role : log.action_by_role] || (isEmp ? log.actor_role : log.action_by_role) || "—"}</Badge>
                      {isEmp && log.application?.application_code && <span className="text-xs text-tertiary">{log.application.application_code}</span>}
                      {!isEmp && log.actor?.team && <span className="text-xs text-tertiary">{log.actor.team}</span>}
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

      <FilterDrawer open={filterDrawerOpen} onClose={() => setFilterDrawerOpen(false)} onReset={clearFilters}>
        <FilterField label="Action">
          <Select options={actionOptions} value={filterAction} onChange={setFilterAction} placeholder="All Actions" />
        </FilterField>
        <FilterField label="Role">
          <Select options={roleOptions} value={filterRole} onChange={setFilterRole} placeholder="All Roles" />
        </FilterField>
        <FilterField label="Date">
          <input
            type="date"
            className="input"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />
        </FilterField>
      </FilterDrawer>
    </div>
  );
}
