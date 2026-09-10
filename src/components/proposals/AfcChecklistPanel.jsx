// Internal-only "what AFC needs to submit" checklist — forms, annexures,
// anything the person responsible wants to track so it doesn't get lost
// during prep. Each item can carry an attached file, either uploaded fresh
// or pulled straight from the Knowledge Repository (past-project
// documents) instead of re-uploading something AFC already has on file.
// "Done" is derived purely from whether a file is attached — no separate
// manual checkbox, since a file being there already is the meaningful
// signal. Never sent anywhere; plain direct-RLS CRUD gated by
// can_edit_proposal() (role + not-locked).
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../../components/ui/Card";
import Collapsible from "../../components/ui/Collapsible";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import FileUploadButton from "./FileUploadButton";
import KnowledgeRepositoryDocumentPicker from "./KnowledgeRepositoryDocumentPicker";
import ConfirmDialog from "../ui/ConfirmDialog";

const BUCKET = "proposal-documents";
const KNOWLEDGE_BUCKET = "project-documents";

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AfcChecklistPanel({ proposalId, items, profile, canManage, locked, onChanged }) {
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pickerFor, setPickerFor] = useState(null);
  const [error, setError] = useState("");
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);

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

  async function handleRemove(id) {
    setRemoving(true);
    try {
      const { error: delErr } = await supabase.from("proposal_afc_checklist_items").delete().eq("id", id);
      if (delErr) { setError(delErr.message); return; }
      setRemoveTarget(null);
      onChanged();
    } finally {
      setRemoving(false);
    }
  }

  async function handleUploadFromComputer(item, file) {
    if (!file) return;
    setBusyId(item.id);
    setError("");
    try {
      const path = `${proposalId}/checklist_${item.id}_${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) { setError("Failed to upload document: " + upErr.message); return; }

      const { error: updErr } = await supabase.from("proposal_afc_checklist_items").update({
        file_name: file.name, file_path: path, file_size: file.size,
        uploaded_at: new Date().toISOString(), uploaded_by: profile.id,
        source: "upload", source_project_document_id: null, status: "done",
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

  async function handlePickFromKnowledgeRepository(item, doc) {
    setPickerFor(null);
    setBusyId(item.id);
    setError("");
    try {
      const { data: fileBlob, error: dlErr } = await supabase.storage.from(KNOWLEDGE_BUCKET).download(doc.storage_path);
      if (dlErr || !fileBlob) { setError("Failed to fetch document from Knowledge Repository: " + (dlErr?.message || "")); return; }

      const path = `${proposalId}/checklist_${item.id}_${Date.now()}_${doc.file_name.replace(/\s+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, fileBlob);
      if (upErr) { setError("Failed to attach document: " + upErr.message); return; }

      const { error: updErr } = await supabase.from("proposal_afc_checklist_items").update({
        file_name: doc.file_name, file_path: path, file_size: fileBlob.size,
        uploaded_at: new Date().toISOString(), uploaded_by: profile.id,
        source: "knowledge_repository", source_project_document_id: doc.id, status: "done",
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

  function renderRow(it) {
    return (
      <div key={it.id} className="pp-list-row pp-list-row-file">
        <div>
          <div className="pp-list-row-title">{it.item_name}</div>
        </div>
        <div className="pp-list-row-file-area">
          {it.file_path ? (
            <div className="pp-list-row-file-info">
              <Badge variant="success">{it.source === "knowledge_repository" ? "From Knowledge Repository" : "Uploaded"}</Badge>
              <span className="pp-list-row-filename" title={it.file_name}>{it.file_name}</span>
              <span className="pp-doc-card-meta">{fmtSize(it.file_size)}</span>
              <Button variant="secondary" size="sm" onClick={() => handleView(it)}>View</Button>
              {canManage && !locked && (
                <>
                  <FileUploadButton label={busyId === it.id ? "Uploading…" : "Replace File"} disabled={busyId === it.id} onSelect={(file) => handleUploadFromComputer(it, file)} />
                  <Button variant="ghost" size="sm" disabled={busyId === it.id} onClick={() => setPickerFor(it)}>From Knowledge Repository</Button>
                </>
              )}
            </div>
          ) : (
            <div className="pp-list-row-file-info">
              <Badge variant="warning">Pending</Badge>
              {canManage && !locked && (
                <>
                  <FileUploadButton label={busyId === it.id ? "Uploading…" : "Attach File"} disabled={busyId === it.id} onSelect={(file) => handleUploadFromComputer(it, file)} />
                  <Button variant="ghost" size="sm" disabled={busyId === it.id} onClick={() => setPickerFor(it)}>From Knowledge Repository</Button>
                </>
              )}
            </div>
          )}
          {canManage && !locked && (
            <button type="button" className="pp-list-remove" onClick={() => setRemoveTarget(it)} aria-label="Remove">×</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <Collapsible title="AFC Checklist">
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        {items.length === 0 && <p className="text-secondary text-sm" style={{ margin: 0 }}>No items added yet.</p>}
        {items.length > 0 && <div className="pp-list-group">{items.map(renderRow)}</div>}
        {canManage && !locked && (
          <div className="pp-add-row">
            <input type="text" className="input" placeholder="e.g. Annexure III — Undertaking" value={name} onChange={(e) => setName(e.target.value)} />
            <Button variant="secondary" size="sm" loading={adding} onClick={handleAdd}>+ Add</Button>
          </div>
        )}
      </Collapsible>
      {pickerFor && (
        <KnowledgeRepositoryDocumentPicker
          onSelect={(doc) => handlePickFromKnowledgeRepository(pickerFor, doc)}
          onClose={() => setPickerFor(null)}
        />
      )}
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
