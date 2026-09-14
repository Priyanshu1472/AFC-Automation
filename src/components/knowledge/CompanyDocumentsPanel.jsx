// Organization-wide documents (policies, SOPs, guidelines, circulars...)
// inside the Knowledge Repository — kept in their own table/bucket
// (company_documents / "company-documents"), completely separate from
// project_documents. Same architecture as project documents (plain
// supabase-js reads/writes gated by RLS, no edge function — see
// DocumentUpload in KnowledgeFormParts.jsx for the pattern this mirrors),
// so admin-only write is enforced server-side in RLS, not just by hiding
// these buttons — see 20260910000000_company_documents.sql.
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { can } from "../../lib/roles";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import ConfirmDialog from "../ui/ConfirmDialog";
import { openStorageDocument } from "./KnowledgeFormParts";
import "../../styles/CompanyDocumentsPanel.css";

const BUCKET = "company-documents";

function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

const IconDownload = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>);
const IconEdit = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>);
const IconTrash = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>);

// Add-new / edit-and-replace form, shared by both flows — editing just
// pre-fills from `doc` and makes the file input optional (swap only if a
// new file is chosen; metadata-only edits leave the stored file alone).
function CompanyDocumentForm({ doc, onSaved, onCancel }) {
  const { profile } = useAuth();
  const isEdit = !!doc;
  const [name, setName] = useState(doc?.name || "");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError("Document name is required."); return; }
    if (!isEdit && !file) { setError("Choose a file to upload."); return; }
    setSaving(true);
    setError("");
    try {
      if (!isEdit) {
        const path = `${Date.now()}_${sanitizeFileName(file.name)}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
        if (upErr) throw upErr;
        const { data: inserted, error: insErr } = await supabase
          .from("company_documents")
          .insert({
            name: name.trim(),
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type || null,
            storage_path: path,
            uploaded_by: profile?.id,
          })
          .select("*, uploader:afc_users(full_name)")
          .single();
        if (insErr) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw insErr;
        }
        onSaved(inserted);
      } else {
        const updates = { name: name.trim() };
        let oldPath = null;
        if (file) {
          const path = `${Date.now()}_${sanitizeFileName(file.name)}`;
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
          if (upErr) throw upErr;
          updates.file_name = file.name;
          updates.file_size = file.size;
          updates.mime_type = file.type || null;
          updates.storage_path = path;
          oldPath = doc.storage_path;
        }
        const { data: updated, error: updErr } = await supabase
          .from("company_documents")
          .update(updates)
          .eq("id", doc.id)
          .select("*, uploader:afc_users(full_name)")
          .single();
        if (updErr) {
          if (file) await supabase.storage.from(BUCKET).remove([updates.storage_path]);
          throw updErr;
        }
        if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]);
        onSaved(updated);
      }
    } catch (err) {
      console.error(err);
      setError(/row-level security/i.test(err.message || "") ? "You don't have permission to do this." : "Save failed. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="cdp-form">
      <div className="form-grid">
        <div className="field full">
          <Input label="Document Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Leave Policy 2026" disabled={saving} />
        </div>
        <div className="field full">
          <label className="field-label">
            {isEdit ? "Replace File (optional)" : "File"}
            {!isEdit && <span className="required" aria-hidden="true"> *</span>}
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
            className="input cdp-file-input"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={saving}
          />
          {isEdit && <span className="field-hint">Current file: {doc.file_name}{file ? " — will be replaced" : ""}</span>}
        </div>
      </div>
      {error && <div className="field-error" style={{ marginTop: 8 }}>{error}</div>}
      <div className="cdp-form-actions">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" loading={saving}>{isEdit ? "Save Changes" : "Upload"}</Button>
      </div>
    </form>
  );
}

export default function CompanyDocumentsPanel({ onClose }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const isAdmin = can.manageCompanyDocuments(profile?.role);

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingDoc, setEditingDoc] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_documents")
      .select("*, uploader:afc_users(full_name)")
      .order("created_at", { ascending: false });
    if (!error) setDocuments(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  function handleAdded(doc) {
    setDocuments((prev) => [doc, ...prev]);
    setShowAddForm(false);
    showToast("Document uploaded.", "success");
  }

  function handleUpdated(doc) {
    setDocuments((prev) => prev.map((d) => (d.id === doc.id ? doc : d)));
    setEditingDoc(null);
    showToast("Document updated.", "success");
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("company_documents").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      await supabase.storage.from(BUCKET).remove([deleteTarget.storage_path]);
      setDocuments((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      showToast("Document deleted.", "success");
    } catch (err) {
      console.error(err);
      showToast("Could not delete this document.", "danger");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <>
      <Modal onClose={onClose} size="xl">
        <Modal.Header title="Company Documents" subtitle="Organization-wide policies, SOPs, and guidelines — separate from project documents." onClose={onClose} />
        <Modal.Body>
          {isAdmin && !showAddForm && !editingDoc && (
            <div className="cdp-add-row">
              <Button variant="primary" size="sm" onClick={() => setShowAddForm(true)}>+ Add Document</Button>
            </div>
          )}

          {isAdmin && showAddForm && (
            <CompanyDocumentForm onSaved={handleAdded} onCancel={() => setShowAddForm(false)} />
          )}

          {isAdmin && editingDoc && (
            <CompanyDocumentForm doc={editingDoc} onSaved={handleUpdated} onCancel={() => setEditingDoc(null)} />
          )}

          {loading ? (
            <div className="cdp-empty">Loading…</div>
          ) : documents.length === 0 ? (
            <div className="cdp-empty">No company documents yet.</div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Uploaded By</th>
                    <th>Date</th>
                    <th>Size</th>
                    <th style={{ width: isAdmin ? 130 : 60 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td>
                        <div className="cdp-doc-name">{doc.name}</div>
                        <div className="cdp-doc-file">{doc.file_name}</div>
                      </td>
                      <td>{doc.uploader?.full_name || "—"}</td>
                      <td>{fmtDate(doc.created_at)}</td>
                      <td>{fmtSize(doc.file_size)}</td>
                      <td>
                        <div className="cdp-actions">
                          <button type="button" className="cdp-icon-btn" title="View / Download" onClick={() => openStorageDocument(BUCKET, doc.storage_path)}>
                            <IconDownload />
                          </button>
                          {isAdmin && (
                            <>
                              <button type="button" className="cdp-icon-btn" title="Edit / Replace" onClick={() => { setEditingDoc(doc); setShowAddForm(false); }}>
                                <IconEdit />
                              </button>
                              <button type="button" className="cdp-icon-btn cdp-icon-btn--danger" title="Delete" onClick={() => setDeleteTarget(doc)}>
                                <IconTrash />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal.Body>
      </Modal>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete document?"
          message={`Are you sure you want to remove "${deleteTarget.name}"?`}
          confirmLabel="Delete"
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
