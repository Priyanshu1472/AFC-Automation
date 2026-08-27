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

import { BLACK, GREEN, PageEngine, RULE_GRAY, drawGridTable, drawKeyValueTable, drawSimpleFooter, drawSimpleHeader, embedImageAuto, formatDateDDMMYYYY, newPdfDoc, wrapMultiline } from "./letterPdf.ts";
import { createAdminClient } from "./auth.ts";

type AdminClient = ReturnType<typeof createAdminClient>;

const BUCKET = "lead-documents";
const SIGNATURE_BUCKET = "user-signatures";

// The 8 Preliminary Scrutiny parameters — fixed content, not user-editable
// (only each lead's Yes/No + remarks vary). Mirrored in
// src/lib/leadApprovalNote.js for the frontend form; keep both in sync.
export const SCRUTINY_PARAMETERS: { label: string; defaultRemark: string }[] = [
  { label: "Financial Viability", defaultRemark: "Expected profitability considering bid cost, manpower, travel, taxes, etc." },
  { label: "Commercial Feasibility", defaultRemark: "Whether the estimated project value justifies the effort and investment." },
  { label: "Eligibility Criteria Fulfilled", defaultRemark: "Experience, turnover, certifications, staffing requirements, etc." },
  { label: "Competition Assessment", defaultRemark: "Limited/Moderate/High competition and expected chances of success." },
  { label: "Client Relationship / Strategic Importance", defaultRemark: "Existing client, new client, repeat assignment, Government priority, etc." },
  { label: "Legal/Contractual Risks", defaultRemark: "Any onerous clauses, penalties, liabilities, arbitration concerns, etc." },
  { label: "Payment Terms Acceptable", defaultRemark: "Advance/payment milestones, retention money, delayed payments, etc." },
  { label: "Risk Assessment", defaultRemark: "Low / Medium / High with brief justification." },
];

export type LeadDocument = { name: string; path: string; size: number; uploaded_at: string; category?: "approval_note" | "final_approval_note" };

export type ApprovalNoteData = {
  nature_of_lead?: string;
  client_address?: string;
  objectives?: string;
  scope_of_work?: string[];
  project_timeline?: string;
  financial_requirement?: { document_fee?: string; pbg?: string; emd?: string; processing_fee?: string };
  revenue_sharing?: string;
  // Preliminary Scrutiny by Office — one entry per SCRUTINY_PARAMETERS,
  // same order. Missing/short arrays fall back to defaults per-row.
  scrutiny?: { yes_no?: string; remarks?: string }[];
  justification?: string;
};

export type ActivityRow = {
  action: string;
  comment: string | null;
  created_at: string;
  actor_role: string;
  actor_full_name: string | null;
  actor_signature_path?: string | null;
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

// Page 2's DGM signature block only ever shows an *approval* — unlike
// every other stage's signatureBlock (which prints whoever most recently
// acted, decline included, since those live under an explicit "Remarks/
// Recommendation" heading that already states the outcome), this one sits
// directly below "Project Coordinator" with no outcome label of its own.
// If DGM declined, the stale note is deleted immediately (see
// advance-lead-stage's "dgm_initial_decline") and a resubmission always
// runs the note back through the exact same "accept" gate as day one — so
// by the time DGM approves, this always reflects that approval, never a
// leftover decline from an earlier round still sitting in the activity log.
const DGM_APPROVE_ACTIONS = ["dgm_initial_approve"];

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

// deno-lint-ignore no-explicit-any
async function signatureBlock(e: PageEngine, x: number, width: number, opts: { title: string; name?: string | null; roleLine?: string; date?: string | null; signatureImage?: any | null }) {
  const size = 9;
  const lineH = 12;
  let y = e.y;

  if (opts.signatureImage) {
    const dims = opts.signatureImage.scale(1);
    const maxH = 34;
    const maxW = Math.min(width, 130);
    const scale = Math.min(maxW / dims.width, maxH / dims.height, 1);
    const imgW = dims.width * scale;
    const imgH = dims.height * scale;
    e.currentPage.drawImage(opts.signatureImage, { x, y: y - imgH + 8, width: imgW, height: imgH });
    y -= maxH + 2;
  }

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

function centeredText(e: PageEngine, text: string, xCenter: number, y: number, size: number, bold: boolean) {
  const font = bold ? e.fonts.bold : e.fonts.reg;
  const w = font.widthOfTextAtSize(text, size);
  e.currentPage.drawText(text, { x: xCenter - w / 2, y, size, font, color: BLACK });
}

// Page 2's Project Coordinator / DGM signatures, laid out as a bordered
// two-row table per the reference form: an upper (blank-until-signed) row
// for the actual signature image + signer's name, and a lower row that's
// always the same printed caption ("Name & Signature" / role / team) —
// mirrors a physical form where the signer signs in the blank cell above a
// pre-printed label. deno-lint-ignore no-explicit-any
async function drawSignatureTable(e: PageEngine, columns: { roleLine: string; teamLine: string; name?: string | null; date?: string | null; signatureImage?: any | null }[]) {
  const n = columns.length;
  const colW = e.MAX_W / n;
  const rowSize = 8.5;
  const rowLineH = 11;
  const signatureRowH = 55;

  const captionLines = columns.map((c) => ["Name & Signature", c.roleLine, c.teamLine].filter(Boolean));
  const captionRowH = Math.max(...captionLines.map((l) => l.length)) * rowLineH + 10;
  const totalH = signatureRowH + captionRowH;

  if (e.y - totalH < e.FOOTER_SAFE) await e.newPage();
  const topY = e.y;
  const midY = topY - signatureRowH;
  const botY = topY - totalH;

  e.currentPage.drawRectangle({ x: e.LEFT, y: botY, width: e.MAX_W, height: totalH, borderColor: RULE_GRAY, borderWidth: 0.6 });
  e.currentPage.drawLine({ start: { x: e.LEFT, y: midY }, end: { x: e.RIGHT_EDGE, y: midY }, thickness: 0.6, color: RULE_GRAY });
  for (let i = 1; i < n; i++) {
    const x = e.LEFT + colW * i;
    e.currentPage.drawLine({ start: { x, y: topY }, end: { x, y: botY }, thickness: 0.6, color: RULE_GRAY });
  }

  columns.forEach((col, i) => {
    const xCenter = e.LEFT + colW * i + colW / 2;

    // Upper cell: signature image (if uploaded) + name, stacked and
    // vertically centered — stays blank ("pending") until the signer has
    // both an uploaded signature and has actually acted.
    let blockH = 0;
    let imgW = 0, imgH = 0;
    if (col.signatureImage) {
      const dims = col.signatureImage.scale(1);
      const maxH = 30, maxW = colW - 20;
      const scale = Math.min(maxW / dims.width, maxH / dims.height, 1);
      imgW = dims.width * scale;
      imgH = dims.height * scale;
      blockH += imgH + 4;
    }
    if (col.name) blockH += 11;
    if (col.date) blockH += 10;

    let y = midY + (signatureRowH + blockH) / 2;
    if (col.signatureImage) {
      e.currentPage.drawImage(col.signatureImage, { x: xCenter - imgW / 2, y: y - imgH, width: imgW, height: imgH });
      y -= imgH + 4;
    }
    if (col.name) {
      centeredText(e, col.name, xCenter, y - 9, 9, true);
      y -= 11;
    }
    if (col.date) {
      centeredText(e, `Date: ${col.date}`, xCenter, y - 8, 7.5, false);
    }

    // Lower cell: static caption, always shown regardless of signing state.
    let cy = midY - 10 - rowSize * 0.7;
    for (const line of captionLines[i]) {
      centeredText(e, line, xCenter, cy, rowSize, false);
      cy -= rowLineH;
    }
  });

  e.y = botY;
}

export async function buildLeadApprovalNotePdf(opts: {
  logoBytes: Uint8Array;
  lead: LeadForNote;
  approvalNoteData: ApprovalNoteData | null;
  personResponsibleName: string;
  personResponsibleDesignation: string;
  personResponsibleSignatureBytes?: Uint8Array | null;
  dgmSignatureBytes?: Uint8Array | null;
  baOrgName: string | null;
  team: string;
  activityRows: ActivityRow[];
  mode: "draft" | "final";
}): Promise<Uint8Array> {
  const { pdf, fonts } = await newPdfDoc();
  // Plain logo + "AFC India Ltd." header/footer (drawSimpleHeader/Footer),
  // not the full external-letter AFC letterhead — matches the reference
  // Business Lead Approval Note form. contentTop/footerSafe are pulled in
  // to match the much shorter header/footer.
  const e = new PageEngine(pdf, fonts, opts.logoBytes, {
    drawHeader: drawSimpleHeader,
    drawFooter: drawSimpleFooter,
    contentTop: 735,
    footerSafe: 70,
  });
  const data = opts.approvalNoteData || {};
  const financial = data.financial_requirement || {};

  const dgmRow = latestByAction(opts.activityRows, DGM_APPROVE_ACTIONS);
  // The Person Responsible's signing date is when they actually submitted
  // the note for DGM approval — the most recent "accept" (covers the first
  // submission and any DGM-decline resubmission alike).
  const prAcceptRow = latestByAction(opts.activityRows, ["accept"]);

  const prSignatureImage = opts.personResponsibleSignatureBytes ? await embedImageAuto(pdf, opts.personResponsibleSignatureBytes).catch(() => null) : null;
  const dgmSignatureImage = opts.dgmSignatureBytes ? await embedImageAuto(pdf, opts.dgmSignatureBytes).catch(() => null) : null;

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
      label: "Financial Requirement*",
      value: [
        `Document Fee/ Tender Fee: ${financial.document_fee || "NA"}`,
        `PBG: ${financial.pbg || "NA"}`,
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

  const scrutinyEntries = data.scrutiny || [];
  const scrutinyRows: string[][] = SCRUTINY_PARAMETERS.map((param, i) => {
    const entry = scrutinyEntries[i];
    const yesNo = entry?.yes_no === "No" ? "No" : "Yes";
    const remarks = entry?.remarks?.trim() || param.defaultRemark;
    return [String(i + 1), param.label, yesNo, remarks];
  });
  await drawGridTable(
    e,
    [{ header: "S.No.", width: 30 }, { header: "Evaluation Parameter", width: 130 }, { header: "Yes/No", width: 35 }, { header: "Justification / Remarks", width: 200 }],
    scrutinyRows
  );

  e.gap(18);
  if (data.justification) {
    if (e.y < e.FOOTER_SAFE + 40) await e.newPage();
    drawSectionHeading(e, "Justification:");
    const justificationLines = wrapMultiline(e.fonts.reg, data.justification, 9, e.MAX_W);
    for (const line of justificationLines) {
      if (e.y < e.FOOTER_SAFE) await e.newPage();
      e.currentPage.drawText(line, { x: e.LEFT, y: e.y, size: 9, font: e.fonts.reg, color: BLACK });
      e.y -= 13;
    }
    e.y -= 10;
  }

  e.gap(10);
  await drawSignatureTable(e, [
    {
      roleLine: "Project Coordinator",
      teamLine: opts.team,
      name: opts.personResponsibleName,
      date: prAcceptRow ? fmtDate(prAcceptRow.created_at) : null,
      signatureImage: prSignatureImage,
    },
    {
      roleLine: "Deputy General Manager",
      teamLine: opts.team,
      name: dgmRow?.actor_full_name || null,
      date: dgmRow ? fmtDate(dgmRow.created_at) : null,
      signatureImage: dgmRow ? dgmSignatureImage : null,
    },
  ]);
  e.y -= 20;

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
    await signatureBlock(e, e.RIGHT_EDGE - 200, 200, {
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

// Downloads a signature image straight from the private user-signatures
// bucket (service-role client, no signed URL needed server-side). Never
// throws — a missing/unreadable signature just means that signer's block
// falls back to the existing text-only rendering, exactly like a name that
// hasn't resolved yet.
async function fetchSignatureBytes(admin: AdminClient, path: string | null | undefined): Promise<Uint8Array | null> {
  if (!path) return null;
  try {
    const { data, error } = await admin.storage.from(SIGNATURE_BUCKET).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
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
    .select("id, lead_number, title, status, client_name, submission_deadline, assigned_ba_id, person_responsible_id, team, documents, approval_note_data")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return { ok: false, error: "Lead not found." };

  const logoBytes = await fetchLogoBytes();
  if (!logoBytes) return { ok: false, error: "Could not load the AFC letterhead logo." };

  const { data: pr } = await admin.from("afc_users").select("full_name, role, signature_path").eq("id", lead.person_responsible_id).maybeSingle();

  let baOrgName: string | null = null;
  if (lead.assigned_ba_id) {
    const { data: baList } = await admin.rpc("get_team_business_associates", { p_team: lead.team });
    const match = ((baList || []) as Row[]).find((b) => b.id === lead.assigned_ba_id);
    baOrgName = match?.org_name || null;
  }

  const { data: activityRows } = await admin
    .from("lead_activity_log")
    .select("action, comment, created_at, actor_role, actor:actor_id(full_name, signature_path)")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  const flatActivity: ActivityRow[] = ((activityRows || []) as Row[]).map((r) => ({
    action: r.action,
    comment: r.comment,
    created_at: r.created_at,
    actor_role: r.actor_role,
    actor_full_name: r.actor?.full_name || null,
    actor_signature_path: r.actor?.signature_path || null,
  }));

  const dgmActivityRow = latestByAction(flatActivity, DGM_APPROVE_ACTIONS);
  const [personResponsibleSignatureBytes, dgmSignatureBytes] = await Promise.all([
    fetchSignatureBytes(admin, pr?.signature_path),
    fetchSignatureBytes(admin, dgmActivityRow?.actor_signature_path),
  ]);

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
    personResponsibleSignatureBytes,
    dgmSignatureBytes,
    baOrgName,
    team: lead.team,
    activityRows: flatActivity,
    mode,
  });

  // Still pa_review/pa_action_required — the Person Responsible has
  // generated/edited the note but hasn't actually submitted it for DGM
  // review yet, so the single stored document is labeled "-- Draft" to
  // make that unambiguous. The moment "accept" transitions the lead to
  // dgm_initial_review (accept is in REGENERATE_DRAFT_NOTE_ON), this same
  // regeneration runs again and drops the suffix — replacing, never
  // duplicating, the stored document (see saveApprovalNoteDocument).
  const isPreSubmission = lead.status === "pa_review" || lead.status === "pa_action_required";
  const category = mode === "final" ? "final_approval_note" : "approval_note";
  const filename = mode === "final" ? "MD Approval Note.pdf" : isPreSubmission ? "Lead Approval Note -- Draft.pdf" : "Lead Approval Note.pdf";
  const documents = await saveApprovalNoteDocument(admin, leadId, (lead.documents || []) as LeadDocument[], pdfBytes, category, filename);
  const { error: updateErr } = await admin.from("leads").update({ documents }).eq("id", leadId);
  if (updateErr) return { ok: false, error: updateErr.message };
  return { ok: true, document: documents[documents.length - 1] };
}
