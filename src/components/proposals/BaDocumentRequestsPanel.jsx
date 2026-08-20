// "Documents Required from BA" card — Person Responsible/Reviewer/Approval
// Authority list what's needed from the lead's Business Associate with a
// justification for each, then send the compiled list + an email in one
// action. Items are plain direct-RLS writes (see can_edit_proposal() and
// proposal_document_requests' RLS) while unsent; sending is a dedicated
// edge function so the email and the "read-only once sent" transition
// happen atomically. BA-facing response UI is out of scope for now.
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";

export default function BaDocumentRequestsPanel({ proposalId, items, profile, canManage, locked, hasBa, onChanged }) {
  const [name, setName] = useState("");
  const [justification, setJustification] = useState("");
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const unsent = items.filter((it) => !it.sent_at);
  const sent = items.filter((it) => it.sent_at);

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
    const { error: delErr } = await supabase.from("proposal_document_requests").delete().eq("id", id);
    if (delErr) { setError(delErr.message); return; }
    onChanged();
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

  return (
    <Card>
      <Card.Header title="Documents Required from BA" subtitle="Compiled and emailed to the lead's Business Associate as one list." />
      <Card.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        {!hasBa && <p className="text-secondary text-sm" style={{ margin: "0 0 var(--space-3)" }}>This lead has no linked Business Associate.</p>}

        {sent.length > 0 && (
          <div className="pp-list-group">
            <div className="pp-list-group-label">Sent</div>
            {sent.map((it) => (
              <div key={it.id} className="pp-list-row">
                <div>
                  <div className="pp-list-row-title">{it.item_name}</div>
                  {it.justification && <div className="pp-list-row-sub">{it.justification}</div>}
                </div>
                <Badge variant="success">Sent</Badge>
              </div>
            ))}
          </div>
        )}

        {unsent.length > 0 && (
          <div className="pp-list-group">
            {sent.length > 0 && <div className="pp-list-group-label">Not yet sent</div>}
            {unsent.map((it) => (
              <div key={it.id} className="pp-list-row">
                <div>
                  <div className="pp-list-row-title">{it.item_name}</div>
                  {it.justification && <div className="pp-list-row-sub">{it.justification}</div>}
                </div>
                {canManage && !locked && (
                  <button type="button" className="pp-list-remove" onClick={() => handleRemove(it.id)} aria-label="Remove">×</button>
                )}
              </div>
            ))}
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
      </Card.Body>
      {canManage && !locked && hasBa && unsent.length > 0 && (
        <Card.Footer>
          <Button variant="primary" loading={sending} onClick={handleSend}>Send to BA ({unsent.length})</Button>
        </Card.Footer>
      )}
    </Card>
  );
}
