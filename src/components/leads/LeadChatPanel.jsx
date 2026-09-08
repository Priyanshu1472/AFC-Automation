import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import Button from "../ui/Button";
import { ChatIcon, CloseIcon } from "../icons";
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
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const widgetRef = useRef(null);

  const MIN_INPUT_HEIGHT = 40;
  const MAX_INPUT_HEIGHT = 120;

  // Grows the box to fit up to a few lines (WhatsApp-style), then leaves it
  // at MAX_INPUT_HEIGHT and lets overflow-y:auto (set in CSS) take over —
  // typing past that point scrolls inside the box instead of growing it
  // further or clipping the text.
  function resizeInput(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT)}px`;
  }

  const fetchMessages = useCallback(async () => {
    if (!chatOpenedAt) return;
    const { data } = await supabase
      .from("lead_chat_messages")
      .select("*, sender:sender_id(full_name)")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    setMessages(data || []);
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
    if (!chatOpenedAt) return;
    fetchUnreadCount();
  }, [chatOpenedAt, fetchUnreadCount]);

  useEffect(() => {
    if (!chatOpenedAt) return undefined;
    const channel = supabase
      .channel(`lead-chat-${leadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "lead_chat_messages", filter: `lead_id=eq.${leadId}` },
        () => (open ? fetchMessages() : fetchUnreadCount())
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [leadId, chatOpenedAt, open, fetchMessages, fetchUnreadCount]);

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
      const { data, error } = await supabase.functions.invoke("send-lead-chat-message", { body: { lead_id: leadId, message } });
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
        <div className="ar-chat-popup" role="dialog" aria-label="Lead discussion">
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
            <p className="ar-chat-locked">Chat closed — this lead has been approved.</p>
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
