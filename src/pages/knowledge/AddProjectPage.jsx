import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import { KeywordDropdown, DocumentUpload, INDIAN_STATES, CustomSelect, MonthPicker } from "../../components/knowledge/KnowledgeFormParts";
import "../../styles/AddProjectPage.css";

const BUCKET = "project-documents";

function monthsBetween(start, end) {
  if (!start || !end) return "";
  const [y1, m1] = String(start).split("-").map(Number);
  const [y2, m2] = String(end).split("-").map(Number);
  if (!y1 || !y2 || !m1 || !m2) return "";
  const diff = (y2 - y1) * 12 + (m2 - m1);
  return diff >= 0 ? String(diff) : "";
}

export default function AddProjectPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [form, setForm] = useState({
    projectName: "", shortform: "", servicesDescription: "",
    clientNameAddress: "", capitalCost: "",
    country: "India", location: "",
    contactPerson: "", titleDesignation: "", telephone: "", email: "",
    associatedConsultants: "",
    startDate: "", finishDate: "", projectBriefDescription: "",
    totalStaffMonths: "", associatedConsultantMonths: "",
    seniorProfessionalStaff: "",
  });

  const [allKeywords, setAllKeywords] = useState([]);
  const [selectedKeywords, setSelectedKeywords] = useState({});
  const [activeKeyword, setActiveKeyword] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from("keywords").select("id, name").order("name").then(({ data }) => setAllKeywords(data || []));
  }, []);

  const handleFormChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const toggleKeyword = (kwName) => {
    setSelectedKeywords((prev) => {
      if (prev[kwName] !== undefined) {
        const updated = { ...prev };
        delete updated[kwName];
        if (activeKeyword === kwName) setActiveKeyword(null);
        return updated;
      }
      setActiveKeyword(kwName);
      return { ...prev, [kwName]: "" };
    });
  };

  const handleDescChange = (kw, value) => setSelectedKeywords((prev) => ({ ...prev, [kw]: value }));

  const handleAddNew = async (name) => {
    const { data, error: kwErr } = await supabase.from("keywords").insert({ name }).select().single();
    if (kwErr || !data) return { error: kwErr };
    setAllKeywords((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedKeywords((prev) => ({ ...prev, [data.name]: "" }));
    setActiveKeyword(data.name);
    return { data };
  };

  const handleAddDoc = (doc) => setDocuments((prev) => [...prev, doc]);
  const handleRemoveDoc = (i) => setDocuments((prev) => prev.filter((_, idx) => idx !== i));

  async function handleSubmit() {
    setError("");
    if (!form.projectName.trim()) { setError("Project name is required."); return; }
    if (Object.keys(selectedKeywords).length === 0) { setError("Please select at least one keyword."); return; }
    setLoading(true);

    const summaryData = {
      servicesDescription: form.servicesDescription,
      capitalCost: form.capitalCost,
      country: form.country,
      contactPerson: form.contactPerson,
      titleDesignation: form.titleDesignation,
      telephone: form.telephone,
      email: form.email,
      associatedConsultants: form.associatedConsultants,
      startDate: form.startDate,
      finishDate: form.finishDate,
      projectBriefDescription: form.projectBriefDescription,
      totalStaffMonths: form.totalStaffMonths,
      associatedConsultantMonths: form.associatedConsultantMonths,
      seniorProfessionalStaff: form.seniorProfessionalStaff,
    };

    const { data: project, error: pError } = await supabase
      .from("projects")
      .insert([{
        title: form.projectName,
        client: form.clientNameAddress,
        summary: summaryData,
        location: form.location || null,
        shortform: form.shortform || null,
        team: profile?.team ?? null,
        created_by: profile?.id ?? null,
      }])
      .select()
      .single();

    if (pError || !project) {
      console.error(pError);
      setLoading(false);
      setError("Error saving project. Please try again.");
      return;
    }

    for (const [kwName, kwDesc] of Object.entries(selectedKeywords)) {
      const existing = allKeywords.find((k) => k.name === kwName);
      let keywordId = existing?.id;
      if (!keywordId) {
        const { data: newKw } = await supabase.from("keywords").insert({ name: kwName }).select().single();
        keywordId = newKw?.id;
      }
      if (keywordId) {
        await supabase.from("project_keyword_details").insert({ project_id: project.id, keyword_id: keywordId, description: kwDesc });
      }
    }

    // Documents were only staged in memory until now — the storage RLS
    // policy needs the project row to already exist to accept the upload.
    for (const doc of documents) {
      if (doc.pending && doc.file) {
        const path = `${project.id}/${Date.now()}_${doc.file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, doc.file);
        if (upErr) { console.error("Document upload failed:", upErr.message); continue; }
        await supabase.from("project_documents").insert({ project_id: project.id, name: doc.name, file_name: doc.file_name, storage_path: path });
      }
    }

    await supabase.from("application_audit_log").insert({
      action: "project_added",
      action_by: profile?.id ?? null,
      action_by_role: profile?.role ?? null,
      comment: `Project "${project.title}" added to Knowledge Repository by ${profile?.full_name || "unknown"}.`,
    });

    setLoading(false);
    navigate(`/knowledge/${project.id}`);
  }

  const durationAuto = monthsBetween(form.startDate, form.finishDate);

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="add-project-wrapper">
          <div className="form-header">
            <div className="page-title-row">
              <div>
                <h1>Add Project</h1>
                <p>Fill in the project details and save to the Knowledge Repository.</p>
              </div>
              <button className="btn-back" onClick={() => navigate(-1)} disabled={loading}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13"><polyline points="15 18 9 12 15 6" /></svg>
                Back
              </button>
            </div>
          </div>

          {error && <div className="efp-doc-error" style={{ marginBottom: "var(--space-4)" }}>{error}</div>}

          <div className="card">
            <div className="card-body">
              <div className="ap-form-grid">
                <div className="ap-field full-width">
                  <label>Name of the Project (Assignment name) *</label>
                  <input type="text" placeholder="e.g. Smart City Master Plan, Kolkata" value={form.projectName} onChange={(e) => handleFormChange("projectName", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Short Form / Abbreviation</label>
                  <input type="text" placeholder="e.g. SCMP-KOL" value={form.shortform} onChange={(e) => handleFormChange("shortform", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Approx. Value of the Contract (₹ Crore)</label>
                  <input type="number" placeholder="e.g. 45.50" value={form.capitalCost} onChange={(e) => handleFormChange("capitalCost", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Country</label>
                  <input type="text" placeholder="e.g. India" value={form.country} onChange={(e) => handleFormChange("country", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Location within Country (State / UT)</label>
                  <CustomSelect value={form.location} onChange={(v) => handleFormChange("location", v)} options={[{ value: "", label: "— Select State / UT —" }, ...INDIAN_STATES.map((s) => ({ value: s, label: s }))]} placeholder="— Select State / UT —" />
                </div>

                <div className="ap-field full-width">
                  <label>Name and Address of Client</label>
                  <textarea rows={2} placeholder="Client name & full address" value={form.clientNameAddress} onChange={(e) => handleFormChange("clientNameAddress", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Contact Person</label>
                  <input type="text" placeholder="e.g. Mr. A. Roy" value={form.contactPerson} onChange={(e) => handleFormChange("contactPerson", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Title / Designation</label>
                  <input type="text" placeholder="e.g. Chief Engineer" value={form.titleDesignation} onChange={(e) => handleFormChange("titleDesignation", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Telephone</label>
                  <input type="text" placeholder="e.g. +91 98300 00000" value={form.telephone} onChange={(e) => handleFormChange("telephone", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Email</label>
                  <input type="email" placeholder="e.g. rep@client.gov.in" value={form.email} onChange={(e) => handleFormChange("email", e.target.value)} />
                </div>

                <div className="ap-field">
                  <div className="ap-date-row">
                    <div>
                      <label>Start Date (month/year)</label>
                      <MonthPicker value={form.startDate} onChange={(v) => handleFormChange("startDate", v)} placeholder="Select start month" />
                    </div>
                    <div>
                      <label>Completion Date (month/year)</label>
                      <MonthPicker value={form.finishDate} onChange={(v) => handleFormChange("finishDate", v)} placeholder="Select finish month" />
                    </div>
                  </div>
                </div>

                <div className="ap-field">
                  <label>Duration of Assignment (months)</label>
                  <input type="text" readOnly value={durationAuto || ""} placeholder="Auto-calculated from dates" style={{ background: "var(--surface-2, #f5f5f5)", cursor: "not-allowed" }} />
                </div>

                <div className="ap-field">
                  <label>Total Staff-Months of the Assignment</label>
                  <input type="number" placeholder="e.g. 24" value={form.totalStaffMonths} onChange={(e) => handleFormChange("totalStaffMonths", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Professional Staff-Months (your firm / sub-consultants)</label>
                  <input type="number" placeholder="e.g. 8" value={form.associatedConsultantMonths} onChange={(e) => handleFormChange("associatedConsultantMonths", e.target.value)} />
                </div>

                <div className="ap-field full-width">
                  <label>Name of Associated Consultants, if any</label>
                  <textarea rows={2} placeholder="e.g. XYZ Advisory Pvt Ltd (leave blank if none)" value={form.associatedConsultants} onChange={(e) => handleFormChange("associatedConsultants", e.target.value)} />
                </div>

                <div className="ap-field full-width">
                  <label>Name of Senior Professional Staff & Functions</label>
                  <textarea rows={3} placeholder="e.g. John Doe – Project Director; Jane Smith – Team Leader" value={form.seniorProfessionalStaff} onChange={(e) => handleFormChange("seniorProfessionalStaff", e.target.value)} />
                </div>

                <div className="ap-field full-width">
                  <label>Description of Project</label>
                  <textarea rows={4} placeholder="Overview of project scope, objectives, outcomes..." value={form.projectBriefDescription} onChange={(e) => handleFormChange("projectBriefDescription", e.target.value)} />
                </div>

                <div className="ap-field full-width">
                  <label>Description of Actual Services Provided by Your Staff</label>
                  <textarea rows={3} placeholder="Describe services actually rendered..." value={form.servicesDescription} onChange={(e) => handleFormChange("servicesDescription", e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <h3>Keywords *</h3>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>Search existing keywords or type to add a new one.</p>
              </div>
            </div>
            <div className="card-body">
              <KeywordDropdown allKeywords={allKeywords} selectedKeywords={selectedKeywords} onToggle={toggleKeyword} onAddNew={handleAddNew} activeKeyword={activeKeyword} onSetActive={setActiveKeyword} onDescChange={handleDescChange} />
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <h3>Documents</h3>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>Attach Work Order, Completion Certificate, MoU, etc. (optional)</p>
              </div>
            </div>
            <div className="card-body">
              <DocumentUpload projectId={null} documents={documents} onAdd={handleAddDoc} onRemove={handleRemoveDoc} />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <button className="ap-btn-save" onClick={handleSubmit} disabled={loading}>
              {loading ? "Saving…" : "Save Project"}
            </button>
            <button className="ap-btn-cancel" onClick={() => navigate(-1)} disabled={loading}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
