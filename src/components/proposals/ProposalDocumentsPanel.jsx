// Proposal documents — one picker that takes any number of files at once
// (technical, financial, annexures… whatever the bid needs), listed below
// it. Files upload straight to the private proposal-documents bucket
// (INSERT policy scoped by path-prefix + can_edit_proposal); each gets its
// own proposal_documents row via a direct RLS insert with the same gate.
// Viewing always goes through get-proposal-document-url so the bucket
// itself never needs a client-facing SELECT policy.
import { useRef, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../../components/ui/Card";
import Collapsible from "../../components/ui/Collapsible";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import ConfirmDialog from "../ui/ConfirmDialog";
import { FolderIcon, FileTextIcon, EyeIcon, TrashIcon, PaperclipIcon } from "../icons";
import { fmtSize, safeFileName } from "../../lib/monitoring";

const BUCKET = "proposal-documents";
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.jpg,.jpeg,.png";

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function ProposalDocumentsPanel({ proposalId, documents, canManage, locked, onChanged }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const sorted = [...documents].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const editable = canManage && !locked;

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setError("");
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploading(`Uploading ${i + 1} of ${files.length}…`);
      const path = `${proposalId}/${Date.now()}_${i}_${safeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) { failed.push(`${file.name} (${upErr.message})`); continue; }
      const { error: insErr } = await supabase.from("proposal_documents").insert({
        proposal_id: proposalId, file_name: file.name, file_size: file.size, file_path: path,
      });
      if (insErr) {
        failed.push(`${file.name} (${insErr.message})`);
        await supabase.storage.from(BUCKET).remove([path]);
      }
    }
    setUploading("");
    if (failed.length) setError(`Could not upload: ${failed.join(", ")}`);
    onChanged();
  }

  async function handleView(doc) {
    setError("");
    const { data, error: fnError } = await supabase.functions.invoke("get-proposal-document-url", {
      body: { path: doc.file_path, proposal_id: proposalId },
    });
    if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to open document.")); return; }
    if (!data?.url) { setError(data?.error || "Failed to open document."); return; }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function confirmDelete() {
    setDeleting(true);
    const { error: delErr } = await supabase.from("proposal_documents").delete().eq("id", toDelete.id);
    if (delErr) setError(delErr.message);
    else if (toDelete.file_path) await supabase.storage.from(BUCKET).remove([toDelete.file_path]);
    setDeleting(false);
    setToDelete(null);
    onChanged();
  }

  return (
    <Card>
      <Collapsible
        title="Proposal Documents"
        subtitle="Technical, financial and any other proposal files — select several at once."
        icon={<FolderIcon />}
        action={editable ? (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files; handleFiles(f).finally(() => { e.target.value = ""; }); }}
            />
            <Button size="sm" icon={<PaperclipIcon />} loading={!!uploading} onClick={() => inputRef.current?.click()}>
              {uploading || "Upload Files"}
            </Button>
          </>
        ) : null}
      >
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        {sorted.length === 0 ? (
          <p className="pp-docs-empty">{editable ? "No files yet — use “Upload Files” to add one or more." : "No files were uploaded."}</p>
        ) : (
          <ul className="pp-docs-list">
            {sorted.map((doc) => (
              <li key={doc.id} className="pp-docs-row">
                <span className="pp-docs-icon" aria-hidden="true"><FileTextIcon /></span>
                <div className="pp-docs-main">
                  <span className="pp-docs-name" title={doc.file_name}>{doc.file_name}</span>
                  <span className="pp-docs-meta">{[fmtSize(doc.file_size), fmtDate(doc.created_at)].filter(Boolean).join(" · ")}</span>
                </div>
                <div className="pp-docs-actions">
                  <button type="button" className="pp-icon-btn" title="View" aria-label={`View ${doc.file_name}`} onClick={() => handleView(doc)}><EyeIcon /></button>
                  {editable && (
                    <button type="button" className="pp-icon-btn pp-icon-danger" title="Remove" aria-label={`Remove ${doc.file_name}`} onClick={() => setToDelete(doc)}><TrashIcon /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Collapsible>
      {toDelete && (
        <ConfirmDialog
          title="Remove file?"
          message={`“${toDelete.file_name}” will be removed from this proposal.`}
          confirmLabel="Remove"
          loading={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </Card>
  );
}
