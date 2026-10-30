import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import MentionInput from "../shared/MentionInput";
import { renderWithMentions } from "../../lib/mentions";
import { ChatIcon, CloseIcon, SendIcon, UserPlusIcon } from "../icons";
import { ROLE_LABELS } from "../../lib/roles";
// Reuses the generic ar-* card/field styles already defined for the Lead/
// Empanelment review pages, plus a handful of chat-bubble-specific classes
// added alongside them in the same file.
import "../../styles/ApplicationReviewPage.css";

function fmtTime(v) {
  return new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Renders nothing at all until the lead's chat has actually opened
// (chat_opened_at is set by advance-lead-stage once DGM clears the lead and
// forwards it to PMT) — before that, this lead has no chat to show.
//
// Rendered as a floating bubble (portaled to <body> so it sits above the
// page regardless of where it's mounted in the tree) rather than an inline
// card — clicking it pops the thread open, mirroring the chat widgets used
// on most websites.
export default function LeadChatPanel({ leadId, chatOpenedAt, locked }) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // Hidden by default — the bubble itself (not just sending) must wait for
  // an explicit "yes, you're on this lead's chat roster" rather than
  // assuming it while the check is in flight, since whoever can see the
  // lead page at all (org-wide for DGM/AGM/GM/SRM) is not necessarily on
  // its chat roster — see is_lead_chat_participant / can_view_lead_chat.
  const [isParticipant, setIsParticipant] = useState(false);
  // "Add member" picker (PMT only) — shown in place of the message list.
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState(null);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [addingId, setAddingId] = useState(null);
  const canAddMembers = profile?.committee === "PMT" && !locked;
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const widgetRef = useRef(null);

  const participantNames = Object.fromEntries(participants.map((p) => [p.user_id, p.full_name]));

  const fetchMessages = useCallback(async () => {
    if (!chatOpenedAt) return;
    // Sender names are resolved via a dedicated RPC rather than an
    // embedded PostgREST join (`sender:sender_id(full_name)`) — the join
    // is subject to afc_users' own RLS, which doesn't grant a plain
    // team-scoped viewer visibility into a cross-team chat participant's
    // row, so it silently came back null for anyone outside the viewer's
    // team (see get_lead_chat_participant_names in the migrations). The
    // same RPC also doubles as the @mention roster (role + avatar_path).
    const [{ data }, { data: participantRows }] = await Promise.all([
      supabase
        .from("lead_chat_messages")
        .select("*")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true }),
      supabase.rpc("get_lead_chat_participant_names", { p_lead_id: leadId }),
    ]);
    setMessages(data || []);
    setParticipants(participantRows || []);
    setLoading(false);
    setUnreadCount(0);
    // Best-effort — opening the popup counts as "read", clearing the
    // unread badge on the leads list (and this bubble's own badge). A
    // failure here (e.g. the caller isn't actually a chat participant)
    // must never block rendering the messages that were just fetched
    // successfully above.
    supabase.rpc("mark_lead_chat_read", { p_lead_id: leadId }).then(() => {}, () => {});
  }, [leadId, chatOpenedAt]);

  // Unread count for just this lead — keeps the badge on the closed bubble
  // in sync without marking anything read (that only happens on open).
  const fetchUnreadCount = useCallback(async () => {
    if (!chatOpenedAt) return;
    const { data } = await supabase.rpc("lead_chat_unread_counts");
    const row = (data || []).find((r) => r.lead_id === leadId);
    setUnreadCount(row?.unread_count || 0);
  }, [leadId, chatOpenedAt]);

  useEffect(() => {
    if (!chatOpenedAt) {
      setIsParticipant(false);
      return;
    }
    let cancelled = false;
    supabase.rpc("is_lead_chat_participant", { p_lead_id: leadId }).then(({ data }) => {
      if (!cancelled) setIsParticipant(!!data);
    });
    return () => {
      cancelled = true;
    };
  }, [leadId, chatOpenedAt]);

  useEffect(() => {
    if (!chatOpenedAt) return;
    fetchUnreadCount();
  }, [chatOpenedAt, fetchUnreadCount]);

  useEffect(() => {
    if (!chatOpenedAt || !isParticipant) return undefined;
    const channel = supabase
      .channel(`lead-chat-${leadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lead_chat_messages", filter: `lead_id=eq.${leadId}` },
        () => (open ? fetchMessages() : fetchUnreadCount())
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [leadId, chatOpenedAt, isParticipant, open, fetchMessages, fetchUnreadCount]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages]);

  // Click-outside-to-close, like a typical website chat widget. The FAB
  // itself is inside widgetRef too, so clicking it to close is handled by
  // toggleOpen below, not this listener.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (widgetRef.current && !widgetRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (!chatOpenedAt || !isParticipant) return null;

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    setAdding(false);
    if (next) fetchMessages();
  }

  async function openAddMember() {
    setAdding(true);
    setCandidateQuery("");
    setCandidates(null);
    const { data, error } = await supabase.rpc("get_lead_chat_add_candidates", { p_lead_id: leadId });
    if (error) {
      showToast("Couldn't load people to add.", "danger");
      setAdding(false);
      return;
    }
    setCandidates(data || []);
  }

  async function addMember(user) {
    setAddingId(user.user_id);
    try {
      const { data, error } = await supabase.functions.invoke("add-lead-chat-member", {
        body: { lead_id: leadId, user_id: user.user_id },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to add member."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to add member.", "danger");
        return;
      }
      showToast(`${user.full_name} added to the discussion.`, "success");
      setAdding(false);
      fetchMessages();
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setAddingId(null);
    }
  }

  const q = candidateQuery.trim().toLowerCase();
  const filteredCandidates = (candidates || []).filter(
    (c) => !q || [c.full_name, c.team, ROLE_LABELS[c.role] || c.role].some((v) => v?.toLowerCase().includes(q))
  );

  async function send() {
    const message = draft.trim();
    if (!message) return;
    const mentionedUserIds = inputRef.current?.getMentionedIds(message) || [];
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-lead-chat-message", {
        body: { lead_id: leadId, message, mentioned_user_ids: mentionedUserIds },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to send message."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to send message.", "danger");
        return;
      }
      setDraft("");
      inputRef.current?.clearMentions();
      inputRef.current?.resetHeight();
      fetchMessages();
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="ar-chat-widget" ref={widgetRef}>
      {open && (
        <div className="ar-chat-popup" role="dialog" aria-label="Lead discussion">
          <div className="ar-chat-popup-header">
            <span className="ar-chat-popup-title">{adding ? "Add to Discussion" : "Discussion"}</span>
            <div className="ar-chat-popup-actions">
              {canAddMembers && !adding && (
                <button type="button" className="ar-chat-icon-btn" aria-label="Add member" title="Add member" onClick={openAddMember}>
                  <UserPlusIcon />
                </button>
              )}
              <button
                type="button"
                className="ar-chat-icon-btn"
                aria-label={adding ? "Back to discussion" : "Close chat"}
                title={adding ? "Back to discussion" : "Close"}
                onClick={() => (adding ? setAdding(false) : setOpen(false))}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          {adding ? (
            <div className="ar-chat-add">
              <input
                type="search"
                className="ar-chat-input ar-chat-add-search"
                placeholder="Search by name, team or role"
                value={candidateQuery}
                onChange={(e) => setCandidateQuery(e.target.value)}
                autoFocus
              />
              <div className="ar-chat-add-list">
                {candidates === null ? (
                  <p className="ar-empty-text">Loading people…</p>
                ) : filteredCandidates.length === 0 ? (
                  <p className="ar-empty-text">{candidates.length ? "No one matches." : "Everyone is already in this chat."}</p>
                ) : (
                  filteredCandidates.map((c) => (
                    <button key={c.user_id} type="button" className="ar-chat-add-row" disabled={!!addingId} onClick={() => addMember(c)}>
                      <span className="ar-chat-add-name">{c.full_name}</span>
                      <span className="ar-chat-add-meta">
                        {ROLE_LABELS[c.role] || c.role}
                        {c.team && ` · ${c.team}`}
                      </span>
                      {addingId === c.user_id && <span className="ar-chat-add-busy">Adding…</span>}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
          <div className="ar-chat-messages">
            {loading ? (
              <p className="ar-empty-text">Loading messages…</p>
            ) : messages.length === 0 ? (
              <p className="ar-empty-text">No messages yet.</p>
            ) : (
              messages.map((m) => {
                const isOwn = m.sender_id === profile?.id;
                return (
                  <div key={m.id} className={`ar-chat-msg${isOwn ? " ar-chat-msg-own" : ""}`}>
                    <div className="ar-chat-bubble">
                      <span className="ar-chat-sender">{participantNames[m.sender_id] || "Unknown"}</span>
                      <p className="ar-chat-text">{renderWithMentions(m.message, participants)}</p>
                      <span className="ar-chat-time">{fmtTime(m.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>
          )}

          {adding ? null : locked ? (
            <p className="ar-chat-locked">Chat closed — this lead has been approved.</p>
          ) : (
            <div className="ar-chat-input-row">
              <MentionInput
                ref={inputRef}
                className="ar-chat-input"
                value={draft}
                onChange={setDraft}
                onEnterSend={send}
                participants={participants}
                selfId={profile?.id}
                placeholder="Type a message… use @ to tag someone"
                disabled={sending}
              />
              <button
                type="button"
                className="ar-chat-send-btn"
                aria-label="Send message"
                disabled={sending || !draft.trim()}
                onClick={send}
              >
                <SendIcon />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Hidden while open — the panel header has its own close button. */}
      {!open && (
        <button
          type="button"
          className="ar-chat-fab"
          aria-label={unreadCount > 0 ? `Open chat, ${unreadCount} unread` : "Open chat"}
          onClick={toggleOpen}
        >
          <ChatIcon />
          {unreadCount > 0 && <span className="ar-chat-fab-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
        </button>
      )}
    </div>,
    document.body
  );
}
