import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { ROLE_LABELS } from "../../lib/roles";
import Button from "../ui/Button";
import { ChatIcon, CloseIcon } from "../icons";
// Same floating-bubble widget as LeadChatPanel / ProposalChatPanel, pointed
// at empanelment_chat_messages.
import "../../styles/ApplicationReviewPage.css";

function fmtTime(v) {
  return new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const ORG_WIDE_PARTICIPANT_ROLES = ["cfo", "cs", "md"];

// Participants are fixed by the application (see the 20261006000000
// migration / send-empanelment-chat-message): the sender (AC / PA / PO), the
// assigned PO, the assigned advising authority, and every CFO, CS and MD.
// Admin can read along but never post. Everyone else gets nothing rendered.
export function isEmpanelmentChatParticipant(app, profile) {
  if (!app || !profile) return false;
  return [app.sent_by, app.project_officer_id, app.dgm_id].includes(profile.id) || ORG_WIDE_PARTICIPANT_ROLES.includes(profile.role);
}

export default function EmpanelmentChatPanel({ app }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const applicationId = app?.id;
  const isParticipant = isEmpanelmentChatParticipant(app, profile);
  const canRead = isParticipant || profile?.role === "admin";
  // Closed once the MD has made a final decision.
  const locked = ["accepted", "rejected"].includes(app?.status);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [senders, setSenders] = useState({});
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
    if (!applicationId || !canRead) return;
    // Sender names via RPC — the advisor/PO/CFO/CS/MD are often on another
    // team, and an embedded afc_users join would come back null for them.
    const [{ data }, { data: names }] = await Promise.all([
      supabase.from("empanelment_chat_messages").select("*").eq("application_id", applicationId).order("created_at", { ascending: true }),
      supabase.rpc("get_empanelment_chat_participant_names", { p_application_id: applicationId }),
    ]);
    setMessages(data || []);
    setSenders(Object.fromEntries((names || []).map((n) => [n.user_id, n])));
    setLoading(false);
    setUnreadCount(0);
    if (isParticipant) supabase.rpc("mark_empanelment_chat_read", { p_application_id: applicationId }).then(() => {}, () => {});
  }, [applicationId, canRead, isParticipant]);

  const fetchUnreadCount = useCallback(async () => {
    if (!applicationId || !isParticipant) return;
    const { data } = await supabase.rpc("empanelment_chat_unread_count", { p_application_id: applicationId });
    setUnreadCount(Number(data) || 0);
  }, [applicationId, isParticipant]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (!applicationId || !canRead) return undefined;
    const channel = supabase
      .channel(`empanelment-chat-${applicationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "empanelment_chat_messages", filter: `application_id=eq.${applicationId}` },
        () => (open ? fetchMessages() : fetchUnreadCount())
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [applicationId, canRead, open, fetchMessages, fetchUnreadCount]);

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

  if (!applicationId || !canRead) return null;

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
      const { data, error } = await supabase.functions.invoke("send-empanelment-chat-message", { body: { application_id: applicationId, message } });
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
        <div className="ar-chat-popup" role="dialog" aria-label="Application discussion">
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
              <p className="ar-empty-text">No messages yet. The sender, Project Officer, advising authority, CS, CFO and MD can discuss this application here.</p>
            ) : (
              messages.map((m) => {
                const isOwn = m.sender_id === profile?.id;
                const sender = senders[m.sender_id];
                return (
                  <div key={m.id} className={`ar-chat-msg${isOwn ? " ar-chat-msg-own" : ""}`}>
                    <div className="ar-chat-bubble">
                      <span className="ar-chat-sender">
                        {sender?.full_name || (m.sender_id ? "Unknown" : "Deleted user")}
                        {sender?.role ? ` · ${ROLE_LABELS[sender.role] || sender.role}` : ""}
                      </span>
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
            <p className="ar-chat-locked">Chat closed — a final decision has been made on this application.</p>
          ) : !isParticipant ? (
            <p className="ar-chat-locked">View only.</p>
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
