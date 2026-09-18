// Cross-team query card on the lead detail page — lets a DGM/AGM/SRM who
// isn't on this lead's team raise a query with a justification (see
// raise-lead-query), and lets PMT triage any open queries: add the raiser
// to the chat, decline, or transfer the lead outright (see
// respond-lead-query). The raiser can also edit, withdraw, or send PMT a
// reminder on their own still-open query (see update-lead-query) — only
// one open query per raiser per lead is allowed, so once it's sent, "Raise
// a Query" gives way to managing the existing one instead. Point of
// contact for the "another team spotted a duplicate" workflow — see
// 20260928000200_lead_org_wide_visibility.sql for why a DGM/AGM/PMT member
// can even see this lead to begin with. Sits at the top of the right
// column, above "Your Action", so PMT can't miss it.
import { useState, useEffect, useCallback } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import Card from "../ui/Card";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import "../../styles/LeadQueryPanel.css";

const QUERY_RAISER_ROLES = ["dgm", "general_manager", "agm", "srm"];

const STATUS_BADGE = {
  open: { label: "Open", variant: "warning" },
  added_to_chat: { label: "Added to Chat", variant: "info" },
  transferred: { label: "Transferred", variant: "success" },
  declined: { label: "Declined", variant: "danger" },
  withdrawn: { label: "Withdrawn", variant: "neutral" },
};

const RESPOND_LABEL = {
  add_to_chat: "Add to chat",
  transfer: "Transfer lead",
  decline: "Decline",
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
  const [respondingId, setRespondingId] = useState(null); // { queryId, action } — PMT's own triage actions
  const [responseText, setResponseText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null); // queryId currently being edited by its raiser
  const [editText, setEditText] = useState("");
  const [withdrawingId, setWithdrawingId] = useState(null); // queryId pending withdraw confirmation
  const [managingId, setManagingId] = useState(null); // queryId with an edit/withdraw/remind call in flight

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

  const myOpenQuery = queries.find((q) => q.raised_by_id === profile?.id && q.status === "open");
  const canRaise = QUERY_RAISER_ROLES.includes(profile?.role) && !profile?.teams?.includes(leadTeam) && !myOpenQuery;
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

  async function manageQuery(queryId, action, extra) {
    setManagingId(queryId);
    try {
      const { data, error } = await supabase.functions.invoke("update-lead-query", {
        body: { query_id: queryId, action, ...extra },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Action failed."), "danger");
        return false;
      }
      if (!data?.success) {
        showToast(data?.error || "Action failed.", "danger");
        return false;
      }
      showToast(
        action === "edit" ? "Query updated." : action === "withdraw" ? "Query withdrawn." : "Reminder sent to PMT.",
        "success"
      );
      fetchQueries();
      return true;
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
      return false;
    } finally {
      setManagingId(null);
    }
  }

  async function saveEdit(queryId) {
    if (!editText.trim()) {
      showToast("A justification is required.", "danger");
      return;
    }
    const ok = await manageQuery(queryId, "edit", { justification: editText.trim() });
    if (ok) {
      setEditingId(null);
      setEditText("");
    }
  }

  async function confirmWithdraw(queryId) {
    const ok = await manageQuery(queryId, "withdraw");
    if (ok) setWithdrawingId(null);
  }

  if (loading) return null;
  if (!queries.length && !canRaise) return null;

  return (
    <Card>
      <Card.Header title="Cross-Team Query" />
      <Card.Body>
        {canRaise && !showRaiseForm && (
          <Button className="lq-raise-btn" variant="secondary" size="sm" onClick={() => setShowRaiseForm(true)}>
            Raise a Query
          </Button>
        )}
        {canRaise && showRaiseForm && (
          <div className="lq-form">
            <label className="ar-label">Justification <span className="ar-required">*</span></label>
            <textarea
              className="input"
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Why do you think your team should take this up?"
              disabled={raising}
            />
            <div className="lq-form-actions">
              <Button variant="primary" size="sm" loading={raising} disabled={raising} onClick={submitQuery}>
                Submit Query
              </Button>
              <Button variant="secondary" size="sm" disabled={raising} onClick={() => { setShowRaiseForm(false); setJustification(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {queries.length > 0 && (
          <div className="lq-list" style={canRaise ? { marginTop: "var(--space-4)" } : undefined}>
            {queries.map((q) => {
              const isMine = q.raised_by_id === profile?.id;
              const isEditing = editingId === q.id;
              const isWithdrawing = withdrawingId === q.id;
              const rowBusy = managingId === q.id;
              return (
                <div key={q.id} className="lq-item">
                  <div className="lq-item-top">
                    <div className="lq-item-who">
                      <span className="lq-item-name">{q.raiser?.full_name || "Unknown"} — {q.raised_by_team}</span>
                      <span className="lq-item-meta">
                        {fmtTime(q.created_at)}
                        {q.edited_at && ` · edited ${fmtTime(q.edited_at)}`}
                        {q.removed_at && ` · withdrawn ${fmtTime(q.removed_at)}`}
                      </span>
                    </div>
                    <Badge variant={STATUS_BADGE[q.status]?.variant || "neutral"}>{STATUS_BADGE[q.status]?.label || q.status}</Badge>
                  </div>

                  {isEditing ? (
                    <div className="lq-respond-form">
                      <textarea
                        className="input"
                        rows={3}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        disabled={rowBusy}
                      />
                      <div className="lq-form-actions">
                        <Button variant="primary" size="sm" loading={rowBusy} disabled={rowBusy} onClick={() => saveEdit(q.id)}>
                          Save
                        </Button>
                        <Button variant="secondary" size="sm" disabled={rowBusy} onClick={() => { setEditingId(null); setEditText(""); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="lq-item-text">{q.justification}</p>
                  )}

                  {q.pmt_response && (
                    <div className="lq-item-response">
                      <span className="lq-item-response-label">PMT:</span>
                      <span>{q.pmt_response}</span>
                    </div>
                  )}

                  {isMine && q.status === "open" && !isEditing && (
                    isWithdrawing ? (
                      <div className="lq-item-actions">
                        <span className="lq-item-response-label">Withdraw this query?</span>
                        <Button variant="danger" size="sm" loading={rowBusy} disabled={rowBusy} onClick={() => confirmWithdraw(q.id)}>
                          Confirm Withdraw
                        </Button>
                        <Button variant="secondary" size="sm" disabled={rowBusy} onClick={() => setWithdrawingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="lq-item-actions">
                        <Button variant="secondary" size="sm" disabled={rowBusy} onClick={() => { setEditingId(q.id); setEditText(q.justification); }}>
                          Edit
                        </Button>
                        <Button variant="secondary" size="sm" loading={rowBusy} disabled={rowBusy} onClick={() => manageQuery(q.id, "remind")}>
                          Send Reminder
                        </Button>
                        <Button variant="danger" size="sm" disabled={rowBusy} onClick={() => setWithdrawingId(q.id)}>
                          Withdraw
                        </Button>
                      </div>
                    )
                  )}

                  {isPmt && q.status === "open" && (
                    respondingId?.queryId === q.id ? (
                      <div className="lq-respond-form">
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
                        <div className="lq-form-actions">
                          <Button variant="primary" size="sm" loading={busy} disabled={busy} onClick={() => respond(q.id, respondingId.action)}>
                            Confirm: {RESPOND_LABEL[respondingId.action]}
                          </Button>
                          <Button variant="secondary" size="sm" disabled={busy} onClick={() => { setRespondingId(null); setResponseText(""); }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="lq-item-actions">
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
              );
            })}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
