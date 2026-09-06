// "Merge Proposal" — checks for missing BA/AFC documents, lets AFC pick
// which attached documents go into the final package and in what order,
// then flattens them into one editable .docx (see proposalMergeBuilder.js
// for how — every page becomes an embedded image, matching how AFC's real
// proposals are actually assembled). The built file is both downloaded
// immediately and persisted to proposal_merged_files so it can be
// re-downloaded later without rebuilding.
import { useState, useEffect, useMemo } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import { buildMergedProposalDocx } from "../../utils/proposalMergeBuilder";
import { PROPOSAL_DOCUMENT_TYPES } from "../../lib/proposalPrep";

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function MergeProposalModal({ proposalId, baItems, checklistItems, documents, profile, onClose }) {
  const missingBa = baItems.filter((it) => !it.file_path).length;
  const missingChecklist = checklistItems.filter((it) => !it.file_path).length;
  const hasMissing = missingBa > 0 || missingChecklist > 0;

  const [step, setStep] = useState(hasMissing ? "warn" : "select");
  const [sequence, setSequence] = useState([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [builtBlob, setBuiltBlob] = useState(null);
  const [builtFileName, setBuiltFileName] = useState("");
  const [previousMerges, setPreviousMerges] = useState([]);
  const [loadingPrevious, setLoadingPrevious] = useState(true);

  const available = useMemo(() => {
    const list = [];
    baItems.filter((it) => it.file_path).forEach((it) => list.push({
      key: `ba_${it.id}`, label: it.item_name, fileName: it.file_name, filePath: it.file_path, group: "Documents from BA",
    }));
    checklistItems.filter((it) => it.file_path).forEach((it) => list.push({
      key: `checklist_${it.id}`, label: it.item_name, fileName: it.file_name, filePath: it.file_path, group: "AFC Checklist",
    }));
    (documents || []).forEach((d) => {
      const typeLabel = PROPOSAL_DOCUMENT_TYPES.find((t) => t.key === d.doc_type)?.label || d.doc_type;
      list.push({ key: `doc_${d.id}`, label: typeLabel, fileName: d.file_name, filePath: d.file_path, group: "Proposal Documents" });
    });
    return list;
  }, [baItems, checklistItems, documents]);

  const selectedKeys = new Set(sequence.map((s) => s.key));

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("proposal_merged_files").select("*").eq("proposal_id", proposalId).order("created_at", { ascending: false });
      setPreviousMerges(data || []);
      setLoadingPrevious(false);
    })();
  }, [proposalId]);

  function addToSequence(doc) {
    if (selectedKeys.has(doc.key)) return;
    setSequence((seq) => [...seq, doc]);
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

  const grouped = useMemo(() => {
    const byGroup = {};
    available.forEach((doc) => { (byGroup[doc.group] ||= []).push(doc); });
    return byGroup;
  }, [available]);

  async function handleBuild() {
    setStep("building");
    setError("");
    setProgress("Starting…");
    try {
      const blob = await buildMergedProposalDocx({
        items: sequence, proposalId, supabase,
        onProgress: (idx, total, label) => setProgress(`Building ${idx} of ${total}${label ? ` — ${label}` : ""}…`),
      });
      const fileName = `Merged_Proposal_${new Date().toISOString().slice(0, 10)}.docx`;

      const path = `${proposalId}/merged_${Date.now()}.docx`;
      const { error: upErr } = await supabase.storage.from("proposal-documents").upload(path, blob);
      if (upErr) throw new Error("Built the document but failed to save it: " + upErr.message);

      const { error: insErr } = await supabase.from("proposal_merged_files").insert({
        proposal_id: proposalId, file_name: fileName, file_path: path, file_size: blob.size,
        manifest: sequence.map((s) => ({ source: s.group, label: s.label, file_name: s.fileName })),
        proceeded_with_missing: hasMissing, created_by: profile.id,
      });
      if (insErr) throw new Error("Built and saved the document but failed to record it: " + insErr.message);

      setBuiltBlob(blob);
      setBuiltFileName(fileName);
      triggerDownload(blob, fileName);
      setStep("done");

      const { data: refreshed } = await supabase.from("proposal_merged_files").select("*").eq("proposal_id", proposalId).order("created_at", { ascending: false });
      setPreviousMerges(refreshed || []);
    } catch (err) {
      setError(err.message || "Something went wrong while building the document.");
      setStep("select");
    }
  }

  async function handleDownloadPrevious(row) {
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("get-proposal-document-url", {
        body: { path: row.file_path, proposal_id: proposalId },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to open document.")); return; }
      if (!data?.url) { setError(data?.error || "Failed to open document."); return; }
      const res = await fetch(data.url);
      const blob = await res.blob();
      triggerDownload(blob, row.file_name);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    }
  }

  return (
    <Modal onClose={onClose} size="lg" closeOnBackdrop={step !== "building"}>
      <Modal.Header title="Merge Proposal" subtitle="Assemble the documents you've collected into one final .docx" onClose={step !== "building" ? onClose : undefined} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        {step === "warn" && (
          <div>
            <p style={{ marginBottom: "var(--space-3)" }}>
              {missingBa > 0 && <>{missingBa} document{missingBa > 1 ? "s" : ""} requested from the BA {missingBa > 1 ? "haven't" : "hasn't"} been attached yet. </>}
              {missingChecklist > 0 && <>{missingChecklist} AFC checklist item{missingChecklist > 1 ? "s" : ""} {missingChecklist > 1 ? "have" : "has"} no file attached yet. </>}
            </p>
            <p className="text-secondary text-sm">You can still continue and merge with what's available — those items just won't be in the final document.</p>
          </div>
        )}

        {step === "select" && (
          <div className="pp-merge-grid">
            <div>
              <div className="pp-list-group-label">Available documents</div>
              {available.length === 0 && <p className="text-secondary text-sm">Nothing has been attached yet.</p>}
              {Object.entries(grouped).map(([group, docs]) => (
                <div key={group} className="pp-list-group">
                  <div className="pp-list-group-label">{group}</div>
                  {docs.map((doc) => {
                    const added = selectedKeys.has(doc.key);
                    return (
                      <div key={doc.key} className="pp-list-row pp-merge-available-row">
                        <div>
                          <div className="pp-list-row-title">{doc.label}</div>
                          <div className="pp-list-row-sub">{doc.fileName}</div>
                        </div>
                        <Button variant="secondary" size="sm" disabled={added} onClick={() => addToSequence(doc)}>
                          {added ? "Added" : "Add →"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div>
              <div className="pp-list-group-label">Merge order ({sequence.length})</div>
              {sequence.length === 0 && <p className="text-secondary text-sm">Add documents from the left, in the order you want them.</p>}
              {sequence.map((doc, i) => (
                <div key={doc.key} className="pp-list-row pp-merge-order-row">
                  <div className="pp-merge-order-num">{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div className="pp-list-row-title">{doc.label}</div>
                    <div className="pp-list-row-sub">{doc.fileName}</div>
                  </div>
                  <div className="pp-merge-order-actions">
                    <button type="button" className="pp-icon-btn" disabled={i === 0} onClick={() => moveInSequence(i, -1)} aria-label="Move up">▲</button>
                    <button type="button" className="pp-icon-btn" disabled={i === sequence.length - 1} onClick={() => moveInSequence(i, 1)} aria-label="Move down">▼</button>
                    <button type="button" className="pp-list-remove" onClick={() => removeFromSequence(doc.key)} aria-label="Remove">×</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === "building" && (
          <div style={{ padding: "var(--space-8) 0", textAlign: "center" }}>
            <PageLoader text={progress} />
          </div>
        )}

        {step === "done" && (
          <div>
            <Alert variant="success" onClose={null}>Merged document built and downloaded: {builtFileName}</Alert>
            <Button variant="secondary" size="sm" onClick={() => triggerDownload(builtBlob, builtFileName)}>Download Again</Button>
          </div>
        )}

        {(step === "select" || step === "done") && (
          <div style={{ marginTop: "var(--space-6)" }}>
            <div className="pp-list-group-label">Previous merges</div>
            {loadingPrevious ? (
              <p className="text-secondary text-sm">Loading…</p>
            ) : previousMerges.length === 0 ? (
              <p className="text-secondary text-sm">None yet.</p>
            ) : (
              previousMerges.map((row) => (
                <div key={row.id} className="pp-list-row">
                  <div>
                    <div className="pp-list-row-title">{row.file_name}</div>
                    <div className="pp-list-row-sub">{new Date(row.created_at).toLocaleString("en-IN")}</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => handleDownloadPrevious(row)}>Download</Button>
                </div>
              ))
            )}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        {step === "warn" && (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => setStep("select")}>Yes, Continue</Button>
          </>
        )}
        {step === "select" && (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={sequence.length === 0} onClick={handleBuild}>Build Merged Document</Button>
          </>
        )}
        {step === "done" && <Button variant="secondary" onClick={onClose}>Close</Button>}
      </Modal.Footer>
    </Modal>
  );
}
