// supabase/functions/_shared/paymentNotePdf.ts
// The Project Payment Requisition Note that goes to Accounts with the
// Business Partner's invoice, so they release the BP's payment — AFC's
// format ("Payment Note.docx" at the repo root):
//
//   PART A (Project Coordinator) — project, client, fee, revenue share, BP,
//          amount due to the BP, advance / EMD / BG notes, the BP's invoice,
//          the recommendation, any observation; Prepared / Recommended by.
//   PART B (Accounts) — every instalment so far: fee received from the
//          client and payment made to the BP (date / basic / GST / total),
//          and the payment recommended now; then the Accounts check, CFO
//          recommendation and MD approval boxes (signed on the printout).
//
// Everything in Part B is filled from the recorded invoices and payments.

import {
  PageEngine, plain, bold, newPdfDoc, formatDateDDMMYYYY,
  drawSimpleHeader, drawSimpleFooter,
  sdLine, sdPara, sdGap, sd, drawGridTable, drawKeyValueTable,
} from "./letterPdf.ts";
import { formatRupees, fetchLogoBytes } from "./feeNotePdf.ts";
import { parseDate, rs, deepSafe } from "./clientInvoicePdf.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

const money = (n: number | null | undefined) => (n == null ? "" : formatRupees(Math.round(Number(n) * 100) / 100));
const dmy = (d: string | null | undefined) => { const x = parseDate(d); return x ? formatDateDDMMYYYY(x) : ""; };

function durationText(start: string | null, end: string | null): string {
  const s = parseDate(start), e = parseDate(end);
  if (!s && !e) return "—";
  if (s && e) {
    const months = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
    const span = months >= 12 && months % 12 === 0 ? `${months / 12} Year${months === 12 ? "" : "s"}` : `${months} Month${months === 1 ? "" : "s"}`;
    return `${span} (${dmy(start)} to ${dmy(end)})`;
  }
  return s ? `From ${dmy(start)}` : `Till ${dmy(end)}`;
}

export async function buildPaymentNotePdf(
  admin: AdminClient,
  noteId: string,
): Promise<{ ok: true; pdfBytes: Uint8Array; projectId: string } | { ok: false; error: string }> {
  const { data: noteRow } = await admin.from("bp_payment_notes").select("*").eq("id", noteId).maybeSingle();
  if (!noteRow) return { ok: false, error: "Payment note not found." };
  const note = deepSafe(noteRow);

  const [{ data: projectRow }, { data: bpRow }, { data: invoiceRows }, { data: bpRows }, { data: preparerRow }, logoBytes] = await Promise.all([
    admin.from("monitoring_projects")
      .select("*, lead:lead_id(title, client_name, lead_number, team, ba:assigned_ba_id(full_name), ra:recommending_authority_id(full_name), pr:person_responsible_id(full_name))")
      .eq("id", note.project_id).maybeSingle(),
    admin.from("bp_invoices").select("*").eq("id", note.bp_invoice_id).maybeSingle(),
    admin.from("client_invoices").select("*").eq("project_id", note.project_id).order("installment_no"),
    admin.from("bp_invoices").select("*").eq("project_id", note.project_id),
    note.prepared_by ? admin.from("afc_users").select("full_name").eq("id", note.prepared_by).maybeSingle() : Promise.resolve({ data: null }),
    fetchLogoBytes(),
  ]);
  if (!projectRow || !bpRow) return { ok: false, error: "Project or BP invoice not found." };
  const [project, bp, invoices, bpInvoices, preparer] = deepSafe([projectRow, bpRow, invoiceRows || [], bpRows || [], preparerRow]);
  if (!logoBytes) return { ok: false, error: "Could not load the AFC letterhead logo. Please try again." };
  const invoiceIds = (invoices || []).map((i: { id: string }) => i.id);
  const { data: lineRows } = invoiceIds.length
    ? await admin.from("client_invoice_lines").select("invoice_id, position, item:item_id(title)").in("invoice_id", invoiceIds).order("position")
    : { data: [] };
  const lines = deepSafe(lineRows || []);

  const lead = project.lead || {};
  const bpName: string = lead.ba?.full_name || "the Business Partner";
  const team: string = lead.team || "BPDD";
  const contract = project.contract_value != null ? Number(project.contract_value) : null;
  const share = project.bp_share_pct != null ? Number(project.bp_share_pct) : null;
  const bpBasic = Number(bp.amount) - Number(bp.gst_amount || 0);

  const { pdf, fonts } = await newPdfDoc();
  const e = new PageEngine(pdf, fonts, logoBytes, { drawHeader: drawSimpleHeader, drawFooter: drawSimpleFooter, contentTop: 735, footerSafe: 70 });
  e.LEFT = 40; e.RIGHT_EDGE = 555; e.MAX_W = e.RIGHT_EDGE - e.LEFT;
  await e.newPage();

  await sd(e, () => { e.drawTextRight(`Date: ${dmy(note.note_date)}`, 9.5, true); e.gap(16); });
  await sd(e, () => {
    const t = "PROJECT PAYMENT REQUISITION NOTE";
    const w = fonts.bold.widthOfTextAtSize(t, 12);
    e.currentPage.drawText(t, { x: (e.W - w) / 2, y: e.y, size: 12, font: fonts.bold });
    e.y -= 18;
  });
  await sdLine(e, `PART -A (To be filled by Project Coordinator/${team})`, 9.5, true);
  await sdGap(e, 2);

  const ownInvoice = (invoices || []).find((i: { id: string }) => i.id === bp.client_invoice_id);
  await drawKeyValueTable(e, [
    { label: "Project Name:", value: lead.title || "—" },
    { label: "Client:", value: (project.client_address || lead.client_name || "—").replace(/\n+/g, ", ") },
    { label: "Project Code:", value: lead.lead_number || "—" },
    { label: "Duration", value: durationText(project.start_date, project.end_date) },
    { label: "Consultancy Fee (Rs):", value: contract != null ? `${rs(contract)} (exclusive of GST)` : "—" },
    { label: "Revenue Sharing %:", value: share != null ? `${formatRupees(share)}% (${bpName}) + ${formatRupees(100 - share)}% (AFC)` : "—" },
    { label: "Name of Business Partner:", value: `M/s ${bpName}` },
    { label: "Amount to be paid to B.P.:", value: contract != null && share != null ? `${rs(Math.round(contract * share) / 100)} (exclusive of GST)` : "—" },
    { label: "Advance given, If any (Rs):", value: project.advance_details || "N/A" },
    { label: "Physical Status of work:", value: note.physical_status || "—" },
    { label: "EMD Details:", value: project.emd_details || "N/A" },
    { label: "Bank Guarantee/Indemnity Bond Details:", value: project.bg_details || "N/A" },
    { label: "Completion Certificate: Applicable for payment", value: note.completion_certificate || "N/A" },
    { label: "Project Profile:", value: note.project_profile || "N/A" },
    {
      label: `M/s ${bpName} (BP) has submitted its invoice No.`,
      value: `${bp.invoice_number || "—"} dated ${dmy(bp.invoice_date)} for ${rs(Number(bp.amount))} (Basic: ${rs(bpBasic)} + GST: ${rs(Number(bp.gst_amount || 0))})` +
        (ownInvoice ? `, against client invoice ${ownInvoice.invoice_number} (received ${rs(Number(ownInvoice.payment_amount || 0))} on ${dmy(ownInvoice.payment_received_on)}).` : "."),
    },
    { label: "Recommendation/note by Project Coordinator", value: note.recommendation },
    { label: "Any Specific Observation/Comment:", value: note.observation || "—" },
  ], { labelWidth: 190, fontSize: 8.5, lineH: 10.5, padY: 3 });
  await sdGap(e, 18);

  if (e.y - 40 < e.FOOTER_SAFE) await e.newPage();
  await sd(e, () => {
    e.drawTextAt(`Prepared By : ${preparer?.full_name || "—"}`, e.LEFT, 9, true);
    const rec = `Recommended by Project Coordinator/${team}`;
    e.drawTextAt(rec, e.RIGHT_EDGE - fonts.bold.widthOfTextAtSize(rec, 9), 9, true);
    e.gap(12);
    const name = lead.ra?.full_name || "";
    if (name) e.drawTextAt(name, e.RIGHT_EDGE - fonts.reg.widthOfTextAtSize(name, 9), 9, false);
    e.gap(16);
  });

  // ── PART B ──
  await sdLine(e, "PART -B (To be filled by Accounts)", 9.5, true);
  await sdGap(e, 2);
  const bpByClient = Object.fromEntries((bpInvoices || []).map((b: { client_invoice_id: string }) => [b.client_invoice_id, b]));
  const titlesByInvoice: Record<string, string[]> = {};
  for (const l of lines || []) (titlesByInvoice[l.invoice_id] ||= []).push(l.item?.title || "");
  const tot = { fb: 0, fg: 0, ft: 0, pb: 0, pg: 0, pt: 0, now: 0 };
  const rows: string[][] = [];
  for (const inv of invoices || []) {
    const b = bpByClient[inv.id];
    const isNow = b && b.id === bp.id;
    const received = inv.status === "paid";
    const paid = b?.status === "paid";
    if (!received && !isNow) continue;
    const pGst = paid ? Number(b.gst_amount || 0) : 0;
    const pTotal = paid ? Number(b.paid_amount) : 0;
    if (received) { tot.fb += Number(inv.amount); tot.fg += Number(inv.gst_amount); tot.ft += Number(inv.payment_amount); }
    if (paid) { tot.pb += pTotal - pGst; tot.pg += pGst; tot.pt += pTotal; }
    if (isNow) tot.now += Number(b.amount);
    rows.push([
      String(inv.installment_no || ""),
      (titlesByInvoice[inv.id] || []).join(", ") || "—",
      received ? dmy(inv.payment_received_on) : "", received ? money(inv.amount) : "", received ? money(inv.gst_amount) : "", received ? money(inv.payment_amount) : "",
      paid ? dmy(b.paid_on) : "", paid ? money(pTotal - pGst) : "", paid ? money(pGst) : "", paid ? money(pTotal) : "",
      isNow ? money(b.amount) : "",
    ]);
  }
  rows.push(["", "Total", "", money(tot.fb), money(tot.fg), money(tot.ft), "", money(tot.pb), money(tot.pg), money(tot.pt), money(tot.now)]);
  await drawGridTable(e, [
    { header: "Inst. No.", width: 6 }, { header: "Deliverable", width: 15 },
    { header: "Fee received: Date of Receipt", width: 9 }, { header: "Basic", width: 9 }, { header: "GST", width: 8 }, { header: "Total", width: 9 },
    { header: "Paid to B.P.: Date of Payment", width: 9 }, { header: "Basic", width: 9 }, { header: "GST", width: 8 }, { header: "Total", width: 9 },
    { header: "Payment Recommended Now (Rs)", width: 10 },
  ], rows, { fontSize: 7, lineH: 9, padX: 3, padY: 3 });
  await sdGap(e, 14);

  if (e.y - 70 < e.FOOTER_SAFE) await e.newPage();
  await drawGridTable(e, [
    { header: "Checked By (Accounts)", width: 25 }, { header: "Checked By (Accounts)", width: 25 },
    { header: "Recommended for Making Payment", width: 25 }, { header: "Approved for Payment", width: 25 },
  ], [["\n\n", "\n\n", "\n\nBY : Chief Financial Officer", "\n\nApproved By : Managing Director"]], { fontSize: 8, lineH: 9 });
  await sdGap(e, 16);
  await sdPara(e, [plain("Enclosed: "), bold(`Tax invoice ${bp.invoice_number || ""} of M/s ${bpName}.`)], 8.5);

  const pdfBytes = await pdf.save();
  return { ok: true, pdfBytes, projectId: note.project_id };
}
