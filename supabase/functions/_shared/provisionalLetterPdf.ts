// supabase/functions/_shared/provisionalLetterPdf.ts
// The DGM's non-final, provisional empanelment letter — distinct from the
// MD's final Empanelment Letter (_shared/empanelmentLetterPdf.ts). Sendable
// at any stage once the BA has filled the form, signed by whichever DGM is
// actually issuing it. Ported from the previous AFC empanelment app's
// send-provisional-mail function.
//
// Shared between send-provisional-letter (the real send, which persists
// provisional_letter_sent) and preview-empanelment-letter (a read-only
// preview shown before the DGM confirms with their PIN) so the two can
// never drift — same PDF either way, only whether the caller persists
// anything differs.

import {
  BLACK, Segment, plain, bold, PageEngine, sd, sdLine, sdPara, sdGap, newPdfDoc,
  embedImageAuto, fetchSignatureBytes, drawSignatureClosing,
  formatDateDDMMYYYY, formatDateLong, addMonths,
} from "./letterPdf.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

export async function generateProvisionalPDF(opts: {
  logoBytes: Uint8Array;
  refNumber: string;
  date: string;
  contactPerson: string;
  designation: string;
  orgName: string;
  regAddress: string;
  applicationCode: string;
  signatoryName: string;
  signatoryDesignation: string;
  validUntil: string;
  validityMonths: number;
  signatureBytes?: Uint8Array | null;
}): Promise<Uint8Array> {
  const { pdf, fonts } = await newPdfDoc();
  const e = new PageEngine(pdf, fonts, opts.logoBytes);
  const S = 9.5;
  const NI = 18;
  const signatureImage = opts.signatureBytes ? await embedImageAuto(pdf, opts.signatureBytes).catch(() => null) : null;

  await e.newPage();

  await sdLine(e, opts.signatoryName, S, true);
  await sdLine(e, opts.signatoryDesignation, S, true);
  await sdGap(e, 20);

  e.drawTextAt(opts.refNumber, e.LEFT, S, true);
  e.drawTextRight(opts.date, S, true);
  e.gap(e.LINE_H);
  await sdGap(e, 20);

  await sdLine(e, "To,", S, false);
  await sdLine(e, opts.contactPerson, S, false);
  await sdLine(e, opts.designation, S, false);
  await sdLine(e, opts.orgName, S, false);

  const addrParts = opts.regAddress
    .split(/[,\n]/)
    .map((l: string) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  for (const part of addrParts) {
    await sdLine(e, part.length > 72 ? part.slice(0, 72) : part, S, false);
  }

  await sdGap(e, 14);

  await sdPara(e, [
    bold("Sub: "),
    plain("Provisional Empanelment as Business Associate — AFC India Limited"),
  ], S);
  await sdGap(e, 3);
  await sd(e, () => e.drawRule());
  await sdGap(e, 8);

  await sdLine(e, `Dear ${opts.contactPerson},`, S, false);
  await sdGap(e, 8);

  await sdPara(e, [
    plain("We are pleased to inform you that the empanelment application submitted by "),
    bold(opts.orgName),
    plain(" bearing Application Code "),
    bold(opts.applicationCode),
    plain(" has been reviewed and evaluated by AFC India Limited. Based on the preliminary assessment of your organization's capabilities and credentials, we are pleased to provisionally empanel "),
    bold(opts.orgName),
    plain(" as a Business Associate of AFC India Limited."),
  ], S);
  await sdGap(e, 10);

  await sdPara(e, [bold("This provisional empanelment is subject to the following terms and conditions:")], S);
  await sdGap(e, 8);

  const terms: Segment[][] = [
    [plain("This is a provisional empanelment and shall not be construed as a final empanelment. The final empanelment letter will be issued upon successful completion of the due diligence process.")],
    [plain("This provisional empanelment is valid for a period of "),
      bold(`${opts.validityMonths} (${opts.validityMonths === 3 ? "three" : String(opts.validityMonths)}) months`),
      plain(" from the date of this letter, i.e., up to "),
      bold(opts.validUntil),
      plain(". If the final empanelment process is not completed within this period, this provisional empanelment shall automatically lapse.")],
    [plain("During the provisional period, your organization shall not represent itself as an empanelled Business Associate of AFC India Limited for any commercial, contractual, or marketing purpose without the prior written consent of AFC India Limited.")],
    [plain("AFC India Limited reserves the right to withdraw this provisional empanelment at any stage without assigning any reason, if it is found that the information provided by your organization is incorrect, misleading, or incomplete.")],
    [plain("No financial obligation or liability shall accrue to AFC India Limited by virtue of this provisional empanelment letter.")],
  ];

  for (let i = 0; i < terms.length; i++) {
    if (e.y < e.FOOTER_SAFE) await e.newPage();
    e.currentPage.drawText(`${i + 1}.`, { x: e.LEFT, y: e.y, size: S, font: fonts.bold, color: BLACK });
    await sdPara(e, terms[i], S, NI);
    await sdGap(e, 5);
  }

  await sdGap(e, 10);
  if (e.y < e.FOOTER_SAFE + 80) await e.newPage();

  await sdPara(e, [
    plain("We look forward to a productive and mutually beneficial association with "),
    bold(opts.orgName),
    plain(". Please acknowledge receipt of this letter and confirm your acceptance of the above terms and conditions."),
  ], S);
  await sdGap(e, 20);

  await drawSignatureClosing(e, S, { name: opts.signatoryName, designation: opts.signatoryDesignation, signatureImage });

  return await pdf.save();
}

export type BuiltProvisionalLetter = {
  pdfBytes: Uint8Array;
  refNumber: string;
  validUntilStr: string;
};

// Fetches everything the letter needs (issuing DGM's identity/signature,
// logo, next ref number) and renders the PDF — never writes anything to
// the DB. Callers decide whether to persist `provisional_letter_sent`
// (the real send does; a preview does not).
export async function buildProvisionalLetter(
  admin: AdminClient,
  app: { application_code: string | null },
  reg: { org_name: string | null; contact_person: string | null; designation: string | null; reg_address: string | null },
  dgmId: string
): Promise<BuiltProvisionalLetter | null> {
  const { data: dgmRow } = await admin.from("afc_users").select("full_name, signature_path").eq("id", dgmId).maybeSingle();
  const signatureBytes = await fetchSignatureBytes(admin, dgmRow?.signature_path);

  const logoUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/public-assets/Logo.png`;
  const logoRes = await fetch(logoUrl);
  if (!logoRes.ok) return null;
  const logoBytes = new Uint8Array(await logoRes.arrayBuffer());

  const today = new Date();
  const validUntil = addMonths(today, 3);
  const validUntilStr = formatDateLong(validUntil);
  const year = today.getFullYear();

  const { count } = await admin
    .from("empanelment_applications")
    .select("id", { count: "exact", head: true })
    .eq("provisional_letter_sent", true);
  const refNumber = `AFC/Provisional/${year}/${String((count ?? 0) + 1).padStart(3, "0")}`;

  const orgName = reg.org_name || "the Organization";
  const contactPerson = reg.contact_person || "Sir / Ma'am";

  const pdfBytes = await generateProvisionalPDF({
    logoBytes,
    refNumber,
    date: formatDateDDMMYYYY(today),
    contactPerson,
    designation: reg.designation || "Authorized Signatory",
    orgName,
    regAddress: reg.reg_address || "",
    applicationCode: app.application_code || "",
    signatoryName: (dgmRow?.full_name || "Deputy General Manager").toUpperCase(),
    signatoryDesignation: "DEPUTY GENERAL MANAGER",
    validUntil: validUntilStr,
    validityMonths: 3,
    signatureBytes,
  });

  return { pdfBytes, refNumber, validUntilStr };
}
