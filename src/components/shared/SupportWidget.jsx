// Navbar "Support" button — any signed-in user describes an issue and
// optionally attaches screenshots; Send emails it straight to the support
// inbox (see send-support-request), which also stamps who sent it and when.
// No in-app history is kept — this is a one-way notice, same shape as
// NotificationBell's panel but for composing instead of reading.
import { useRef, useState, useEffect } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useToast } from "../../hooks/useToast";
import { HelpCircleIcon, CloseIcon, PaperclipIcon } from "../icons";
import "../../styles/SupportWidget.css";

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function SupportWidget() {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]); // [{ file, previewUrl }]
  const [sending, setSending] = useState(false);
  const wrapRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    // Revoke object URLs on unmount/replace so previews don't leak memory.
    return () => files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
  }, [files]);

  function resetForm() {
    files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    setMessage("");
    setFiles([]);
  }

  function handleFilePick(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // allow re-picking the same file
    if (!picked.length) return;

    const room = MAX_ATTACHMENTS - files.length;
    if (room <= 0) {
      showToast(`You can attach up to ${MAX_ATTACHMENTS} images.`, "danger");
      return;
    }

    const accepted = [];
    for (const file of picked.slice(0, room)) {
      if (!file.type.startsWith("image/")) {
        showToast(`"${file.name}" isn't an image.`, "danger");
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        showToast(`"${file.name}" is too large — each image must be under 5MB.`, "danger");
        continue;
      }
      accepted.push({ file, previewUrl: URL.createObjectURL(file) });
    }
    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
  }

  function removeFile(index) {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSend() {
    if (!message.trim()) {
      showToast("Please describe the issue before sending.", "danger");
      return;
    }
    setSending(true);
    try {
      const attachments = await Promise.all(
        files.map(async ({ file }) => ({
          filename: file.name,
          contentType: file.type,
          content: await readAsBase64(file),
        }))
      );

      const { data, error } = await supabase.functions.invoke("send-support-request", {
        body: { message: message.trim(), attachments },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to send. Please try again."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to send. Please try again.", "danger");
        return;
      }
      showToast("Sent — support has been notified.", "success");
      resetForm();
      setOpen(false);
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="support-widget-wrap" ref={wrapRef}>
      <button
        type="button"
        className="support-widget-btn"
        onClick={() => setOpen((p) => !p)}
        title="Support"
        aria-label="Support"
        aria-expanded={open}
      >
        <HelpCircleIcon />
      </button>

      {open && (
        <div className="support-widget-panel" role="dialog" aria-label="Contact support">
          <div className="support-widget-panel-header">
            <span className="support-widget-panel-title">Need help?</span>
            <button
              type="button"
              className="support-widget-close"
              onClick={() => setOpen(false)}
              aria-label="Close support"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="support-widget-body">
            <p className="support-widget-hint">Tell us what's going wrong — a screen name, an error, anything that didn't make sense.</p>

            <textarea
              className="support-widget-textarea"
              placeholder="What issue are you facing?"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={4000}
              rows={5}
              disabled={sending}
            />

            {files.length > 0 && (
              <div className="support-widget-previews">
                {files.map((f, i) => (
                  <div className="support-widget-preview" key={f.previewUrl}>
                    <img src={f.previewUrl} alt={f.file.name} />
                    <button
                      type="button"
                      className="support-widget-preview-remove"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${f.file.name}`}
                      disabled={sending}
                    >
                      <CloseIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="support-widget-actions">
              <button
                type="button"
                className="support-widget-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || files.length >= MAX_ATTACHMENTS}
              >
                <PaperclipIcon />
                Attach image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleFilePick}
              />
              <button
                type="button"
                className="support-widget-send-btn"
                onClick={handleSend}
                disabled={sending || !message.trim()}
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
