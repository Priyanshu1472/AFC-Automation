// Milestones & Deliverables, as set in the client MoU. Milestones are
// listed by due date; their deliverables nest underneath in ascending
// "Deliverable N" order (creation order, same as their number) rather than
// by due date, so the number on screen always matches its position in the
// list. Anything not tied to a milestone sits in its own group, same
// ordering. Each item shows how close its due date is, and billable items
// show their invoice state — a
// completed billable item with no client invoice yet gets a "Raise
// Invoice" shortcut. Writes are direct RLS (can_edit_monitoring_project);
// completion stamping and the invoice alert happen in DB triggers.
import { useState } from "react";
import { supabase } from "../../lib/supabase";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ConfirmDialog from "../ui/ConfirmDialog";
import Modal from "../ui/Modal";
import {
  ListChecksIcon, PencilIcon, TrashIcon, CheckCircleIcon, ReceiptIcon, PaperclipIcon, ImageIcon, FileTextIcon,
  TargetIcon, CalendarIcon, ClockIcon, ExclamationIcon, CheckIcon, TagIcon, RotateCcwIcon, ArrowRightIcon,
} from "../icons";
import { ItemModal, CompleteItemModal, NoteModal, ImagesModal } from "./ItemModals";
import { fmtDate, formatINR, itemTiming, itemUrgencyLevel, itemElapsed, dueLabel, needsInvoice, isItemInvoiced, itemBilled, deliverableNumbers, openMonitoringFile } from "../../lib/monitoring";

// Status icon + badge per urgency level (see itemUrgencyLevel()).
const URGENCY = {
  red: { label: "Overdue", icon: <ExclamationIcon /> },
  amber: { label: "Amber", icon: <ClockIcon /> },
  yellow: { label: "Yellow", icon: <CalendarIcon /> },
  green: { label: "Green", icon: <CheckIcon /> },
  done: { label: "Completed", icon: <CheckIcon /> },
  none: { label: "No due date", icon: <CalendarIcon /> },
};
const LEGEND = [["green", "Green", "<50%"], ["yellow", "Yellow", "50–70%"], ["amber", "Amber", "70–100%"], ["red", "Red", "Overdue"]];

function byDue(a, b) {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return new Date(a.created_at) - new Date(b.created_at);
}

// Deliverables list in ascending "Deliverable N" order — the same creation
// order deliverableNumbers() numbers them in — rather than by due date, so
// the number on screen always matches its position in the list.
function byCreated(a, b) {
  return new Date(a.created_at) - new Date(b.created_at);
}

export default function MonitoringPlanPanel({ projectId, project, items, documents = [], clientInvoices, canEdit, onRaiseInvoice, onChanged }) {
  const [dialog, setDialog] = useState(null); // { type, item?, kind?, parentId? }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function viewFile(doc) {
    setError("");
    try { await openMonitoringFile(doc.file_path); } catch (err) { setError(err.message); }
  }

  const milestones = items.filter((i) => i.kind === "milestone").sort(byDue);
  const childrenOf = (id) => items.filter((i) => i.parent_id === id).sort(byCreated);
  const loose = items.filter((i) => i.kind === "deliverable" && !i.parent_id).sort(byCreated);
  const done = items.filter((i) => i.status === "completed").length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const numbers = deliverableNumbers(items);

  function close() { setDialog(null); }
  function saved() { setDialog(null); onChanged(); }

  async function reopen(item) {
    setBusy(true);
    setError("");
    const { error: dbErr } = await supabase.from("monitoring_items").update({ status: "pending" }).eq("id", item.id);
    setBusy(false);
    setDialog(null);
    if (dbErr) setError(dbErr.message);
    onChanged();
  }

  async function detachFromMilestone(item) {
    setBusy(true);
    setError("");
    const { error: dbErr } = await supabase.from("monitoring_items").update({ parent_id: null }).eq("id", item.id);
    setBusy(false);
    setDialog(null);
    if (dbErr) setError(dbErr.message);
    onChanged();
  }

  async function remove(item) {
    setBusy(true);
    setError("");
    const { error: dbErr } = await supabase.from("monitoring_items").delete().eq("id", item.id);
    setBusy(false);
    setDialog(null);
    if (dbErr) setError(/client_invoice_lines/.test(dbErr.message) ? "It can't be deleted — an invoice has been raised against it (or one of its deliverables)." : dbErr.message);
    onChanged();
  }

  function renderItem(item, nested = false, parent = null) {
    const timing = itemTiming(item);
    const urgency = itemUrgencyLevel(item);
    const status = URGENCY[urgency];
    const elapsed = itemElapsed(item);
    const billed = itemBilled(item, clientInvoices, items);
    const invoiced = isItemInvoiced(item, clientInvoices, items);
    const pendingInvoice = needsInvoice(item, clientInvoices, items);
    const isMilestone = item.kind === "milestone";
    const isDone = item.status === "completed";
    const kids = isMilestone ? childrenOf(item.id) : [];
    const openKids = kids.filter((c) => c.status !== "completed").length;
    const files = documents.filter((d) => d.item_id === item.id);

    return (
      <div className={`mon-card is-${timing} is-urg-${urgency}${isMilestone ? " is-milestone" : ""}${nested ? " is-nested" : ""}`}>
        <span className="mon-card-status" aria-hidden="true">{status.icon}</span>

        <div className="mon-card-main">
          <div className="mon-card-title-row">
            <span className="mon-card-badge">{status.label}</span>
            {isMilestone && <span className="mon-item-kind">Milestone</span>}
            {!isMilestone && numbers[item.id] && <span className="mon-item-kind">Deliverable {numbers[item.id]}</span>}
            <span className="mon-card-title">{item.title}</span>
          </div>
          {item.description && <p className="mon-card-desc">{item.description}</p>}
          <div className="mon-card-meta">
            <span className="mon-card-due">
              <CalendarIcon />
              {isDone ? (
                <>Completed <strong>{fmtDate(item.completed_at)}</strong></>
              ) : item.due_date ? (
                <>{fmtDate(item.due_date)} <ArrowRightIcon /> <strong>{dueLabel(item)}</strong></>
              ) : "No due date"}
            </span>
            {(item.invoice_on_completion || billed > 0) && (
              <span className={`mon-chip${pendingInvoice ? " is-alert" : ""}`}>
                <FileTextIcon />
                {invoiced ? "Invoiced" : billed > 0 ? `Invoiced ${formatINR(billed)}` : pendingInvoice ? "Invoice to raise" : "Billable"}
                {Number(item.invoice_amount) > 0 ? `${billed > 0 && !invoiced ? " of " : " · "}${item.invoice_pct != null ? `${item.invoice_pct}% · ` : ""}${formatINR(item.invoice_amount)}` : ""}
              </span>
            )}
            {kids.length > 0 && (
              <span className="mon-chip"><ListChecksIcon /> {kids.length - openKids}/{kids.length} deliverables</span>
            )}
          </div>
          {isDone && item.completion_note && <p className="mon-card-note"><strong>Details:</strong> “{item.completion_note}”</p>}
          {item.remarks && <p className="mon-card-note"><strong>Note/Remarks:</strong> {item.remarks}</p>}
          {files.length > 0 && (
            <div className="mon-card-files">
              {files.map((d) => (
                <button key={d.id} type="button" className="mon-link" onClick={() => viewFile(d)}>
                  <PaperclipIcon /> {d.file_name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mon-card-elapsed">
          <div className="mon-card-bar-row">
            <div className="mon-card-bar"><span style={{ width: `${isDone ? 100 : elapsed ? elapsed.pct : 0}%` }} /></div>
            <span className="mon-card-pct">{isDone ? "Done" : elapsed ? `${elapsed.pct}%` : "—"}</span>
          </div>
          <span className="mon-card-elapsed-label">{isDone ? "Completed" : "Elapsed"}</span>
          <span className="mon-card-elapsed-value">
            {isDone ? fmtDate(item.completed_at) : elapsed ? `${elapsed.elapsed} / ${elapsed.total} days` : "No due date"}
          </span>
        </div>

        {canEdit && (
          <div className="mon-card-side">
            <div className="mon-card-icons">
              {isDone ? (
                <button type="button" className="mon-icon-btn" disabled={busy || billed > 0} title={billed > 0 ? "Invoiced — can't reopen" : "Reopen"} aria-label={`Reopen ${item.title}`} onClick={() => setDialog({ type: "reopen", item })}><RotateCcwIcon /></button>
              ) : (
                <button type="button" className="mon-icon-btn is-success" disabled={busy} title="Mark complete" aria-label={`Mark ${item.title} complete`} onClick={() => setDialog({ type: "complete", item, openKids })}><CheckCircleIcon /></button>
              )}
              {!isMilestone && (
                <button type="button" className="mon-icon-btn" title={item.remarks ? "Edit notes" : "Add note"} aria-label={`${item.remarks ? "Edit" : "Add"} notes for ${item.title}`} onClick={() => setDialog({ type: "note", item })}><FileTextIcon /></button>
              )}
              <button type="button" className="mon-icon-btn" title="Edit" aria-label={`Edit ${item.title}`} onClick={() => setDialog({ type: "edit", item })}><PencilIcon /></button>
              <button
                type="button"
                className="mon-icon-btn is-danger"
                title={billed > 0 ? "Invoiced — can't be deleted" : "Delete"}
                aria-label={`Delete ${item.title}`}
                disabled={billed > 0}
                onClick={() => (parent ? setDialog({ type: "delete_nested", item, parent }) : setDialog({ type: "delete", item }))}
              >
                <TrashIcon />
              </button>
            </div>
            {!isMilestone && (
              <button type="button" className="mon-card-images" onClick={() => setDialog({ type: "images", item })}>
                <ImageIcon /> View Images
              </button>
            )}
            {pendingInvoice && (
              <Button size="sm" icon={<ReceiptIcon />} onClick={() => onRaiseInvoice(item)}>Raise Invoice</Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card>
      <Collapsible
        title="Milestones & Deliverables"
        icon={<TargetIcon />}
        expandable={false}
        action={canEdit ? (
          <div className="mon-header-actions">
            <Button size="sm" onClick={() => setDialog({ type: "add", kind: "milestone" })}>+ Milestone</Button>
            <Button variant="secondary" size="sm" onClick={() => setDialog({ type: "add", kind: "deliverable" })}>+ Standalone Deliverable</Button>
          </div>
        ) : null}
      >
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        {items.length === 0 ? (
          <p className="mon-empty">
            Nothing planned yet.{canEdit ? " Add the milestones from the client MoU, then the deliverables under each." : ""}
          </p>
        ) : (
          <>
            <div className="mon-plan-summary">
              <div className="mon-plan-pills">
                {(project?.start_date || project?.end_date) && (
                  <span className="mon-chip is-lg"><CalendarIcon /> {fmtDate(project.start_date)} – {fmtDate(project.end_date)}</span>
                )}
                <span className="mon-chip is-lg"><TargetIcon /> Total Milestones <span className="mon-chip-count">{milestones.length}</span></span>
                <span className="mon-chip is-lg"><TagIcon /> Deliverables <span className="mon-chip-count">{items.length - milestones.length}</span></span>
                <span className="mon-chip is-lg" aria-label={`${done} of ${items.length} complete`}><CheckCircleIcon /> Completed <span className="mon-chip-count">{done}/{items.length} · {pct}%</span></span>
              </div>
              <div className="mon-legend" aria-label="Color key">
                {LEGEND.map(([key, label, hint]) => (
                  <span key={key} className={`mon-legend-item is-urg-${key}`}>
                    <span className="mon-legend-dot" />
                    <span><strong>{label}</strong><small>({hint})</small></span>
                  </span>
                ))}
              </div>
            </div>

            <div className="mon-plan">
              {milestones.map((m) => {
                const kids = childrenOf(m.id);
                return (
                  <section key={m.id} className="mon-milestone">
                    {renderItem(m)}
                    {(kids.length > 0 || (canEdit && m.status !== "completed")) && (
                      <div className="mon-tree">
                        {kids.map((d) => <div key={d.id} className="mon-tree-node">{renderItem(d, true, m)}</div>)}
                        {canEdit && m.status !== "completed" && (
                          <div className="mon-tree-node mon-tree-add">
                            <button type="button" className="mon-add-link" onClick={() => setDialog({ type: "add", kind: "deliverable", parentId: m.id })}>
                              + Add deliverable
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
              {loose.length > 0 && (
                <section className="mon-milestone is-loose">
                  {milestones.length > 0 && <div className="mon-group-label">Deliverables not under a milestone</div>}
                  {loose.map((d) => <div key={d.id} className="mon-loose-node">{renderItem(d)}</div>)}
                </section>
              )}
            </div>
          </>
        )}
      </Collapsible>

      {(dialog?.type === "add" || dialog?.type === "edit") && (
        <ItemModal
          projectId={projectId}
          kind={dialog.item?.kind || dialog.kind}
          item={dialog.item}
          milestones={milestones}
          defaultParentId={dialog.parentId}
          onClose={close}
          onSaved={saved}
        />
      )}
      {dialog?.type === "complete" && <CompleteItemModal item={dialog.item} openChildren={dialog.openKids} onClose={close} onSaved={saved} />}
      {dialog?.type === "note" && <NoteModal item={dialog.item} onClose={close} onSaved={saved} />}
      {dialog?.type === "images" && (
        <ImagesModal projectId={projectId} item={dialog.item} documents={documents} onClose={close} onUploaded={onChanged} />
      )}
      {dialog?.type === "reopen" && (
        <ConfirmDialog
          title="Reopen this item?"
          message={`“${dialog.item.title}” will go back to pending.`}
          confirmLabel="Reopen"
          variant="primary"
          loading={busy}
          onConfirm={() => reopen(dialog.item)}
          onCancel={close}
        />
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.item.kind}?`}
          message={dialog.item.kind === "milestone" && childrenOf(dialog.item.id).length
            ? `“${dialog.item.title}” and its ${childrenOf(dialog.item.id).length} deliverable(s) will be deleted.`
            : `“${dialog.item.title}” will be deleted.`}
          confirmLabel="Delete"
          loading={busy}
          onConfirm={() => remove(dialog.item)}
          onCancel={close}
        />
      )}
      {dialog?.type === "delete_nested" && (
        <Modal onClose={!busy ? close : undefined} closeOnBackdrop={!busy}>
          <Modal.Header title="Remove this deliverable?" onClose={!busy ? close : undefined} />
          <Modal.Body>
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>
              “{dialog.item.title}” is under the milestone “{dialog.parent.title}”. Remove it from the milestone (it stays on as a standalone deliverable), or delete it outright.
            </p>
          </Modal.Body>
          <Modal.Footer className="is-centered">
            <Button variant="primary" loading={busy} onClick={() => detachFromMilestone(dialog.item)}>Remove from Milestone</Button>
            <Button variant="danger" loading={busy} onClick={() => remove(dialog.item)}>Delete Deliverable</Button>
            <Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button>
          </Modal.Footer>
        </Modal>
      )}
    </Card>
  );
}
