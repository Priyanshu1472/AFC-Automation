// supabase/functions/_shared/feeNotePdf.ts
// Builds the "Bid Payment Requisition Note" — one note per proposal that
// carries whichever of EMD (aka Bid Security), Tender Fee, and Bid
// Processing Fee apply to the bid. Renders the real 2-page document:
//
//   Page 1 — the covering "NOTE": subject line, the bidding/borne-by
//            paragraph, the numbered fee list, the Mumbai -> Delhi transfer
//            request, then a vertical PR -> Approval Authority -> MD
//            signature stack.
//   Page 2 — "Format for Requisition of Earnest Money Deposit (EMD)
//            Amount": the 6-row key/value table (title, client details,
//            objectives + scope, implementation arrangements, last date,
//            fee details).
//
// Ported/generalized from the reference "EMD Approval - OMC 022-2026-27.docx"
// and the CAMPA requisition format dropped at the repo root. Own minimal
// header (logo only, no rule) and empty footer — this is an internal AFC
// note, not client-facing correspondence. Set in the standard Times-Roman
// (same as the Lead Approval Note and the Empanelment letters) rather than
// an embedded Gelasio: pdf-lib mis-spaces Gelasio's f-ligatures ("ff",
// "ffi", "fl"), which mangled real project titles like "...Afforestation
// Fund..." into "...Aff orestationFund...".

import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import {
  BLACK, PageEngine, plain, bold, Segment,
  embedImageAuto, fetchSignatureBytes,
  formatDateDDMMYYYY,
  sdPara, sdGap, sd,
  drawKeyValueTable,
} from "./letterPdf.ts";
import { portalRefLabel } from "./portalIdentifiers.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

// ── Fee-line metadata ─────────────────────────────────────────────
type FeeKey = "emd" | "tender_fee" | "processing_fee";

const FEE_META: Record<FeeKey, { label: string; refundLabel: string }> = {
  emd: { label: "EMD", refundLabel: "Refundable" },
  tender_fee: { label: "Tender Fee", refundLabel: "Non-Refundable" },
  processing_fee: { label: "Bid Processing Fee", refundLabel: "Non-Refundable" },
};

const PAYMENT_MODE_PHRASE: Record<string, string> = {
  online: "through online transfer",
  bank_guarantee: "in the form of a Bank Guarantee",
  demand_draft: "in the form of a Demand Draft (DD)",
  bankers_cheque: "in the form of a Banker's Cheque",
  fixed_deposit_receipt: "in the form of a Fixed Deposit Receipt (FDR)",
};

const PAYMENT_INSTRUMENT: Record<string, string> = {
  online: "online transfer",
  bank_guarantee: "bank guarantee",
  demand_draft: "demand draft",
  bankers_cheque: "banker's cheque",
  fixed_deposit_receipt: "fixed deposit receipt",
};

const ROLE_DESIGNATIONS: Record<string, string> = {
  md: "Managing Director",
  cfo: "Chief Financial Officer",
  cs: "Company Secretary",
  dgm: "Deputy General Manager",
  agm: "Assistant General Manager",
  srm: "Senior Regional Manager",
  project_officer: "Project Officer",
  associate_consultant: "Associate Consultant",
  project_assistant: "Project Assistant",
  business_associate: "Business Partner",
  admin: "Administrator",
};

function designationFor(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_DESIGNATIONS[role] || role;
}

// Kept across warm invocations of the same edge function instance (module
// state persists between requests until the isolate is recycled), so the
// logo is fetched over the network once per instance instead of on every
// single "Generate PDF" / preview call. Only successful fetches are
// cached — a transient failure isn't remembered, so the next call retries.
const publicAssetCache = new Map<string, Uint8Array>();

async function fetchPublicAsset(filename: string): Promise<Uint8Array | null> {
  const cached = publicAssetCache.get(filename);
  if (cached) return cached;
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/public-assets/${filename}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    publicAssetCache.set(filename, bytes);
    return bytes;
  } catch {
    return null;
  }
}

const fetchLogoBytes = () => fetchPublicAsset("Logo.png");

// ── Number-to-words (Indian numbering: crore/lakh/thousand) ────────
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const r = n % 10;
  return r ? `${TENS[t]} ${ONES[r]}` : TENS[t];
}

function threeDigitWords(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h && r) return `${ONES[h]} Hundred ${twoDigitWords(r)}`;
  if (h) return `${ONES[h]} Hundred`;
  return twoDigitWords(r);
}

export function amountToIndianWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Rupees Zero Only";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundredRest = n;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (hundredRest) parts.push(threeDigitWords(hundredRest));

  return `Rupees ${parts.join(" ")} Only`;
}

export function formatRupees(amount: number): string {
  return Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// ── Build input ───────────────────────────────────────────────────
type Signer = { name: string | null; designation: string; signatureBytes: Uint8Array | null };

export type FeeLine = {
  key: FeeKey;
  amount: number;
  borneBy: "afc" | "bp";
  paymentMode: string | null;
  ddInFavourOf: string | null;
  ddPayableAt: string | null;
};

export type FeeNoteBuildInput = {
  feeLines: FeeLine[];
  submitTo: string | null;
  clientAddress: string | null;
  clientTelephone: string | null;
  clientEmail: string | null;
  implementationArrangements: string | null;
  date: Date;
  submissionDeadline: Date | null;
  lead: {
    title: string;
    client_name: string | null;
    portal_name: string | null;
    bid_number: string | null;
    lead_type: string;
    delivery_type: string | null;
    objectives: string | null;
    scope_of_work: string[];
  };
  bpName: string | null;
  refLabel: string;
  personResponsible: Signer;
  approvalAuthority: Signer;
  md: Signer;
};

function feeListPhrase(lines: FeeLine[]): string {
  const labels = lines.map((l) => FEE_META[l.key].label);
  if (labels.length === 0) return "the applicable fees";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function deliveryModeWord(deliveryType: string | null): string {
  if (deliveryType === "online") return "Online";
  if (deliveryType === "offline") return "Offline";
  if (deliveryType === "both") return "Online & Offline";
  return "as applicable";
}

function borneByPhrase(borneBy: "afc" | "bp", bpName: string | null): string {
  if (borneBy === "bp") return bpName ? `the Business Partner, M/s. ${bpName}` : "the Business Partner";
  return "AFC";
}

// The single source of truth for the "bidding independently / who bears
// which fee" sentence — used both as one of page 1's body paragraphs and,
// flattened to plain text below, as the Implementation Arrangements
// fallback. Change the wording here and both places follow.
function buildBorneSegs(feeLines: FeeLine[], bpName: string | null): Segment[] {
  const segs: Segment[] = [];
  if (bpName) {
    segs.push(plain(`We are bidding independently for this assignment and the services of `), bold(`M/s. ${bpName}`), plain(` will be roped in, if the assignment is awarded to us. `));
  } else {
    segs.push(plain(`We are bidding independently for this assignment. `));
  }
  feeLines.forEach((l, i) => {
    segs.push(
      plain(`${i === 0 ? "The" : "the"} ${FEE_META[l.key].label} of Rs. `),
      bold(`${formatRupees(l.amount)}/-`),
      plain(` will be borne by ${borneByPhrase(l.borneBy, bpName)}${i < feeLines.length - 1 ? ", and " : ""}`),
    );
  });
  const anyBp = feeLines.some((l) => l.borneBy === "bp");
  segs.push(plain(anyBp ? ", and the same shall be transferred to AFC's Mumbai account soon." : "."));
  return segs;
}

// Falls back to a composed sentence when nobody typed an explicit
// "Proposed Implementation Arrangements" narrative on the form — just the
// plain-text flattening of buildBorneSegs, the same paragraph page 1
// prints, never a separately hand-typed sentence that could drift out of
// sync with it.
function implementationArrangementsText(input: FeeNoteBuildInput): string {
  if (input.implementationArrangements && input.implementationArrangements.trim()) {
    return input.implementationArrangements.trim();
  }
  return buildBorneSegs(input.feeLines, input.bpName).map((s) => s.text).join("");
}

function feeLineText(l: FeeLine): string {
  const meta = FEE_META[l.key];
  let s = `${meta.label} (${meta.refundLabel}): Rs. ${formatRupees(l.amount)}/-`;
  if (l.paymentMode) s += ` ${PAYMENT_MODE_PHRASE[l.paymentMode] || l.paymentMode}`;
  if (l.ddInFavourOf) s += ` in favour of ${l.ddInFavourOf}`;
  if (l.ddPayableAt) s += `, Payable at ${l.ddPayableAt}`;
  return s;
}

// ── Page 1: the covering NOTE ─────────────────────────────────────
function buildCoverParagraphs(input: FeeNoteBuildInput): { intro: Segment[][]; feeLines: string[]; tail: Segment[][] } {
  const { lead } = input;
  const clientName = lead.client_name || "the Client";
  const rfpOrEoi = lead.lead_type === "eoi" ? "EOI" : "RFP";
  const feePhrase = feeListPhrase(input.feeLines);
  const submitTo = input.submitTo || clientName;

  const intro: Segment[][] = [];

  intro.push([
    bold(`${rfpOrEoi} for `),
    bold(`"${lead.title}"`),
    bold(` — Requisition of ${feePhrase}`),
  ]);

  intro.push([
    plain(`The duly filled-in requisition form for `),
    bold(`"${lead.title}"`),
    plain(`${lead.bid_number ? `, ${input.refLabel}: ${lead.bid_number},` : ""} is to be submitted to `),
    bold(submitTo),
    plain("."),
  ]);

  intro.push(buildBorneSegs(input.feeLines, input.bpName));

  intro.push([plain("For the same, we need to furnish the following:")]);

  const feeLines = input.feeLines.map((l) => feeLineText(l));

  const tail: Segment[][] = [];
  const afcLines = input.feeLines.filter((l) => l.borneBy === "afc");
  const afcTotal = afcLines.reduce((s, l) => s + l.amount, 0);
  if (afcTotal > 0) {
    // Name the instrument only when every AFC-borne fee is going out the
    // same specific way — a mix of modes (or all Online) gets a generic
    // closing instead of a wrong or nonsensical "issuance of the online
    // transfer".
    const distinctModes = new Set(afcLines.map((l) => l.paymentMode).filter((m): m is string => !!m && m !== "online"));
    const closing = distinctModes.size === 1
      ? `so that the process of issuance of the ${PAYMENT_INSTRUMENT[[...distinctModes][0]] || [...distinctModes][0]} can be initiated from the bank.`
      : "so that the payment can be initiated accordingly.";
    tail.push([
      plain(`It is requested to the Accounts Department, AFC Mumbai, to transfer Rs. `),
      bold(`${formatRupees(afcTotal)}/-`),
      plain(` (`),
      bold(amountToIndianWords(afcTotal)),
      plain(`) to the AFC Delhi account ${closing}`),
    ]);
  }
  tail.push([plain("Submitted for your information and approval, please.")]);

  return { intro, feeLines, tail };
}

// PR and Approval Authority stack down the left margin, followed by
// "Encl. as above" as a third left-margin line; the MD's row sits
// right-justified flush against the right margin, starting at the same y
// as "Encl. as above" rather than stacked below every other signature —
// matching the reference note, where "Encl. as above" reads as sitting
// right above/alongside the MD's signature, not underneath it.
async function drawSignatureBlock(e: PageEngine, leftSigners: Signer[], md: Signer) {
  const size = 10;
  const sigGap = 48;   // blank space above each name, sized to hold the signature image without it touching the name line
  const imgPad = 3;    // clearance kept above and below the image within that blank space
  const imgMaxH = sigGap - imgPad * 2;
  const imgMaxW = 170;
  const nameH = 12;
  const desigH = 11.5;
  const afterH = 7;
  const rowH = sigGap + nameH + desigH + afterH;
  const needed = (leftSigners.length + 1) * rowH + 6;
  if (e.y - needed < e.FOOTER_SAFE) await e.newPage();

  const images = await Promise.all(
    [...leftSigners, md].map((s) => (s.signatureBytes ? embedImageAuto(e.pdf, s.signatureBytes).catch(() => null) : Promise.resolve(null))),
  );
  const mdImg = images[images.length - 1];

  // Draws one signer's block (signature image + bold name + designation)
  // starting at startY, x(width) picking each line's x from its own
  // rendered width — returns the y just past the row's trailing gap. The
  // image is scaled to fit inside sigGap (with imgPad clearance top and
  // bottom) instead of just its own 120x32 cap, so a tall signature can
  // never dip down far enough to overlap the printed name below it.
  const drawRow = (s: Signer, img: any, x: (w: number) => number, startY: number): number => {
    let y = startY;
    if (img) {
      const dims = img.scale(1);
      const scale = Math.min(imgMaxW / dims.width, imgMaxH / dims.height, 1);
      const w = dims.width * scale;
      const h = dims.height * scale;
      e.currentPage.drawImage(img, { x: x(w), y: y - sigGap + imgPad, width: w, height: h });
    }
    y -= sigGap;
    const nameW = e.fonts.bold.widthOfTextAtSize(s.name || "—", size);
    e.currentPage.drawText(s.name || "—", { x: x(nameW), y, size, font: e.fonts.bold, color: BLACK });
    y -= nameH;
    const desigW = e.fonts.reg.widthOfTextAtSize(s.designation, size - 0.5);
    e.currentPage.drawText(s.designation, { x: x(desigW), y, size: size - 0.5, font: e.fonts.reg, color: BLACK });
    return y - desigH - afterH;
  };

  for (let i = 0; i < leftSigners.length; i++) {
    e.y = drawRow(leftSigners[i], images[i], () => e.LEFT, e.y);
  }

  const mdStartY = e.y;
  await sdPara(e, [plain("Encl. as above")], size);
  const yAfterEncl = e.y;

  const yAfterMd = drawRow(md, mdImg, (w) => e.RIGHT_EDGE - w, mdStartY);

  e.y = Math.min(yAfterEncl, yAfterMd);
}

async function drawCenteredLine(e: PageEngine, text: string, size: number, isBold: boolean) {
  await sd(e, () => {
    const f = isBold ? e.fonts.bold : e.fonts.reg;
    const w = f.widthOfTextAtSize(text, size);
    e.currentPage.drawText(text, { x: e.LEFT + (e.MAX_W - w) / 2, y: e.y, size, font: f, color: BLACK });
  });
  e.gap(e.LINE_H);
}

// deno-lint-ignore no-explicit-any
async function drawFeeNoteHeader(pdf: any, page: any, logoBytes: Uint8Array, _fonts: unknown, H: number) {
  if (!logoBytes.length) return;
  const logo = await embedImageAuto(pdf, logoBytes).catch(() => null);
  if (!logo) return;
  const dims = logo.scale(1);
  const logoH = 42;
  const logoW = (dims.width / dims.height) * logoH;
  page.drawImage(logo, { x: 40, y: H - 40 - logoH, width: logoW, height: logoH });
}

function drawFeeNoteFooter() {}

// ── Page 2: the requisition format table ──────────────────────────
function buildRequisitionRows(input: FeeNoteBuildInput): { label: string; value: string }[] {
  const { lead } = input;

  const clientLines = [
    `(a) Name of Client: ${lead.client_name || "—"}`,
    `(b) Address: ${input.clientAddress || "—"}`,
    `(c) Telephone No: ${input.clientTelephone || "—"}`,
    `(d) E-mail: ${input.clientEmail || "—"}`,
  ].join("\n");

  const scopeBullets = (lead.scope_of_work || []).map((s) => `• ${s}`).join("\n");
  const natureScope = [
    lead.objectives ? `Objectives:\n${lead.objectives}` : "",
    scopeBullets ? `Scope of Work:\n${scopeBullets}` : "",
  ].filter(Boolean).join("\n\n") || "—";

  const feeDetails = input.feeLines.map((l, i) => `${i + 1}. ${feeLineText(l)}`).join("\n\n") || "—";

  const lastDate = input.submissionDeadline
    ? formatDateDDMMYYYY(input.submissionDeadline)
    : "To be confirmed";

  return [
    { label: "1. Title of Proposed Assignment", value: lead.title || "—" },
    { label: "2. Client with full details", value: clientLines },
    { label: "3. Brief write-up on the nature and scope of the proposed assignment", value: natureScope },
    { label: "4. Proposed Implementation Arrangements", value: implementationArrangementsText(input) },
    { label: "5. Last date for submission of Proposal", value: `${lastDate} (${deliveryModeWord(lead.delivery_type)})` },
    { label: "6. EMD and Bid Processing fee details", value: feeDetails },
  ];
}

export async function generateFeeNotePDF(
  input: FeeNoteBuildInput & { logoBytes: Uint8Array },
): Promise<Uint8Array> {
  const { logoBytes } = input;

  const pdf = await PDFDocument.create();
  const fontReg = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const e = new PageEngine(pdf, { reg: fontReg, bold: fontBold }, logoBytes, {
    drawHeader: drawFeeNoteHeader,
    drawFooter: drawFeeNoteFooter,
    footerSafe: 55,
  });
  const S = 10;
  const TITLE_SIZE = 12;
  // Tighter line spacing than the shared default (13.5), scoped to just
  // this document's own engine instance so other letter types are
  // unaffected — frees up the extra room the larger signature images
  // (drawSignatureBlock) now need, to keep everything on page 1.
  e.LINE_H = 12;

  // ── Page 1 — NOTE ──
  await e.newPage();
  await drawCenteredLine(e, "NOTE", TITLE_SIZE, true);
  await sdGap(e, 5);
  await sd(e, () => e.drawTextRight(formatDateDDMMYYYY(input.date), S, false));
  e.gap(e.LINE_H);
  await sdGap(e, 10);

  const { intro, feeLines, tail } = buildCoverParagraphs(input);
  for (const para of intro) {
    await sdPara(e, para, S, 0, true);
    await sdGap(e, 8);
  }
  let n = 1;
  for (const line of feeLines) {
    await sdPara(e, [bold(`${n}. `), plain(line)], S, 16);
    await sdGap(e, 6);
    n += 1;
  }
  await sdGap(e, 3);
  for (const para of tail) {
    await sdPara(e, para, S, 0, true);
    await sdGap(e, 8);
  }

  await sdGap(e, 5);
  await sdPara(e, [plain("Thanks and regards,")], S);
  await sdGap(e, 10);

  await drawSignatureBlock(e, [input.personResponsible, input.approvalAuthority], input.md);

  // ── Page 2 — Requisition format ──
  await e.newPage();
  await drawCenteredLine(e, "AFC India Limited, Delhi", TITLE_SIZE, true);
  await drawCenteredLine(e, "Format for Requisition of Earnest Money Deposit (EMD) Amount", S, true);
  await sdGap(e, 14);

  await drawKeyValueTable(e, buildRequisitionRows(input), { labelWidth: 150, fontSize: 9, lineH: 12 });

  return await pdf.save();
}

// ── Data assembly ────────────────────────────────────────────────
type UserRow = { full_name?: string | null; role?: string | null; signature_path?: string | null } | null;

async function resolveSigner(
  admin: AdminClient,
  opts: { nominalId: string | null; actualId: string | null; signed: boolean; designationOverride?: string },
): Promise<Signer> {
  const idToShow = opts.actualId || opts.nominalId;
  if (!idToShow) return { name: null, designation: opts.designationOverride || "—", signatureBytes: null };

  const { data: row } = await admin.from("afc_users").select("full_name, role, signature_path").eq("id", idToShow).maybeSingle();
  const userRow = row as UserRow;
  if (!userRow) return { name: null, designation: opts.designationOverride || "—", signatureBytes: null };

  const signatureBytes = opts.actualId && opts.signed ? await fetchSignatureBytes(admin, userRow.signature_path) : null;
  return {
    name: userRow.full_name || null,
    designation: opts.designationOverride || designationFor(userRow.role),
    signatureBytes,
  };
}

function collectFeeLines(note: Record<string, unknown>): FeeLine[] {
  const lines: FeeLine[] = [];
  const keys: FeeKey[] = ["emd", "tender_fee", "processing_fee"];
  for (const key of keys) {
    const amount = note[`${key}_amount`];
    if (amount != null && Number(amount) > 0) {
      lines.push({
        key,
        amount: Number(amount),
        borneBy: note[`${key}_borne_by`] === "bp" ? "bp" : "afc",
        paymentMode: (note[`${key}_payment_mode`] as string) || null,
        ddInFavourOf: (note[`${key}_dd_in_favour_of`] as string) || null,
        ddPayableAt: (note[`${key}_dd_payable_at`] as string) || null,
      });
    }
  }
  return lines;
}

export async function buildFeeNotePdfForNote(
  admin: AdminClient,
  feeNoteId: string,
): Promise<{ ok: true; pdfBytes: Uint8Array } | { ok: false; error: string }> {
  const { data: note, error: noteErr } = await admin
    .from("fee_notes")
    .select(`
      id, proposal_id, status,
      emd_amount, emd_borne_by, emd_payment_mode, emd_dd_in_favour_of, emd_dd_payable_at,
      tender_fee_amount, tender_fee_borne_by, tender_fee_payment_mode, tender_fee_dd_in_favour_of, tender_fee_dd_payable_at,
      processing_fee_amount, processing_fee_borne_by, processing_fee_payment_mode, processing_fee_dd_in_favour_of, processing_fee_dd_payable_at,
      submit_to, client_address, client_telephone, client_email, implementation_arrangements,
      pr_signed_by, pr_signed_at, aa_signed_by, aa_signed_at, md_decided_by, md_decided_at
    `)
    .eq("id", feeNoteId)
    .maybeSingle();
  if (noteErr || !note) return { ok: false, error: "Fee note not found." };

  const { data: proposal, error: propErr } = await admin
    .from("proposal_preparations")
    .select("lead_id")
    .eq("id", note.proposal_id)
    .maybeSingle();
  if (propErr || !proposal) return { ok: false, error: "Proposal not found." };

  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("title, client_name, portal_name, bid_number, lead_type, delivery_type, submission_deadline, source, assigned_ba_id, person_responsible_id, approval_authority_id, approval_note_data")
    .eq("id", proposal.lead_id)
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, error: "Lead not found." };

  // Logo fetch and signer resolution don't depend on each other — run
  // them together instead of paying for the logo's network round trip
  // (usually a cache hit after the first call, but not on a cold start)
  // before even starting the signer queries.
  const anyBp = note.emd_borne_by === "bp" || note.tender_fee_borne_by === "bp" || note.processing_fee_borne_by === "bp";
  const [logoBytes, personResponsible, approvalAuthority, md, baRow] = await Promise.all([
    fetchLogoBytes(),
    resolveSigner(admin, { nominalId: lead.person_responsible_id, actualId: note.pr_signed_by, signed: !!note.pr_signed_at }),
    resolveSigner(admin, { nominalId: lead.approval_authority_id, actualId: note.aa_signed_by, signed: !!note.aa_signed_at }),
    resolveSigner(admin, { nominalId: null, actualId: note.md_decided_by, signed: !!note.md_decided_at, designationOverride: "Managing Director" }),
    (anyBp || lead.assigned_ba_id)
      ? admin.from("afc_users").select("full_name").eq("id", lead.assigned_ba_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!logoBytes) return { ok: false, error: "Could not load the AFC letterhead logo. Please try again." };

  const approvalData = (lead.approval_note_data || {}) as Record<string, unknown>;

  const pdfBytes = await generateFeeNotePDF({
    feeLines: collectFeeLines(note),
    submitTo: note.submit_to,
    clientAddress: note.client_address || (approvalData.client_address as string) || null,
    clientTelephone: note.client_telephone,
    clientEmail: note.client_email,
    implementationArrangements: note.implementation_arrangements,
    date: new Date(),
    submissionDeadline: lead.submission_deadline ? new Date(lead.submission_deadline) : null,
    lead: {
      title: lead.title,
      client_name: lead.client_name,
      portal_name: lead.portal_name,
      bid_number: lead.bid_number,
      lead_type: lead.lead_type,
      delivery_type: lead.delivery_type,
      objectives: (approvalData.objectives as string) || null,
      scope_of_work: Array.isArray(approvalData.scope_of_work) ? (approvalData.scope_of_work as string[]) : [],
    },
    bpName: (baRow as { data: { full_name?: string } | null })?.data?.full_name || null,
    refLabel: portalRefLabel(lead.portal_name),
    personResponsible,
    approvalAuthority,
    md,
    logoBytes,
  });

  return { ok: true, pdfBytes };
}
