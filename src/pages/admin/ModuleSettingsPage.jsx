import { useState } from "react";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import PageLoader from "../../components/ui/PageLoader";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { useModules } from "../../context/ModulesContext";
import { supabase } from "../../lib/supabase";
import { MODULES, IS_PRODUCTION } from "../../lib/modules";

function fmtWhen(val) {
  if (!val) return "";
  return new Date(val).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Super Admin only (route-guarded by MODULE_SETTINGS_ROLES; writes are
// enforced by app_modules' RLS). The change applies to every open tab
// straight away via realtime — no redeploy.
export default function ModuleSettingsPage() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const { loading, storedEnabled, rows, setRow } = useModules();
  const [pending, setPending] = useState(null); // { key, label, next }
  const [saving, setSaving] = useState(false);

  async function apply() {
    if (!pending) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("app_modules")
      .update({ enabled: pending.next, updated_by: profile.id, updated_at: new Date().toISOString() })
      .eq("module_key", pending.key)
      .select("module_key, enabled, updated_at, updated_by")
      .maybeSingle();
    setSaving(false);
    if (error || !data) {
      showToast(`Couldn't update ${pending.label}. ${error?.message || "Permission denied."}`, "error");
    } else {
      setRow(data);
      showToast(`${pending.label} is now ${data.enabled ? "ON" : "OFF (Coming Soon)"}.`, "success");
    }
    setPending(null);
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <h1>Module Settings</h1>
          <p className="text-secondary">
            Switch portal modules ON or OFF. A module that's OFF is hidden from everyone and shows a &quot;Coming Soon&quot; page, even when opened by a direct link.
          </p>
        </div>

        {!IS_PRODUCTION && (
          <div className="card" style={{ padding: "12px 16px", marginBottom: 16, borderLeft: "4px solid var(--warning, #d97706)" }}>
            <strong>This is the staging environment.</strong>{" "}
            <span className="text-secondary">Every module is always ON here so staff can test everything. These switches only take effect on production.</span>
          </div>
        )}

        {loading ? (
          <PageLoader text="Loading modules…" />
        ) : (
          <Card>
            <Card.Body>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {MODULES.map((m, i) => {
                  const on = storedEnabled(m.key);
                  const row = rows[m.key];
                  return (
                    <li
                      key={m.key}
                      style={{
                        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                        padding: "14px 0", borderTop: i ? "1px solid var(--border, #e5e7eb)" : "none",
                      }}
                    >
                      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <strong>{m.label}</strong>
                          <Badge variant={on ? "success" : "neutral"} dot>{on ? "ON" : "Coming Soon"}</Badge>
                        </div>
                        <div className="text-secondary text-sm" style={{ marginTop: 4 }}>{m.description}</div>
                        {row?.updated_by && (
                          <div className="text-secondary text-sm" style={{ marginTop: 2 }}>Last changed {fmtWhen(row.updated_at)}</div>
                        )}
                      </div>
                      <Button
                        variant={on ? "secondary" : "primary"}
                        size="sm"
                        onClick={() => setPending({ key: m.key, label: m.label, next: !on })}
                      >
                        {on ? "Switch OFF" : "Switch ON"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Card.Body>
          </Card>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          title={pending.next ? `Switch ${pending.label} ON?` : `Switch ${pending.label} OFF?`}
          message={
            pending.next
              ? `${pending.label} will appear for everyone with access, right away.`
              : `${pending.label} will be hidden from everyone and show "Coming Soon", right away. No data is deleted.`
          }
          confirmLabel={pending.next ? "Switch ON" : "Switch OFF"}
          variant={pending.next ? "primary" : "danger"}
          loading={saving}
          onConfirm={apply}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
