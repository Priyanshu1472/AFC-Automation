// What AFC's client invoice says, for the on-screen invoice editor — kept
// in step with the PDF (supabase/functions/_shared/clientInvoicePdf.ts), so
// the page you fill in reads exactly like the document that's generated.

export const AFC_TAX_DETAILS = [
  ["Our PAN Number", "AAACA8315K"],
  ["GST Regn. No", "07AAACA8315K1ZP"],
  ["HSN Code", "998311"],
  ["MSME Registration", "UDYAM-MH-19-0025013"],
];

export const AFC_ACCOUNT_HOLDER = [
  ["NAME OF ACCOUNT HOLDER", "AFC INDIA LIMITED"],
  ["COMPLETE ADDRESS", "DHANRAJ MAHAL, 1st FLOOR, CSM MARG, MUMBAI-400001"],
  ["TELEPHONE/FAX NO.", "022-22028924, FAX No. 022-22028966"],
  ["E-mail Address", "afcindia.delhi@gmail.com; accounts@afcindia.org.in"],
];

export const AFC_BANK = [
  ["BANK NAME", "CENTRAL BANK OF INDIA"],
  ["BRANCH NAME AND COMPLETE ADDRESS", "MUMBAI MAIN BRANCH, MG ROAD, FORT, MUMBAI-400001"],
  ["WHETHER THE BANK IS COMPUTERIZED", "YES"],
  ["WHETHER THE BRANCH IS RTGS ENABLED", "YES"],
  ["TYPE OF ACCOUNT", "CASH CREDIT"],
  ["BANK ACCOUNT NO.", "1787433135"],
  ["9 DIGIT CODE NO. OF THE BANK", "400016071"],
  ["IFSC CODE", "CBIN0280621"],
];

export function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// "Rs. 8,50,000/-" — paise only when there are any.
export function rs(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const txt = Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Rs. ${txt}/-`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const three = (n) => {
  const h = Math.floor(n / 100), r = n % 100;
  if (h && r) return `${ONES[h]} Hundred ${two(r)}`;
  return h ? `${ONES[h]} Hundred` : two(r);
};

// Indian numbering (crore / lakh / thousand), whole rupees — e.g.
// 850000 → "Eight Lakh Fifty Thousand".
export function amountInWords(amount) {
  let n = Math.round(Math.abs(Number(amount || 0)));
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  return [
    crore ? `${three(crore)} Crore` : "",
    lakh ? `${two(lakh)} Lakh` : "",
    thousand ? `${two(thousand)} Thousand` : "",
    n ? three(n) : "",
  ].filter(Boolean).join(" ");
}

export function formatDDMMYYYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// "completion of Milestone “X”" / "submission of Deliverables “A” and “B”"
export function dueOnPhrase(items) {
  if (!items.length) return "the agreed milestone";
  const titles = items.map((i) => `“${i.title}”`);
  const joined = titles.length > 1 ? `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}` : titles[0];
  if (items.every((i) => i.kind === "milestone")) return `completion of ${items.length > 1 ? "Milestones" : "Milestone"} ${joined}`;
  return `submission of ${items.length > 1 ? "Deliverables" : "Deliverable"} ${joined}`;
}
