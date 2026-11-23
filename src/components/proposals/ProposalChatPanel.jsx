import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import MentionInput from "../shared/MentionInput";
import ChatMessageList from "../shared/ChatMessageList";
import { ChatIcon, CloseIcon, SendIcon, UsersIcon } from "../icons";
import { ROLE_LABELS } from "../../lib/roles";
// Same widget and ar-* styles as LeadChatPanel — pointed at
// proposal_chat_* instead of lead_chat_*.
import "../../styles/ApplicationReviewPage.css";

// The proposal's group chat, as a floating bubble (portaled to <body>)
// exactly like LeadChatPanel: a header with "People in this chat" and a
// close button, day dividers, and WhatsApp-style "X was added" lines
// whenever someone joins (named assignees and MD at creation, additional
// Persons Responsible, the Accounts Committee once money work reaches
// them).
//
// Only rendered for people on the roster (is_proposal_chat_participant) —
// anyone else who can view the proposal org-wide doesn't get a bubble.
// Closes when the proposal is locked (not when the deadline passes): the
// history stays readable, but nobody can post — send-proposal-chat-message
// enforces the same rule.
export default function ProposalChatPanel({ proposalId, chatOpenedAt, locked = false }) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [isParticipant, setIsParticipant] = useState(false);
  const [view, setView] = useState("chat"); // "chat" | "members"
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const widgetRef = useRef(null);

  const fetchMessages = useCallback(async () => {
    if (!chatOpenedAt) return;
    // Sender names via a dedicated RPC, not an embedded join — an embedded
    // `sender:sender_id(full_name)` join silently comes back null for a
    // participant the viewer's own afc_users RLS doesn't let them read. The
    // same RPC doubles as the @mention roster and the members list.
    const [{ data }, { data: participantRows }] = await Promise.all([
      supabase
        .from("proposal_chat_messages")
        .select("*")
        .eq("proposal_id", proposalId)
        .order("created_at", { ascending: true }),
      supabase.rpc("get_proposal_chat_participant_names", { p_proposal_id: proposalId }),
    ]);
    setMessages(data || []);
    setParticipants(participantRows || []);
    setLoading(false);
    setUnreadCount(0);
    supabase.rpc("mark_proposal_chat_read", { p_proposal_id: proposalId }).then(() => {}, () => {});
  }, [proposalId, chatOpenedAt]);

  const fetchUnreadCount = useCallback(async () => {
    if (!chatOpenedAt) return;
    const { data } = await supabase.rpc("proposal_chat_unread_counts");
    const row = (data || []).find((r) => r.proposal_id === proposalId);
    setUnreadCount(row?.unread_count || 0);
  }, [proposalId, chatOpenedAt]);

  useEffect(() => {
    if (!chatOpenedAt) {
      setIsParticipant(false);
      return undefined;
    }
    let cancelled = false;
    supabase.rpc("is_proposal_chat_participant", { p_proposal_id: proposalId }).then(({ data }) => {
      if (!cancelled) setIsParticipant(!!data);
    });
    return () => { cancelled = true; };
  }, [proposalId, chatOpenedAt]);

  useEffect(() => {
    if (!chatOpenedAt || !isParticipant) return;
    fetchUnreadCount();
  }, [chatOpenedAt, isParticipant, fetchUnreadCount]);

  useEffect(() => {
    if (!chatOpenedAt || !isParticipant) return undefined;
    const channel = supabase
      .channel(`proposal-chat-${proposalId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "proposal_chat_messages", filter: `proposal_id=eq.${proposalId}` },
        () => (open ? fetchMessages() : fetchUnreadCount())
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [proposalId, chatOpenedAt, isParticipant, open, fetchMessages, fetchUnreadCount]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, view]);

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
    setView("chat");
    if (next) fetchMessages();
  }

  async function send() {
    const message = draft.trim();
    if (!message) return;
    const mentionedUserIds = inputRef.current?.getMentionedIds(message) || [];
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-proposal-chat-message", {
        body: { proposal_id: proposalId, message, mentioned_user_ids: mentionedUserIds },
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
        <div className="ar-chat-popup" role="dialog" aria-label="Proposal discussion">
          <div className="ar-chat-popup-header">
            <span className="ar-chat-popup-title">
              {view === "members" ? `People in this Chat (${participants.length})` : "Discussion"}
            </span>
            <div className="ar-chat-popup-actions">
              {view === "chat" && (
                <button type="button" className="ar-chat-icon-btn" aria-label="People in this chat" title="People in this chat" onClick={() => setView("members")}>
                  <UsersIcon />
                </button>
              )}
              <button
                type="button"
                className="ar-chat-icon-btn"
                aria-label={view !== "chat" ? "Back to discussion" : "Close chat"}
                title={view !== "chat" ? "Back to discussion" : "Close"}
                onClick={() => (view !== "chat" ? setView("chat") : setOpen(false))}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          {view === "members" ? (
            <div className="ar-chat-add-list">
              {participants.map((p) => (
                <div key={p.user_id} className="ar-chat-add-row ar-chat-member-row">
                  <span className="ar-chat-add-name">
                    {p.full_name}
                    {p.user_id === profile?.id && <span className="ar-chat-add-you"> (You)</span>}
                  </span>
                  <span className="ar-chat-add-meta">
                    {ROLE_LABELS[p.role] || p.role}
                    {p.team && ` · ${p.team}`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <ChatMessageList messages={messages} participants={participants} selfId={profile?.id} loading={loading} bottomRef={bottomRef} />
          )}

          {view === "chat" && locked && (
            <p className="ar-chat-locked">Chat closed — this proposal has been locked.</p>
          )}

          {view === "chat" && !locked && (
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
