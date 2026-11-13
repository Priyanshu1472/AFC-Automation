import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { ROLE_LABELS, OFFICE_LABELS } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import SetPasswordForm from "./SetPasswordForm";
import SetPinForm from "./SetPinForm";
import SignatureUploadModal from "../admin/SignatureUploadModal";
import ProfileAvatar from "../../components/shared/ProfileAvatar";
import AvatarCropModal from "../../components/shared/AvatarCropModal";
import { useToast } from "../../hooks/useToast";
import { MailIcon } from "../../components/icons";
import { uploadOwnAvatar, removeOwnAvatar, MAX_AVATAR_UPLOAD_BYTES } from "../../lib/avatar";
import "../../styles/MyProfilePage.css";

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

// Self-service page for both AFC staff and Business Partner portal
// accounts — name can be corrected here (email/role/team/office stay
// admin-managed), and password can be changed voluntarily without going
// through the forced first-login flow.
export default function MyProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.full_name || "");
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  // Inline banner is for name-form validation errors only; outcomes
  // (saved / photo updated / failures) go to toasts.
  const [banner, setBanner] = useState("");
  const [signatureUrl, setSignatureUrl] = useState(null);
  const [showSignatureUpload, setShowSignatureUpload] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const photoInputRef = useRef(null);

  useEffect(() => {
    if (!profile?.signature_path) {
      setSignatureUrl(null);
      return;
    }
    let cancelled = false;
    supabase.functions.invoke("get-user-signature-url", { body: { user_id: profile.id } }).then(({ data }) => {
      if (!cancelled && data?.url) setSignatureUrl(data.url);
    });
    return () => {
      cancelled = true;
    };
  }, [profile?.id, profile?.signature_path]);

  if (!profile) return null;

  const roleLabel = ROLE_LABELS[profile.role] || profile.role;

  // Picking a file only opens the crop dialog; the upload happens once the
  // user confirms the framing there (handleCropConfirm).
  function handlePhotoPicked(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file (JPG, PNG or WebP).", "danger");
      return;
    }
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      showToast("That image is too large — please choose one under 10 MB.", "danger");
      return;
    }
    setCropFile(file);
  }

  async function handleCropConfirm(blob) {
    setPhotoBusy(true);
    try {
      await uploadOwnAvatar(profile.id, blob, profile.avatar_path);
      await refreshProfile();
      setCropFile(null);
      showToast("Profile photo updated.", "success");
    } catch (err) {
      showToast(err.message || "Could not upload your photo. Please try again.", "danger");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleRemovePhoto() {
    setPhotoBusy(true);
    try {
      await removeOwnAvatar(profile.avatar_path);
      await refreshProfile();
      showToast("Profile photo removed.", "success");
    } catch (err) {
      showToast(err.message || "Could not remove your photo. Please try again.", "danger");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function handleSaveName(e) {
    e.preventDefault();
    setBanner("");
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setBanner("Full name must be at least 2 characters.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_own_full_name", { new_name: trimmed });
      if (error) {
        setBanner(error.message || "Could not update your name. Please try again.");
        return;
      }
      await refreshProfile();
      showToast("Name updated.", "success");
    } catch (err) {
      setBanner(err.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const teamsLabel = profile.teams?.length > 1 ? profile.teams.join(", ") : profile.team;
  const tags = [
    teamsLabel && { label: profile.teams?.length > 1 ? "Teams" : "Team", value: teamsLabel },
    profile.office && { label: "Office", value: OFFICE_LABELS[profile.office] || profile.office },
    profile.committee && { label: "Committee", value: profile.committee },
  ].filter(Boolean);

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container mp-page">
        <div className="page-header">
          <h1>My Profile</h1>
          <p>Your photo, name and signature, plus your password and action PIN.</p>
        </div>

        {/* Identity — photo, name, designation and the admin-managed facts. */}
        <Card className="mp-hero">
          <div className="mp-hero-photo">
            <ProfileAvatar profile={profile} className="mp-hero-avatar" />
            <button
              type="button"
              className="mp-hero-camera"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoBusy}
              aria-label={profile.avatar_path ? "Change photo" : "Upload photo"}
              title={profile.avatar_path ? "Change photo" : "Upload photo"}
            >
              <CameraIcon />
            </button>
            <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={handlePhotoPicked} />
          </div>

          <div className="mp-hero-info">
            <h2 className="mp-hero-name">{profile.full_name}</h2>
            <p className="mp-hero-role">{roleLabel}</p>
            <p className="mp-hero-email">
              <MailIcon />
              <span>{profile.email}</span>
            </p>
            {tags.length > 0 && (
              <div className="mp-hero-tags">
                {tags.map((t) => (
                  <span key={t.label} className="mp-tag">
                    <span className="mp-tag-label">{t.label}</span>
                    {t.value}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mp-hero-actions">
            <Button type="button" variant="secondary" size="sm" loading={photoBusy} disabled={photoBusy} onClick={() => photoInputRef.current?.click()}>
              {profile.avatar_path ? "Change Photo" : "Upload Photo"}
            </Button>
            {profile.avatar_path && (
              <Button type="button" variant="ghost" size="sm" disabled={photoBusy} onClick={handleRemovePhoto}>
                Remove
              </Button>
            )}
          </div>
        </Card>

        <div className="mp-grid">
          <div className="mp-col">
            <Card className="mp-section-card">
              <form onSubmit={handleSaveName} noValidate>
                <Card.Header title="Display Name" subtitle="How your name appears across the app and on generated documents." />
                <Card.Body>
                  {banner && (
                    <Alert variant="danger" onClose={() => setBanner("")}>
                      {banner}
                    </Alert>
                  )}
                  <Input label="Full Name" required value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
                  <p className="mp-note">Email, designation, team and office are managed by your administrator.</p>
                </Card.Body>
                <Card.Footer className="mp-card-footer">
                  <Button type="submit" variant="primary" loading={saving} disabled={saving || name.trim() === profile.full_name}>
                    {saving ? "Saving…" : "Save Name"}
                  </Button>
                </Card.Footer>
              </form>
            </Card>

            <Card className="mp-section-card">
              <Card.Header title="Signature" subtitle="Used to sign the PDFs you generate." />
              <Card.Body>
                {signatureUrl ? (
                  <div className="mp-signature">
                    <img src={signatureUrl} alt="Your signature" />
                  </div>
                ) : (
                  <div className="mp-signature mp-signature-empty">No signature uploaded yet</div>
                )}
              </Card.Body>
              <Card.Footer className="mp-card-footer">
                <Button type="button" variant="secondary" onClick={() => setShowSignatureUpload(true)}>
                  {signatureUrl ? "Replace Signature" : "Upload Signature"}
                </Button>
              </Card.Footer>
            </Card>
          </div>

          <div className="mp-col">
            <div id="password" className="mp-anchor">
              <SetPasswordForm
                variant="section"
                heading="Change Password"
                subheading="Choose a new password for your account."
                submitLabel="Update Password"
                hookOptions={{ requireMarkChanged: false, redirectTo: null, requireCurrentPassword: true }}
                successMessage="Password updated successfully."
              />
            </div>

            <div id="pin" className="mp-anchor">
              <SetPinForm variant="section" hasPin={!!profile.pin_updated_at} />
            </div>
          </div>
        </div>
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          busy={photoBusy}
          onCancel={() => setCropFile(null)}
          onConfirm={handleCropConfirm}
        />
      )}

      {showSignatureUpload && (
        <SignatureUploadModal
          targetUserId={profile.id}
          targetName="you"
          onClose={() => setShowSignatureUpload(false)}
          onSuccess={async () => {
            setShowSignatureUpload(false);
            await refreshProfile();
          }}
        />
      )}
    </div>
  );
}
