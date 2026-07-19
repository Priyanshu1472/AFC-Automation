import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { ROLE_LABELS } from "../../lib/roles";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Badge from "../../components/ui/Badge";
import Select from "../../components/ui/Select";
import PageLoader from "../../components/ui/PageLoader";
import "../../styles/SendEmpanelmentPage.css";

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}
function capitalise(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

function SendIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>;
}
function ArrowRightIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>;
}
function ArrowLeftIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 5-7 7 7 7" /></svg>;
}
function CheckCircleIcon() {
  return <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="9 12 11 14 15 10" /></svg>;
}

function StepBar({ current }) {
  const steps = ["Fill Details", "Preview Email", "Sent"];
  return (
    <div className="sef-steps" role="list" aria-label="Form progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="sef-step-item" role="listitem">
            <div className={`sef-step-dot${done ? " sef-step-done" : active ? " sef-step-active" : ""}`} aria-current={active ? "step" : undefined}>
              {done ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <span aria-hidden="true">{i + 1}</span>
              )}
            </div>
            <span className={`sef-step-label${active ? " sef-step-label-active" : done ? " sef-step-label-done" : ""}`}>{label}</span>
            {i < steps.length - 1 && <div className={`sef-step-line${done ? " sef-step-line-done" : ""}`} aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}

function SenderInfoRow({ profile, dgmUser }) {
  const items = [
    { label: "Sent by", value: profile?.full_name },
    { label: "Advised by", value: dgmUser?.full_name || profile?.full_name },
    { label: "Team", value: profile?.team, highlight: true },
    { label: "Office", value: capitalise(profile?.office) },
  ];
  return (
    <div className="sef-sender-row">
      {items.map((item) => (
        <div key={item.label} className="sef-sender-item">
          <span className="sef-sender-label">{item.label}</span>
          <span className={`sef-sender-value${item.highlight ? " sef-sender-highlight" : ""}`}>{item.value || "—"}</span>
        </div>
      ))}
    </div>
  );
}

function EmailPreview({ to, advisedByName, advisedByDesig, acName }) {
  return (
    <div className="sef-email-chrome" role="img" aria-label="Preview of the email the BA will receive">
      <div className="sef-email-chrome-bar" aria-hidden="true">
        <div className="sef-email-chrome-dots"><span /><span /><span /></div>
        <span className="sef-email-chrome-title">Email Preview</span>
      </div>
      <div className="sef-email-head">
        <div className="sef-email-avatar" aria-hidden="true">{(to[0] || "B").toUpperCase()}</div>
        <div className="sef-email-head-info">
          <div className="sef-email-subject">Business Associate Empanelment Form — AFC India Limited</div>
          <div className="sef-email-meta-row">
            <span className="sef-email-from">noreply@pmis.afcindia.org.in</span>
            <span className="sef-email-arrow" aria-hidden="true">→</span>
            <span className="sef-email-to">{to}</span>
          </div>
        </div>
      </div>
      <div className="sef-email-body">
        <p className="sef-email-salutation">Dear Sir / Ma'am,</p>
        <p className="sef-email-para">Greetings from AFC India Limited!</p>
        <p className="sef-email-para">
          As advised by <strong>{advisedByName}</strong> ({advisedByDesig}), please find enclosed the link for the Business Associate (BA)
          empanelment form for your kind perusal.
        </p>
        <p className="sef-email-para">Kindly fill in the form at your earliest convenience to initiate the empanelment process with AFC India Limited.</p>
        <div className="sef-email-code-block">
          <span className="sef-email-code-label">Your Application Code</span>
          <span className="sef-email-code-value">XXXXX</span>
          <span className="sef-email-code-note">This code is sent securely in the actual email. Keep it safe — you will need it to submit the form.</span>
        </div>
        <div className="sef-email-cta-wrap">
          <div className="sef-email-cta" aria-hidden="true">Open Empanelment Form →</div>
        </div>
        <p className="sef-email-regards">
          Kind Regards,<br />
          <strong>{acName || "AFC India Limited"}</strong><br />
          AFC India Limited<br />
          <span className="sef-email-contact">afc@afcindia.org.in</span>
        </p>
      </div>
    </div>
  );
}

function SuccessScreen({ email, onSendAnother, onGoHome }) {
  return (
    <div className="sef-success" role="alert">
      <div className="sef-success-icon" aria-hidden="true"><CheckCircleIcon /></div>
      <h2 className="sef-success-title">Email Sent Successfully</h2>
      <p className="sef-success-sub">The empanelment form has been sent to <strong>{email}</strong>.</p>
      <div className="sef-success-actions">
        <Button variant="primary" onClick={onSendAnother} iconRight={<ArrowRightIcon />}>Send Another</Button>
        <Button variant="secondary" onClick={onGoHome}>Back to Home</Button>
      </div>
    </div>
  );
}

export default function SendEmpanelmentPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [form, setForm] = useState({ projectOfficer: "", baEmail: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [projectOfficers, setProjectOfficers] = useState([]);
  const [dgmUser, setDgmUser] = useState(null);
  const [loadingPOs, setLoadingPOs] = useState(true);
  const [step, setStep] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sentToEmail, setSentToEmail] = useState("");

  const fetchPOs = useCallback(async () => {
    if (!profile?.team) {
      setLoadingPOs(false);
      return;
    }
    const [{ data: pos }, { data: dgm }] = await Promise.all([
      supabase.from("afc_users").select("id, full_name, email").eq("role", "project_officer").eq("team", profile.team).eq("is_active", true).order("full_name"),
      supabase.from("afc_users").select("id, full_name, email").eq("role", "dgm").eq("team", profile.team).eq("is_active", true).limit(1).maybeSingle(),
    ]);
    setProjectOfficers(pos || []);
    setDgmUser(dgm || null);
    setLoadingPOs(false);
  }, [profile?.team]);

  useEffect(() => {
    fetchPOs();
  }, [fetchPOs]);

  const selectedPO = projectOfficers.find((p) => p.id === form.projectOfficer);
  const advisedByName = dgmUser?.full_name || profile?.full_name || "";
  const advisedByDesig = dgmUser ? ROLE_LABELS.dgm : ROLE_LABELS[profile?.role] || profile?.role || "";
  const poOptions = projectOfficers.map((po) => ({ value: po.id, label: `${po.full_name} (${po.email})` }));

  function handleGoToPreview() {
    const errors = {};
    if (!form.projectOfficer) errors.projectOfficer = "Please select a Project Officer.";
    if (!form.baEmail.trim()) errors.baEmail = "BA email is required.";
    else if (!isValidEmail(form.baEmail)) errors.baEmail = "Enter a valid email address.";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setStep(1);
  }

  async function handleSend() {
    setSendError("");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-empanelment-invite", {
        body: { ba_email: form.baEmail.trim().toLowerCase(), project_officer_id: form.projectOfficer },
      });
      if (error) {
        setSendError(await extractFunctionErrorMessage(error, "Failed to send invitation."));
        return;
      }
      if (!data?.success) {
        setSendError(data?.error || "Failed to send invitation.");
        return;
      }
      setSentToEmail(form.baEmail.trim().toLowerCase());
      setStep(2);
    } catch (err) {
      setSendError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function handleSendAnother() {
    setForm({ projectOfficer: "", baEmail: "" });
    setFieldErrors({});
    setSendError("");
    setSentToEmail("");
    setStep(0);
  }

  if (!loadingPOs && !profile?.team) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="app-container">
          <Alert variant="warning">You are not assigned to a team. Please contact your DGM before sending empanelment forms.</Alert>
        </div>
      </div>
    );
  }

  if (loadingPOs) return <PageLoader text="Loading team data…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="sef-page">
          {step < 2 && <StepBar current={step} />}

          {step === 0 && (
            <div className="sef-layout">
              <Card className="sef-main-card">
                <Card.Header title="Send Empanelment Form" subtitle="Select a Project Officer and enter the BA's email address." action={<Badge variant="brand">Step 1 of 2</Badge>} />
                <Card.Body className="sef-card-body">
                  <SenderInfoRow profile={profile} dgmUser={dgmUser} />
                  <div className="sef-divider" />

                  <div className="sef-field">
                    <label className="sef-label" htmlFor="sef-po-select">Project Officer <span className="sef-required">*</span></label>
                    {projectOfficers.length === 0 ? (
                      <Alert variant="warning">No active Project Officers found in team <strong>{profile?.team}</strong>.</Alert>
                    ) : (
                      <Select id="sef-po-select" options={poOptions} value={form.projectOfficer} onChange={(val) => { setForm((p) => ({ ...p, projectOfficer: val })); setFieldErrors((e) => ({ ...e, projectOfficer: "" })); }} placeholder="Select a Project Officer" />
                    )}
                    {fieldErrors.projectOfficer && <span className="sef-field-error" role="alert">{fieldErrors.projectOfficer}</span>}
                  </div>

                  <div className="sef-field">
                    <label className="sef-label" htmlFor="sef-ba-email">Business Associate Email <span className="sef-required">*</span></label>
                    <input
                      id="sef-ba-email"
                      className={`input${fieldErrors.baEmail ? " input-error" : ""}`}
                      type="email"
                      value={form.baEmail}
                      onChange={(e) => { setForm((p) => ({ ...p, baEmail: e.target.value })); setFieldErrors((er) => ({ ...er, baEmail: "" })); }}
                      onBlur={(e) => { const val = e.target.value.trim(); if (val && !isValidEmail(val)) setFieldErrors((er) => ({ ...er, baEmail: "Enter a valid email address." })); }}
                      placeholder="e.g. contact@company.com"
                      autoComplete="off"
                    />
                    {fieldErrors.baEmail && <span className="sef-field-error" role="alert">{fieldErrors.baEmail}</span>}
                  </div>

                  <div className="sef-btn-row">
                    <Button variant="primary" onClick={handleGoToPreview} iconRight={<ArrowRightIcon />}>Preview Email</Button>
                    <Button variant="secondary" onClick={() => navigate("/home")}>Cancel</Button>
                  </div>
                </Card.Body>
              </Card>
            </div>
          )}

          {step === 1 && (
            <div className="sef-layout sef-layout-wide">
              <Card className="sef-summary-card">
                <Card.Header title="Send Summary" action={<Badge variant="info">Step 2 of 2</Badge>} />
                <Card.Body className="sef-summary-body">
                  <div className="sef-summary-group">
                    <div className="sef-summary-item"><span className="sef-summary-label">Sending to</span><span className="sef-summary-value sef-summary-email">{form.baEmail}</span></div>
                    <div className="sef-summary-item"><span className="sef-summary-label">Project Officer</span><span className="sef-summary-value">{selectedPO?.full_name || "—"}</span></div>
                    <div className="sef-summary-item"><span className="sef-summary-label">Advised by</span><span className="sef-summary-value">{advisedByName} <span className="sef-summary-role">({advisedByDesig})</span></span></div>
                    <div className="sef-summary-item"><span className="sef-summary-label">Sent by</span><span className="sef-summary-value">{profile?.full_name}</span></div>
                    <div className="sef-summary-item sef-summary-last"><span className="sef-summary-label">Team / Office</span><span className="sef-summary-value">{profile?.team} · {capitalise(profile?.office)}</span></div>
                  </div>
                  <div className="sef-summary-notice">The application code is generated and sent securely in the actual email — it is not shown in this preview.</div>
                  {sendError && <Alert variant="danger" onClose={() => setSendError("")}>{sendError}</Alert>}
                  <div className="sef-btn-col">
                    <Button variant="primary" block loading={sending} onClick={handleSend} icon={<SendIcon />}>{sending ? "Sending email…" : "Confirm and Send"}</Button>
                    <Button variant="secondary" block disabled={sending} onClick={() => { setStep(0); setSendError(""); }} icon={<ArrowLeftIcon />}>Edit Details</Button>
                  </div>
                </Card.Body>
              </Card>
              <div className="sef-email-wrap">
                <p className="sef-email-wrap-label">Email preview — what the BA will receive</p>
                <EmailPreview to={form.baEmail} advisedByName={advisedByName} advisedByDesig={advisedByDesig} acName={profile?.full_name} />
              </div>
            </div>
          )}

          {step === 2 && (
            <Card className="sef-success-card">
              <Card.Body>
                <SuccessScreen email={sentToEmail} onSendAnother={handleSendAnother} onGoHome={() => navigate("/home")} />
              </Card.Body>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
