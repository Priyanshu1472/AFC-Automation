import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { leadCan, isActionRequiredForViewer } from "../../lib/leadPermissions";
import { can } from "../../lib/roles";
import { useTeamOptions } from "../../hooks/useTeamOptions";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import PageLoader from "../../components/ui/PageLoader";
import FilterDrawer, { FilterButton, FilterField } from "../../components/ui/FilterDrawer";
import { EyeIcon, ChatIcon, PencilIcon, TrashIcon, ArrowRightIcon } from "../../components/icons";
import { STATUS_MAP } from "../../components/leads/leadStatus";
import { canOpenProposal } from "../../lib/proposalPrep";
import "../../styles/LeadListPage.css";

const STATUS_OPTIONS = [{ value: "all", label: "All Statuses" }, ...Object.entries(STATUS_MAP).map(([value, cfg]) => ({ value, label: cfg.label }))];
const PAGE_SIZE = 20;

// "Action Required" depends on who's looking — a PMT member's queue is
// pmt_review leads (org-wide), a PA-tier owner's is their own pa_review/
// pa_action_required leads, etc. See isActionRequiredForViewer.
const QUICK_FILTERS = {
  all: { label: "Total", match: () => true },
  in_review: {
    label: "In Review",
    match: (l) => ["pa_review", "dgm_initial_review", "pmt_review", "pmt_extended_review", "dgm_review", "md_review"].includes(l.status),
  },
  action_required: { label: "Action Required", match: (l, profile) => isActionRequiredForViewer(profile, l) },
  approved: { label: "Approved", match: (l) => l.status === "md_approved" },
};

function StatusBadge({ status }) {
  const cfg = STATUS_MAP[status] || { label: status, variant: "neutral" };
  return <Badge variant={cfg.variant} dot>{cfg.label}</Badge>;
}

function fmt(v) {
  return v === null || v === undefined || v === "" ? "—" : v;
}
function fmtDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Restores search/filter/page state after a trip out to a lead's detail
// page and back — sessionStorage rather than the URL, since "Back to
// Leads" pushes a bare /leads (see LeadDetailPage's back button), and this
// survives that regardless of how the user actually navigates back.
const FILTER_STORAGE_KEY = "leadListFilters";
function loadStoredFilters() {
  try {
    return JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function LeadListPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  // { [lead_id]: unread_count } for the current viewer, across every lead
  // they're a chat participant on — powers the badge on the chat icon.
  const [unreadCounts, setUnreadCounts] = useState({});
  const [search, setSearch] = useState(() => loadStoredFilters().search || "");
  const [quickFilter, setQuickFilter] = useState(() => loadStoredFilters().quickFilter || "all");
  const [statusFilter, setStatusFilter] = useState(() => loadStoredFilters().statusFilter || "all");
  const [teamFilter, setTeamFilter] = useState(() => loadStoredFilters().teamFilter || "all");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [page, setPage] = useState(() => loadStoredFilters().page || 1);

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ search, quickFilter, statusFilter, teamFilter, page }));
    } catch {
      // Private browsing / storage disabled — filters just won't persist.
    }
  }, [search, quickFilter, statusFilter, teamFilter, page]);

  const canFilterTeam = can.viewAllTeams(profile?.role);
  const teams = useTeamOptions();
  const teamOptions = [{ value: "all", label: "All Teams" }, ...teams.map((t) => ({ value: t, label: t }))];

  const fetchLeads = useCallback(async () => {
    // RLS (can_view_lead) scopes visible rows per role/team/committee/
    // assignment — no client-side team filter needed, same convention as
    // Empanelment.
    const { data } = await supabase
      .from("leads")
      .select("*, creator:created_by(full_name), assignee:person_responsible_id(full_name)")
      .order("created_at", { ascending: false });
    setLeads(data || []);
    setLoading(false);
  }, []);

  const fetchUnreadCounts = useCallback(async () => {
    const { data } = await supabase.rpc("lead_chat_unread_counts");
    const map = {};
    for (const row of data || []) map[row.lead_id] = row.unread_count;
    setUnreadCounts(map);
  }, []);

  useEffect(() => {
    fetchLeads();
    fetchUnreadCounts();
  }, [fetchLeads, fetchUnreadCounts]);

  useEffect(() => {
    const channel = supabase
      .channel("leads-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => fetchLeads())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lead_chat_messages" }, () => fetchUnreadCounts())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchLeads, fetchUnreadCounts]);

  const stats = useMemo(() => {
    const result = {};
    for (const [key, cfg] of Object.entries(QUICK_FILTERS)) {
      result[key] = leads.filter((l) => cfg.match(l, profile)).length;
    }
    return result;
  }, [leads, profile]);

  function selectQuickFilter(key) {
    // Clicking the active card again clears it back to Total.
    setQuickFilter((current) => (current === key ? "all" : key));
    setStatusFilter("all");
    setPage(1);
  }

  function selectStatusFilter(value) {
    setStatusFilter(value);
    setQuickFilter("all");
    setPage(1);
  }

  function selectTeamFilter(value) {
    setTeamFilter(value);
    setPage(1);
  }

  // Search runs over every matching lead, not just the current page — the
  // page slice below is purely a display concern.
  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch =
      (l.lead_number || "").toLowerCase().includes(q) ||
      (l.title || "").toLowerCase().includes(q) ||
      (l.client_name || "").toLowerCase().includes(q) ||
      (l.creator?.full_name || "").toLowerCase().includes(q);
    return (
      matchSearch &&
      QUICK_FILTERS[quickFilter].match(l, profile) &&
      (statusFilter === "all" || l.status === statusFilter) &&
      (teamFilter === "all" || l.team === teamFilter)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const canCreate = leadCan.create(profile);

  if (loading) return <PageLoader text="Loading leads…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>{profile?.role === "md" || profile?.role === "admin" ? "All Leads" : "My Leads"}</h1>
            </div>
            {canCreate && <Button variant="primary" onClick={() => navigate("/leads/create")}>+ Add Lead</Button>}
          </div>
        </div>

        <div className="ll-stats-grid">
          <button
            type="button"
            className={`ll-stat-card ll-stat-blue${quickFilter === "all" ? " ll-stat-active" : ""}`}
            onClick={() => selectQuickFilter("all")}
          >
            <div className="ll-stat-value">{stats.all}</div>
            <div className="ll-stat-label">Total</div>
          </button>
          <button
            type="button"
            className={`ll-stat-card ll-stat-purple${quickFilter === "in_review" ? " ll-stat-active" : ""}`}
            onClick={() => selectQuickFilter("in_review")}
          >
            <div className="ll-stat-value">{stats.in_review}</div>
            <div className="ll-stat-label">In Review</div>
          </button>
          <button
            type="button"
            className={`ll-stat-card ll-stat-amber${quickFilter === "action_required" ? " ll-stat-active" : ""}`}
            onClick={() => selectQuickFilter("action_required")}
          >
            <div className="ll-stat-value">{stats.action_required}</div>
            <div className="ll-stat-label">Action Required</div>
          </button>
          <button
            type="button"
            className={`ll-stat-card ll-stat-green${quickFilter === "approved" ? " ll-stat-active" : ""}`}
            onClick={() => selectQuickFilter("approved")}
          >
            <div className="ll-stat-value">{stats.approved}</div>
            <div className="ll-stat-label">Approved</div>
          </button>
        </div>

        <Card className="ll-filter-card">
          <Card.Body className="ll-filters">
            <input
              type="text"
              className="input ll-search"
              placeholder="Search by lead number, title, client, creator…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            {canFilterTeam && (
              <div style={{ minWidth: 160 }}>
                <Select options={teamOptions} value={teamFilter} onChange={selectTeamFilter} placeholder="All Teams" />
              </div>
            )}
            <FilterButton onClick={() => setFilterDrawerOpen(true)} activeCount={statusFilter !== "all" ? 1 : 0} />
          </Card.Body>
        </Card>

        <Card>
          {filtered.length === 0 ? (
            <div className="ll-empty"><p>No leads found.</p></div>
          ) : (
            <div className="ll-table-scroll">
              <table className="table ll-table">
                <thead>
                  <tr>
                    <th>Lead Number</th><th>Title</th><th>Creator</th>{canFilterTeam && <th>Team</th>}
                    <th>Person Responsible</th><th>Status</th><th>Created</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((l) => (
                    <tr key={l.id}>
                      <td><span className="ll-lead-number">{l.lead_number}</span></td>
                      <td className="ll-title" title={l.title}>{fmt(l.title)}</td>
                      <td>{fmt(l.creator?.full_name)}</td>
                      {canFilterTeam && <td>{l.team ? <Badge variant="neutral">{l.team}</Badge> : "—"}</td>}
                      <td>{fmt(l.assignee?.full_name)}</td>
                      <td><StatusBadge status={l.status} /></td>
                      <td className="ll-date">{fmtDate(l.created_at)}</td>
                      <td>
                        <div className="ll-action-icons">
                          <button type="button" className="ll-icon-btn" title="View" aria-label="View lead" onClick={() => navigate(`/leads/${l.id}`)}>
                            <EyeIcon />
                          </button>
                          {l.chat_opened_at && (
                            <button
                              type="button"
                              className="ll-icon-btn ll-icon-chat"
                              title="Discussion"
                              aria-label={unreadCounts[l.id] > 0 ? `Discussion, ${unreadCounts[l.id]} unread` : "Discussion"}
                              onClick={() => navigate(`/leads/${l.id}`)}
                            >
                              <ChatIcon />
                              {unreadCounts[l.id] > 0 && (
                                <span className="ll-icon-badge">{unreadCounts[l.id] > 9 ? "9+" : unreadCounts[l.id]}</span>
                              )}
                            </button>
                          )}
                          {leadCan.editResubmit(profile, l) && (
                            <button type="button" className="ll-icon-btn" title="Edit" aria-label="Edit lead" onClick={() => navigate(`/leads/${l.id}/edit`)}>
                              <PencilIcon />
                            </button>
                          )}
                          {leadCan.drop(profile, l) && (
                            <button type="button" className="ll-icon-btn ll-icon-danger" title="Drop" aria-label="Drop lead" onClick={() => navigate(`/leads/${l.id}`)}>
                              <TrashIcon />
                            </button>
                          )}
                          {l.status === "md_approved" && canOpenProposal(l, profile) && (
                            <button type="button" className="ll-icon-btn" title="Open Proposal" aria-label="Open proposal" onClick={() => navigate(`/proposals/${l.id}`)}>
                              <ArrowRightIcon />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="ll-pagination">
          <p className="ll-record-count">
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} leads
          </p>
          {totalPages > 1 && (
            <div className="ll-pagination-controls">
              <Button variant="secondary" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                ← Previous
              </Button>
              <span className="ll-pagination-page">Page {currentPage} of {totalPages}</span>
              <Button variant="secondary" size="sm" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>
                Next →
              </Button>
            </div>
          )}
        </div>
      </div>

      <FilterDrawer open={filterDrawerOpen} onClose={() => setFilterDrawerOpen(false)} onReset={() => setStatusFilter("all")}>
        <FilterField label="Status">
          <Select options={STATUS_OPTIONS} value={statusFilter} onChange={selectStatusFilter} placeholder="All Statuses" />
        </FilterField>
      </FilterDrawer>
    </div>
  );
}
