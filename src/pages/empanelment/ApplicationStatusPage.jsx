import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Badge from "../../components/ui/Badge";
import Card from "../../components/ui/Card";
import { FormNav } from "./formShared";
import { STATUS_FLOW, STATUS_BADGE, ProgressStepper, displayStatus, INELIGIBLE_LABEL } from "../../components/empanelment/ApplicationTimeline";
import "../../styles/BaFormPage.css";

function statusMessage(status, csReviewed) {
  if (status === "on_hold") return { variant: "warning", text: "One or more items need your correction before review can continue." };
  if (status === "accepted") return { variant: "success", text: "Congratulations — your application has been accepted. Check your email for your portal login details." };
  if (status === "rejected") return { variant: "info", text: "After careful evaluation, this application has been found ineligible for empanelment at this time." };
  if (status === "sent") return { variant: "info", text: "We're waiting for you to fill and submit the empanelment form." };
  const stage = STATUS_FLOW.find((s) => s.key === displayStatus(status, csReviewed));
  return { variant: "info", text: stage ? `Currently with ${stage.label} for review.` : "Under review." };
}

function statusBadgeText(status, csReviewed) {
  if (status === "on_hold") return "On Hold";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return INELIGIBLE_LABEL;
  return STATUS_FLOW.find((s) => s.key === displayStatus(status, csReviewed))?.label || status;
}

export default function ApplicationStatusPage() {
  const navigate = useNavigate();
  const [appCode, setAppCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { org_name, status, logs, flags, final_remark }

  async function handleCheck() {
    setCodeError("");
    if (!/^\d{5}$/.test(appCode.trim())) { setCodeError("Code must be exactly 5 digits."); return; }
    setLoading(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/get-empanelment-status`, {
        method: "POST",
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ application_code: appCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setCodeError(data?.error || "Something went wrong."); return; }
      setResult(data);
    } catch (err) {
      setCodeError(err.message || "Network error.");
    } finally {
      setLoading(false);
    }
  }

  const banner = result ? statusMessage(result.status, result.cs_reviewed) : null;

  return (
    <div className="bf-page">
      <FormNav subtitle="Application Status" onBack={() => navigate("/login")} />
      <main className="bf-content">
        <div className="bf-hero">
          <h1 className="bf-hero-title">Check Application Status</h1>
          <p className="bf-hero-sub">Enter your 5-digit application code to see where your application stands.</p>
        </div>

        <Card>
          <Card.Body className="bf-section-body bf-single-col">
            <div className="bf-field">
              <label className="bf-label">Application Code<span className="bf-required"> *</span></label>
              <input className={`input bf-code-input${codeError ? " input-error" : ""}`} type="text" inputMode="numeric" maxLength={5} value={appCode} placeholder="·····" onChange={(e) => { setAppCode(e.target.value.replace(/\D/g, "")); setCodeError(""); }} onKeyDown={(e) => e.key === "Enter" && !loading && handleCheck()} />
              {codeError && <span className="bf-field-error" role="alert">{codeError}</span>}
            </div>
            <Button variant="primary" loading={loading} disabled={appCode.length !== 5} onClick={handleCheck}>{loading ? "Checking…" : "Check Status"}</Button>
          </Card.Body>
        </Card>

        {result && (
          <>
            <Card>
              <Card.Body className="bf-section-body bf-single-col">
                <p className="ec-summary-title">{result.org_name || "Your Application"}</p>
                <Badge variant={result.status === "rejected" ? "neutral" : STATUS_BADGE[result.status] || "neutral"} dot>{statusBadgeText(result.status, result.cs_reviewed)}</Badge>
              </Card.Body>
            </Card>

            {banner && (
              <Alert variant={banner.variant}>
                {banner.text}
                {result.status === "on_hold" && <> <Link to="/empanelment/correction">Submit your correction here.</Link></>}
                {result.status === "rejected" && result.final_remark && <p style={{ marginTop: 6 }}>{result.final_remark}</p>}
              </Alert>
            )}

            {result.status === "on_hold" && result.flags?.length > 0 && (
              <Card>
                <Card.Header title="Items Flagged for Correction" />
                <Card.Body className="bf-section-body bf-single-col">
                  {result.flags.map((f, i) => (
                    <div key={i} className="bf-field">
                      <span className="bf-label">{f.field_label}</span>
                      <span className="ec-readonly-value">{f.comment}</span>
                    </div>
                  ))}
                </Card.Body>
              </Card>
            )}

            <Card>
              <Card.Body className="bf-section-body bf-single-col">
                <p className="ar-stepper-heading">Application Progress</p>
                <ProgressStepper currentStatus={result.status} csReviewed={result.cs_reviewed} publicView />
              </Card.Body>
            </Card>

          </>
        )}
      </main>
    </div>
  );
}
