// "Documents Required from BP" card — the lead's Person Responsible,
// Reviewer, or Approval Authority lists what's needed from the Business
// Associate with a justification for each, then sends the compiled list +
// an email in one action. Items are plain direct-RLS writes (see
// can_edit_proposal() and proposal_document_requests' RLS) while unsent;
// sending is a dedicated edge function so the email + sent_at bookkeeping
// happen atomically. The BP is meant to upload each document themselves
// once their own portal for this exists — not built yet in this
// iteration, so for now AFC attaches whatever arrives some other way
// (email, WhatsApp, etc.) as a stand-in for whatever the BP hasn't
// uploaded directly. Reminders are capped to once every 24 hours (both
// here and server-side in the edge function) so a double-click can't spam
// the BP's inbox.
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../../components/ui/Card";
import Collapsible from "../../components/ui/Collapsible";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import FileUploadButton from "./FileUploadButton";
import ConfirmDialog from "../ui/ConfirmDialog";

const BUCKET = "proposal-documents";
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDateTime(d) {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function BaDocumentRequestsPanel({ proposalId, proposal, items, profile, canManage, locked, hasBa, onChanged }) {
  const [name, setName] = useState("");
  const [justification, setJustification] = useState("");
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);

  const unsent = items.filter((it) => !it.sent_at);
  const sent = items.filter((it) => it.sent_at);

  const nextReminderAt = proposal?.ba_last_sent_at ? new Date(new Date(proposal.ba_last_sent_at).getTime() + REMINDER_COOLDOWN_MS) : null;
  const onCooldown = !!(nextReminderAt && nextReminderAt > new Date());

  async function handleAdd() {
    if (!name.trim()) { setError("Item name is required."); return; }
    setAdding(true);
    setError("");
    try {
      const { error: insErr } = await supabase.from("proposal_document_requests").insert({
        proposal_id: proposalId, item_name: name.trim(), justification: justification.trim() || null, created_by: profile.id,
      });
      if (insErr) { setError(insErr.message); return; }
      setName(""); setJustification("");
      onChanged();
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id) {
    setRemoving(true);
    try {
      const { error: delErr } = await supabase.from("proposal_document_requests").delete().eq("id", id);
      if (delErr) { setError(delErr.message); return; }
      setRemoveTarget(null);
      onChanged();
    } finally {
      setRemoving(false);
    }
  }

  async function handleUpload(item, file) {
    if (!file) return;
    setBusyId(item.id);
    setError("");
    try {
      const path = `${proposalId}/ba_request_${item.id}_${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) { setError("Failed to upload document: " + upErr.message); return; }

      const { error: updErr } = await supabase.from("proposal_document_requests").update({
        file_name: file.name, file_path: path, file_size: file.size,
        uploaded_at: new Date().toISOString(), uploaded_by: profile.id,
      }).eq("id", item.id);
      if (updErr) { setError(updErr.message); return; }

      if (item.file_path && item.file_path !== path) {
        await supabase.storage.from(BUCKET).remove([item.file_path]);
      }
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function handleView(item) {
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("get-proposal-document-url", {
        body: { path: item.file_path, proposal_id: proposalId },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to open document.")); return; }
      if (!data?.url) { setError(data?.error || "Failed to open document."); return; }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    }
  }

  async function handleSend() {
    setSending(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("send-ba-document-request", { body: { proposal_id: proposalId } });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to send request.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to send request."); return; }
      onChanged();
    } finally {
      setSending(false);
    }
  }

  function renderRow(it) {
    return (
      <div key={it.id} className="pp-list-row pp-list-row-file">
        <div>
          <div className="pp-list-row-title">{it.item_name}</div>
          {it.justification && <div className="pp-list-row-sub">{it.justification}</div>}
        </div>
        <div className="pp-list-row-file-area">
          {it.file_path ? (
            <div className="pp-list-row-file-info">
              <Badge variant="success">Received</Badge>
              <span className="pp-list-row-filename" title={it.file_name}>{it.file_name}</span>
              <span className="pp-doc-card-meta">{fmtSize(it.file_size)}</span>
              <Button variant="secondary" size="sm" onClick={() => handleView(it)}>View</Button>
              {canManage && !locked && (
                <FileUploadButton label={busyId === it.id ? "Uploading…" : "Replace File"} disabled={busyId === it.id} onSelect={(file) => handleUpload(it, file)} />
              )}
            </div>
          ) : (
            <div className="pp-list-row-file-info">
              <Badge variant="warning">Pending</Badge>
              {canManage && !locked && (
                <FileUploadButton label={busyId === it.id ? "Uploading…" : "Attach File"} disabled={busyId === it.id} onSelect={(file) => handleUpload(it, file)} />
              )}
            </div>
          )}
          {canManage && !locked && !it.sent_at && (
            <button type="button" className="pp-list-remove" onClick={() => setRemoveTarget(it)} aria-label="Remove">×</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <Collapsible title="Documents Required from Business Partner">
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        {!hasBa && <p className="text-secondary text-sm" style={{ margin: "0 0 var(--space-3)" }}>This lead has no linked Business Partner.</p>}

        {sent.length > 0 && (
          <div className="pp-list-group">
            <div className="pp-list-group-label">Sent</div>
            {sent.map(renderRow)}
          </div>
        )}

        {unsent.length > 0 && (
          <div className="pp-list-group">
            {sent.length > 0 && <div className="pp-list-group-label">Not yet sent</div>}
            {unsent.map(renderRow)}
          </div>
        )}

        {items.length === 0 && <p className="text-secondary text-sm" style={{ margin: 0 }}>No items added yet.</p>}

        {canManage && !locked && (
          <div className="pp-add-row">
            <input type="text" className="input" placeholder="Item name (e.g. GST Certificate)" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="text" className="input" placeholder="Justification (optional)" value={justification} onChange={(e) => setJustification(e.target.value)} />
            <Button variant="secondary" size="sm" loading={adding} onClick={handleAdd}>+ Add</Button>
          </div>
        )}

        {canManage && !locked && hasBa && items.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginTop: "var(--space-4)" }}>
            <Button variant="primary" loading={sending} disabled={onCooldown} onClick={handleSend}>
              {(proposal?.ba_send_count || 0) > 0 ? "Send Reminder to BP" : `Send to BP (${items.length})`}
            </Button>
            {onCooldown && <span className="text-secondary text-sm">Next reminder available {fmtDateTime(nextReminderAt)}</span>}
          </div>
        )}
      </Collapsible>
      {removeTarget && (
        <ConfirmDialog
          title="Remove item?"
          message={`Are you sure you want to remove "${removeTarget.item_name}"?${removeTarget.file_path ? " Its attached file will be removed too." : ""}`}
          confirmLabel="Yes"
          cancelLabel="Cancel"
          loading={removing}
          onConfirm={() => handleRemove(removeTarget.id)}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </Card>
  );
}
