// Cross-team query card on the lead detail page — lets a DGM/AGM/SRM who
// isn't on this lead's team raise a query with a justification (see
// raise-lead-query), and lets PMT triage any open queries: add the raiser
// to the chat, decline, or request a transfer that MD then approves or
// rejects — MD transfers outright (see respond-lead-query). The raiser can also edit, withdraw, or send PMT a
// reminder on their own still-open query (see update-lead-query) — only
// one open query per raiser per lead is allowed, so once it's sent, "Raise
// a Query" gives way to managing the existing one instead. Point of
// contact for the "another team spotted a duplicate" workflow — see
// 20260928000200_lead_org_wide_visibility.sql for why a DGM/AGM/PMT member
// can even see this lead to begin with. Sits at the top of the right
// column, above "Your Action", so PMT can't miss it. Queries are visible only
// to PMT, MD and the raiser — never the lead's own team (lead_queries_select,
// see 20261030050000_lead_queries_private_to_pmt_md_raiser.sql) — so for
// them this card renders nothing.
import { useState, useEffect, useCallback } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import Card from "../ui/Card";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import PinInput from "../ui/PinInput";
import Select from "../ui/Select";
import { ROLE_LABELS } from "../../lib/roles";
import { useTeamOptions } from "../../hooks/useTeamOptions";
import "../../styles/LeadQueryPanel.css";

const QUERY_RAISER_ROLES = ["dgm", "general_manager", "agm", "srm"];

const STATUS_BADGE = {
  open: { label: "Open", variant: "warning" },
  added_to_chat: { label: "Added to Chat", variant: "info" },
  transfer_pending: { label: "Transfer Awaiting MD", variant: "warning" },
  transferred: { label: "Transferred", variant: "success" },
  declined: { label: "Declined", variant: "danger" },
  withdrawn: { label: "Withdrawn", variant: "neutral" },
};

const RESPOND_LABEL = {
  add_to_chat: "Add to chat",
  transfer: "Transfer lead",
  request_transfer: "Forward to MD",
  decline: "Decline",
  approve_transfer: "Approve transfer",
  reject_transfer: "Reject transfer",
};

const PIN_ACTIONS = ["transfer", "approve_transfer"];
const OPTIONAL_REMARK_ACTIONS = ["add_to_chat", "approve_transfer"];

function fmtTime(v) {
  return new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function LeadQueryPanel({ leadId, leadTeam, onLeadTransferred }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const teamOptions = useTeamOptions();

  const [queries, setQueries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRaiseForm, setShowRaiseForm] = useState(false);
  const [justification, setJustification] = useState("");
  const [raising, setRaising] = useState(false);
  const [respondingId, setRespondingId] = useState(null); // { queryId, action } — PMT's own triage actions
  const [responseText, setResponseText] = useState("");
  const [transferPin, setTransferPin] = useState("");
  const [transferTeam, setTransferTeam] = useState("");
  const [transferForwardToId, setTransferForwardToId] = useState("");
  const [transferForwardOptions, setTransferForwardOptions] = useState([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null); // queryId currently being edited by its raiser
  const [editText, setEditText] = useState("");
  const [withdrawingId, setWithdrawingId] = useState(null); // queryId pending withdraw confirmation
  const [managingId, setManagingId] = useState(null); // queryId with an edit/withdraw/remind call in flight

  const [queryNames, setQueryNames] = useState({});

  const fetchQueries = useCallback(async () => {
    // Raiser/resolver names via a dedicated RPC, not an embedded join —
    // raising a query is inherently cross-team, exactly the case where the
    // viewer's own afc_users RLS won't otherwise let them read that
    // profile (see get_lead_query_names in the migrations).
    const [{ data }, { data: names }] = await Promise.all([
      supabase
        .from("lead_queries")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false }),
      supabase.rpc("get_lead_query_names", { p_lead_id: leadId }),
    ]);
    setQueries(data || []);
    setQueryNames(Object.fromEntries((names || []).map((n) => [n.user_id, n.full_name])));
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    fetchQueries();
  }, [fetchQueries]);

  // Forward-to options reload whenever the target team changes — a person
  // valid for one team isn't necessarily on another. Skipped for a non-MD
  // "Forward to MD" request — there the team/forward-to picker is hidden
  // and both are set implicitly to the raiser's own team/id (see the
  // "transfer" button's onClick below), so this effect must not wipe that
  // default out from under it.
  useEffect(() => {
    if (respondingId?.action === "transfer" && profile?.role !== "md") return;
    if (!transferTeam) {
      setTransferForwardOptions([]);
      return;
    }
    setTransferForwardToId("");
    supabase
      .rpc("get_team_members", { p_team: transferTeam })
      .then(({ data }) =>
        setTransferForwardOptions((data || []).map((u) => ({ value: u.user_id, label: u.full_name, hint: ROLE_LABELS[u.role] || u.role })))
      );
  }, [transferTeam, respondingId, profile?.role]);

  useEffect(() => {
    const channel = supabase
      .channel(`lead-queries-${leadId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_queries", filter: `lead_id=eq.${leadId}` }, () => fetchQueries())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [leadId, fetchQueries]);

  // Only one open query per lead at a time, from anyone — matches
  // raise-lead-query's own existingOpen check, which is lead-wide, not
  // scoped to just this viewer.
  const anyOpenQuery = queries.find((q) => q.status === "open" || q.status === "transfer_pending");
  const canRaise = QUERY_RAISER_ROLES.includes(profile?.role) && !profile?.teams?.includes(leadTeam) && !anyOpenQuery;
  const isPmt = profile?.committee === "PMT" || ["md", "admin"].includes(profile?.role);
  // MD transfers outright; everyone else on the PMT side only requests it.
  const isMd = profile?.role === "md";

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
    if (!OPTIONAL_REMARK_ACTIONS.includes(action) && !responseText.trim()) {
      showToast("A response is required.", "danger");
      return;
    }
    if (action === "transfer") {
      if (!transferTeam) {
        showToast("Select a team to transfer to.", "danger");
        return;
      }
      if (!transferForwardToId) {
        showToast("Select who to forward the lead to.", "danger");
        return;
      }
    }
    if (PIN_ACTIONS.includes(action) && !/^\d{4}$/.test(transferPin)) {
      showToast("Enter your 4-digit PIN.", "danger");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("respond-lead-query", {
        body: {
          query_id: queryId,
          action,
          response: responseText.trim(),
          ...(PIN_ACTIONS.includes(action) ? { pin: transferPin } : {}),
          ...(action === "transfer" ? { target_team: transferTeam, forwarded_to_id: transferForwardToId } : {}),
        },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Action failed."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Action failed.", "danger");
        return;
      }
      const toast = {
        add_to_chat: "Raiser added to the lead discussion.",
        decline: "Query declined.",
        transfer: data.pending ? "Transfer request sent to MD for approval." : "Lead transferred.",
        approve_transfer: "Transfer approved — lead transferred.",
        reject_transfer: "Transfer request rejected.",
      };
      showToast(toast[action], "success");
      setRespondingId(null);
      setResponseText("");
      setTransferPin("");
      setTransferTeam("");
      setTransferForwardToId("");
      fetchQueries();
      if (((action === "transfer" && !data.pending) || action === "approve_transfer") && onLeadTransferred) onLeadTransferred();
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
                      <span className="lq-item-name">{queryNames[q.raised_by_id] || "Unknown"} — {q.raised_by_team}</span>
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
                      <span className="lq-item-response-label">{q.resolved_by_role === "md" ? "MD:" : "PMT:"}</span>
                      <span>{q.pmt_response}</span>
                    </div>
                  )}

                  {q.status === "transfer_pending" && (
                    <div className="lq-item-response">
                      <span className="lq-item-response-label">Requested:</span>
                      <span>
                        Transfer to {q.transfer_target_team}, forward to {queryNames[q.transfer_forwarded_to_id] || "—"}
                        {queryNames[q.resolved_by_id] && ` (by ${queryNames[q.resolved_by_id]})`} — awaiting MD approval
                      </span>
                    </div>
                  )}

                  {q.md_decided_at && (
                    <div className="lq-item-response">
                      <span className="lq-item-response-label">MD:</span>
                      <span>
                        {q.status === "transferred" ? "Approved" : "Transfer rejected"}
                        {q.md_response && ` — ${q.md_response}`}
                      </span>
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

                  {((isPmt && (q.status === "open" || q.status === "added_to_chat")) || (isMd && q.status === "transfer_pending")) && (
                    respondingId?.queryId === q.id ? (
                      <div className="lq-respond-form">
                        {respondingId.action !== "add_to_chat" && (
                          <>
                            <label className="ar-label">
                              Remarks {!OPTIONAL_REMARK_ACTIONS.includes(respondingId.action) && <span className="ar-required">*</span>}
                            </label>
                            <textarea
                              className="input"
                              rows={2}
                              value={responseText}
                              onChange={(e) => setResponseText(e.target.value)}
                              placeholder="Response / reason…"
                              disabled={busy}
                            />
                          </>
                        )}
                        {respondingId.action === "transfer" && isMd && (
                          <>
                            <label className="ar-label">Team <span className="ar-required">*</span></label>
                            <Select
                              options={teamOptions.map((t) => ({ value: t, label: t }))}
                              value={transferTeam}
                              onChange={setTransferTeam}
                              placeholder="— Select team —"
                              disabled={busy}
                            />
                            <label className="ar-label">Forward to: <span className="ar-required">*</span></label>
                            <Select
                              options={transferForwardOptions}
                              value={transferForwardToId}
                              onChange={setTransferForwardToId}
                              placeholder="— Select a person on that team —"
                              disabled={busy || !transferTeam}
                              searchable
                            />
                          </>
                        )}
                        {PIN_ACTIONS.includes(respondingId.action) && (
                          <PinInput
                            label="Your Action PIN"
                            required
                            value={transferPin}
                            onChange={setTransferPin}
                            disabled={busy}
                            hint="Confirms it's really you"
                          />
                        )}
                        <div className="lq-form-actions">
                          <Button variant="primary" size="sm" loading={busy} disabled={busy} onClick={() => respond(q.id, respondingId.action)}>
                            {respondingId.action === "transfer" && !isMd
                              ? RESPOND_LABEL.request_transfer
                              : `Confirm: ${RESPOND_LABEL[respondingId.action]}`}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setRespondingId(null);
                              setResponseText("");
                              setTransferPin("");
                              setTransferTeam("");
                              setTransferForwardToId("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : q.status === "transfer_pending" ? (
                      <div className="lq-item-actions">
                        <Button variant="primary" size="sm" onClick={() => setRespondingId({ queryId: q.id, action: "approve_transfer" })}>
                          Approve Transfer
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => setRespondingId({ queryId: q.id, action: "reject_transfer" })}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <div className="lq-item-actions">
                        {q.status === "open" && (
                          <Button variant="secondary" size="sm" onClick={() => setRespondingId({ queryId: q.id, action: "add_to_chat" })}>
                            Add to Chat
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setRespondingId({ queryId: q.id, action: "transfer" });
                            setTransferTeam(q.raised_by_team);
                            // Non-MD "Forward to MD" has no visible team/
                            // forward-to picker — default both to the
                            // raiser's own team/id (always a valid
                            // forwarded-to per validateForwardedTo).
                            if (!isMd) setTransferForwardToId(q.raised_by_id);
                          }}
                        >
                          {isMd ? "Transfer Lead" : "Forward to MD"}
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
