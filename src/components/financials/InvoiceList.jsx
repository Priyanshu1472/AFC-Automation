// The invoice ledger: one row per client invoice, carrying both legs of the
// money trail — AFC → client (raised / payment received) and the Business
// Partner's leg: invoice requested → BP's invoice received → Payment Note
// prepared and sent to Accounts → Accounts pays the BP. Owns every
// per-invoice dialog, so Monitoring (one project) and Financials (all
// projects) behave identically.
//
// entries: [{ invoice, bpInvoice, paymentNote, itemTitle,
//             project: { id, title, hasBp, bpName, canEdit, canPayBp } }]
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import ConfirmDialog from "../ui/ConfirmDialog";
import { EyeIcon, PencilIcon, TrashIcon, PaperclipIcon, FileTextIcon } from "../icons";
import {
  formatINR, fmtDate, openMonitoringFile, openMonitoringPdf, invoiceLines,
  CLIENT_INVOICE_STATUS_LABELS, CLIENT_INVOICE_STATUS_VARIANTS,
  BP_INVOICE_STATUS_LABELS, BP_INVOICE_STATUS_VARIANTS, PAYMENT_NOTE_STATUS_LABELS,
} from "../../lib/monitoring";
import { ClientPaymentModal, RequestBpInvoiceModal, BpInvoiceUploadModal, BpPaymentModal, PaymentNoteModal } from "./InvoiceModals";
import { CfoInvoiceDecisionModal } from "./CfoInvoiceDecisionModal";

const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export default function InvoiceList({ entries, showProject = false, emptyText = "No invoices yet.", onChanged }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isCfo = profile?.role === "cfo";
  const [dialog, setDialog] = useState(null); // { type, entry }
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [opening, setOpening] = useState(""); // `${kind}:${id}` while a PDF is being built

  function close() { setDialog(null); }
  function done() { setDialog(null); onChanged(); }

  async function view(path) {
    setError("");
    try { await openMonitoringFile(path); } catch (err) { setError(err.message); }
  }

  async function viewPdf(kind, id) {
    setError("");
    setOpening(`${kind}:${id}`);
    try { await openMonitoringPdf(kind, id); } catch (err) { setError(err.message); }
    setOpening("");
  }

  async function confirmDelete() {
    const inv = dialog.entry.invoice;
    setDeleting(true);
    const { error: delErr } = await supabase.from("client_invoices").delete().eq("id", inv.id);
    if (delErr) setError(delErr.message);
    else if (inv.file_path) await supabase.storage.from("monitoring-documents").remove([inv.file_path]);
    setDeleting(false);
    done();
  }

  if (entries.length === 0) return <p className="pp-empty">{emptyText}</p>;

  const pdfBtn = (kind, id, label) => (
    <button
      type="button"
      className="mon-file-btn"
      title={`View ${label}`}
      aria-label={`View ${label}`}
      disabled={opening === `${kind}:${id}`}
      onClick={() => viewPdf(kind, id)}
    >
      {opening === `${kind}:${id}` ? <span className="spinner spinner-sm" aria-hidden="true" /> : <EyeIcon />}
    </button>
  );

  return (
    <>
      {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
      <div className="pp-table-wrap">
        <table className="table mon-ledger">
          <thead>
            <tr>
              <th>Invoice</th>
              {showProject && <th>Project</th>}
              <th className="mon-num">Amount</th>
              <th>Client Payment</th>
              <th>Business Partner</th>
              <th className="mon-actions-col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const { invoice: inv, bpInvoice: bp, paymentNote: note, project } = entry;
              const canEdit = project.canEdit;
              const lastAsked = bp ? new Date(bp.last_reminded_at || bp.requested_at).getTime() : 0;
              const reminderReady = bp && Date.now() - lastAsked >= REMINDER_COOLDOWN_MS;
              const generated = invoiceLines(inv).length > 0;
              return (
                <tr key={inv.id}>
                  <td>
                    <div className="mon-ledger-ref">
                      <span className="pp-td-title">{inv.invoice_number}</span>
                      {generated && pdfBtn("client_invoice", inv.id, `invoice ${inv.invoice_number}`)}
                      {inv.file_path && (
                        <button type="button" className="mon-file-btn" title="View attached copy" aria-label="View attached invoice copy" onClick={() => view(inv.file_path)}><PaperclipIcon /></button>
                      )}
                    </div>
                    <div className="pp-td-sub">
                      {inv.installment_no ? `Inst. ${inv.installment_no} · ` : ""}{fmtDate(inv.invoice_date)}
                    </div>
                    {entry.itemTitle && <div className="pp-td-sub mon-ledger-items" title={entry.itemTitle}>{entry.itemTitle}</div>}
                  </td>
                  {showProject && (
                    <td>
                      <button type="button" className="mon-link mon-ledger-project" onClick={() => navigate(`/monitoring/${project.id}?tab=invoices`)}>{project.title}</button>
                    </td>
                  )}
                  <td className="mon-num">
                    <div className="mon-amount">{formatINR(inv.total_amount)}</div>
                    {Number(inv.gst_amount) > 0 && <div className="pp-td-sub">incl. GST {formatINR(inv.gst_amount)}</div>}
                  </td>
                  <td>
                    <Badge variant={CLIENT_INVOICE_STATUS_VARIANTS[inv.status]}>{CLIENT_INVOICE_STATUS_LABELS[inv.status]}</Badge>
                    {inv.status === "paid" && (
                      <div className="pp-td-sub">{formatINR(inv.payment_amount)} on {fmtDate(inv.payment_received_on)}{inv.payment_reference ? ` · ${inv.payment_reference}` : ""}</div>
                    )}
                    {inv.status === "rejected" && inv.cfo_remark && (
                      <div className="pp-td-sub">CFO: “{inv.cfo_remark}”</div>
                    )}
                  </td>
                  <td>
                    {!project.hasBp ? (
                      <span className="pp-td-muted">No BP on this project</span>
                    ) : inv.status !== "paid" ? (
                      <span className="pp-td-muted">After client pays</span>
                    ) : !bp ? (
                      <span className="pp-td-muted">Not requested yet</span>
                    ) : (
                      <>
                        <div className="mon-ledger-ref">
                          <Badge variant={BP_INVOICE_STATUS_VARIANTS[bp.status]}>{BP_INVOICE_STATUS_LABELS[bp.status]}</Badge>
                          {bp.file_path && (
                            <button type="button" className="mon-file-btn" title="View BP invoice" aria-label="View BP invoice" onClick={() => view(bp.file_path)}><EyeIcon /></button>
                          )}
                        </div>
                        <div className="pp-td-sub">
                          {bp.status === "requested"
                            ? `Requested ${fmtDate(bp.requested_at)}${bp.expected_amount != null ? ` · ${formatINR(bp.expected_amount)}` : ""}`
                            : `${bp.invoice_number} · ${formatINR(bp.amount)}`}
                        </div>
                        {note && bp.status !== "requested" && (
                          <div className="pp-td-sub mon-ledger-ref">
                            <span className="mon-inline-icon" aria-hidden="true"><FileTextIcon /></span>
                            {PAYMENT_NOTE_STATUS_LABELS[note.status]}
                            {pdfBtn("payment_note", note.id, "payment note")}
                          </div>
                        )}
                        {bp.status === "paid" && (
                          <div className="pp-td-sub">Paid {formatINR(bp.paid_amount)} on {fmtDate(bp.paid_on)}</div>
                        )}
                      </>
                    )}
                    {project.hasBp && project.bpName && <div className="pp-td-sub">{project.bpName}</div>}
                  </td>
                  <td className="mon-actions-col">
                    <div className="mon-row-actions">
                      {isCfo && inv.status === "pending_cfo" && (
                        <>
                          <Button size="sm" onClick={() => setDialog({ type: "cfo_decide", entry, decision: "approved" })}>Approve &amp; Sign</Button>
                          <Button variant="secondary" size="sm" onClick={() => setDialog({ type: "cfo_decide", entry, decision: "rejected" })}>Reject</Button>
                        </>
                      )}
                      {canEdit && inv.status === "raised" && (
                        <Button size="sm" onClick={() => setDialog({ type: "client_payment", entry })}>Record Payment</Button>
                      )}
                      {canEdit && (inv.status === "pending_cfo" || inv.status === "rejected") && (
                        <>
                          <button type="button" className="pp-icon-btn" title="Edit" aria-label="Edit invoice" onClick={() => navigate(`/monitoring/${project.id}/invoice/${inv.id}${showProject ? "?back=financials" : ""}`)}><PencilIcon /></button>
                          <button type="button" className="pp-icon-btn pp-icon-danger" title="Delete" aria-label="Delete invoice" onClick={() => setDialog({ type: "delete", entry })}><TrashIcon /></button>
                        </>
                      )}
                      {canEdit && project.hasBp && inv.status === "paid" && !bp && (
                        <Button size="sm" onClick={() => setDialog({ type: "request_bp", entry })}>Request BP Invoice</Button>
                      )}
                      {canEdit && bp?.status === "requested" && (
                        <>
                          <Button variant="secondary" size="sm" disabled={!reminderReady} title={reminderReady ? "Send the BP a reminder" : "One reminder every 24 hours"} onClick={() => setDialog({ type: "request_bp", entry })}>Remind</Button>
                          <Button variant="secondary" size="sm" title="Upload the BP's invoice on their behalf" onClick={() => setDialog({ type: "upload_bp", entry })}>Upload</Button>
                        </>
                      )}
                      {bp?.status === "received" && note?.status !== "sent" && canEdit && (
                        <>
                          <Button size="sm" icon={<FileTextIcon />} onClick={() => setDialog({ type: "payment_note", entry })}>
                            {note ? "Edit Payment Note" : "Make Payment Note"}
                          </Button>
                          {!note && <Button variant="ghost" size="sm" title="Replace the BP's invoice file" onClick={() => setDialog({ type: "upload_bp", entry })}>Replace</Button>}
                        </>
                      )}
                      {bp?.status === "received" && note?.status === "sent" && (
                        project.canPayBp
                          ? <Button size="sm" onClick={() => setDialog({ type: "pay_bp", entry })}>Pay BP</Button>
                          : <span className="pp-td-muted">With Accounts</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {dialog?.type === "delete" && (
        <ConfirmDialog
          title="Delete invoice?"
          message={`Invoice ${dialog.entry.invoice.invoice_number} will be removed.`}
          confirmLabel="Delete"
          loading={deleting}
          onConfirm={confirmDelete}
          onCancel={close}
        />
      )}
      {dialog?.type === "cfo_decide" && (
        <CfoInvoiceDecisionModal invoice={dialog.entry.invoice} decision={dialog.decision} onClose={close} onSaved={done} />
      )}
      {dialog?.type === "client_payment" && <ClientPaymentModal invoice={dialog.entry.invoice} onClose={close} onSaved={done} />}
      {dialog?.type === "request_bp" && (
        <RequestBpInvoiceModal invoice={dialog.entry.invoice} bpName={dialog.entry.project.bpName} existing={dialog.entry.bpInvoice} onClose={close} onSaved={done} />
      )}
      {dialog?.type === "upload_bp" && (
        <BpInvoiceUploadModal bpInvoice={dialog.entry.bpInvoice} projectTitle={dialog.entry.project.title} onBehalf onClose={close} onSaved={done} />
      )}
      {dialog?.type === "payment_note" && (
        <PaymentNoteModal
          entry={dialog.entry}
          onClose={close}
          onSaved={({ id, sent }) => {
            done();
            if (!sent) viewPdf("payment_note", id);
          }}
        />
      )}
      {dialog?.type === "pay_bp" && <BpPaymentModal bpInvoice={dialog.entry.bpInvoice} onClose={close} onSaved={done} />}
    </>
  );
}
