// supabase/functions/_shared/clientInvoicePdf.ts
// AFC's client invoice, generated from the invoice's own data — the same
// two pages as AFC's Word format ("Invoice.docx" at the repo root):
//
//   Page 1 — covering letter on the full AFC letterhead from the CFO:
//            reference + date, the client's address, Sub / Ref, the
//            "We enclose herewith an invoice for Rs. …" paragraph.
//   Page 2 — TAX INVOICE: client + GSTIN, invoice no./date, the
//            particulars (one row per milestone / deliverable billed), GST
//            (IGST, or CGST + SGST for a Delhi GSTIN), total in words, AFC's
//            PAN / GST / HSN / MSME, the RTGS bank details, signature block.
//
// Once the CFO has approved the invoice (decide-client-invoice), their
// uploaded signature is embedded on both the covering letter and the tax
// invoice's signature block — looked up live from cfo_decided_by, same
// pattern as the MD's signature on fee notes (feeNotePdf.ts). Before that
// (status still pending_cfo/rejected), the signature lines print blank, same
// as before this feature existed.

import {
  PageEngine, plain, bold, newPdfDoc, formatDateDDMMYYYY,
  sdLine, sdPara, sdGap, sd, drawGridTable, drawKeyValueTable,
  fetchSignatureBytes, embedImageAuto,
} from "./letterPdf.ts";
import { amountToIndianWords, formatRupees, fetchLogoBytes } from "./feeNotePdf.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

// AFC's own registration and bank details, exactly as on AFC's invoice format.
export const AFC_TAX_DETAILS = [
  ["Our PAN Number", "AAACA8315K"],
  ["GST Regn. No", "07AAACA8315K1ZP"],
  ["HSN Code", "998311"],
  ["MSME Registration", "UDYAM-MH-19-0025013"],
];
export const AFC_ACCOUNT_HOLDER = [
  { label: "NAME OF ACCOUNT HOLDER", value: "AFC INDIA LIMITED" },
  { label: "COMPLETE ADDRESS", value: "DHANRAJ MAHAL, 1st FLOOR, CSM MARG, MUMBAI-400001" },
  { label: "TELEPHONE/FAX NO.", value: "022-22028924, FAX No. 022-22028966" },
  { label: "E-mail Address", value: "afcindia.delhi@gmail.com; accounts@afcindia.org.in" },
];
export const AFC_BANK = [
  { label: "BANK NAME", value: "CENTRAL BANK OF INDIA" },
  { label: "BRANCH NAME AND COMPLETE ADDRESS", value: "MUMBAI MAIN BRANCH, MG ROAD, FORT, MUMBAI-400001" },
  { label: "WHETHER THE BANK IS COMPUTERIZED", value: "YES" },
  { label: "WHETHER THE BRANCH IS RTGS ENABLED", value: "YES" },
  { label: "TYPE OF ACCOUNT", value: "CASH CREDIT" },
  { label: "BANK ACCOUNT NO.", value: "1787433135" },
  { label: "9 DIGIT CODE NO. OF THE BANK", value: "400016071" },
  { label: "IFSC CODE", value: "CBIN0280621" },
];

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export const rs = (n: number) => {
  const v = Math.round(Number(n) * 100) / 100;
  const txt = Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Rs. ${txt}/-`;
};

// The standard PDF fonts only cover Latin-1 (WinAnsi): "₹" becomes "Rs."
// and anything else they can't draw (Devanagari, emoji…) is dropped, so a
// stray character in a title or note can never break the document.
const WINANSI_EXTRA = new Set("–—‘’‚“”„•…€™ŠšŽžŒœŸ†‡‰ˆ˜");
export function pdfSafe(text: string): string {
  return text
    .replace(/₹\s*/g, "Rs. ")
    .replace(/[\t\u00a0]/g, " ")
    .split("")
    .filter((ch) => ch === "\n" || (ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0xff) || WINANSI_EXTRA.has(ch))
    .join("");
}
// deno-lint-ignore no-explicit-any
export function deepSafe<T>(value: T): T {
  if (typeof value === "string") return pdfSafe(value) as unknown as T;
  if (Array.isArray(value)) return value.map(deepSafe) as unknown as T;
  if (value && typeof value === "object") {
    // deno-lint-ignore no-explicit-any
    const out: any = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepSafe(v);
    return out;
  }
  return value;
}

export function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);
}

type Line = { description: string | null; amount: number; item: { kind: string; title: string } | null };

function lineLabel(l: Line): string {
  const base = l.item ? `${l.item.kind === "milestone" ? "Milestone" : "Deliverable"}: ${l.item.title}` : "—";
  return l.description ? `${base} — ${l.description}` : base;
}

// "completion of Milestone “Inception Report”" / "submission of Deliverables “A” and “B”"
function dueOnPhrase(lines: Line[]): string {
  const titles = lines.map((l) => `“${l.item?.title ?? ""}”`);
  const joined = titles.length > 1 ? `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}` : titles[0];
  const allMilestones = lines.every((l) => l.item?.kind === "milestone");
  if (allMilestones) return `completion of ${lines.length > 1 ? "Milestones" : "Milestone"} ${joined}`;
  return `submission of ${lines.length > 1 ? "Deliverables" : "Deliverable"} ${joined}`;
}

export async function buildClientInvoicePdf(
  admin: AdminClient,
  invoiceId: string,
): Promise<{ ok: true; pdfBytes: Uint8Array; projectId: string; fileName: string } | { ok: false; error: string }> {
  const { data: invRow } = await admin.from("client_invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!invRow) return { ok: false, error: "Invoice not found." };
  const inv = deepSafe(invRow);

  const [{ data: projectRow }, { data: lineRows }, { data: cfoRow }, logoBytes] = await Promise.all([
    admin.from("monitoring_projects").select("*, lead:lead_id(title, client_name)").eq("id", inv.project_id).maybeSingle(),
    admin.from("client_invoice_lines").select("description, amount, position, item:item_id(kind, title)").eq("invoice_id", invoiceId).order("position"),
    inv.cfo_decided_by
      ? admin.from("afc_users").select("full_name, signature_path").eq("id", inv.cfo_decided_by).maybeSingle()
      : admin.from("afc_users").select("full_name, signature_path").eq("role", "cfo").eq("is_active", true).order("created_at").limit(1).maybeSingle(),
    fetchLogoBytes(),
  ]);
  if (!projectRow) return { ok: false, error: "Project not found." };
  const project = deepSafe(projectRow);
  const cfo = deepSafe(cfoRow);
  if (!logoBytes) return { ok: false, error: "Could not load the AFC letterhead logo. Please try again." };

  const cfoSigBytes = inv.cfo_decided_at ? await fetchSignatureBytes(admin, cfo?.signature_path) : null;

  const lines: Line[] = deepSafe(lineRows || []).map((l: { description: string | null; amount: number; item: { kind: string; title: string } | null }) => ({
    description: l.description, amount: Number(l.amount), item: l.item,
  }));
  const title: string = project.lead?.title || "the assignment";
  const amount = Number(inv.amount);
  const gst = Number(inv.gst_amount);
  const total = amount + gst;
  const contract = project.contract_value != null ? Number(project.contract_value) : null;
  const nth = ordinal(inv.installment_no || 1);
  const invDate = parseDate(inv.invoice_date) || new Date();
  const dateStr = formatDateDDMMYYYY(invDate);
  const subject = inv.subject || `Submission of ${nth} Invoice towards ${title}`;
  const addressLines = String(project.client_address || project.lead?.client_name || "").split("\n").map((s: string) => s.trim()).filter(Boolean);
  const cfoName = (cfo?.full_name || "").toUpperCase();
  const pct = contract ? (amount / contract) * 100 : null;
  const pctText = pct != null ? ` (${Number.isInteger(Math.round(pct * 100) / 100) ? Math.round(pct) : pct.toFixed(2)}%)` : "";
  const totalWords = amountToIndianWords(total).replace(/^Rupees /, "").replace(/ Only$/, "");
  const SIZE = 10.5;

  const { pdf, fonts } = await newPdfDoc();
  const e = new PageEngine(pdf, fonts, logoBytes, { footerSafe: 96 });
  const cfoImg = cfoSigBytes ? await embedImageAuto(pdf, cfoSigBytes).catch(() => null) : null;

  // ── Page 1: covering letter ──
  await e.newPage();
  if (cfoName) await sdLine(e, cfoName, SIZE, true);
  await sdLine(e, "CHIEF FINANCIAL OFFICER", SIZE, true);
  await sdGap(e, 10);
  await sd(e, () => { e.drawTextRight(dateStr, SIZE, false); e.drawTextLine(inv.invoice_number, SIZE, false); });
  await sdGap(e, 10);
  for (const l of addressLines.length ? addressLines : ["—"]) await sdLine(e, l, SIZE, false);
  await sdGap(e, 12);
  await sdLine(e, "Dear Sir,", SIZE, false);
  await sdGap(e, 6);
  await sdPara(e, [bold("Sub: "), bold(subject)], SIZE, 0, true);
  if (project.contract_ref) await sdPara(e, [bold("Ref: "), plain(project.contract_ref)], SIZE, 0, true);
  await sdGap(e, 8);
  await sdPara(e, [plain("We sincerely thank you for giving us an opportunity to undertake the captioned assignment.")], SIZE, 0, true);
  await sdGap(e, 6);
  await sdPara(e, [
    plain("We enclose herewith an invoice for "),
    bold(`${rs(total)} (Rupees ${totalWords} Only inclusive of GST)`),
    plain(` being the ${nth} invoice of the captioned assignment which has fallen due on ${lines.length ? dueOnPhrase(lines) : "the agreed milestone"}.`),
  ], SIZE, 0, true);
  await sdGap(e, 6);
  await sdPara(e, [plain("We shall be grateful, if you could kindly arrange to release the same at the earliest.")], SIZE, 0, true);
  await sdGap(e, 12);
  await sdLine(e, "Thanking you,", SIZE, false);
  await sdLine(e, "Yours faithfully,", SIZE, false);
  if (cfoImg) {
    if (e.y - 36 < e.FOOTER_SAFE) await e.newPage();
    const dims = cfoImg.scale(1);
    const scale = Math.min(140 / dims.width, 32 / dims.height, 1);
    const w = dims.width * scale, h = dims.height * scale;
    e.currentPage.drawImage(cfoImg, { x: e.LEFT, y: e.y - 36 + 4, width: w, height: h });
    e.gap(36);
  } else {
    await sdGap(e, 36);
  }
  await sdLine(e, "Chief Financial Officer", SIZE, true);
  await sdLine(e, "Encl: as above", SIZE, false);

  // ── Page 2: tax invoice ──
  await e.newPage();
  await sd(e, () => {
    const t = "TAX  INVOICE";
    const w = fonts.bold.widthOfTextAtSize(t, 13);
    e.currentPage.drawText(t, { x: (e.W - w) / 2, y: e.y, size: 13, font: fonts.bold });
    e.y -= 20;
  });
  await sdPara(e, [bold("Name of Client- "), plain(addressLines.join(", ") || "—")], SIZE);
  await sdPara(e, [bold("GST IN No.  "), plain(project.client_gstin || "—")], SIZE);
  await sdGap(e, 4);
  await sdPara(e, [bold("Sub: "), plain(subject)], SIZE, 0, true);
  if (project.contract_ref) await sdPara(e, [bold("Ref: "), plain(project.contract_ref)], SIZE, 0, true);
  await sdGap(e, 8);

  await drawGridTable(e, [
    { header: "Invoice No.", width: 18 }, { header: inv.invoice_number, width: 36 },
    { header: "Invoice Date", width: 18 }, { header: dateStr, width: 28 },
  ], [], { fontSize: 9.5, padY: 3 });
  await sdGap(e, 10);

  const preamble = `Being the ${nth} invoice${pctText} of the total project fee${contract != null ? ` of ${rs(contract)} (exclusive of GST)` : ""} towards ${title}`;
  const rows: string[][] = lines.length === 1
    ? [["1.", `${preamble} which has fallen due on ${dueOnPhrase(lines)}.${lines[0].description ? ` ${lines[0].description}` : ""}`, rs(lines[0].amount)]]
    : lines.map((l, i) => [`${i + 1}.`, i === 0 ? `${preamble}, for the following:\n${lineLabel(l)}` : lineLabel(l), rs(l.amount)]);
  let n = rows.length;
  const rate = Number(inv.gst_rate);
  if (gst > 0) {
    if (inv.gst_type === "cgst_sgst") {
      const half = Math.round((gst / 2) * 100) / 100;
      rows.push([`${++n}.`, `CGST@${rate / 2}%`, rs(half)]);
      rows.push([`${++n}.`, `SGST@${rate / 2}%`, rs(Math.round((gst - half) * 100) / 100)]);
    } else {
      rows.push([`${++n}.`, `IGST@${rate}%`, rs(gst)]);
    }
  }
  rows.push(["", `Total (Rupees ${totalWords} Only inclusive of GST)`, rs(total)]);
  await drawGridTable(e, [
    { header: "S.No.", width: 8 }, { header: "Particulars", width: 70 }, { header: "Amount (Rs.)", width: 22 },
  ], rows, { fontSize: 9.5, lineH: 11.5, padY: 3 });
  await sdGap(e, 16);

  for (const [label, value] of AFC_TAX_DETAILS) {
    await sd(e, () => { e.drawTextAt(`${label}`, e.LEFT, 9.5, true); e.drawTextAt(`:  ${value}`, e.LEFT + 120, 9.5, false); e.gap(11.5); });
  }
  await sdGap(e, 2);
  await sdPara(e, [plain("RTGS details are given below. The amount may be credited through ECS please.")], 9.5);
  await sdGap(e, 2);
  await drawKeyValueTable(e, AFC_ACCOUNT_HOLDER, { labelWidth: 190, fontSize: 8, lineH: 10, padY: 2 });
  await sdGap(e, 14);
  await sdLine(e, "BANK ACCOUNT DETAILS", 9.5, true);
  await drawKeyValueTable(e, AFC_BANK, { labelWidth: 190, fontSize: 8, lineH: 10, padY: 2 });
  await sdGap(e, 18);

  if (e.y - 70 < e.FOOTER_SAFE) await e.newPage();
  await sd(e, () => {
    e.drawTextAt("Signature", e.LEFT, 9.5, true);
    if (cfoImg) {
      const dims = cfoImg.scale(1);
      const scale = Math.min(110 / dims.width, 26 / dims.height, 1);
      const w = dims.width * scale, h = dims.height * scale;
      e.currentPage.drawImage(cfoImg, { x: e.LEFT + 80, y: e.y - h + 6, width: w, height: h });
    } else {
      e.drawTextAt(":  ", e.LEFT + 80, 9.5, false);
    }
    e.gap(12);
  });
  for (const [label, value] of [["Name", cfoName || "—"], ["Designation", "CHIEF FINANCIAL OFFICER"], ["Dated", dateStr]]) {
    await sd(e, () => { e.drawTextAt(label, e.LEFT, 9.5, true); e.drawTextAt(`:  ${value}`, e.LEFT + 80, 9.5, false); e.gap(12); });
  }
  await sdGap(e, 8);
  await sdPara(e, [bold("Note: "), plain("“In case no reply is received within 7 days of submission the invoice shall be treated as accepted.”")], 9);

  const pdfBytes = await pdf.save();
  return { ok: true, pdfBytes, projectId: inv.project_id, fileName: `Invoice_${String(inv.invoice_number).replace(/[^\w.-]+/g, "_")}.pdf` };
}
