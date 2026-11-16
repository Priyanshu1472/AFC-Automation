// supabase/functions/_shared/pbgNotePdf.ts
// The PBG Note — raised by the lead's team once an awarded proposal's EMD
// is being converted into the Performance Bank Guarantee, and forwarded to
// Accounts. States the EMD already deposited, the PBG the client requires,
// and the remaining PBG (PBG - EMD) still to be furnished, then leaves the
// Accounts boxes to be signed on the printout.

import {
  PageEngine, plain, bold, newPdfDoc, formatDateDDMMYYYY,
  drawSimpleHeader, drawSimpleFooter,
  sdPara, sdGap, sd, drawKeyValueTable, drawGridTable,
} from "./letterPdf.ts";
import { formatRupees, fetchLogoBytes, amountToIndianWords } from "./feeNotePdf.ts";
import { deepSafe } from "./clientInvoicePdf.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

const PAYMENT_MODE_LABELS: Record<string, string> = {
  online: "Online",
  bank_guarantee: "Bank Guarantee",
  demand_draft: "Demand Draft",
  bankers_cheque: "Banker's Cheque",
  fixed_deposit_receipt: "Fixed Deposit Receipt",
};

const rs = (n: number) => `Rs. ${formatRupees(Math.round(n * 100) / 100)}/-`;

export async function buildPbgNotePdf(
  admin: AdminClient,
  proposalId: string,
): Promise<{ ok: true; pdfBytes: Uint8Array } | { ok: false; error: string }> {
  const { data: trackingRow } = await admin.from("proposal_emd_tracking").select("*").eq("proposal_id", proposalId).maybeSingle();
  if (!trackingRow || trackingRow.track !== "pbg") return { ok: false, error: "This proposal has no PBG entry." };
  if (!(Number(trackingRow.pbg_amount) > 0)) return { ok: false, error: "Enter the PBG amount first." };

  const [{ data: proposalRow }, { data: noteRow }, logoBytes] = await Promise.all([
    admin.from("proposal_preparations")
      .select("id, client_response_at, proposed_value, lead:lead_id(title, lead_number, client_name, bid_number, team, pr:person_responsible_id(full_name), ra:recommending_authority_id(full_name), ba:assigned_ba_id(full_name))")
      .eq("id", proposalId).maybeSingle(),
    admin.from("fee_notes").select("emd_amount, emd_payment_mode, emd_borne_by, payment_done_at, payment_reference").eq("proposal_id", proposalId).eq("status", "approved").maybeSingle(),
    fetchLogoBytes(),
  ]);
  if (!proposalRow) return { ok: false, error: "Proposal not found." };
  if (!logoBytes) return { ok: false, error: "Could not load the AFC letterhead logo. Please try again." };

  const preparerId = trackingRow.forwarded_by || trackingRow.created_by;
  const { data: preparerRow } = preparerId
    ? await admin.from("afc_users").select("full_name").eq("id", preparerId).maybeSingle()
    : { data: null };

  const [tracking, proposal, note, preparer] = deepSafe([trackingRow, proposalRow, noteRow || {}, preparerRow]);
  const lead = proposal.lead || {};
  const emd = Number(tracking.emd_amount);
  const pbg = Number(tracking.pbg_amount);
  const remaining = pbg - emd;
  const team: string = lead.team || "BPDD";

  const { pdf, fonts } = await newPdfDoc();
  const e = new PageEngine(pdf, fonts, logoBytes, { drawHeader: drawSimpleHeader, drawFooter: drawSimpleFooter, contentTop: 735, footerSafe: 70 });
  e.LEFT = 40; e.RIGHT_EDGE = 555; e.MAX_W = e.RIGHT_EDGE - e.LEFT;
  await e.newPage();

  const dated = tracking.forwarded_at ? new Date(tracking.forwarded_at) : new Date();
  await sd(e, () => { e.drawTextRight(`Date: ${formatDateDDMMYYYY(dated)}`, 9.5, true); e.gap(16); });
  await sd(e, () => {
    const t = "PBG NOTE — CONVERSION OF EMD INTO PERFORMANCE BANK GUARANTEE";
    const w = fonts.bold.widthOfTextAtSize(t, 12);
    e.currentPage.drawText(t, { x: (e.W - w) / 2, y: e.y, size: 12, font: fonts.bold });
    e.y -= 20;
  });

  await sdPara(e, [
    plain("The proposal for "), bold(lead.title || "—"), plain(` (${lead.lead_number || "—"}) has been `), bold("awarded"),
    plain(" by the client. The EMD deposited against this bid is to be adjusted towards the Performance Bank Guarantee (PBG), and the remaining PBG amount is to be furnished as detailed below."),
  ], 9.5, 0, true);
  await sdGap(e, 10);

  const emdMode = note.emd_payment_mode ? PAYMENT_MODE_LABELS[note.emd_payment_mode] || note.emd_payment_mode : "—";
  await drawKeyValueTable(e, [
    { label: "Project Name", value: lead.title || "—" },
    { label: "Project Code", value: lead.lead_number || "—" },
    { label: "Client", value: lead.client_name || "—" },
    { label: "Tender / Reference No.", value: lead.bid_number || "—" },
    { label: "Business Partner", value: lead.ba?.full_name || "—" },
    { label: "Proposed Value", value: proposal.proposed_value != null ? rs(Number(proposal.proposed_value)) : "—" },
    { label: "EMD deposited", value: `${rs(emd)} (${emdMode}${note.payment_reference ? `, Ref: ${note.payment_reference}` : ""})` },
    { label: "PBG required", value: rs(pbg) },
    { label: "EMD adjusted towards PBG", value: rs(Math.min(emd, pbg)) },
    {
      label: remaining >= 0 ? "Remaining PBG to be furnished (PBG - EMD)" : "Excess EMD to be refunded (EMD - PBG)",
      value: `${rs(Math.abs(remaining))} (Rupees ${amountToIndianWords(Math.abs(remaining))} only)`,
    },
    { label: "Remarks", value: tracking.remarks || "—" },
  ], { labelWidth: 200, fontSize: 9, lineH: 11.5, padY: 4 });
  await sdGap(e, 26);

  if (e.y - 40 < e.FOOTER_SAFE) await e.newPage();
  await sd(e, () => {
    e.drawTextAt(`Prepared By : ${preparer?.full_name || lead.pr?.full_name || "—"}`, e.LEFT, 9, true);
    const rec = `Recommending Authority/${team}`;
    e.drawTextAt(rec, e.RIGHT_EDGE - fonts.bold.widthOfTextAtSize(rec, 9), 9, true);
    e.gap(12);
    const name = lead.ra?.full_name || "";
    if (name) e.drawTextAt(name, e.RIGHT_EDGE - fonts.reg.widthOfTextAtSize(name, 9), 9, false);
    e.gap(24);
  });

  if (e.y - 70 < e.FOOTER_SAFE) await e.newPage();
  await drawGridTable(e, [
    { header: "Checked By (Accounts)", width: 34 },
    { header: "Checked By (Accounts)", width: 33 },
    { header: "Processed By (Accounts)", width: 33 },
  ], [["\n\n", "\n\n", "\n\n"]], { fontSize: 8, lineH: 9 });

  const pdfBytes = await pdf.save();
  return { ok: true, pdfBytes };
}
