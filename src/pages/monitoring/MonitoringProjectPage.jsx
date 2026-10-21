// One awarded project in Monitoring: what needs attention now (overdue /
// due-soon items, invoices to raise, BP invoices and payment notes), the
// contract basics, then the project's sections in a vertical tab list —
// milestones & deliverables from the MoU, invoices (client and BP),
// documents, and the team / contract / billing details.
//
// Who sees it: anyone who can see the lead, except Business Partners
// (can_view_monitoring_project). Who edits: md/admin and the lead's Person
// Responsible / Reviewer / Recommending Authority.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Collapsible from "../../components/ui/Collapsible";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Modal from "../../components/ui/Modal";
import Select from "../../components/ui/Select";
import DatePickerCalendar from "../../components/ui/DatePickerCalendar";
import PageLoader from "../../components/ui/PageLoader";
import BackButton from "../../components/ui/BackButton";
import MonitoringPlanPanel from "../../components/monitoring/MonitoringPlanPanel";
import MonitoringDocumentsPanel from "../../components/monitoring/MonitoringDocumentsPanel";
import InvoiceList from "../../components/financials/InvoiceList";
import { Field, AmountInput } from "../../components/financials/InvoiceModals";
import { ReceiptIcon, PencilIcon, BellIcon, UsersIcon, ListChecksIcon, FolderIcon, FileTextIcon } from "../../components/icons";
import {
  PROJECT_SELECT, PROJECT_STATUS_LABELS, PROJECT_STATUS_VARIANTS, CLIENT_INVOICE_SELECT,
  canEditProject, buildInvoiceEntries, formatINR, fmtDate, itemTiming, dueLabel, needsInvoice, syncDueAlerts,
  invoiceTotals, roundMoney, allocatedAmount,
} from "../../lib/monitoring";
import { canOpenProposal } from "../../lib/proposalPrep";
import "../../styles/ApplicationReviewPage.css";
import "../../styles/ProposalPreparationPage.css";
import "../../styles/Monitoring.css";

const TABS = [
  { key: "plan", label: "Milestones & Deliverables", icon: <ListChecksIcon /> },
  { key: "invoices", label: "Invoices", icon: <ReceiptIcon /> },
  { key: "documents", label: "Documents", icon: <FolderIcon /> },
  { key: "overview", label: "Team & Contract", icon: <UsersIcon /> },
];

function ProjectDetailsModal({ project, invoicedBase, allocated, onClose, onSaved }) {
  const [form, setForm] = useState({
    contract_value: project.contract_value != null ? String(project.contract_value) : "",
    start_date: project.start_date || "",
    end_date: project.end_date || "",
    status: project.status,
    notes: project.notes || "",
    client_address: project.client_address || "",
    client_gstin: project.client_gstin || "",
    contract_ref: project.contract_ref || "",
    bp_share_pct: project.bp_share_pct != null ? String(project.bp_share_pct) : "",
    advance_details: project.advance_details || "",
    emd_details: project.emd_details || "",
    bg_details: project.bg_details || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const hasBp = !!project.lead?.assigned_ba_id;

  async function save() {
    let value = null;
    if (form.contract_value !== "") {
      value = Number(form.contract_value);
      if (!Number.isFinite(value) || value < 0) { setError("Enter a valid contract value."); return; }
      if (value < invoicedBase) { setError(`The contract value can't be less than the ${formatINR(invoicedBase)} already invoiced (before GST).`); return; }
      if (value < allocated) { setError(`The contract value can't be less than the ${formatINR(allocated)} set across milestones and deliverables.`); return; }
    } else if (invoicedBase > 0) {
      setError("The contract value can't be cleared — invoices have already been raised against it.");
      return;
    }
    let share = null;
    if (form.bp_share_pct !== "") {
      share = Number(form.bp_share_pct);
      if (!Number.isFinite(share) || share < 0 || share > 100) { setError("The BP's revenue share must be between 0 and 100%."); return; }
    }
    const gstin = form.client_gstin.trim().toUpperCase();
    if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) { setError("A GSTIN is 15 characters, starting with the 2-digit state code."); return; }
    if (form.start_date && form.end_date && form.end_date < form.start_date) { setError("End date can't be before the start date."); return; }
    setSaving(true);
    setError("");
    const clean = (v) => v.trim() || null;
    const { error: dbErr } = await supabase.from("monitoring_projects").update({
      contract_value: value,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      status: form.status,
      notes: clean(form.notes),
      client_address: clean(form.client_address),
      client_gstin: gstin || null,
      contract_ref: clean(form.contract_ref),
      bp_share_pct: share,
      advance_details: clean(form.advance_details),
      emd_details: clean(form.emd_details),
      bg_details: clean(form.bg_details),
      updated_at: new Date().toISOString(),
    }).eq("id", project.id);
    if (dbErr) { setError(dbErr.message); setSaving(false); return; }
    onSaved();
  }

  return (
    <Modal onClose={saving ? undefined : onClose} closeOnBackdrop={!saving} size="lg">
      <Modal.Header title="Project Details" subtitle="Contract, client billing details, and what the payment note needs." onClose={saving ? undefined : onClose} />
      <Modal.Body>
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}
        <div className="mon-form">
          <h3 className="mon-form-section">Contract</h3>
          <div className="mon-form-row">
            <Field label="Contract value (before GST)" hint={[
              project.proposal?.proposed_value != null ? `Proposed: ${formatINR(project.proposal.proposed_value)}.` : "",
              invoicedBase > 0 ? `${formatINR(invoicedBase)} invoiced.` : "",
              allocated > 0 ? `${formatINR(allocated)} on milestones.` : "",
            ].filter(Boolean).join(" ") || null}>
              <AmountInput value={form.contract_value} onChange={(v) => set("contract_value", v)} disabled={saving} ariaLabel="Contract value" />
            </Field>
            <Field label="Status">
              <Select options={Object.entries(PROJECT_STATUS_LABELS).map(([v, label]) => ({ value: v, label }))} value={form.status} onChange={(v) => set("status", v)} />
            </Field>
          </div>
          <div className="mon-form-row">
            <Field label="Start date"><DatePickerCalendar value={form.start_date} onChange={(v) => set("start_date", v)} /></Field>
            <Field label="End date"><DatePickerCalendar value={form.end_date} onChange={(v) => set("end_date", v)} /></Field>
          </div>
          <Field label="Contract / agreement reference" hint="Printed as “Ref:” on every invoice.">
            <input className="input" value={form.contract_ref} onChange={(e) => set("contract_ref", e.target.value)} disabled={saving} placeholder="e.g. Contract agreement no IN-DL96099086159941X dated 19th Nov 2025" />
          </Field>

          <h3 className="mon-form-section">Client billing details</h3>
          <Field label="Client name & address" hint="As it should appear on the invoice — one line per row.">
            <textarea className="input" rows={4} value={form.client_address} onChange={(e) => set("client_address", e.target.value)} disabled={saving} placeholder={"The Secretary\nTea Board India\n14, B.T.M Sarani\nKolkata-700001"} />
          </Field>
          <Field label="Client GSTIN" hint="A Delhi GSTIN (07…) is billed CGST + SGST; any other state IGST.">
            <input className="input" value={form.client_gstin} onChange={(e) => set("client_gstin", e.target.value)} disabled={saving} placeholder="e.g. 19AAAJT2422P1ZO" maxLength={15} />
          </Field>

          <h3 className="mon-form-section">For the payment note</h3>
          {hasBp && (
            <Field label="Business Partner's revenue share (%)" hint="AFC's share is the rest.">
              <input className="input" type="number" min="0" max="100" step="0.01" value={form.bp_share_pct} onChange={(e) => set("bp_share_pct", e.target.value)} disabled={saving} placeholder="e.g. 82" />
            </Field>
          )}
          <div className="mon-form-row">
            <Field label="Advance given, if any"><input className="input" value={form.advance_details} onChange={(e) => set("advance_details", e.target.value)} disabled={saving} placeholder="N/A" /></Field>
            <Field label="EMD details"><input className="input" value={form.emd_details} onChange={(e) => set("emd_details", e.target.value)} disabled={saving} placeholder="N/A" /></Field>
          </div>
          <Field label="Bank guarantee / indemnity bond details">
            <textarea className="input" rows={2} value={form.bg_details} onChange={(e) => set("bg_details", e.target.value)} disabled={saving} placeholder="N/A" />
          </Field>
          <Field label="Notes">
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} disabled={saving} />
          </Field>
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={save}>Save</Button>
      </Modal.Footer>
    </Modal>
  );
}

export default function MonitoringProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  // The open tab lives in the URL (?tab=invoices) so refresh / a shared
  // link lands on the same section.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === searchParams.get("tab")) ? searchParams.get("tab") : "plan";
  const selectTab = (key) => setSearchParams(key === "plan" ? {} : { tab: key }, { replace: true });
  const { profile } = useAuth();

  const [project, setProject] = useState(null);
  const [items, setItems] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [bpInvoices, setBpInvoices] = useState([]);
  const [paymentNotes, setPaymentNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingDetails, setEditingDetails] = useState(false);

  const fetchAll = useCallback(async () => {
    const [p, it, docs, inv, bp, notes] = await Promise.all([
      supabase.from("monitoring_projects").select(PROJECT_SELECT).eq("id", id).maybeSingle(),
      supabase.from("monitoring_items").select("*").eq("project_id", id),
      supabase.from("monitoring_documents").select("*").eq("project_id", id),
      supabase.from("client_invoices").select(CLIENT_INVOICE_SELECT).eq("project_id", id).order("invoice_date", { ascending: false }),
      supabase.from("bp_invoices").select("*").eq("project_id", id),
      supabase.from("bp_payment_notes").select("*").eq("project_id", id),
    ]);
    if (p.error || !p.data) {
      setError(p.error?.message || "This project isn't in Monitoring, or you don't have access to it.");
      setLoading(false);
      return;
    }
    setProject(p.data);
    setItems(it.data || []);
    setDocuments(docs.data || []);
    setInvoices(inv.data || []);
    setBpInvoices(bp.data || []);
    setPaymentNotes(notes.data || []);
    setLoading(false);
  }, [id]);

  useEffect(() => { syncDueAlerts(); fetchAll(); }, [fetchAll]);

  const itemsById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const entries = useMemo(
    () => (project ? buildInvoiceEntries({ invoices, bpInvoices, paymentNotes, projectsById: { [project.id]: project }, itemsById, profile }) : []),
    [invoices, bpInvoices, paymentNotes, project, itemsById, profile]
  );

  // Invoices are raised on their own page, laid out like the invoice.
  const raiseInvoice = (itemId) => navigate(`/monitoring/${id}/invoice${itemId ? `?item=${itemId}` : ""}`);

  if (loading) return <PageLoader text="Loading project…" />;
  if (!project) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="app-container">
          <BackButton to="/monitoring" label="Back to Monitoring" />
          <Alert variant="danger">{error}</Alert>
        </div>
      </div>
    );
  }

  const lead = project.lead || {};
  const canEdit = canEditProject(project, profile);
  const hasBp = !!lead.assigned_ba_id;
  const noteByBp = Object.fromEntries(paymentNotes.map((n) => [n.bp_invoice_id, n]));
  const toInvoicesTab = { label: "Open Invoices", run: () => selectTab("invoices") };

  // A completed project has no deadlines left to chase.
  const live = project.status !== "completed";
  const overdue = live ? items.filter((i) => itemTiming(i) === "overdue") : [];
  const dueSoon = live ? items.filter((i) => itemTiming(i) === "due_soon") : [];
  const toInvoice = items.filter((i) => needsInvoice(i, invoices, items));
  const paidNoBpRequest = hasBp ? invoices.filter((i) => i.status === "paid" && !bpInvoices.some((b) => b.client_invoice_id === i.id)) : [];
  const bpReceived = bpInvoices.filter((b) => b.status === "received");

  const alerts = [
    ...overdue.map((i) => ({ key: `o-${i.id}`, tone: "danger", text: `${i.kind === "milestone" ? "Milestone" : "Deliverable"} “${i.title}” is ${dueLabel(i).toLowerCase()}.` })),
    ...toInvoice.map((i) => ({ key: `i-${i.id}`, tone: "danger", text: `“${i.title}” is complete — raise the client invoice${Number(i.invoice_amount) > 0 ? ` (${formatINR(i.invoice_amount)})` : ""}.`, action: canEdit ? { label: "Raise Invoice", run: () => raiseInvoice(i.id) } : null })),
    ...bpReceived.map((b) => {
      const note = noteByBp[b.id];
      if (!note) return { key: `b-${b.id}`, tone: "warning", text: `BP invoice ${b.invoice_number} (${formatINR(b.amount)}) received — make the payment note for Accounts.`, action: canEdit ? toInvoicesTab : null };
      if (note.status === "draft") return { key: `b-${b.id}`, tone: "warning", text: `The payment note for BP invoice ${b.invoice_number} is still a draft — send it to Accounts.`, action: canEdit ? toInvoicesTab : null };
      return { key: `b-${b.id}`, tone: "info", text: `Payment note sent — Accounts to pay BP invoice ${b.invoice_number} (${formatINR(b.amount)}).` };
    }),
    ...paidNoBpRequest.map((i) => ({ key: `r-${i.id}`, tone: "warning", text: `Client paid invoice ${i.invoice_number} — ask the Business Partner for their invoice.`, action: canEdit ? toInvoicesTab : null })),
    ...dueSoon.map((i) => ({ key: `s-${i.id}`, tone: "info", text: `“${i.title}” — ${dueLabel(i).toLowerCase()} (${fmtDate(i.due_date)}).` })),
  ];

  const money = invoiceTotals(invoices);
  const allocated = allocatedAmount(items);
  const leftToInvoice = project.contract_value == null ? null : roundMoney(Math.max(Number(project.contract_value) - money.invoicedBase, 0));
  const doneCount = items.filter((i) => i.status === "completed").length;
  const nextDue = live && items.filter((i) => i.status !== "completed" && i.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const period = project.start_date || project.end_date
    ? `${project.start_date ? fmtDate(project.start_date) : "—"} to ${project.end_date ? fmtDate(project.end_date) : "—"}`
    : "";
  const counts = { plan: items.length, invoices: invoices.length, documents: documents.length };

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="pp-page animate-fadeUp">
          <BackButton to="/monitoring" label="Back to Monitoring" />

          <Card className="ar-header-card">
            <Card.Body className="ar-header-body">
              <div className="ar-header-left">
                <div className="ar-header-badges">
                  <Badge variant="brand">Monitoring</Badge>
                  <Badge variant={PROJECT_STATUS_VARIANTS[project.status]} dot>{PROJECT_STATUS_LABELS[project.status]}</Badge>
                </div>
                <h1 className="ar-header-email">{lead.title}</h1>
                <p className="ar-header-meta">
                  {canOpenProposal(lead, profile)
                    ? <button type="button" className="pp-lead-number-link" title="Open proposal" onClick={() => navigate(`/proposals/${lead.id}`)}>{lead.lead_number}</button>
                    : lead.lead_number}
                  {lead.client_name ? <> · {lead.client_name}</> : ""}
                  {project.proposal?.client_response_at ? <> · Awarded <strong>{fmtDate(project.proposal.client_response_at)}</strong></> : ""}
                </p>
              </div>
              {canEdit && <Button variant="secondary" size="sm" icon={<PencilIcon />} onClick={() => setEditingDetails(true)}>Edit Details</Button>}
            </Card.Body>
          </Card>

          {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

          <div className="mon-kpis">
            <div className="mon-kpi mon-kpi-blue">
              <span className="mon-kpi-label">Contract Value</span>
              <span className="mon-kpi-value">{formatINR(project.contract_value, { decimals: false })}</span>
              <span className="mon-kpi-sub">{period || "Period not set"}</span>
            </div>
            <div className="mon-kpi mon-kpi-purple">
              <span className="mon-kpi-label">Progress</span>
              <span className="mon-kpi-value">{items.length ? `${doneCount}/${items.length}` : "—"}</span>
              <span className="mon-kpi-sub">{!live ? "Project completed" : nextDue ? `Next: ${fmtDate(nextDue.due_date)}` : items.length ? "Nothing pending with a date" : "No milestones yet"}</span>
            </div>
            <div className="mon-kpi mon-kpi-amber">
              <span className="mon-kpi-label">Invoiced</span>
              <span className="mon-kpi-value">{formatINR(money.invoiced, { decimals: false })}</span>
              <span className="mon-kpi-sub">
                {leftToInvoice == null ? `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}` : `${formatINR(leftToInvoice, { decimals: false })} left to invoice`}
              </span>
            </div>
            <div className="mon-kpi mon-kpi-green">
              <span className="mon-kpi-label">Received</span>
              <span className="mon-kpi-value">{formatINR(money.received, { decimals: false })}</span>
              <span className={`mon-kpi-sub${money.outstanding > 0 ? " is-warn" : ""}`}>
                {money.outstanding > 0 ? `${formatINR(money.outstanding)} outstanding` : "Nothing outstanding"}
              </span>
            </div>
          </div>

          {alerts.length > 0 && (
            <Card className="mon-alerts-card">
              <Collapsible title="Needs Attention" subtitle={`${alerts.length} item${alerts.length === 1 ? "" : "s"}`} icon={<BellIcon />}>
                <ul className="mon-alerts">
                  {alerts.map((a) => (
                    <li key={a.key} className={`mon-alert is-${a.tone}`}>
                      <span className="mon-alert-dot" aria-hidden="true" />
                      <span className="mon-alert-text">{a.text}</span>
                      {a.action && <Button size="sm" variant={a.action === toInvoicesTab ? "secondary" : "primary"} onClick={a.action.run}>{a.action.label}</Button>}
                    </li>
                  ))}
                </ul>
              </Collapsible>
            </Card>
          )}

          <nav className="mon-hbar" role="tablist" aria-label="Project sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`mon-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls={`mon-panel-${t.key}`}
                className={`mon-htab${tab === t.key ? " is-active" : ""}`}
                onClick={() => selectTab(t.key)}
              >
                <span className="mon-htab-icon" aria-hidden="true">{t.icon}</span>
                <span className="mon-htab-label">{t.label}</span>
                {counts[t.key] != null && <span className="mon-tab-count">{counts[t.key]}</span>}
              </button>
            ))}
          </nav>

          <div role="tabpanel" id={`mon-panel-${tab}`} aria-labelledby={`mon-tab-${tab}`} className="mon-tab-panel">
              {tab === "plan" && (
                <MonitoringPlanPanel
                  projectId={project.id}
                  items={items}
                  documents={documents}
                  clientInvoices={invoices}
                  canEdit={canEdit}
                  onRaiseInvoice={(item) => raiseInvoice(item.id)}
                  onChanged={fetchAll}
                />
              )}
              {tab === "invoices" && (
                <Card>
                  <Collapsible
                    title="Invoices"
                    subtitle={hasBp
                      ? "Raise the client invoice → record the payment → BP's invoice → payment note to Accounts → BP paid."
                      : "Client invoices and payments received."}
                    icon={<ReceiptIcon />}
                    expandable={false}
                    action={canEdit ? <Button size="sm" onClick={() => raiseInvoice()}>+ Raise Invoice</Button> : null}
                  >
                    <InvoiceList entries={entries} emptyText="No invoices raised yet — raise one against a milestone or its deliverables." onChanged={fetchAll} />
                  </Collapsible>
                </Card>
              )}
              {tab === "documents" && (
                <MonitoringDocumentsPanel projectId={project.id} documents={documents} canEdit={canEdit} hasBp={hasBp} onChanged={fetchAll} />
              )}
              {tab === "overview" && (
                <div className="pp-summary-row">
                  <Card className="pp-summary-card">
                    <Collapsible title="Team" icon={<UsersIcon />} expandable={false}>
                      <div className="pp-summary">
                        <div className="pp-summary-item"><span>Person Responsible</span><strong>{lead.pr?.full_name || "—"}</strong></div>
                        <div className="pp-summary-item"><span>Reviewer</span><strong>{lead.rev?.full_name || "—"}</strong></div>
                        <div className="pp-summary-item"><span>Recommending Authority</span><strong>{lead.aa?.full_name || "—"}</strong></div>
                        <div className="pp-summary-item"><span>Business Partner</span><strong>{lead.ba?.full_name || "—"}</strong></div>
                        {hasBp && <div className="pp-summary-item"><span>BP Revenue Share</span><strong>{project.bp_share_pct != null ? `${project.bp_share_pct}%` : "—"}</strong></div>}
                      </div>
                    </Collapsible>
                  </Card>
                  <Card className="pp-summary-card">
                    <Collapsible title="Contract & Billing" icon={<FileTextIcon />} expandable={false}>
                      <div className="pp-summary">
                        <div className="pp-summary-item"><span>Proposed Value</span><strong>{formatINR(project.proposal?.proposed_value)}</strong></div>
                        <div className="pp-summary-item"><span>Contract Value</span><strong>{formatINR(project.contract_value)}</strong></div>
                        <div className="pp-summary-item"><span>Period</span><strong>{period || "—"}</strong></div>
                        <div className="pp-summary-item"><span>Agreement Ref.</span><strong className="mon-notes">{project.contract_ref || "—"}</strong></div>
                        <div className="pp-summary-item"><span>Client Address</span><strong className="mon-notes">{project.client_address || "—"}</strong></div>
                        <div className="pp-summary-item"><span>Client GSTIN</span><strong>{project.client_gstin || "—"}</strong></div>
                        <div className="pp-summary-item"><span>Notes</span><strong className="mon-notes">{project.notes || "—"}</strong></div>
                      </div>
                    </Collapsible>
                  </Card>
                </div>
              )}
            </div>
        </div>
      </div>

      {editingDetails && <ProjectDetailsModal project={project} invoicedBase={money.invoicedBase} allocated={allocated} onClose={() => setEditingDetails(false)} onSaved={() => { setEditingDetails(false); fetchAll(); }} />}
    </div>
  );
}
