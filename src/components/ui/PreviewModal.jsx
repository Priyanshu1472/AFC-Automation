import { useEffect } from "react";
import { createPortal } from "react-dom";
import "../../styles/PreviewModal.css";

const PREVIEW_STYLES = `
<style>
  body { font-family: "Times New Roman", Times, serif; font-size: 10pt; color: #000; margin: 0; padding: 0; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #000; padding: 4px 6px; vertical-align: top; font-size: 10pt; }
  th { font-weight: bold; background: #f0f0f0; }
  p { margin: 0 0 4px 0; }
</style>
`;

export default function PreviewModal({ html, title, onDownload, onClose, downloadLabel = "Download" }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return createPortal(
    <div className="pv-overlay" onClick={onClose}>
      <div className="pv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pv-modal-header">
          <div className="pv-modal-title">
            <span className="pv-preview-badge">Preview</span>
            <span className="pv-modal-name">{title}</span>
          </div>
          <div className="pv-modal-actions">
            <button className="pv-download-btn" onClick={onDownload}>
              ↓ {downloadLabel}
            </button>
            <button className="pv-close-btn" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="pv-modal-body">
          <div className="pv-content" dangerouslySetInnerHTML={{ __html: PREVIEW_STYLES + html }} />
        </div>
      </div>
    </div>,
    document.body
  );
}
