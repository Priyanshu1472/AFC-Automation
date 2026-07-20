import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { ROLE_LABELS, TEAMS, can } from "../../lib/roles";
import { useAuth } from "../../hooks/useAuth";
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
};

const PAGE_SIZE = 25;

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

export default function UserListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState("");
  const [togglingId, setTogglingId] = useState(null);
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(0);

  const canManage = can.manageAllUsers(profile?.role) || can.manageTeamUsers(profile?.role);
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
  const teamFilterOptions = useMemo(() => [{ value: "all", label: "All Teams" }, ...TEAMS.map((t) => ({ value: t, label: t }))], []);

  const fetchUsersFlat = useCallback(async (currentPage, currentSearch, currentTeam, currentRole) => {
    // RLS scopes the visible rows automatically: md/cfo/cs see everyone,
    // dgm sees their own team, everyone else sees only themselves.
    let query = supabase
      .from("afc_users")
      .select("id, full_name, email, role, team, office, is_active", { count: "exact" })
      .order("created_at", { ascending: false });

    const trimmed = currentSearch.trim();
    if (trimmed) query = query.or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
    if (currentTeam !== "all") query = query.eq("team", currentTeam);
    if (currentRole !== "all") query = query.eq("role", currentRole);

    const from = currentPage * PAGE_SIZE;
    query = query.range(from, from + PAGE_SIZE - 1);
    return query;
  }, []);

  // Grouped view needs every matching row at once (to group + count
  // accurately per team) rather than one page at a time.
  const fetchUsersGrouped = useCallback(async (currentSearch, currentRole) => {
    let query = supabase
      .from("afc_users")
      .select("id, full_name, email, role, team, office, is_active", { count: "exact" })
      .order("team", { ascending: true })
      .order("full_name", { ascending: true });

    const trimmed = currentSearch.trim();
    if (trimmed) query = query.or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
    if (currentRole !== "all") query = query.eq("role", currentRole);
    return query;
  }, []);

  const fetchUsers = useCallback(
    async (currentPage, currentSearch, currentTeam, currentRole) => {
      setLoading(true);
      const { data, error, count } =
        profile?.role === "md" && currentTeam === "all"
          ? await fetchUsersGrouped(currentSearch, currentRole)
          : await fetchUsersFlat(currentPage, currentSearch, currentTeam, currentRole);
      if (error) setBanner(error.message);
      else {
        setUsers(data || []);
        setTotalCount(count || 0);
      }
      setLoading(false);
    },
    [profile?.role, fetchUsersFlat, fetchUsersGrouped]
  );

  useEffect(() => {
    fetchUsers(page, search, teamFilter, roleFilter);
  }, [fetchUsers, page, search, teamFilter, roleFilter]);

  const groupedSections = useMemo(() => {
    if (!groupedByTeam) return null;
    const map = new Map();
    users.forEach((u) => {
      const key = u.team || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(u);
    });
    // Known teams first (in TEAMS order), then anything else (e.g. Unassigned).
    const ordered = [...TEAMS.filter((t) => map.has(t)), ...[...map.keys()].filter((k) => !TEAMS.includes(k))];
    return ordered.map((team) => ({ team, users: map.get(team) }));
  }, [groupedByTeam, users]);

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
  const hasActiveFilters = teamFilter !== "all" || roleFilter !== "all";
  function clearFilters() {
    setTeamFilter("all");
    setRoleFilter("all");
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
      await fetchUsers(page, search, teamFilter, roleFilter);
    } catch (err) {
      setBanner(err.message || "Failed to update user status.");
    } finally {
      setTogglingId(null);
    }
  }

  const from = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, totalCount);
  const hasNextPage = to < totalCount;

  if (loading && users.length === 0) return <PageLoader text="Loading users…" />;

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
            {can.viewAllTeams(profile?.role) && (
              <Select className="ul-filter-select" options={teamFilterOptions} value={teamFilter} onChange={handleTeamFilterChange} placeholder="All Teams" />
            )}
            <Select className="ul-filter-select" options={roleFilterOptions} value={roleFilter} onChange={handleRoleFilterChange} placeholder="All Roles" />
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>
            )}
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
                      <th>Status</th>
                      {canManage && <th>Actions</th>}
                    </tr>
                  </thead>
                  {groupedSections.map(({ team, users: teamUsers }) => (
                    <tbody key={team}>
                      <tr className="ul-team-sep-row">
                        <td colSpan={canManage ? 6 : 5}>
                          <span className="ul-team-sep-name">{team}</span>
                          <span className="ul-team-sep-count">{teamUsers.length}</span>
                        </td>
                      </tr>
                      {teamUsers.map((u) => (
                        <tr key={u.id}>
                          <td>{u.full_name}</td>
                          <td>{u.email}</td>
                          <td><Badge variant={ROLE_VARIANT[u.role] || "neutral"}>{ROLE_LABELS[u.role] || u.role}</Badge></td>
                          <td>{u.office ? u.office.charAt(0).toUpperCase() + u.office.slice(1) : "—"}</td>
                          <td><Badge variant={u.is_active ? "success" : "danger"} dot>{u.is_active ? "Active" : "Inactive"}</Badge></td>
                          {canManage && (
                            <td>
                              <ToggleButton user={u} isSelf={u.id === profile.id} togglingId={togglingId} onToggle={handleToggle} />
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
                      <div key={u.id} className="ul-mobile-card">
                        <div className="ul-mobile-card-top">
                          <div>
                            <div className="ul-mobile-name">{u.full_name}</div>
                            <div className="ul-mobile-email">{u.email}</div>
                          </div>
                          <Badge variant={u.is_active ? "success" : "danger"} dot>{u.is_active ? "Active" : "Inactive"}</Badge>
                        </div>
                        <div className="ul-mobile-card-meta">
                          <Badge variant={ROLE_VARIANT[u.role] || "neutral"}>{ROLE_LABELS[u.role] || u.role}</Badge>
                          {u.office && <span className="text-xs text-tertiary">{u.office.charAt(0).toUpperCase() + u.office.slice(1)}</span>}
                        </div>
                        {canManage && (
                          <div className="ul-mobile-card-actions">
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
                      <tr key={u.id}>
                        <td>{u.full_name}</td>
                        <td>{u.email}</td>
                        <td>
                          <Badge variant={ROLE_VARIANT[u.role] || "neutral"}>{ROLE_LABELS[u.role] || u.role}</Badge>
                        </td>
                        <td>{u.office ? u.office.charAt(0).toUpperCase() + u.office.slice(1) : "—"}</td>
                        <td>{u.team || "—"}</td>
                        <td>
                          <Badge variant={u.is_active ? "success" : "danger"} dot>
                            {u.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        {canManage && (
                          <td>
                            <ToggleButton user={u} isSelf={u.id === profile.id} togglingId={togglingId} onToggle={handleToggle} />
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
                  <div key={u.id} className="ul-mobile-card">
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
                      <Badge variant={ROLE_VARIANT[u.role] || "neutral"}>{ROLE_LABELS[u.role] || u.role}</Badge>
                      {u.office && <span className="text-xs text-tertiary">{u.office.charAt(0).toUpperCase() + u.office.slice(1)}</span>}
                      {u.team && <span className="text-xs text-tertiary">{u.team}</span>}
                    </div>
                    {canManage && (
                      <div className="ul-mobile-card-actions">
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
    </div>
  );
}
