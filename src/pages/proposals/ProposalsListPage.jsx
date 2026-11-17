// Proposal Prep landing page — every MD-approved lead visible to the
// caller (RLS-scoped via can_view_lead, same as LeadListPage), with a
// quick look at lock/outcome state. "Open" only appears for md/admin or
// the lead's three assignees, same rule as LeadListPage/LeadDetailPage's
// row action — this page exists so that rule has somewhere to be browsed
// from besides the Leads table itself.
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useTeamOptions } from "../../hooks/useTeamOptions";
import { can } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Select from "../../components/ui/Select";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import FilterDrawer, { FilterButton, FilterField } from "../../components/ui/FilterDrawer";
import { ChatIcon, ArrowRightIcon, ActivityIcon } from "../../components/icons";
import { CLIENT_RESPONSE_LABELS, CLIENT_RESPONSE_VARIANTS, canOpenProposal, isAccountsCommittee, isMyProposal, isTeamProposal } from "../../lib/proposalPrep";
import "../../styles/ProposalPreparationPage.css";

// "In Preparation" covers both "no proposal_preparations row yet" and "row
// exists but the client hasn't responded" — i.e. everything that isn't yet
// a final outcome. "Accepted" reads client_response === "awarded" (the
// underlying field's own value/label, per CLIENT_RESPONSE_LABELS) since
// that's this app's term for a proposal the client accepted.
const QUICK_FILTERS = {
  all: { label: "Total", match: () => true },
  in_preparation: { label: "In Preparation", match: (l) => (l.proposal?.client_response || "pending") === "pending" },
  accepted: { label: "Accepted", match: (l) => l.proposal?.client_response === "awarded" },
  rejected: { label: "Rejected", match: (l) => l.proposal?.client_response === "rejected" },
  // Accounts Committee only: an approved note still to be paid, or an EMD
  // refund / PBG forwarded for verification.
  accounts: { label: "Pending with Accounts", match: (l) => !!accountsPendingOf(l) },
};

function accountsPendingOf(l) {
  if (l.feeNote?.status === "approved" && l.feeNote?.payment_status !== "paid") return "Payment Due";
  if (l.emd?.status === "pending_accounts") return l.emd.track === "pbg" ? "PBG with Accounts" : "EMD Verification";
  if (l.pbgNote?.status === "pending_accounts") return "PBG Note Review";
  if (l.pbgNote?.status === "pending_payment") return "PBG Payment Due";
  return null;
}

// What the EMD is waiting on, for the lead's own team.
function emdBadgeOf(l) {
  if (l.pbgNote?.status === "completed") return { label: "PBG Done", variant: "success" };
  if (l.pbgNote && ["pending_ra", "pending_md"].includes(l.pbgNote.status)) return { label: "PBG Note in Approval", variant: "warning" };
  if (!l.emd) return null;
  if (l.emd.status === "completed") return { label: l.emd.track === "pbg" ? "PBG Done" : "EMD Refunded", variant: "success" };
  if (l.emd.status === "pending") return { label: "EMD Refund Pending", variant: "warning" };
  if (l.emd.status === "awaiting_completion") return { label: "EMD on Completion", variant: "neutral" };
  return null;
}

const PREP_STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "locked", label: "Locked" },
];

function prepStatusOf(l) {
  if (!l.proposal) return "not_started";
  return l.proposal.locked ? "locked" : "in_progress";
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function ProposalsListPage() {
  const navigate = useNavigate();
  const { profile, activeTeam } = useAuth();

  const [leads, setLeads] = useState([]);
  const [proposalByLead, setProposalByLead] = useState({});
  const [monitoringByProposal, setMonitoringByProposal] = useState({});
  const [feeNoteByProposal, setFeeNoteByProposal] = useState({});
  const [emdByProposal, setEmdByProposal] = useState({});
  const [pbgByProposal, setPbgByProposal] = useState({});
  const [additionalByLead, setAdditionalByLead] = useState({});
  const [unreadCounts, setUnreadCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [prepStatusFilter, setPrepStatusFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const canFilterTeam = can.viewAllTeams(profile?.role);
  const isAccounts = isAccountsCommittee(profile);
  const teams = useTeamOptions();
  const teamOptions = [{ value: "all", label: "All Teams" }, ...teams.map((t) => ({ value: t, label: t }))];

  // "My Proposals" / "Team Proposals" / "Organization Proposals" — every
  // user gets all three (unlike LeadListPage's role-gated "All Leads"), but
  // a role with no team and never personally named on a lead (md/cfo/cs/
  // admin, and Accounts Committee members) would land on an empty "My
  // Proposals" AND an empty "Team Proposals" — default those straight to
  // Organization instead of a tab that's always blank for them.
  const defaultsToOrg = ["md", "cfo", "cs", "admin"].includes(profile?.role) || isAccounts;
  const [view, setView] = useState(defaultsToOrg ? "organization" : "mine");

  const fetchAll = useCallback(async () => {
    const { data: leadRows, error: err } = await supabase
      .from("leads")
      .select("*, pr:person_responsible_id(full_name), ba:assigned_ba_id(full_name)")
      .eq("status", "md_approved")
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    const rows = leadRows || [];
    setLeads(rows);

    const leadIds = rows.map((l) => l.id);
    const { data: proposalRows } = leadIds.length
      ? await supabase.from("proposal_preparations").select("*").in("lead_id", leadIds)
      : { data: [] };

    const propByLead = Object.fromEntries((proposalRows || []).map((p) => [p.lead_id, p]));
    setProposalByLead(propByLead);

    const proposalIds = (proposalRows || []).map((p) => p.id);
    const [{ data: noteRows }, { data: emdRows }, { data: additionalRows }, { data: pbgRows }] = proposalIds.length
      ? await Promise.all([
        supabase.from("fee_notes").select("proposal_id, status, payment_status").in("proposal_id", proposalIds),
        supabase.from("proposal_emd_tracking").select("proposal_id, track, status").in("proposal_id", proposalIds),
        supabase.from("proposal_additional_responsibles").select("proposal_id, user_id").in("proposal_id", proposalIds),
        supabase.from("proposal_pbg_notes").select("proposal_id, status").in("proposal_id", proposalIds),
      ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
    setPbgByProposal(Object.fromEntries((pbgRows || []).map((n) => [n.proposal_id, n])));
    setFeeNoteByProposal(Object.fromEntries((noteRows || []).map((n) => [n.proposal_id, n])));
    setEmdByProposal(Object.fromEntries((emdRows || []).map((t) => [t.proposal_id, t])));

    // Keyed by lead id (not proposal id) so isMyProposal can look it up
    // alongside the lead row directly.
    const proposalIdToLeadId = Object.fromEntries((proposalRows || []).map((p) => [p.id, p.lead_id]));
    const additionalByLeadNext = {};
    for (const r of additionalRows || []) {
      const leadId = proposalIdToLeadId[r.proposal_id];
      if (!leadId) continue;
      (additionalByLeadNext[leadId] ||= []).push(r.user_id);
    }
    setAdditionalByLead(additionalByLeadNext);

    const awardedIds = (proposalRows || []).filter((p) => p.client_response === "awarded").map((p) => p.id);
    const { data: monitoringRows } = awardedIds.length
      ? await supabase.from("monitoring_projects").select("id, proposal_id").in("proposal_id", awardedIds)
      : { data: [] };
    setMonitoringByProposal(Object.fromEntries((monitoringRows || []).map((m) => [m.proposal_id, m.id])));

    setLoading(false);
  }, []);

  const fetchUnreadCounts = useCallback(async () => {
    const { data } = await supabase.rpc("proposal_chat_unread_counts");
    const map = {};
    for (const row of data || []) map[row.proposal_id] = row.unread_count;
    setUnreadCounts(map);
  }, []);

  useEffect(() => { fetchAll(); fetchUnreadCounts(); }, [fetchAll, fetchUnreadCounts]);

  useEffect(() => {
    const channel = supabase
      .channel("proposals-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_preparations" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "fee_notes" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_emd_tracking" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_pbg_notes" }, () => fetchAll())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "proposal_chat_messages" }, () => fetchUnreadCounts())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [fetchAll, fetchUnreadCounts]);

  // Proposal fields merged onto each lead row up front, so every match()/
  // filter below stays single-argument — same convention QUICK_FILTERS
  // follows on LeadListPage/EmpanelmentListPage.
  const merged = useMemo(
    () => leads.map((l) => {
      const proposal = proposalByLead[l.id] || null;
      return {
        ...l,
        proposal,
        feeNote: proposal ? feeNoteByProposal[proposal.id] || null : null,
        emd: proposal ? emdByProposal[proposal.id] || null : null,
        pbgNote: proposal ? pbgByProposal[proposal.id] || null : null,
      };
    }),
    [leads, proposalByLead, feeNoteByProposal, emdByProposal, pbgByProposal]
  );

  // My Proposals / Team Proposals / Organization Proposals — a plain
  // client-side split of whatever RLS already returned (no extra access
  // granted by "Organization"; it's the full result set the role could
  // already see, now with its own browsing tab instead of being lumped in
  // with everyone's).
  const viewScoped = useMemo(() => {
    if (view === "mine") return merged.filter((l) => isMyProposal(profile, l, additionalByLead[l.id] || []));
    if (view === "team") return merged.filter((l) => isTeamProposal(profile, l));
    return merged;
  }, [merged, view, profile, additionalByLead]);

  // Team-scoped roles (dgm/agm/srm/etc.) have no visible team filter — a
  // multi-team user's rows span every team they're on, so this needs to
  // actively narrow to whichever team is currently active, same convention
  // as LeadDashboardPage/EmpanelmentListPage. Accounts Committee members
  // work across every team. Only applies to the Organization tab — My
  // Proposals/Team Proposals are already scoped by isMyProposal/
  // isTeamProposal above, and narrowing further by a single active team
  // would contradict Team Proposals' own "every team I'm on" definition.
  const effectiveTeamFilter = canFilterTeam ? teamFilter : isAccounts ? "all" : (activeTeam || "all");

  const teamScoped = useMemo(() => {
    if (view !== "organization") return viewScoped;
    return effectiveTeamFilter === "all" ? viewScoped : viewScoped.filter((l) => l.team === effectiveTeamFilter);
  }, [viewScoped, view, effectiveTeamFilter]);

  const stats = useMemo(() => {
    const result = {};
    for (const [key, cfg] of Object.entries(QUICK_FILTERS)) result[key] = teamScoped.filter(cfg.match).length;
    return result;
  }, [teamScoped]);

  function selectQuickFilter(key) {
    setQuickFilter((current) => (current === key ? "all" : key));
  }

  // Switching tabs starts clean, same convention as LeadListPage's
  // selectView — each tab's quick/status filters, search, and team
  // narrowing never carry over from another tab.
  function selectView(nextView) {
    setView(nextView);
    setQuickFilter("all");
    setPrepStatusFilter("all");
    setSearch("");
    setTeamFilter("all");
  }

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return teamScoped.filter((l) => {
      if (!QUICK_FILTERS[quickFilter].match(l)) return false;
      if (prepStatusFilter !== "all" && prepStatusOf(l) !== prepStatusFilter) return false;
      if (!search) return true;
      return (
        (l.lead_number || "").toLowerCase().includes(s) ||
        (l.client_name || "").toLowerCase().includes(s) ||
        (l.ba?.full_name || "").toLowerCase().includes(s)
      );
    });
  }, [teamScoped, quickFilter, prepStatusFilter, search]);

  if (loading) return <PageLoader text="Loading proposals…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="pp-page animate-fadeUp">
          <div className="page-header">
            <div className="page-title-row">
              <div className="pp-view-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "mine"}
                  className={`pp-view-tab${view === "mine" ? " pp-view-tab-active" : ""}`}
                  onClick={() => selectView("mine")}
                >
                  My Proposals
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "team"}
                  className={`pp-view-tab${view === "team" ? " pp-view-tab-active" : ""}`}
                  onClick={() => selectView("team")}
                >
                  Team Proposals
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "organization"}
                  className={`pp-view-tab${view === "organization" ? " pp-view-tab-active" : ""}`}
                  onClick={() => selectView("organization")}
                >
                  Organization Proposals
                </button>
              </div>
            </div>
          </div>

          {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

          <div className={`pp-stats-grid${isAccounts ? " pp-stats-grid--5" : ""}`}>
            <button type="button" className={`pp-stat-card pp-stat-blue${quickFilter === "all" ? " pp-stat-active" : ""}`} onClick={() => selectQuickFilter("all")}>
              <div className="pp-stat-value">{stats.all}</div>
              <div className="pp-stat-label">Total</div>
            </button>
            <button type="button" className={`pp-stat-card pp-stat-purple${quickFilter === "in_preparation" ? " pp-stat-active" : ""}`} onClick={() => selectQuickFilter("in_preparation")}>
              <div className="pp-stat-value">{stats.in_preparation}</div>
              <div className="pp-stat-label">In Preparation</div>
            </button>
            <button type="button" className={`pp-stat-card pp-stat-green${quickFilter === "accepted" ? " pp-stat-active" : ""}`} onClick={() => selectQuickFilter("accepted")}>
              <div className="pp-stat-value">{stats.accepted}</div>
              <div className="pp-stat-label">Accepted</div>
            </button>
            <button type="button" className={`pp-stat-card pp-stat-red${quickFilter === "rejected" ? " pp-stat-active" : ""}`} onClick={() => selectQuickFilter("rejected")}>
              <div className="pp-stat-value">{stats.rejected}</div>
              <div className="pp-stat-label">Rejected</div>
            </button>
            {isAccounts && (
              <button type="button" className={`pp-stat-card pp-stat-amber${quickFilter === "accounts" ? " pp-stat-active" : ""}`} onClick={() => selectQuickFilter("accounts")}>
                <div className="pp-stat-value">{stats.accounts}</div>
                <div className="pp-stat-label">Pending with Accounts</div>
              </button>
            )}
          </div>

          <Card className="pp-filter-card">
            <Card.Body className="pp-filters">
              <input type="text" className="input pp-search" placeholder="Search by lead number, client, or BP…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {canFilterTeam && view === "organization" && (
                <div style={{ minWidth: 160 }}>
                  <Select options={teamOptions} value={teamFilter} onChange={setTeamFilter} placeholder="All Teams" />
                </div>
              )}
              <FilterButton onClick={() => setFilterDrawerOpen(true)} activeCount={prepStatusFilter !== "all" ? 1 : 0} />
            </Card.Body>
          </Card>

          <Card>
            {filtered.length === 0 ? (
              <div className="pp-empty">
                {view === "mine"
                  ? "You're not named on any proposal yet — Person Responsible, Reviewer, Recommending Authority, or added as an additional Person Responsible."
                  : view === "team"
                    ? "No proposals in preparation for your team yet."
                    : "No proposals in preparation yet — an approved lead will show up here."}
              </div>
            ) : (
              <div className="pp-table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Lead Number</th><th>Client</th><th>BP</th><th>Person Responsible</th><th>Submission Date</th><th>Status</th><th>Outcome</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => {
                      const proposal = l.proposal;
                      const overdue = !!l.submission_deadline && new Date(l.submission_deadline) < new Date() && !proposal?.locked;
                      const canOpen = canOpenProposal(l, profile);
                      return (
                        <tr key={l.id} className="pp-row-clickable" onClick={() => navigate(`/proposals/${l.id}`)}>
                          <td>
                            <button
                              type="button"
                              className="pp-lead-number-link"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/leads/${l.id}`);
                              }}
                            >
                              {l.lead_number}
                            </button>
                          </td>
                          <td>{l.client_name || <span className="pp-td-muted">—</span>}</td>
                          <td className="pp-td-muted">{l.ba?.full_name || "—"}</td>
                          <td className="pp-td-muted">{l.pr?.full_name || "—"}</td>
                          <td className={overdue ? "pp-td-date--overdue" : ""}>{fmtDate(l.submission_deadline)}</td>
                          <td>
                            <Badge className="pp-status-badge" variant={proposal?.locked ? "neutral" : "success"}>{proposal?.locked ? "Locked" : proposal ? "In Progress" : "Not Started"}</Badge>
                            {accountsPendingOf(l) && <Badge className="pp-status-badge pp-status-badge--extra" variant="warning">{accountsPendingOf(l)}</Badge>}
                            {!accountsPendingOf(l) && emdBadgeOf(l) && <Badge className="pp-status-badge pp-status-badge--extra" variant={emdBadgeOf(l).variant}>{emdBadgeOf(l).label}</Badge>}
                          </td>
                          <td>
                            {proposal ? (
                              <Badge className="pp-outcome-badge" variant={CLIENT_RESPONSE_VARIANTS[proposal.client_response]}>{CLIENT_RESPONSE_LABELS[proposal.client_response]}</Badge>
                            ) : (
                              <span className="pp-td-muted">—</span>
                            )}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="pp-action-icons">
                              {proposal?.chat_opened_at && (
                                <button
                                  type="button"
                                  className="pp-icon-btn pp-icon-chat"
                                  title="Discussion"
                                  aria-label={unreadCounts[proposal.id] > 0 ? `Discussion, ${unreadCounts[proposal.id]} unread` : "Discussion"}
                                  onClick={() => navigate(`/proposals/${l.id}`)}
                                >
                                  <ChatIcon />
                                  {unreadCounts[proposal.id] > 0 && (
                                    <span className="pp-icon-badge">{unreadCounts[proposal.id] > 9 ? "9+" : unreadCounts[proposal.id]}</span>
                                  )}
                                </button>
                              )}
                              {proposal && monitoringByProposal[proposal.id] && (
                                <button type="button" className="pp-icon-btn pp-icon-monitoring" title="Open Monitoring" aria-label="Open monitoring" onClick={() => navigate(`/monitoring/${monitoringByProposal[proposal.id]}`)}>
                                  <ActivityIcon />
                                </button>
                              )}
                              {canOpen ? (
                                <button type="button" className="pp-icon-btn" title="Open Proposal" aria-label="Open proposal" onClick={() => navigate(`/proposals/${l.id}`)}>
                                  <ArrowRightIcon />
                                </button>
                              ) : (
                                !proposal?.chat_opened_at && <span className="pp-td-muted">—</span>
                              )}
                            </div>
                          </td>
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

      <FilterDrawer open={filterDrawerOpen} onClose={() => setFilterDrawerOpen(false)} onReset={() => setPrepStatusFilter("all")}>
        <FilterField label="Preparation Status">
          <Select options={PREP_STATUS_OPTIONS} value={prepStatusFilter} onChange={setPrepStatusFilter} placeholder="All" />
        </FilterField>
      </FilterDrawer>
    </div>
  );
}
