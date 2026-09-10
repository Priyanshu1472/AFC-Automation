import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import Button from "../ui/Button";
import { ChatIcon, CloseIcon } from "../icons";
// Reuses the generic ar-* card/field styles already defined for the Lead/
// Empanelment review pages — same styles LeadChatPanel reuses, this is
// deliberately the same widget, just pointed at proposal_chat_* instead of
// lead_chat_*.
import "../../styles/ApplicationReviewPage.css";

function fmtTime(v) {
  return new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Renders nothing at all until the proposal's chat has actually opened
// (chat_opened_at is set immediately on creation by create-proposal-
// preparation — unlike a lead's chat, a proposal has no earlier pipeline
// stage to wait on, so this is effectively always open from the moment the
// proposal exists).
//
// Rendered as a floating bubble (portaled to <body>) exactly like
// LeadChatPanel — see that component for the fuller rationale.
export default function ProposalChatPanel({ proposalId, chatOpenedAt, locked }) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const widgetRef = useRef(null);

  const MIN_INPUT_HEIGHT = 40;
  const MAX_INPUT_HEIGHT = 120;

  function resizeInput(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT)}px`;
  }

  const fetchMessages = useCallback(async () => {
    if (!chatOpenedAt) return;
    const { data } = await supabase
      .from("proposal_chat_messages")
      .select("*, sender:sender_id(full_name)")
      .eq("proposal_id", proposalId)
      .order("created_at", { ascending: true });
    setMessages(data || []);
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
    if (!chatOpenedAt) return;
    fetchUnreadCount();
  }, [chatOpenedAt, fetchUnreadCount]);

  useEffect(() => {
    if (!chatOpenedAt) return undefined;
    const channel = supabase
      .channel(`proposal-chat-${proposalId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "proposal_chat_messages", filter: `proposal_id=eq.${proposalId}` },
        () => (open ? fetchMessages() : fetchUnreadCount())
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [proposalId, chatOpenedAt, open, fetchMessages, fetchUnreadCount]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (widgetRef.current && !widgetRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (!chatOpenedAt) return null;

  function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) fetchMessages();
  }

  async function send() {
    const message = draft.trim();
    if (!message) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-proposal-chat-message", { body: { proposal_id: proposalId, message } });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to send message."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to send message.", "danger");
        return;
      }
      setDraft("");
      if (inputRef.current) inputRef.current.style.height = `${MIN_INPUT_HEIGHT}px`;
      fetchMessages();
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return createPortal(
    <div className="ar-chat-widget" ref={widgetRef}>
      {open && (
        <div className="ar-chat-popup" role="dialog" aria-label="Proposal discussion">
          <div className="ar-chat-popup-header">
            <span className="ar-chat-popup-title">Discussion</span>
            <button type="button" className="ar-chat-popup-close" aria-label="Close chat" onClick={() => setOpen(false)}>
              <CloseIcon />
            </button>
          </div>

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
                      <span className="ar-chat-sender">{m.sender?.full_name || "Unknown"}</span>
                      <p className="ar-chat-text">{m.message}</p>
                      <span className="ar-chat-time">{fmtTime(m.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {locked ? (
            <p className="ar-chat-locked">Chat closed — this proposal has been locked.</p>
          ) : (
            <div className="ar-chat-input-row">
              <textarea
                ref={inputRef}
                rows={1}
                className="ar-chat-input"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  resizeInput(e.target);
                }}
                onKeyDown={onKeyDown}
                placeholder="Type a message…"
                disabled={sending}
              />
              <Button variant="primary" size="sm" loading={sending} disabled={!draft.trim()} onClick={send}>
                Send
              </Button>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="ar-chat-fab"
        aria-label={open ? "Close chat" : unreadCount > 0 ? `Open chat, ${unreadCount} unread` : "Open chat"}
        onClick={toggleOpen}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
        {!open && unreadCount > 0 && <span className="ar-chat-fab-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
    </div>,
    document.body
  );
}
