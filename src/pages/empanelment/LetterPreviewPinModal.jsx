import { useEffect, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../../components/ui/Modal";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PinInput from "../../components/ui/PinInput";
import "../../styles/ApplicationReviewPage.css";

const ACTION_META = {
  md_accept: { fnName: "advance-empanelment-stage", previewType: "final", label: "accept this application", confirmLabel: "Confirm & Accept" },
  provisional_letter: { fnName: "send-provisional-letter", previewType: "provisional", label: "send the provisional letter", confirmLabel: "Confirm & Send" },
};

// Shows the exact PDF the real action would attach/send (via
// preview-empanelment-letter — read-only, nothing is sent/changed yet) on
// the left, PIN confirmation on the right — same ar-grid/ar-left/ar-right
// layout as the Lead Approval Note's preview-and-submit page, so this
// looks and behaves the same way across both modules. Used for MD Accept
// and the DGM's Provisional Letter — the two Empanelment actions that
// actually produce a letter. (MD Reject has no letter, so it stays on the
// plain PinConfirmModal.)
export default function LetterPreviewPinModal({ applicationId, action, comment, onClose, onSuccess }) {
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
        const { data, error: err } = await supabase.functions.invoke("preview-empanelment-letter", {
          body: { application_id: applicationId, type: meta.previewType },
        });
        if (cancelled) return;
        if (err) {
          setPreviewError(await extractFunctionErrorMessage(err, "Could not load the letter preview."));
          return;
        }
        if (!data?.success) {
          setPreviewError(data?.error || "Could not load the letter preview.");
          return;
        }
        setPdfDataUrl(`data:application/pdf;base64,${data.pdf_base64}`);
      } catch (err) {
        if (!cancelled) setPreviewError(err.message || "Something went wrong.");
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }
    loadPreview();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, action]);

  async function handleConfirm() {
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter your 4-digit PIN.");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const body =
        action === "provisional_letter"
          ? { application_id: applicationId, pin }
          : { application_id: applicationId, action, comment, pin };
      const { data, error: err } = await supabase.functions.invoke(meta.fnName, { body });
      if (err) {
        setError(await extractFunctionErrorMessage(err, "Action failed."));
        return;
      }
      if (!data?.success) {
        setError(data?.error || "Action failed.");
        return;
      }
      onSuccess(data);
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
        subtitle={`This is exactly what will be attached/emailed if you ${meta.label}.`}
        onClose={!verifying ? onClose : undefined}
      />
      <Modal.Body>
        <div className="ar-grid">
          <div className="ar-left">
            <Card>
              <Card.Header title="Letter Preview" />
              <Card.Body>
                {previewError ? (
                  <Alert variant="danger">{previewError}</Alert>
                ) : loadingPreview ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: "var(--text-secondary)" }}>
                    Generating preview…
                  </div>
                ) : (
                  <iframe
                    title="Letter preview"
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
                  Nothing is sent until you enter your PIN and confirm.
                </p>

                {error && (
                  <Alert variant="danger" onClose={() => setError("")}>
                    {error}
                  </Alert>
                )}

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
