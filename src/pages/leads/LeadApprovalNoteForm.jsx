import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import "../../styles/LeadForm.css";

const NATURE_OF_LEAD_OPTIONS = [
  { value: "New Assignment", label: "New Assignment" },
  { value: "Nomination", label: "Nomination" },
  { value: "Repeat Assignment", label: "Repeat Assignment" },
  { value: "Other", label: "Other" },
];

function fmtDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function emptyForm() {
  return {
    nature_of_lead: "",
    client_address: "",
    objectives: "",
    scope_of_work: "",
    project_timeline: "",
    document_fee_emd_pbg: "",
    emd: "",
    processing_fee: "",
    revenue_sharing: "",
  };
}

export default function LeadApprovalNoteForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [lead, setLead] = useState(null);
  const [baOrgName, setBaOrgName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const fetchLead = useCallback(async () => {
    const { data } = await supabase
      .from("leads")
      .select("*, assignee:person_responsible_id(full_name)")
      .eq("id", id)
      .maybeSingle();
    setLead(data);
    if (data?.approval_note_data) {
      const d = data.approval_note_data;
      setForm({
        nature_of_lead: d.nature_of_lead || "",
        client_address: d.client_address || "",
        objectives: d.objectives || "",
        scope_of_work: (d.scope_of_work || []).join("\n"),
        project_timeline: d.project_timeline || "",
        document_fee_emd_pbg: d.financial_requirement?.document_fee_emd_pbg || "",
        emd: d.financial_requirement?.emd || "",
        processing_fee: d.financial_requirement?.processing_fee || "",
        revenue_sharing: d.revenue_sharing || "",
      });
    }
    if (data?.assigned_ba_id && data?.team) {
      const { data: baList } = await supabase.rpc("get_team_business_associates", { p_team: data.team });
      setBaOrgName((baList || []).find((b) => b.id === data.assigned_ba_id)?.org_name || null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    fetchLead();
  }, [fetchLead]);

  function set(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  async function handleGenerate(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-lead-approval-note", {
        body: {
          lead_id: id,
          nature_of_lead: form.nature_of_lead,
          client_address: form.client_address,
          objectives: form.objectives,
          scope_of_work: form.scope_of_work.split("\n").map((s) => s.trim()).filter(Boolean),
          project_timeline: form.project_timeline,
          financial_requirement: {
            document_fee_emd_pbg: form.document_fee_emd_pbg,
            emd: form.emd,
            processing_fee: form.processing_fee,
          },
          revenue_sharing: form.revenue_sharing,
        },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to generate the Approval Note."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to generate the Approval Note.", "danger");
        return;
      }
      navigate(`/leads/${id}/approval-note/preview`);
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <PageLoader text="Loading lead..." />;

  const canManage =
    lead &&
    (lead.status === "pa_review" || lead.status === "pa_action_required") &&
    (profile?.id === lead.created_by || profile?.id === lead.person_responsible_id);

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>Lead Approval Note</h1>
              {lead && <p>{lead.lead_number} — {lead.title}</p>}
            </div>
            <Button variant="secondary" onClick={() => navigate(lead ? `/leads/${lead.id}` : "/leads")}>
              ← Back
            </Button>
          </div>
        </div>

        {!lead && <Alert variant="danger">Lead not found.</Alert>}
        {lead && !canManage && <Alert variant="danger">The Lead Approval Note can&apos;t be edited right now.</Alert>}

        {lead && canManage && (
          <form onSubmit={handleGenerate} noValidate>
            <Card>
              <Card.Header title="Business Lead Approval Note" />
              <Card.Body>
                <div className="field">
                  <label className="field-label">Nature of Lead</label>
                  <Select
                    options={NATURE_OF_LEAD_OPTIONS}
                    value={form.nature_of_lead}
                    onChange={(v) => set("nature_of_lead", v)}
                    placeholder="Select nature of lead"
                    disabled={submitting}
                  />
                </div>

                <Input label="Title of Proposed Assignment" value={lead.title} disabled hint="From the lead — edit the lead itself to change this." />
                <Input label="Client / Department" value={lead.client_name || "—"} disabled hint="From the lead — edit the lead itself to change this." />

                <div className="field">
                  <label className="field-label">Client Address</label>
                  <textarea
                    className="input"
                    rows={2}
                    value={form.client_address}
                    onChange={(e) => set("client_address", e.target.value)}
                    disabled={submitting}
                    placeholder="Registered / correspondence address of the client"
                  />
                </div>

                <div className="field">
                  <label className="field-label">Objectives</label>
                  <textarea
                    className="input"
                    rows={4}
                    value={form.objectives}
                    onChange={(e) => set("objectives", e.target.value)}
                    disabled={submitting}
                    placeholder="Nature and objective of the proposed assignment"
                  />
                </div>

                <div className="field">
                  <label className="field-label">Scope of Work</label>
                  <textarea
                    className="input"
                    rows={5}
                    value={form.scope_of_work}
                    onChange={(e) => set("scope_of_work", e.target.value)}
                    disabled={submitting}
                    placeholder={"One item per line — each becomes a bullet point, e.g.\nIdentification and mobilisation of eligible beneficiaries\nAssessment of skill and livelihood needs"}
                  />
                </div>

                <Input
                  label="Project Timeline"
                  value={form.project_timeline}
                  onChange={(e) => set("project_timeline", e.target.value)}
                  placeholder="e.g. 15 Months"
                  disabled={submitting}
                />

                <Input
                  label="Proposed Implementation Arrangement"
                  value={lead.assigned_ba_id ? "Business Associate" : "In-house"}
                  disabled
                  hint="Determined by whether a Business Associate is assigned to this lead."
                />
                {lead.assigned_ba_id && (
                  <Input label="Name of BA" value={baOrgName || "—"} disabled />
                )}

                <div className="field">
                  <label className="field-label">Financial Requirement</label>
                  <Input
                    label="Document fee / EMD / PBG & modalities"
                    value={form.document_fee_emd_pbg}
                    onChange={(e) => set("document_fee_emd_pbg", e.target.value)}
                    placeholder="NA"
                    disabled={submitting}
                  />
                  <Input label="EMD" value={form.emd} onChange={(e) => set("emd", e.target.value)} placeholder="NA" disabled={submitting} />
                  <Input
                    label="Processing Fee"
                    value={form.processing_fee}
                    onChange={(e) => set("processing_fee", e.target.value)}
                    placeholder="NA"
                    disabled={submitting}
                  />
                </div>

                <Input label="Last Date for Submission of Proposal" value={fmtDate(lead.submission_deadline)} disabled />

                <Input
                  label="Revenue Sharing"
                  value={form.revenue_sharing}
                  onChange={(e) => set("revenue_sharing", e.target.value)}
                  placeholder="NA"
                  disabled={submitting}
                />
              </Card.Body>
            </Card>

            <div className="lf-actions">
              <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
                Generate PDF
              </Button>
              <Button type="button" variant="secondary" disabled={submitting} onClick={() => navigate(`/leads/${id}`)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
