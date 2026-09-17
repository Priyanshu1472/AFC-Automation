// Cross-team query card on the lead detail page — lets a DGM/AGM/SRM who
// isn't on this lead's team raise a query with a justification (see
// raise-lead-query), and lets PMT triage any open queries: add the raiser
// to the chat, decline, or transfer the lead outright (see
// respond-lead-query). Point of contact for the "another team spotted a
// duplicate" workflow — see 20260928000200_lead_org_wide_visibility.sql for
// why a DGM/AGM/PMT member can even see this lead to begin with.
import { useState, useEffect, useCallback } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import Card from "../ui/Card";
import Badge from "../ui/Badge";
import Button from "../ui/Button";

const QUERY_RAISER_ROLES = ["dgm", "agm", "srm"];

const STATUS_BADGE = {
  open: { label: "Open", variant: "warning" },
  added_to_chat: { label: "Added to Chat", variant: "info" },
  transferred: { label: "Transferred", variant: "success" },
  declined: { label: "Declined", variant: "danger" },
};

function fmtTime(v) {
  return new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function LeadQueryPanel({ leadId, leadTeam, onLeadTransferred }) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [queries, setQueries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRaiseForm, setShowRaiseForm] = useState(false);
  const [justification, setJustification] = useState("");
  const [raising, setRaising] = useState(false);
  const [respondingId, setRespondingId] = useState(null); // { queryId, action }
  const [responseText, setResponseText] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchQueries = useCallback(async () => {
    const { data } = await supabase
      .from("lead_queries")
      .select("*, raiser:raised_by_id(full_name), resolver:resolved_by_id(full_name)")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });
    setQueries(data || []);
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    fetchQueries();
  }, [fetchQueries]);

  useEffect(() => {
    const channel = supabase
      .channel(`lead-queries-${leadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_queries", filter: `lead_id=eq.${leadId}` }, () => fetchQueries())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [leadId, fetchQueries]);

  const canRaise = QUERY_RAISER_ROLES.includes(profile?.role) && !profile?.teams?.includes(leadTeam);
  const isPmt = profile?.committee === "PMT" || ["md", "admin"].includes(profile?.role);

  async function submitQuery() {
    if (!justification.trim()) {
      showToast("A justification is required.", "danger");
      return;
    }
    setRaising(true);
    try {
      const { data, error } = await supabase.functions.invoke("raise-lead-query", {
        body: { lead_id: leadId, justification: justification.trim() },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to raise query."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to raise query.", "danger");
        return;
      }
      showToast("Query raised — PMT has been notified.", "success");
      setJustification("");
      setShowRaiseForm(false);
      fetchQueries();
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setRaising(false);
    }
  }

  async function respond(queryId, action) {
    if (action !== "add_to_chat" && !responseText.trim()) {
      showToast("A response is required.", "danger");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("respond-lead-query", {
        body: { query_id: queryId, action, response: responseText.trim() },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Action failed."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Action failed.", "danger");
        return;
      }
      showToast(
        action === "add_to_chat" ? "Raiser added to the lead discussion." : action === "decline" ? "Query declined." : "Lead transferred.",
        "success"
      );
      setRespondingId(null);
      setResponseText("");
      fetchQueries();
      if (action === "transfer" && onLeadTransferred) onLeadTransferred();
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;
  if (!queries.length && !canRaise) return null;

  return (
    <Card>
      <Card.Header title="Cross-Team Query" />
      <Card.Body className="ar-detail-body">
        {canRaise && !showRaiseForm && (
          <Button variant="secondary" size="sm" onClick={() => setShowRaiseForm(true)}>
            Raise a Query
          </Button>
        )}
        {canRaise && showRaiseForm && (
          <div className="ar-field">
            <label className="ar-label">Justification <span className="ar-required">*</span></label>
            <textarea
              className="input"
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Why do you think your team should take this up?"
              disabled={raising}
            />
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              <Button variant="primary" size="sm" loading={raising} disabled={raising} onClick={submitQuery}>
                Submit Query
              </Button>
              <Button variant="secondary" size="sm" disabled={raising} onClick={() => { setShowRaiseForm(false); setJustification(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {queries.map((q) => (
          <div key={q.id} className="ar-row" style={{ flexDirection: "column", alignItems: "flex-start", gap: "var(--space-1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
              <span className="ar-row-label">{q.raiser?.full_name || "Unknown"} ({q.raised_by_team}) — {fmtTime(q.created_at)}</span>
              <Badge variant={STATUS_BADGE[q.status]?.variant || "neutral"}>{STATUS_BADGE[q.status]?.label || q.status}</Badge>
            </div>
            <span className="ar-row-value">{q.justification}</span>
            {q.pmt_response && <span className="ar-row-value" style={{ opacity: 0.75 }}>PMT: {q.pmt_response}</span>}

            {isPmt && q.status === "open" && (
              respondingId?.queryId === q.id ? (
                <div className="ar-field" style={{ width: "100%" }}>
                  {respondingId.action !== "add_to_chat" && (
                    <textarea
                      className="input"
                      rows={2}
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Response / reason…"
                      disabled={busy}
                    />
                  )}
                  <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                    <Button variant="primary" size="sm" loading={busy} disabled={busy} onClick={() => respond(q.id, respondingId.action)}>
                      Confirm
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setRespondingId(null); setResponseText(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}>
                  <Button variant="secondary" size="sm" onClick={() => setRespondingId({ queryId: q.id, action: "add_to_chat" })}>
                    Add to Chat
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => setRespondingId({ queryId: q.id, action: "transfer" })}>
                    Transfer Lead
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setRespondingId({ queryId: q.id, action: "decline" })}>
                    Decline
                  </Button>
                </div>
              )
            )}
          </div>
        ))}
      </Card.Body>
    </Card>
  );
}
