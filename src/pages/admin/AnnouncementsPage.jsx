import { useEffect, useState, useCallback } from "react";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { useToast } from "../../hooks/useToast";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";

function fmtWhen(val) {
  if (!val) return "";
  return new Date(val).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Super Admin only (route-guarded by MODULE_SETTINGS_ROLES in App.jsx;
// the actual send is enforced by send-announcement's own role check).
export default function AnnouncementsPage() {
  const { showToast } = useToast();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [last, setLast] = useState(null);
  const [ackCount, setAckCount] = useState(null);
  const [totalActive, setTotalActive] = useState(null);

  const fetchLast = useCallback(async () => {
    const { data: announcement } = await supabase
      .from("org_announcements")
      .select("id, items, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLast(announcement || null);
    if (!announcement) {
      setAckCount(null);
      setTotalActive(null);
      return;
    }
    const [{ count: acks }, { count: active }] = await Promise.all([
      supabase.from("org_announcement_acks").select("id", { count: "exact", head: true }).eq("announcement_id", announcement.id),
      supabase.from("afc_users").select("id", { count: "exact", head: true }).eq("is_active", true),
    ]);
    setAckCount(acks ?? 0);
    setTotalActive(active ?? 0);
  }, []);

  useEffect(() => {
    fetchLast();
  }, [fetchLast]);

  const items = draft.split("\n").map((l) => l.trim()).filter(Boolean);

  async function send() {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-announcement", { body: { items } });
      if (error) { showToast(await extractFunctionErrorMessage(error, "Failed to send."), "danger"); return; }
      if (!data?.success) { showToast(data?.error || "Failed to send.", "danger"); return; }
      showToast("Sent to every active user.", "success");
      setDraft("");
      fetchLast();
    } catch (err) {
      showToast(err.message || "Failed to send.", "danger");
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <h1>Important Updates</h1>
        </div>

        <Card>
          <Card.Header title="Send a new update" subtitle="Shown as a full-screen popup to every active user until they scroll through it and acknowledge. One update per line." />
          <Card.Body>
            <div className="field">
              <textarea
                className="input"
                rows={6}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={"e.g.\nFee notes now track the payment mode per line, not once for the whole note.\nLeads can have an additional Person Responsible, with the same actions as the named one."}
                disabled={sending}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="primary" disabled={items.length === 0 || sending} onClick={() => setConfirming(true)}>
                Send to Every Active User
              </Button>
            </div>
          </Card.Body>
        </Card>

        {last && (
          <Card style={{ marginTop: 16 }}>
            <Card.Header title="Last sent" subtitle={fmtWhen(last.created_at)} />
            <Card.Body>
              <ul style={{ margin: 0, paddingLeft: "1.25em", display: "flex", flexDirection: "column", gap: 8 }}>
                {last.items.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
              {ackCount != null && (
                <p className="text-secondary text-sm" style={{ marginTop: 16 }}>
                  Acknowledged by {ackCount} of {totalActive} active users.
                </p>
              )}
            </Card.Body>
          </Card>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Send this update?"
          message="Every active user will see this as a full-screen popup the next time they log in or return to the app. This can't be edited or withdrawn afterward, only replaced by sending a new one."
          confirmLabel="Send"
          variant="primary"
          loading={sending}
          onConfirm={send}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
