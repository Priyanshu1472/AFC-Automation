// supabase/functions/_shared/pbgNotePdf.ts
// The PBG Note (proposal_pbg_notes) — the approval note for furnishing the
// Performance Bank Guarantee on an awarded proposal, modelled on AFC's two
// reference notes:
//
//   "converted" — the EMD is adjusted towards the PBG (EMD track
//                 "Converted to PBG"): PBG − EMD = remaining PBG to submit.
//   "full"      — nothing is adjusted (EMD refunded, held until project
//                 completion, or there was no EMD): the full PBG is submitted.
//
// Which one is decided purely by the amounts — emd_adjusted > 0 means
// "converted". The wording itself (subject + paragraphs + enclosures) is
// what the team typed in the PBG Note editor (content jsonb, pre-filled
// there); only the calculation table is built here, from the amounts, so
// it can never disagree with them. The editor's live preview
// (src/lib/pbgNoteDraft.js) mirrors pbgCalculationRows exactly.
//
// Signatures: Person Responsible and Recommending Authority on the left,
// MD on the right — each printed with their signature image once they've
// signed (pr_signed_* / ra_signed_* / md_signed_*), same as the Bid
// Payment Requisition Note.

import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import {
  PageEngine, plain, bold, formatDateDDMMYYYY, sd, sdPara, sdGap, drawGridTable,
} from "./letterPdf.ts";
import {
  formatRupees, fetchLogoBytes, amountToIndianWords, drawSignatureBlock, drawFeeNoteHeader, drawFeeNoteFooter,
  resolveSigner,
} from "./feeNotePdf.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export type EmdContext = "converted" | "refunded" | "on_completion" | "not_adjusted" | "none";

export type PbgAmounts = {
  pbgAmount: number;
  consultancyFee: number | null;
  pbgPercent: string | null;
  emdAmount: number;
  emdAdjusted: number;
  emdContext: EmdContext;
};

export const rsSlash = (n: number) => `${formatRupees(Math.round(n * 100) / 100)}/-`;

function wordsOnly(n: number): string {
  // "Rupees One Lakh ... Only" -> "Rupees One Lakh ... only", as in the reference notes.
  return amountToIndianWords(n).replace(/ Only$/, " only");
}

// Which EMD story the note tells — from the EMD track (and whether any EMD
// is actually adjusted).
export function emdContextOf(track: string | null | undefined, emdAmount: number, emdAdjusted: number): EmdContext {
  if (emdAdjusted > 0) return "converted";
  if (!(emdAmount > 0)) return "none";
  if (track === "refund") return "refunded";
  if (track === "on_completion") return "on_completion";
  return "not_adjusted";
}

// The calculation table — [S. No., Particulars, Amount (Rs.)].
export function pbgCalculationRows(a: PbgAmounts): string[][] {
  const pct = a.pbgPercent ? ` (${a.pbgPercent}% of consultancy fees)` : "";
  const rows: [string, string][] = [];
  if (a.emdContext === "converted") {
    const adjusted = Math.min(a.emdAdjusted, a.pbgAmount);
    const remaining = Math.max(0, a.pbgAmount - adjusted);
    rows.push([`PBG amount${pct}`, rsSlash(a.pbgAmount)]);
    rows.push(["Less: EMD converted to PBG", rsSlash(adjusted)]);
    rows.push([
      remaining > 0 ? `Remaining PBG to be submitted (${wordsOnly(remaining)})` : "Remaining PBG to be submitted (Nil — fully covered by the EMD)",
      rsSlash(remaining),
    ]);
    if (a.emdAdjusted > a.pbgAmount) rows.push(["Excess EMD to be refunded by the client", rsSlash(a.emdAdjusted - a.pbgAmount)]);
  } else {
    if (a.consultancyFee) rows.push(["Consultancy fees (inclusive of GST)", rsSlash(a.consultancyFee)]);
    rows.push([`PBG amount${pct}`, rsSlash(a.pbgAmount)]);
    if (a.emdContext === "refunded") rows.push(["EMD refunded by the client (not adjusted)", rsSlash(a.emdAmount)]);
    else if (a.emdContext === "on_completion") rows.push(["EMD to be refunded on completion of the project (not adjusted)", rsSlash(a.emdAmount)]);
    else if (a.emdContext === "not_adjusted") rows.push(["EMD (not adjusted)", rsSlash(a.emdAmount)]);
    rows.push([`Full PBG to be submitted (${wordsOnly(a.pbgAmount)})`, rsSlash(a.pbgAmount)]);
  }
  return rows.map(([p, amt], i) => [String(i + 1), p, amt]);
}

export const PARAGRAPH_ORDER_BEFORE_TABLE = ["award", "partner", "requirement", "emd"] as const;
export const PARAGRAPH_ORDER_AFTER_TABLE = ["delivery", "closing"] as const;

type Content = {
  subject?: string;
  paragraphs?: Record<string, string>;
  enclosures?: string;
  fields?: Record<string, string>;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function buildPbgNotePdf(
  admin: AdminClient,
  proposalId: string,
): Promise<{ ok: true; pdfBytes: Uint8Array } | { ok: false; error: string }> {
  const { data: note } = await admin.from("proposal_pbg_notes").select("*").eq("proposal_id", proposalId).maybeSingle();
  if (!note) return { ok: false, error: "The PBG Note hasn't been created yet." };

  const [{ data: proposal }, { data: tracking }, logoBytes] = await Promise.all([
    admin.from("proposal_preparations").select("id, lead_id").eq("id", proposalId).maybeSingle(),
    admin.from("proposal_emd_tracking").select("track").eq("proposal_id", proposalId).maybeSingle(),
    fetchLogoBytes(),
  ]);
  if (!proposal) return { ok: false, error: "Proposal not found." };
  if (!logoBytes) return { ok: false, error: "Could not load the AFC letterhead logo. Please try again." };

  const { data: lead } = await admin
    .from("leads")
    .select("person_responsible_id, recommending_authority_id")
    .eq("id", proposal.lead_id)
    .maybeSingle();

  const [personResponsible, recommendingAuthority, md] = await Promise.all([
    resolveSigner(admin, { nominalId: lead?.person_responsible_id || null, actualId: note.pr_signed_by, signed: !!note.pr_signed_at }),
    resolveSigner(admin, { nominalId: lead?.recommending_authority_id || null, actualId: note.ra_signed_by, signed: !!note.ra_signed_at }),
    resolveSigner(admin, { nominalId: null, actualId: note.md_signed_by, signed: !!note.md_signed_at, designationOverride: "Managing Director" }),
  ]);

  const content = (note.content || {}) as Content;
  const paragraphs = content.paragraphs || {};
  const emdAmount = Number(note.emd_amount) || 0;
  const emdAdjusted = Number(note.emd_adjusted) || 0;
  const amounts: PbgAmounts = {
    pbgAmount: Number(note.pbg_amount),
    consultancyFee: note.consultancy_fee != null ? Number(note.consultancy_fee) : null,
    pbgPercent: str(content.fields?.pbg_percent) || null,
    emdAmount,
    emdAdjusted,
    emdContext: emdContextOf(tracking?.track, emdAmount, emdAdjusted),
  };

  const pdf = await PDFDocument.create();
  const fontReg = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const e = new PageEngine(pdf, { reg: fontReg, bold: fontBold }, logoBytes, {
    drawHeader: drawFeeNoteHeader,
    drawFooter: drawFeeNoteFooter,
    footerSafe: 55,
  });
  e.LINE_H = 12.5;
  const S = 10.5;

  await e.newPage();
  const dated = note.pr_signed_at ? new Date(note.pr_signed_at) : new Date();
  await sd(e, () => e.drawTextRight(formatDateDDMMYYYY(dated).replace(/\//g, "."), S, false));
  e.gap(e.LINE_H + 8);

  const subject = str(content.subject);
  if (subject) {
    await sdPara(e, [bold(subject)], S + 0.5, 0, true);
    await sdGap(e, 8);
  }

  for (const key of PARAGRAPH_ORDER_BEFORE_TABLE) {
    const text = str(paragraphs[key]);
    if (!text) continue;
    for (const part of text.split(/\n{2,}/)) {
      await sdPara(e, [plain(part.replace(/\n/g, " "))], S, 0, true);
      await sdGap(e, 7);
    }
  }

  await drawGridTable(e, [
    { header: "S. No.", width: 9 },
    { header: "Particulars", width: 66 },
    { header: "Amount (Rs.)", width: 25 },
  ], pbgCalculationRows(amounts), { fontSize: 9.5, lineH: 12, padY: 4 });
  await sdGap(e, 12);

  for (const key of PARAGRAPH_ORDER_AFTER_TABLE) {
    const text = str(paragraphs[key]);
    if (!text) continue;
    // Keeps line breaks — the delivery paragraph usually carries an address.
    const [first, ...rest] = text.split("\n");
    await sdPara(e, [plain(first)], S, 0, true);
    for (const line of rest) {
      if (line.trim()) await sdPara(e, [plain(line.trim())], S);
      else await sdGap(e, 5);
    }
    await sdGap(e, 7);
  }

  await sdGap(e, 8);
  await drawSignatureBlock(e, [personResponsible, recommendingAuthority], md, "");

  const encl = str(content.enclosures);
  if (encl) {
    await sdGap(e, 10);
    await sdPara(e, [bold("Encl:")], S);
    for (const line of encl.split("\n").map((l) => l.trim()).filter(Boolean)) {
      await sdPara(e, [plain(line)], S, 12);
    }
  }

  const pdfBytes = await pdf.save();
  return { ok: true, pdfBytes };
}
