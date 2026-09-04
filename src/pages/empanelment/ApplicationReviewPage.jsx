import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { ROLE_LABELS } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import ComplianceHoldModal from "./ComplianceHoldModal";
import OtpVerifyModal from "./OtpVerifyModal";
import { STATUS_FLOW, STATUS_BADGE, ProgressStepper, TimelineAccordion } from "../../components/empanelment/ApplicationTimeline";
import "../../styles/ApplicationReviewPage.css";

const SLOT_LABELS = {
  panCopy: "PAN Card Copy",
  incorporationCert: "Certificate of Incorporation / MOA / AOA",
  gstCert: "GST Registration Certificate",
  nonBlacklisting: "Notarized Declaration of Non-Blacklisting",
  mcaCompliance: "MCA Legal Compliance Printout",
  financials: "Audited Financial Statements",
  netWorthCert: "CA Certified Net Worth Statement",
  isoCert: "ISO / Other Quality Certifications",
  cancelledCheque: "Cancelled Cheque / Bank Passbook",
  workOrders: "Work Orders / Completion Certificates",
};

function fmt(val) { return val === null || val === undefined || val === "" ? "—" : val; }
function fmtDate(val) { if (!val) return "—"; return new Date(val).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
function fmtMoney(val) { if (!val) return "—"; return "INR " + Number(val).toLocaleString("en-IN"); }
function fmtJsonb(val) {
  if (!val) return "—";
  try { const obj = typeof val === "string" ? JSON.parse(val) : val; return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(" | "); }
  catch { return String(val); }
}

function CheckIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>; }
function ArrowRightIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>; }
function ArrowLeftIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 5-7 7 7 7" /></svg>; }
function XIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function DocumentIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>; }
function EyeIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>; }

function Row({ label, value }) {
  if (!value || value === "—") return null;
  return <div className="ar-row"><span className="ar-row-label">{label}</span><span className="ar-row-value">{value}</span></div>;
}

function CommentCard({ label, text, colorClass }) {
  if (!text) return null;
  return <div className={`ar-comment ar-comment-${colorClass}`}><span className="ar-comment-label">{label}</span><p className="ar-comment-text">{text}</p></div>;
}

// MD-only now (DGM can no longer reject — see the removed dgm_reject
// button/handler below). No preview step: the OTP modal that follows this
// one is the actual safety gate, so this is just remarks capture.
function RejectModal({ onConfirm, onClose }) {
  const [remark, setRemark] = useState("");
  return (
    <div className="ar-modal-backdrop" onClick={() => onClose()}>
      <div className="ar-modal ar-modal-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="ar-modal-header"><h3 className="ar-modal-title">Reject Application</h3><p className="ar-modal-desc">Write the rejection remarks — you'll be asked to verify with a one-time code emailed to you before this is sent.</p></div>
        <div className="ar-field"><label className="ar-label">Rejection Remarks <span className="ar-required">*</span></label><textarea className="input" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Write the reason for rejection clearly..." rows={4} /></div>
        <div className="ar-modal-actions">
          <Button variant="danger" block disabled={!remark.trim()} onClick={() => onConfirm(remark.trim())} icon={<XIcon />}>Reject Application</Button>
          <Button variant="secondary" block onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

const DETAIL_TABS = [
  { key: "details", label: "Organisation", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
  { key: "financial", label: "Financial", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg> },
  { key: "business", label: "Business", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" /></svg> },
  { key: "bank", label: "Bank", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="10" width="18" height="11" rx="1" /><path d="M3 10l9-7 9 7" /><line x1="3" y1="15" x2="21" y2="15" /></svg> },
  { key: "documents", label: "Documents", highlight: true, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg> },
];

function DocItem({ doc, applicationId }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const displayLabel = SLOT_LABELS[doc.slot] || doc.slot || "Document";
  const fileName = doc.name || "file.pdf";
  const fileSize = doc.size ? (doc.size >= 1024 * 1024 ? `${(doc.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(doc.size / 1024)} KB`) : null;

  async function handleOpen() {
    setErr(false); setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-empanelment-document-url", { body: { application_id: applicationId, path: doc.path } });
      if (error || !data?.url) { setErr(true); return; }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch { setErr(true); }
    finally { setLoading(false); }
  }

  return (
    <div className={`ar-doc-item${err ? " ar-doc-item--error" : ""}`} onClick={!loading ? handleOpen : undefined} style={{ cursor: loading ? "wait" : "pointer" }} title={fileName}>
      <span className="ar-doc-icon"><DocumentIcon /></span>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span className="ar-doc-label" style={{ fontWeight: 500, fontSize: 13 }}>{displayLabel}</span>
        <span style={{ fontSize: 11, opacity: 0.55, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fileName}{fileSize ? ` · ${fileSize}` : ""}</span>
        {err && <span style={{ fontSize: 11, color: "var(--danger)" }}>Could not open — try again</span>}
      </div>
      <span className="ar-doc-open">{loading ? "Opening…" : "Open"}</span>
    </div>
  );
}

export default function ApplicationReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Opened from Home's "Needs your action" panel (see HomePage.jsx) — exit
  // there instead of the Applications list, since that's where the user
  // actually came from.
  const backTo = location.state?.from === "home" ? "/home" : "/empanelment";
  const { profile } = useAuth();
  const role = profile?.role;

  const [app, setApp] = useState(null);
  const [baData, setBaData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [banner, setBanner] = useState(null); // { msg, type }
  const [auditLogs, setAuditLogs] = useState([]);
  const [showReject, setShowReject] = useState(false);
  const [activeTab, setActiveTab] = useState("details");
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [openFlags, setOpenFlags] = useState([]);
  // MD accept/reject and the DGM's provisional letter all go through an
  // OTP-verify step before the real action (and its email) fires.
  const [showAcceptOtp, setShowAcceptOtp] = useState(false);
  const [rejectRemark, setRejectRemark] = useState("");
  const [showRejectOtp, setShowRejectOtp] = useState(false);
  const [showProvisionalOtp, setShowProvisionalOtp] = useState(false);

  const fetchApp = useCallback(async () => {
    const { data: application } = await supabase
      .from("empanelment_applications")
      .select("*, po:project_officer_id(id, full_name, email), dgm:dgm_id(id, full_name, email), ac:sent_by(id, full_name, email)")
      .eq("id", id)
      .maybeSingle();
    setApp(application);
    if (application?.id) {
      const { data: ba } = await supabase.from("ba_registrations").select("*").eq("application_id", application.id).maybeSingle();
      setBaData(ba);
    }
    const { data: logs } = await supabase
      .from("empanelment_activity_log")
      .select("*, actor:actor_id(full_name)")
      .eq("application_id", id)
      .order("created_at", { ascending: false });
    setAuditLogs(logs || []);
    const { data: flags } = await supabase
      .from("compliance_flags")
      .select("*")
      .eq("application_id", id)
      .eq("status", "open")
      .order("created_at", { ascending: true });
    setOpenFlags(flags || []);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchApp(); }, [fetchApp]);

  // Realtime — any change to this application or its activity log refetches,
  // so a reviewer watching the page sees other actors' decisions live.
  useEffect(() => {
    const channel = supabase
      .channel(`application-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "empanelment_applications", filter: `id=eq.${id}` }, () => fetchApp())
      .on("postgres_changes", { event: "*", schema: "public", table: "empanelment_activity_log", filter: `application_id=eq.${id}` }, () => fetchApp())
      .on("postgres_changes", { event: "*", schema: "public", table: "compliance_flags", filter: `application_id=eq.${id}` }, () => fetchApp())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, fetchApp]);

  function showBanner(msg, type = "success") { setBanner({ msg, type }); }

  async function runAction(action, extra = {}) {
    setActionLoading(true);
    setBanner(null);
    try {
      const { data, error } = await supabase.functions.invoke("advance-empanelment-stage", {
        body: { application_id: id, action, comment: comment.trim(), ...extra },
      });
      if (error) { showBanner(await extractFunctionErrorMessage(error, "Action failed."), "danger"); return null; }
      if (!data?.success) { showBanner(data?.error || "Action failed.", "danger"); return null; }
      return data;
    } catch (err) {
      showBanner(err.message || "Something went wrong.", "danger");
      return null;
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePOForward() {
    if (!comment.trim()) { showBanner("Comment is required.", "danger"); return; }
    const data = await runAction("po_forward");
    if (data) { showBanner("Forwarded to CFO and CS."); setComment(""); fetchApp(); }
  }
  async function handlePOFinalForward() {
    const data = await runAction("po_final_forward");
    if (data) { showBanner("Forwarded to DGM."); setComment(""); fetchApp(); }
  }
  async function handlePOResendCfoCs() {
    const data = await runAction("po_resend_cfo_cs");
    if (data) { showBanner("Sent back to CFO and CS for a fresh review."); setComment(""); fetchApp(); }
  }
  async function handleCFOForward() {
    if (!comment.trim()) { showBanner("Comment is required.", "danger"); return; }
    const data = await runAction("cfo_review");
    if (data) { showBanner(data.forwarded ? "Both CFO and CS reviewed. Forwarded to Project Officer." : "Your review has been saved. Waiting for CS to review."); setComment(""); fetchApp(); }
  }
  async function handleCSForward() {
    if (!comment.trim()) { showBanner("Comment is required.", "danger"); return; }
    const data = await runAction("cs_review");
    if (data) { showBanner(data.forwarded ? "Both CFO and CS reviewed. Forwarded to Project Officer." : "Your review has been saved. Waiting for CFO to review."); setComment(""); fetchApp(); }
  }
  async function handleDGMRecommend() {
    if (!comment.trim()) { showBanner("Comment is required.", "danger"); return; }
    const data = await runAction("dgm_recommend");
    if (data) { showBanner("Recommended to MD."); setComment(""); fetchApp(); }
  }
  async function handleDGMSendBack() {
    if (!comment.trim()) { showBanner("Comment is required.", "danger"); return; }
    const data = await runAction("dgm_send_back");
    if (data) { showBanner("Sent back to Project Officer."); setComment(""); fetchApp(); }
  }
  async function handleMDSendBack() {
    if (!comment.trim()) { showBanner("Comment is required.", "danger"); return; }
    const data = await runAction("md_send_back");
    if (data) { showBanner("Sent back to DGM."); setComment(""); fetchApp(); }
  }
  function handleAcceptOtpSuccess() {
    setShowAcceptOtp(false);
    navigate(backTo);
  }
  function handleRejectOtpSuccess(data) {
    setShowRejectOtp(false);
    showBanner(`Application rejected. Rejection email ${data.email_sent ? "sent to" : "failed to send to"} BA.`, data.email_sent ? "success" : "warning");
    setComment("");
    setRejectRemark("");
    fetchApp();
  }
  function handleProvisionalOtpSuccess(data) {
    setShowProvisionalOtp(false);
    showBanner(`Provisional letter sent (Ref: ${data.ref}).`);
    fetchApp();
  }

  function canAct() {
    if (!app) return false;
    const s = app.status;
    if (role === "project_officer" && app.project_officer_id === profile.id && (s === "po_review" || s === "po_final_review")) return true;
    if (role === "cfo" && s === "cfo_cs_review" && !app.cfo_reviewed) return true;
    if (role === "cs" && s === "cfo_cs_review" && !app.cs_reviewed) return true;
    if (role === "dgm" && app.team === profile.team && s === "dgm_review") return true;
    if (role === "md" && s === "md_review") return true;
    return false;
  }

  if (loading) return <PageLoader text="Loading application..." />;

  if (!app) return (
    <div className="app-shell">
      <AppHeader />
      <div className="ar-not-found"><Alert variant="danger">Application not found.</Alert></div>
    </div>
  );

  const isFinalised = ["accepted", "rejected"].includes(app.status);
  const userCanAct = canAct();

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="ar-page">
          <button className="ar-back-btn" onClick={() => navigate(backTo)}><ArrowLeftIcon /> {backTo === "/home" ? "Back to Home" : "Back to Applications"}</button>

          {banner && (
            <Alert variant={banner.type === "danger" ? "danger" : banner.type === "warning" ? "warning" : "success"} onClose={() => setBanner(null)}>
              {banner.msg}
            </Alert>
          )}

          <Card className="ar-header-card">
            <Card.Body className="ar-header-body">
              <div className="ar-header-left">
                <div className="ar-header-badges">
                  <Badge variant="brand">Application Review</Badge>
                  <Badge variant={STATUS_BADGE[app.status] || "neutral"} dot>{STATUS_FLOW.find((s) => s.key === app.status)?.label || app.status}</Badge>
                </div>
                <h1 className="ar-header-email">{app.ba_email}</h1>
                <p className="ar-header-meta">Code: <strong>{app.application_code}</strong> · Team: <strong>{app.team || "—"}</strong> · Sent: <strong>{fmtDate(app.created_at)}</strong></p>
              </div>
            </Card.Body>
          </Card>

          <Card>
            <Card.Body className="ar-stepper-body">
              <p className="ar-stepper-heading">Application Progress</p>
              <ProgressStepper currentStatus={app.status} />
            </Card.Body>
          </Card>

          <div className="ar-grid">
            <div className="ar-left">
              <Card>
                <Card.Header title="Application Info" />
                <Card.Body className="ar-detail-body">
                  <Row label="BA Email" value={app.ba_email} />
                  <Row label="Sent By (AC)" value={app.ac?.full_name} />
                  <Row label="Project Officer" value={app.po?.full_name} />
                  <Row label="DGM" value={app.dgm?.full_name} />
                  <Row label="Team" value={app.team} />
                  <Row label="Office" value={app.office} />
                  <Row label="Application Code" value={app.application_code} />
                  <Row label="Sent On" value={fmtDate(app.created_at)} />
                </Card.Body>
              </Card>

              {baData ? (
                <Card>
                  <div className="ar-tabs">
                    {DETAIL_TABS.map((tab) => (
                      <button key={tab.key} className={["ar-tab", activeTab === tab.key ? "ar-tab-active" : "", tab.highlight && activeTab !== tab.key ? "ar-tab-highlight" : ""].filter(Boolean).join(" ")} onClick={() => setActiveTab(tab.key)} title={tab.label}>
                        <span className="ar-tab-icon">{tab.icon}</span>
                        <span className="ar-tab-text">{tab.label}</span>
                      </button>
                    ))}
                  </div>
                  <Card.Body className="ar-detail-body">
                    {activeTab === "details" && (<>
                      <Row label="Organisation Name" value={fmt(baData.org_name)} />
                      <Row label="Entity Type" value={fmt(baData.entity_type)} />
                      <Row label="Year Established" value={fmt(baData.year_established)} />
                      <Row label="CIN" value={fmt(baData.cin)} />
                      <Row label="Date of Incorporation" value={fmtDate(baData.date_of_incorporation)} />
                      <Row label="PAN" value={fmt(baData.pan)} />
                      <Row label="GST" value={fmt(baData.gst)} />
                      <Row label="MSME No." value={fmt(baData.msme_no)} />
                      <Row label="Website" value={fmt(baData.website)} />
                      <Row label="Registered Address" value={fmt(baData.reg_address)} />
                      <Row label="Branch Address" value={fmt(baData.branch_address)} />
                      <Row label="Contact Person" value={fmt(baData.contact_person)} />
                      <Row label="Designation" value={fmt(baData.designation)} />
                      <Row label="Email" value={fmt(baData.email)} />
                      <Row label="Phone" value={fmt(baData.phone)} />
                      <Row label="Submitted On" value={fmtDate(baData.submitted_at)} />
                    </>)}
                    {activeTab === "financial" && (<>
                      <Row label="Authorised Capital" value={fmtMoney(baData.authorised_capital)} />
                      <Row label="Paid-up Capital" value={fmtMoney(baData.paidup_capital)} />
                      <Row label="Working Capital Ratio" value={fmt(baData.working_capital_ratio)} />
                      <Row label="Last BS Filed" value={fmtDate(baData.last_bs_filed)} />
                      <Row label="Net Worth" value={fmtJsonb(baData.net_worth)} />
                      <Row label="Turnover" value={fmtJsonb(baData.turnover)} />
                      <Row label="PAT" value={fmtJsonb(baData.pat)} />
                      <Row label="CA Firm Name" value={fmt(baData.ca_firm_name)} />
                      <Row label="CA Reg. No." value={fmt(baData.ca_reg_no)} />
                      <Row label="Director KYC" value={fmt(baData.director_kyc)} />
                    </>)}
                    {activeTab === "business" && (<>
                      <Row label="Core Expertise" value={fmt(baData.core_expertise)} />
                      <Row label="Sectors Served" value={Array.isArray(baData.sectors_served) ? baData.sectors_served.join(", ") : fmt(baData.sectors_served)} />
                      <Row label="Team Size" value={fmt(baData.team_size)} />
                      <Row label="Years Experience" value={fmt(baData.years_experience)} />
                      <Row label="Certifications" value={fmt(baData.certifications)} />
                      <Row label="Govt. Empanelments" value={fmt(baData.govt_empanelments)} />
                      <Row label="Assignments" value={fmtJsonb(baData.assignments)} />
                    </>)}
                    {activeTab === "bank" && (<>
                      <Row label="Bank Name" value={fmt(baData.bank_name)} />
                      <Row label="Branch" value={fmt(baData.bank_branch)} />
                      <Row label="Account Number" value={fmt(baData.account_number)} />
                      <Row label="IFSC Code" value={fmt(baData.ifsc_code)} />
                    </>)}
                    {activeTab === "documents" && (
                      <div className="ar-docs">
                        {!baData.documents || baData.documents.length === 0
                          ? <p className="ar-empty-text">No documents were uploaded with this application.</p>
                          : (<><p className="ar-docs-count">{baData.documents.length} document{baData.documents.length !== 1 ? "s" : ""} uploaded</p>{baData.documents.map((doc, i) => <DocItem key={`${doc.slot}-${i}`} doc={doc} applicationId={app.id} />)}</>)}
                      </div>
                    )}
                  </Card.Body>
                </Card>
              ) : (
                <Card><Card.Body><p className="ar-empty-text">The Business Associate has not filled out the form yet.</p></Card.Body></Card>
              )}
            </div>

            <div className="ar-right">
              {userCanAct && !isFinalised && (
                <Card className="ar-action-card">
                  <Card.Header title="Your Action" action={<Badge variant="brand">{ROLE_LABELS[role]}</Badge>} />
                  <Card.Body className="ar-action-body">
                    {role === "project_officer" && (<>
                      {app.status === "po_final_review" && (
                        <div className="ar-po-final-notice">
                          <p className="ar-po-final-title">CFO / CS have reviewed this application</p>
                          {app.cfo_comment && <CommentCard label="CFO Comment" text={app.cfo_comment} colorClass="cyan" />}
                          {app.cs_comment && <CommentCard label="CS Comment" text={app.cs_comment} colorClass="green" />}
                        </div>
                      )}
                      <div className="ar-field">
                        <label className="ar-label">{app.status === "po_final_review" ? "Your Final Comment (optional)" : "Technical Review Comment"}{app.status !== "po_final_review" && <span className="ar-required"> *</span>}</label>
                        <textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={app.status === "po_final_review" ? "Add any additional comments before forwarding to DGM..." : "Review the BA's technical details and write your comments..."} rows={4} />
                      </div>
                      {app.status === "po_final_review"
                        ? (<>
                            <Button variant="primary" block loading={actionLoading} iconRight={<ArrowRightIcon />} onClick={handlePOFinalForward}>{actionLoading ? "Forwarding..." : "Forward to DGM"}</Button>
                            <Button variant="secondary" block disabled={actionLoading} onClick={handlePOResendCfoCs}>Send Back to CFO &amp; CS for Review</Button>
                          </>)
                        : <Button variant="primary" block loading={actionLoading} iconRight={<ArrowRightIcon />} onClick={handlePOForward}>{actionLoading ? "Forwarding..." : "Forward to CFO and CS"}</Button>}
                    </>)}

                    {role === "cfo" && (<>
                      <div className="ar-field">
                        <label className="ar-label">Financial Review Comment <span className="ar-required">*</span></label>
                        <textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Review the financial details and write your comments..." rows={4} />
                      </div>
                      {app.cs_reviewed && <div className="ar-view-only" style={{ marginBottom: 8 }}><EyeIcon /><span>CS has already reviewed this application.</span></div>}
                      <Button variant="primary" block loading={actionLoading} iconRight={<ArrowRightIcon />} onClick={handleCFOForward}>{actionLoading ? "Saving..." : "Submit Review"}</Button>
                    </>)}

                    {role === "cs" && (<>
                      <div className="ar-field">
                        <label className="ar-label">Compliance Review Comment <span className="ar-required">*</span></label>
                        <textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Review compliance details and write your comments..." rows={4} />
                      </div>
                      {app.cfo_reviewed && <div className="ar-view-only" style={{ marginBottom: 8 }}><EyeIcon /><span>CFO has already reviewed this application.</span></div>}
                      <Button variant="primary" block loading={actionLoading} iconRight={<ArrowRightIcon />} onClick={handleCSForward}>{actionLoading ? "Saving..." : "Submit Review"}</Button>
                    </>)}

                    {role === "dgm" && (<>
                      <div className="ar-field">
                        <label className="ar-label">Recommendation Comment <span className="ar-required">*</span></label>
                        <textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write your recommendation..." rows={4} />
                      </div>
                      <Button variant="primary" block disabled={!comment.trim() || actionLoading} loading={actionLoading} iconRight={<ArrowRightIcon />} onClick={handleDGMRecommend}>{actionLoading ? "Sending..." : "Recommend to Managing Director"}</Button>
                      <Button variant="secondary" block disabled={actionLoading || !comment.trim()} icon={<ArrowLeftIcon />} onClick={handleDGMSendBack}>Send Back to Project Officer</Button>
                    </>)}

                    {role === "md" && (<>
                      <div className="ar-field">
                        <label className="ar-label">Final Remarks <span className="ar-required">*</span></label>
                        <textarea className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write your remarks along with the final decision..." rows={4} />
                      </div>
                      <Button variant="primary" block disabled={!comment.trim() || actionLoading} icon={<CheckIcon />} onClick={() => setShowAcceptOtp(true)}>Accept</Button>
                      <Button variant="secondary" block disabled={actionLoading || !comment.trim()} icon={<ArrowLeftIcon />} onClick={handleMDSendBack}>Send Back to DGM</Button>
                      <Button variant="danger" block disabled={actionLoading} icon={<XIcon />} onClick={() => setShowReject(true)}>Reject</Button>
                    </>)}

                    {["project_officer", "dgm", "md"].includes(role) && (
                      <>
                        <hr className="divider" />
                        <Button variant="secondary" block disabled={actionLoading} onClick={() => setShowHoldModal(true)}>Raise Compliance Hold</Button>
                      </>
                    )}
                  </Card.Body>
                </Card>
              )}

              {role === "dgm" && baData && app.status !== "rejected" && (
                <Card className="ar-action-card">
                  <Card.Header title="Provisional Letter" action={app.provisional_letter_sent ? <Badge variant="success">Sent</Badge> : null} />
                  <Card.Body className="ar-action-body">
                    <p className="ar-empty-text" style={{ marginBottom: "var(--space-3)" }}>
                      A non-final, provisional empanelment letter emailed to the BA — separate from the MD&apos;s final acceptance email.
                    </p>
                    <Button variant="secondary" block disabled={app.provisional_letter_sent} icon={<DocumentIcon />} onClick={() => setShowProvisionalOtp(true)}>
                      {app.provisional_letter_sent ? "Provisional Letter Already Sent" : "Send Provisional Letter"}
                    </Button>
                  </Card.Body>
                </Card>
              )}

              {app.status === "on_hold" && (
                <Card className="ar-final-card" style={{ borderColor: "rgba(219,36,36,0.3)" }}>
                  <Card.Header title="On Hold — Awaiting BA Correction" action={<Badge variant="warning">On Hold</Badge>} />
                  <Card.Body className="ar-action-body">
                    <p className="ar-empty-text" style={{ marginBottom: "var(--space-3)" }}>
                      The BA was emailed and can submit corrections for the item(s) below. Review will resume from the stage that raised this hold once they do.
                    </p>
                    <div className="ar-flag-list">
                      {openFlags.map((f) => (
                        <div key={f.id} className="ar-flag-item">
                          <div className="ar-flag-field">{f.field_label}</div>
                          <p className="ar-flag-comment">{f.comment}</p>
                        </div>
                      ))}
                    </div>
                  </Card.Body>
                </Card>
              )}

              {isFinalised && (
                <Card className={`ar-final-card ar-final-${app.status}`}>
                  <Card.Body>
                    <p className="ar-final-title">{app.status === "accepted" ? "Application Accepted" : "Application Rejected"}</p>
                    {(app.md_remarks || app.dgm_comment) && <p className="ar-final-remark">{app.md_remarks || app.dgm_comment}</p>}
                  </Card.Body>
                </Card>
              )}

              {!userCanAct && !isFinalised && app.status !== "on_hold" && (
                <Card><Card.Body className="ar-view-only"><EyeIcon /><span>Viewing only. Action pending from <strong>{STATUS_FLOW.find((s) => s.key === app.status)?.label || app.status}</strong></span></Card.Body></Card>
              )}

              <Card>
                <Card.Header title="Activity Timeline" />
                <Card.Body className="ar-timeline-body"><TimelineAccordion logs={auditLogs} /></Card.Body>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {showReject && (
        <RejectModal
          onConfirm={(remark) => { setRejectRemark(remark); setShowReject(false); setShowRejectOtp(true); }}
          onClose={() => setShowReject(false)}
        />
      )}
      {showAcceptOtp && (
        <OtpVerifyModal applicationId={app.id} action="md_accept" comment={comment.trim()} onClose={() => setShowAcceptOtp(false)} onSuccess={handleAcceptOtpSuccess} />
      )}
      {showRejectOtp && (
        <OtpVerifyModal applicationId={app.id} action="md_reject" comment={rejectRemark} onClose={() => setShowRejectOtp(false)} onSuccess={handleRejectOtpSuccess} />
      )}
      {showProvisionalOtp && (
        <OtpVerifyModal applicationId={app.id} action="provisional_letter" onClose={() => setShowProvisionalOtp(false)} onSuccess={handleProvisionalOtpSuccess} />
      )}
      {showHoldModal && (
        <ComplianceHoldModal
          applicationId={app.id}
          onClose={() => setShowHoldModal(false)}
          onSuccess={(data) => { setShowHoldModal(false); showBanner(`Application put on hold. ${data.flags_count} item(s) flagged. Correction email ${data.email_sent ? "sent" : "failed to send"} to the BA.`, data.email_sent ? "success" : "warning"); fetchApp(); }}
        />
      )}
    </div>
  );
}
