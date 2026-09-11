import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useShortlist } from "../../hooks/useShortlist";
import { useToast } from "../../hooks/useToast";
import { buildProjectRows, buildPreviewHTML } from "../../utils/docxBuilder";
import {
  buildKnowledgeDocumentsDocxChildren,
  buildKnowledgeShortlistProfilesPdf,
  buildKnowledgeShortlistSupportingsPdf,
  buildKnowledgeShortlistBothPdf,
  downloadBlob,
  openPdfInNewTab,
} from "../../utils/knowledgeDocumentEmbed";
import AppHeader from "../../components/shared/AppHeader";
import "../../styles/ShortlistsPage.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function fmtYM(yyyymm) {
  if (!yyyymm) return "—";
  const [y, m] = yyyymm.split("-");
  return `${MONTHS[parseInt(m) - 1]} ${y}`;
}

const IconBookmark = () => (<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>);
const IconTrash = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>);
const IconChevron = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>);
const IconFile = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>);
const IconPin = () => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>);
const IconWord = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>);
const IconPDF = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>);

// A4, matching the page geometry every other Knowledge Repository export uses.
const PAGE_SETUP = { properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } } };

async function withDocxClasses(fn) {
  const { Document, Packer, Table, WidthType, Paragraph, TextRun, ImageRun, HeadingLevel, TableRow, TableCell, BorderStyle, VerticalAlign, AlignmentType } = await import("https://esm.sh/docx@8.5.0");
  return fn({ Document, Packer, Table, WidthType, Paragraph, TextRun, ImageRun, HeadingLevel, TableRow, TableCell, BorderStyle, VerticalAlign, AlignmentType });
}

// A "Download X" trigger that opens a small PDF/Word menu instead of
// downloading immediately — mirrors ProjectDetailsPage's own export menu.
// Open state is controlled by the parent card so it can lift its own
// overflow:hidden while a menu is showing (otherwise the menu gets
// clipped by the card's rounded-corner clipping, especially when the
// card is collapsed and there's no room below the button).
function ExportMenuButton({ label, disabled, busy, busyLabel, open, onOpenChange, onSelect }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onOpenChange(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="slv-export-menu-root">
      <button type="button" className="slv-export-btn" disabled={disabled} onClick={() => onOpenChange(!open)}>
        {busy ? busyLabel : label}
        {!busy && <IconChevron />}
      </button>
      {open && !disabled && (
        <div className="slv-export-menu" role="menu">
          <button type="button" className="slv-export-menu-item" role="menuitem" onClick={() => { onOpenChange(false); onSelect("pdf"); }}>
            <IconPDF /> PDF
          </button>
          <button type="button" className="slv-export-menu-item" role="menuitem" onClick={() => { onOpenChange(false); onSelect("docx"); }}>
            <IconWord /> Word (.docx)
          </button>
        </div>
      )}
    </div>
  );
}

async function fetchShortlistProjects(shortlistId) {
  const { data } = await supabase
    .from("shortlist_projects")
    .select(`
      project_id, selected_kw_names,
      projects ( id, title, client, summary, location ),
      project_keyword_details: projects (
        project_keyword_details ( description, keywords ( name ) )
      )
    `)
    .eq("shortlist_id", shortlistId);
  return data || [];
}

function ShortlistCard({ shortlist, onOpenDetails, onRemoveProject, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [projects, setProjects] = useState([]);
  const [loading] = useState(false);
  const [busy, setBusy] = useState(null); // 'profile' | 'supportings' | 'both' | null
  const [busyLabel, setBusyLabel] = useState("");
  const [openMenu, setOpenMenu] = useState(null); // 'profile' | 'supportings' | 'both' | null
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();
  const fileBase = () => (shortlist.name || "shortlist").replace(/[^a-z0-9]/gi, "_");

  const count = shortlist.shortlist_projects?.length || 0;

  async function buildExportItems() {
    const raw = await fetchShortlistProjects(shortlist.id);
    const items = raw
      .map((sp) => {
        const project = sp.projects;
        const kwDetails = sp.project_keyword_details?.[0]?.project_keyword_details || [];
        const keywords = kwDetails.map((k) => ({ name: k.keywords?.name, description: k.description })).filter((k) => k.name);
        return { project, keywords, selectedKwNames: sp.selected_kw_names || [] };
      })
      .filter((item) => item.project);

    // One batched fetch for every project's documents (not one query per
    // project) — same project_documents table ProjectDetailsPage already
    // reads, just grouped by project_id here.
    const projectIds = items.map((it) => it.project.id);
    const docsByProject = {};
    if (projectIds.length > 0) {
      const { data: docs } = await supabase.from("project_documents").select("*").in("project_id", projectIds).order("created_at");
      (docs || []).forEach((d) => { (docsByProject[d.project_id] ||= []).push(d); });
    }
    return items.map((it) => ({ ...it, documents: docsByProject[it.project.id] || [] }));
  }

  function handleExpand() {
    if (!expanded && projects.length === 0) {
      const projs = (shortlist.shortlist_projects || []).map((sp) => ({ ...sp, project: sp.projects }));
      setProjects(projs);
    }
    setExpanded((e) => !e);
  }

  // "Download Profile" — every project's info page only, no documents.
  async function downloadProfile(format) {
    setBusy("profile");
    setBusyLabel("Preparing…");
    try {
      const items = await buildExportItems();
      if (format === "docx") {
        await withDocxClasses(async (docxClasses) => {
          const { Document, Packer, Table, WidthType } = docxClasses;
          const sections = items.map((item, i) => {
            const { rows, TW, colWidths } = buildProjectRows(item.project, item.keywords, item.selectedKwNames, docxClasses, i + 1);
            return { ...PAGE_SETUP, children: [new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: colWidths, rows })] };
          });
          const wordDoc = new Document({ styles: { default: { document: { run: { font: "Times New Roman", size: 20 } } } }, sections });
          const blob = await Packer.toBlob(wordDoc);
          downloadBlob(blob, `${fileBase()}_Profile.docx`);
        });
      } else {
        const blob = await buildKnowledgeShortlistProfilesPdf({
          items: items.map((it) => ({ label: it.project.title, projectInfoHtml: buildPreviewHTML(it.project, it.keywords, it.selectedKwNames, 1) })),
          onProgress: (i, total, name) => setBusyLabel(`Project ${i} of ${total}: ${name}`),
        });
        openPdfInNewTab(blob, `${fileBase()}_Profile.pdf`);
      }
      showToast(format === "docx" ? "Profiles downloaded." : "Profiles opened in a new tab.", "success");
    } catch (err) {
      console.error(err);
      showToast("Export failed.", "danger");
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  // "Download Supportings" — every project's uploaded documents only, no
  // project-info pages. Projects with nothing uploaded are skipped.
  async function downloadSupportings(format) {
    setBusy("supportings");
    setBusyLabel("Preparing…");
    try {
      const items = await buildExportItems();
      const withDocs = items.filter((it) => it.documents.length);
      if (withDocs.length === 0) {
        showToast("No uploaded documents found in this shortlist.", "danger");
        return;
      }
      if (format === "docx") {
        await withDocxClasses(async (docxClasses) => {
          const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docxClasses;
          const children = [];
          for (let i = 0; i < withDocs.length; i++) {
            const item = withDocs[i];
            children.push(new Paragraph({ heading: HeadingLevel.TITLE, pageBreakBefore: i > 0, children: [new TextRun(item.project.title)] }));
            children.push(...await buildKnowledgeDocumentsDocxChildren(
              item.documents, docxClasses, supabase,
              (docIdx, docTotal, name) => setBusyLabel(`${item.project.title}: ${name} (${docIdx}/${docTotal})`),
              { standalone: true }
            ));
          }
          const wordDoc = new Document({ styles: { default: { document: { run: { font: "Times New Roman", size: 20 } } } }, sections: [{ ...PAGE_SETUP, children }] });
          const blob = await Packer.toBlob(wordDoc);
          downloadBlob(blob, `${fileBase()}_Supporting_Documents.docx`);
        });
      } else {
        const blob = await buildKnowledgeShortlistSupportingsPdf({
          items: withDocs.map((it) => ({ label: it.project.title, documents: it.documents })),
          supabase,
          onProgress: (i, total, name) => setBusyLabel(name),
        });
        openPdfInNewTab(blob, `${fileBase()}_Supporting_Documents.pdf`);
      }
      showToast(format === "docx" ? "Supporting documents downloaded." : "Supporting documents opened in a new tab.", "success");
    } catch (err) {
      console.error(err);
      showToast("Export failed.", "danger");
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  // "Download Both" — every project's profile page(s) first, then every
  // project's uploaded documents, matching the single-project page's order.
  async function downloadBoth(format) {
    setBusy("both");
    setBusyLabel("Preparing…");
    try {
      const items = await buildExportItems();
      const withDocs = items.filter((it) => it.documents.length);
      if (format === "docx") {
        await withDocxClasses(async (docxClasses) => {
          const { Document, Packer, Table, WidthType, Paragraph, TextRun, HeadingLevel } = docxClasses;
          const sections = items.map((item, i) => {
            const { rows, TW, colWidths } = buildProjectRows(item.project, item.keywords, item.selectedKwNames, docxClasses, i + 1);
            return { ...PAGE_SETUP, children: [new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: colWidths, rows })] };
          });
          for (let i = 0; i < withDocs.length; i++) {
            const item = withDocs[i];
            const docChildren = await buildKnowledgeDocumentsDocxChildren(
              item.documents, docxClasses, supabase,
              (docIdx, docTotal, name) => setBusyLabel(`${item.project.title}: ${name} (${docIdx}/${docTotal})`),
              { standalone: true }
            );
            sections.push({ ...PAGE_SETUP, children: [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(item.project.title)] }), ...docChildren] });
          }
          const wordDoc = new Document({ styles: { default: { document: { run: { font: "Times New Roman", size: 20 } } } }, sections });
          const blob = await Packer.toBlob(wordDoc);
          downloadBlob(blob, `${fileBase()}.docx`);
        });
      } else {
        const blob = await buildKnowledgeShortlistBothPdf({
          items: items.map((it) => ({ label: it.project.title, projectInfoHtml: buildPreviewHTML(it.project, it.keywords, it.selectedKwNames, 1), documents: it.documents })),
          supabase,
          onProgress: (i, total, name) => setBusyLabel(name),
        });
        openPdfInNewTab(blob, `${fileBase()}.pdf`);
      }
      showToast(format === "docx" ? "Download complete." : "Opened in a new tab.", "success");
    } catch (err) {
      console.error(err);
      showToast("Export failed.", "danger");
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    await onDelete(shortlist.id);
    setDeleting(false);
    setConfirmDel(false);
  }

  function fmtDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <>
      <div className={`slv-card${expanded ? " slv-card--open" : ""}${openMenu ? " slv-card--menu-open" : ""}`}>
        <div className="slv-card-header">
          <button className="slv-card-toggle" onClick={handleExpand}>
            <span className={`slv-chevron${expanded ? " slv-chevron--open" : ""}`}><IconChevron /></span>
            <div className="slv-card-meta">
              <span className="slv-card-name">{shortlist.name}</span>
              <span className="slv-card-sub">
                {shortlist.creator_name && `by ${shortlist.creator_name}`}
                {shortlist.team && ` · ${shortlist.team}`}
                {` · ${fmtDate(shortlist.created_at)}`}
              </span>
            </div>
            <span className="slv-card-count">{count} project{count !== 1 ? "s" : ""}</span>
          </button>

          <div className="slv-card-actions">
            <ExportMenuButton
              label="Download Profile"
              busy={busy === "profile"}
              busyLabel={busyLabel}
              disabled={busy !== null || count === 0}
              open={openMenu === "profile"}
              onOpenChange={(v) => setOpenMenu(v ? "profile" : null)}
              onSelect={downloadProfile}
            />
            <ExportMenuButton
              label="Download Supportings"
              busy={busy === "supportings"}
              busyLabel={busyLabel}
              disabled={busy !== null || count === 0}
              open={openMenu === "supportings"}
              onOpenChange={(v) => setOpenMenu(v ? "supportings" : null)}
              onSelect={downloadSupportings}
            />
            <ExportMenuButton
              label="Download Both"
              busy={busy === "both"}
              busyLabel={busyLabel}
              disabled={busy !== null || count === 0}
              open={openMenu === "both"}
              onOpenChange={(v) => setOpenMenu(v ? "both" : null)}
              onSelect={downloadBoth}
            />
            {!confirmDel ? (
              <button className="slv-icon-btn slv-icon-btn--danger" onClick={() => setConfirmDel(true)} title="Delete shortlist"><IconTrash /></button>
            ) : (
              <div className="slv-confirm-row">
                <span className="slv-confirm-label">Delete?</span>
                <button className="slv-confirm-btn slv-confirm-btn--yes" onClick={handleDelete} disabled={deleting}>{deleting ? "…" : "Yes"}</button>
                <button className="slv-confirm-btn" onClick={() => setConfirmDel(false)}>No</button>
              </div>
            )}
          </div>
        </div>

        {expanded && (
          <div className="slv-projects">
            {loading && <div className="slv-state">Loading…</div>}
            {!loading && projects.length === 0 && <div className="slv-state">No projects in this shortlist.</div>}
            {!loading && projects.map((sp, i) => {
              const p = sp.project;
              if (!p) return null;
              const s = p.summary || {};
              return (
                <div key={sp.project_id || i} className="slv-project-row">
                  <button className="slv-project-btn" onClick={() => onOpenDetails(p.id)}>
                    <span className="slv-project-icon"><IconFile /></span>
                    <div className="slv-project-info">
                      <span className="slv-project-title">{p.title}</span>
                      <span className="slv-project-client">{p.client || "—"}</span>
                      <div className="slv-project-meta">
                        {p.location && <span className="slv-project-loc"><IconPin /> {p.location}</span>}
                        {(s.startDate || s.finishDate) && <span className="slv-project-date">{fmtYM(s.startDate)} – {fmtYM(s.finishDate)}</span>}
                      </div>
                      {sp.selected_kw_names?.length > 0 && (
                        <div className="slv-project-kws">
                          {sp.selected_kw_names.slice(0, 3).map((kw) => <span key={kw} className="slv-kw-tag">{kw}</span>)}
                          {sp.selected_kw_names.length > 3 && <span className="slv-kw-tag slv-kw-tag--more">+{sp.selected_kw_names.length - 3}</span>}
                        </div>
                      )}
                    </div>
                  </button>
                  <button className="slv-remove-btn" onClick={() => onRemoveProject(shortlist.id, sp.project_id)} title="Remove">×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default function ShortlistsPage() {
  const navigate = useNavigate();
  const { shortlists, loading, removeProject, deleteShortlist } = useShortlist();

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="slv-page">
          <div className="page-header">
            <div className="page-title-row">
              <div>
                <h1>Shortlists</h1>
                <p>Saved project collections — export as Word or PDF.</p>
              </div>
              <button className="btn-back" onClick={() => navigate(-1)}>← Back</button>
            </div>
          </div>

          {loading ? (
            <div className="slv-state-full">Loading shortlists…</div>
          ) : shortlists.length === 0 ? (
            <div className="card">
              <div className="card-body">
                <div className="slv-empty-state">
                  <IconBookmark />
                  <h3>No shortlists yet</h3>
                  <p>Open any project, select keywords, and click "Shortlist" to save it here.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="slv-list">
              {shortlists.map((sl) => (
                <ShortlistCard key={sl.id} shortlist={sl} onOpenDetails={(id) => navigate(`/knowledge/${id}`)} onRemoveProject={removeProject} onDelete={deleteShortlist} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
