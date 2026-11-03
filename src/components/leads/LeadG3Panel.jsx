// MD-only decision box for an open G3 escalation this lead is part of (see
// escalate-lead-to-g3) — lists every conflicting lead PMT flagged, team
// included, so MD can accept exactly one. Accepting auto-drops the rest
// (see resolve-g3-escalation). Nobody else gets an action here, including
// the PMT member who raised it — PMT loses visibility into the escalation
// (and this lead's chat) the moment it's created; see
// get_g3_escalation_for_lead's RLS gate.
import { useState, useEffect, useCallback } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import Card from "../ui/Card";
import Button from "../ui/Button";
import PinInput from "../ui/PinInput";

export default function LeadG3Panel({ leadId, leadStatus, onResolved }) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [escalation, setEscalation] = useState(null); // { id, pmtComment, members: [...] }
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState(null); // member lead_id with the PIN confirm open
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  const isMd = profile?.role === "md";

  const fetchEscalation = useCallback(async () => {
    if (!isMd) {
      setLoading(false);
      return;
    }
    const { data } = await supabase.rpc("get_g3_escalation_for_lead", { p_lead_id: leadId });
    setEscalation(
      data?.length
        ? {
            id: data[0].escalation_id,
            pmtComment: data[0].pmt_comment,
            members: data.map((r) => ({ id: r.member_lead_id, leadNumber: r.lead_number, title: r.title, team: r.team })),
          }
        : null
    );
    setLoading(false);
  }, [leadId, isMd]);

  // Re-checked whenever the lead's own status changes — the existing
  // leads-table realtime subscription on LeadDetailPage already triggers
  // that refetch, so this just rides along rather than opening its own
  // channel on the new tables.
  useEffect(() => {
    fetchEscalation();
  }, [fetchEscalation, leadStatus]);

  if (!isMd || loading || !escalation) return null;

  async function accept(memberLeadId) {
    if (!/^\d{4}$/.test(pin)) {
      showToast("Enter your 4-digit PIN.", "danger");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-g3-escalation", {
        body: { escalation_id: escalation.id, accepted_lead_id: memberLeadId, pin },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to resolve the escalation."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to resolve the escalation.", "danger");
        return;
      }
      showToast("Lead accepted — the other conflicting leads have been dropped.", "success");
      setAcceptingId(null);
      setPin("");
      fetchEscalation();
      onResolved?.();
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="ar-action-card">
      <Card.Header title="G3 Committee Review" />
      <Card.Body className="ar-action-body">
        {escalation.pmtComment && (
          <p className="ar-empty-text" style={{ marginBottom: "var(--space-3)" }}>PMT: &quot;{escalation.pmtComment}&quot;</p>
        )}
        {escalation.members.map((m) => (
          <div
            key={m.id}
            className="ar-field"
            style={{ borderBottom: "1px solid var(--border-primary)", paddingBottom: "var(--space-3)", marginBottom: "var(--space-3)" }}
          >
            <p style={{ margin: 0, fontWeight: 600 }}>{m.leadNumber} — {m.team}</p>
            <p className="ar-empty-text" style={{ margin: "2px 0 var(--space-2)" }}>{m.title}</p>
            {acceptingId === m.id ? (
              <>
                <PinInput label="Your Action PIN" required value={pin} onChange={setPin} disabled={busy} hint="Confirms it's really you" />
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                  <Button variant="primary" size="sm" loading={busy} disabled={busy} onClick={() => accept(m.id)}>
                    Confirm: Accept
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setAcceptingId(null); setPin(""); }}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="primary" size="sm" disabled={!!acceptingId} onClick={() => { setAcceptingId(m.id); setPin(""); }}>
                Accept
              </Button>
            )}
          </div>
        ))}
      </Card.Body>
    </Card>
  );
}
