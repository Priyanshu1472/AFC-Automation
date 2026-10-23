// Shared constants/helpers for the Monitoring and Financials modules (and
// the small bits of the Proposal page that feed them).
import { supabase, extractFunctionErrorMessage } from "./supabase";

export const MONITORING_BUCKET = "monitoring-documents";

export const DOCUMENT_CATEGORIES = [
  { key: "mou_client", label: "MoU — Client" },
  { key: "mou_bp", label: "MoU — Business Partner" },
  { key: "work_order", label: "Work Order" },
  { key: "client_document", label: "Client Document / Proof" },
  { key: "deliverable", label: "Deliverable Attachment" },
  { key: "other", label: "Other" },
];
export const DOCUMENT_CATEGORY_LABELS = Object.fromEntries(DOCUMENT_CATEGORIES.map((c) => [c.key, c.label]));

export const PROJECT_STATUS_LABELS = { active: "Active", on_hold: "On Hold", completed: "Completed" };
export const PROJECT_STATUS_VARIANTS = { active: "success", on_hold: "warning", completed: "neutral" };

export const CLIENT_INVOICE_STATUS_LABELS = { pending_cfo: "Awaiting CFO Approval", rejected: "Sent Back by CFO", raised: "Awaiting Payment", paid: "Payment Received" };
export const CLIENT_INVOICE_STATUS_VARIANTS = { pending_cfo: "info", rejected: "danger", raised: "warning", paid: "success" };

export const BP_INVOICE_STATUS_LABELS = { requested: "Awaiting BP Invoice", received: "Payment Due to BP", paid: "Paid to BP" };
export const BP_INVOICE_STATUS_VARIANTS = { requested: "warning", received: "info", paid: "success" };

// How many days ahead an open item counts as "due soon" — keep in step
// with monitoring_sync_due_alerts() in the migration.
export const DUE_SOON_DAYS = 7;

export function formatINR(value, { decimals = true } = {}) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return "₹" + n.toLocaleString("en-IN", decimals ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
}

export function fmtDate(d) {
  if (!d) return "—";
  // Plain YYYY-MM-DD dates are calendar dates — parse as local, not UTC.
  const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function safeFileName(name) {
  return (name || "file").replace(/[^\w.-]+/g, "_").slice(-120);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Whole days from today to a YYYY-MM-DD date (negative = past).
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const today = new Date(`${todayISO()}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

// "overdue" | "due_soon" | "upcoming" | "no_date" | "completed"
export function itemTiming(item) {
  if (item.status === "completed") return "completed";
  const d = daysUntil(item.due_date);
  if (d === null) return "no_date";
  if (d < 0) return "overdue";
  if (d <= DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

export function dueLabel(item) {
  const d = daysUntil(item.due_date);
  if (d === null) return "No due date";
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

// Color-codes a milestone/deliverable by how much of its own window — from
// when it was added to its due date — has elapsed: green up to 50%,
// yellow from 50-70%, red from 70% onward (and anything overdue).
// Relative to the item's own timeline rather than a fixed day count, so a
// 6-month milestone and a 2-week deliverable each get their own 50/20/30
// split instead of sharing one absolute threshold.
export function itemUrgencyLevel(item) {
  if (item.status === "completed") return "done";
  if (!item.due_date || !item.created_at) return "none";
  const due = new Date(`${item.due_date}T00:00:00`);
  const created = new Date(item.created_at);
  const totalMs = due - created;
  if (totalMs <= 0) return daysUntil(item.due_date) < 0 ? "red" : "green";
  const today = new Date(`${todayISO()}T00:00:00`);
  const frac = (today - created) / totalMs;
  if (frac < 0.5) return "green";
  if (frac < 0.7) return "yellow";
  return "red";
}

// Client invoices are always loaded with their lines — one per milestone /
// deliverable billed (client_invoice_lines).
export const CLIENT_INVOICE_SELECT = "*, lines:client_invoice_lines(item_id, amount, description, position)";

export const invoiceLines = (inv) => [...(inv?.lines || [])].sort((a, b) => a.position - b.position);

// Σ invoiced against an item — for a milestone, also against its
// deliverables (mirrors monitoring_item_billed()).
export function itemBilled(item, invoices, items, excludeInvoiceId = null) {
  const family = new Set([item.id, ...(item.kind === "milestone" ? items.filter((i) => i.parent_id === item.id).map((i) => i.id) : [])]);
  let sum = 0;
  for (const inv of invoices || []) {
    if (inv.id === excludeInvoiceId) continue;
    for (const l of inv.lines || []) if (family.has(l.item_id)) sum += Number(l.amount || 0);
  }
  return Math.round(sum * 100) / 100;
}

// Has this item been billed? Directly, through its milestone, or — for a
// milestone — through every one of its deliverables.
export function isItemInvoiced(item, invoices, items) {
  const billedIds = new Set((invoices || []).flatMap((inv) => (inv.lines || []).map((l) => l.item_id)));
  if (billedIds.has(item.id)) return true;
  if (item.parent_id && billedIds.has(item.parent_id)) return true;
  if (item.kind === "milestone") {
    const kids = items.filter((i) => i.parent_id === item.id);
    return kids.length > 0 && kids.every((k) => billedIds.has(k.id));
  }
  return false;
}

// A billable item that's done but not invoiced yet.
export function needsInvoice(item, invoices, items) {
  return item.status === "completed" && item.invoice_on_completion && !isItemInvoiced(item, invoices, items);
}

// item.id -> "Deliverable N" sequence, across the whole project in the
// order they were added — not reset per milestone, so a deliverable keeps
// its number whether it's loose or under a milestone.
export function deliverableNumbers(items) {
  const deliverables = items.filter((i) => i.kind === "deliverable").sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return Object.fromEntries(deliverables.map((d, i) => [d.id, i + 1]));
}

// Opens a generated PDF (monitoring-pdf edge function) in a new tab.
export async function openMonitoringPdf(kind, id) {
  const { data, error } = await supabase.functions.invoke("monitoring-pdf", { body: { kind, id } });
  if (error) throw new Error(await extractFunctionErrorMessage(error, "Could not open the document."));
  if (!data?.success || !data?.pdf_base64) throw new Error(data?.error || "Could not open the document.");
  const bytes = Uint8Array.from(atob(data.pdf_base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// AFC's GSTIN is a Delhi one (07…): a Delhi client is billed CGST + SGST,
// everyone else IGST.
export const AFC_GST_STATE = "07";
export function gstTypeForGstin(gstin) {
  return (gstin || "").trim().slice(0, 2) === AFC_GST_STATE ? "cgst_sgst" : "igst";
}
export const GST_RATES = [18, 12, 5, 28, 0];

export const PAYMENT_NOTE_STATUS_LABELS = { draft: "Payment note drafted", sent: "Sent to Accounts" };

export async function openMonitoringFile(path) {
  const { data, error } = await supabase.storage.from(MONITORING_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Failed to open the file.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

export async function uploadMonitoringFile(path, file) {
  const { error } = await supabase.storage.from(MONITORING_BUCKET).upload(path, file);
  if (error) throw new Error(`Failed to upload ${file.name}: ${error.message}`);
  return { file_name: file.name, file_size: file.size, file_path: path };
}

// Due-date alerts are generated lazily (idempotent) whenever someone opens
// Home or Monitoring — see monitoring_sync_due_alerts(). Failure is
// non-fatal: the pages compute the same states live anyway.
export function syncDueAlerts() {
  return supabase.rpc("monitoring_sync_due_alerts").then(() => {}, () => {});
}

export const PROJECT_SELECT =
  "*, lead:lead_id(id, title, lead_number, client_name, team, assigned_ba_id, person_responsible_id, reviewer_id, recommending_authority_id, " +
  "pr:person_responsible_id(full_name), rev:reviewer_id(full_name), aa:recommending_authority_id(full_name), ba:assigned_ba_id(full_name)), " +
  "proposal:proposal_id(id, proposed_value, client_response_at)";

// Mirrors can_edit_monitoring_project(): md/admin, or the lead's Person
// Responsible / Reviewer / Recommending Authority.
export function canEditProject(project, profile) {
  if (!project?.lead || !profile) return false;
  if (["md", "admin"].includes(profile.role)) return true;
  const l = project.lead;
  return [l.person_responsible_id, l.reviewer_id, l.recommending_authority_id].includes(profile.id);
}

// Builds InvoiceList entries for a set of client invoices.
// paymentNotes: bp_payment_notes rows (keyed onto their BP invoice).
export function buildInvoiceEntries({ invoices, bpInvoices, paymentNotes = [], projectsById, itemsById = {}, profile }) {
  const bpByInvoice = Object.fromEntries((bpInvoices || []).map((b) => [b.client_invoice_id, b]));
  const noteByBp = Object.fromEntries((paymentNotes || []).map((n) => [n.bp_invoice_id, n]));
  return (invoices || []).map((inv) => {
    const p = projectsById[inv.project_id];
    const bp = bpByInvoice[inv.id] || null;
    const titles = invoiceLines(inv).map((l) => itemsById[l.item_id]?.title).filter(Boolean);
    if (!titles.length && inv.item_id && itemsById[inv.item_id]) titles.push(itemsById[inv.item_id].title);
    return {
      invoice: inv,
      bpInvoice: bp,
      paymentNote: bp ? noteByBp[bp.id] || null : null,
      itemTitle: titles.join(", ") || null,
      project: {
        id: inv.project_id,
        title: p?.lead?.title || "Project",
        hasBp: !!p?.lead?.assigned_ba_id,
        bpName: p?.lead?.ba?.full_name || null,
        canEdit: canEditProject(p, profile),
        // Accounts (CFO) releases the BP's payment once the note reaches them.
        canPayBp: canEditProject(p, profile) || profile?.role === "cfo",
      },
    };
  });
}

// ── Money ───────────────────────────────────────────────────────────────
// Keep in step with the *_amount_guard() triggers: contract value and item
// amounts are compared against invoice amounts before GST.
export const GST_MAX_RATE = 0.28;

const n2 = (v) => Number(v || 0);
export const roundMoney = (v) => Math.round(n2(v) * 100) / 100;

// Client-invoice totals. "Outstanding" is everything invoiced and not yet
// received — unpaid invoices plus any short payment (TDS etc.) on paid ones.
export function invoiceTotals(invoices) {
  const t = { invoiced: 0, invoicedBase: 0, gst: 0, received: 0, outstanding: 0, unpaid: 0, unpaidAmount: 0, shortPaid: 0, shortAmount: 0 };
  for (const inv of invoices || []) {
    const total = n2(inv.total_amount);
    t.invoiced += total;
    t.invoicedBase += n2(inv.amount);
    t.gst += n2(inv.gst_amount);
    if (inv.status === "paid") {
      const got = n2(inv.payment_amount);
      t.received += got;
      if (total - got > 0.004) { t.shortPaid += 1; t.shortAmount += total - got; }
    } else {
      t.unpaid += 1;
      t.unpaidAmount += total;
    }
  }
  t.outstanding = t.unpaidAmount + t.shortAmount;
  for (const k of Object.keys(t)) t[k] = roundMoney(t[k]);
  return t;
}

// Everything the Raise / Edit Invoice dialog needs about one project.
export async function fetchInvoiceContext(projectId) {
  const [p, it, inv] = await Promise.all([
    supabase.from("monitoring_projects").select(PROJECT_SELECT).eq("id", projectId).maybeSingle(),
    supabase.from("monitoring_items").select("*").eq("project_id", projectId),
    supabase.from("client_invoices").select(CLIENT_INVOICE_SELECT).eq("project_id", projectId),
  ]);
  return { project: p.data || null, items: it.data || [], invoices: inv.data || [] };
}

// Contract value + every item and invoice line on a project — what the
// milestone / deliverable dialog needs to show "₹X unallocated".
export async function fetchProjectMoney(projectId) {
  const ctx = await fetchInvoiceContext(projectId);
  return { contractValue: ctx.project?.contract_value ?? null, items: ctx.items, invoices: ctx.invoices };
}

// Mirrors monitoring_project_allocated(): each milestone's own amount (or
// its deliverables' sum when it has none) plus standalone deliverables.
export function allocatedAmount(items) {
  let sum = 0;
  for (const m of items.filter((i) => i.kind === "milestone")) {
    if (m.invoice_amount != null) sum += Number(m.invoice_amount);
    else sum += items.filter((c) => c.parent_id === m.id).reduce((s, c) => s + Number(c.invoice_amount || 0), 0);
  }
  sum += items.filter((d) => d.kind === "deliverable" && !d.parent_id).reduce((s, d) => s + Number(d.invoice_amount || 0), 0);
  return Math.round(sum * 100) / 100;
}
