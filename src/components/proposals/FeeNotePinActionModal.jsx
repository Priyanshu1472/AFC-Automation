// Preview-and-confirm modal for the fee note actions that actually sign the
// note — Person Responsible forwarding to Approval Authority, Approval
// Authority forwarding to MD, and the MD's final approval. Shows the exact
// PDF the action produces (via preview-fee-note — read-only, nothing
// changes) next to a PIN confirmation, same layout as Empanelment's
// LetterPreviewPinModal so the pattern looks and behaves the same way
// across modules.
import { useEffect, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../../components/ui/Modal";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PinInput from "../../components/ui/PinInput";
// Reuses Empanelment's preview/confirm layout classes (.ar-grid/.ar-left/
// .ar-right/...) so this looks and behaves the same way LetterPreviewPinModal
// does there, rather than redefining the same split-pane layout twice.
import "../../styles/ApplicationReviewPage.css";

const ACTION_META = {
  pr_forward: {
    label: "forward this note to the Approval Authority",
    confirmLabel: "Confirm & Forward",
    run: (feeNoteId, pin) => supabase.functions.invoke("advance-fee-note-stage", { body: { fee_note_id: feeNoteId, action: "pr_forward", pin } }),
  },
  aa_forward: {
    label: "forward this note to the MD",
    confirmLabel: "Confirm & Forward",
    run: (feeNoteId, pin) => supabase.functions.invoke("advance-fee-note-stage", { body: { fee_note_id: feeNoteId, action: "aa_forward", pin } }),
  },
  md_approve: {
    label: "approve this note",
    confirmLabel: "Confirm & Approve",
    run: (feeNoteId, pin) => supabase.functions.invoke("decide-fee-note-md", { body: { fee_note_id: feeNoteId, decision: "approved", pin } }),
  },
};

export default function FeeNotePinActionModal({ feeNoteId, action, onClose, onSuccess }) {
  const meta = ACTION_META[action];
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [pdfDataUrl, setPdfDataUrl] = useState(null);
  const [pin, setPin] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadPreview() {
      setLoadingPreview(true);
      setPreviewError("");
      try {
        const { data, error: err } = await supabase.functions.invoke("preview-fee-note", { body: { fee_note_id: feeNoteId } });
        if (cancelled) return;
        if (err) { setPreviewError(await extractFunctionErrorMessage(err, "Could not load the note preview.")); return; }
        if (!data?.success) { setPreviewError(data?.error || "Could not load the note preview."); return; }
        setPdfDataUrl(`data:application/pdf;base64,${data.pdf_base64}`);
      } catch (err) {
        if (!cancelled) setPreviewError(err.message || "Something went wrong.");
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }
    loadPreview();
    return () => { cancelled = true; };
  }, [feeNoteId]);

  async function handleConfirm() {
    if (!/^\d{4}$/.test(pin)) { setError("Enter your 4-digit PIN."); return; }
    setVerifying(true);
    setError("");
    try {
      const { data, error: err } = await meta.run(feeNoteId, pin);
      if (err) { setError(await extractFunctionErrorMessage(err, "Action failed.")); return; }
      if (!data?.success) { setError(data?.error || "Action failed."); return; }
      onSuccess();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Modal size="2xl" onClose={() => !verifying && onClose()} closeOnBackdrop={!verifying}>
      <Modal.Header
        title="Preview & Confirm"
        subtitle={`This is exactly what will be signed if you ${meta.label}.`}
        onClose={!verifying ? onClose : undefined}
      />
      <Modal.Body>
        <div className="ar-grid">
          <div className="ar-left">
            <Card>
              <Card.Header title="Note Preview" />
              <Card.Body>
                {previewError ? (
                  <Alert variant="danger">{previewError}</Alert>
                ) : loadingPreview ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: "var(--text-secondary)" }}>
                    Generating preview…
                  </div>
                ) : (
                  <iframe
                    title="Fee note preview"
                    src={pdfDataUrl}
                    style={{ width: "100%", height: "70vh", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-md)" }}
                  />
                )}
              </Card.Body>
            </Card>
          </div>

          <div className="ar-right">
            <Card className="ar-action-card">
              <Card.Header title="Confirm with PIN" />
              <Card.Body className="ar-action-body">
                <p className="ar-empty-text" style={{ marginBottom: "var(--space-3)" }}>
                  Nothing changes until you enter your PIN and confirm.
                </p>

                {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

                {!previewError && (
                  <div className="ar-field">
                    <PinInput
                      label="Your Action PIN"
                      required
                      value={pin}
                      onChange={setPin}
                      disabled={verifying || loadingPreview}
                      autoFocus
                      hint="Confirms it's really you — set or change this from My Profile."
                    />
                  </div>
                )}

                {!previewError && (
                  <Button variant="primary" block loading={verifying} disabled={verifying || loadingPreview || pin.length !== 4} onClick={handleConfirm}>
                    {verifying ? "Verifying…" : meta.confirmLabel}
                  </Button>
                )}
                <Button variant="secondary" block disabled={verifying} onClick={onClose}>
                  Cancel
                </Button>
              </Card.Body>
            </Card>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
}
