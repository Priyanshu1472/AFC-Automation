// The CFO's own approve/reject on a pending client invoice — PIN-gated the
// same way as every other decision in the app (decide-fee-note-md's
// pattern). Approving stamps the CFO's signature onto the invoice PDF
// (decide-client-invoice → clientInvoicePdf.ts); rejecting requires a remark
// and sends it back to the team for them to fix and resubmit.
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import PinInput from "../ui/PinInput";

export function CfoInvoiceDecisionModal({ invoice, decision, onClose, onSaved }) {
  const isApprove = decision === "approved";
  const [remark, setRemark] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!isApprove && !remark.trim()) { setError("A remark is required when rejecting an invoice."); return; }
    if (!/^\d{4}$/.test(pin)) { setError("Enter your 4-digit PIN."); return; }
    setSaving(true);
    setError("");
    try {
      const { data, error: err } = await supabase.functions.invoke("decide-client-invoice", {
        body: { invoice_id: invoice.id, decision, remark: remark.trim() || null, pin },
      });
      if (err) { setError(await extractFunctionErrorMessage(err, "Action failed.")); return; }
      if (!data?.success) { setError(data?.error || "Action failed."); return; }
      onSaved();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={!saving ? onClose : undefined} closeOnBackdrop={!saving}>
      <Modal.Header
        title={isApprove ? "Approve & Sign Invoice" : "Reject Invoice"}
        subtitle={isApprove
          ? `Your signature will be printed on invoice ${invoice.invoice_number} and it will be ready to send to the client.`
          : `Invoice ${invoice.invoice_number} goes back to the team to fix and resubmit.`}
        onClose={!saving ? onClose : undefined}
      />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        <div className="field">
          <label className="field-label">Remark {!isApprove && <span className="required">*</span>}</label>
          <textarea
            className="input"
            rows={3}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder={isApprove ? "Optional" : "Why is this invoice being sent back?"}
            autoFocus
          />
        </div>

        <div className="field" style={{ marginTop: "var(--space-3)" }}>
          <PinInput
            label="Your Action PIN"
            required
            value={pin}
            onChange={setPin}
            disabled={saving}
            hint="Confirms it's really you"
          />
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button
          variant={isApprove ? "primary" : "secondary"}
          loading={saving}
          disabled={saving || pin.length !== 4 || (!isApprove && !remark.trim())}
          onClick={handleConfirm}
        >
          {isApprove ? "Approve & Sign" : "Reject"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
