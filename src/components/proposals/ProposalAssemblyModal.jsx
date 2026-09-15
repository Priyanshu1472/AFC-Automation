// "Generate Final Proposal" — lets the user pick which of the proposal's
// already-uploaded documents (BP requests / AFC checklist / the three
// Proposal Documents slots) belong in the client-facing final PDF, and in
// what order. Selection/grouping/reorder logic mirrors the old (removed)
// MergeProposalModal.jsx — see git history at commit 3160a48 — but the
// actual document is generated server-side by proposal-worker (LibreOffice
// + pypdf + ReportLab) instead of client-side mammoth/docx.js, which is
// what made the old merge unreliable (rasterized PDFs, dropped tables).
//
// Not all documents are auto-included — the user explicitly picks; see
// create-proposal-generation-job/index.ts for how every choice sent here
// is re-verified server-side against the proposal's own documents before
// a job is created.
import { useMemo, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { PROPOSAL_DOCUMENT_TYPES } from "../../lib/proposalPrep";

function extOf(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(fileName || "");
  return m ? m[1].toUpperCase() : "";
}

export default function ProposalAssemblyModal({ proposalId, baItems, checklistItems, documents, onClose, onCreated }) {
  const available = useMemo(() => {
    const list = [];
    baItems.filter((it) => it.file_path).forEach((it) => list.push({
      key: `ba_${it.id}`, source: "ba", sourceId: it.id, label: it.item_name, fileName: it.file_name, group: "Business Partner",
    }));
    checklistItems.filter((it) => it.file_path).forEach((it) => list.push({
      key: `checklist_${it.id}`, source: "checklist", sourceId: it.id, label: it.item_name, fileName: it.file_name, group: "AFC Internal",
    }));
    documents.forEach((d) => {
      const typeLabel = PROPOSAL_DOCUMENT_TYPES.find((t) => t.key === d.doc_type)?.label || d.doc_type;
      list.push({ key: `document_${d.id}`, source: "document", sourceId: d.id, label: typeLabel, fileName: d.file_name, group: "Proposal Document" });
    });
    return list;
  }, [baItems, checklistItems, documents]);

  const grouped = useMemo(() => {
    const byGroup = {};
    available.forEach((doc) => { (byGroup[doc.group] ||= []).push(doc); });
    return byGroup;
  }, [available]);

  const [sequence, setSequence] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedKeys = new Set(sequence.map((s) => s.key));

  function toggle(doc) {
    setSequence((seq) => (selectedKeys.has(doc.key) ? seq.filter((s) => s.key !== doc.key) : [...seq, doc]));
  }
  function removeFromSequence(key) {
    setSequence((seq) => seq.filter((s) => s.key !== key));
  }
  function moveInSequence(index, delta) {
    setSequence((seq) => {
      const next = [...seq];
      const target = index + delta;
      if (target < 0 || target >= next.length) return seq;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function reorderTo(from, to) {
    if (from === to) return;
    setSequence((seq) => {
      const next = [...seq];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  // Keeps whatever order the user's already built, just appends every
  // not-yet-selected document after it — doesn't discard manual reordering.
  function selectAll() {
    setSequence((seq) => {
      const already = new Set(seq.map((s) => s.key));
      return [...seq, ...available.filter((d) => !already.has(d.key))];
    });
  }
  function deselectAll() {
    setSequence([]);
  }
  const allSelected = available.length > 0 && selectedKeys.size === available.length;

  async function handleGenerate() {
    if (sequence.length === 0) { setError("Please select at least one document."); return; }
    setSubmitting(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("create-proposal-generation-job", {
        body: { proposal_id: proposalId, items: sequence.map((s) => ({ source: s.source, source_id: s.sourceId })) },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to start generation.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to start generation."); return; }
      onCreated();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={!submitting ? onClose : undefined} size="lg" closeOnBackdrop={!submitting}>
      <Modal.Header title="Generate Final Proposal" subtitle="Choose which documents to include, and drag to set their order." onClose={!submitting ? onClose : undefined} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        <div className="pp-assembly-grid">
          <div>
            <div className="pp-assembly-list-header">
              <div className="pp-list-group-label">Available Documents</div>
              {available.length > 0 && (
                <button type="button" className="pp-assembly-select-all" disabled={submitting} onClick={allSelected ? deselectAll : selectAll}>
                  {allSelected ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
            {available.length === 0 && (
              <p className="text-secondary text-sm">
                Nothing eligible yet — attach a file to a Business Partner request, an AFC checklist item, or a Proposal Document slot above first.
              </p>
            )}
            {Object.entries(grouped).map(([group, docs]) => (
              <div key={group} className="pp-list-group">
                <div className="pp-list-group-label">{group}</div>
                {docs.map((doc) => {
                  const added = selectedKeys.has(doc.key);
                  return (
                    <div key={doc.key} className="pp-list-row">
                      <label className="pp-assembly-pick-row">
                        <input type="checkbox" checked={added} onChange={() => toggle(doc)} disabled={submitting} />
                        <span>
                          <div className="pp-list-row-title">{doc.label}</div>
                          <div className="pp-list-row-sub">{doc.group} • {extOf(doc.fileName)}</div>
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div>
            <div className="pp-list-group-label">Final Proposal Order ({sequence.length})</div>
            {sequence.length === 0 && (
              <p className="text-secondary text-sm">Check documents on the left, in the order you want them to appear. Drag to reorder here.</p>
            )}
            {sequence.map((doc, i) => (
              <div
                key={doc.key}
                className={`pp-list-row pp-assembly-order-row${dragIndex === i ? " pp-assembly-dragging" : ""}${dropIndex === i ? " pp-assembly-drop-target" : ""}`}
                draggable={!submitting}
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => { e.preventDefault(); setDropIndex(i); }}
                onDragLeave={() => setDropIndex((d) => (d === i ? null : d))}
                onDrop={(e) => { e.preventDefault(); if (dragIndex !== null) reorderTo(dragIndex, i); setDragIndex(null); setDropIndex(null); }}
                onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
              >
                <span className="pp-assembly-drag-handle" aria-hidden="true">☰</span>
                <span className="pp-assembly-order-num">{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div className="pp-list-row-title">{doc.label}</div>
                  <div className="pp-list-row-sub">{doc.group} • {extOf(doc.fileName)}</div>
                </span>
                <div className="pp-assembly-order-actions">
                  <button type="button" className="pp-icon-btn" disabled={submitting || i === 0} onClick={() => moveInSequence(i, -1)} aria-label="Move up">▲</button>
                  <button type="button" className="pp-icon-btn" disabled={submitting || i === sequence.length - 1} onClick={() => moveInSequence(i, 1)} aria-label="Move down">▼</button>
                  <button type="button" className="pp-list-remove" disabled={submitting} onClick={() => removeFromSequence(doc.key)} aria-label="Remove">×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={submitting} onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={submitting} disabled={sequence.length === 0} onClick={handleGenerate}>Generate Final Proposal</Button>
      </Modal.Footer>
    </Modal>
  );
}
