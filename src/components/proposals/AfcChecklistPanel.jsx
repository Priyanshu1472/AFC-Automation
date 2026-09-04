// Internal-only "what AFC needs to submit" checklist — forms, annexures,
// anything the person responsible wants to track so it doesn't get lost
// during prep. Never sent anywhere; plain direct-RLS CRUD gated by
// can_edit_proposal() (role + not-locked).
import { useState } from "react";
import { supabase } from "../../lib/supabase";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";

export default function AfcChecklistPanel({ proposalId, items, profile, canManage, locked, onChanged }) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function handleAdd() {
    if (!name.trim()) { setError("Item name is required."); return; }
    setAdding(true);
    setError("");
    try {
      const { error: insErr } = await supabase.from("proposal_afc_checklist_items").insert({
        proposal_id: proposalId, item_name: name.trim(), created_by: profile.id,
      });
      if (insErr) { setError(insErr.message); return; }
      setName("");
      onChanged();
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(item) {
    const { error: updErr } = await supabase.from("proposal_afc_checklist_items")
      .update({ status: item.status === "done" ? "pending" : "done" }).eq("id", item.id);
    if (updErr) { setError(updErr.message); return; }
    onChanged();
  }

  async function handleRemove(id) {
    const { error: delErr } = await supabase.from("proposal_afc_checklist_items").delete().eq("id", id);
    if (delErr) { setError(delErr.message); return; }
    onChanged();
  }

  return (
    <Card>
      <Card.Header title="AFC Checklist" subtitle="Forms and annexures AFC needs to submit — tracked internally so nothing gets missed." />
      <Card.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        {items.length === 0 && <p className="text-secondary text-sm" style={{ margin: "0 0 var(--space-2)" }}>No items added yet.</p>}
        {items.map((it) => (
          <label key={it.id} className="pp-checklist-row">
            <input type="checkbox" checked={it.status === "done"} disabled={!canManage || locked} onChange={() => handleToggle(it)} />
            <span className={it.status === "done" ? "pp-checklist-done" : ""}>{it.item_name}</span>
            {canManage && !locked && (
              <button type="button" className="pp-list-remove" onClick={() => handleRemove(it.id)} aria-label="Remove">×</button>
            )}
          </label>
        ))}
        {canManage && !locked && (
          <div className="pp-add-row">
            <input type="text" className="input" placeholder="e.g. Annexure III — Undertaking" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="secondary" size="sm" loading={adding} onClick={handleAdd}>+ Add</Button>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
