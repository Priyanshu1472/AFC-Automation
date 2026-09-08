import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import { KeywordDropdown, DocumentUpload, INDIAN_STATES, CustomSelect, MonthPicker } from "../../components/knowledge/KnowledgeFormParts";
import "../../styles/AddProjectPage.css";

function monthsBetween(start, end) {
  if (!start || !end) return "";
  const [y1, m1] = String(start).split("-").map(Number);
  const [y2, m2] = String(end).split("-").map(Number);
  if (!y1 || !y2 || !m1 || !m2) return "";
  const diff = (y2 - y1) * 12 + (m2 - m1);
  return diff >= 0 ? String(diff) : "";
}

export default function EditProjectPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [form, setForm] = useState(null);
  const [projectTeam, setProjectTeam] = useState(null);
  const [projectCreatedBy, setProjectCreatedBy] = useState(null);
  const [allKeywords, setAllKeywords] = useState([]);
  const [selectedKeywords, setSelectedKeywords] = useState({});
  const [activeKeyword, setActiveKeyword] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    const { data: proj } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
    if (!proj) { setNotFound(true); setLoading(false); return; }

    setProjectTeam(proj.team);
    setProjectCreatedBy(proj.created_by);
    const s = proj.summary || {};

    setForm({
      projectName: proj.title || "",
      shortform: proj.shortform || "",
      servicesDescription: s.servicesDescription || "",
      clientNameAddress: proj.client || "",
      capitalCost: s.capitalCost || "",
      country: s.country || "India",
      location: proj.location || "",
      contactPerson: s.contactPerson || "",
      titleDesignation: s.titleDesignation || "",
      telephone: s.telephone || "",
      email: s.email || "",
      associatedConsultants: s.associatedConsultants || "",
      startDate: s.startDate || "",
      finishDate: s.finishDate || "",
      projectBriefDescription: s.projectBriefDescription || "",
      totalStaffMonths: s.totalStaffMonths || "",
      associatedConsultantMonths: s.associatedConsultantMonths || "",
      seniorProfessionalStaff: s.seniorProfessionalStaff || "",
    });

    const { data: kws } = await supabase.from("keywords").select("id, name").order("name");
    setAllKeywords(kws || []);

    const { data: kwData } = await supabase.from("project_keyword_details").select("description, keywords(id, name)").eq("project_id", id);
    const kwMap = {};
    (kwData || []).forEach((k) => { if (k.keywords?.name) kwMap[k.keywords.name] = k.description || ""; });
    setSelectedKeywords(kwMap);

    const { data: docs } = await supabase.from("project_documents").select("*").eq("project_id", id).order("created_at");
    setDocuments(docs || []);
    setLoading(false);
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  const canEdit =
    !!profile &&
    (profile.id === projectCreatedBy || profile.role === "md" || (profile.role === "dgm" && !!profile.teams?.includes(projectTeam)));

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

  async function handleSave() {
    setError("");
    if (!form.projectName.trim()) { setError("Project name is required."); return; }
    if (Object.keys(selectedKeywords).length === 0) { setError("Please select at least one keyword."); return; }
    setSaving(true);

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

    const { error: updateErr } = await supabase
      .from("projects")
      .update({ title: form.projectName, client: form.clientNameAddress, summary: summaryData, location: form.location || null, shortform: form.shortform || null })
      .eq("id", id);

    if (updateErr) {
      setSaving(false);
      setError("Failed to save changes. Please try again.");
      return;
    }

    await supabase.from("project_keyword_details").delete().eq("project_id", id);
    for (const [kwName, kwDesc] of Object.entries(selectedKeywords)) {
      const existing = allKeywords.find((k) => k.name === kwName);
      let keywordId = existing?.id;
      if (!keywordId) {
        const { data: newKw } = await supabase.from("keywords").insert({ name: kwName }).select().single();
        keywordId = newKw?.id;
      }
      if (keywordId) {
        await supabase.from("project_keyword_details").insert({ project_id: id, keyword_id: keywordId, description: kwDesc });
      }
    }

    await supabase.from("application_audit_log").insert({
      action: "project_edited",
      action_by: profile?.id ?? null,
      action_by_role: profile?.role ?? null,
      comment: `Project "${form.projectName}" edited in Knowledge Repository by ${profile?.full_name || "unknown"}.`,
    });

    setSaving(false);
    navigate(`/knowledge/${id}`);
  }

  if (loading) return <PageLoader text="Loading project…" />;

  if (notFound) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="app-container"><Alert variant="danger">Project not found.</Alert></div>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="app-container"><Alert variant="danger">You don't have permission to edit this project.</Alert></div>
      </div>
    );
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
                <h1>Edit Project</h1>
                <p>Update the project details and save changes.</p>
              </div>
              <button className="btn-back" onClick={() => navigate(-1)} disabled={saving}>
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
                  <input type="text" value={form.projectName} onChange={(e) => handleFormChange("projectName", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Short Form / Abbreviation</label>
                  <input type="text" value={form.shortform} onChange={(e) => handleFormChange("shortform", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Approx. Value of the Contract (₹ Crore)</label>
                  <input type="number" value={form.capitalCost} onChange={(e) => handleFormChange("capitalCost", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Country</label>
                  <input type="text" value={form.country} onChange={(e) => handleFormChange("country", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Location within Country (State / UT)</label>
                  <CustomSelect value={form.location} onChange={(v) => handleFormChange("location", v)} options={[{ value: "", label: "— Select State / UT —" }, ...INDIAN_STATES.map((s) => ({ value: s, label: s }))]} placeholder="— Select State / UT —" />
                </div>

                <div className="ap-field full-width">
                  <label>Name and Address of Client</label>
                  <textarea rows={2} value={form.clientNameAddress} onChange={(e) => handleFormChange("clientNameAddress", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Contact Person</label>
                  <input type="text" value={form.contactPerson} onChange={(e) => handleFormChange("contactPerson", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Title / Designation</label>
                  <input type="text" value={form.titleDesignation} onChange={(e) => handleFormChange("titleDesignation", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Telephone</label>
                  <input type="text" value={form.telephone} onChange={(e) => handleFormChange("telephone", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={(e) => handleFormChange("email", e.target.value)} />
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
                  <input type="number" value={form.totalStaffMonths} onChange={(e) => handleFormChange("totalStaffMonths", e.target.value)} />
                </div>

                <div className="ap-field">
                  <label>Professional Staff-Months (your firm / sub-consultants)</label>
                  <input type="number" value={form.associatedConsultantMonths} onChange={(e) => handleFormChange("associatedConsultantMonths", e.target.value)} />
                </div>

                <div className="ap-field full-width">
                  <label>Name of Associated Consultants, if any</label>
                  <textarea rows={2} value={form.associatedConsultants} onChange={(e) => handleFormChange("associatedConsultants", e.target.value)} />
                </div>

                <div className="ap-field full-width">
                  <label>Name of Senior Professional Staff & Functions</label>
                  <textarea rows={3} value={form.seniorProfessionalStaff} onChange={(e) => handleFormChange("seniorProfessionalStaff", e.target.value)} />
                </div>

                <div className="ap-field full-width">
                  <label>Description of Project</label>
                  <textarea rows={4} value={form.projectBriefDescription} onChange={(e) => handleFormChange("projectBriefDescription", e.target.value)} />
                </div>

                <div className="ap-field full-width">
                  <label>Description of Actual Services Provided by Your Staff</label>
                  <textarea rows={3} value={form.servicesDescription} onChange={(e) => handleFormChange("servicesDescription", e.target.value)} />
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
              <DocumentUpload projectId={id} documents={documents} onAdd={handleAddDoc} onRemove={handleRemoveDoc} />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <button className="ap-btn-save" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button className="ap-btn-cancel" onClick={() => navigate(-1)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
