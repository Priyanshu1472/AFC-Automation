import { useCallback, useMemo, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { MD_CREATABLE_ROLES, DGM_CREATABLE_ROLES, ROLE_LABELS, OFFICES } from "../../lib/roles";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import "../../styles/CreateUserPage.css";

const EMPTY_FORM = { full_name: "", email: "", role: "", team: "", office: "" };

function isValidEmail(val) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim());
}

export default function CreateUserPage() {
  const { profile } = useAuth();
  const isDgm = profile?.role === "dgm";

  const roleOptions = useMemo(() => {
    const roles = isDgm ? DGM_CREATABLE_ROLES : MD_CREATABLE_ROLES;
    return roles.map((r) => ({ value: r, label: ROLE_LABELS[r] || r }));
  }, [isDgm]);

  const officeOptions = OFFICES.map((o) => ({ value: o, label: o.charAt(0).toUpperCase() + o.slice(1) }));

  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null); // { emailSent, password? }
  const [banner, setBanner] = useState("");

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
      if (!isDgm && form.role !== "md" && !form.office) errs.office = "Office is required for this role.";
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
            // A DGM's team/office is forced server-side to their own values
            // regardless of what's sent here — these are only used for MD.
            team: isDgm ? profile.team : form.team || null,
            office: isDgm ? profile.office : form.office || null,
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
      } catch (err) {
        setBanner(err.message || "Something went wrong. Please try again.");
      } finally {
        setSaving(false);
      }
    },
    [form, isDgm, profile]
  );

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <h1>Create User</h1>
          <p>Create a staff account. A temporary password will be generated and emailed automatically.</p>
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
                  <Input
                    label="Email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="user@afcindia.org.in"
                    error={errors.email}
                    disabled={saving}
                  />
                </div>
                <div className="field">
                  <label className="field-label">
                    Role <span className="required">*</span>
                  </label>
                  <Select
                    options={roleOptions}
                    value={form.role}
                    onChange={(v) => set("role", v)}
                    placeholder="Select role"
                    error={errors.role}
                    disabled={saving}
                  />
                  {errors.role && <span className="field-error">{errors.role}</span>}
                </div>

                {isDgm ? (
                  <div className="field">
                    <label className="field-label">Team / Office</label>
                    <p className="text-sm text-secondary" style={{ paddingTop: 9 }}>
                      {profile.team} · {profile.office}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label className="field-label">Team</label>
                      <Input
                        value={form.team}
                        onChange={(e) => set("team", e.target.value)}
                        placeholder="e.g. BPDD (optional)"
                        disabled={saving || form.role === "md"}
                        error={errors.team}
                      />
                    </div>
                    <div className="field">
                      <label className="field-label">
                        Office {form.role !== "md" && <span className="required">*</span>}
                      </label>
                      <Select
                        options={officeOptions}
                        value={form.office}
                        onChange={(v) => set("office", v)}
                        placeholder="Select office"
                        disabled={saving || form.role === "md"}
                        error={errors.office}
                      />
                      {errors.office && <span className="field-error">{errors.office}</span>}
                    </div>
                  </>
                )}
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
