// Pre-filled wording + live-preview table for the PBG Note editor
// (PbgNoteEditPage). Modelled on AFC's two reference notes:
//
//   "converted" — EMD adjusted towards the PBG (EMD track "Converted to
//                 PBG"): remaining PBG = PBG − EMD.
//   "full"      — nothing adjusted (EMD refunded / held until completion /
//                 no EMD): the full PBG is submitted.
//
// The amounts decide which — never a manual choice. pbgCalculationRows must
// stay in lockstep with supabase/functions/_shared/pbgNotePdf.ts, which
// prints the same table on the real PDF.
import { amountToIndianWords, formatRupees } from "./feeNoteDraft";

export const INSTRUMENT_OPTIONS = [
  { value: "FDR", label: "Fixed Deposit Receipt (FDR)" },
  { value: "Bank Guarantee", label: "Bank Guarantee" },
  { value: "Demand Draft", label: "Demand Draft (DD)" },
  { value: "DD/FDR", label: "DD / FDR" },
  { value: "Online transfer", label: "Online transfer" },
];

export const PARAGRAPHS = [
  { key: "award", label: "Award" },
  { key: "partner", label: "Business Partner" },
  { key: "requirement", label: "PBG requirement" },
  { key: "emd", label: "EMD" },
  { key: "delivery", label: "Sending the original instrument", after: true },
  { key: "closing", label: "Closing", after: true },
];

export const rsSlash = (n) => `${formatRupees(Math.round(Number(n) * 100) / 100)}/-`;
const wordsOnly = (n) => amountToIndianWords(n).replace(/ Only$/, " only");

export function emdContextOf(track, emdAmount, emdAdjusted) {
  if (emdAdjusted > 0) return "converted";
  if (!(emdAmount > 0)) return "none";
  if (track === "refund") return "refunded";
  if (track === "on_completion") return "on_completion";
  return "not_adjusted";
}

export function emdAdjustedFor(track, emdAmount, pbgAmount) {
  return track === "pbg" ? Math.min(Number(emdAmount) || 0, Number(pbgAmount) || 0) : 0;
}

// [S. No., Particulars, Amount] — mirror of pbgNotePdf.ts.
export function pbgCalculationRows({ pbgAmount, consultancyFee, pbgPercent, emdAmount, emdAdjusted, emdContext }) {
  const pbg = Number(pbgAmount) || 0;
  const pct = pbgPercent ? ` (${pbgPercent}% of consultancy fees)` : "";
  const rows = [];
  if (emdContext === "converted") {
    const adjusted = Math.min(emdAdjusted, pbg);
    const remaining = Math.max(0, pbg - adjusted);
    rows.push([`PBG amount${pct}`, rsSlash(pbg)]);
    rows.push(["Less: EMD converted to PBG", rsSlash(adjusted)]);
    rows.push([
      remaining > 0 ? `Remaining PBG to be submitted (${wordsOnly(remaining)})` : "Remaining PBG to be submitted (Nil, fully covered by the EMD)",
      rsSlash(remaining),
    ]);
    if (emdAdjusted > pbg) rows.push(["Excess EMD to be refunded by the client", rsSlash(emdAdjusted - pbg)]);
  } else {
    if (consultancyFee) rows.push(["Consultancy fees (inclusive of GST)", rsSlash(consultancyFee)]);
    rows.push([`PBG amount${pct}`, rsSlash(pbg)]);
    if (emdContext === "refunded") rows.push(["EMD refunded by the client (not adjusted)", rsSlash(emdAmount)]);
    else if (emdContext === "on_completion") rows.push(["EMD to be refunded on completion of the project (not adjusted)", rsSlash(emdAmount)]);
    else if (emdContext === "not_adjusted") rows.push(["EMD (not adjusted)", rsSlash(emdAmount)]);
    rows.push([`Full PBG to be submitted (${wordsOnly(pbg)})`, rsSlash(pbg)]);
  }
  return rows.map(([p, amt], i) => [String(i + 1), p, amt]);
}

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

const blank = (v, placeholder) => (v && String(v).trim() ? String(v).trim() : placeholder);

// Default wording for every paragraph, from the structured fields. The
// editor keeps a paragraph auto-composed until the user types into it.
export function composePbgDefaults({ lead, bpName, fields, pbgAmount, consultancyFee, emdAmount, emdAdjusted, emdContext }) {
  const f = fields || {};
  const pbg = Number(pbgAmount) || 0;
  const instrument = blank(f.instrument, "FDR");
  const title = lead?.title || "the project";
  const client = lead?.client_name || "the client";
  const remaining = Math.max(0, pbg - Math.min(emdAdjusted, pbg));

  const subjectTail = emdContext === "converted"
    ? "EMD Converted to PBG"
    : emdContext === "refunded"
      ? "Full PBG after Refund of EMD"
      : emdContext === "on_completion"
        ? "Full PBG, EMD to be refunded on completion"
        : "Full PBG";

  const award = `AFC has been selected for ${title} by ${client} vide ${blank(f.loa_reference, "LoA no. ________")} dated ${blank(fmtDate(f.loa_date), "________")} (Enclosure-I)${consultancyFee ? ` with consultancy fees of Rs. ${rsSlash(consultancyFee)} inclusive of GST` : ""}.`;

  const partner = bpName
    ? `In this project, AFC is taking services of M/s ${bpName}, as they have been associated with AFC in earlier projects and have successfully delivered them.`
    : "";

  const pct = blank(f.pbg_percent, "");
  const requirement = `Further, in accordance with the LoA, AFC is required to deposit a Performance Bank Guarantee (PBG)${pct ? ` of ${pct}% of the consultancy fees` : ` of Rs. ${rsSlash(pbg)}`} in the form of ${instrument}${f.in_favour_of ? ` in favour of ${f.in_favour_of.trim()}` : ""}${f.payable_at ? `, payable at ${f.payable_at.trim()}` : ""}${f.validity ? `, for a validity of ${f.validity.trim()}` : ""}.`;

  let emd;
  if (emdContext === "converted") {
    emd = `We have already submitted an EMD of Rs. ${rsSlash(emdAmount)} during the RFP stage. As advised by the client, the EMD has been converted to PBG and only the remaining PBG of Rs. ${rsSlash(remaining)} (after adjusting the EMD amount) needs to be submitted (proof of conversion enclosed as Enclosure-II). The calculation is as follows:`;
  } else if (emdContext === "refunded") {
    emd = `AFC had submitted an EMD of Rs. ${rsSlash(emdAmount)} during the RFP stage. The said EMD has since been refunded by the client (proof of refund enclosed as Enclosure-II) and may please be taken on record by the Accounts Department. As the EMD is no longer available for adjustment, the full PBG of Rs. ${rsSlash(pbg)} needs to be submitted. The calculation is as follows:`;
  } else if (emdContext === "on_completion") {
    emd = `AFC had submitted an EMD of Rs. ${rsSlash(emdAmount)} during the RFP stage, which will be refunded by the client on completion of the project and is therefore not available for adjustment. Hence, the full PBG of Rs. ${rsSlash(pbg)} needs to be submitted. The calculation is as follows:`;
  } else if (emdContext === "not_adjusted") {
    emd = `AFC had submitted an EMD of Rs. ${rsSlash(emdAmount)} during the RFP stage, which is not being adjusted against the PBG. Hence, the full PBG of Rs. ${rsSlash(pbg)} needs to be submitted. The calculation is as follows:`;
  } else {
    emd = `The full PBG of Rs. ${rsSlash(pbg)} needs to be submitted. The calculation is as follows:`;
  }

  const delivery = bpName
    ? `It is also requested to please advise the Accounts Department to share the original ${instrument} with M/s ${bpName} at the following address for onward submission to the client at their end:\n[Name]\n[Address]\n[Phone / Email]`
    : `It is also requested to please advise the Accounts Department to share the original ${instrument} for onward submission to the client.`;

  const closing = "In this regard, it is requested to kindly accord your approval on the same, please.";

  const enclosures = [
    `I. Letter of Award (LoA)${f.loa_date ? ` dated ${fmtDate(f.loa_date)}` : ""}`,
    emdContext === "converted" ? "II. Proof of EMD conversion to PBG" : emdContext === "refunded" ? "II. Proof of EMD refund" : "",
  ].filter(Boolean).join("\n");

  return {
    subject: `${title}: Approval for Performance Bank Guarantee in the form of ${instrument} (${subjectTail})`,
    paragraphs: { award, partner, requirement, emd, delivery, closing },
    enclosures,
  };
}

export function parseAmount(raw) {
  if (raw === null || raw === undefined || raw === "") return "";
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}
