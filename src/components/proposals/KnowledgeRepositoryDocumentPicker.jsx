// Picker for the AFC Internal Checklist's "attach from Knowledge Repository"
// flow. Two tabs mirroring the Knowledge Repository itself:
//   - Shortlists: the current user's own shortlists (RLS keeps these
//     creator-private — see 20260722030000_shortlists_private.sql), drill
//     into a shortlist's projects, then that project's documents.
//   - Company Docs: organization-wide documents (company_documents), a
//     flat list, no drilldown.
// Stays generic about what happens after selection — the caller
// (AfcChecklistPanel) does the actual download + re-upload into the
// proposal, keyed off the `kind` passed alongside the doc. Reads go
// straight to Supabase, gated by RLS.
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import { useShortlist } from "../../hooks/useShortlist";
import Modal from "../../components/ui/Modal";
import PageLoader from "../../components/ui/PageLoader";
import { BookIcon, FileTextIcon } from "../icons";

const TABS = [
  { id: "shortlists", label: "Shortlists", icon: <BookIcon /> },
  { id: "company", label: "Company Docs", icon: <FileTextIcon /> },
];

function ProjectDocumentBrowser({ project, onBack, onSelect }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error: err } = await supabase
        .from("project_documents")
        .select("id, name, file_name, storage_path")
        .eq("project_id", project.id)
        .order("name");
      if (err) { setError(err.message); setLoading(false); return; }
      setDocuments(data || []);
      setLoading(false);
    })();
  }, [project.id]);

  return (
    <>
      <button type="button" className="pp-picker-back" onClick={onBack}>← Back to projects</button>
      {error && <p className="text-secondary text-sm" style={{ color: "var(--color-danger, #dc2626)" }}>{error}</p>}
      {loading ? (
        <PageLoader text="Loading documents…" />
      ) : documents.length === 0 ? (
        <p className="text-secondary text-sm">No documents on this project.</p>
      ) : (
        <div className="pp-list-group">
          {documents.map((doc) => (
            <button key={doc.id} type="button" className="pp-list-row pp-picker-row" onClick={() => onSelect(doc, "project_document")}>
              <div>
                <div className="pp-list-row-title">{doc.name}</div>
                <div className="pp-list-row-sub">{doc.file_name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ShortlistsTab({ onSelect }) {
  const { shortlists, loading } = useShortlist();
  const [selectedShortlist, setSelectedShortlist] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  if (selectedProject) {
    return <ProjectDocumentBrowser project={selectedProject} onBack={() => setSelectedProject(null)} onSelect={onSelect} />;
  }

  if (selectedShortlist) {
    const projects = (selectedShortlist.shortlist_projects || [])
      .map((sp) => sp.projects)
      .filter(Boolean);
    return (
      <>
        <button type="button" className="pp-picker-back" onClick={() => setSelectedShortlist(null)}>← Back to shortlists</button>
        {projects.length === 0 ? (
          <p className="text-secondary text-sm">No projects in this shortlist.</p>
        ) : (
          <div className="pp-list-group">
            {projects.map((p) => (
              <button key={p.id} type="button" className="pp-list-row pp-picker-row" onClick={() => setSelectedProject(p)}>
                <div>
                  <div className="pp-list-row-title">{p.title}</div>
                  <div className="pp-list-row-sub">{[p.client, p.location].filter(Boolean).join(" · ") || "—"}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  return loading ? (
    <PageLoader text="Loading shortlists…" />
  ) : shortlists.length === 0 ? (
    <p className="text-secondary text-sm">You haven't created any shortlists yet.</p>
  ) : (
    <div className="pp-list-group">
      {shortlists.map((sl) => (
        <button key={sl.id} type="button" className="pp-list-row pp-picker-row" onClick={() => setSelectedShortlist(sl)}>
          <div>
            <div className="pp-list-row-title">{sl.name}</div>
            <div className="pp-list-row-sub">{(sl.shortlist_projects || []).length} project{(sl.shortlist_projects || []).length === 1 ? "" : "s"}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function CompanyDocsTab({ onSelect }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase
        .from("company_documents")
        .select("id, name, file_name, storage_path")
        .order("name");
      if (err) { setError(err.message); setLoading(false); return; }
      setDocuments(data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <>
      {error && <p className="text-secondary text-sm" style={{ color: "var(--color-danger, #dc2626)" }}>{error}</p>}
      {loading ? (
        <PageLoader text="Loading company documents…" />
      ) : documents.length === 0 ? (
        <p className="text-secondary text-sm">No company documents yet.</p>
      ) : (
        <div className="pp-list-group">
          {documents.map((doc) => (
            <button key={doc.id} type="button" className="pp-list-row pp-picker-row" onClick={() => onSelect(doc, "company_document")}>
              <div>
                <div className="pp-list-row-title">{doc.name}</div>
                <div className="pp-list-row-sub">{doc.file_name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export default function KnowledgeRepositoryDocumentPicker({ onSelect, onClose }) {
  const [tab, setTab] = useState("shortlists");

  return (
    <Modal onClose={onClose} size="md">
      <Modal.Header
        title="Pick from Knowledge Repository"
        subtitle="Search your shortlists or company documents for an existing file"
        onClose={onClose}
      />
      <div className="pp-picker-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`pp-picker-tab${tab === t.id ? " pp-picker-tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span className="pp-picker-tab-icon">{t.icon}</span>
            <span className="pp-picker-tab-text">{t.label}</span>
          </button>
        ))}
      </div>
      <Modal.Body>
        {tab === "shortlists" && <ShortlistsTab onSelect={onSelect} />}
        {tab === "company" && <CompanyDocsTab onSelect={onSelect} />}
      </Modal.Body>
    </Modal>
  );
}
