// supabase/functions/_shared/empanelmentLetterPdf.ts
// The final Empanelment Letter — attached to the same email that carries
// the BP's portal credentials on MD accept. Distinct from the DGM's
// provisional letter (_shared/provisionalLetterPdf.ts): this one is final,
// references the application's actual sectors, and is issued and signed by
// the accepting MD (not the team's DGM — the DGM only signs the
// provisional letter). Ported from the previous AFC empanelment app's
// send-welcome-mail function.
//
// Shared between advance-empanelment-stage (the real MD-accept action,
// which persists the ref number) and preview-empanelment-letter (a
// read-only preview shown before the MD confirms with their PIN) so the
// two can never drift — same PDF either way, only whether the caller
// persists the ref number differs.

import {
  BLACK, Segment, plain, bold, PageEngine, sd, sdLine, sdPara, sdGap, newPdfDoc,
  embedImageAuto, fetchSignatureBytes, drawSignatureClosing,
  formatDateDDMMYYYY, formatDateLong, addMonths,
} from "./letterPdf.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export async function generateEmpanelmentPDF(opts: {
  logoBytes: Uint8Array;
  refNumber: string;
  date: string;
  contactPerson: string;
  designation: string;
  orgName: string;
  regAddress: string;
  sectors: string;
  validUntil: string;
  mdName: string;
  signatureBytes?: Uint8Array | null;
}): Promise<Uint8Array> {
  const { pdf, fonts } = await newPdfDoc();
  const e = new PageEngine(pdf, fonts, opts.logoBytes);
  const S = 9.5;
  const NI = 18;
  const signatureImage = opts.signatureBytes ? await embedImageAuto(pdf, opts.signatureBytes).catch(() => null) : null;

  await e.newPage();

  await sdLine(e, opts.mdName, S, true);
  await sdLine(e, "MANAGING DIRECTOR", S, true);
  await sdGap(e, 20);

  e.drawTextAt(opts.refNumber, e.LEFT, S, true);
  e.drawTextRight(opts.date, S, true);
  e.gap(e.LINE_H);
  await sdGap(e, 20);

  await sdLine(e, "To,", S, false);
  await sdLine(e, opts.contactPerson, S, false);
  await sdLine(e, opts.designation, S, false);
  await sdLine(e, opts.orgName, S, false);
  for (const part of opts.regAddress.split(/[,\n]/).map((l: string) => l.trim()).filter(Boolean).slice(0, 3)) {
    await sdLine(e, part.length > 72 ? part.slice(0, 72) : part, S, false);
  }
  await sdGap(e, 14);

  await sdPara(e, [bold("Sub: "), plain("Empanelment as Business Partner — AFC India Limited")], S);
  await sdGap(e, 3);
  await sd(e, () => e.drawRule());
  await sdGap(e, 8);

  await sdLine(e, `Dear ${opts.contactPerson},`, S, false);
  await sdGap(e, 8);

  await sdPara(e, [
    plain("We are pleased to inform you that we have reviewed and evaluated the capabilities and qualifications of "),
    bold(opts.orgName),
    plain(", and we are pleased to officially empanel "),
    bold(opts.orgName),
    plain(" as an approved Business Partner of AFC India Limited for providing services in "),
    bold(opts.sectors),
    plain(" on mutually agreed terms and conditions and revenue/risk sharing basis."),
  ], S);
  await sdGap(e, 10);

  await sdPara(e, [plain("The said empanelment is subject to the following terms and conditions:")], S);
  await sdGap(e, 8);

  const clauses: Segment[][] = [
    [plain("Both the organizations agree to share resources available with either organization, to explore newer business avenues and share technical expertise wherever possible and required.")],
    [plain("This communication shall not be considered a Partnership / Joint Venture / Rights of business of either of the organization.")],
    [plain("Both organizations agree to place their logo in the activities conducted jointly. The request for placing the logo would be made by obtaining consent before actual use.")],
    [plain("During this period of work, the organization shall abide by all terms & conditions prescribed by AFC India Limited from time to time.")],
    [plain("Neither organization shall use the intellectual property, trademarks, or brand names of the other, without prior written consent.")],
    [plain("Neither organization i.e., AFC nor "), bold(opts.orgName), plain(" shall incur any liability on behalf of the other, without prior written consent.")],
    [plain("Either organization i.e., AFC or "), bold(opts.orgName), plain(" shall not propagate this communication to further business interests without consent of the other.")],
    [plain("Both organizations will enter into separate agreements for each assignment with clear-cut roles, payment, commercials, terms, and deliverables.")],
    [plain("No information or document acquired while working together may be disclosed to a third organization without written consent.")],
    [plain("The empanelment does not grant any exclusive right to either organization and shall not create any legally binding obligations.")],
    [plain("The empanelment can be terminated by either organization by serving a 30-day notice in writing, subject to completion of assignments in hand.")],
    [plain("This empanelment is valid for a period of "), bold("3 (three) years"), plain(" from the date of this letter, i.e., up to "), bold(opts.validUntil), plain(", and is subject to renewal on mutual consent.")],
  ];

  for (let i = 0; i < clauses.length; i++) {
    if (e.y < e.FOOTER_SAFE) await e.newPage();
    e.currentPage.drawText(`${i + 1}.`, { x: e.LEFT, y: e.y, size: S, font: fonts.bold, color: BLACK });
    await sdPara(e, clauses[i], S, NI);
    await sdGap(e, 5);
  }

  await sdGap(e, 10);
  if (e.y < e.FOOTER_SAFE + 80) await e.newPage();

  await sdPara(e, [
    plain("Looking forward to a fruitful and mutually beneficial co-operation with "),
    bold(opts.orgName), plain(" for taking business opportunities together."),
  ], S);
  await sdGap(e, 20);

  await drawSignatureClosing(e, S, { name: opts.mdName, designation: "MANAGING DIRECTOR", signatureImage });

  return await pdf.save();
}

export type BuiltEmpanelmentLetter = {
  pdfBytes: Uint8Array;
  refNumber: string;
  validUntil: string;
  validUntilDate: Date;
};

// Fetches everything the letter needs (MD identity/signature, logo, next
// ref number) and renders the PDF — but never writes anything to the DB.
// Callers decide whether to persist `refNumber`/`validUntilDate` onto the
// application (the real md_accept action does; a preview does not) and
// whether to treat a null return as fatal (md_accept treats it as
// best-effort/non-fatal; the preview endpoint treats it as a real error).
export async function buildEmpanelmentLetter(
  admin: AdminClient,
  baData: { org_name: string | null; contact_person: string | null; designation: string | null; reg_address: string | null; sectors_served: unknown } | null,
  mdId: string,
  // When re-rendering an already-issued letter for viewing, pass the values
  // persisted at issue time so the reproduced PDF matches what was emailed
  // instead of drifting (the ref is a live COUNT; the dates are "today").
  opts: { refOverride?: string | null; dateOverride?: string | null; validUntilOverride?: string | null } = {}
): Promise<BuiltEmpanelmentLetter | null> {
  if (!baData) return null;

  const { data: mdRow } = await admin.from("afc_users").select("full_name, signature_path").eq("id", mdId).maybeSingle();
  const signatureBytes = await fetchSignatureBytes(admin, mdRow?.signature_path);

  const logoUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/public-assets/Logo.png`;
  const logoRes = await fetch(logoUrl);
  if (!logoRes.ok) return null;
  const logoBytes = new Uint8Array(await logoRes.arrayBuffer());

  const today = new Date();
  const validUntilDate = addMonths(today, 36); // 3 years
  const validUntil = opts.validUntilOverride || formatDateLong(validUntilDate);
  const year = today.getFullYear();

  let refNumber = opts.refOverride || "";
  if (!refNumber) {
    const { count } = await admin.from("empanelment_applications").select("id", { count: "exact", head: true }).not("empanelment_ref", "is", null);
    refNumber = `AFC/BA/${year}/${String((count ?? 0) + 1).padStart(3, "0")}`;
  }

  const sectorsArr = Array.isArray(baData.sectors_served) ? baData.sectors_served as string[] : [];
  const sectors = sectorsArr.length ? sectorsArr.join(", ") + " and other areas of common interest" : "areas of common interest as may be mutually agreed";

  const pdfBytes = await generateEmpanelmentPDF({
    logoBytes,
    refNumber,
    date: opts.dateOverride || formatDateDDMMYYYY(today),
    contactPerson: baData.contact_person ? `Mr./Ms. ${baData.contact_person}` : "Sir / Ma'am",
    designation: baData.designation || "Authorized Signatory",
    orgName: baData.org_name || "the Organization",
    regAddress: baData.reg_address || "",
    sectors,
    validUntil,
    mdName: (mdRow?.full_name || "Managing Director").toUpperCase(),
    signatureBytes,
  });

  return { pdfBytes, refNumber, validUntil, validUntilDate };
}
