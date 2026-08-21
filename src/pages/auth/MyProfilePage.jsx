import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { ROLE_LABELS } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import SetPasswordForm from "./SetPasswordForm";
import SetPinForm from "./SetPinForm";

// Self-service page for both AFC staff and Business Associate portal
// accounts — name can be corrected here (email/role/team/office stay
// admin-managed), and password can be changed voluntarily without going
// through the forced first-login flow.
export default function MyProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name || "");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState("");
  const [bannerVariant, setBannerVariant] = useState("success");

  if (!profile) return null;

  const roleLabel = ROLE_LABELS[profile.role] || profile.role;

  async function handleSaveName(e) {
    e.preventDefault();
    setBanner("");
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setBannerVariant("danger");
      setBanner("Full name must be at least 2 characters.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_own_full_name", { new_name: trimmed });
      if (error) {
        setBannerVariant("danger");
        setBanner(error.message || "Could not update your name. Please try again.");
        return;
      }
      await refreshProfile();
      setBannerVariant("success");
      setBanner("Name updated.");
    } catch (err) {
      setBannerVariant("danger");
      setBanner(err.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>My Profile</h1>
              <p>Update your display name, or change your password.</p>
            </div>
          </div>
        </div>

        <Card>
          <form onSubmit={handleSaveName} noValidate>
            <Card.Header title="Profile Details" />
            <Card.Body>
              {banner && (
                <Alert variant={bannerVariant} onClose={() => setBanner("")}>
                  {banner}
                </Alert>
              )}
              <div className="form-grid">
                <div className="field full">
                  <Input
                    label="Full Name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Email</label>
                  <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>
                    {profile.email} <span className="text-tertiary">(login identity — cannot be changed here)</span>
                  </p>
                </div>
                <div className="field">
                  <label className="field-label">Role</label>
                  <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>{roleLabel}</p>
                </div>
                {profile.team && (
                  <div className="field">
                    <label className="field-label">Team</label>
                    <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>{profile.team}</p>
                  </div>
                )}
                {profile.office && (
                  <div className="field">
                    <label className="field-label">Office</label>
                    <p className="text-sm text-secondary" style={{ paddingTop: 9, textTransform: "capitalize" }}>{profile.office}</p>
                  </div>
                )}
                <div className="field">
                  <label className="field-label">Committee</label>
                  <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>{profile.committee || "—"}</p>
                </div>
              </div>
            </Card.Body>
            <Card.Footer>
              <Button type="submit" variant="primary" loading={saving} disabled={saving || name.trim() === profile.full_name}>
                {saving ? "Saving…" : "Save Name"}
              </Button>
            </Card.Footer>
          </form>
        </Card>

        <div id="password" style={{ marginTop: "var(--space-6)", scrollMarginTop: 90 }}>
          <SetPasswordForm
            heading="Change Password"
            subheading="Choose a new password for your account."
            submitLabel="Update Password"
            hookOptions={{ requireMarkChanged: false, redirectTo: null, requireCurrentPassword: true }}
            successMessage="Password updated successfully."
          />
        </div>

        <div id="pin" style={{ marginTop: "var(--space-6)", scrollMarginTop: 90 }}>
          <SetPinForm hasPin={!!profile.pin_updated_at} />
        </div>
      </div>
    </div>
  );
}
