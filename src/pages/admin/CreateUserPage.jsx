import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { ADMIN_CREATABLE_ROLES, ROLE_LABELS, OFFICES, OFFICE_LABELS, COMMITTEES } from "../../lib/roles";
import { useTeamOptions } from "../../hooks/useTeamOptions";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import TeamMultiSelect from "../../components/ui/TeamMultiSelect";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import "../../styles/CreateUserPage.css";

const EMPTY_FORM = { full_name: "", email: "", role: "", teams: [], office: "", committee: "" };
const SIGNATURE_TYPES = ["image/png", "image/jpeg"];

// Each team has one "home" office — picking a team auto-fills Office with
// it (still editable afterward, if the actual assignment differs).
const TEAM_OFFICE_MAP = {
  BPDD: "delhi",
  BIID: "delhi",
  LKN: "lucknow",
  HO: "mumbai",
};

function isValidEmail(val) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}

export default function CreateUserPage() {
  const roleOptions = useMemo(
    () => ADMIN_CREATABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] || r })),
    []
  );

  const officeOptions = OFFICES.map((o) => ({ value: o, label: OFFICE_LABELS[o] || o }));
  const teams = useTeamOptions();
  const committeeOptions = COMMITTEES.map((c) => ({ value: c, label: c }));

  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { emailSent, password? }
  const [banner, setBanner] = useState("");
  const [signatureFile, setSignatureFile] = useState(null);
  const [signatureError, setSignatureError] = useState("");

  function handleSignatureChange(e) {
    const file = e.target.files?.[0] || null;
    setSignatureError("");
    if (file && !SIGNATURE_TYPES.includes(file.type)) {
      setSignatureError("Signature must be a PNG or JPEG image.");
      setSignatureFile(null);
      return;
    }
    setSignatureFile(file);
  }

  function set(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setBanner("");
      setResult(null);

      const errs = {};
      if (!form.full_name.trim() || form.full_name.trim().length < 2) errs.full_name = "Enter the person's full name.";
      if (!isValidEmail(form.email)) errs.email = "Enter a valid email address.";
      if (!form.role) errs.role = "Select a role.";
      if (!form.office) errs.office = "Office is required for this role.";
      if (Object.keys(errs).length) {
        setErrors(errs);
        return;
      }
      setErrors({});
      setSaving(true);

      try {
        const { data, error } = await supabase.functions.invoke("create-staff-user", {
          body: {
            email: form.email.trim().toLowerCase(),
            full_name: form.full_name.trim(),
            role: form.role,
            teams: form.teams,
            office: form.office || null,
            committee: form.committee || null,
          },
        });

        if (error) {
          setBanner(await extractFunctionErrorMessage(error, "Failed to create account."));
          return;
        }
        if (!data?.success) {
          setBanner(data?.error || "Failed to create account.");
          return;
        }

        setResult({ emailSent: data.email_sent, password: data.password });
        setBanner(`Account created for ${form.full_name.trim()}.`);
        setForm(EMPTY_FORM);

        if (signatureFile && data.id) {
          const fd = new FormData();
          fd.set("user_id", data.id);
          fd.set("file", signatureFile, signatureFile.name);
          const { error: sigError } = await supabase.functions.invoke("upload-user-signature", { body: fd });
          if (sigError) {
            setBanner(`Account created for ${form.full_name.trim()}, but the signature upload failed — add it from Edit User.`);
          }
        }
        setSignatureFile(null);
      } catch (err) {
        setBanner(err.message || "Something went wrong. Please try again.");
      } finally {
        setSaving(false);
      }
    },
    [form]
  );

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>Create User</h1>
              <p>Create a staff account. A temporary password will be generated and emailed automatically.</p>
            </div>
            <Link to="/users" className="btn btn-secondary btn-sm">
              ← Back to Users
            </Link>
          </div>
        </div>

        {banner && (
          <Alert variant={result ? "success" : "danger"} onClose={() => setBanner("")}>
            {banner}
          </Alert>
        )}

        {result && !result.emailSent && (
          <Alert variant="warning" title="Email delivery failed — share this password manually">
            <p className="mb-2">
              The account was created, but the notification email could not be sent. This password will not be
              shown again — copy it now and share it securely with the new user.
            </p>
            <code className="cup-password">{result.password}</code>
          </Alert>
        )}

        <Card>
          <form onSubmit={handleSubmit} noValidate>
            <Card.Body>
              <div className="form-grid">
                <div className="field full">
                  <Input
                    label="Full Name"
                    required
                    value={form.full_name}
                    onChange={(e) => set("full_name", e.target.value)}
                    placeholder="e.g. Rajesh Kumar"
                    error={errors.full_name}
                    disabled={saving}
                  />
                </div>
                <div className="field full">
                  <label className="field-label" htmlFor="email">
                    Email <span className="required">*</span>
                  </label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="user@afcindia.org.in"
                    error={errors.email}
                    disabled={saving}
                  />
                </div>
                <div className="field">
                  <label className="field-label">
                    Designation <span className="required">*</span>
                  </label>
                  <Select
                    options={roleOptions}
                    value={form.role}
                    onChange={(v) => set("role", v)}
                    placeholder="Select designation"
                    error={errors.role}
                    disabled={saving}
                  />
                  {errors.role && <span className="field-error">{errors.role}</span>}
                </div>

                <div className="field">
                  <label className="field-label">
                    Team
                  </label>
                  <TeamMultiSelect
                    options={teams}
                    value={form.teams}
                    onChange={(v) => {
                      const office = TEAM_OFFICE_MAP[v[0]];
                      setForm((p) => ({ ...p, teams: v, office: office || p.office }));
                    }}
                    disabled={saving}
                    error={errors.team}
                  />
                  {errors.team && <span className="field-error">{errors.team}</span>}
                </div>
                <div className="field">
                  <label className="field-label">
                    Office <span className="required">*</span>
                  </label>
                  <Select
                    options={officeOptions}
                    value={form.office}
                    onChange={(v) => set("office", v)}
                    placeholder="Select office"
                    disabled={saving}
                    error={errors.office}
                  />
                  {errors.office && <span className="field-error">{errors.office}</span>}
                </div>
                <div className="field">
                  <label className="field-label">
                    Committee
                  </label>
                  <Select
                    options={[{ value: "", label: "— None —" }, ...committeeOptions]}
                    value={form.committee}
                    onChange={(v) => set("committee", v)}
                    placeholder="— None —"
                    disabled={saving}
                  />
                </div>
                <div className="field full">
                  <label className="field-label">
                    Signature
                  </label>
                  <label className="cup-file-drop">
                    <input type="file" accept="image/png,image/jpeg" onChange={handleSignatureChange} disabled={saving} />
                    {signatureFile ? signatureFile.name : "Click to upload a signature image (PNG or JPEG, optional)"}
                  </label>
                  {signatureError && <span className="field-error">{signatureError}</span>}
                </div>
              </div>
            </Card.Body>
            <Card.Footer>
              <Button type="submit" variant="primary" loading={saving} disabled={saving}>
                {saving ? "Creating…" : "Create Account"}
              </Button>
            </Card.Footer>
          </form>
        </Card>
      </div>
    </div>
  );
}
