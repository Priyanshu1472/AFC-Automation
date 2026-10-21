// Business Partner's Home: AFC's requests for the BP's invoice (sent once
// the client has paid AFC). The BP uploads their invoice in their own
// format with the key details, and sees when AFC has paid it. Reads go
// through my_bp_invoice_requests() — BPs have no access to the monitoring
// tables themselves.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Card from "../ui/Card";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { EyeIcon, ReceiptIcon } from "../icons";
import { BpInvoiceUploadModal } from "./InvoiceModals";
import { formatINR, fmtDate, openMonitoringFile, BP_INVOICE_STATUS_VARIANTS } from "../../lib/monitoring";
import "../../styles/Monitoring.css";

const BP_STATUS_LABELS = { requested: "Invoice Requested", received: "Submitted — Awaiting Payment", paid: "Paid" };

export default function BpInvoiceRequestsCard() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(null);

  const load = useCallback(async () => {
    const { data, error: rpcErr } = await supabase.rpc("my_bp_invoice_requests");
    if (rpcErr) { setError(rpcErr.message); setRows([]); return; }
    setRows(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!rows || rows.length === 0) return error ? <Alert variant="danger">{error}</Alert> : null;

  async function view(path) {
    setError("");
    try { await openMonitoringFile(path); } catch (err) { setError(err.message); }
  }

  return (
    <Card className="mon-bp-card">
      <Card.Header title="Invoices" subtitle="AFC asks for your invoice here once the client has paid. Upload it in your own format." />
      <Card.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <ul className="mon-bp-list">
          {rows.map((r) => (
            <li key={r.id} className={`mon-bp-row is-${r.status}`}>
              <span className="mon-bp-icon" aria-hidden="true"><ReceiptIcon /></span>
              <div className="mon-bp-main">
                <div className="mon-bp-title">{r.project_title}</div>
                <div className="mon-bp-meta">
                  {r.client_name ? `${r.client_name} · ` : ""}Requested {fmtDate(r.requested_at)}
                  {r.expected_amount != null ? ` · ${formatINR(r.expected_amount)}` : ""}
                </div>
                {r.request_note && r.status === "requested" && <div className="mon-bp-note">“{r.request_note}”</div>}
                {r.status !== "requested" && (
                  <div className="mon-bp-meta">Your invoice {r.invoice_number} · {fmtDate(r.invoice_date)} · {formatINR(r.amount)}</div>
                )}
                {r.status === "paid" && (
                  <div className="mon-bp-meta mon-bp-paid">Paid {formatINR(r.paid_amount)} on {fmtDate(r.paid_on)}{r.payment_reference ? ` · Ref ${r.payment_reference}` : ""}</div>
                )}
              </div>
              <div className="mon-bp-actions">
                <Badge variant={BP_INVOICE_STATUS_VARIANTS[r.status]}>{BP_STATUS_LABELS[r.status]}</Badge>
                {r.file_path && <Button variant="ghost" size="sm" icon={<EyeIcon />} onClick={() => view(r.file_path)}>View</Button>}
                {r.status === "requested" && <Button size="sm" onClick={() => setUploading(r)}>Upload Invoice</Button>}
                {r.status === "received" && <Button variant="secondary" size="sm" onClick={() => setUploading(r)}>Replace</Button>}
              </div>
            </li>
          ))}
        </ul>
      </Card.Body>
      {uploading && (
        <BpInvoiceUploadModal
          bpInvoice={uploading}
          projectTitle={uploading.project_title}
          onClose={() => setUploading(null)}
          onSaved={() => { setUploading(null); load(); }}
        />
      )}
    </Card>
  );
}
