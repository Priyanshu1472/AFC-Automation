import { useCallback, useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useShortlist } from "../../hooks/useShortlist";
import { useToast } from "../../hooks/useToast";
import { buildProjectRows, buildPreviewHTML, formatMonth } from "../../utils/docxBuilder";
import { buildKnowledgeDocumentsDocxChildren, buildKnowledgeProjectPdf, buildKnowledgeSupportingsPdf, downloadBlob, openPdfInNewTab } from "../../utils/knowledgeDocumentEmbed";
import { openProjectDocument } from "../../components/knowledge/KnowledgeFormParts";
import AppHeader from "../../components/shared/AppHeader";
import PageLoader from "../../components/ui/PageLoader";
import Alert from "../../components/ui/Alert";
import ShortlistModal from "../../components/knowledge/ShortlistModal";
import "../../styles/ProjectDetailsPage.css";

const IconWord = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>);
const IconPDF = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>);
const IconEdit = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>);
const IconBookmark = ({ filled }) => (<svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>);
const IconChevron = () => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>);

// A single "Download X" trigger that opens a small PDF/Word menu instead
// of immediately downloading — three of these (Profile / Supportings /
// Both) replace the old single Word+PDF button pair.
function ExportMenuButton({ label, disabled, busy, busyLabel, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="pd-export-menu-root">
      <button type="button" className="btn-export btn-export-word" disabled={disabled} onClick={() => setOpen((o) => !o)}>
        {busy ? busyLabel : label}
        {!busy && <IconChevron />}
      </button>
      {open && !disabled && (
        <div className="pd-export-menu" role="menu">
          <button type="button" className="pd-export-menu-item" role="menuitem" onClick={() => { setOpen(false); onSelect("pdf"); }}>
            <IconPDF /> PDF
          </button>
          <button type="button" className="pd-export-menu-item" role="menuitem" onClick={() => { setOpen(false); onSelect("docx"); }}>
            <IconWord /> Word (.docx)
          </button>
        </div>
      )}
    </div>
  );
}

function KeywordDropdown({ keywords, selectedKws, onToggle, onSelectAll, onClear }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = keywords.filter((kw) => kw.name?.toLowerCase().includes(search.toLowerCase()));
  const selectedCount = selectedKws.size;

  return (
    <div ref={ref} className="pd-kw-root">
      <button className="pd-kw-trigger" onClick={() => setOpen((o) => !o)}>
        <div className="pd-kw-trigger-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <span className={selectedCount > 0 ? "pd-kw-label" : "pd-kw-placeholder"}>
            {selectedCount > 0 ? `${selectedCount} keyword${selectedCount > 1 ? "s" : ""} selected` : `Select keywords for export (${keywords.length} total)`}
          </span>
        </div>
        <div className="pd-kw-trigger-right">
          {selectedCount > 0 && <span className="pd-kw-count">{selectedCount}</span>}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" className={`pd-kw-chevron${open ? " pd-kw-chevron--open" : ""}`}><polyline points="6 9 12 15 18 9" /></svg>
        </div>
      </button>

      {open && (
        <div className="pd-kw-panel">
          <div className="pd-kw-search-wrap">
            <div className="pd-kw-search-inner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" className="pd-kw-search-icon"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search keywords…" autoFocus className="pd-kw-search-input" />
              {search && <button className="pd-kw-search-clear" onClick={() => setSearch("")}>×</button>}
            </div>
            <div className="pd-kw-search-actions">
              <button className="pd-kw-action-btn pd-kw-action-btn--all" onClick={onSelectAll}>All</button>
              {selectedCount > 0 && <button className="pd-kw-action-btn" onClick={onClear}>Clear</button>}
            </div>
          </div>

          <div className="pd-kw-list">
            {filtered.length === 0 ? (
              <div className="pd-kw-empty">No keywords match "{search}"</div>
            ) : (
              filtered.map((kw, i) => {
                const isSelected = selectedKws.has(kw.name);
                return (
                  <button key={i} onClick={() => onToggle(kw.name)} className={`pd-kw-option${isSelected ? " pd-kw-option--selected" : ""}`}>
                    <div className={`pd-kw-checkbox${isSelected ? " pd-kw-checkbox--checked" : ""}`}>
                      {isSelected && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" width="10" height="10"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                    <div className="pd-kw-option-content">
                      <div className={`pd-kw-option-name${isSelected ? " pd-kw-option-name--selected" : ""}`}>{kw.name}</div>
                      {kw.description && <div className="pd-kw-option-desc">{kw.description}</div>}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="pd-kw-footer">
            {selectedCount === 0 ? "No keywords selected — export will use project's brief description" : `${selectedCount} selected — only these will appear in the export`}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [project, setProject] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedKws, setSelectedKws] = useState(new Set());
  const [showSlModal, setShowSlModal] = useState(false);
  const [busy, setBusy] = useState(null); // 'profile' | 'supportings' | 'both' | null
  const [busyLabel, setBusyLabel] = useState("");
  const { showToast } = useToast();

  const { shortlists, createShortlist, addToShortlist, isInAnyShortlist, getProjectShortlists } = useShortlist();

  const shortlisted = project ? isInAnyShortlist(project.id) : false;
  const alreadyInSlIds = project ? getProjectShortlists(project.id) : [];

  const fetchProjectDetails = useCallback(async () => {
    setLoading(true);
    setSelectedKws(new Set());
    const { data: proj } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
    if (!proj) { setNotFound(true); setLoading(false); return; }
    setProject(proj);

    const { data: kwData } = await supabase.from("project_keyword_details").select("description, keywords(name)").eq("project_id", id);
    if (kwData) setKeywords(kwData.map((k) => ({ name: k.keywords?.name, description: k.description })));

    const { data: docs } = await supabase.from("project_documents").select("*").eq("project_id", id).order("created_at");
    setDocuments(docs || []);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchProjectDetails(); }, [fetchProjectDetails]);

  const toggleKw = (name) => setSelectedKws((prev) => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  const selectAll = () => setSelectedKws(new Set(keywords.map((k) => k.name)));
  const clearSel = () => setSelectedKws(new Set());
  const selectedKwNames = [...selectedKws];

  const handleAddToExisting = (shortlistId) => addToShortlist(project.id, selectedKwNames, shortlistId);
  const handleCreateNew = async (name) => {
    const sl = await createShortlist(name);
    await addToShortlist(project.id, selectedKwNames, sl.id);
  };

  const fileBase = () => (project.title || "project").replace(/[^a-z0-9]/gi, "_");

  async function withDocxClasses(fn) {
    const { Document, Packer, Table, WidthType, Paragraph, TextRun, ImageRun, HeadingLevel, TableRow, TableCell, BorderStyle, VerticalAlign, AlignmentType } = await import("https://esm.sh/docx@8.5.0");
    return fn({ Document, Packer, Table, WidthType, Paragraph, TextRun, ImageRun, HeadingLevel, TableRow, TableCell, BorderStyle, VerticalAlign, AlignmentType });
  }

  // "Download Profile" — just the project-info table (the first page of
  // what the old combined export produced), no uploaded documents.
  async function downloadProfile(format) {
    setBusy("profile");
    setBusyLabel("Preparing…");
    try {
      if (format === "docx") {
        await withDocxClasses(async (docxClasses) => {
          const { Document, Packer, Table, WidthType } = docxClasses;
          const { rows, TW, colWidths } = buildProjectRows(project, keywords, selectedKwNames, docxClasses, 1, documents);
          const wordDoc = new Document({
            styles: { default: { document: { run: { font: "Times New Roman", size: 20 } } } },
            sections: [{
              properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
              children: [new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: colWidths, rows })],
            }],
          });
          const blob = await Packer.toBlob(wordDoc);
          downloadBlob(blob, `${fileBase()}_Profile.docx`);
        });
      } else {
        const html = buildPreviewHTML(project, keywords, selectedKwNames, 1, documents);
        const blob = await buildKnowledgeProjectPdf({ projectInfoHtml: html, documents: [], supabase, onProgress: () => {} });
        openPdfInNewTab(blob, `${fileBase()}_Profile.pdf`);
      }
      showToast(format === "docx" ? "Profile downloaded." : "Profile opened in a new tab.", "success");
    } catch (err) {
      console.error(err);
      showToast("Export failed.", "danger");
    } finally {
      setBusy(null);
      setBusyLabel("");
    }
  }

  // "Download Supportings" — just the uploaded documents, no project-info
  // table. Disabled in the UI when there are none.
  async function downloadSupportings(format) {
    if (!documents.length) return;
    setBusy("supportings");
    setBusyLabel("Preparing…");
    try {
      if (format === "docx") {
        await withDocxClasses(async (docxClasses) => {
          const { Document, Packer } = docxClasses;
          const documentChildren = await buildKnowledgeDocumentsDocxChildren(
            documents, docxClasses, supabase,
            (i, total, name) => setBusyLabel(`Adding ${i} of ${total}: ${name}`),
            { standalone: true }
          );
          const wordDoc = new Document({
            styles: { default: { document: { run: { font: "Times New Roman", size: 20 } } } },
            sections: [{
              properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
              children: documentChildren,
            }],
          });
          const blob = await Packer.toBlob(wordDoc);
          downloadBlob(blob, `${fileBase()}_Supporting_Documents.docx`);
        });
      } else {
        const blob = await buildKnowledgeSupportingsPdf({
          documents,
          title: project.title,
          supabase,
          onProgress: (i, total, name) => setBusyLabel(`Adding ${i} of ${total}: ${name}`),
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

  // "Download Both" — the project-info table plus every uploaded document
  // merged in, exactly what the old single Word/PDF buttons produced.
  async function downloadBoth(format) {
    setBusy("both");
    setBusyLabel(documents.length ? "Preparing…" : "");
    try {
      if (format === "docx") {
        await withDocxClasses(async (docxClasses) => {
          const { Document, Packer, Table, WidthType } = docxClasses;
          const { rows, TW, colWidths } = buildProjectRows(project, keywords, selectedKwNames, docxClasses, 1, documents);
          const documentChildren = await buildKnowledgeDocumentsDocxChildren(
            documents, docxClasses, supabase,
            (i, total, name) => setBusyLabel(`Adding document ${i} of ${total}: ${name}`)
          );
          const wordDoc = new Document({
            styles: { default: { document: { run: { font: "Times New Roman", size: 20 } } } },
            sections: [{
              properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
              children: [new Table({ width: { size: TW, type: WidthType.DXA }, columnWidths: colWidths, rows }), ...documentChildren],
            }],
          });
          const blob = await Packer.toBlob(wordDoc);
          downloadBlob(blob, `${fileBase()}.docx`);
        });
      } else {
        const html = buildPreviewHTML(project, keywords, selectedKwNames, 1, documents);
        const blob = await buildKnowledgeProjectPdf({
          projectInfoHtml: html,
          documents,
          supabase,
          onProgress: (i, total, name) => setBusyLabel(total > 1 ? `Adding ${i} of ${total}: ${name}` : "Preparing PDF…"),
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

  if (loading) return <PageLoader text="Loading project details…" />;

  if (notFound || !project) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="app-container"><Alert variant="danger">Project not found.</Alert></div>
      </div>
    );
  }

  const summary = project.summary || {};

  const canEdit =
    !!profile &&
    (profile.id === project.created_by || profile.role === "md" || (profile.role === "dgm" && !!profile.teams?.includes(project.team)));

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="details-page">
          <div className="details-topbar">
            <button className="btn-back" onClick={() => navigate(-1)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><polyline points="15 18 9 12 15 6" /></svg>
              Back
            </button>
            <div className="details-actions">
              {canEdit && (
                <button className="btn-export btn-export-edit" onClick={() => navigate(`/knowledge/${id}/edit`)}>
                  <IconEdit /> Edit
                </button>
              )}
              <button className={`btn-export ${shortlisted ? "btn-shortlisted" : "btn-export-shortlist"}`} onClick={() => setShowSlModal(true)}>
                <IconBookmark filled={shortlisted} />
                {shortlisted ? "Shortlisted ✓" : "Shortlist"}
              </button>
              <ExportMenuButton
                label="Download Profile"
                busy={busy === "profile"}
                busyLabel={busyLabel}
                disabled={busy !== null}
                onSelect={downloadProfile}
              />
              <ExportMenuButton
                label="Download Supportings"
                busy={busy === "supportings"}
                busyLabel={busyLabel}
                disabled={busy !== null || documents.length === 0}
                onSelect={downloadSupportings}
              />
              <ExportMenuButton
                label="Download Both"
                busy={busy === "both"}
                busyLabel={busyLabel}
                disabled={busy !== null}
                onSelect={downloadBoth}
              />
            </div>
          </div>

          <div className="details-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="details-badge">Project Details</div>
              {project.team && <span className="details-team-badge">{project.team}</span>}
            </div>
            <h1 className="details-title">{project.title}</h1>
          </div>

          <div className="details-grid">
            <div className="details-card">
              <h3 className="card-section-title">Client Information</h3>
              <div className="detail-row"><span className="detail-label">Client</span><span className="detail-value">{project.client || "—"}</span></div>
              <div className="detail-row"><span className="detail-label">Representative</span><span className="detail-value">{summary.contactPerson || "—"}</span></div>
            </div>

            <div className="details-card">
              <h3 className="card-section-title">Project Timeline</h3>
              <div className="detail-row"><span className="detail-label">Start Date</span><span className="detail-value">{formatMonth(summary.startDate)}</span></div>
              <div className="detail-row"><span className="detail-label">Finish Date</span><span className="detail-value">{formatMonth(summary.finishDate)}</span></div>
              <div className="detail-row"><span className="detail-label">Capital Cost</span><span className="detail-value">{summary.capitalCost ? `₹${summary.capitalCost} Crore` : "—"}</span></div>
            </div>

            <div className="details-card full-card">
              <h3 className="card-section-title">Staff Information</h3>
              <div className="staff-info-grid">
                <div className="detail-row"><span className="detail-label">Total Staff-Months</span><span className="detail-value">{summary.totalStaffMonths || "—"}</span></div>
                <div className="detail-row"><span className="detail-label">Assoc. Consultant Months</span><span className="detail-value">{summary.associatedConsultantMonths || "—"}</span></div>
              </div>
              {summary.seniorProfessionalStaff && (
                <div className="detail-row detail-row-block" style={{ marginTop: 10 }}>
                  <span className="detail-label">Senior Professional Staff</span>
                  <span className="detail-multiline">{summary.seniorProfessionalStaff}</span>
                </div>
              )}
            </div>

            {summary.servicesDescription && (
              <div className="details-card full-card">
                <h3 className="card-section-title">Services Performed</h3>
                <p className="detail-para">{summary.servicesDescription}</p>
              </div>
            )}

            {summary.projectBriefDescription && (
              <div className="details-card full-card">
                <h3 className="card-section-title">Project Description</h3>
                <p className="detail-para">{summary.projectBriefDescription}</p>
              </div>
            )}

            {keywords.length > 0 && (
              <div className="details-card full-card">
                <h3 className="card-section-title">Keywords for Export</h3>
                <p className="details-card-hint">Select which keywords to include in Word/PDF export. If none selected, brief description is used.</p>
                <KeywordDropdown keywords={keywords} selectedKws={selectedKws} onToggle={toggleKw} onSelectAll={selectAll} onClear={clearSel} />
              </div>
            )}

            {documents.length > 0 && (
              <div className="details-card full-card">
                <h3 className="card-section-title">Project Documents</h3>
                <div className="details-doc-list">
                  {documents.map((doc) => (
                    <button key={doc.id} onClick={() => openProjectDocument(doc.storage_path)} className="details-doc-item" style={{ background: "none", border: "1px solid var(--border-default, #e5e7eb)", cursor: "pointer", width: "100%", textAlign: "left" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="details-doc-icon"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                      <div className="details-doc-info">
                        <div className="details-doc-name">{doc.name}</div>
                        <div className="details-doc-file">{doc.file_name}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {showSlModal && project && (
            <ShortlistModal projectTitle={project.title} shortlists={shortlists} alreadyIn={alreadyInSlIds} onAddToExisting={handleAddToExisting} onCreateNew={handleCreateNew} onClose={() => setShowSlModal(false)} />
          )}
        </div>
      </div>
    </div>
  );
}
