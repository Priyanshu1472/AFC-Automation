import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useShortlist } from "../../hooks/useShortlist";
import { buildProjectRows, buildPreviewHTML } from "../../utils/docxBuilder";
import AppHeader from "../../components/shared/AppHeader";
import PreviewModal from "../../components/ui/PreviewModal";
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

async function exportShortlistDocx(shortlistName, items) {
  try {
    const { Document, Packer, Table, WidthType, Paragraph, TextRun, TableRow, TableCell, BorderStyle, VerticalAlign, AlignmentType } = await import("https://esm.sh/docx@8.5.0");
    const docxClasses = { Paragraph, TextRun, TableRow, TableCell, BorderStyle, WidthType, VerticalAlign, AlignmentType };
    const sections = [];

    for (let i = 0; i < items.length; i++) {
      const { project, keywords, selectedKwNames } = items[i];
      const { rows, TW, colWidths } = buildProjectRows(project, keywords, selectedKwNames, docxClasses, i + 1);
      sections.push({
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
        children: [new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: colWidths, rows })],
      });
    }

    const wordDoc = new Document({ styles: { default: { document: { run: { font: "Times New Roman", size: 20 } } } }, sections });
    const blob = await Packer.toBlob(wordDoc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${shortlistName.replace(/[^a-z0-9]/gi, "_")}_shortlist.docx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Export failed:", err);
    alert("Export failed. Try again.");
  }
}

function buildShortlistPreviewHTML(items) {
  return items.map((item, i) => buildPreviewHTML(item.project, item.keywords, item.selectedKwNames, i + 1)).join('<div style="page-break-after:always;margin:32px 0;border-top:2px dashed #ccc;"></div>');
}

function ShortlistCard({ shortlist, onOpenDetails, onRemoveProject, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [projects, setProjects] = useState([]);
  const [loading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const count = shortlist.shortlist_projects?.length || 0;

  async function buildExportItems() {
    const raw = await fetchShortlistProjects(shortlist.id);
    return raw
      .map((sp) => {
        const project = sp.projects;
        const kwDetails = sp.project_keyword_details?.[0]?.project_keyword_details || [];
        const keywords = kwDetails.map((k) => ({ name: k.keywords?.name, description: k.description })).filter((k) => k.name);
        return { project, keywords, selectedKwNames: sp.selected_kw_names || [] };
      })
      .filter((item) => item.project);
  }

  function handleExpand() {
    if (!expanded && projects.length === 0) {
      const projs = (shortlist.shortlist_projects || []).map((sp) => ({ ...sp, project: sp.projects }));
      setProjects(projs);
    }
    setExpanded((e) => !e);
  }

  async function handleWordPreview() {
    setExporting(true);
    try {
      const items = await buildExportItems();
      setPreview({
        html: buildShortlistPreviewHTML(items),
        title: shortlist.name,
        downloadLabel: "Download Word",
        onDownload: async () => { await exportShortlistDocx(shortlist.name, items); setPreview(null); },
      });
    } finally {
      setExporting(false);
    }
  }

  async function handlePDFPreview() {
    setExporting(true);
    try {
      const items = await buildExportItems();
      setPreview({
        html: buildShortlistPreviewHTML(items),
        title: shortlist.name,
        downloadLabel: "Print / Save PDF",
        onDownload: () => { setPreview(null); setTimeout(() => window.print(), 200); },
      });
    } finally {
      setExporting(false);
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
      <div className={`slv-card${expanded ? " slv-card--open" : ""}`}>
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
            <button className="slv-export-btn" onClick={handleWordPreview} disabled={exporting || count === 0} title="Preview / Download as Word"><IconWord /> Word</button>
            <button className="slv-export-btn" onClick={handlePDFPreview} disabled={exporting || count === 0} title="Preview / Save as PDF"><IconPDF /> PDF</button>
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

      {preview && (
        <PreviewModal html={preview.html} title={preview.title} downloadLabel={preview.downloadLabel} onDownload={preview.onDownload} onClose={() => setPreview(null)} />
      )}
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
