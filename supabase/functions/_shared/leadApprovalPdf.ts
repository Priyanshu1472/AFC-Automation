// supabase/functions/_shared/leadApprovalPdf.ts
// Builds the "Lead Approval Note" / "MD Approval Note" PDF — the AFC
// letterhead + bordered-table engine from letterPdf.ts, laid out to match
// the 4-page reference document: (1) Business Lead Approval Note fields,
// (2) Preliminary Scrutiny by Office + Project Coordinator/DGM signatures,
// (3) PMT / PMT Extended / G3 remarks & signatures, (4) MD remarks &
// approval (final mode only). Visual fidelity is a first pass against the
// supplied screenshots — pdf-lib's manual-coordinate drawing can't do a
// pixel-perfect reproduction, so expect a follow-up tightening pass once an
// authoritative reference document is available.

import { BLACK, GREEN, PageEngine, drawGridTable, drawKeyValueTable, formatDateDDMMYYYY, newPdfDoc } from "./letterPdf.ts";
import { createAdminClient } from "./auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const BUCKET = "lead-documents";

export type LeadDocument = { name: string; path: string; size: number; uploaded_at: string; category?: "approval_note" | "final_approval_note" };

export type ApprovalNoteData = {
  nature_of_lead?: string;
  client_address?: string;
  objectives?: string;
  scope_of_work?: string[];
  project_timeline?: string;
  financial_requirement?: { document_fee_emd_pbg?: string; emd?: string; processing_fee?: string };
  revenue_sharing?: string;
};

export type ActivityRow = {
  action: string;
  comment: string | null;
  created_at: string;
  actor_role: string;
  actor_full_name: string | null;
};

type LeadForNote = {
  lead_number: string;
  title: string;
  client_name: string | null;
  submission_deadline: string | null;
  assigned_ba_id: string | null;
};

// (group key -> the advance-lead-stage action names that resolve it, in
// pipeline order) — used to pick each stage's most recent activity row.
const STAGE_GROUPS: { key: string; label: string; actions: string[] }[] = [
  { key: "dgm_initial", label: "DGM", actions: ["dgm_initial_approve", "dgm_initial_decline"] },
  { key: "pmt", label: "PMT (Stage I)", actions: ["pmt_approve", "pmt_escalate", "pmt_decline"] },
  { key: "pmt_extended", label: "PMT Extended (Stage II)", actions: ["pmt_extended_approve", "pmt_extended_forward_dgm", "pmt_extended_decline"] },
  { key: "g3", label: "G3 (Stage III)", actions: ["dgm_accept", "dgm_decline"] },
  { key: "md", label: "MD", actions: ["md_approve", "md_decline"] },
];

function latestByAction(rows: ActivityRow[], actions: string[]): ActivityRow | null {
  const matches = rows.filter((r) => actions.includes(r.action));
  if (!matches.length) return null;
  return matches.reduce((a, b) => (new Date(b.created_at) > new Date(a.created_at) ? b : a));
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return formatDateDDMMYYYY(new Date(iso));
}

async function drawTitle(e: PageEngine, text: string) {
  const size = 13;
  const w = e.fonts.bold.widthOfTextAtSize(text, size);
  const x = e.LEFT + (e.MAX_W - w) / 2;
  e.currentPage.drawText(text, { x, y: e.y, size, font: e.fonts.bold, color: BLACK });
  e.currentPage.drawLine({ start: { x, y: e.y - 3 }, end: { x: x + w, y: e.y - 3 }, thickness: 0.7, color: BLACK });
  e.y -= 20;
}

async function drawSubtitle(e: PageEngine, text: string) {
  const size = 11;
  const w = e.fonts.bold.widthOfTextAtSize(text, size);
  const x = e.LEFT + (e.MAX_W - w) / 2;
  e.currentPage.drawText(text, { x, y: e.y, size, font: e.fonts.bold, color: BLACK });
  e.y -= 22;
}

function drawSectionHeading(e: PageEngine, text: string) {
  const size = 10.5;
  e.currentPage.drawText(text, { x: e.LEFT, y: e.y, size, font: e.fonts.bold, color: BLACK });
  const w = e.fonts.bold.widthOfTextAtSize(text, size);
  e.currentPage.drawLine({ start: { x: e.LEFT, y: e.y - 2 }, end: { x: e.LEFT + w, y: e.y - 2 }, thickness: 0.6, color: BLACK });
  e.y -= 18;
}

function signatureBlock(e: PageEngine, x: number, width: number, opts: { title: string; name?: string | null; roleLine?: string; date?: string | null }) {
  const size = 9;
  const lineH = 12;
  let y = e.y;
  const label = opts.name ? "Name & Signature" : "Name & Signature (pending)";
  e.currentPage.drawText(label, { x, y, size, font: e.fonts.reg, color: BLACK });
  y -= lineH;
  if (opts.name) {
    e.currentPage.drawText(opts.name, { x, y, size, font: e.fonts.bold, color: BLACK });
    y -= lineH;
  } else {
    y -= lineH;
  }
  if (opts.roleLine) {
    e.currentPage.drawText(opts.roleLine, { x, y, size: 8.5, font: e.fonts.reg, color: BLACK });
    y -= lineH;
  }
  if (opts.date) {
    e.currentPage.drawText(`Date: ${opts.date}`, { x, y, size: 8.5, font: e.fonts.reg, color: BLACK });
    y -= lineH;
  }
  e.currentPage.drawText(opts.title, { x, y, size, font: e.fonts.bold, color: GREEN });
  void width;
}

export async function buildLeadApprovalNotePdf(opts: {
  logoBytes: Uint8Array;
  lead: LeadForNote;
  approvalNoteData: ApprovalNoteData | null;
  personResponsibleName: string;
  personResponsibleDesignation: string;
  baOrgName: string | null;
  team: string;
  activityRows: ActivityRow[];
  mode: "draft" | "final";
}): Promise<Uint8Array> {
  const { pdf, fonts } = await newPdfDoc();
  const e = new PageEngine(pdf, fonts, opts.logoBytes);
  const data = opts.approvalNoteData || {};
  const financial = data.financial_requirement || {};

  const dgmRow = latestByAction(opts.activityRows, STAGE_GROUPS[0].actions);

  // ── Page 1: Business Lead Approval Note ──────────────────────────
  await e.newPage();
  await drawTitle(e, "BUSINESS LEAD APPROVAL NOTE");
  await drawSubtitle(e, "AFC INDIA LIMITED");

  const scopeText = (data.scope_of_work || []).filter(Boolean).map((s) => `• ${s}`).join("\n");
  const briefValue = [
    data.objectives ? `Objectives:\n${data.objectives}` : "",
    scopeText ? `\nScope of Work:\n${scopeText}` : "",
  ].filter(Boolean).join("\n") || "—";

  const implementationArrangement = opts.lead.assigned_ba_id ? "Business Associate" : "In-house";

  const rows = [
    { label: "Nature of Lead", value: data.nature_of_lead || "—" },
    { label: "Title of Proposed Assignment*", value: opts.lead.title },
    { label: "Client Name with address*", value: [opts.lead.client_name, data.client_address].filter(Boolean).join("\n") || "—" },
    { label: "Brief write-up on nature and objective of the proposed assignment*", value: briefValue },
    { label: "Project Timeline", value: data.project_timeline || "—" },
    { label: "Proposed Implementation Arrangements* (In-house/BA)", value: implementationArrangement },
    ...(opts.lead.assigned_ba_id ? [{ label: "Name of BA*", value: opts.baOrgName || "—" }] : []),
    {
      label: "Financial Requirement: (Document fee/EMD/PBG) & its modalities; EMD; Processing Fee*",
      value: [
        `Document fee/EMD/PBG & modalities: ${financial.document_fee_emd_pbg || "NA"}`,
        `EMD: ${financial.emd || "NA"}`,
        `Processing Fee: ${financial.processing_fee || "NA"}`,
      ].join("\n"),
    },
    { label: "Last date for submission of Proposal*", value: fmtDate(opts.lead.submission_deadline) },
    { label: "Revenue sharing", value: data.revenue_sharing || "NA" },
  ];
  await drawKeyValueTable(e, rows, { labelWidth: 165 });

  // ── Page 2: Preliminary Scrutiny by Office ───────────────────────
  await e.newPage();
  await drawTitle(e, "Preliminary Scrutiny by Office");
  e.y -= 4;

  const scrutinyRows: string[][] = [
    ["1", "Financial Viability", "Yes", "Expected profitability considering bid cost, manpower, travel, taxes, etc."],
    ["2", "Commercial Feasibility", "Yes", "Whether the estimated project value justifies the effort and investment."],
    ["3", "Eligibility Criteria Fulfilled", "Yes", "Experience, turnover, certifications, staffing requirements, etc."],
    ["4", "Competition Assessment", "Yes", "Limited/Moderate/High competition and expected chances of success."],
    ["5", "Client Relationship / Strategic Importance", "Yes", "Existing client, new client, repeat assignment, Government priority, etc."],
    ["6", "Legal/Contractual Risks", "Yes", "Any onerous clauses, penalties, liabilities, arbitration concerns, etc."],
    ["7", "Payment Terms Acceptable", "Yes", "Advance/payment milestones, retention money, delayed payments, etc."],
    ["8", "Risk Assessment", "Yes", "Low / Medium / High with brief justification."],
  ];
  await drawGridTable(
    e,
    [{ header: "S.No.", width: 30 }, { header: "Evaluation Parameter", width: 130 }, { header: "Yes/No", width: 35 }, { header: "Justification / Remarks", width: 200 }],
    scrutinyRows
  );

  e.gap(28);
  if (e.y < e.FOOTER_SAFE + 60) await e.newPage();
  const half = e.MAX_W / 2;
  signatureBlock(e, e.LEFT, half - 10, {
    title: `Project Coordinator\n${opts.team}`,
    name: opts.personResponsibleName,
    roleLine: opts.personResponsibleDesignation,
  });
  signatureBlock(e, e.LEFT + half + 10, half - 10, {
    title: `Deputy General Manager\n${opts.team}`,
    name: dgmRow?.actor_full_name || null,
    roleLine: dgmRow ? "Deputy General Manager" : undefined,
    date: dgmRow ? fmtDate(dgmRow.created_at) : null,
  });
  e.y -= 40;

  // ── Page 3: Remarks/Recommendation (PMT / PMT Extended / G3) ────
  await e.newPage();
  await drawTitle(e, "Remarks/ Recommendation");

  const committeeStages = STAGE_GROUPS.slice(1, 4); // pmt, pmt_extended, g3
  const stageNumerals = ["Stage-I", "Stage-II", "Stage-III"];
  for (let i = 0; i < committeeStages.length; i++) {
    const stage = committeeStages[i];
    const row = latestByAction(opts.activityRows, stage.actions);
    if (opts.mode === "final" && !row) continue; // final doc: only stages actually reached

    if (e.y < e.FOOTER_SAFE + 90) await e.newPage();
    drawSectionHeading(e, stageNumerals[i]);
    e.currentPage.drawText(`Remarks/ Recommendation by ${stage.label}:`, { x: e.LEFT, y: e.y, size: 9.5, font: e.fonts.reg, color: BLACK });
    e.y -= 16;
    const remarkLines = row?.comment ? row.comment.split("\n") : ["Pending."];
    for (const line of remarkLines) {
      if (e.y < e.FOOTER_SAFE) await e.newPage();
      e.currentPage.drawText(line, { x: e.LEFT, y: e.y, size: 9, font: e.fonts.reg, color: BLACK });
      e.y -= 13;
    }
    e.y -= 10;
    signatureBlock(e, e.RIGHT_EDGE - 200, 200, {
      title: "Nodal Officer",
      name: row?.actor_full_name || null,
      roleLine: row ? stage.label : undefined,
      date: row ? fmtDate(row.created_at) : null,
    });
    e.y -= 30;
  }

  // ── Page 4: MD remarks & approval (final mode only) ──────────────
  if (opts.mode === "final") {
    const mdRow = latestByAction(opts.activityRows, STAGE_GROUPS[4].actions);
    await e.newPage();
    e.currentPage.drawText("Deputy General Manager", { x: e.RIGHT_EDGE - 140, y: e.y, size: 9.5, font: e.fonts.bold, color: BLACK });
    e.y -= 12;
    e.currentPage.drawText(opts.team, { x: e.RIGHT_EDGE - 140, y: e.y, size: 9, font: e.fonts.reg, color: BLACK });
    e.y -= 26;
    e.currentPage.drawText("Submitted for kind perusal and approval please", { x: e.LEFT, y: e.y, size: 9.5, font: e.fonts.reg, color: BLACK });
    e.y -= 26;

    drawSectionHeading(e, "Remarks/ Recommendation by Managing Director:");
    const mdRemarkLines = mdRow?.comment ? mdRow.comment.split("\n") : ["—"];
    for (const line of mdRemarkLines) {
      if (e.y < e.FOOTER_SAFE) await e.newPage();
      e.currentPage.drawText(line, { x: e.LEFT, y: e.y, size: 9, font: e.fonts.reg, color: BLACK });
      e.y -= 13;
    }
    e.y -= 20;

    drawSectionHeading(e, "Approval By Competent Authority:");
    e.y -= 10;
    if (mdRow?.actor_full_name) {
      e.currentPage.drawText(mdRow.actor_full_name, { x: e.LEFT, y: e.y, size: 10, font: e.fonts.bold, color: BLACK });
      e.y -= 14;
    }
    e.currentPage.drawText("Managing Director", { x: e.LEFT, y: e.y, size: 9.5, font: e.fonts.reg, color: BLACK });
    e.y -= 13;
    e.currentPage.drawText("AFC India Limited", { x: e.LEFT, y: e.y, size: 9.5, font: e.fonts.reg, color: BLACK });
    if (mdRow) {
      e.y -= 13;
      e.currentPage.drawText(`Date: ${fmtDate(mdRow.created_at)}`, { x: e.LEFT, y: e.y, size: 8.5, font: e.fonts.reg, color: BLACK });
    }
  }

  return await pdf.save();
}

// Uploads a generated note PDF and returns the updated `documents` array —
// replaces any prior entry of the SAME category (so regenerating the draft
// note never leaves orphaned duplicates), best-effort removing the old
// storage object. The final "MD Approval Note" is a different category, so
// it's added alongside the draft note rather than replacing it — both stay
// visible in Lead Records.
export async function saveApprovalNoteDocument(
  admin: AdminClient,
  leadId: string,
  existingDocuments: LeadDocument[],
  pdfBytes: Uint8Array,
  category: "approval_note" | "final_approval_note",
  filename: string
): Promise<LeadDocument[]> {
  const prior = existingDocuments.filter((d) => d.category === category);
  const kept = existingDocuments.filter((d) => d.category !== category);

  const path = `${leadId}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, pdfBytes, {
    contentType: "application/pdf",
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(`Storage upload failed for "${filename}": ${error.message}`);

  for (const old of prior) {
    await admin.storage.from(BUCKET).remove([old.path]).catch(() => {});
  }

  const newDoc: LeadDocument = { name: filename, path, size: pdfBytes.length, uploaded_at: new Date().toISOString(), category };
  return [...kept, newDoc];
}

export async function fetchLogoBytes(): Promise<Uint8Array | null> {
  try {
    const logoUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/public-assets/Logo.png`;
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function humanizeRole(role: string | null | undefined): string {
  if (!role) return "";
  return role.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// Re-fetches everything the note needs fresh from the DB (lead, its
// Person Responsible, its BA's org name via the existing
// get_team_business_associates RPC, and the full activity log), builds the
// PDF in the given mode, uploads it, and writes the updated `documents`
// array back onto the lead. Used both by generate-lead-approval-note (the
// user-triggered draft) and by advance-lead-stage's post-transition
// stamping at each committee stage — kept in one place so both call sites
// can't drift.
// Never throws — every failure mode (missing lead, missing logo, a
// pdf-lib layout error, a storage hiccup) resolves to { ok: false }
// instead, since a note-regeneration failure must never block the actual
// workflow decision that triggered it (callers only log the error).
export async function regenerateApprovalNote(
  admin: AdminClient,
  leadId: string,
  mode: "draft" | "final"
): Promise<{ ok: true; document: LeadDocument } | { ok: false; error: string }> {
  try {
    return await regenerateApprovalNoteInner(admin, leadId, mode);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function regenerateApprovalNoteInner(
  admin: AdminClient,
  leadId: string,
  mode: "draft" | "final"
): Promise<{ ok: true; document: LeadDocument } | { ok: false; error: string }> {
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, lead_number, title, client_name, submission_deadline, assigned_ba_id, person_responsible_id, team, documents, approval_note_data")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, error: "Lead not found." };

  const logoBytes = await fetchLogoBytes();
  if (!logoBytes) return { ok: false, error: "Could not load the AFC letterhead logo." };

  const { data: pr } = await admin.from("afc_users").select("full_name, role").eq("id", lead.person_responsible_id).maybeSingle();

  let baOrgName: string | null = null;
  if (lead.assigned_ba_id) {
    const { data: baList } = await admin.rpc("get_team_business_associates", { p_team: lead.team });
    const match = ((baList || []) as Row[]).find((b) => b.id === lead.assigned_ba_id);
    baOrgName = match?.org_name || null;
  }

  const { data: activityRows } = await admin
    .from("lead_activity_log")
    .select("action, comment, created_at, actor_role, actor:actor_id(full_name)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  const flatActivity: ActivityRow[] = ((activityRows || []) as Row[]).map((r) => ({
    action: r.action,
    comment: r.comment,
    created_at: r.created_at,
    actor_role: r.actor_role,
    actor_full_name: r.actor?.full_name || null,
  }));

  const pdfBytes = await buildLeadApprovalNotePdf({
    logoBytes,
    lead: {
      lead_number: lead.lead_number,
      title: lead.title,
      client_name: lead.client_name,
      submission_deadline: lead.submission_deadline,
      assigned_ba_id: lead.assigned_ba_id,
    },
    approvalNoteData: lead.approval_note_data,
    personResponsibleName: pr?.full_name || "—",
    personResponsibleDesignation: humanizeRole(pr?.role),
    baOrgName,
    team: lead.team,
    activityRows: flatActivity,
    mode,
  });

  const category = mode === "final" ? "final_approval_note" : "approval_note";
  const filename = mode === "final" ? "MD Approval Note.pdf" : "Lead Approval Note.pdf";
  const documents = await saveApprovalNoteDocument(admin, leadId, (lead.documents || []) as LeadDocument[], pdfBytes, category, filename);
  const { error: updateErr } = await admin.from("leads").update({ documents }).eq("id", leadId);
  if (updateErr) return { ok: false, error: updateErr.message };
  return { ok: true, document: documents[documents.length - 1] };
}
