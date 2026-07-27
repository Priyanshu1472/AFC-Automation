// src/pages/empanelment/EmpanelmentReportsPage.jsx
// Report registry pattern ported from the previous AFC empanelment app
// (BA-Empanelment-AFC1/src/modules/afc/BaReportsSection.jsx), adapted to
// this project's schema (empanelment_applications + ba_registrations,
// RLS-scoped — no client-side owner filtering needed, unlike the old app).
// Adding a report = one more object in REPORTS.
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { TEAMS, OFFICES, can } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import DatePickerCalendar from "../../components/ui/DatePickerCalendar";
import PageLoader from "../../components/ui/PageLoader";
import FilterDrawer, { FilterButton, FilterField } from "../../components/ui/FilterDrawer";
import PreviewModal from "../../components/ui/PreviewModal";
import "../../styles/EmpanelmentReportsPage.css";

const PIPELINE = ["sent", "filled", "po_review", "cfo_cs_review", "po_final_review", "dgm_review", "md_review", "accepted", "rejected", "on_hold"];
const STATUS_LABELS = {
  sent: "Sent", filled: "BA Filled", po_review: "PO Review", cfo_cs_review: "CFO / CS",
  po_final_review: "PO Final", dgm_review: "DGM Review", md_review: "MD Review",
  accepted: "Accepted", rejected: "Rejected", on_hold: "On Hold",
};
const TERMINAL = ["accepted", "rejected"];

const dash = (v) => (v === 0 ? 0 : v || "—");
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const isAccepted = (a) => a.status === "accepted";
const isRejected = (a) => a.status === "rejected";
const isInProgress = (a) => !TERMINAL.includes(a.status) && a.status !== "sent";
const isAwaitingBA = (a) => a.status === "sent" || a.status === "filled";

function fmt(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
const dateKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const daysFrom = (d) => (d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null);
const daysBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000)) : null);
const codeOf = (a) => a.application_code || "—";
const sectorsOf = (a) => (Array.isArray(a.reg_sectors_served) ? a.reg_sectors_served : []);

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
const avg = (nums) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0);

function groupBy(arr, keyFn) {
  const m = new Map();
  arr.forEach((x) => {
    const k = keyFn(x) || "—";
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  });
  return m;
}

function applyFilters(apps, f) {
  const from = f.from ? dateKey(f.from) : "";
  const to = f.to ? dateKey(f.to) : "";
  return apps.filter((a) => {
    if (f.team !== "all" && a.team !== f.team) return false;
    if (f.office !== "all" && a.office !== f.office) return false;
    if (f.status !== "all" && a.status !== f.status) return false;
    if (f.sector !== "all" && !sectorsOf(a).includes(f.sector)) return false;
    if (from && dateKey(a.created_at) < from) return false;
    if (to && dateKey(a.created_at) > to) return false;
    return true;
  });
}

// ── REPORT REGISTRY ──────────────────────────────────────────
const REPORTS = [
  {
    id: "status_summary", group: "Overview", title: "Status Summary",
    desc: "Headline counts across the whole pipeline, with the acceptance rate.",
    build: ({ apps }) => {
      const total = apps.length, acc = apps.filter(isAccepted).length, rej = apps.filter(isRejected).length;
      const prog = apps.filter(isInProgress).length, wait = apps.filter(isAwaitingBA).length;
      return {
        kpis: [
          { label: "Total Applications", value: total }, { label: "Empanelled", value: acc },
          { label: "Rejected", value: rej }, { label: "In Progress", value: prog },
          { label: "Awaiting BA Fill", value: wait }, { label: "Acceptance Rate", value: pct(acc, acc + rej) + "%" },
        ],
        columns: [{ key: "status", label: "Status" }, { key: "count", label: "Count" }, { key: "share", label: "Share %" }],
        rows: [
          { status: "Awaiting BA Fill", count: wait, share: pct(wait, total) },
          { status: "In Progress", count: prog, share: pct(prog, total) },
          { status: "Empanelled", count: acc, share: pct(acc, total) },
          { status: "Rejected", count: rej, share: pct(rej, total) },
          { status: "Total", count: total, share: 100 },
        ],
      };
    },
  },
  {
    id: "status_list", group: "Overview", title: "Application Status Report",
    desc: "Current pipeline snapshot — every application with its stage and days elapsed.",
    build: ({ apps }) => ({
      columns: [
        { key: "org_name", label: "Organisation" }, { key: "code", label: "App Code" }, { key: "ba_email", label: "BA Email" },
        { key: "team", label: "Team" }, { key: "office", label: "Office" }, { key: "po", label: "Project Officer" },
        { key: "status_label", label: "Status" }, { key: "sent_f", label: "Sent On" }, { key: "days", label: "Days in Pipeline" },
        { key: "provisional", label: "Provisional Sent" },
      ],
      rows: apps.map((a) => ({
        org_name: dash(a.reg_org_name), code: codeOf(a), ba_email: dash(a.ba_email), team: dash(a.team),
        office: dash(a.office), po: dash(a.po_name), status_label: STATUS_LABELS[a.status] || a.status,
        sent_f: fmt(a.created_at), days: daysFrom(a.created_at) ?? "—", provisional: a.provisional_letter_sent ? "Yes" : "No",
      })),
    }),
  },
  {
    id: "monthly", group: "Overview", title: "Monthly Trend",
    desc: "Applications raised per month, with how many were empanelled or rejected.",
    build: ({ apps }) => {
      const g = groupBy(apps, (a) => (a.created_at ? new Date(a.created_at).toISOString().slice(0, 7) : "—"));
      return {
        columns: [
          { key: "month", label: "Month" }, { key: "total", label: "Raised" }, { key: "accepted", label: "Empanelled" },
          { key: "rejected", label: "Rejected" }, { key: "progress", label: "In Progress" }, { key: "rate", label: "Acceptance %" },
        ],
        rows: [...g.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, arr]) => {
          const acc = arr.filter(isAccepted).length, rej = arr.filter(isRejected).length;
          return {
            month: key === "—" ? "—" : new Date(key + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
            total: arr.length, accepted: acc, rejected: rej, progress: arr.filter(isInProgress).length, rate: pct(acc, acc + rej),
          };
        }),
      };
    },
  },
  {
    id: "funnel", group: "Pipeline", title: "Stage-wise Funnel",
    desc: "How many applications currently sit at each stage of the approval chain.",
    build: ({ apps }) => ({
      columns: [{ key: "name", label: "Status" }, { key: "count", label: "Count" }, { key: "share", label: "Share %" }],
      rows: PIPELINE.map((s) => {
        const c = apps.filter((a) => a.status === s).length;
        return { name: STATUS_LABELS[s], count: c, share: pct(c, apps.length) };
      }),
    }),
  },
  {
    id: "ageing", group: "Pipeline", title: "Ageing / Stuck Applications",
    desc: "Open applications sorted by how long they've been sitting in the pipeline.",
    build: ({ apps }) => {
      const rows = apps.filter((a) => !TERMINAL.includes(a.status)).map((a) => ({
        org_name: dash(a.reg_org_name), code: codeOf(a), ba_email: dash(a.ba_email), team: dash(a.team),
        status_label: STATUS_LABELS[a.status] || a.status, sent_f: fmt(a.created_at), days: daysFrom(a.created_at) ?? 0,
      })).sort((x, y) => y.days - x.days);
      return {
        kpis: [
          { label: "Open Applications", value: rows.length },
          { label: "Older Than 30 Days", value: rows.filter((r) => r.days > 30).length },
          { label: "Oldest (days)", value: rows[0]?.days ?? 0 },
        ],
        columns: [
          { key: "org_name", label: "Organisation" }, { key: "code", label: "App Code" }, { key: "ba_email", label: "BA Email" },
          { key: "team", label: "Team" }, { key: "status_label", label: "Stuck At" }, { key: "sent_f", label: "Sent On" }, { key: "days", label: "Days Open" },
        ],
        rows,
      };
    },
  },
  {
    id: "tat", group: "Pipeline", title: "Turnaround Time",
    desc: "For empanelled BAs: days taken from sent to the final accept decision.",
    build: ({ apps }) => {
      const done = apps.filter((a) => isAccepted(a) && a.decided_at);
      const tats = done.map((a) => daysBetween(a.created_at, a.decided_at)).filter((n) => n !== null);
      const rows = done.map((a) => ({
        org_name: dash(a.reg_org_name), code: codeOf(a), team: dash(a.team), sent_f: fmt(a.created_at),
        decided_f: fmt(a.decided_at), tat: daysBetween(a.created_at, a.decided_at) ?? "—",
      })).sort((x, y) => (y.tat || 0) - (x.tat || 0));
      return {
        kpis: [
          { label: "Empanelled", value: done.length }, { label: "Average TAT (days)", value: avg(tats) },
          { label: "Median TAT (days)", value: median(tats) },
        ],
        columns: [
          { key: "org_name", label: "Organisation" }, { key: "code", label: "App Code" }, { key: "team", label: "Team" },
          { key: "sent_f", label: "Sent On" }, { key: "decided_f", label: "Accepted On" }, { key: "tat", label: "TAT (days)" },
        ],
        rows,
      };
    },
  },
  {
    id: "form_gap", group: "Pipeline", title: "BA Form Response Time",
    desc: "How long each Business Associate took to fill the form after being sent the invite.",
    build: ({ apps }) => {
      const filled = apps.filter((a) => a.form_submitted_at);
      const gaps = filled.map((a) => daysBetween(a.created_at, a.form_submitted_at)).filter((n) => n !== null);
      return {
        kpis: [
          { label: "Forms Submitted", value: filled.length }, { label: "Still Awaiting", value: apps.filter((a) => a.status === "sent").length },
          { label: "Average (days)", value: avg(gaps) }, { label: "Median (days)", value: median(gaps) },
        ],
        columns: [
          { key: "org_name", label: "Organisation" }, { key: "code", label: "App Code" }, { key: "ba_email", label: "BA Email" },
          { key: "sent_f", label: "Sent On" }, { key: "filled_f", label: "Form Filled On" }, { key: "gap", label: "Days Taken" },
        ],
        rows: filled.map((a) => ({
          org_name: dash(a.reg_org_name), code: codeOf(a), ba_email: dash(a.ba_email),
          sent_f: fmt(a.created_at), filled_f: fmt(a.form_submitted_at), gap: daysBetween(a.created_at, a.form_submitted_at) ?? "—",
        })).sort((x, y) => (y.gap || 0) - (x.gap || 0)),
      };
    },
  },
  {
    id: "provisional", group: "Pipeline", title: "Provisional Letter Status",
    desc: "Which applications have had a provisional letter issued, and which are still pending.",
    build: ({ apps }) => {
      const sent = apps.filter((a) => a.provisional_letter_sent);
      return {
        kpis: [
          { label: "Letters Sent", value: sent.length }, { label: "Pending", value: apps.length - sent.length },
          { label: "Coverage", value: pct(sent.length, apps.length) + "%" },
        ],
        columns: [
          { key: "org_name", label: "Organisation" }, { key: "code", label: "App Code" }, { key: "team", label: "Team" },
          { key: "status_label", label: "Status" }, { key: "provisional", label: "Sent" }, { key: "prov_f", label: "Sent On" },
        ],
        rows: apps.map((a) => ({
          org_name: dash(a.reg_org_name), code: codeOf(a), team: dash(a.team), status_label: STATUS_LABELS[a.status] || a.status,
          provisional: a.provisional_letter_sent ? "Yes" : "No", prov_f: fmt(a.provisional_sent_at),
        })),
      };
    },
  },
  {
    id: "team", group: "Teams & People", title: "Team Performance",
    desc: "Per-team applications raised, empanelled, rejected and still open.",
    build: ({ apps }) => ({
      columns: [
        { key: "team", label: "Team" }, { key: "total", label: "Raised" }, { key: "accepted", label: "Empanelled" },
        { key: "rejected", label: "Rejected" }, { key: "progress", label: "In Progress" }, { key: "rate", label: "Acceptance %" },
      ],
      rows: [...groupBy(apps, (a) => a.team)].map(([team, arr]) => {
        const acc = arr.filter(isAccepted).length, rej = arr.filter(isRejected).length;
        return { team, total: arr.length, accepted: acc, rejected: rej, progress: arr.filter(isInProgress).length, rate: pct(acc, acc + rej) };
      }).sort((x, y) => y.total - x.total),
    }),
  },
  {
    id: "officer", group: "Teams & People", title: "Project Officer Performance",
    desc: "Applications grouped by the assigned Project Officer.",
    build: ({ apps }) => ({
      columns: [
        { key: "officer", label: "Project Officer" }, { key: "team", label: "Team" }, { key: "total", label: "Assigned" },
        { key: "accepted", label: "Empanelled" }, { key: "rejected", label: "Rejected" }, { key: "open", label: "Still Open" }, { key: "rate", label: "Acceptance %" },
      ],
      rows: [...groupBy(apps, (a) => a.po_name || "—")].map(([officer, arr]) => {
        const acc = arr.filter(isAccepted).length, rej = arr.filter(isRejected).length;
        return {
          officer, team: arr[0]?.team || "—", total: arr.length, accepted: acc, rejected: rej,
          open: arr.filter((a) => !TERMINAL.includes(a.status)).length, rate: pct(acc, acc + rej),
        };
      }).sort((x, y) => y.total - x.total),
    }),
  },
  {
    id: "office", group: "Teams & People", title: "Office-wise Distribution",
    desc: "Applications and empanelments broken down by originating office.",
    build: ({ apps }) => ({
      columns: [
        { key: "office", label: "Office" }, { key: "total", label: "Raised" }, { key: "accepted", label: "Empanelled" },
        { key: "rejected", label: "Rejected" }, { key: "open", label: "Still Open" }, { key: "rate", label: "Acceptance %" },
      ],
      rows: [...groupBy(apps, (a) => a.office)].map(([office, arr]) => {
        const acc = arr.filter(isAccepted).length, rej = arr.filter(isRejected).length;
        return { office, total: arr.length, accepted: acc, rejected: rej, open: arr.filter((a) => !TERMINAL.includes(a.status)).length, rate: pct(acc, acc + rej) };
      }).sort((x, y) => y.total - x.total),
    }),
  },
  {
    id: "sector", group: "Empanelment", title: "Sector-wise Distribution",
    desc: "Which sectors our BAs cover. One BA can appear under several sectors.",
    build: ({ apps }) => {
      const counts = new Map();
      apps.forEach((a) => {
        const acc = isAccepted(a);
        sectorsOf(a).forEach((s) => {
          if (!counts.has(s)) counts.set(s, { total: 0, accepted: 0 });
          const c = counts.get(s);
          c.total++; if (acc) c.accepted++;
        });
      });
      return {
        kpis: [{ label: "Distinct Sectors", value: counts.size }],
        columns: [{ key: "sector", label: "Sector" }, { key: "total", label: "Applications" }, { key: "accepted", label: "Empanelled" }, { key: "rate", label: "Empanelled %" }],
        rows: [...counts.entries()].map(([sector, c]) => ({ sector, total: c.total, accepted: c.accepted, rate: pct(c.accepted, c.total) })).sort((x, y) => y.total - x.total),
      };
    },
  },
  {
    id: "rejected", group: "Empanelment", title: "Rejected Applications",
    desc: "Applications that were turned down, with the final remark on record.",
    build: ({ apps }) => {
      const rows = apps.filter(isRejected).map((a) => ({
        org_name: dash(a.reg_org_name), code: codeOf(a), ba_email: dash(a.ba_email), team: dash(a.team),
        reason: dash(a.md_remarks || a.dgm_comment), sent_f: fmt(a.created_at), decided_f: fmt(a.decided_at),
      }));
      return { kpis: [{ label: "Rejected", value: rows.length }], columns: [
        { key: "org_name", label: "Organisation" }, { key: "code", label: "App Code" }, { key: "ba_email", label: "BA Email" },
        { key: "team", label: "Team" }, { key: "reason", label: "Reason / Remark" }, { key: "sent_f", label: "Sent On" }, { key: "decided_f", label: "Decided On" },
      ], rows };
    },
  },
];

function groupReports(reports) {
  const order = [], map = new Map();
  reports.forEach((r) => {
    const g = r.group || "Reports";
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g).push(r);
  });
  return order.map((g) => ({ group: g, items: map.get(g) }));
}

function buildFilterLine(filters) {
  const bits = [`Team: ${filters.team === "all" ? "All" : filters.team}`];
  if (filters.office !== "all") bits.push(`Office: ${filters.office}`);
  if (filters.status !== "all") bits.push(`Status: ${STATUS_LABELS[filters.status] || filters.status}`);
  if (filters.sector !== "all") bits.push(`Sector: ${filters.sector}`);
  if (filters.from || filters.to) bits.push(`Date: ${filters.from ? fmt(filters.from) : "…"} – ${filters.to ? fmt(filters.to) : "…"}`);
  return bits.join("  ·  ");
}

function fileBase(report) {
  return `AFC_Empanelment_${report.id}_${new Date().toISOString().slice(0, 10)}`;
}

// Sheet names can't contain : \ / ? * [ ] and are capped at 31 chars.
function sheetName(title) {
  return (title || "Report").replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Report";
}

// Single sheet — header info, KPI summary, then the full data table with
// autofilter enabled on the header row so the numbers are actually easy to
// sort/filter/analyse inside Excel itself, not just a flat dump. (This
// package's writer doesn't support cell styling like bold/fills, so section
// labels are plain text rather than bold — autofilter is the meaningful win
// here.) Column widths are sized off real cell content, not just the label,
// so text doesn't read as clipped/sparse.
function exportExcel(report, output, filters) {
  const rows = [];
  rows.push(["AFC India Limited"]);
  rows.push([`Report: ${report.title}`]);
  rows.push([`Filters: ${buildFilterLine(filters)}`]);
  rows.push([`Generated: ${new Date().toLocaleString("en-IN")}`]);
  rows.push([]);

  if (output.kpis?.length) {
    rows.push(["SUMMARY"]);
    output.kpis.forEach((k) => rows.push([k.label, k.value]));
    rows.push([]);
  }

  const headerRowIndex = rows.length;
  rows.push(output.columns.map((c) => c.label));
  output.rows.forEach((row) => rows.push(output.columns.map((c) => row[c.key] ?? "")));
  rows.push([]);
  rows.push([`Total records: ${output.rows.length}`]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = output.columns.map((c) => {
    const maxLen = output.rows.reduce((max, row) => Math.max(max, String(row[c.key] ?? "").length), c.label.length);
    return { wch: Math.min(Math.max(maxLen + 2, 10), 60) };
  });

  if (output.rows.length > 0) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: headerRowIndex, c: 0 },
        e: { r: headerRowIndex + output.rows.length, c: output.columns.length - 1 },
      }),
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName(report.title));
  XLSX.writeFile(wb, `${fileBase(report)}.xlsx`);
}

function escapeHtml(val) {
  return String(val).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// HTML mirror of the PDF/Excel content, shown in PreviewModal before the
// user commits to the actual PDF download.
function buildReportPreviewHTML(report, output, filters) {
  const kpisHtml = output.kpis?.length
    ? `<p><strong>Summary:</strong> ${output.kpis.map((k) => `${escapeHtml(k.label)}: ${escapeHtml(k.value)}`).join(" &nbsp;|&nbsp; ")}</p>`
    : "";
  const headHtml = `<tr>${output.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  const bodyHtml = output.rows.length
    ? output.rows.map((row) => `<tr>${output.columns.map((c) => `<td>${escapeHtml(row[c.key] ?? "—")}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${output.columns.length}">No data for the selected filters.</td></tr>`;

  return `
    <p><strong>AFC India Limited</strong></p>
    <p>${escapeHtml(report.title)}</p>
    <p style="font-size:8pt;color:#666;">${escapeHtml(buildFilterLine(filters))}</p>
    <p style="font-size:8pt;color:#666;">Generated ${escapeHtml(new Date().toLocaleString("en-IN"))}</p>
    ${kpisHtml}
    <table><thead>${headHtml}</thead><tbody>${bodyHtml}</tbody></table>
    <p style="font-size:8pt;color:#666;">Total records: ${output.rows.length}</p>
  `;
}

function exportPDF(report, output, filters) {
  const landscape = output.columns.length > 6;
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const M = 40;
  doc.setFontSize(15); doc.setFont(undefined, "bold");
  doc.text("AFC India Limited", M, 40);
  doc.setFontSize(11); doc.setFont(undefined, "normal");
  doc.text(report.title, M, 58);
  doc.setFontSize(8); doc.setTextColor(110);
  doc.text(buildFilterLine(filters), M, 72, { maxWidth: doc.internal.pageSize.getWidth() - M * 2 });
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, M, 84);
  doc.setTextColor(0);

  let startY = 100;
  if (output.kpis?.length) {
    autoTable(doc, { startY, body: [output.kpis.map((k) => `${k.label}: ${k.value}`)], theme: "plain", styles: { fontSize: 8, fontStyle: "bold", textColor: [40, 40, 40] } });
    startY = doc.lastAutoTable.finalY + 8;
  }
  autoTable(doc, {
    startY, head: [output.columns.map((c) => c.label)], body: output.rows.map((row) => output.columns.map((c) => String(row[c.key] ?? ""))),
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" }, headStyles: { fillColor: [34, 34, 34], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 245, 245] }, margin: { left: M, right: M },
    didDrawPage: () => {
      const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
      doc.setFontSize(7); doc.setTextColor(150);
      doc.text("AFC India Limited — Confidential", M, h - 20);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, w - M, h - 20, { align: "right" });
      doc.setTextColor(0);
    },
  });
  doc.save(`${fileBase(report)}.pdf`);
}

// ── Icons ─────────────────────────────────────────────────────
const GroupIcon = {
  "Overview": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>,
  "Pipeline": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>,
  "Teams & People": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>,
  "Empanelment": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>,
};
const IconSearch = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
const IconSort = { none: "↕", asc: "↑", desc: "↓" };

// ── UI ────────────────────────────────────────────────────────
function ReportPreview({ report, output, onExcel, onPdf }) {
  const cols = output?.columns || [];
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: null, dir: "asc" });

  // Reset the interactive table state whenever the underlying report
  // changes — a stale sort/search from the previous report makes no sense
  // against a different column set.
  useEffect(() => { setSearch(""); setSort({ key: null, dir: "asc" }); }, [report.id]);

  const rows = useMemo(() => {
    let list = output?.rows || [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((row) => cols.some((c) => String(row[c.key] ?? "").toLowerCase().includes(q)));
    }
    if (sort.key) {
      list = [...list].sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [output, search, sort, cols]);

  const empty = (output?.rows || []).length === 0;
  const noMatches = !empty && rows.length === 0;

  function toggleSort(key) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  return (
    <Card className="erp-preview">
      <Card.Header
        title={report.title}
        subtitle={report.desc}
        action={
          <div className="erp-dl-btns">
            <Button variant="secondary" size="sm" disabled={empty} onClick={onExcel}>Excel</Button>
            <Button variant="primary" size="sm" disabled={empty} onClick={onPdf}>PDF</Button>
          </div>
        }
      />
      <Card.Body>
        {output?.kpis?.length > 0 && (
          <div className="erp-kpis">
            {output.kpis.map((k, i) => (
              <div key={k.label} className={`erp-kpi erp-kpi-${i % 4}`}>
                <div className="erp-kpi-value">{k.value}</div>
                <div className="erp-kpi-label">{k.label}</div>
              </div>
            ))}
          </div>
        )}
        {!empty && (
          <div className="erp-search-row">
            <span className="erp-search-icon">{IconSearch}</span>
            <input className="input erp-search-input" placeholder={`Search within ${rows.length !== (output?.rows || []).length ? rows.length + " of " : ""}${(output?.rows || []).length} rows…`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {empty ? (
          <p className="text-secondary text-sm">No data for the selected filters.</p>
        ) : noMatches ? (
          <p className="text-secondary text-sm">No rows match &quot;{search}&quot;.</p>
        ) : (
          <div className="table-wrapper erp-table-wrap">
            <table className="table erp-table">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} className="erp-th-sortable" onClick={() => toggleSort(c.key)}>
                      {c.label} <span className={`erp-sort-icon${sort.key === c.key ? " erp-sort-icon-active" : ""}`}>{sort.key === c.key ? IconSort[sort.dir] : IconSort.none}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>{cols.map((c) => <td key={c.key} title={String(row[c.key] ?? "")}>{row[c.key] ?? "—"}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

// Slide-in drawer, matching the old project's report filter UX — filters
// stay out of the way until asked for, instead of a permanent row of
// selects eating vertical space above every report. Every other list/search
// page in the app uses the same shared FilterDrawer for consistency.
function ReportFilterDrawer({ open, onClose, filters, set, onReset, officeOptions, sectorOptions, canFilterTeamOffice }) {
  return (
    <FilterDrawer open={open} onClose={onClose} onReset={onReset} title="Filters">
      <FilterField label="Team">
        <Select disabled={!canFilterTeamOffice} value={filters.team} onChange={(v) => set("team", v)} placeholder="All Teams" options={[{ value: "all", label: "All Teams" }, ...TEAMS.map((t) => ({ value: t, label: t }))]} />
      </FilterField>
      <FilterField label="Office">
        <Select disabled={!canFilterTeamOffice} value={filters.office} onChange={(v) => set("office", v)} placeholder="All Offices" options={[{ value: "all", label: "All Offices" }, ...officeOptions.map((o) => ({ value: o, label: o.charAt(0).toUpperCase() + o.slice(1) }))]} />
      </FilterField>
      <FilterField label="Status">
        <Select value={filters.status} onChange={(v) => set("status", v)} placeholder="All Statuses" options={[{ value: "all", label: "All Statuses" }, ...PIPELINE.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]} />
      </FilterField>
      {sectorOptions.length > 0 && (
        <FilterField label="Sector">
          <Select value={filters.sector} onChange={(v) => set("sector", v)} placeholder="All Sectors" options={[{ value: "all", label: "All Sectors" }, ...sectorOptions.map((s) => ({ value: s, label: s }))]} />
        </FilterField>
      )}
      <FilterField label="Date From">
        <DatePickerCalendar value={filters.from} onChange={(v) => set("from", v)} placeholder="Start date" />
      </FilterField>
      <FilterField label="Date To">
        <DatePickerCalendar value={filters.to} onChange={(v) => set("to", v)} placeholder="End date" />
      </FilterField>
    </FilterDrawer>
  );
}

const IconChevron = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>;
const IconCheck = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;

// Every report, in one dropdown — the compact alternative to the sidebar
// list on narrower screens (see .erp-picker-wrap in the CSS for where each
// is actually shown).
function ReportPicker({ groups, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const current = groups.find((g) => g.items.some((r) => r.id === selectedId));
  const report = current?.items.find((r) => r.id === selectedId);

  return (
    <div className="erp-picker-wrap" ref={wrapRef}>
      <button type="button" className={`erp-picker-trigger${open ? " erp-picker-trigger-open" : ""}`} onClick={() => setOpen((p) => !p)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="erp-picker-text">
          <span className="erp-picker-group-hint">{current?.group}</span>
          <span className="erp-picker-current">{report?.title || "Select a report"}</span>
        </span>
        <span className={`erp-picker-chevron${open ? " erp-picker-chevron-open" : ""}`}>{IconChevron}</span>
      </button>

      {open && (
        <div className="erp-picker-panel" role="listbox">
          {groups.map(({ group, items }) => (
            <div key={group}>
              <div className="erp-picker-group-label">
                <span className="erp-group-icon">{GroupIcon[group]}</span>
                {group}
              </div>
              {items.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={r.id === selectedId}
                  className={`erp-picker-item${r.id === selectedId ? " erp-picker-item-active" : ""}`}
                  onClick={() => { onSelect(r.id); setOpen(false); }}
                >
                  <span>{r.title}</span>
                  {r.id === selectedId && <span className="erp-picker-check">{IconCheck}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EmpanelmentReportsPage() {
  const { profile } = useAuth();

  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ team: "all", office: "all", status: "all", sector: "all", from: "", to: "" });
  const [selectedId, setSelectedId] = useState(REPORTS[0].id);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        // RLS scopes rows automatically per role/team.
        const { data: apps, error: appErr } = await supabase
          .from("empanelment_applications")
          .select("*, po:project_officer_id(full_name)")
          .order("created_at", { ascending: false })
          .limit(2000);
        if (appErr) throw appErr;

        const ids = (apps || []).map((a) => a.id);
        const regs = {};
        for (let i = 0; i < ids.length; i += 300) {
          const { data } = await supabase.from("ba_registrations").select("application_id, org_name, sectors_served").in("application_id", ids.slice(i, i + 300));
          (data || []).forEach((r) => { regs[r.application_id] = r; });
        }

        setApps((apps || []).map((a) => {
          const r = regs[a.id] || {};
          return { ...a, po_name: a.po?.full_name || null, reg_org_name: r.org_name, reg_sectors_served: r.sectors_served };
        }));
      } catch (e) {
        setError(e.message || "Could not load report data.");
      }
      setLoading(false);
    })();
  }, [profile?.id]);

  const officeOptions = useMemo(() => [...new Set(apps.map((a) => a.office).filter(Boolean))].sort(), [apps]);
  const sectorOptions = useMemo(() => { const s = new Set(); apps.forEach((a) => sectorsOf(a).forEach((x) => s.add(x))); return [...s].sort(); }, [apps]);

  const filtered = useMemo(() => applyFilters(apps, filters), [apps, filters]);
  const reportGroups = useMemo(() => groupReports(REPORTS), []);
  const report = REPORTS.find((r) => r.id === selectedId);
  const output = useMemo(() => (report ? report.build({ apps: filtered }) : null), [report, filtered]);

  const canFilterTeamOffice = can.filterReportsByTeamOffice(profile?.role);
  const activeCount = [filters.team !== "all", filters.office !== "all", filters.status !== "all", filters.sector !== "all", !!filters.from, !!filters.to].filter(Boolean).length;

  function set(k, v) { setFilters((prev) => ({ ...prev, [k]: v })); }

  function handlePdfPreview() {
    setPdfPreview({
      html: buildReportPreviewHTML(report, output, filters),
      title: report.title,
      downloadLabel: "Download PDF",
      onDownload: () => { exportPDF(report, output, filters); setPdfPreview(null); },
    });
  }

  if (loading) return <PageLoader text="Loading report data…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>Empanelment Reports</h1>
            </div>
            <FilterButton onClick={() => setDrawerOpen(true)} activeCount={activeCount} />
          </div>
        </div>

        {error && <div className="text-danger text-sm" style={{ marginBottom: "var(--space-4)" }}>{error}</div>}

        <ReportPicker groups={reportGroups} selectedId={selectedId} onSelect={setSelectedId} />

        <div className="erp-layout">
          <aside className="erp-sidebar">
            <div className="erp-sidebar-summary">
              <span className="erp-sidebar-summary-value">{filtered.length}</span>
              <span className="erp-sidebar-summary-label">application{filtered.length !== 1 ? "s" : ""} in scope</span>
            </div>
            {reportGroups.map(({ group, items }) => (
              <div className="erp-group" key={group}>
                <div className="erp-group-label">
                  <span className="erp-group-icon">{GroupIcon[group]}</span>
                  {group}
                </div>
                {items.map((r) => (
                  <button key={r.id} title={r.desc} className={`erp-report-item${r.id === selectedId ? " erp-report-item--active" : ""}`} onClick={() => setSelectedId(r.id)}>
                    {r.title}
                  </button>
                ))}
              </div>
            ))}
          </aside>

          {report && output && (
            <ReportPreview report={report} output={output} onExcel={() => exportExcel(report, output, filters)} onPdf={handlePdfPreview} />
          )}
        </div>
      </div>

      <ReportFilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        filters={filters}
        set={set}
        onReset={() => setFilters({ team: "all", office: "all", status: "all", sector: "all", from: "", to: "" })}
        officeOptions={officeOptions}
        sectorOptions={sectorOptions}
        canFilterTeamOffice={canFilterTeamOffice}
      />

      {pdfPreview && (
        <PreviewModal
          html={pdfPreview.html}
          title={pdfPreview.title}
          downloadLabel={pdfPreview.downloadLabel}
          onDownload={pdfPreview.onDownload}
          onClose={() => setPdfPreview(null)}
        />
      )}
    </div>
  );
}
