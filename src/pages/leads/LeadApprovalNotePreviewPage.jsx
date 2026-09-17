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

// Not a real business_associates row — picking this just flags that the BP
// is still undecided. It never reaches the backend: submitForDgmApproval
// treats it the same as nothing being selected, since assigned_ba_id is a
// real FK and advance-lead-stage requires an actual, validated BP before a
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

  // A resubmission after a decline at any stage (Recommending Authority,
  // PMT, or MD) goes through the exact same "accept" action/PIN gate as
  // the very first submission — see advance-lead-stage's "accept" case.
  const isResubmit = lead?.status === "pa_action_required";
  // The Business Partner is optional here, same as at creation — leaving
  // it as "Yet to be Decided" is a real, submittable choice (the note
  // prints that text in the BA field); it's only locked from editing once
  // the lead actually leaves pa_review/pa_action_required (see
  // leadEligibility's BA lock and advance-lead-stage's "withdraw_
  // submission" for changing it after that point).
  const needsBaSelection = (lead?.status === "pa_review" || isResubmit) && !lead?.assigned_ba_id;

  async function submitForDgmApproval() {
    if (!/^\d{4}$/.test(pin)) {
      showToast("Enter your 4-digit PIN.", "danger");
      return;
    }
    const hasRealBaSelection = needsBaSelection && selectedBaId && selectedBaId !== TBD_BA_VALUE;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("advance-lead-stage", {
        body: {
          lead_id: id,
          action: "accept",
          comment: "",
          pin,
          ...(hasRealBaSelection ? { assigned_ba_id: selectedBaId } : {}),
        },
      });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to submit for approval."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to submit for approval.", "danger");
        return;
      }
      showToast("Submitted for approval.", "success");
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
                            <label className="ar-label">Business Partner (optional)</label>
                            <Select
                              options={[
                                ...(lead.source === "in_house" ? [{ value: TBD_BA_VALUE, label: "Yet to be Decided" }] : []),
                                ...baOptions.map((u) => ({ value: u.id, label: u.org_name })),
                              ]}
                              value={selectedBaId}
                              onChange={setSelectedBaId}
                              placeholder={baOptions.length ? "Select a Business Partner" : "No active BPs found on your team."}
                              disabled={submitting}
                            />
                            <span className="field-hint">Leave unselected (or pick "Yet to be Decided") to submit without one — the note will print "Yet to be Decided" until you edit the lead again to set it.</span>
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
                          {isResubmit ? "Resubmit for Approval" : "Submit for Approval"}
                        </Button>
                      </>
                    )}
                    {!canSubmit && (
                      <p className="ar-empty-text">
                        Only the assigned Person Responsible can submit this lead for approval.
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
