import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import PinInput from "../../components/ui/PinInput";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import "../../styles/ApplicationReviewPage.css";

// Not a real business_associates row — picking this just flags that the BA
// is still undecided. It never reaches the backend: submitForDgmApproval
// treats it the same as nothing being selected, since assigned_ba_id is a
// real FK and advance-lead-stage requires an actual, validated BA before a
// lead can move on to DGM/PMT review.
const TBD_BA_VALUE = "__tbd__";

export default function LeadApprovalNotePreviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pin, setPin] = useState("");
  const [baOptions, setBaOptions] = useState([]);
  const [selectedBaId, setSelectedBaId] = useState("");

  const fetchLead = useCallback(async () => {
    const { data } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
    setLead(data);
    setLoading(false);
    const isResubmittable = data?.status === "pa_action_required";
    if ((data?.status === "pa_review" || isResubmittable) && !data.assigned_ba_id && data.team) {
      supabase.rpc("get_team_business_associates", { p_team: data.team }).then(({ data: list }) => setBaOptions(list || []));
    }
    return data;
  }, [id]);

  const loadPdfUrl = useCallback(async (leadRow) => {
    const doc = (leadRow?.documents || []).find((d) => d.category === "approval_note");
    if (!doc) {
      setPdfUrl(null);
      return;
    }
    setPdfLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-lead-document-url", { body: { lead_id: leadRow.id, path: doc.path } });
      if (!error && data?.url) setPdfUrl(data.url);
    } finally {
      setPdfLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLead().then((data) => data && loadPdfUrl(data));
  }, [fetchLead, loadPdfUrl]);

  // A resubmission after a decline at any stage (DGM, PMT, PMT Extended,
  // G3, or MD) goes through the exact same "accept" action/PIN gate as the
  // very first submission — see advance-lead-stage's "accept" case.
  const isResubmit = lead?.status === "pa_action_required";
  const needsBaSelection = (lead?.status === "pa_review" || isResubmit) && !lead?.assigned_ba_id;

  async function submitForDgmApproval() {
    if (!/^\d{4}$/.test(pin)) {
      showToast("Enter your 4-digit PIN.", "danger");
      return;
    }
    if (needsBaSelection && (!selectedBaId || selectedBaId === TBD_BA_VALUE)) {
      showToast("Select a BA", "danger");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("advance-lead-stage", {
        body: {
          lead_id: id,
          action: "accept",
          comment: "",
          pin,
          ...(needsBaSelection ? { assigned_ba_id: selectedBaId } : {}),
        },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to submit for DGM approval."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to submit for DGM approval.", "danger");
        return;
      }
      showToast("Submitted for DGM approval.", "success");
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
  const canSubmit = (lead?.status === "pa_review" || isResubmit) && profile?.id === lead.person_responsible_id;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="ar-page">
          <button className="ar-back-btn" onClick={() => navigate(`/leads/${id}`)}>← Back to Lead</button>

          {!lead && <Alert variant="danger">Lead not found.</Alert>}
          {lead && !canManage && <Alert variant="danger">The Lead Approval Note can&apos;t be reviewed here right now.</Alert>}

          {lead && canManage && (
            <div className="ar-grid">
              <div className="ar-left">
                <Card>
                  <Card.Header title="Lead Approval Note" />
                  <Card.Body>
                    {pdfLoading && <p className="ar-empty-text">Loading PDF…</p>}
                    {!pdfLoading && !pdfUrl && <Alert variant="danger">The Approval Note PDF couldn&apos;t be loaded — try generating it again.</Alert>}
                    {!pdfLoading && pdfUrl && (
                      <a href={pdfUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                        <iframe
                          src={pdfUrl}
                          title="Lead Approval Note"
                          style={{ width: "100%", height: "70vh", border: "1px solid var(--border-primary)", borderRadius: "var(--radius-md)", pointerEvents: "none" }}
                        />
                      </a>
                    )}
                    {!pdfLoading && pdfUrl && (
                      <p className="field-hint" style={{ marginTop: "var(--space-2)" }}>
                        Click the preview or <a href={pdfUrl} target="_blank" rel="noopener noreferrer">open it in a new tab</a>.
                      </p>
                    )}
                  </Card.Body>
                </Card>
              </div>

              <div className="ar-right">
                <Card className="ar-action-card">
                  <Card.Header title="Next Step" />
                  <Card.Body className="ar-action-body">
                    <Button variant="secondary" block onClick={() => navigate(`/leads/${id}/approval-note`)}>
                      Edit Lead Approval Note
                    </Button>

                    {canSubmit && (
                      <>
                        {needsBaSelection && (
                          <div className="ar-field">
                            <label className="ar-label">
                              Business Associate <span className="ar-required">*</span>
                            </label>
                            <Select
                              options={[
                                ...(lead.source === "in_house" ? [{ value: TBD_BA_VALUE, label: "To be Decided" }] : []),
                                ...baOptions.map((u) => ({ value: u.id, label: u.org_name })),
                              ]}
                              value={selectedBaId}
                              onChange={setSelectedBaId}
                              placeholder={baOptions.length ? "Select a BA" : "No active BAs found on your team."}
                              disabled={submitting}
                            />
                          </div>
                        )}
                        <div className="ar-field">
                          <PinInput
                            label="Your Action PIN"
                            required
                            value={pin}
                            onChange={setPin}
                            disabled={submitting}
                            hint="Confirms it's really you — set or change this from My Profile."
                          />
                        </div>
                        <Button variant="primary" block loading={submitting} disabled={submitting} onClick={submitForDgmApproval}>
                          {isResubmit ? "Resubmit for DGM Approval" : "Submit for DGM Approval"}
                        </Button>
                      </>
                    )}
                    {!canSubmit && (
                      <p className="ar-empty-text">
                        Only the assigned Person Responsible can submit this lead for DGM approval.
                      </p>
                    )}
                  </Card.Body>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
