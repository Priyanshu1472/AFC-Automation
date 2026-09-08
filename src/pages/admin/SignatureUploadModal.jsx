// Admin-only: uploads or replaces a user's signature image, embedded into
// generated PDFs (e.g. the Lead Approval Note) in place of a blank
// signature line. Mirrors ResetPinModal's shape as a standalone action
// modal, independent of the main "Save Changes" button on Edit User.
import { useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../../components/ui/Modal";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";

const SIGNATURE_TYPES = ["image/png", "image/jpeg"];

export default function SignatureUploadModal({ targetUserId, targetName, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleFileChange(e) {
    const f = e.target.files?.[0] || null;
    setError("");
    if (f && !SIGNATURE_TYPES.includes(f.type)) {
      setError("Signature must be a PNG or JPEG image.");
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function handleSubmit() {
    setError("");
    if (!file) return setError("Choose a signature image to upload.");

    setLoading(true);
    try {
      const fd = new FormData();
      fd.set("user_id", targetUserId);
      fd.set("file", file, file.name);
      const { data, error: fnError } = await supabase.functions.invoke("upload-user-signature", { body: fd });
      if (fnError) {
        setError(await extractFunctionErrorMessage(fnError, "Could not upload the signature."));
        return;
      }
      if (!data?.success) {
        setError(data?.error || "Could not upload the signature.");
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal onClose={!loading ? onClose : undefined} closeOnBackdrop={!loading}>
      <Modal.Header title="Upload Signature" subtitle={`Set the signature image for ${targetName}. It replaces any existing one.`} onClose={!loading ? onClose : undefined} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <label className="cup-file-drop">
          <input type="file" accept="image/png,image/jpeg" onChange={handleFileChange} disabled={loading} />
          {file ? file.name : "Click to choose a signature image (PNG or JPEG)"}
        </label>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={loading} onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={loading} disabled={loading || !file} onClick={handleSubmit}>
          Upload
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
