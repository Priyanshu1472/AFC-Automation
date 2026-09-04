import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { ROLE_LABELS, can } from "../../lib/roles";
import { useAuth } from "../../hooks/useAuth";
import { useTeamOptions } from "../../hooks/useTeamOptions";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import PageLoader from "../../components/ui/PageLoader";
import Tooltip from "../../components/ui/Tooltip";
import FieldTooltip from "../../components/FieldTooltip";
import FilterDrawer, { FilterButton, FilterField } from "../../components/ui/FilterDrawer";
import "../../styles/UserListPage.css";

const ROLE_VARIANT = {
  md: "warning",
  cfo: "info",
  cs: "success",
  dgm: "brand",
  agm: "neutral",
  srm: "neutral",
  project_officer: "warning",
  associate_consultant: "info",
  project_assistant: "info",
  admin: "danger",
};

const PAGE_SIZE = 25;

const COMMITTEE_OPTIONS = ["PMT", "PMT Extended", "G3"];

// Restores search/filter/page state after a trip out to a user's Edit page
// and back — "Back to Users" (EditUserPage.jsx) pushes a bare /users, so
// sessionStorage survives that regardless of how the admin navigates back
// (that link, or the browser's own back button). Same pattern as
// LeadListPage's FILTER_STORAGE_KEY.
const FILTER_STORAGE_KEY = "userListFilters";
function loadStoredFilters() {
  try {
    return JSON.parse(sessionStorage.getItem(FILTER_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function ToggleButton({ user, isSelf, togglingId, onToggle }) {
  if (isSelf) return null;
  return (
    <Tooltip
      text={
        user.is_active
          ? "Immediately blocks this person from signing in. Their account is not deleted."
          : "Restores this person's ability to sign in."
      }
    >
      <Button
        variant={user.is_active ? "danger" : "secondary"}
        size="sm"
        loading={togglingId === user.id}
        disabled={togglingId !== null}
        onClick={() => onToggle(user)}
      >
        {user.is_active ? "Deactivate" : "Activate"}
      </Button>
    </Tooltip>
  );
}

function EditButton({ user, isSelf, onEdit }) {
  if (isSelf) return null;
  return (
    <Tooltip text="Fix a mistake on this account — name, team, office, or (Admin/MD only) role.">
      <Button variant="secondary" size="sm" onClick={() => onEdit(user)}>
        Edit
      </Button>
    </Tooltip>
  );
}

export default function UserListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // Only the very first load shows the full-page loader — every later
  // refetch (typing in Search, changing a filter/page) must NOT unmount
  // the page (and with it, the focused search Input): doing so on every
  // keystroke was dropping the cursor/focus the moment results emptied out
  // and the old `loading && users.length === 0` gate kicked back in.
  const [initialLoad, setInitialLoad] = useState(true);
  const [banner, setBanner] = useState("");
  const [togglingId, setTogglingId] = useState(null);
  const [search, setSearch] = useState(() => loadStoredFilters().search || "");
  const [teamFilter, setTeamFilter] = useState(() => loadStoredFilters().teamFilter || "all");
  const [roleFilter, setRoleFilter] = useState(() => loadStoredFilters().roleFilter || "all");
  const [committeeFilter, setCommitteeFilter] = useState(() => loadStoredFilters().committeeFilter || "all");
  const [page, setPage] = useState(() => loadStoredFilters().page || 0);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ search, teamFilter, roleFilter, committeeFilter, page }));
    } catch {
      // Private browsing / storage disabled — filters just won't persist.
    }
  }, [search, teamFilter, roleFilter, committeeFilter, page]);

  const canManage = can.manageAllUsers(profile?.role);
  const canCreate = can.createUsers(profile?.role);

  // MD looking at "All Teams" (the default) sees the whole roster grouped
  // into a section per team instead of one flat paginated list — everyone
  // else (a specific team selected, or a DGM who only ever has one team
  // anyway) gets the plain flat table.
  const groupedByTeam = profile?.role === "md" && teamFilter === "all";

  const roleFilterOptions = useMemo(
    () => [{ value: "all", label: "All Roles" }, ...Object.entries(ROLE_LABELS).filter(([k]) => k !== "business_associate").map(([value, label]) => ({ value, label }))],
    []
  );
  const teams = useTeamOptions();
  const teamFilterOptions = useMemo(() => [{ value: "all", label: "All Teams" }, ...teams.map((t) => ({ value: t, label: t }))], [teams]);
  const committeeFilterOptions = useMemo(
    () => [{ value: "all", label: "All Committees" }, ...COMMITTEE_OPTIONS.map((c) => ({ value: c, label: c }))],
    []
  );

  const fetchUsersFlat = useCallback(async (currentPage, currentSearch, currentTeam, currentRole, currentCommittee) => {
    // RLS scopes the visible rows automatically: md/cfo/cs see everyone,
    // dgm sees their own team, everyone else sees only themselves.
    let query = supabase
      .from("afc_users")
      .select("id, full_name, email, role, team, office, committee, is_active", { count: "exact" })
      .order("created_at", { ascending: false });

    const trimmed = currentSearch.trim();
    if (trimmed) query = query.or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
    if (currentTeam !== "all") query = query.eq("team", currentTeam);
    if (currentRole !== "all") query = query.eq("role", currentRole);
    if (currentCommittee !== "all") query = query.eq("committee", currentCommittee);

    const from = currentPage * PAGE_SIZE;
    query = query.range(from, from + PAGE_SIZE - 1);
    return query;
  }, []);

  // Grouped view needs every matching row at once (to group + count
  // accurately per team) rather than one page at a time.
  const fetchUsersGrouped = useCallback(async (currentSearch, currentRole, currentCommittee) => {
    let query = supabase
      .from("afc_users")
      .select("id, full_name, email, role, team, office, committee, is_active", { count: "exact" })
      .order("team", { ascending: true })
      .order("full_name", { ascending: true });

    const trimmed = currentSearch.trim();
    if (trimmed) query = query.or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
    if (currentRole !== "all") query = query.eq("role", currentRole);
    if (currentCommittee !== "all") query = query.eq("committee", currentCommittee);
    return query;
  }, []);

  const fetchUsers = useCallback(
    async (currentPage, currentSearch, currentTeam, currentRole, currentCommittee) => {
      setLoading(true);
      const { data, error, count } =
        profile?.role === "md" && currentTeam === "all"
          ? await fetchUsersGrouped(currentSearch, currentRole, currentCommittee)
          : await fetchUsersFlat(currentPage, currentSearch, currentTeam, currentRole, currentCommittee);
      if (error) setBanner(error.message);
      else {
        setUsers(data || []);
        setTotalCount(count || 0);
      }
      setLoading(false);
      setInitialLoad(false);
    },
    [profile?.role, fetchUsersFlat, fetchUsersGrouped]
  );

  useEffect(() => {
    fetchUsers(page, search, teamFilter, roleFilter, committeeFilter);
  }, [fetchUsers, page, search, teamFilter, roleFilter, committeeFilter]);

  const groupedSections = useMemo(() => {
    if (!groupedByTeam) return null;
    const map = new Map();
    users.forEach((u) => {
      const key = u.team || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(u);
    });
    // Known teams first (in teams order), then anything else (e.g. Unassigned).
    const ordered = [...teams.filter((t) => map.has(t)), ...[...map.keys()].filter((k) => !teams.includes(k))];
    return ordered.map((team) => ({ team, users: map.get(team) }));
  }, [groupedByTeam, users, teams]);

  function handleSearchChange(value) {
    setSearch(value);
    setPage(0);
  }
  function handleTeamFilterChange(value) {
    setTeamFilter(value);
    setPage(0);
  }
  function handleRoleFilterChange(value) {
    setRoleFilter(value);
    setPage(0);
  }
  function handleCommitteeFilterChange(value) {
    setCommitteeFilter(value);
    setPage(0);
  }
  const activeFilterCount = [teamFilter !== "all", roleFilter !== "all", committeeFilter !== "all"].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;
  function clearFilters() {
    setTeamFilter("all");
    setRoleFilter("all");
    setCommitteeFilter("all");
    setPage(0);
  }

  async function handleToggle(user) {
    setTogglingId(user.id);
    setBanner("");
    try {
      const { data, error } = await supabase.functions.invoke("set-user-status", {
        body: { user_id: user.id, is_active: !user.is_active },
      });
      if (error) {
        setBanner(await extractFunctionErrorMessage(error, "Failed to update user status."));
        return;
      }
      if (!data?.success) {
        setBanner(data?.error || "Failed to update user status.");
        return;
      }
      await fetchUsers(page, search, teamFilter, roleFilter, committeeFilter);
    } catch (err) {
      setBanner(err.message || "Failed to update user status.");
    } finally {
      setTogglingId(null);
    }
  }

  function handleEdit(user) {
    navigate(`/users/${user.id}/edit`);
  }

  // Whole rows are clickable to open Edit — but only where the Edit button
  // itself would actually show (same as EditButton's own isSelf/canManage
  // gate), so this never offers a click target that leads nowhere.
  function isRowClickable(user) {
    return canManage && user.id !== profile.id;
  }
  function handleRowClick(user) {
    if (isRowClickable(user)) handleEdit(user);
  }

  const from = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, totalCount);
  const hasNextPage = to < totalCount;

  if (initialLoad) return <PageLoader text="Loading users…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>Users</h1>
              <p>{can.viewAllTeams(profile?.role) ? "All staff accounts." : "Your team's staff accounts."}</p>
            </div>
            {canCreate && (
              <Tooltip text="Create a new staff account. A temporary password is generated and emailed automatically.">
                <Button variant="primary" onClick={() => navigate("/create-user")}>
                  + Create User
                </Button>
              </Tooltip>
            )}
          </div>
        </div>

        {banner && (
          <Alert variant="danger" onClose={() => setBanner("")}>
            {banner}
          </Alert>
        )}

        <Card>
          <Card.Body className="ul-filter-row">
            <Input
              className="ul-search-input"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
            <FilterButton onClick={() => setFilterDrawerOpen(true)} activeCount={activeFilterCount} />
          </Card.Body>

          {users.length === 0 ? (
            <div className="text-secondary text-sm" style={{ padding: 24, textAlign: "center" }}>
              {search ? "No users match your search." : "No users found."}
            </div>
          ) : groupedByTeam ? (
            <>
              <div className="table-wrapper ul-desktop-table">
                <table className="table ul-grouped-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Office</th>
                      <th>Committee</th>
                      <th>Status</th>
                      {canManage && <th>Actions</th>}
                    </tr>
                  </thead>
                  {groupedSections.map(({ team, users: teamUsers }) => (
                    <tbody key={team}>
                      <tr className="ul-team-sep-row">
                        <td colSpan={canManage ? 7 : 6}>
                          <span className="ul-team-sep-name">{team}</span>
                          <span className="ul-team-sep-count">{teamUsers.length}</span>
                        </td>
                      </tr>
                      {teamUsers.map((u) => (
                        <tr key={u.id} className={isRowClickable(u) ? "ul-row-clickable" : undefined} onClick={() => handleRowClick(u)}>
                          <td>{u.full_name}</td>
                          <td>{u.email}</td>
                          <td><Badge className="ul-role-badge" variant={ROLE_VARIANT[u.role] || "neutral"}>{ROLE_LABELS[u.role] || u.role}</Badge></td>
                          <td>{u.office ? u.office.charAt(0).toUpperCase() + u.office.slice(1) : "—"}</td>
                          <td>{u.committee ? <Badge variant="neutral">{u.committee}</Badge> : "—"}</td>
                          <td><Badge variant={u.is_active ? "success" : "danger"} dot>{u.is_active ? "Active" : "Inactive"}</Badge></td>
                          {canManage && (
                            <td onClick={(e) => e.stopPropagation()}>
                              <div style={{ display: "flex", gap: 8 }}>
                                <EditButton user={u} isSelf={u.id === profile.id} onEdit={handleEdit} />
                                <ToggleButton user={u} isSelf={u.id === profile.id} togglingId={togglingId} onToggle={handleToggle} />
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>

              <div className="ul-mobile-list">
                {groupedSections.map(({ team, users: teamUsers }) => (
                  <div key={team}>
                    <div className="ul-team-sep-row-mobile">
                      <span className="ul-team-sep-name">{team}</span>
                      <span className="ul-team-sep-count">{teamUsers.length}</span>
                    </div>
                    {teamUsers.map((u) => (
                      <div
                        key={u.id}
                        className={`ul-mobile-card${isRowClickable(u) ? " ul-row-clickable" : ""}`}
                        onClick={() => handleRowClick(u)}
                      >
                        <div className="ul-mobile-card-top">
                          <div>
                            <div className="ul-mobile-name">{u.full_name}</div>
                            <div className="ul-mobile-email">{u.email}</div>
                          </div>
                          <Badge variant={u.is_active ? "success" : "danger"} dot>{u.is_active ? "Active" : "Inactive"}</Badge>
                        </div>
                        <div className="ul-mobile-card-meta">
                          <Badge className="ul-role-badge" variant={ROLE_VARIANT[u.role] || "neutral"}>{ROLE_LABELS[u.role] || u.role}</Badge>
                          {u.office && <span className="text-xs text-tertiary">{u.office.charAt(0).toUpperCase() + u.office.slice(1)}</span>}
                          {u.committee && <Badge variant="neutral">{u.committee}</Badge>}
                        </div>
                        {canManage && (
                          <div className="ul-mobile-card-actions" style={{ display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
                            <EditButton user={u} isSelf={u.id === profile.id} onEdit={handleEdit} />
                            <ToggleButton user={u} isSelf={u.id === profile.id} togglingId={togglingId} onToggle={handleToggle} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Desktop / wide screens */}
              <div className="table-wrapper ul-desktop-table">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          Role <FieldTooltip text="A staff member's role determines what they can see and do — see the Role field on the Create User page for the full hierarchy." />
                        </span>
                      </th>
                      <th>Office</th>
                      <th>Team</th>
                      <th>Committee</th>
                      <th>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          Status <FieldTooltip text="Inactive accounts cannot sign in, but their Supabase login itself is kept intact and can be reactivated at any time." />
                        </span>
                      </th>
                      {canManage && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className={isRowClickable(u) ? "ul-row-clickable" : undefined} onClick={() => handleRowClick(u)}>
                        <td>{u.full_name}</td>
                        <td>{u.email}</td>
                        <td>
                          <Badge className="ul-role-badge" variant={ROLE_VARIANT[u.role] || "neutral"}>{ROLE_LABELS[u.role] || u.role}</Badge>
                        </td>
                        <td>{u.office ? u.office.charAt(0).toUpperCase() + u.office.slice(1) : "—"}</td>
                        <td>{u.team || "—"}</td>
                        <td>{u.committee ? <Badge variant="neutral">{u.committee}</Badge> : "—"}</td>
                        <td>
                          <Badge variant={u.is_active ? "success" : "danger"} dot>
                            {u.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        {canManage && (
                          <td onClick={(e) => e.stopPropagation()}>
                            <div style={{ display: "flex", gap: 8 }}>
                              <EditButton user={u} isSelf={u.id === profile.id} onEdit={handleEdit} />
                              <ToggleButton user={u} isSelf={u.id === profile.id} togglingId={togglingId} onToggle={handleToggle} />
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Narrow screens — stacked cards instead of a cramped table */}
              <div className="ul-mobile-list">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className={`ul-mobile-card${isRowClickable(u) ? " ul-row-clickable" : ""}`}
                    onClick={() => handleRowClick(u)}
                  >
                    <div className="ul-mobile-card-top">
                      <div>
                        <div className="ul-mobile-name">{u.full_name}</div>
                        <div className="ul-mobile-email">{u.email}</div>
                      </div>
                      <Badge variant={u.is_active ? "success" : "danger"} dot>
                        {u.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="ul-mobile-card-meta">
                      <Badge className="ul-role-badge" variant={ROLE_VARIANT[u.role] || "neutral"}>{ROLE_LABELS[u.role] || u.role}</Badge>
                      {u.office && <span className="text-xs text-tertiary">{u.office.charAt(0).toUpperCase() + u.office.slice(1)}</span>}
                      {u.team && <span className="text-xs text-tertiary">{u.team}</span>}
                      {u.committee && <Badge variant="neutral">{u.committee}</Badge>}
                    </div>
                    {canManage && (
                      <div className="ul-mobile-card-actions" style={{ display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
                        <EditButton user={u} isSelf={u.id === profile.id} onEdit={handleEdit} />
                        <ToggleButton user={u} isSelf={u.id === profile.id} togglingId={togglingId} onToggle={handleToggle} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {!groupedByTeam && totalCount > 0 && (
            <Card.Footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}>
              <span className="text-sm text-secondary">
                Showing {from}–{to} of {totalCount}
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
          {groupedByTeam && totalCount > 0 && (
            <Card.Footer>
              <span className="text-sm text-secondary">{totalCount} staff member{totalCount !== 1 ? "s" : ""} total</span>
            </Card.Footer>
          )}
        </Card>
      </div>

      <FilterDrawer open={filterDrawerOpen} onClose={() => setFilterDrawerOpen(false)} onReset={clearFilters}>
        {can.viewAllTeams(profile?.role) && (
          <FilterField label="Team">
            <Select options={teamFilterOptions} value={teamFilter} onChange={handleTeamFilterChange} placeholder="All Teams" />
          </FilterField>
        )}
        <FilterField label="Role">
          <Select options={roleFilterOptions} value={roleFilter} onChange={handleRoleFilterChange} placeholder="All Roles" />
        </FilterField>
        <FilterField label="Committee">
          <Select options={committeeFilterOptions} value={committeeFilter} onChange={handleCommitteeFilterChange} placeholder="All Committees" />
        </FilterField>
      </FilterDrawer>
    </div>
  );
}
