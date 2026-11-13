// Composes a LIVE, READ-ONLY preview of the Bid Payment Requisition Note's
// page-1 body, straight from the structured fee fields — ported from
// `_shared/feeNotePdf.ts`'s own composition (buildCoverParagraphs) so
// FeeNoteEditPage can show, as you fill in the form, the same wording the
// PDF will actually print. This never gets saved anywhere and there's
// nothing here for a person to type into directly — it's the "one input,
// one always-accurate output" replacement for the earlier free-text
// "Note Text" box (which needed a separate save + a "Regenerate" button
// that could wipe out anything typed there). Only needs to be close enough
// to the server's own wording, not byte-for-byte identical.
import { PORTALS } from "./portal_table";

const FEE_META = {
  emd: { label: "EMD", refundLabel: "Refundable" },
  tender_fee: { label: "Tender Fee", refundLabel: "Non-Refundable" },
  processing_fee: { label: "Bid Processing Fee", refundLabel: "Non-Refundable" },
};

const PAYMENT_MODE_PHRASE = {
  online: "through online transfer",
  bank_guarantee: "in the form of a Bank Guarantee",
  demand_draft: "in the form of a Demand Draft (DD)",
  bankers_cheque: "in the form of a Banker's Cheque",
  fixed_deposit_receipt: "in the form of a Fixed Deposit Receipt (FDR)",
};

const PAYMENT_INSTRUMENT = {
  bank_guarantee: "bank guarantee",
  demand_draft: "demand draft",
  bankers_cheque: "banker's cheque",
  fixed_deposit_receipt: "fixed deposit receipt",
};

export function portalRefLabel(portalName) {
  if (!portalName) return "Reference No.";
  return PORTALS.find((p) => p.name === portalName)?.identifier || "Reference No.";
}

export function formatRupees(amount) {
  return Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const r = n % 10;
  return r ? `${TENS[t]} ${ONES[r]}` : TENS[t];
}
function threeDigitWords(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h && r) return `${ONES[h]} Hundred ${twoDigitWords(r)}`;
  if (h) return `${ONES[h]} Hundred`;
  return twoDigitWords(r);
}

export function amountToIndianWords(amount) {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Rupees Zero Only";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundredRest = n;
  const parts = [];
  if (crore) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (hundredRest) parts.push(threeDigitWords(hundredRest));
  return `Rupees ${parts.join(" ")} Only`;
}

function feeListPhrase(lines) {
  const labels = lines.map((l) => FEE_META[l.key].label);
  if (labels.length === 0) return "the applicable fees";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function borneByPhrase(borneBy, bpName) {
  if (borneBy === "bp") return bpName ? `the Business Partner, M/s. ${bpName}` : "the Business Partner";
  return "AFC";
}

function feeLineText(l) {
  const meta = FEE_META[l.key];
  let s = `${meta.label} (${meta.refundLabel}): Rs. ${formatRupees(l.amount)}/-`;
  if (l.paymentMode) s += ` ${PAYMENT_MODE_PHRASE[l.paymentMode] || l.paymentMode}`;
  if (l.ddInFavourOf) s += ` in favour of ${l.ddInFavourOf}`;
  if (l.ddPayableAt) s += `, Payable at ${l.ddPayableAt}`;
  return s;
}

// A run of text with/without bold — render as <b> or plain in JSX, never
// as raw HTML, so nothing here needs escaping.
export const plain = (text) => ({ text, bold: false });
export const bold = (text) => ({ text, bold: true });

// The single source of truth for the "bidding independently / who bears
// which fee" sentence — used both as one of page 1's body paragraphs and,
// flattened to plain text below, as the Implementation Arrangements
// starting text. Change the wording here and both places follow.
function buildBorneSegs({ feeLines, bpName }) {
  const segs = [];
  if (bpName) {
    segs.push(plain("We are bidding independently for this assignment and the services of "), bold(`M/s. ${bpName}`), plain(" will be roped in, if the assignment is awarded to us. "));
  } else {
    segs.push(plain("We are bidding independently for this assignment. "));
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

const segsToText = (segs) => segs.map((s) => s.text).join("");

// implementation-arrangements draft (page 2, row 4) — same fallback the PDF
// composes when that field is left blank; used only to pre-fill that box
// once, which stays a normal editable field (unlike the page-1 body).
// Just the plain-text flattening of buildBorneSegs, the exact same
// paragraph shown live on page 1 — never a separately hand-typed sentence
// that could drift out of sync with it.
export function composeImplementationArrangements({ feeLines, bpName }) {
  return segsToText(buildBorneSegs({ feeLines, bpName }));
}

// Live preview of page 1's body — mirrors buildCoverParagraphs's shape
// exactly (intro paragraphs / numbered fee lines / tail paragraphs) so the
// component can render it the same way the PDF lays it out. Returns null
// when there's nothing to show yet (no fee ticked).
export function composeFeeNotePreview({ lead, feeLines, bpName, submitTo, refLabel }) {
  if (!feeLines.length) return null;

  const rfpOrEoi = lead.lead_type === "eoi" ? "EOI" : "RFP";
  const feePhrase = feeListPhrase(feeLines);
  const intro = [];

  intro.push([bold(`${rfpOrEoi} for `), bold(`"${lead.title}"`), bold(` — Requisition of ${feePhrase}`)]);

  const refClause = lead.bid_number ? `, ${refLabel}: ${lead.bid_number},` : "";
  intro.push([
    plain("The duly filled-in requisition form for "),
    bold(`"${lead.title}"`),
    plain(`${refClause} is to be submitted to `),
    bold(submitTo || lead.client_name || "the Client"),
    plain("."),
  ]);

  intro.push(buildBorneSegs({ feeLines, bpName }));

  intro.push([plain("For the same, we need to furnish the following:")]);

  const items = feeLines.map((l) => feeLineText(l));

  const tail = [];
  const afcLines = feeLines.filter((l) => l.borneBy === "afc");
  const afcTotal = afcLines.reduce((s, l) => s + l.amount, 0);
  if (afcTotal > 0) {
    const distinctModes = [...new Set(afcLines.map((l) => l.paymentMode).filter((m) => m && m !== "online"))];
    const closing = distinctModes.length === 1
      ? `so that the process of issuance of the ${PAYMENT_INSTRUMENT[distinctModes[0]] || distinctModes[0]} can be initiated from the bank.`
      : "so that the payment can be initiated accordingly.";
    tail.push([
      plain("It is requested to the Accounts Department, AFC Mumbai, to transfer Rs. "),
      bold(`${formatRupees(afcTotal)}/-`),
      plain(" ("),
      bold(amountToIndianWords(afcTotal)),
      plain(`) to the AFC Delhi account ${closing}`),
    ]);
  }
  tail.push([plain("Submitted for your information and approval, please.")]);

  return { intro, items, tail };
}
