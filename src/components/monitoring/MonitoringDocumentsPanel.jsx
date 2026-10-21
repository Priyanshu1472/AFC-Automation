// Project documents — MoUs (client / BP), work orders, and every other
// proof or document the client sends, kept in one categorised list. Upload
// opens a small dialog: pick a category, then any number of files at once. Files go to the private
// monitoring-documents bucket under {project_id}/docs/; reads use a
// short-lived signed URL (storage SELECT policy: can_read_monitoring_path).
import { useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import Select from "../ui/Select";
import ConfirmDialog from "../ui/ConfirmDialog";
import Modal from "../ui/Modal";
import { Field } from "../financials/InvoiceModals";
import { FolderIcon, FileTextIcon, EyeIcon, TrashIcon, PaperclipIcon } from "../icons";
import {
  DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS, MONITORING_BUCKET,
  fmtDate, fmtSize, safeFileName, openMonitoringFile, uploadMonitoringFile,
} from "../../lib/monitoring";

function UploadDocumentsModal({ projectId, categories, defaultCategory, onClose, onDone }) {
  const inputRef = useRef(null);
  const [category, setCategory] = useState(defaultCategory);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function upload() {
    if (!files.length) { setError("Choose at least one file."); return; }
    setError("");
    const failed = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBusy(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…");
      try {
        const meta = await uploadMonitoringFile(`${projectId}/docs/${Date.now()}_${i}_${safeFileName(file.name)}`, file);
        const { error: insErr } = await supabase.from("monitoring_documents").insert({
          project_id: projectId, category, title: title.trim() || null, ...meta,
        });
        if (insErr) {
          await supabase.storage.from(MONITORING_BUCKET).remove([meta.file_path]);
          throw new Error(`${file.name}: ${insErr.message}`);
        }
      } catch (err) {
        failed.push(err.message);
      }
    }
    setBusy("");
    if (failed.length) { setError(failed.join(" · ")); setFiles([]); return; }
    onDone();
  }

  return (
    <Modal onClose={busy ? undefined : onClose} closeOnBackdrop={!busy}>
      <Modal.Header title="Upload Documents" subtitle="MoUs, the work order, or anything received from the client." onClose={busy ? undefined : onClose} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <div className="mon-form">
          <Field label="Category" required>
            <Select options={categories.map((c) => ({ value: c.key, label: c.label }))} value={category} onChange={setCategory} />
          </Field>
          <Field label="Description" hint="Optional — e.g. Signed MoU dated 12 Oct. Applies to every file in this upload.">
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!busy} />
          </Field>
          <Field label="Files" required>
            <input
              ref={inputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip,.eml,.msg"
              onChange={(e) => { setFiles(Array.from(e.target.files || [])); e.target.value = ""; }}
            />
            <div className="mon-file-pick">
              <Button variant="secondary" size="sm" icon={<PaperclipIcon />} disabled={!!busy} onClick={() => inputRef.current?.click()}>
                {files.length ? "Choose different files" : "Choose files"}
              </Button>
              {files.length > 0 && <span className="mon-file-pick-name">{files.length === 1 ? files[0].name : `${files.length} files selected`}</span>}
            </div>
          </Field>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={!!busy} onClick={onClose}>Cancel</Button>
        <Button loading={!!busy} onClick={upload}>{busy || "Upload"}</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default function MonitoringDocumentsPanel({ projectId, documents, canEdit, hasBp, onChanged }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const categories = DOCUMENT_CATEGORIES.filter((c) => hasBp || c.key !== "mou_bp" || documents.some((d) => d.category === "mou_bp"));
  const counts = Object.fromEntries(categories.map((c) => [c.key, documents.filter((d) => d.category === c.key).length]));
  const shown = documents
    .filter((d) => filter === "all" || d.category === filter)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  async function view(doc) {
    setError("");
    try { await openMonitoringFile(doc.file_path); } catch (err) { setError(err.message); }
  }

  async function confirmDelete() {
    setDeleting(true);
    const { error: delErr } = await supabase.from("monitoring_documents").delete().eq("id", toDelete.id);
    if (delErr) setError(delErr.message);
    else await supabase.storage.from(MONITORING_BUCKET).remove([toDelete.file_path]);
    setDeleting(false);
    setToDelete(null);
    onChanged();
  }

  return (
    <Card>
      <Collapsible
        title="Documents"
        subtitle="MoUs, work orders, and every document or proof received from the client."
        icon={<FolderIcon />}
        expandable={false}
        action={canEdit ? <Button size="sm" icon={<PaperclipIcon />} onClick={() => setUploading(true)}>Upload</Button> : null}
      >
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        <div className="mon-chips mon-section-chips" role="tablist" aria-label="Filter documents">
          <button type="button" role="tab" aria-selected={filter === "all"} className={`mon-chip${filter === "all" ? " is-active" : ""}`} onClick={() => setFilter("all")}>
            All <span>{documents.length}</span>
          </button>
          {categories.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={filter === c.key} className={`mon-chip${filter === c.key ? " is-active" : ""}`} onClick={() => setFilter(c.key)}>
              {c.label} <span>{counts[c.key]}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="pp-empty">{documents.length === 0 ? "No documents yet — upload the MoUs and the work order first." : "Nothing in this category yet."}</p>
        ) : (
          <ul className="pp-docs-list">
            {shown.map((doc) => (
              <li key={doc.id} className="pp-docs-row">
                <span className="pp-docs-icon" aria-hidden="true"><FileTextIcon /></span>
                <div className="pp-docs-main">
                  <span className="pp-docs-name" title={doc.file_name}>{doc.title || doc.file_name}</span>
                  <span className="pp-docs-meta">
                    <span className="mon-doc-cat">{DOCUMENT_CATEGORY_LABELS[doc.category]}</span>
                    {" · "}{[doc.title ? doc.file_name : null, fmtSize(doc.file_size), fmtDate(doc.created_at)].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="pp-docs-actions">
                  <button type="button" className="pp-icon-btn" title="View" aria-label={`View ${doc.file_name}`} onClick={() => view(doc)}><EyeIcon /></button>
                  {canEdit && (
                    <button type="button" className="pp-icon-btn pp-icon-danger" title="Remove" aria-label={`Remove ${doc.file_name}`} onClick={() => setToDelete(doc)}><TrashIcon /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Collapsible>
      {uploading && (
        <UploadDocumentsModal
          projectId={projectId}
          categories={categories}
          defaultCategory={filter !== "all" ? filter : documents.length ? "client_document" : "mou_client"}
          onClose={() => { setUploading(false); onChanged(); }}
          onDone={() => { setUploading(false); onChanged(); }}
        />
      )}
      {toDelete && (
        <ConfirmDialog
          title="Remove document?"
          message={`“${toDelete.title || toDelete.file_name}” will be removed from this project.`}
          confirmLabel="Remove"
          loading={deleting}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </Card>
  );
}
