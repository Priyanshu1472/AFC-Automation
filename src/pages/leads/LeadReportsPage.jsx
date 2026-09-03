// src/pages/leads/LeadReportsPage.jsx
// Report registry pattern ported from EmpanelmentReportsPage.jsx, adapted
// to the leads schema (leads + lead_activity_log, RLS-scoped — no
// client-side owner filtering needed). Adding a report = one more object
// in REPORTS.
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { can } from "../../lib/roles";
import { STATUS_MAP } from "../../components/leads/leadStatus";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import DatePickerCalendar from "../../components/ui/DatePickerCalendar";
import PageLoader from "../../components/ui/PageLoader";
import FilterDrawer, { FilterButton, FilterField } from "../../components/ui/FilterDrawer";
import PreviewModal from "../../components/ui/PreviewModal";
import "../../styles/LeadReportsPage.css";

const ALL_STATUSES = Object.keys(STATUS_MAP);
// On-track funnel, ending at the terminal approval — mirrors Empanelment's
// PIPELINE (also ends at its own terminal "accepted").
const PIPELINE = ["pa_review", "dgm_initial_review", "pmt_review", "pmt_extended_review", "dgm_review", "md_review", "md_approved"];
const TERMINAL = ["md_approved", "md_declined", "pa_dropped"];
const SOURCE_LABELS = { in_house: "In House", ba: "BA Source", suo_moto: "Suo Moto" };
const TYPE_LABELS = { rfp: "RFP", eoi: "EOI" };
// Every action that can send a lead back for changes — used to find the
// most recent reason/comment behind an Action Required / Declined /
// Dropped lead from lead_activity_log, since the lead row itself only
// keeps the current state, not why it got there.
const DECLINE_ACTIONS = new Set([
  "dgm_initial_decline", "pmt_decline", "pmt_extended_decline", "dgm_decline", "md_decline", "pr_review_reject",
]);

const isApproved = (l) => l.status === "md_approved";
const isDeclined = (l) => l.status === "md_declined";
const isDropped = (l) => l.status === "pa_dropped";
const isInProgress = (l) => !TERMINAL.includes(l.status) && l.status !== "pa_action_required";

function fmt(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
const dash = (v) => (v === 0 ? 0 : v || "—");
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const dateKey = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const daysFrom = (d) => (d ? Math.floor((Date.now() - new Date(d)) / 86400000) : null);
const daysBetween = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000)) : null);

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

function applyFilters(leads, f) {
  const from = f.from ? dateKey(f.from) : "";
  const to = f.to ? dateKey(f.to) : "";
  return leads.filter((l) => {
    if (f.team !== "all" && l.team !== f.team) return false;
    if (f.status !== "all" && l.status !== f.status) return false;
    if (f.source !== "all" && l.source !== f.source) return false;
    if (f.leadType !== "all" && l.lead_type !== f.leadType) return false;
    if (from && dateKey(l.created_at) < from) return false;
    if (to && dateKey(l.created_at) > to) return false;
    return true;
  });
}

// ── REPORT REGISTRY ──────────────────────────────────────────
const REPORTS = [
  {
    id: "status_summary", group: "Overview", title: "Status Summary",
    desc: "Headline counts across the whole pipeline, with the approval rate.",
    build: ({ leads }) => {
      const total = leads.length, app = leads.filter(isApproved).length, dec = leads.filter(isDeclined).length;
      const drop = leads.filter(isDropped).length, prog = leads.filter(isInProgress).length;
      const action = leads.filter((l) => l.status === "pa_action_required").length;
      return {
        kpis: [
          { label: "Total Leads", value: total }, { label: "Approved", value: app },
          { label: "Declined", value: dec }, { label: "Dropped", value: drop }, { label: "In Review", value: prog },
          { label: "Action Required", value: action }, { label: "Approval Rate", value: pct(app, app + dec) + "%" },
        ],
        columns: [{ key: "status", label: "Status" }, { key: "count", label: "Count" }, { key: "share", label: "Share %" }],
        rows: [
          ...ALL_STATUSES.map((s) => ({ status: STATUS_MAP[s].label, count: leads.filter((l) => l.status === s).length, share: pct(leads.filter((l) => l.status === s).length, total) })),
          { status: "Total", count: total, share: 100 },
        ],
      };
    },
  },
  {
    id: "status_list", group: "Overview", title: "Lead Status Report",
    desc: "Current pipeline snapshot — every lead with its stage and days elapsed.",
    build: ({ leads }) => ({
      columns: [
        { key: "lead_number", label: "Lead #" }, { key: "title", label: "Title" }, { key: "team", label: "Team" },
        { key: "source_label", label: "Source" }, { key: "type_label", label: "Type" }, { key: "creator", label: "Creator" },
        { key: "pr", label: "Person Responsible" }, { key: "status_label", label: "Status" },
        { key: "created_f", label: "Created On" }, { key: "days", label: "Days in Pipeline" }, { key: "deadline_f", label: "Submission Deadline" },
      ],
      rows: leads.map((l) => ({
        lead_number: dash(l.lead_number), title: dash(l.title), team: dash(l.team),
        source_label: SOURCE_LABELS[l.source] || dash(l.source), type_label: TYPE_LABELS[l.lead_type] || dash(l.lead_type),
        creator: dash(l.creator?.full_name), pr: dash(l.assignee?.full_name), status_label: STATUS_MAP[l.status]?.label || l.status,
        created_f: fmt(l.created_at), days: daysFrom(l.created_at) ?? "—", deadline_f: fmt(l.submission_deadline),
      })),
    }),
  },
  {
    id: "monthly", group: "Overview", title: "Monthly Trend",
    desc: "Leads created per month, with how many were approved or declined.",
    build: ({ leads }) => {
      const g = groupBy(leads, (l) => (l.created_at ? new Date(l.created_at).toISOString().slice(0, 7) : "—"));
      return {
        columns: [
          { key: "month", label: "Month" }, { key: "total", label: "Created" }, { key: "approved", label: "Approved" },
          { key: "declined", label: "Declined" }, { key: "progress", label: "In Review" }, { key: "rate", label: "Approval %" },
        ],
        rows: [...g.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, arr]) => {
          const app = arr.filter(isApproved).length, dec = arr.filter(isDeclined).length;
          return {
            month: key === "—" ? "—" : new Date(key + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
            total: arr.length, approved: app, declined: dec, progress: arr.filter(isInProgress).length, rate: pct(app, app + dec),
          };
        }),
      };
    },
  },
  {
    id: "funnel", group: "Pipeline", title: "Stage-wise Funnel",
    desc: "How many leads currently sit at each stage of the approval chain.",
    build: ({ leads }) => ({
      columns: [{ key: "name", label: "Status" }, { key: "count", label: "Count" }, { key: "share", label: "Share %" }],
      rows: PIPELINE.map((s) => {
        const c = leads.filter((l) => l.status === s).length;
        return { name: STATUS_MAP[s].label, count: c, share: pct(c, leads.length) };
      }),
    }),
  },
  {
    id: "ageing", group: "Pipeline", title: "Ageing / Stuck Leads",
    desc: "Open leads sorted by how long they've been sitting in the pipeline.",
    build: ({ leads }) => {
      const rows = leads.filter((l) => !TERMINAL.includes(l.status)).map((l) => ({
        lead_number: dash(l.lead_number), title: dash(l.title), team: dash(l.team),
        status_label: STATUS_MAP[l.status]?.label || l.status, created_f: fmt(l.created_at), days: daysFrom(l.created_at) ?? 0,
      })).sort((x, y) => y.days - x.days);
      return {
        kpis: [
          { label: "Open Leads", value: rows.length },
          { label: "Older Than 30 Days", value: rows.filter((r) => r.days > 30).length },
          { label: "Oldest (days)", value: rows[0]?.days ?? 0 },
        ],
        columns: [
          { key: "lead_number", label: "Lead #" }, { key: "title", label: "Title" }, { key: "team", label: "Team" },
          { key: "status_label", label: "Stuck At" }, { key: "created_f", label: "Created On" }, { key: "days", label: "Days Open" },
        ],
        rows,
      };
    },
  },
  {
    id: "tat", group: "Pipeline", title: "Turnaround Time",
    desc: "For approved leads: days taken from creation to the final MD approval.",
    build: ({ leads }) => {
      const done = leads.filter((l) => isApproved(l) && l.decided_at);
      const tats = done.map((l) => daysBetween(l.created_at, l.decided_at)).filter((n) => n !== null);
      const rows = done.map((l) => ({
        lead_number: dash(l.lead_number), title: dash(l.title), team: dash(l.team), created_f: fmt(l.created_at),
        decided_f: fmt(l.decided_at), tat: daysBetween(l.created_at, l.decided_at) ?? "—",
      })).sort((x, y) => (y.tat || 0) - (x.tat || 0));
      return {
        kpis: [
          { label: "Approved", value: done.length }, { label: "Average TAT (days)", value: avg(tats) },
          { label: "Median TAT (days)", value: median(tats) },
        ],
        columns: [
          { key: "lead_number", label: "Lead #" }, { key: "title", label: "Title" }, { key: "team", label: "Team" },
          { key: "created_f", label: "Created On" }, { key: "decided_f", label: "Approved On" }, { key: "tat", label: "TAT (days)" },
        ],
        rows,
      };
    },
  },
  {
    id: "action_required", group: "Pipeline", title: "Action Required",
    desc: "Leads currently returned for changes, with the reason on record and days stuck.",
    build: ({ leads, reasonById }) => {
      const rows = leads.filter((l) => l.status === "pa_action_required").map((l) => ({
        lead_number: dash(l.lead_number), title: dash(l.title), team: dash(l.team),
        creator: dash(l.creator?.full_name), pr: dash(l.assignee?.full_name),
        reason: dash(reasonById[l.id]), days: daysFrom(l.created_at) ?? 0,
      })).sort((x, y) => y.days - x.days);
      return { kpis: [{ label: "Action Required", value: rows.length }], columns: [
        { key: "lead_number", label: "Lead #" }, { key: "title", label: "Title" }, { key: "team", label: "Team" },
        { key: "creator", label: "Creator" }, { key: "pr", label: "Person Responsible" }, { key: "reason", label: "Reason" }, { key: "days", label: "Days Open" },
      ], rows };
    },
  },
  {
    id: "approval_note", group: "Pipeline", title: "Approval Note Review Status",
    desc: "Where each lead's Approval Note stands — not yet drafted, awaiting PR review, or PR-reviewed.",
    build: ({ leads }) => {
      const notDrafted = leads.filter((l) => !l.approval_note_data).length;
      const pending = leads.filter((l) => l.approval_note_pending_pr_review).length;
      const reviewed = leads.filter((l) => l.approval_note_data && !l.approval_note_pending_pr_review && l.approval_note_pr_reviewed).length;
      return {
        kpis: [
          { label: "Not Drafted Yet", value: notDrafted }, { label: "Awaiting PR Review", value: pending }, { label: "PR-Reviewed", value: reviewed },
        ],
        columns: [
          { key: "lead_number", label: "Lead #" }, { key: "title", label: "Title" }, { key: "status_label", label: "Status" },
          { key: "note_state", label: "Note State" }, { key: "pr", label: "Person Responsible" },
        ],
        rows: leads.map((l) => ({
          lead_number: dash(l.lead_number), title: dash(l.title), status_label: STATUS_MAP[l.status]?.label || l.status,
          note_state: !l.approval_note_data ? "Not Drafted" : l.approval_note_pending_pr_review ? "Awaiting PR Review" : l.approval_note_pr_reviewed ? "PR-Reviewed" : "Draft",
          pr: dash(l.assignee?.full_name),
        })),
      };
    },
  },
  {
    id: "team", group: "Teams & People", title: "Team Performance",
    desc: "Per-team leads created, approved, declined and still open.",
    build: ({ leads }) => ({
      columns: [
        { key: "team", label: "Team" }, { key: "total", label: "Created" }, { key: "approved", label: "Approved" },
        { key: "declined", label: "Declined" }, { key: "progress", label: "In Review" }, { key: "rate", label: "Approval %" },
      ],
      rows: [...groupBy(leads, (l) => l.team)].map(([team, arr]) => {
        const app = arr.filter(isApproved).length, dec = arr.filter(isDeclined).length;
        return { team, total: arr.length, approved: app, declined: dec, progress: arr.filter(isInProgress).length, rate: pct(app, app + dec) };
      }).sort((x, y) => y.total - x.total),
    }),
  },
  {
    id: "person_responsible", group: "Teams & People", title: "Person Responsible Performance",
    desc: "Leads grouped by the assigned Person Responsible.",
    build: ({ leads }) => ({
      columns: [
        { key: "pr", label: "Person Responsible" }, { key: "team", label: "Team" }, { key: "total", label: "Assigned" },
        { key: "approved", label: "Approved" }, { key: "declined", label: "Declined" }, { key: "open", label: "Still Open" }, { key: "rate", label: "Approval %" },
      ],
      rows: [...groupBy(leads, (l) => l.assignee?.full_name || "—")].map(([pr, arr]) => {
        const app = arr.filter(isApproved).length, dec = arr.filter(isDeclined).length;
        return {
          pr, team: arr[0]?.team || "—", total: arr.length, approved: app, declined: dec,
          open: arr.filter((l) => !TERMINAL.includes(l.status)).length, rate: pct(app, app + dec),
        };
      }).sort((x, y) => y.total - x.total),
    }),
  },
  {
    id: "creator", group: "Teams & People", title: "Creator Activity",
    desc: "Leads grouped by whoever created them.",
    build: ({ leads }) => ({
      columns: [
        { key: "creator", label: "Creator" }, { key: "team", label: "Team" }, { key: "total", label: "Created" },
        { key: "approved", label: "Approved" }, { key: "declined", label: "Declined" }, { key: "rate", label: "Approval %" },
      ],
      rows: [...groupBy(leads, (l) => l.creator?.full_name || "—")].map(([creator, arr]) => {
        const app = arr.filter(isApproved).length, dec = arr.filter(isDeclined).length;
        return { creator, team: arr[0]?.team || "—", total: arr.length, approved: app, declined: dec, rate: pct(app, app + dec) };
      }).sort((x, y) => y.total - x.total),
    }),
  },
  {
    id: "source", group: "Source & Type", title: "Source-wise Distribution",
    desc: "In-house vs. BA-sourced vs. Suo Moto leads.",
    build: ({ leads }) => ({
      columns: [{ key: "source", label: "Source" }, { key: "total", label: "Total" }, { key: "approved", label: "Approved" }, { key: "declined", label: "Declined" }, { key: "rate", label: "Approval %" }],
      rows: Object.entries(SOURCE_LABELS).map(([key, label]) => {
        const arr = leads.filter((l) => l.source === key);
        const app = arr.filter(isApproved).length, dec = arr.filter(isDeclined).length;
        return { source: label, total: arr.length, approved: app, declined: dec, rate: pct(app, app + dec) };
      }),
    }),
  },
  {
    id: "lead_type", group: "Source & Type", title: "Lead Type Distribution",
    desc: "RFP vs. EOI leads.",
    build: ({ leads }) => ({
      columns: [{ key: "type", label: "Lead Type" }, { key: "total", label: "Total" }, { key: "approved", label: "Approved" }, { key: "declined", label: "Declined" }, { key: "rate", label: "Approval %" }],
      rows: Object.entries(TYPE_LABELS).map(([key, label]) => {
        const arr = leads.filter((l) => l.lead_type === key);
        const app = arr.filter(isApproved).length, dec = arr.filter(isDeclined).length;
        return { type: label, total: arr.length, approved: app, declined: dec, rate: pct(app, app + dec) };
      }),
    }),
  },
  {
    id: "ba_distribution", group: "Source & Type", title: "BA-wise Distribution",
    desc: "Leads sourced through each Business Associate.",
    build: ({ leads }) => {
      const withBa = leads.filter((l) => l.assigned_ba_id);
      const rows = [...groupBy(withBa, (l) => l.ba_org_name || "—")].map(([ba, arr]) => {
        const app = arr.filter(isApproved).length, dec = arr.filter(isDeclined).length;
        return { ba, total: arr.length, approved: app, declined: dec, rate: pct(app, app + dec) };
      }).sort((x, y) => y.total - x.total);
      return {
        kpis: [{ label: "Leads via a BA", value: withBa.length }, { label: "Distinct BAs", value: rows.length }],
        columns: [{ key: "ba", label: "Business Associate" }, { key: "total", label: "Total" }, { key: "approved", label: "Approved" }, { key: "declined", label: "Declined" }, { key: "rate", label: "Approval %" }],
        rows,
      };
    },
  },
  {
    id: "declined_dropped", group: "Source & Type", title: "Declined / Dropped Leads",
    desc: "Leads that were declined by MD or dropped, with the reason on record.",
    build: ({ leads, reasonById }) => {
      const rows = leads.filter((l) => isDeclined(l) || isDropped(l)).map((l) => ({
        lead_number: dash(l.lead_number), title: dash(l.title), team: dash(l.team),
        outcome: isDeclined(l) ? "Declined" : "Dropped", reason: dash(reasonById[l.id]),
        created_f: fmt(l.created_at), decided_f: fmt(l.decided_at),
      }));
      return { kpis: [{ label: "Declined / Dropped", value: rows.length }], columns: [
        { key: "lead_number", label: "Lead #" }, { key: "title", label: "Title" }, { key: "team", label: "Team" },
        { key: "outcome", label: "Outcome" }, { key: "reason", label: "Reason / Remark" }, { key: "created_f", label: "Created On" }, { key: "decided_f", label: "Decided On" },
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
  if (filters.status !== "all") bits.push(`Status: ${STATUS_MAP[filters.status]?.label || filters.status}`);
  if (filters.source !== "all") bits.push(`Source: ${SOURCE_LABELS[filters.source] || filters.source}`);
  if (filters.leadType !== "all") bits.push(`Type: ${TYPE_LABELS[filters.leadType] || filters.leadType}`);
  if (filters.from || filters.to) bits.push(`Date: ${filters.from ? fmt(filters.from) : "…"} – ${filters.to ? fmt(filters.to) : "…"}`);
  return bits.join("  ·  ");
}

function fileBase(report) {
  return `AFC_Leads_${report.id}_${new Date().toISOString().slice(0, 10)}`;
}

// Sheet names can't contain : \ / ? * [ ] and are capped at 31 chars.
function sheetName(title) {
  return (title || "Report").replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Report";
}

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
  "Source & Type": <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>,
};
const IconSearch = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
const IconSort = { none: "↕", asc: "↑", desc: "↓" };

// ── UI ────────────────────────────────────────────────────────
function ReportPreview({ report, output, onExcel, onPdf }) {
  const cols = output?.columns || [];
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: null, dir: "asc" });

  useEffect(() => { setSearch(""); setSort({ key: null, dir: "asc" }); }, [report.id]);

  const rows = useMemo(() => {
    const columns = output?.columns || [];
    let list = output?.rows || [];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((row) => columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(q)));
    }
    if (sort.key) {
      list = [...list].sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [output, search, sort]);

  const empty = (output?.rows || []).length === 0;
  const noMatches = !empty && rows.length === 0;

  function toggleSort(key) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  return (
    <Card className="lrp-preview">
      <Card.Header
        title={report.title}
        subtitle={report.desc}
        action={
          <div className="lrp-dl-btns">
            <Button variant="secondary" size="sm" disabled={empty} onClick={onExcel}>Excel</Button>
            <Button variant="primary" size="sm" disabled={empty} onClick={onPdf}>PDF</Button>
          </div>
        }
      />
      <Card.Body>
        {output?.kpis?.length > 0 && (
          <div className="lrp-kpis">
            {output.kpis.map((k, i) => (
              <div key={k.label} className={`lrp-kpi lrp-kpi-${i % 4}`}>
                <div className="lrp-kpi-value">{k.value}</div>
                <div className="lrp-kpi-label">{k.label}</div>
              </div>
            ))}
          </div>
        )}
        {!empty && (
          <div className="lrp-search-row">
            <span className="lrp-search-icon">{IconSearch}</span>
            <input className="input lrp-search-input" placeholder={`Search within ${rows.length !== (output?.rows || []).length ? rows.length + " of " : ""}${(output?.rows || []).length} rows…`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {empty ? (
          <p className="text-secondary text-sm">No data for the selected filters.</p>
        ) : noMatches ? (
          <p className="text-secondary text-sm">No rows match &quot;{search}&quot;.</p>
        ) : (
          <div className="table-wrapper lrp-table-wrap">
            <table className="table lrp-table">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} className="lrp-th-sortable" onClick={() => toggleSort(c.key)}>
                      {c.label} <span className={`lrp-sort-icon${sort.key === c.key ? " lrp-sort-icon-active" : ""}`}>{sort.key === c.key ? IconSort[sort.dir] : IconSort.none}</span>
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

function ReportFilterDrawer({ open, onClose, filters, set, onReset, statusOptions, teamOptions, canFilterTeam }) {
  return (
    <FilterDrawer open={open} onClose={onClose} onReset={onReset} title="Filters">
      <FilterField label="Team">
        <Select disabled={!canFilterTeam} value={filters.team} onChange={(v) => set("team", v)} placeholder="All Teams" options={[{ value: "all", label: "All Teams" }, ...teamOptions.map((t) => ({ value: t, label: t }))]} />
      </FilterField>
      <FilterField label="Status">
        <Select value={filters.status} onChange={(v) => set("status", v)} placeholder="All Statuses" options={[{ value: "all", label: "All Statuses" }, ...statusOptions.map((s) => ({ value: s, label: STATUS_MAP[s].label }))]} />
      </FilterField>
      <FilterField label="Source">
        <Select value={filters.source} onChange={(v) => set("source", v)} placeholder="All Sources" options={[{ value: "all", label: "All Sources" }, ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))]} />
      </FilterField>
      <FilterField label="Lead Type">
        <Select value={filters.leadType} onChange={(v) => set("leadType", v)} placeholder="All Types" options={[{ value: "all", label: "All Types" }, ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))]} />
      </FilterField>
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
    <div className="lrp-picker-wrap" ref={wrapRef}>
      <button type="button" className={`lrp-picker-trigger${open ? " lrp-picker-trigger-open" : ""}`} onClick={() => setOpen((p) => !p)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="lrp-picker-text">
          <span className="lrp-picker-group-hint">{current?.group}</span>
          <span className="lrp-picker-current">{report?.title || "Select a report"}</span>
        </span>
        <span className={`lrp-picker-chevron${open ? " lrp-picker-chevron-open" : ""}`}>{IconChevron}</span>
      </button>

      {open && (
        <div className="lrp-picker-panel" role="listbox">
          {groups.map(({ group, items }) => (
            <div key={group}>
              <div className="lrp-picker-group-label">
                <span className="lrp-group-icon">{GroupIcon[group]}</span>
                {group}
              </div>
              {items.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={r.id === selectedId}
                  className={`lrp-picker-item${r.id === selectedId ? " lrp-picker-item-active" : ""}`}
                  onClick={() => { onSelect(r.id); setOpen(false); }}
                >
                  <span>{r.title}</span>
                  {r.id === selectedId && <span className="lrp-picker-check">{IconCheck}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeadReportsPage() {
  const { profile } = useAuth();

  const [leads, setLeads] = useState([]);
  const [reasonById, setReasonById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ team: "all", status: "all", source: "all", leadType: "all", from: "", to: "" });
  const [selectedId, setSelectedId] = useState(REPORTS[0].id);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pdfPreview, setPdfPreview] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError("");
      try {
        // RLS scopes rows automatically per role/team/committee.
        const { data: leadRows, error: leadErr } = await supabase
          .from("leads")
          .select("*, creator:created_by(full_name), assignee:person_responsible_id(full_name)")
          .order("created_at", { ascending: false })
          .limit(2000);
        if (leadErr) throw leadErr;

        const list = leadRows || [];

        // BA org names — one RPC call per distinct team present, same
        // batching idea as Empanelment's ba_registrations lookup.
        const teams = [...new Set(list.filter((l) => l.assigned_ba_id).map((l) => l.team).filter(Boolean))];
        const baNameById = {};
        await Promise.all(teams.map(async (team) => {
          const { data } = await supabase.rpc("get_team_business_associates", { p_team: team });
          (data || []).forEach((b) => { baNameById[b.id] = b.org_name; });
        }));

        setLeads(list.map((l) => ({ ...l, ba_org_name: l.assigned_ba_id ? baNameById[l.assigned_ba_id] : null })));

        // Latest decline/reject reason per lead — powers Action Required
        // and Declined/Dropped reports, since the lead row only holds
        // current state, not why it got there.
        const ids = list.map((l) => l.id);
        const latestByLead = {};
        for (let i = 0; i < ids.length; i += 300) {
          const { data } = await supabase
            .from("lead_activity_log")
            .select("lead_id, action, comment, created_at")
            .in("lead_id", ids.slice(i, i + 300))
            .order("created_at", { ascending: true });
          (data || []).forEach((row) => {
            if (DECLINE_ACTIONS.has(row.action) && row.comment) latestByLead[row.lead_id] = row.comment;
          });
        }
        setReasonById(latestByLead);
      } catch (e) {
        setError(e.message || "Could not load report data.");
      }
      setLoading(false);
    })();
  }, [profile?.id]);

  const teamOptions = useMemo(() => [...new Set(leads.map((l) => l.team).filter(Boolean))].sort(), [leads]);

  const filtered = useMemo(() => applyFilters(leads, filters), [leads, filters]);
  const reportGroups = useMemo(() => groupReports(REPORTS), []);
  const report = REPORTS.find((r) => r.id === selectedId);
  const output = useMemo(() => (report ? report.build({ leads: filtered, reasonById }) : null), [report, filtered, reasonById]);

  const canFilterTeam = can.filterReportsByTeamOffice(profile?.role);
  const activeCount = [filters.team !== "all", filters.status !== "all", filters.source !== "all", filters.leadType !== "all", !!filters.from, !!filters.to].filter(Boolean).length;

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
              <h1>Leads Reports</h1>
            </div>
            <FilterButton onClick={() => setDrawerOpen(true)} activeCount={activeCount} />
          </div>
        </div>

        {error && <div className="text-danger text-sm" style={{ marginBottom: "var(--space-4)" }}>{error}</div>}

        <ReportPicker groups={reportGroups} selectedId={selectedId} onSelect={setSelectedId} />

        <div className="lrp-layout">
          <aside className="lrp-sidebar">
            <div className="lrp-sidebar-summary">
              <span className="lrp-sidebar-summary-value">{filtered.length}</span>
              <span className="lrp-sidebar-summary-label">lead{filtered.length !== 1 ? "s" : ""} in scope</span>
            </div>
            {reportGroups.map(({ group, items }) => (
              <div className="lrp-group" key={group}>
                <div className="lrp-group-label">
                  <span className="lrp-group-icon">{GroupIcon[group]}</span>
                  {group}
                </div>
                {items.map((r) => (
                  <button key={r.id} title={r.desc} className={`lrp-report-item${r.id === selectedId ? " lrp-report-item--active" : ""}`} onClick={() => setSelectedId(r.id)}>
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
        onReset={() => setFilters({ team: "all", status: "all", source: "all", leadType: "all", from: "", to: "" })}
        statusOptions={ALL_STATUSES}
        teamOptions={teamOptions}
        canFilterTeam={canFilterTeam}
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
