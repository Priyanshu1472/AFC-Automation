import { useEffect, useRef, useState } from "react";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import "../../styles/AvatarCropModal.css";

const VIEW = 280; // on-screen crop square, px
const OUT = 256; // saved avatar size, px
const MAX_ZOOM = 4;

// Keeps the image covering the whole crop square — never a gap at an edge.
function clampOffset(x, y, w, h) {
  return {
    x: Math.min(0, Math.max(VIEW - w, x)),
    y: Math.min(0, Math.max(VIEW - h, y)),
  };
}

// Lets the user drag and zoom the picked photo inside a round frame, then
// hands back the framed square as a OUT×OUT JPEG blob.
export default function AvatarCropModal({ file, busy = false, onCancel, onConfirm }) {
  const [img, setImg] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const dragRef = useRef(null);
  const pointersRef = useRef(new Map());

  // `cancelled` matters: revoking the URL in cleanup makes a still-loading
  // image fire onerror, which must not be reported once this load has been
  // superseded (StrictMode runs this effect twice in development).
  useEffect(() => {
    let cancelled = false;
    const url = URL.createObjectURL(file);
    const image = new Image();
    setError("");
    setImg(null);
    image.onload = () => {
      if (cancelled) return;
      const base = VIEW / Math.min(image.naturalWidth, image.naturalHeight);
      const w = image.naturalWidth * base;
      const h = image.naturalHeight * base;
      setImg(image);
      setZoom(1);
      setOffset({ x: (VIEW - w) / 2, y: (VIEW - h) / 2 });
    };
    image.onerror = () => {
      if (!cancelled) setError("This image couldn't be opened. Please choose a JPG, PNG or WebP photo.");
    };
    image.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = base * zoom;
  const dispW = img ? img.naturalWidth * scale : VIEW;
  const dispH = img ? img.naturalHeight * scale : VIEW;

  // Zooms around the crop square's centre so the framed area stays put.
  function applyZoom(next) {
    if (!img) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const ratio = z / zoom;
    const cx = VIEW / 2;
    const nx = cx - (cx - offset.x) * ratio;
    const ny = cx - (cx - offset.y) * ratio;
    setZoom(z);
    setOffset(clampOffset(nx, ny, img.naturalWidth * base * z, img.naturalHeight * base * z));
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset };
    } else {
      dragRef.current = null;
    }
  }

  function onPointerMove(e) {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers: pinch to zoom.
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(a.x - b.x, a.y - b.y);
      if (before > 0) applyZoom(zoom * (after / before));
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    setOffset(clampOffset(drag.origin.x + e.clientX - drag.startX, drag.origin.y + e.clientY - drag.startY, dispW, dispH));
  }

  function onPointerUp(e) {
    pointersRef.current.delete(e.pointerId);
    dragRef.current = null;
  }

  function onWheel(e) {
    applyZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }

  function handleConfirm() {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const side = VIEW / scale;
    canvas.getContext("2d").drawImage(img, -offset.x / scale, -offset.y / scale, side, side, 0, 0, OUT, OUT);
    canvas.toBlob(
      (blob) => (blob ? onConfirm(blob) : setError("Could not process this image. Please try another one.")),
      "image/jpeg",
      0.9
    );
  }

  return (
    <Modal onClose={busy ? undefined : onCancel} size="sm" closeOnBackdrop={!busy}>
      <Modal.Header title="Crop your photo" subtitle="Drag to move, zoom to fit your face in the circle." onClose={busy ? undefined : onCancel} />
      <Modal.Body>
        {error ? (
          <p className="text-sm text-secondary">{error}</p>
        ) : (
          <div className="acm">
            <div
              className={`acm-view${img ? "" : " loading"}`}
              style={{ width: VIEW, height: VIEW }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
            >
              {img && (
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  className="acm-img"
                  style={{ width: dispW, height: dispH, transform: `translate(${offset.x}px, ${offset.y}px)` }}
                />
              )}
              <span className="acm-mask" aria-hidden="true" />
            </div>

            <label className="acm-zoom">
              <span aria-hidden="true">−</span>
              <input
                type="range"
                min="1"
                max={MAX_ZOOM}
                step="0.01"
                value={zoom}
                onChange={(e) => applyZoom(Number(e.target.value))}
                aria-label="Zoom"
                disabled={!img || busy}
              />
              <span aria-hidden="true">+</span>
            </label>
          </div>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleConfirm} loading={busy} disabled={!img || busy || !!error}>
          {busy ? "Saving…" : "Save Photo"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
