import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { ROLE_LABELS, can } from "../../lib/roles";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Input from "../../components/ui/Input";
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
  const [page, setPage] = useState(0);

  const canManage = can.manageAllUsers(profile?.role) || can.manageTeamUsers(profile?.role);
  const canCreate = can.createUsers(profile?.role);

  const fetchUsers = useCallback(async (currentPage, currentSearch) => {
    setLoading(true);
    // RLS scopes the visible rows automatically: md/cfo/cs see everyone,
    // dgm sees their own team, everyone else sees only themselves.
    let query = supabase
      .from("afc_users")
      .select("id, full_name, email, role, team, office, is_active", { count: "exact" })
      .order("created_at", { ascending: false });

    const trimmed = currentSearch.trim();
    if (trimmed) {
      query = query.or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`);
    }

    const from = currentPage * PAGE_SIZE;
    query = query.range(from, from + PAGE_SIZE - 1);

    const { data, error, count } = await query;
    if (error) setBanner(error.message);
    else {
      setUsers(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers(page, search);
  }, [fetchUsers, page, search]);

  function handleSearchChange(value) {
    setSearch(value);
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
      await fetchUsers(page, search);
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
          <Card.Body style={{ paddingBottom: "var(--space-4)" }}>
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </Card.Body>
          {users.length === 0 ? (
            <div className="text-secondary text-sm" style={{ padding: 24, textAlign: "center" }}>
              {search ? "No users match your search." : "No users found."}
            </div>
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
          {totalCount > 0 && (
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
        </Card>
      </div>
    </div>
  );
}
