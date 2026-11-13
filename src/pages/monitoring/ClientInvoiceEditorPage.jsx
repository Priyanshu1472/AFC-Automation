// Raise / edit a client invoice on its own page, laid out like the Bid
// Payment Requisition Note editor: the form on the left, and a live
// "as it will print" preview of both pages (covering letter + TAX INVOICE,
// the same wording the generated PDF uses) on the right.
//
// An invoice is always raised against something: pick the milestone, then
// the whole milestone or some / all of its deliverables — each becomes a
// line with its own amount. GST, totals and the amount in words follow. The client's
// address / GSTIN / agreement reference belong to the project and are
// saved back to it, so the next invoice starts filled in.
//
// Routes: /monitoring/:id/invoice            (new; ?item=<id> preselects)
//         /monitoring/:id/invoice/:invoiceId (edit, while unpaid)
//         ?back=financials returns to Financials instead of the project.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Select from "../../components/ui/Select";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import BackButton from "../../components/ui/BackButton";
import DatePickerCalendar from "../../components/ui/DatePickerCalendar";
import { AmountInput } from "../../components/financials/InvoiceModals";
import {
  formatINR, roundMoney, itemBilled, gstTypeForGstin, GST_RATES, canEditProject, fetchInvoiceContext,
} from "../../lib/monitoring";
import {
  AFC_TAX_DETAILS, AFC_ACCOUNT_HOLDER, AFC_BANK, ordinal, rs, amountInWords, formatDDMMYYYY, dueOnPhrase,
} from "../../lib/invoiceFormat";
import logo from "../../images/Logo.png";
import "../../styles/LeadForm.css";
import "../../styles/ProposalPreparationPage.css";
import "../../styles/Monitoring.css";
import "../../styles/InvoiceEditor.css";

const LOOSE = "__loose";

function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export default function ClientInvoiceEditorPage() {
  const { id: projectId, invoiceId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const backTo = searchParams.get("back") === "financials" ? "/financials" : `/monitoring/${projectId}?tab=invoices`;

  const [ctx, setCtx] = useState(null);
  const [cfoName, setCfoName] = useState("");
  const [group, setGroup] = useState("");      // milestone id | LOOSE
  const [mode, setMode] = useState("whole");   // "whole" milestone | "parts" (its deliverables)
  const [picked, setPicked] = useState([]);    // deliverable ids when mode = parts
  const [amounts, setAmounts] = useState({});  // item id -> string
  const [form, setForm] = useState({
    invoice_number: "", invoice_date: "", gst_rate: "18", gst_type: "igst", subject: "", remarks: "",
    client_address: "", client_gstin: "", contract_ref: "",
  });
  const [page, setPage] = useState(2);           // preview: 1 letter, 2 tax invoice
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let live = true;
    Promise.all([
      fetchInvoiceContext(projectId),
      supabase.from("afc_users").select("full_name").eq("role", "cfo").eq("is_active", true).order("created_at").limit(1).maybeSingle(),
    ]).then(([c, cfo]) => {
      if (!live) return;
      setCtx(c);
      setCfoName((cfo.data?.full_name || "").toUpperCase());
      const p = c.project || {};
      const inv = invoiceId ? c.invoices.find((x) => x.id === invoiceId) : null;
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      setForm({
        invoice_number: inv?.invoice_number || "",
        invoice_date: inv?.invoice_date || todayIso,
        gst_rate: String(inv?.gst_rate ?? 18),
        gst_type: inv?.gst_type || gstTypeForGstin(p.client_gstin),
        subject: inv?.subject || "",
        remarks: inv?.remarks || "",
        client_address: p.client_address || p.lead?.client_name || "",
        client_gstin: p.client_gstin || "",
        contract_ref: p.contract_ref || "",
      });
      const find = (iid) => c.items.find((i) => i.id === iid);
      const lines = inv ? [...(inv.lines || [])].sort((a, b) => a.position - b.position) : [];
      const preselect = searchParams.get("item");
      if (lines.length) {
        const first = find(lines[0].item_id);
        if (first?.kind === "milestone") { setGroup(first.id); setMode("whole"); }
        else { setGroup(first?.parent_id || LOOSE); setMode("parts"); setPicked(lines.map((l) => l.item_id)); }
        setAmounts(Object.fromEntries(lines.map((l) => [l.item_id, String(l.amount)])));
      } else if (preselect && find(preselect)) {
        const d = find(preselect);
        if (d.kind === "milestone") { setGroup(d.id); setMode("whole"); }
        else { setGroup(d.parent_id || LOOSE); setMode("parts"); setPicked([d.id]); }
      }
    });
    return () => { live = false; };
    // searchParams is read once, for the initial preselection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, invoiceId]);

  const items = useMemo(() => ctx?.items || [], [ctx]);
  const invoices = ctx?.invoices || [];
  const project = ctx?.project || null;
  const editingInvoice = invoiceId ? invoices.find((x) => x.id === invoiceId) : null;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const milestones = items.filter((i) => i.kind === "milestone").sort((a, b) => (a.due_date || "9").localeCompare(b.due_date || "9"));
  const loose = items.filter((i) => i.kind === "deliverable" && !i.parent_id);
  const kidsOf = (mid) => items.filter((i) => i.parent_id === mid);

  // Still billable on an item: its own cap and, for a deliverable, what's
  // left on its milestone — counting other invoices only.
  const leftOn = (item) => {
    const own = item.invoice_amount == null ? null : roundMoney(Number(item.invoice_amount) - itemBilled(item, invoices, items, invoiceId));
    const parent = item.parent_id ? byId[item.parent_id] : null;
    const fam = parent?.invoice_amount == null ? null : roundMoney(Number(parent.invoice_amount) - itemBilled(parent, invoices, items, invoiceId));
    const vals = [own, fam].filter((v) => v != null);
    return vals.length ? Math.max(Math.min(...vals), 0) : null;
  };
  const defaultAmount = (item) => { const l = leftOn(item); return l != null && l > 0 ? String(l) : ""; };

  if (!ctx) return <PageLoader text="Loading invoice…" />;

  const lead = project?.lead || {};
  const canEdit = project && canEditProject(project, profile);
  const lineItems = !group ? [] : mode === "whole" && group !== LOOSE ? [byId[group]].filter(Boolean) : picked.map((iid) => byId[iid]).filter(Boolean);
  const amountOf = (item) => (amounts[item.id] !== undefined ? amounts[item.id] : defaultAmount(item));
  const lineAmounts = lineItems.map((it) => num(amountOf(it)));
  const base = lineAmounts.length && lineAmounts.every((a) => a !== null && Number.isFinite(a)) ? roundMoney(lineAmounts.reduce((s, a) => s + a, 0)) : null;
  const rate = Number(form.gst_rate);
  const gst = base != null ? roundMoney((base * rate) / 100) : null;
  const total = base != null ? roundMoney(base + gst) : null;
  const contract = project?.contract_value == null ? null : Number(project.contract_value);
  const billedElsewhere = roundMoney(invoices.filter((i) => i.id !== invoiceId).reduce((s, i) => s + Number(i.amount || 0), 0));
  const projectLeft = contract == null ? null : roundMoney(Math.max(contract - billedElsewhere, 0));
  const nth = ordinal(editingInvoice?.installment_no || invoices.filter((i) => i.id !== invoiceId).length + 1);
  const title = lead.title || "the assignment";
  const subject = form.subject.trim() || `Submission of ${nth} Invoice towards ${title}`;
  const words = total != null ? amountInWords(total) : "…";
  const pct = contract && base ? (base / contract) * 100 : null;
  const pctText = pct != null ? ` (${Math.abs(pct - Math.round(pct)) < 0.005 ? Math.round(pct) : pct.toFixed(2)}%)` : "";
  const preamble = `Being the ${nth} invoice${pctText} of the total project fee${contract != null ? ` of ${rs(contract)} (exclusive of GST)` : ""} towards ${title}`;
  const halfGst = gst != null ? roundMoney(gst / 2) : null;
  const kids = group && group !== LOOSE ? kidsOf(group) : group === LOOSE ? loose : [];
  const groupOptions = [
    ...milestones.map((m) => ({ value: m.id, label: `${m.title}${m.status === "completed" ? " ✓" : ""}` })),
    ...(loose.length ? [{ value: LOOSE, label: "Deliverables not under a milestone" }] : []),
  ];

  function pickGroup(v) {
    const hasKids = v && v !== LOOSE && kidsOf(v).length > 0;
    setGroup(v);
    setMode(v === LOOSE || hasKids ? "parts" : "whole");
    setPicked([]);
    setError("");
  }

  async function save() {
    if (!lineItems.length) { setError(group ? "Tick at least one deliverable." : "Select the milestone this invoice is raised against."); return; }
    if (!form.invoice_number.trim()) { setError("Enter the invoice number."); return; }
    if (!form.invoice_date) { setError("Enter the invoice date."); return; }
    if (contract == null) { setError("Set the project's contract value (Edit Details on the project) before raising invoices."); return; }
    for (const it of lineItems) {
      const a = num(amountOf(it));
      if (a === null || !Number.isFinite(a) || a <= 0) { setError(`Enter the amount for “${it.title}”.`); return; }
      const left = leftOn(it);
      if (left != null && roundMoney(a) > left) { setError(`Only ${formatINR(left)} is left to invoice on “${it.title}”.`); return; }
    }
    if (base > projectLeft) { setError(`Only ${formatINR(projectLeft)} of the ${formatINR(contract)} contract value is left to invoice (before GST).`); return; }
    const gstin = form.client_gstin.trim().toUpperCase();
    if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) { setError("A GSTIN is 15 characters, starting with the 2-digit state code."); return; }
    setSaving(true);
    setError("");

    // The client's billing details belong to the project — save them first
    // so the generated PDF (and every later invoice) uses them.
    const projectPatch = {
      client_address: form.client_address.trim() || null,
      client_gstin: gstin || null,
      contract_ref: form.contract_ref.trim() || null,
    };
    if (Object.entries(projectPatch).some(([k, v]) => (project[k] || null) !== v)) {
      const { error: pErr } = await supabase.from("monitoring_projects").update({ ...projectPatch, updated_at: new Date().toISOString() }).eq("id", projectId);
      if (pErr) { setError(pErr.message); setSaving(false); return; }
    }

    const { error: rpcErr } = await supabase.rpc("save_client_invoice", {
      p_invoice_id: invoiceId || null,
      p_project_id: projectId,
      p_invoice_number: form.invoice_number.trim(),
      p_invoice_date: form.invoice_date,
      p_gst_rate: rate,
      p_gst_type: form.gst_type,
      p_subject: form.subject.trim() || null,
      p_remarks: form.remarks.trim() || null,
      p_lines: lineItems.map((it) => ({ item_id: it.id, amount: roundMoney(num(amountOf(it))) })),
    });
    if (rpcErr) {
      setError(/client_invoices_number_uniq/.test(rpcErr.message) ? "An invoice with this number already exists." : rpcErr.message);
      setSaving(false);
      return;
    }
    navigate(backTo, { replace: true });
  }

  const shell = (body) => (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">{body}</div>
    </div>
  );

  if (!project) return shell(<><BackButton to="/monitoring" label="Back to Monitoring" /><Alert variant="danger">This project isn&rsquo;t in Monitoring, or you don&rsquo;t have access to it.</Alert></>);
  if (!canEdit) return shell(<><BackButton to={backTo} label="Back" /><Alert variant="danger">You can&rsquo;t raise invoices on this project.</Alert></>);
  if (editingInvoice?.status === "paid") return shell(<><BackButton to={backTo} label="Back" /><Alert variant="warning">This invoice has been paid and can no longer be changed.</Alert></>);
  if (editingInvoice?.status === "raised") return shell(<><BackButton to={backTo} label="Back" /><Alert variant="warning">This invoice has already been approved and signed by the CFO and can no longer be changed.</Alert></>);

  const off = saving;
  const addressLines = form.client_address.split("\n").map((s) => s.trim()).filter(Boolean);

  return shell(
    <>
      <div className="page-header">
        <BackButton to={backTo} label={backTo === "/financials" ? "Back to Financials" : "Back to Project"} />
        <div className="page-title-row">
          <div>
            <h1>{invoiceId ? "Edit Client Invoice" : "Raise Client Invoice"}</h1>
            <p>{lead.lead_number} — {title} · {nth} invoice</p>
          </div>
        </div>
      </div>

      {!items.length && <Alert variant="warning">Add the milestones and deliverables from the MoU first — an invoice is always raised against one of them.</Alert>}
      {contract == null && <Alert variant="warning">This project has no contract value yet — set it from <strong>Edit Details</strong> on the project before raising an invoice.</Alert>}

      <form className="pp-fnp-layout" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="pp-fnp-form">
          {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

          <Card>
            <Card.Header title="Raise Against" subtitle="Pick the milestone, then the whole milestone or the deliverables being billed." />
            <Card.Body className="inv-form-body">
              <div className="field">
                <label className="field-label">Milestone <span className="required">*</span></label>
                <Select options={groupOptions} value={group} onChange={pickGroup} disabled={off} placeholder="Select milestone…" />
              </div>
              {group && group !== LOOSE && kids.length > 0 && (
                <div className="mon-segment" role="radiogroup" aria-label="What to bill">
                  <button type="button" role="radio" aria-checked={mode === "parts"} className={mode === "parts" ? "is-active" : ""} onClick={() => setMode("parts")}>Its deliverables</button>
                  <button type="button" role="radio" aria-checked={mode === "whole"} className={mode === "whole" ? "is-active" : ""} onClick={() => setMode("whole")}>The whole milestone</button>
                </div>
              )}
              {group && mode === "parts" && kids.length > 0 && (
                <div className="mon-pick-list">
                  <div className="mon-pick-head">
                    <span>{picked.length} of {kids.length} selected</span>
                    <button type="button" className="mon-add-link" onClick={() => setPicked(picked.length === kids.length ? [] : kids.filter((k) => leftOn(k) !== 0 || picked.includes(k.id)).map((k) => k.id))}>
                      {picked.length === kids.length ? "Clear all" : "Select all"}
                    </button>
                  </div>
                  {kids.map((k) => {
                    const left = leftOn(k);
                    const done = left === 0 && !picked.includes(k.id);
                    return (
                      <label key={k.id} className={`mon-pick${done ? " is-disabled" : ""}`}>
                        <input type="checkbox" checked={picked.includes(k.id)} disabled={done || off} onChange={() => setPicked((p) => (p.includes(k.id) ? p.filter((x) => x !== k.id) : [...p, k.id]))} />
                        <span className="mon-pick-title">{k.title}</span>
                        <span className="mon-pick-meta">
                          {done ? "Fully invoiced" : left != null ? `${formatINR(left)} left` : "No amount set"}
                          {k.status !== "completed" ? " · not completed yet" : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </Card.Body>
          </Card>

          {lineItems.length > 0 && (
            <Card>
              <Card.Header title="Amounts" subtitle="Before GST — one line per item on the invoice." />
              <Card.Body className="inv-form-body">
                <div className="mon-lines">
                  {lineItems.map((it) => {
                    const left = leftOn(it);
                    const a = num(amountOf(it));
                    return (
                      <div key={it.id} className={`mon-line${left != null && a > left ? " is-over" : ""}`}>
                        <div className="mon-line-label">
                          <strong>{it.title}</strong>
                          <small>{it.kind === "milestone" ? "Milestone" : "Deliverable"}{left != null ? ` · ${formatINR(left)} left` : ""}</small>
                        </div>
                        <AmountInput value={amountOf(it)} onChange={(v) => setAmounts((m) => ({ ...m, [it.id]: v }))} disabled={off} ariaLabel={`Amount for ${it.title}`} />
                      </div>
                    );
                  })}
                </div>
                <div className="pp-fee-line-inputs">
                  <div className="field">
                    <label className="field-label">GST rate</label>
                    <Select options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} value={form.gst_rate} onChange={(v) => set("gst_rate", v)} disabled={off} />
                  </div>
                  <div className="field">
                    <label className="field-label">GST type</label>
                    <Select options={[{ value: "igst", label: "IGST (other state)" }, { value: "cgst_sgst", label: "CGST + SGST (Delhi)" }]} value={form.gst_type} onChange={(v) => set("gst_type", v)} disabled={off} />
                  </div>
                </div>
                <div className="mon-budget">
                  <div><span>Amount (before GST)</span><strong>{base != null ? formatINR(base) : "—"}</strong></div>
                  <div><span>{form.gst_type === "cgst_sgst" ? `CGST ${rate / 2}% + SGST ${rate / 2}%` : `IGST ${rate}%`}</span><strong>{gst != null ? formatINR(gst) : "—"}</strong></div>
                  <div className="is-total"><span>Invoice total</span><strong>{total != null ? formatINR(total) : "—"}</strong></div>
                  {projectLeft != null && (
                    <div className={base > projectLeft ? "is-over" : ""}><span>Left on the {formatINR(contract)} contract</span><strong>{formatINR(projectLeft)}</strong></div>
                  )}
                </div>
              </Card.Body>
            </Card>
          )}

          <Card>
            <Card.Header title="Invoice Details" />
            <Card.Body className="inv-form-body">
              <div className="pp-fee-line-inputs">
                <div className="field">
                  <label className="field-label">Invoice number <span className="required">*</span></label>
                  <input className="input" value={form.invoice_number} onChange={(e) => set("invoice_number", e.target.value)} disabled={off} placeholder="e.g. AFC/HO/2026-27/041" />
                </div>
                <div className="field">
                  <label className="field-label">Invoice date <span className="required">*</span></label>
                  <DatePickerCalendar value={form.invoice_date} onChange={(v) => set("invoice_date", v)} />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Subject</label>
                <input className="input" value={form.subject} onChange={(e) => set("subject", e.target.value)} disabled={off} placeholder={`Submission of ${nth} Invoice towards ${title}`} />
                <span className="field-hint">Printed as “Sub:” — leave blank for the default shown.</span>
              </div>
            </Card.Body>
          </Card>

          <Card>
            <Card.Header title="Client Details" subtitle="Saved to the project, so the next invoice starts filled in." />
            <Card.Body className="inv-form-body">
              <div className="field">
                <label className="field-label">Client name &amp; address</label>
                <textarea className="input" rows={4} value={form.client_address} onChange={(e) => set("client_address", e.target.value)} disabled={off} placeholder={"The Secretary\nClient department\nAddress line\nCity - PIN"} />
                <span className="field-hint">One line per row, as it should print.</span>
              </div>
              <div className="pp-fee-line-inputs">
                <div className="field">
                  <label className="field-label">Client GSTIN</label>
                  <input className="input" value={form.client_gstin} maxLength={15} onChange={(e) => { const v = e.target.value; set("client_gstin", v); if (!invoiceId) set("gst_type", gstTypeForGstin(v)); }} disabled={off} placeholder="e.g. 19AAAJT2422P1ZO" />
                </div>
                <div className="field">
                  <label className="field-label">Agreement reference</label>
                  <input className="input" value={form.contract_ref} onChange={(e) => set("contract_ref", e.target.value)} disabled={off} placeholder="Contract agreement no … dated …" />
                </div>
              </div>
              <div className="field">
                <label className="field-label">Internal remarks <span className="field-hint">(not printed)</span></label>
                <textarea className="input" rows={2} value={form.remarks} onChange={(e) => set("remarks", e.target.value)} disabled={off} />
              </div>
            </Card.Body>
          </Card>

          <div className="lf-actions">
            <Button type="submit" variant="primary" loading={saving} disabled={!items.length}>{invoiceId ? "Save Changes" : "Submit for CFO Approval"}</Button>
            <Button type="button" variant="secondary" disabled={off} onClick={() => navigate(backTo)}>Cancel</Button>
          </div>
        </div>

        {/* ── Live preview, the same wording the PDF prints ── */}
        <div className="pp-fnp-preview-col">
          <div className="pp-fnp-preview-head">
            <div className="inv-preview-tabs" role="tablist" aria-label="Preview page">
              <button type="button" role="tab" aria-selected={page === 1} className={page === 1 ? "is-active" : ""} onClick={() => setPage(1)}>Covering letter</button>
              <button type="button" role="tab" aria-selected={page === 2} className={page === 2 ? "is-active" : ""} onClick={() => setPage(2)}>Tax invoice</button>
            </div>
            <span className="pp-fnp-live-tag"><span className="pp-fnp-live-dot" />Live</span>
          </div>

          <div className="pp-fnp-page inv-preview">
            <div className="inv-pv-lh">
              <img src={logo} alt="" />
              <div>
                <div className="inv-pv-lh-name">AFC&nbsp; INDIA&nbsp; LIMITED</div>
                <div className="inv-pv-lh-sub">(A Union Government Company)</div>
                <div className="inv-pv-lh-sub">Wholly Owned by NABARD, Commercial Banks &amp; Exim Bank</div>
                <div className="inv-pv-lh-tag">Premier Development Institutions Committed to Rural Prosperity</div>
              </div>
            </div>

            {page === 1 ? (
              <>
                {cfoName && <p className="inv-pv-b inv-pv-tight">{cfoName}</p>}
                <p className="inv-pv-b">CHIEF FINANCIAL OFFICER</p>
                <p className="inv-pv-refline"><span>{form.invoice_number || <em className="pp-fnp-placeholder">Invoice no.</em>}</span><span>{formatDDMMYYYY(form.invoice_date)}</span></p>
                <p className="inv-pv-address">{addressLines.length ? addressLines.map((l, i) => <span key={i}>{l}<br /></span>) : <em className="pp-fnp-placeholder">Client address</em>}</p>
                <p>Dear Sir,</p>
                <p className="pp-fnp-body inv-pv-b">Sub: {subject}</p>
                {form.contract_ref && <p className="pp-fnp-body"><strong>Ref:</strong> {form.contract_ref}</p>}
                <p className="pp-fnp-body">We sincerely thank you for giving us an opportunity to undertake the captioned assignment.</p>
                <p className="pp-fnp-body">
                  We enclose herewith an invoice for <strong>{total != null ? rs(total) : "Rs. …/-"} (Rupees {words} Only inclusive of GST)</strong> being the {nth} invoice
                  of the captioned assignment which has fallen due on {lineItems.length ? dueOnPhrase(lineItems) : <em className="pp-fnp-placeholder">— pick what it&rsquo;s raised against —</em>}.
                </p>
                <p className="pp-fnp-body">We shall be grateful, if you could kindly arrange to release the same at the earliest.</p>
                <p className="pp-fnp-thanks">Thanking you,<br />Yours faithfully,</p>
                <p className="inv-pv-sign"><strong>Chief Financial Officer</strong><br />Encl: as above</p>
              </>
            ) : (
              <>
                <p className="inv-pv-title">TAX&nbsp; INVOICE</p>
                <p className="pp-fnp-body"><strong>Name of Client-</strong> {addressLines.join(", ") || <em className="pp-fnp-placeholder">Client address</em>}</p>
                <p><strong>GST IN No.</strong> {form.client_gstin.toUpperCase() || <em className="pp-fnp-placeholder">Client GSTIN</em>}</p>
                <p className="pp-fnp-body"><strong>Sub:</strong> {subject}</p>
                {form.contract_ref && <p className="pp-fnp-body"><strong>Ref:</strong> {form.contract_ref}</p>}
                <table className="inv-pv-table">
                  <tbody>
                    <tr><th>Invoice No.</th><td>{form.invoice_number || "—"}</td><th>Invoice Date</th><td>{formatDDMMYYYY(form.invoice_date)}</td></tr>
                  </tbody>
                </table>
                <table className="inv-pv-table">
                  <thead><tr><th className="inv-pv-sno">S.No.</th><th>Particulars</th><th className="inv-pv-amt">Amount (Rs.)</th></tr></thead>
                  <tbody>
                    {lineItems.length === 0 ? (
                      <tr><td /><td><em className="pp-fnp-placeholder">Pick the milestone / deliverables on the left.</em></td><td /></tr>
                    ) : lineItems.map((it, i) => {
                      const a = num(amountOf(it));
                      const label = `${it.kind === "milestone" ? "Milestone" : "Deliverable"}: ${it.title}`;
                      return (
                        <tr key={it.id}>
                          <td className="inv-pv-sno">{i + 1}.</td>
                          <td>{lineItems.length === 1 ? `${preamble} which has fallen due on ${dueOnPhrase(lineItems)}.` : i === 0 ? <>{preamble}, for the following:<br />{label}</> : label}</td>
                          <td className="inv-pv-amt">{a ? rs(a) : "—"}</td>
                        </tr>
                      );
                    })}
                    {form.gst_type === "cgst_sgst" ? (
                      <>
                        <tr><td className="inv-pv-sno">{lineItems.length + 1}.</td><td>CGST@{rate / 2}%</td><td className="inv-pv-amt">{halfGst != null ? rs(halfGst) : "—"}</td></tr>
                        <tr><td className="inv-pv-sno">{lineItems.length + 2}.</td><td>SGST@{rate / 2}%</td><td className="inv-pv-amt">{gst != null ? rs(roundMoney(gst - halfGst)) : "—"}</td></tr>
                      </>
                    ) : (
                      <tr><td className="inv-pv-sno">{lineItems.length + 1}.</td><td>IGST@{rate}%</td><td className="inv-pv-amt">{gst != null ? rs(gst) : "—"}</td></tr>
                    )}
                    <tr className="inv-pv-total"><td /><td>Total (Rupees {words} Only inclusive of GST)</td><td className="inv-pv-amt">{total != null ? rs(total) : "—"}</td></tr>
                  </tbody>
                </table>
                <dl className="inv-pv-facts">
                  {AFC_TAX_DETAILS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>: {v}</dd></div>)}
                </dl>
                <p className="inv-pv-small">RTGS details are given below. The amount may be credited through ECS please.</p>
                <table className="inv-pv-table inv-pv-kv"><tbody>{AFC_ACCOUNT_HOLDER.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
                <p className="inv-pv-b inv-pv-small">BANK ACCOUNT DETAILS</p>
                <table className="inv-pv-table inv-pv-kv"><tbody>{AFC_BANK.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
                <dl className="inv-pv-facts inv-pv-signblock">
                  <div><dt>Signature</dt><dd>:</dd></div>
                  <div><dt>Name</dt><dd>: {cfoName || "—"}</dd></div>
                  <div><dt>Designation</dt><dd>: CHIEF FINANCIAL OFFICER</dd></div>
                  <div><dt>Dated</dt><dd>: {formatDDMMYYYY(form.invoice_date)}</dd></div>
                </dl>
                <p className="inv-pv-small"><strong>Note:</strong> “In case no reply is received within 7 days of submission the invoice shall be treated as accepted.”</p>
              </>
            )}
          </div>
        </div>
      </form>
    </>
  );
}
