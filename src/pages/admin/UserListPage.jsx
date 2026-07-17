import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { ROLE_LABELS, can } from "../../lib/roles";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";

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

export default function UserListPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState("");
  const [togglingId, setTogglingId] = useState(null);

  const canManage = can.manageAllUsers(profile?.role) || can.manageTeamUsers(profile?.role);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    // RLS scopes the visible rows automatically: md/cfo/cs see everyone,
    // dgm sees their own team, everyone else sees only themselves.
    const { data, error } = await supabase
      .from("afc_users")
      .select("id, full_name, email, role, team, office, is_active")
      .order("created_at", { ascending: false });
    if (error) setBanner(error.message);
    else setUsers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function handleToggle(user) {
    setTogglingId(user.id);
    setBanner("");
    try {
      const { data, error } = await supabase.functions.invoke("set-user-status", {
        body: { user_id: user.id, is_active: !user.is_active },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to update user.");
      await fetchUsers();
    } catch (err) {
      setBanner(err.message || "Failed to update user status.");
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) return <PageLoader text="Loading users…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <h1>Users</h1>
          <p>{can.viewAllTeams(profile?.role) ? "All staff accounts." : "Your team's staff accounts."}</p>
        </div>

        {banner && (
          <Alert variant="danger" onClose={() => setBanner("")}>
            {banner}
          </Alert>
        )}

        <Card>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Office</th>
                  <th>Team</th>
                  <th>Status</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 7 : 6} className="text-secondary text-sm" style={{ padding: 24, textAlign: "center" }}>
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
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
                          {u.id !== profile.id && (
                            <Button
                              variant={u.is_active ? "danger" : "secondary"}
                              size="sm"
                              loading={togglingId === u.id}
                              disabled={togglingId !== null}
                              onClick={() => handleToggle(u)}
                            >
                              {u.is_active ? "Deactivate" : "Activate"}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
