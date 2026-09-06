// A translucent red overlay shown once a proposal is locked and its
// client outcome is still pending — a strong visual cue, not a hard trap:
// the backdrop itself is pointer-events:none so the navbar, "Back to
// Leads", and the rest of the page underneath all stay fully usable and
// scrollable; only the small response card floating on top is actually
// interactive. Portals straight to <body> like Modal.jsx does.
import { useState } from "react";
import { createPortal } from "react-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";

export default function ClientResponseBanner({ proposalId, onChanged }) {
  const [outcomeChoice, setOutcomeChoice] = useState(null); // 'awarded' | 'rejected'
  const [remark, setRemark] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSetOutcome() {
    if (!outcomeChoice) return;
    setSaving(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("set-proposal-outcome", {
        body: { proposal_id: proposalId, outcome: outcomeChoice, remark: remark.trim() || null },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to save the client's response.")); setSaving(false); return; }
      if (!data?.success) { setError(data?.error || "Failed to save the client's response."); setSaving(false); return; }
      // Leave `saving` true — this card disappears the moment the parent's
      // refetch confirms client_response is no longer "pending", so there's
      // no separate "done" state to reset back from.
      onChanged();
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setSaving(false);
    }
  }

  return createPortal(
    <div className="pp-locked-modal-backdrop">
      <div className="pp-locked-modal">
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <p className="pp-locked-modal-title">This proposal is locked — what did the client say?</p>
        <div className="pp-outcome-buttons">
          <Button variant={outcomeChoice === "awarded" ? "primary" : "secondary"} disabled={saving} onClick={() => setOutcomeChoice("awarded")}>Awarded</Button>
          <Button variant={outcomeChoice === "rejected" ? "danger" : "secondary"} disabled={saving} onClick={() => setOutcomeChoice("rejected")}>Rejected</Button>
        </div>
        {outcomeChoice && (
          <>
            <textarea className="input" rows={2} placeholder="Remark (optional)" value={remark} onChange={(e) => setRemark(e.target.value)} disabled={saving} style={{ marginTop: 8 }} />
            <Button variant="primary" size="sm" loading={saving} onClick={handleSetOutcome} style={{ marginTop: 8 }}>Save Response</Button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
