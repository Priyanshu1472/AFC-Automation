// Two-level picker: browse/search Knowledge Repository projects, then pick
// one of that project's documents. Stays generic about what happens after
// selection — the caller (AfcChecklistPanel) does the actual download +
// re-upload into the proposal. Reads go straight to Supabase (projects/
// project_documents both allow any non-BA staff role to SELECT).
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabase";
import Modal from "../../components/ui/Modal";
import PageLoader from "../../components/ui/PageLoader";

export default function KnowledgeRepositoryDocumentPicker({ onSelect, onClose }) {
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error: err } = await supabase.from("projects").select("id, title, client, location").order("title");
      if (err) { setError(err.message); setLoadingProjects(false); return; }
      setProjects(data || []);
      setLoadingProjects(false);
    })();
  }, []);

  async function openProject(project) {
    setSelectedProject(project);
    setLoadingDocs(true);
    setError("");
    const { data, error: err } = await supabase
      .from("project_documents")
      .select("id, name, file_name, storage_path")
      .eq("project_id", project.id)
      .order("name");
    if (err) { setError(err.message); setLoadingDocs(false); return; }
    setDocuments(data || []);
    setLoadingDocs(false);
  }

  const s = search.trim().toLowerCase();
  const filtered = s
    ? projects.filter((p) => (p.title || "").toLowerCase().includes(s) || (p.client || "").toLowerCase().includes(s))
    : projects;

  return (
    <Modal onClose={onClose} size="md">
      <Modal.Header
        title={selectedProject ? selectedProject.title : "Pick from Knowledge Repository"}
        subtitle={selectedProject ? "Choose a document from this project" : "Search past projects for an existing document"}
        onClose={onClose}
      />
      <Modal.Body>
        {error && <p className="text-secondary text-sm" style={{ color: "var(--color-danger, #dc2626)" }}>{error}</p>}

        {!selectedProject && (
          <>
            <input
              type="text" className="input" placeholder="Search by project title or client…"
              value={search} onChange={(e) => setSearch(e.target.value)} autoFocus
              style={{ marginBottom: "var(--space-3)" }}
            />
            {loadingProjects ? (
              <PageLoader text="Loading projects…" />
            ) : filtered.length === 0 ? (
              <p className="text-secondary text-sm">No projects found.</p>
            ) : (
              <div className="pp-list-group">
                {filtered.map((p) => (
                  <button key={p.id} type="button" className="pp-list-row pp-picker-row" onClick={() => openProject(p)}>
                    <div>
                      <div className="pp-list-row-title">{p.title}</div>
                      <div className="pp-list-row-sub">{[p.client, p.location].filter(Boolean).join(" · ") || "—"}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {selectedProject && (
          <>
            <button type="button" className="pp-picker-back" onClick={() => { setSelectedProject(null); setDocuments([]); }}>
              ← Back to projects
            </button>
            {loadingDocs ? (
              <PageLoader text="Loading documents…" />
            ) : documents.length === 0 ? (
              <p className="text-secondary text-sm">No documents on this project.</p>
            ) : (
              <div className="pp-list-group">
                {documents.map((doc) => (
                  <button key={doc.id} type="button" className="pp-list-row pp-picker-row" onClick={() => onSelect(doc)}>
                    <div>
                      <div className="pp-list-row-title">{doc.name}</div>
                      <div className="pp-list-row-sub">{doc.file_name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Modal.Body>
    </Modal>
  );
}
