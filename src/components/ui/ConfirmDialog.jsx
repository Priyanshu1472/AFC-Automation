// src/components/ui/ConfirmDialog.jsx
// Generic "Are you sure?" confirmation — built on the same Modal every
// other dialog in the app uses, so a destructive one-click action (remove,
// delete, drop...) gets a consistent styled confirm step instead of each
// caller rolling its own, or falling back to the browser's native confirm().
import Modal from "./Modal";
import Button from "./Button";

export default function ConfirmDialog({
  title = "Are you sure?",
  message,
  confirmLabel = "Yes",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal onClose={!loading ? onCancel : undefined} size="sm" closeOnBackdrop={!loading}>
      <Modal.Header title={title} onClose={!loading ? onCancel : undefined} />
      <Modal.Body>
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>{message}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={loading} onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={variant} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </Modal.Footer>
    </Modal>
  );
}
