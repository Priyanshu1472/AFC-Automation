// Technical / Financial / Proposal 3 — three latest-file-only upload slots.
// Files upload straight to the private proposal-documents bucket (INSERT
// policy scoped by path-prefix + can_edit_proposal — see the migration);
// the metadata row is a direct RLS upsert with the same gate. Viewing
// always goes through get-proposal-document-url so the bucket itself never
// needs a public/authenticated SELECT policy.
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import { PROPOSAL_DOCUMENT_TYPES } from "../../lib/proposalPrep";

const BUCKET = "proposal-documents";

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProposalDocumentsPanel({ proposalId, documents, canManage, locked, onChanged }) {
  const byType = Object.fromEntries(documents.map((d) => [d.doc_type, d]));
  const [busyType, setBusyType] = useState(null);
  const [error, setError] = useState("");

  async function handleUpload(docType, file) {
    if (!file) return;
    setBusyType(docType);
    setError("");
    try {
      const path = `${proposalId}/${docType}_${Date.now()}_${file.name.replace(/\s+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) { setError("Failed to upload document: " + upErr.message); return; }

      const existing = byType[docType];
      const row = {
        proposal_id: proposalId, doc_type: docType,
        file_name: file.name, file_size: file.size, file_path: path,
      };

      if (existing) {
        const { error: updErr } = await supabase.from("proposal_documents").update(row).eq("id", existing.id);
        if (updErr) { setError(updErr.message); return; }
        if (existing.file_path && existing.file_path !== path) {
          await supabase.storage.from(BUCKET).remove([existing.file_path]);
        }
      } else {
        const { error: insErr } = await supabase.from("proposal_documents").insert(row);
        if (insErr) { setError(insErr.message); return; }
      }
      onChanged();
    } finally {
      setBusyType(null);
    }
  }

  async function handleView(doc) {
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("get-proposal-document-url", {
        body: { path: doc.file_path, proposal_id: proposalId },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to open document.")); return; }
      if (!data?.url) { setError(data?.error || "Failed to open document."); return; }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    }
  }

  return (
    <Card>
      <Card.Header title="Proposal Documents" subtitle="Technical, Financial, and a third slot for any additional proposal document." />
      <Card.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <div className="pp-doc-grid">
          {PROPOSAL_DOCUMENT_TYPES.map((t) => {
            const doc = byType[t.key];
            const inputId = `pp-doc-${t.key}`;
            return (
              <div key={t.key} className="pp-doc-card">
                <div className="pp-doc-card-title">{t.label}</div>
                {doc ? (
                  <div className="pp-doc-card-file">
                    <div className="pp-doc-card-filename" title={doc.file_name}>{doc.file_name}</div>
                    <div className="pp-doc-card-meta">{fmtSize(doc.file_size)}</div>
                    <div className="pp-doc-card-actions">
                      <Button variant="secondary" size="sm" onClick={() => handleView(doc)}>View</Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-secondary text-sm" style={{ margin: "8px 0" }}>No file uploaded yet.</p>
                )}
                {canManage && !locked && (
                  <div className="pp-doc-file-wrap" style={{ marginTop: 8 }}>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx"
                      className="pp-doc-file-input"
                      id={inputId}
                      disabled={busyType === t.key}
                      onChange={(e) => handleUpload(t.key, e.target.files?.[0] || null)}
                    />
                    <label htmlFor={inputId} className="pp-doc-file-label">
                      {busyType === t.key ? "Uploading…" : doc ? "Replace file" : "Choose file"}
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card.Body>
    </Card>
  );
}
