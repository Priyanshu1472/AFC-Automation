// src/utils/docxBuilder.js
// Builds the "Consultant Assignment Reference" table (2-column paired layout)
// used for Knowledge Repository exports (Word + PDF preview).

const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function parseSummary(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

export function formatMonth(yyyymm) {
  if (!yyyymm) return "—";
  const [y, m] = String(yyyymm).split("-");
  const mi = parseInt(m, 10) - 1;
  if (!y || isNaN(mi) || mi < 0 || mi > 11) return "—";
  return `${MONTHS_FULL[mi]} ${y}`;
}

export function monthsBetween(start, end) {
  if (!start || !end) return "";
  const [y1, m1] = String(start).split("-").map(Number);
  const [y2, m2] = String(end).split("-").map(Number);
  if (!y1 || !y2 || !m1 || !m2) return "";
  const diff = (y2 - y1) * 12 + (m2 - m1);
  return diff >= 0 ? String(diff) : "";
}

// Pull every template value out of a project (+ its summary blob)
function projectValues(project) {
  const s = parseSummary(project.summary);
  return {
    assignment: project.title || "",
    value:      s.capitalCost ? `Rs. ${s.capitalCost} Crore` : "",
    country:    s.country || "India",
    location:   project.location || "",
    duration:   s.durationMonths || monthsBetween(s.startDate, s.finishDate),
    client:     project.client || "",
    totalSM:    s.totalStaffMonths || "",
    contact:    s.contactPerson || s.clientRepresentative || "",
    title:      s.titleDesignation || "",
    telephone:  s.telephone || "",
    email:      s.email || "",
    startD:     s.startDate  ? formatMonth(s.startDate)  : "",
    finishD:    s.finishDate ? formatMonth(s.finishDate) : "",
    profSM:     s.associatedConsultantMonths || "",
    assoc:      s.associatedConsultants || "",
    senior:     s.seniorProfessionalStaff || "",
    brief:      s.projectBriefDescription || "",
    services:   s.servicesDescription || "",
  };
}

// ────────────────────────────────────────────────────────────
//  DOCX ROWS  — returns { rows, TW, colWidths }
// ────────────────────────────────────────────────────────────
export function buildProjectRows(project, keywords = [], selectedKwNames = [], docx, index = 1 /*, documents */) {
  const {
    Paragraph, TextRun, TableRow, TableCell,
    BorderStyle, WidthType, VerticalAlign, AlignmentType,
  } = docx;

  const FONT = "Times New Roman";
  const SIZE = 20;

  const B            = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
  const CELL_BORDERS = { top: B, bottom: B, left: B, right: B };
  const CELL_MARGINS = { top: 40, bottom: 40, left: 80, right: 80 };

  const TW    = 10466;
  const COL_W = Math.round(TW / 2);
  const colWidths = [COL_W, COL_W];

  const v = projectValues(project);

  const run = (text, bold = false) =>
    new TextRun({ text: text == null ? "" : String(text), bold, font: FONT, size: SIZE });

  const field = (label, value) =>
    new Paragraph({ spacing: { after: 20 }, children: [run(label, true), run(value ? " " + value : "")] });

  const plain = (text, bold = false) =>
    new Paragraph({ spacing: { after: 20 }, children: [run(text, bold)] });

  const cell = (children, { span, width } = {}) =>
    new TableCell({
      width:         { size: width || COL_W, type: WidthType.DXA },
      columnSpan:    span || 1,
      verticalAlign: VerticalAlign.TOP,
      margins:       CELL_MARGINS,
      borders:       CELL_BORDERS,
      children,
    });

  const selSet = new Set(selectedKwNames || []);
  const kwSel  = (keywords || []).filter(k => selSet.has(k.name) && (k.description || "").trim());

  const rows = [];

  rows.push(new TableRow({ children: [
    cell([ new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`Assignment ${index}`, true)] }) ],
      { span: 2, width: TW }),
  ]}));

  rows.push(new TableRow({ children: [
    cell([ field("Assignment name:", v.assignment) ]),
    cell([ field("Approx. value of the contract:", v.value) ]),
  ]}));

  rows.push(new TableRow({ children: [
    cell([ field("Country:", v.country), field("Location within country:", v.location) ]),
    cell([ field("Duration of assignment (months):", v.duration) ]),
  ]}));

  rows.push(new TableRow({ children: [
    cell([ field("Name of Client:", v.client) ]),
    cell([ field("Total No. of staff-months of the assignment:", v.totalSM) ]),
  ]}));

  rows.push(new TableRow({ children: [
    cell([ field("Contact Person:", v.contact), field("Title/Designation:", v.title) ]),
    cell([ field("Telephone:", v.telephone), field("Email:", v.email) ]),
  ]}));

  rows.push(new TableRow({ children: [
    cell([ field("Start date (month/year):", v.startD), field("Completion date (month/year):", v.finishD) ]),
    cell([ field("No. of professional staff-months provided by your consulting firm/organization or your sub consultants:", v.profSM) ]),
  ]}));

  rows.push(new TableRow({ children: [
    cell([ field("Name of associated Consultants, if any:", v.assoc) ]),
    cell([ field("Name of senior professional staff of your consulting firm / organization involved and designation and / or functions performed (e.g. Project Director/Coordinator, Team Leader):", v.senior) ]),
  ]}));

  rows.push(new TableRow({ children: [
    cell([ plain("Description of Project:", true), plain(v.brief || "—") ], { span: 2, width: TW }),
  ]}));

  const svc = [ plain("Description of actual services provided by your staff within the assignment:", true) ];
  if (v.services) svc.push(plain(v.services));
  kwSel.forEach(k => svc.push(new Paragraph({
    spacing: { after: 20 },
    children: [ run("• " + k.name + ": ", true), run(k.description) ],
  })));
  if (!v.services && !kwSel.length) svc.push(plain("—"));
  rows.push(new TableRow({ children: [ cell(svc, { span: 2, width: TW }) ]}));

  return { rows, TW, colWidths };
}

// ────────────────────────────────────────────────────────────
//  PREVIEW HTML
// ────────────────────────────────────────────────────────────
export function buildPreviewHTML(project, keywords = [], selectedKwNames = [], index = 1 /*, documents */) {
  const v = projectValues(project);

  const esc = (x) => (x == null ? "" : String(x)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));

  const f = (label, value) =>
    `<strong>${esc(label)}</strong>${value ? " " + esc(value) : ""}`;

  const selSet = new Set(selectedKwNames || []);
  const kwSel  = (keywords || []).filter(k => selSet.has(k.name) && (k.description || "").trim());

  let svcHtml = v.services ? `<p>${esc(v.services)}</p>` : "";
  if (kwSel.length) {
    svcHtml += "<ul style='margin:4px 0 0 18px;padding:0;'>" +
      kwSel.map(k => `<li><strong>${esc(k.name)}:</strong> ${esc(k.description)}</li>`).join("") +
      "</ul>";
  }
  if (!svcHtml) svcHtml = "—";

  const td = 'style="width:50%;vertical-align:top;"';

  return `
<table>
  <tr><td colspan="2" style="text-align:center;font-weight:bold;">Assignment ${index}</td></tr>
  <tr>
    <td ${td}>${f("Assignment name:", v.assignment)}</td>
    <td ${td}>${f("Approx. value of the contract:", v.value)}</td>
  </tr>
  <tr>
    <td ${td}>${f("Country:", v.country)}<br>${f("Location within country:", v.location)}</td>
    <td ${td}>${f("Duration of assignment (months):", v.duration)}</td>
  </tr>
  <tr>
    <td ${td}>${f("Name of Client:", v.client)}</td>
    <td ${td}>${f("Total No. of staff-months of the assignment:", v.totalSM)}</td>
  </tr>
  <tr>
    <td ${td}>${f("Contact Person:", v.contact)}<br>${f("Title/Designation:", v.title)}</td>
    <td ${td}>${f("Telephone:", v.telephone)}<br>${f("Email:", v.email)}</td>
  </tr>
  <tr>
    <td ${td}>${f("Start date (month/year):", v.startD)}<br>${f("Completion date (month/year):", v.finishD)}</td>
    <td ${td}>${f("No. of professional staff-months provided by your consulting firm/organization or your sub consultants:", v.profSM)}</td>
  </tr>
  <tr>
    <td ${td}>${f("Name of associated Consultants, if any:", v.assoc)}</td>
    <td ${td}>${f("Name of senior professional staff of your consulting firm / organization involved and designation and / or functions performed (e.g. Project Director/Coordinator, Team Leader):", v.senior)}</td>
  </tr>
  <tr><td colspan="2"><strong>Description of Project:</strong><br>${esc(v.brief) || "—"}</td></tr>
  <tr><td colspan="2"><strong>Description of actual services provided by your staff within the assignment:</strong><br>${svcHtml}</td></tr>
</table>
`;
}

// ────────────────────────────────────────────────────────────
//  PRINT / PDF  — prints the preview HTML inside an isolated
//  iframe so the app's CSS (cards, dark mode) never leaks in.
//  Styles below mirror the DOCX: Times New Roman 10pt,
//  0.5pt black borders, 2pt/4pt cell padding, A4 with 12.7mm margins.
// ────────────────────────────────────────────────────────────
export function printHtml(html, title = "project") {
  const old = document.getElementById("__afc_print_frame");
  if (old) old.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "__afc_print_frame";
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed", right: "0", bottom: "0",
    width: "0", height: "0", border: "0", visibility: "hidden",
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  const escT = (s) => String(s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  doc.open();
  doc.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escT(title)}</title>
<style>
  @page { size: A4 portrait; margin: 12.7mm; }
  html, body {
    margin: 0; padding: 0;
    background: #fff; color: #000;
    font-family: "Times New Roman", Times, serif;
    font-size: 10pt; line-height: 1.3;
    color-scheme: light;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  td, th {
    border: 0.5pt solid #000;
    padding: 2pt 4pt;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  p  { margin: 0 0 2pt 0; }
  ul { margin: 2pt 0 0 14pt; padding: 0; }
  li { margin: 0 0 2pt 0; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  img { max-width: 100%; height: auto; }
</style></head>
<body>${html}</body></html>`);
  doc.close();

  const fire = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {
      console.error("Print failed:", e);
    } finally {
      setTimeout(() => iframe.remove(), 60000);
    }
  };

  if (doc.readyState === "complete") fire();
  else iframe.onload = fire;
}