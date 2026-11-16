// Proof files for a proposal's money steps (proposal_finance_files, private
// "proposal-finance" bucket): Accounts' payment proof, the EMD refund
// proofs, the PBG proofs. Path is "<proposal_id>/<purpose>/<file>" — the
// bucket's own RLS (can_manage_proposal_finance_file) decides who may add
// or remove one at each step; viewing uses a short-lived signed URL.
import { useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ConfirmDialog from "../ui/ConfirmDialog";
import { FileTextIcon, EyeIcon, TrashIcon, PaperclipIcon } from "../icons";
import { fmtSize, fmtDate, safeFileName } from "../../lib/monitoring";
import { FINANCE_BUCKET, FINANCE_FILE_ACCEPT, FINANCE_FILE_TYPES } from "../../lib/proposalPrep";

export default function FinanceFiles({ proposalId, purpose, files, canManage, emptyText = "No proofs uploaded.", onChanged }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const list = files.filter((f) => f.purpose === purpose).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  async function handleFiles(fileList) {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    const bad = picked.filter((f) => !FINANCE_FILE_TYPES.test(f.name));
    if (bad.length) { setError(`Only PDF, Word (DOC/DOCX) or image (JPG/JPEG/PNG) files: ${bad.map((f) => f.name).join(", ")}`); return; }
    setError("");
    const failed = [];
    for (let i = 0; i < picked.length; i++) {
      const file = picked[i];
      setUploading(`Uploading ${i + 1} of ${picked.length}…`);
      const path = `${proposalId}/${purpose}/${Date.now()}_${i}_${safeFileName(file.name)}`;
      const { error: upErr } = await supabase.storage.from(FINANCE_BUCKET).upload(path, file);
      if (upErr) { failed.push(`${file.name} (${upErr.message})`); continue; }
      const { error: insErr } = await supabase.from("proposal_finance_files").insert({
        proposal_id: proposalId, purpose, file_name: file.name, file_size: file.size, file_path: path,
      });
      if (insErr) {
        failed.push(`${file.name} (${insErr.message})`);
        await supabase.storage.from(FINANCE_BUCKET).remove([path]);
      }
    }
    setUploading("");
    if (failed.length) setError(`Could not upload: ${failed.join(", ")}`);
    onChanged();
  }

  async function view(file) {
    setError("");
    const { data, error: signErr } = await supabase.storage.from(FINANCE_BUCKET).createSignedUrl(file.file_path, 300);
    if (signErr || !data?.signedUrl) { setError(signErr?.message || "Could not open the file."); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function confirmDelete() {
    setDeleting(true);
    const { error: delErr } = await supabase.from("proposal_finance_files").delete().eq("id", toDelete.id);
    if (delErr) setError(delErr.message);
    else await supabase.storage.from(FINANCE_BUCKET).remove([toDelete.file_path]);
    setDeleting(false);
    setToDelete(null);
    onChanged();
  }

  return (
    <div className="pp-fin-files">
      {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
      {list.length === 0 ? (
        <p className="pp-docs-empty">{emptyText}</p>
      ) : (
        <ul className="pp-docs-list">
          {list.map((f) => (
            <li key={f.id} className="pp-docs-row">
              <span className="pp-docs-icon" aria-hidden="true"><FileTextIcon /></span>
              <div className="pp-docs-main">
                <span className="pp-docs-name" title={f.file_name}>{f.file_name}</span>
                <span className="pp-docs-meta">{[fmtSize(f.file_size), fmtDate(f.created_at)].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="pp-docs-actions">
                <button type="button" className="pp-icon-btn" title="View" aria-label={`View ${f.file_name}`} onClick={() => view(f)}><EyeIcon /></button>
                {canManage && (
                  <button type="button" className="pp-icon-btn pp-icon-danger" title="Remove" aria-label={`Remove ${f.file_name}`} onClick={() => setToDelete(f)}><TrashIcon /></button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={FINANCE_FILE_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => { const picked = e.target.files; handleFiles(picked).finally(() => { e.target.value = ""; }); }}
          />
          <Button variant="secondary" size="sm" icon={<PaperclipIcon />} loading={!!uploading} onClick={() => inputRef.current?.click()}>
            {uploading || "Upload Proof"}
          </Button>
        </>
      )}
      {toDelete && (
        <ConfirmDialog
          title="Remove file?"
          message={`“${toDelete.file_name}” will be removed.`}
          confirmLabel="Remove"
          loading={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}
