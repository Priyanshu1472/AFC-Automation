// Add/edit a milestone or deliverable, mark one complete, and edit its
// remarks.
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import Select from "../ui/Select";
import DatePickerCalendar from "../ui/DatePickerCalendar";
import { Field, AmountInput, PercentInput } from "../financials/InvoiceModals";
import { PaperclipIcon } from "../icons";
import {
  formatINR, roundMoney, fetchProjectMoney, allocatedAmount, itemBilled,
  MONITORING_BUCKET, safeFileName, uploadMonitoringFile,
} from "../../lib/monitoring";

const FILE_ACCEPT = ".pdf,.doc,.docx";

export function ItemModal({ projectId, kind, item, milestones, defaultParentId = "", onClose, onSaved }) {
  const editing = !!item;
  const isDeliverable = kind === "deliverable";
  const [form, setForm] = useState({
    title: item?.title || "",
    description: item?.description || "",
    due_date: item?.due_date || "",
    parent_id: item?.parent_id || defaultParentId || "",
    invoice_amount: item?.invoice_amount != null ? String(item.invoice_amount) : "",
    invoice_pct: item?.invoice_pct != null ? String(item.invoice_pct) : "",
    gst_inclusive: item?.gst_inclusive ?? false,
  });
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const noun = kind === "milestone" ? "Milestone" : "Deliverable";

  // Contract value + the other items' amounts, so the amount can't exceed
  // what's left (also enforced by monitoring_items_amount_guard()).
  const [money, setMoney] = useState(null);
  useEffect(() => {
    let live = true;
    fetchProjectMoney(projectId).then((m) => { if (live) setMoney(m); });
    return () => { live = false; };
  }, [projectId]);
  const contract = money?.contractValue == null ? null : Number(money.contractValue);
  const others = money ? money.items.filter((i) => i.id !== item?.id) : [];
  const alreadyBilled = money && item ? itemBilled(item, money.invoices, money.items) : 0;
  // The project's allocation if this item had a given amount (deliverables
  // under a milestone with its own amount don't add to it).
  const parentId = kind === "deliverable" ? form.parent_id || null : null;
  const projected = (amt) => allocatedAmount([...others, { id: item?.id || "new", kind, parent_id: parentId, invoice_amount: amt }]);
  const left = contract == null ? null : roundMoney(Math.max(contract - projected(0), 0));
  const parent = parentId ? others.find((i) => i.id === parentId) : null;
  const parentLeft = parent?.invoice_amount != null
    ? roundMoney(Math.max(Number(parent.invoice_amount) - others.filter((i) => i.parent_id === parent.id).reduce((s, i) => s + Number(i.invoice_amount || 0), 0), 0))
    : null;
  const kidsTotal = kind === "milestone" && item ? roundMoney(others.filter((i) => i.parent_id === item.id).reduce((s, i) => s + Number(i.invoice_amount || 0), 0)) : 0;

  // Every milestone and deliverable now always alerts the team to invoice
  // on completion — no more per-item checkbox for either. A deliverable's
  // amount comes from a % of the contract value; a milestone still enters
  // a raw rupee figure.
  const pctAmount = contract != null && form.invoice_pct !== "" && Number.isFinite(Number(form.invoice_pct))
    ? roundMoney(contract * Number(form.invoice_pct) / 100)
    : null;

  async function save() {
    if (!form.title.trim()) { setError(`Give the ${noun.toLowerCase()} a title.`); return; }
    let amount = null;
    let pct = null;
    const billable = true;
    if (isDeliverable) {
      if (form.invoice_pct !== "") {
        pct = Number(form.invoice_pct);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setError("Enter a valid percentage between 0 and 100, or leave it blank."); return; }
        if (contract == null) { setError("Set the project's contract value first (Edit Details) before entering a percentage."); return; }
        amount = pctAmount;
      }
    } else if (form.invoice_amount !== "") {
      amount = Number(form.invoice_amount);
      if (!Number.isFinite(amount) || amount < 0) { setError("Enter a valid invoice amount, or leave it blank."); return; }
    }
    if (amount != null) {
      if (contract != null && projected(amount) > contract) {
        setError(`Only ${formatINR(left)} of the ${formatINR(contract)} contract value is left to allocate to milestones and deliverables.`);
        return;
      }
      if (parentLeft != null && roundMoney(amount) > parentLeft) {
        setError(`Deliverables split their milestone's amount — only ${formatINR(parentLeft)} of “${parent.title}”'s ${formatINR(parent.invoice_amount)} is left.`);
        return;
      }
      if (kind === "milestone" && roundMoney(amount) < kidsTotal) {
        setError(`The milestone can't be less than the ${formatINR(kidsTotal)} its deliverables add up to.`);
        return;
      }
      if (roundMoney(amount) < alreadyBilled) { setError(`The amount can't be less than the ${formatINR(alreadyBilled)} already invoiced against it.`); return; }
    }
    setSaving(true);
    setError("");
    const row = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      due_date: form.due_date || null,
      parent_id: kind === "deliverable" ? form.parent_id || null : null,
      invoice_on_completion: billable,
      invoice_amount: billable ? amount : null,
      invoice_pct: isDeliverable ? pct : null,
      gst_inclusive: isDeliverable ? form.gst_inclusive : false,
    };
    let savedId = item?.id;
    if (editing) {
      const { error: dbErr } = await supabase.from("monitoring_items").update(row).eq("id", item.id);
      if (dbErr) { setError(dbErr.message); setSaving(false); return; }
    } else {
      const { data, error: dbErr } = await supabase.from("monitoring_items").insert({ project_id: projectId, kind, ...row }).select("id").single();
      if (dbErr) { setError(dbErr.message); setSaving(false); return; }
      savedId = data.id;
    }

    if (file && savedId) {
      try {
        const meta = await uploadMonitoringFile(`${projectId}/docs/${Date.now()}_${safeFileName(file.name)}`, file);
        const { error: insErr } = await supabase.from("monitoring_documents").insert({
          project_id: projectId, item_id: savedId, category: "deliverable", title: form.title.trim(), ...meta,
        });
        if (insErr) {
          await supabase.storage.from(MONITORING_BUCKET).remove([meta.file_path]);
          setError(`${noun} saved, but the file failed to attach: ${insErr.message}`);
          setSaving(false);
          onSaved();
          return;
        }
      } catch (err) {
        setError(`${noun} saved, but the file failed to attach: ${err.message}`);
        setSaving(false);
        onSaved();
        return;
      }
    }
    onSaved();
  }

  return (
    <Modal onClose={saving ? undefined : onClose} closeOnBackdrop={!saving}>
      <Modal.Header title={`${editing ? "Edit" : "Add"} ${noun}`} subtitle={kind === "milestone" ? "A billing / progress point from the MoU." : "A piece of work to deliver, optionally under a milestone."} onClose={saving ? undefined : onClose} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <div className="mon-form">
          <Field label="Title" required>
            <input className="input" value={form.title} onChange={(e) => set("title", e.target.value)} disabled={saving} placeholder={kind === "milestone" ? "e.g. Inception Report approved" : "e.g. Draft baseline survey report"} autoFocus />
          </Field>
          <div className="mon-form-row">
            <Field label="Due date">
              <DatePickerCalendar value={form.due_date} onChange={(v) => set("due_date", v)} placeholder="Select due date" />
            </Field>
            {kind === "deliverable" && milestones.length > 0 && (
              <Field label="Under milestone">
                <Select
                  options={[{ value: "", label: "— None —" }, ...milestones.map((m) => ({ value: m.id, label: m.title }))]}
                  value={form.parent_id}
                  onChange={(v) => set("parent_id", v)}
                />
              </Field>
            )}
          </div>
          <Field label="Details">
            <textarea className="input" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} disabled={saving} placeholder="Scope / acceptance criteria as per the MoU" />
          </Field>

          {isDeliverable ? (
            <>
              <Field label="Attach a file" hint="PDF or Word document — optional.">
                <input ref={fileInputRef} type="file" accept={FILE_ACCEPT} style={{ display: "none" }} onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ""; }} />
                <div className="mon-file-pick">
                  <Button type="button" variant="secondary" size="sm" icon={<PaperclipIcon />} disabled={saving} onClick={() => fileInputRef.current?.click()}>
                    {file ? "Choose a different file" : "Choose file"}
                  </Button>
                  {file && <span className="mon-file-pick-name">{file.name}</span>}
                </div>
              </Field>
              <Field
                label="Amount (% of contract value)"
                hint={contract == null
                  ? "Set the project's contract value first (Edit Details) to calculate an amount."
                  : parentLeft != null
                    ? `Optional. Part of “${parent.title}” — ${formatINR(parentLeft)} of its ${formatINR(parent.invoice_amount)} is still unallocated.`
                    : left != null
                      ? `Optional. ${formatINR(left)} of the ${formatINR(contract)} contract value is still unallocated.`
                      : "Optional."}
              >
                <PercentInput value={form.invoice_pct} onChange={(v) => set("invoice_pct", v)} disabled={saving || contract == null} ariaLabel="Amount, percent of contract value" />
                {pctAmount != null && <span className="field-hint">{form.invoice_pct}% of {formatINR(contract)} = <strong>{formatINR(pctAmount)}</strong></span>}
              </Field>
              <Field label="GST" hint={form.gst_inclusive ? "GST is already baked into the amount above — it won't be added again when the invoice is raised." : "GST isn't in the amount above — it'll be added on top when the invoice is raised."}>
                <div className="mon-seg" role="radiogroup" aria-label="GST treatment">
                  <button type="button" role="radio" aria-checked={!form.gst_inclusive} className={`mon-seg-btn${!form.gst_inclusive ? " mon-seg-active" : ""}`} disabled={saving} onClick={() => set("gst_inclusive", false)}>GST Excluded</button>
                  <button type="button" role="radio" aria-checked={form.gst_inclusive} className={`mon-seg-btn${form.gst_inclusive ? " mon-seg-active" : ""}`} disabled={saving} onClick={() => set("gst_inclusive", true)}>GST Included</button>
                </div>
              </Field>
            </>
          ) : (
            <Field
              label="Invoice amount (before GST)"
              hint={parentLeft != null
                ? `Optional. Part of “${parent.title}” — ${formatINR(parentLeft)} of its ${formatINR(parent.invoice_amount)} is still unallocated.`
                : left != null
                  ? `Optional. ${formatINR(left)} of the ${formatINR(contract)} contract value is still unallocated.`
                  : "Optional — e.g. the MoU's payment for this milestone."}
            >
              <AmountInput value={form.invoice_amount} onChange={(v) => set("invoice_amount", v)} disabled={saving} ariaLabel="Invoice amount" />
            </Field>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={save}>{editing ? "Save Changes" : `Add ${noun}`}</Button>
      </Modal.Footer>
    </Modal>
  );
}

export function CompleteItemModal({ item, openChildren = 0, onClose, onSaved }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const { error: dbErr } = await supabase.from("monitoring_items")
      .update({ status: "completed", completion_note: note.trim() || null })
      .eq("id", item.id);
    if (dbErr) { setError(dbErr.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <Modal onClose={saving ? undefined : onClose} size="sm" closeOnBackdrop={!saving}>
      <Modal.Header title={`Mark ${item.kind} complete`} subtitle={item.title} onClose={saving ? undefined : onClose} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        {openChildren > 0 && (
          <Alert variant="warning">{openChildren} deliverable{openChildren === 1 ? " is" : "s are"} under this milestone still open.</Alert>
        )}
        {item.invoice_on_completion && (
          <p className="mon-modal-lead">
            This is billable — the team will be alerted to raise the client invoice{item.invoice_amount != null ? ` for ${formatINR(item.invoice_amount)}` : ""}.
          </p>
        )}
        <Field label="Completion note (optional)">
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} placeholder="e.g. Submitted to client on email; approval received" />
        </Field>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={save}>Mark Complete</Button>
      </Modal.Footer>
    </Modal>
  );
}

// Notes/remarks on a deliverable — editable any time, not just when it's
// marked complete (that's completion_note, a separate field).
export function NoteModal({ item, onClose, onSaved }) {
  const [remarks, setRemarks] = useState(item.remarks || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const { error: dbErr } = await supabase.from("monitoring_items").update({ remarks: remarks.trim() || null }).eq("id", item.id);
    if (dbErr) { setError(dbErr.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <Modal onClose={saving ? undefined : onClose} size="sm" closeOnBackdrop={!saving}>
      <Modal.Header title="Notes & Remarks" subtitle={item.title} onClose={saving ? undefined : onClose} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <Field label="Notes">
          <textarea className="input" rows={5} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={saving} placeholder="Anything worth tracking against this deliverable — client feedback, internal status, follow-ups…" autoFocus />
        </Field>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={save}>Save</Button>
      </Modal.Footer>
    </Modal>
  );
}
