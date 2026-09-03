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
import { SCRUTINY_PARAMETERS, defaultScrutinyEntries } from "../../lib/leadApprovalNote";
import "../../styles/LeadForm.css";

const YES_NO_OPTIONS = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

const NATURE_OF_LEAD_OPTIONS = [
  { value: "Tender", label: "Tender" },
  { value: "Nomination", label: "Nomination" },
  { value: "Suo Moto", label: "Suo Moto" },
  { value: "Empanelment", label: "Empanelment" },
  { value: "Expression of Interest (EOI)", label: "Expression of Interest (EOI)" },
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
    document_fee: "",
    pbg: "",
    emd: "",
    processing_fee: "",
    revenue_sharing: "",
    scrutiny: defaultScrutinyEntries(),
    justification: "",
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
        document_fee: d.financial_requirement?.document_fee || "",
        pbg: d.financial_requirement?.pbg || "",
        emd: d.financial_requirement?.emd || "",
        processing_fee: d.financial_requirement?.processing_fee || "",
        revenue_sharing: d.revenue_sharing || "",
        scrutiny: SCRUTINY_PARAMETERS.map((p, i) => ({
          yes_no: d.scrutiny?.[i]?.yes_no === "No" ? "No" : "Yes",
          remarks: d.scrutiny?.[i]?.remarks || p.defaultRemark,
        })),
        justification: d.justification || "",
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

  function setScrutinyField(index, field, value) {
    setForm((p) => {
      const scrutiny = p.scrutiny.map((row, i) => (i === index ? { ...row, [field]: value } : row));
      return { ...p, scrutiny };
    });
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
            document_fee: form.document_fee,
            pbg: form.pbg,
            emd: form.emd,
            processing_fee: form.processing_fee,
          },
          revenue_sharing: form.revenue_sharing,
          scrutiny: form.scrutiny,
          justification: form.justification,
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
      // The Person Responsible filling this in goes straight to DGM
      // submission, same as before. The creator filling it in is always a
      // draft awaiting the PR's review first — hand it off instead of
      // navigating to the page only the PR can actually submit from.
      if (profile?.id === lead.person_responsible_id) {
        navigate(`/leads/${id}/approval-note/preview`);
        return;
      }
      const { data: submitData, error: submitError } = await supabase.functions.invoke("advance-lead-stage", {
        body: { lead_id: id, action: "submit_for_pr_review", comment: "" },
      });
      if (submitError) {
        showToast(await extractFunctionErrorMessage(submitError, "Failed to send for Person Responsible review."), "danger");
        return;
      }
      if (!submitData?.success) {
        showToast(submitData?.error || "Failed to send for Person Responsible review.", "danger");
        return;
      }
      showToast("Sent for Person Responsible review.", "success");
      navigate(`/leads/${id}`);
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
                    label="Document Fee / Tender Fee"
                    value={form.document_fee}
                    onChange={(e) => set("document_fee", e.target.value)}
                    placeholder="NA"
                    disabled={submitting}
                  />
                  <Input label="PBG" value={form.pbg} onChange={(e) => set("pbg", e.target.value)} placeholder="NA" disabled={submitting} />
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

            <Card>
              <Card.Header title="Preliminary Scrutiny by Office" />
              <Card.Body>
                {SCRUTINY_PARAMETERS.map((param, i) => (
                  <div key={param.key} className="lan-scrutiny-row">
                    <div className="lan-scrutiny-label">{param.label}</div>
                    <div className="lan-scrutiny-yesno">
                      <label className="field-label">Yes/No</label>
                      <Select
                        options={YES_NO_OPTIONS}
                        value={form.scrutiny[i].yes_no}
                        onChange={(v) => setScrutinyField(i, "yes_no", v)}
                        disabled={submitting}
                      />
                    </div>
                    <div className="lan-scrutiny-remarks">
                      <label className="field-label">Justification / Remarks</label>
                      <textarea
                        className="input"
                        rows={2}
                        value={form.scrutiny[i].remarks}
                        onChange={(e) => setScrutinyField(i, "remarks", e.target.value)}
                        disabled={submitting}
                      />
                    </div>
                  </div>
                ))}

                <div className="field">
                  <label className="field-label">Justification</label>
                  <textarea
                    className="input"
                    rows={4}
                    value={form.justification}
                    onChange={(e) => set("justification", e.target.value)}
                    disabled={submitting}
                    placeholder="Overall justification for taking up this lead — appears on the PDF just under the Preliminary Scrutiny table."
                  />
                </div>
              </Card.Body>
            </Card>

            <div className="lf-actions">
              <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
                {profile?.id === lead.person_responsible_id ? "Generate PDF" : "Send for Person Responsible Review"}
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
