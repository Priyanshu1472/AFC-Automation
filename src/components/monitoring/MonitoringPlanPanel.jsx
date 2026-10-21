// Milestones & Deliverables, as set in the client MoU. Milestones are
// listed by due date with their deliverables nested under them; anything
// not tied to a milestone sits in its own group. Each item shows how close
// its due date is, and billable items show their invoice state — a
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
import { ListChecksIcon, PencilIcon, TrashIcon, CheckCircleIcon, ReceiptIcon } from "../icons";
import { ItemModal, CompleteItemModal } from "./ItemModals";
import { fmtDate, formatINR, itemTiming, dueLabel, needsInvoice, isItemInvoiced, itemBilled } from "../../lib/monitoring";

function byDue(a, b) {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date) return -1;
  if (b.due_date) return 1;
  return new Date(a.created_at) - new Date(b.created_at);
}

export default function MonitoringPlanPanel({ projectId, items, clientInvoices, canEdit, onRaiseInvoice, onChanged }) {
  const [dialog, setDialog] = useState(null); // { type, item?, kind?, parentId? }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const milestones = items.filter((i) => i.kind === "milestone").sort(byDue);
  const childrenOf = (id) => items.filter((i) => i.parent_id === id).sort(byDue);
  const loose = items.filter((i) => i.kind === "deliverable" && !i.parent_id).sort(byDue);
  const done = items.filter((i) => i.status === "completed").length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;

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

  async function remove(item) {
    setBusy(true);
    setError("");
    const { error: dbErr } = await supabase.from("monitoring_items").delete().eq("id", item.id);
    setBusy(false);
    setDialog(null);
    if (dbErr) setError(/client_invoice_lines/.test(dbErr.message) ? "It can't be deleted — an invoice has been raised against it (or one of its deliverables)." : dbErr.message);
    onChanged();
  }

  function renderItem(item, nested = false) {
    const timing = itemTiming(item);
    const billed = itemBilled(item, clientInvoices, items);
    const invoiced = isItemInvoiced(item, clientInvoices, items);
    const pendingInvoice = needsInvoice(item, clientInvoices, items);
    const isMilestone = item.kind === "milestone";
    const openKids = isMilestone ? childrenOf(item.id).filter((c) => c.status !== "completed").length : 0;

    return (
      <div className={`mon-item is-${timing}${isMilestone ? " is-milestone" : ""}${nested ? " is-nested" : ""}`}>
        <button
          type="button"
          className="mon-item-check"
          disabled={!canEdit || busy}
          title={item.status === "completed" ? (billed > 0 ? "Invoiced — can't reopen" : "Reopen") : "Mark complete"}
          aria-label={item.status === "completed" ? `Reopen ${item.title}` : `Mark ${item.title} complete`}
          onClick={() => {
            if (item.status === "completed") { if (billed === 0) setDialog({ type: "reopen", item }); }
            else setDialog({ type: "complete", item, openKids });
          }}
        >
          {item.status === "completed" ? <CheckCircleIcon /> : <span className="mon-item-ring" />}
        </button>

        <div className="mon-item-main">
          <div className="mon-item-title-row">
            {isMilestone && <span className="mon-item-kind">Milestone</span>}
            <span className="mon-item-title">{item.title}</span>
          </div>
          {item.description && <p className="mon-item-desc">{item.description}</p>}
          <div className="mon-item-meta">
            {item.status === "completed" ? (
              <span className="mon-tag is-done">Completed {fmtDate(item.completed_at)}</span>
            ) : (
              <span className={`mon-tag is-${timing}`}>{item.due_date ? `${fmtDate(item.due_date)} · ${dueLabel(item)}` : "No due date"}</span>
            )}
            {(item.invoice_on_completion || billed > 0) && (
              <span className={`mon-tag ${invoiced ? "is-done" : pendingInvoice ? "is-overdue" : "is-billable"}`}>
                <ReceiptIcon />{" "}
                {invoiced ? "Invoiced" : billed > 0 ? `Invoiced ${formatINR(billed)}` : pendingInvoice ? "Invoice to raise" : "Billable"}
                {Number(item.invoice_amount) > 0 ? `${billed > 0 && !invoiced ? " of " : " · "}${formatINR(item.invoice_amount)}` : ""}
              </span>
            )}
            {isMilestone && childrenOf(item.id).length > 0 && (
              <span className="mon-tag">{childrenOf(item.id).length - openKids}/{childrenOf(item.id).length} deliverables</span>
            )}
          </div>
          {item.status === "completed" && item.completion_note && <p className="mon-item-note">“{item.completion_note}”</p>}
        </div>

        <div className="mon-item-actions">
          {pendingInvoice && canEdit && (
            <Button size="sm" icon={<ReceiptIcon />} onClick={() => onRaiseInvoice(item)}>Raise Invoice</Button>
          )}
          {canEdit && (
            <>
              <button type="button" className="pp-icon-btn" title="Edit" aria-label={`Edit ${item.title}`} onClick={() => setDialog({ type: "edit", item })}><PencilIcon /></button>
              <button
                type="button"
                className="pp-icon-btn pp-icon-danger"
                title={billed > 0 ? "Invoiced — can't be deleted" : "Delete"}
                aria-label={`Delete ${item.title}`}
                disabled={billed > 0}
                onClick={() => setDialog({ type: "delete", item })}
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <Collapsible
        title="Milestones & Deliverables"
        subtitle="As per the MoU — tracked against their due dates."
        icon={<ListChecksIcon />}
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
            <div className="mon-progress" aria-label={`${done} of ${items.length} complete`}>
              <div className="mon-progress-bar"><span style={{ width: `${pct}%` }} /></div>
              <span className="mon-progress-text"><strong>{done}</strong> of {items.length} complete · {pct}%</span>
            </div>

            <div className="mon-plan">
              {milestones.map((m) => {
                const kids = childrenOf(m.id);
                return (
                  <section key={m.id} className={`mon-milestone is-${itemTiming(m)}`}>
                    {renderItem(m)}
                    {(kids.length > 0 || (canEdit && m.status !== "completed")) && (
                      <div className="mon-tree">
                        {kids.map((d) => <div key={d.id} className="mon-tree-node">{renderItem(d, true)}</div>)}
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
    </Card>
  );
}
