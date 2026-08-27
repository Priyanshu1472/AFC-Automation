import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import Button from "../ui/Button";
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
export default function LeadChatPanel({ leadId, chatOpenedAt, locked }) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

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
    // Best-effort — viewing this panel counts as "read", clearing the
    // unread badge on the leads list. A failure here (e.g. the caller isn't
    // actually a chat participant) must never block rendering the messages
    // that were just fetched successfully above.
    supabase.rpc("mark_lead_chat_read", { p_lead_id: leadId }).then(() => {}, () => {});
  }, [leadId, chatOpenedAt]);

  useEffect(() => {
    if (!chatOpenedAt) {
      setLoading(false);
      return;
    }
    fetchMessages();
  }, [fetchMessages, chatOpenedAt]);

  useEffect(() => {
    if (!chatOpenedAt) return undefined;
    const channel = supabase
      .channel(`lead-chat-${leadId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lead_chat_messages", filter: `lead_id=eq.${leadId}` }, () => fetchMessages())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [leadId, chatOpenedAt, fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages]);

  if (!chatOpenedAt) return null;

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

  return (
    <div className="ar-chat">
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
  );
}
