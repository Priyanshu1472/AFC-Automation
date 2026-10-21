// Every invoice dialog used by Monitoring (a project's own Invoices
// section) and Financials (the cross-project ledger), so both screens run
// the exact same steps:
//
// (The client invoice itself is raised on its own page, laid out like the
// invoice — pages/monitoring/ClientInvoiceEditorPage.)
//   ClientPaymentModal   — the client's payment against that invoice.
//   RequestBpInvoiceModal— ask the Business Partner for their invoice
//                          (request-bp-invoice: email + in-app alert).
//   BpInvoiceUploadModal — the BP's invoice, in whatever format they use;
//                          used by the BP on their Home, or by staff when
//                          it arrived by email (submit_bp_invoice()).
//   PaymentNoteModal     — the Payment Note sent to Accounts with the BP's
//                          invoice, before the BP is paid.
//   BpPaymentModal       — AFC's payment to the BP (Accounts).
import { useRef, useState } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import Select from "../ui/Select";
import DatePickerCalendar from "../ui/DatePickerCalendar";
import { PaperclipIcon, FileTextIcon } from "../icons";
import {
  formatINR, fmtDate, fmtSize, safeFileName, todayISO, uploadMonitoringFile,
  roundMoney,
} from "../../lib/monitoring";
import "../../styles/Monitoring.css";

const FILE_ACCEPT = ".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx";

export function Field({ label, required, hint, children }) {
  return (
    <div className="field w-full">
      <span className="field-label">
        {label}
        {required && <span className="required" aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function AmountInput({ value, onChange, disabled, placeholder = "0.00", ariaLabel }) {
  return (
    <div className="mon-amount-input">
      <span aria-hidden="true">₹</span>
      <input
        className="input"
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

export function PercentInput({ value, onChange, disabled, placeholder = "0", ariaLabel }) {
  return (
    <div className="mon-percent-input">
      <input
        className="input"
        type="number"
        min="0"
        max="100"
        step="0.01"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      <span aria-hidden="true">%</span>
    </div>
  );
}

function SingleFilePicker({ file, existingName, onPick, disabled }) {
  const ref = useRef(null);
  return (
    <div className="mon-file-pick">
      <input
        ref={ref}
        type="file"
        accept={FILE_ACCEPT}
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onPick(f); }}
      />
      <Button variant="secondary" size="sm" icon={<PaperclipIcon />} disabled={disabled} onClick={() => ref.current?.click()}>
        {file || existingName ? "Replace file" : "Choose file"}
      </Button>
      {(file || existingName) && (
        <span className="mon-file-pick-name" title={file?.name || existingName}>
          <FileTextIcon /> {file ? `${file.name} (${fmtSize(file.size)})` : existingName}
        </span>
      )}
    </div>
  );
}

function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// ── Client's payment against an AFC invoice ───────────────────────────
export function ClientPaymentModal({ invoice, onClose, onSaved }) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(String(invoice.total_amount ?? ""));
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const n = num(amount);
    if (!date) { setError("Enter the date the payment was received."); return; }
    if (n === null || !Number.isFinite(n) || n <= 0) { setError("Enter the amount received."); return; }
    if (roundMoney(n) > Number(invoice.total_amount)) { setError(`The amount received can't be more than the invoice total (${formatINR(invoice.total_amount)}).`); return; }
    setSaving(true);
    setError("");
    const { error: dbErr } = await supabase.from("client_invoices").update({
      status: "paid", payment_received_on: date, payment_amount: n, payment_reference: reference.trim() || null,
    }).eq("id", invoice.id);
    if (dbErr) { setError(dbErr.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <Modal onClose={saving ? undefined : onClose} size="sm" closeOnBackdrop={!saving}>
      <Modal.Header title="Record Client Payment" subtitle={`Invoice ${invoice.invoice_number} · ${formatINR(invoice.total_amount)}`} onClose={saving ? undefined : onClose} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <div className="mon-form">
          <Field label="Received on" required><DatePickerCalendar value={date} onChange={setDate} /></Field>
          <Field label="Amount received" required hint={num(amount) !== null && num(amount) < Number(invoice.total_amount) ? `${formatINR(roundMoney(Number(invoice.total_amount) - num(amount)))} less than the invoice total (e.g. TDS) — it will show as outstanding.` : null}>
            <AmountInput value={amount} onChange={setAmount} disabled={saving} ariaLabel="Amount received" />
          </Field>
          <Field label="Reference (UTR / cheque no.)">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} disabled={saving} />
          </Field>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={save}>Record Payment</Button>
      </Modal.Footer>
    </Modal>
  );
}

// ── Ask the BP to raise their invoice ─────────────────────────────────
export function RequestBpInvoiceModal({ invoice, bpName, existing, onClose, onSaved }) {
  const [amount, setAmount] = useState(existing?.expected_amount != null ? String(existing.expected_amount) : "");
  const [note, setNote] = useState(existing?.request_note || "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const isReminder = !!existing;

  async function send() {
    const n = num(amount);
    if (n !== null && (!Number.isFinite(n) || n < 0)) { setError("Enter a valid amount, or leave it blank."); return; }
    if (n !== null && invoice.payment_amount != null && roundMoney(n) > Number(invoice.payment_amount)) {
      setError(`The amount can't be more than the ${formatINR(invoice.payment_amount)} the client paid.`);
      return;
    }
    setSending(true);
    setError("");
    const { data, error: fnErr } = await supabase.functions.invoke("request-bp-invoice", {
      body: { client_invoice_id: invoice.id, expected_amount: n, note: note.trim() || null },
    });
    if (fnErr) { setError(await extractFunctionErrorMessage(fnErr, "Failed to send the request.")); setSending(false); return; }
    if (!data?.success) { setError(data?.error || "Failed to send the request."); setSending(false); return; }
    onSaved(data);
  }

  return (
    <Modal onClose={sending ? undefined : onClose} size="sm" closeOnBackdrop={!sending}>
      <Modal.Header
        title={isReminder ? "Remind Business Partner" : "Request BP Invoice"}
        subtitle={`${bpName || "Business Partner"} — against client invoice ${invoice.invoice_number}`}
        onClose={sending ? undefined : onClose}
      />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <p className="mon-modal-lead">
          The Business Partner gets an email and an alert on their portal Home, where they upload their invoice in their own format.
        </p>
        <div className="mon-form">
          <Field label="Amount to invoice" hint={`Optional — shown to the BP in the request. The client paid ${formatINR(invoice.payment_amount)}.`}>
            <AmountInput value={amount} onChange={setAmount} disabled={sending} ariaLabel="Amount to invoice" />
          </Field>
          <Field label="Note to the BP">
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={sending} placeholder="Anything the BP should include on the invoice…" />
          </Field>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={sending} onClick={onClose}>Cancel</Button>
        <Button loading={sending} onClick={send}>{isReminder ? "Send Reminder" : "Send Request"}</Button>
      </Modal.Footer>
    </Modal>
  );
}

// ── The BP's own invoice (by the BP, or staff on their behalf) ─────────
export function BpInvoiceUploadModal({ bpInvoice, projectTitle, onBehalf = false, onClose, onSaved }) {
  const [number, setNumber] = useState(bpInvoice.invoice_number || "");
  const [date, setDate] = useState(bpInvoice.invoice_date || todayISO());
  const [amount, setAmount] = useState(
    bpInvoice.amount != null ? String(roundMoney(Number(bpInvoice.amount) - Number(bpInvoice.gst_amount || 0))) : ""
  );
  const [gstAmount, setGstAmount] = useState(bpInvoice.amount != null ? String(bpInvoice.gst_amount || 0) : "");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const n = num(amount);
    if (!number.trim()) { setError("Invoice number is required."); return; }
    if (!date) { setError("Invoice date is required."); return; }
    const g = num(gstAmount) ?? 0;
    if (n === null || !Number.isFinite(n) || n <= 0) { setError("Enter the invoice amount before GST."); return; }
    if (!Number.isFinite(g) || g < 0) { setError("GST must be zero or more."); return; }
    if (g > roundMoney(n * 0.28)) { setError("GST can't be more than 28% of the amount."); return; }
    if (!file && !bpInvoice.file_path) { setError("Attach the invoice file."); return; }
    setSaving(true);
    setError("");
    try {
      let fileFields = { file_name: bpInvoice.file_name, file_size: bpInvoice.file_size, file_path: bpInvoice.file_path };
      if (file) {
        fileFields = await uploadMonitoringFile(`${bpInvoice.project_id}/bp-invoices/${bpInvoice.id}/${Date.now()}_${safeFileName(file.name)}`, file);
      }
      const { error: rpcErr } = await supabase.rpc("submit_bp_invoice", {
        p_bp_invoice_id: bpInvoice.id,
        p_invoice_number: number.trim(),
        p_invoice_date: date,
        p_amount: roundMoney(n + g),
        p_gst_amount: roundMoney(g),
        p_file_name: fileFields.file_name,
        p_file_path: fileFields.file_path,
        p_file_size: fileFields.file_size,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal onClose={saving ? undefined : onClose} closeOnBackdrop={!saving}>
      <Modal.Header
        title={onBehalf ? "Upload BP Invoice" : "Upload Your Invoice"}
        subtitle={projectTitle}
        onClose={saving ? undefined : onClose}
      />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <p className="mon-modal-lead">
          {onBehalf
            ? "For an invoice the Business Partner sent outside the portal (email etc.)."
            : "Upload your invoice in your own format (PDF or image), and fill in the key details below."}
          {bpInvoice.expected_amount != null && <> Requested amount: <strong>{formatINR(bpInvoice.expected_amount)}</strong>.</>}
        </p>
        {bpInvoice.request_note && <div className="mon-request-note">“{bpInvoice.request_note}”</div>}
        <div className="mon-form">
          <div className="mon-form-row">
            <Field label="Invoice number" required>
              <input className="input" value={number} onChange={(e) => setNumber(e.target.value)} disabled={saving} />
            </Field>
            <Field label="Invoice date" required>
              <DatePickerCalendar value={date} onChange={setDate} />
            </Field>
          </div>
          <div className="mon-form-row">
            <Field label="Amount (before GST)" required>
              <AmountInput value={amount} onChange={setAmount} disabled={saving} ariaLabel="Amount before GST" />
            </Field>
            <Field label="GST on the invoice" hint={num(amount) ? `18% would be ${formatINR(roundMoney(num(amount) * 0.18))}` : null}>
              <AmountInput value={gstAmount} onChange={setGstAmount} disabled={saving} ariaLabel="GST amount" />
            </Field>
          </div>
          <div className="mon-total-line">Invoice total <strong>{num(amount) ? formatINR(roundMoney(num(amount) + (num(gstAmount) || 0))) : "—"}</strong></div>
          <Field label="Invoice file" required>
            <SingleFilePicker file={file} existingName={bpInvoice.file_name} onPick={setFile} disabled={saving} />
          </Field>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={save}>Submit Invoice</Button>
      </Modal.Footer>
    </Modal>
  );
}

// ── AFC's payment to the BP ───────────────────────────────────────────
export function BpPaymentModal({ bpInvoice, onClose, onSaved }) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(String(bpInvoice.amount ?? ""));
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const n = num(amount);
    if (!date) { setError("Enter the payment date."); return; }
    if (n === null || !Number.isFinite(n) || n <= 0) { setError("Enter the amount paid."); return; }
    if (roundMoney(n) > Number(bpInvoice.amount)) { setError(`The payment can't be more than the BP's invoice (${formatINR(bpInvoice.amount)}).`); return; }
    setSaving(true);
    setError("");
    const { error: dbErr } = await supabase.from("bp_invoices").update({
      status: "paid", paid_on: date, paid_amount: n, payment_reference: reference.trim() || null,
    }).eq("id", bpInvoice.id);
    if (dbErr) { setError(dbErr.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <Modal onClose={saving ? undefined : onClose} size="sm" closeOnBackdrop={!saving}>
      <Modal.Header title="Record Payment to BP" subtitle={`BP invoice ${bpInvoice.invoice_number} · ${formatINR(bpInvoice.amount)}`} onClose={saving ? undefined : onClose} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <div className="mon-form">
          <Field label="Paid on" required><DatePickerCalendar value={date} onChange={setDate} /></Field>
          <Field label="Amount paid" required>
            <AmountInput value={amount} onChange={setAmount} disabled={saving} ariaLabel="Amount paid" />
          </Field>
          <Field label="Reference (UTR / cheque no.)">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} disabled={saving} />
          </Field>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={save}>Record Payment</Button>
      </Modal.Footer>
    </Modal>
  );
}

// ── Payment note → Accounts ───────────────────────────────────────────
// The Project Payment Requisition Note: prepared once the BP's invoice is
// in, then sent to Accounts (the CFO gets an in-app alert) together with
// the BP's invoice, so they release the BP's payment. Part B (instalments,
// fee received, paid to BP) is filled from the records when the PDF is
// generated; only the coordinator's own inputs are entered here.
const rsText = (n) => {
  const v = roundMoney(n);
  return `Rs. ${Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/-`;
};

export function defaultRecommendation({ bpInvoice, bpName, projectTitle, itemTitle }) {
  const gst = Number(bpInvoice.gst_amount || 0);
  const total = Number(bpInvoice.amount || 0);
  return [
    `M/s ${bpName || "the Business Partner"} (BP) has submitted its invoice No. ${bpInvoice.invoice_number} dated ${fmtDate(bpInvoice.invoice_date)} towards ${projectTitle}${itemTitle ? ` (${itemTitle})` : ""}, amounting to ${rsText(total)} (Basic: ${rsText(total - gst)} + GST: ${rsText(gst)}).`,
    `It is recommended that the said amount of ${rsText(total)} be released to the BP against the enclosed invoice.`,
    "The BP's tax invoice is enclosed for kind reference.",
  ].join("\n");
}

export function PaymentNoteModal({ entry, onClose, onSaved }) {
  const { bpInvoice, paymentNote: note, project } = entry;
  const [form, setForm] = useState({
    note_date: note?.note_date || todayISO(),
    physical_status: note?.physical_status || (project.status === "completed" ? "Completed" : "Ongoing"),
    completion_certificate: note?.completion_certificate || "",
    project_profile: note?.project_profile || "",
    recommendation: note?.recommendation || defaultRecommendation({ bpInvoice, bpName: project.bpName, projectTitle: project.title, itemTitle: entry.itemTitle }),
    observation: note?.observation || "",
  });
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(send) {
    if (!form.recommendation.trim()) { setError("Write the recommendation for Accounts."); return; }
    setSaving(send ? "send" : "draft");
    setError("");
    const row = {
      note_date: form.note_date || todayISO(),
      physical_status: form.physical_status || null,
      completion_certificate: form.completion_certificate.trim() || null,
      project_profile: form.project_profile.trim() || null,
      recommendation: form.recommendation.trim(),
      observation: form.observation.trim() || null,
      ...(send ? { status: "sent" } : {}),
    };
    const { data, error: dbErr } = note
      ? await supabase.from("bp_payment_notes").update(row).eq("id", note.id).select("id").single()
      : await supabase.from("bp_payment_notes").insert({ bp_invoice_id: bpInvoice.id, project_id: bpInvoice.project_id, ...row }).select("id").single();
    if (dbErr) { setError(dbErr.message); setSaving(""); return; }
    onSaved({ id: data.id, sent: send });
  }

  return (
    <Modal onClose={saving ? undefined : onClose} closeOnBackdrop={!saving} size="lg">
      <Modal.Header
        title="Payment Note"
        subtitle={`Project Payment Requisition Note — ${project.bpName || "BP"} invoice ${bpInvoice.invoice_number} · ${formatINR(bpInvoice.amount)}`}
        onClose={saving ? undefined : onClose}
      />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <p className="mon-modal-lead">
          Project, client, fee, revenue share and the instalment table (Part B) are filled in from the records. Once sent, Accounts gets the note
          and the BP&rsquo;s invoice to release the payment — it can&rsquo;t be edited after that.
        </p>
        <div className="mon-form">
          <div className="mon-form-row">
            <Field label="Note date" required><DatePickerCalendar value={form.note_date} onChange={(v) => set("note_date", v)} /></Field>
            <Field label="Physical status of work">
              <Select options={["Ongoing", "Completed", "On Hold"].map((v) => ({ value: v, label: v }))} value={form.physical_status} onChange={(v) => set("physical_status", v)} />
            </Field>
          </div>
          <div className="mon-form-row">
            <Field label="Completion certificate" hint="If applicable for this payment.">
              <input className="input" value={form.completion_certificate} onChange={(e) => set("completion_certificate", e.target.value)} disabled={!!saving} placeholder="N/A" />
            </Field>
            <Field label="Project profile">
              <input className="input" value={form.project_profile} onChange={(e) => set("project_profile", e.target.value)} disabled={!!saving} placeholder="N/A" />
            </Field>
          </div>
          <Field label="Recommendation / note by Project Coordinator" required>
            <textarea className="input" rows={5} value={form.recommendation} onChange={(e) => set("recommendation", e.target.value)} disabled={!!saving} />
          </Field>
          <Field label="Any specific observation / comment">
            <textarea className="input" rows={2} value={form.observation} onChange={(e) => set("observation", e.target.value)} disabled={!!saving} />
          </Field>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={!!saving} onClick={onClose}>Cancel</Button>
        <Button variant="secondary" loading={saving === "draft"} disabled={!!saving} onClick={() => save(false)}>Save Draft</Button>
        <Button loading={saving === "send"} disabled={!!saving} onClick={() => save(true)}>Send to Accounts</Button>
      </Modal.Footer>
    </Modal>
  );
}
