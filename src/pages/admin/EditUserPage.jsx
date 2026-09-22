import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { ADMIN_CREATABLE_ROLES, ROLE_LABELS, OFFICES, OFFICE_LABELS, COMMITTEES, can } from "../../lib/roles";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { useTeamOptions } from "../../hooks/useTeamOptions";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import TeamMultiSelect from "../../components/ui/TeamMultiSelect";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import FieldTooltip from "../../components/FieldTooltip";
import ResetPinModal from "./ResetPinModal";
import SignatureUploadModal from "./SignatureUploadModal";
import DeleteUserModal from "./DeleteUserModal";
import "../../styles/CreateUserPage.css";

const FIELD_HELP = {
  role: "Changing a role controls what this person can see and do going forward. Only Admin and MD can change a role.",
  team: "The working group this person belongs to (e.g. BPDD, BIID). Leave blank for roles that aren't tied to a specific team, like CFO or CS.",
  office: "The physical office this person is based out of.",
  committee: "Optional Lead Generation review committee (PMT) — membership grants PMT-stage review/approval on leads, org-wide. Only Admin and MD can change this.",
};

export default function EditUserPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const canEditRole = can.editUserRole(profile?.role);
  // MD can open this page but only to view it — every edit affordance
  // (fields, Save, PIN/signature, Danger Zone) is Admin-only.
  const canEdit = can.editUsers(profile?.role);

  const officeOptions = OFFICES.map((o) => ({ value: o, label: OFFICE_LABELS[o] || o }));
  const teams = useTeamOptions();
  const committeeOptions = COMMITTEES.map((c) => ({ value: c, label: c }));

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [target, setTarget] = useState(null);

  // Admin/MD can only ever SET a role from ADMIN_CREATABLE_ROLES, but the
  // account being edited might already be outside that list (e.g. another
  // Admin or MD) — include its current role so the dropdown doesn't show
  // blank when nothing's actually changing.
  const roleOptions = useMemo(() => {
    const base = ADMIN_CREATABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] || r }));
    if (target && !ADMIN_CREATABLE_ROLES.includes(target.role)) {
      return [{ value: target.role, label: `${ROLE_LABELS[target.role] || target.role} (current)` }, ...base];
    }
    return base;
  }, [target]);
  const [form, setForm] = useState({ full_name: "", role: "", teams: [], office: "", committee: "" });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState("");
  const [success, setSuccess] = useState(false);
  const [showResetPin, setShowResetPin] = useState(false);
  const [showSignatureUpload, setShowSignatureUpload] = useState(false);
  const [showDeleteUser, setShowDeleteUser] = useState(false);
  const [signatureUrl, setSignatureUrl] = useState(null);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("afc_users")
      .select("id, full_name, email, role, team, office, committee, pin_updated_at, signature_path")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setTarget(data);
    const { data: teamRows } = await supabase.from("afc_user_teams").select("team").eq("user_id", id);
    const teamSet = (teamRows || []).map((r) => r.team);
    const assignedTeams = teamSet.length
      ? [data.team, ...teamSet.filter((t) => t !== data.team)].filter(Boolean)
      : data.team
        ? [data.team]
        : [];
    setForm({ full_name: data.full_name || "", role: data.role || "", teams: assignedTeams, office: data.office || "", committee: data.committee || "" });
    setSignatureUrl(null);
    if (data.signature_path) {
      const { data: signed } = await supabase.functions.invoke("get-user-signature-url", { body: { user_id: id } });
      if (signed?.url) setSignatureUrl(signed.url);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  function set(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBanner("");
    setSuccess(false);

    const errs = {};
    if (!form.full_name.trim() || form.full_name.trim().length < 2) errs.full_name = "Enter the person's full name.";
    if (canEditRole && !form.role) errs.role = "Select a role.";
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSaving(true);

    try {
      const { data, error } = await supabase.functions.invoke("update-staff-user", {
        body: {
          user_id: id,
          full_name: form.full_name.trim(),
          teams: form.teams,
          office: form.office || null,
          ...(canEditRole ? { role: form.role, committee: form.committee || null } : {}),
        },
      });

      if (error) {
        setBanner(await extractFunctionErrorMessage(error, "Failed to update account."));
        return;
      }
      if (!data?.success) {
        setBanner(data?.error || "Failed to update account.");
        return;
      }

      showToast(`Account updated for ${form.full_name.trim()}.`, "success");
      navigate("/users");
    } catch (err) {
      setBanner(err.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoader text="Loading account…" />;

  if (notFound || !target) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="app-container">
          <Alert variant="danger">User not found.</Alert>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>{canEdit ? "Edit User" : "User"}</h1>
              <p>
                {canEdit
                  ? `Fix a mistake on this account — name, team, office${canEditRole ? ", or role" : ""}.`
                  : "Account information (view-only)."}
              </p>
            </div>
            <Link to="/users" className="btn btn-secondary btn-sm">
              ← Back to Users
            </Link>
          </div>
        </div>

        {banner && (
          <Alert variant={success ? "success" : "danger"} onClose={() => setBanner("")}>
            {banner}
          </Alert>
        )}

        <Card>
          <form onSubmit={handleSubmit} noValidate>
            <Card.Body>
              <div className="form-grid">
                <div className="field full">
                  {canEdit ? (
                    <Input label="Full Name" required value={form.full_name} onChange={(e) => set("full_name", e.target.value)} error={errors.full_name} disabled={saving} />
                  ) : (
                    <>
                      <label className="field-label">Full Name</label>
                      <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>{target.full_name}</p>
                    </>
                  )}
                </div>
                <div className="field full">
                  <label className="field-label">Email</label>
                  <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>
                    {target.email} <span className="text-tertiary">(login identity cannot be changed here)</span>
                  </p>
                </div>

                {canEditRole ? (
                  <div className="field">
                    <label className="field-label">
                      Designation <span className="required">*</span> <FieldTooltip text={FIELD_HELP.role} />
                    </label>
                    <Select options={roleOptions} value={form.role} onChange={(v) => set("role", v)} placeholder="Select designation" error={errors.role} disabled={saving} />
                    {errors.role && <span className="field-error">{errors.role}</span>}
                  </div>
                ) : (
                  <div className="field">
                    <label className="field-label">Designation</label>
                    <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>{ROLE_LABELS[target.role] || target.role}</p>
                  </div>
                )}

                <div className="field">
                  <label className="field-label">
                    Team {canEdit && <FieldTooltip text={FIELD_HELP.team} />}
                  </label>
                  {canEdit ? (
                    <TeamMultiSelect options={teams} value={form.teams} onChange={(v) => set("teams", v)} disabled={saving} />
                  ) : (
                    <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>{form.teams.length ? form.teams.join(", ") : "—"}</p>
                  )}
                </div>
                <div className="field">
                  <label className="field-label">
                    Office {canEdit && <FieldTooltip text={FIELD_HELP.office} />}
                  </label>
                  {canEdit ? (
                    <Select options={officeOptions} value={form.office} onChange={(v) => set("office", v)} placeholder="Select office" disabled={saving} />
                  ) : (
                    <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>{target.office ? OFFICE_LABELS[target.office] || target.office : "—"}</p>
                  )}
                </div>
                {canEditRole ? (
                  <div className="field">
                    <label className="field-label">
                      Committee <FieldTooltip text={FIELD_HELP.committee} />
                    </label>
                    <Select options={committeeOptions} value={form.committee} onChange={(v) => set("committee", v)} placeholder="— None —" disabled={saving} />
                  </div>
                ) : (
                  target.committee && (
                    <div className="field">
                      <label className="field-label">Committee</label>
                      <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>{target.committee}</p>
                    </div>
                  )
                )}
                {profile?.role === "admin" && (
                  <div className="field">
                    <label className="field-label">
                      Action PIN <FieldTooltip text="The 4-digit PIN this user uses to confirm lead-workflow decisions. One-way hashed — even Admin can't view the current value, only reset it to a new one." />
                    </label>
                    <p className="text-sm text-secondary" style={{ paddingTop: 9, display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                      {target.pin_updated_at ? "Set" : "Not set"}
                      <Button type="button" variant="secondary" size="sm" onClick={() => setShowResetPin(true)}>
                        {target.pin_updated_at ? "Reset PIN" : "Set PIN"}
                      </Button>
                    </p>
                  </div>
                )}
                {profile?.role === "admin" && (
                  <div className="field full">
                    <label className="field-label">
                      Signature <FieldTooltip text="Embedded as this person's signature on generated PDFs (e.g. the Lead Approval Note)." />
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                      {signatureUrl ? (
                        <img src={signatureUrl} alt={`${target.full_name}'s signature`} className="cup-signature-preview" />
                      ) : (
                        <span className="text-sm text-secondary">Not set</span>
                      )}
                      <Button type="button" variant="secondary" size="sm" onClick={() => setShowSignatureUpload(true)}>
                        {signatureUrl ? "Replace Signature" : "Upload Signature"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Card.Body>
            {canEdit && (
              <Card.Footer>
                <Button type="submit" variant="primary" loading={saving} disabled={saving}>
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              </Card.Footer>
            )}
          </form>
        </Card>

        {profile?.role === "admin" && target.id !== profile?.id && (
          <Card className="danger-zone-card" style={{ marginTop: "var(--space-6)", borderColor: "var(--danger)" }}>
            <Card.Header title="Danger Zone" />
            <Card.Body>
              <p className="text-sm text-secondary" style={{ marginBottom: "var(--space-3)" }}>
                Permanently delete {target.full_name}'s account. This cannot be undone, and only succeeds if they have
                no leads, proposals, or other activity on record — deactivate them instead if you just need to revoke
                access.
              </p>
              <Button type="button" variant="danger" onClick={() => setShowDeleteUser(true)}>
                Delete User
              </Button>
            </Card.Body>
          </Card>
        )}

        {showResetPin && (
          <ResetPinModal
            targetUserId={target.id}
            targetName={target.full_name}
            onClose={() => setShowResetPin(false)}
            onSuccess={() => {
              setShowResetPin(false);
              setSuccess(true);
              setBanner(`PIN reset for ${target.full_name}.`);
              fetchUser();
            }}
          />
        )}

        {showSignatureUpload && (
          <SignatureUploadModal
            targetUserId={target.id}
            targetName={target.full_name}
            onClose={() => setShowSignatureUpload(false)}
            onSuccess={() => {
              setShowSignatureUpload(false);
              setSuccess(true);
              setBanner(`Signature uploaded for ${target.full_name}.`);
              fetchUser();
            }}
          />
        )}

        {showDeleteUser && (
          <DeleteUserModal
            targetUserId={target.id}
            targetName={target.full_name}
            targetEmail={target.email}
            onClose={() => setShowDeleteUser(false)}
            onSuccess={() => {
              setShowDeleteUser(false);
              showToast(`${target.full_name} was permanently deleted.`, "success");
              navigate("/users");
            }}
          />
        )}
      </div>
    </div>
  );
}
