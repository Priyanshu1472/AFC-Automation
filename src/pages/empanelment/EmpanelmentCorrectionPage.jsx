import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../../images/Logo.png";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Badge from "../../components/ui/Badge";
import Card from "../../components/ui/Card";
import { FLAGGABLE_TEXT_FIELDS, FLAGGABLE_DOCUMENT_SLOTS } from "../../lib/empanelmentFields";
import "../../styles/BaFormPage.css";

// Grouping only decides display order/sections — which fields are actually
// editable is driven entirely by the open compliance flags returned by the
// server, not by anything decided here.
const SECTION_GROUPS = [
  { tag: "Section A", title: "General Information", fields: ["org_name", "entity_type", "year_established", "cin", "reg_address", "branch_address", "contact_person", "designation", "phone", "email", "website"] },
  { tag: "Section B", title: "Legal and Regulatory Compliance", fields: ["pan", "gst", "msme_no", "companies_act_status", "company_status", "date_of_incorporation", "last_bs_filed", "authorised_capital", "paidup_capital", "director_kyc"] },
  { tag: "Section C", title: "Financial Information", fields: ["net_worth", "turnover", "pat", "cash_flow", "working_capital_ratio", "ca_firm_name", "ca_reg_no"] },
  { tag: "Section D", title: "Technical Capability", fields: ["core_expertise", "sectors_served", "team_size", "years_experience", "assignments"] },
  { tag: "Section E", title: "Certifications and Affiliations", fields: ["certifications", "govt_empanelments"] },
  { tag: "Section F", title: "Bank Details", fields: ["bank_name", "bank_branch", "account_number", "ifsc_code"] },
];

const NON_FLAGGABLE_LABELS = {
  net_worth: "Net Worth (FY-wise)",
  turnover: "Turnover (FY-wise)",
  pat: "Profit After Tax (FY-wise)",
  cash_flow: "Positive Cash Flow Confirmation",
  sectors_served: "Relevant Sectors Served",
  assignments: "Major Assignments Completed",
};

function fmtValue(key, val) {
  if (val === null || val === undefined || val === "") return "—";
  if (key === "date_of_incorporation" || key === "last_bs_filed") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? String(val) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  if (key === "authorised_capital" || key === "paidup_capital") return `INR ${Number(val).toLocaleString("en-IN")} Lakhs`;
  if (["net_worth", "turnover", "pat", "cash_flow"].includes(key)) {
    let obj = val;
    if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch { return String(val); } }
    const entries = Object.entries(obj || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined);
    return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(" | ") : "—";
  }
  if (key === "sectors_served") return Array.isArray(val) ? val.join(", ") || "—" : String(val);
  if (key === "assignments") {
    let arr = val;
    if (typeof arr === "string") { try { arr = JSON.parse(arr); } catch { return String(val); } }
    if (!Array.isArray(arr)) return "—";
    const filled = arr.filter((a) => a?.title || a?.client);
    return filled.length ? filled.map((a) => a.title || a.client).join(", ") : "—";
  }
  return String(val);
}

function UploadIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>; }
function CheckCircleIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>; }
function XSmallIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }

function FormNav({ onBack }) {
  return (
    <nav className="bf-nav" aria-label="Form navigation">
      <div className="bf-nav-brand">
        <img src={logo} height={40} alt="AFC India Limited" className="bf-nav-logo" />
        <div className="bf-nav-brand-text">
          <span className="bf-nav-title">AFC India Limited</span>
          <span className="bf-nav-sub">Empanelment Correction</span>
        </div>
      </div>
      <div className="bf-nav-actions">
        <Button variant="secondary" size="sm" onClick={onBack}>Back to Login</Button>
      </div>
    </nav>
  );
}

function DocReplace({ file, onChange }) {
  const inputRef = useRef(null);
  return (
    <div className={`bf-doc-slot${file ? " bf-doc-slot--filled" : ""}`}>
      {file ? (
        <div className="bf-doc-file-row">
          <span className="bf-doc-file-icon bf-doc-file-icon--ok"><CheckCircleIcon /></span>
          <span className="bf-doc-file-name" title={file.name}>{file.name}</span>
          <button type="button" className="bf-doc-file-clear" onClick={() => { onChange(null); if (inputRef.current) inputRef.current.value = ""; }} aria-label="Remove file"><XSmallIcon /></button>
        </div>
      ) : (
        <button type="button" className="bf-doc-trigger" onClick={() => inputRef.current?.click()}>
          <UploadIcon /><span>Click to upload replacement PDF</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => onChange(e.target.files[0] || null)} />
    </div>
  );
}

function FormSection({ tag, title, children }) {
  return (
    <Card>
      <Card.Header title={title} action={<Badge variant="brand">{tag}</Badge>} />
      <Card.Body className="bf-section-body bf-single-col">{children}</Card.Body>
    </Card>
  );
}

function FieldBlock({ fieldKey, registration, flagMap, values, setValue }) {
  const flag = flagMap[fieldKey];
  const label = FLAGGABLE_TEXT_FIELDS[fieldKey] || NON_FLAGGABLE_LABELS[fieldKey] || fieldKey;
  if (!flag) {
    return (
      <div className="bf-field bf-field-full ec-field-readonly">
        <span className="bf-label">{label}</span>
        <span className="ec-readonly-value">{fmtValue(fieldKey, registration?.[fieldKey])}</span>
      </div>
    );
  }
  return (
    <div className="bf-field bf-field-full ec-field-editable">
      <label className="bf-label">{label}<span className="bf-required"> *</span></label>
      <p className="ec-flag-comment">{flag.comment}</p>
      <input className="input" value={values[fieldKey] || ""} onChange={(e) => setValue(fieldKey, e.target.value)} placeholder={`Corrected ${label.toLowerCase()}`} />
    </div>
  );
}

function DocBlock({ slotKey, registration, flagMap, values, setValue }) {
  const flagKey = `doc:${slotKey}`;
  const flag = flagMap[flagKey];
  const label = FLAGGABLE_DOCUMENT_SLOTS[slotKey];
  const docs = Array.isArray(registration?.documents) ? registration.documents : [];
  const current = docs.find((d) => d.slot === slotKey);
  if (!flag) {
    return (
      <div className="bf-field bf-field-full ec-field-readonly">
        <span className="bf-label">{label}</span>
        <span className="ec-readonly-value">{current ? current.name : "Not uploaded"}</span>
      </div>
    );
  }
  return (
    <div className="bf-field bf-field-full ec-field-editable">
      <label className="bf-label">{label}<span className="bf-required"> *</span></label>
      <p className="ec-flag-comment">{flag.comment}</p>
      {current && <p className="bf-field-hint">Current file on record: {current.name}</p>}
      <DocReplace file={values[flagKey] || null} onChange={(file) => setValue(flagKey, file)} />
    </div>
  );
}

export default function EmpanelmentCorrectionPage() {
  const navigate = useNavigate();
  const [appCode, setAppCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [registration, setRegistration] = useState(null);
  const [flags, setFlags] = useState(null); // null = not verified yet
  const [values, setValues] = useState({}); // { field_key: string|File }
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState("");

  const flagMap = Object.fromEntries((flags || []).map((f) => [f.field_key, f]));

  async function handleVerifyCode() {
    setCodeError("");
    if (!/^\d{5}$/.test(appCode.trim())) { setCodeError("Code must be exactly 5 digits."); return; }
    setLoadingInfo(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/get-empanelment-correction-info`, {
        method: "POST",
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ application_code: appCode.trim() }),
      });
      const result = await res.json();
      if (!res.ok) { setCodeError(result?.error || "Something went wrong."); return; }
      setOrgName(result.org_name || "");
      setRegistration(result.registration || null);
      setFlags(result.flags || []);
      setValues({});
    } catch (err) {
      setCodeError(err.message || "Network error.");
    } finally {
      setLoadingInfo(false);
    }
  }

  function setValue(fieldKey, val) {
    setValues((prev) => ({ ...prev, [fieldKey]: val }));
  }

  async function handleSubmit() {
    setFormError("");
    const keys = flags.map((f) => f.field_key);
    for (const key of keys) {
      if (key.startsWith("doc:")) { if (!(values[key] instanceof File)) { setFormError("Please upload a replacement file for every flagged document."); return; } }
      else if (!values[key]?.toString().trim()) { setFormError("Please fill in every flagged field."); return; }
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("app_code", appCode.trim());
      fd.append("field_keys", JSON.stringify(keys));
      keys.forEach((key) => {
        if (key.startsWith("doc:")) fd.append(key, values[key], values[key].name);
        else fd.append(key, values[key]);
      });
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/submit-empanelment-correction`, {
        method: "POST",
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
        body: fd,
      });
      const result = await res.json();
      if (!res.ok) { setFormError(result?.error || "Submission failed."); return; }
      setSubmitted(true);
    } catch (err) {
      setFormError(err.message || "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="bf-success-page">
        <div className="bf-success-card" role="alert">
          <div className="bf-success-icon" aria-hidden="true"><CheckCircleIcon /></div>
          <Badge variant="success">Submitted</Badge>
          <h2>Correction Submitted</h2>
          <p>Thank you — your correction has been submitted and the application is back with AFC India Limited for review.</p>
          <Button variant="secondary" onClick={() => navigate("/login")}>Back to Login</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bf-page">
      <FormNav onBack={() => navigate("/login")} />
      <main className="bf-content">
        <div className="bf-hero">
          <h1 className="bf-hero-title">Submit a Correction</h1>
          <p className="bf-hero-sub">Enter your 5-digit application code to see your full application. Only the item(s) flagged by AFC India Limited can be edited.</p>
        </div>

        <Card>
          <Card.Body className="bf-section-body bf-single-col">
            <div className="bf-field">
              <label className="bf-label">Application Code<span className="bf-required"> *</span></label>
              <input className={`input bf-code-input${codeError ? " input-error" : ""}`} type="text" inputMode="numeric" maxLength={5} value={appCode} placeholder="·····" onChange={(e) => { setAppCode(e.target.value.replace(/\D/g, "")); setCodeError(""); }} onKeyDown={(e) => e.key === "Enter" && !loadingInfo && handleVerifyCode()} />
              {codeError && <span className="bf-field-error" role="alert">{codeError}</span>}
            </div>
            <Button variant="primary" loading={loadingInfo} disabled={appCode.length !== 5} onClick={handleVerifyCode}>{loadingInfo ? "Checking…" : "Continue"}</Button>
          </Card.Body>
        </Card>

        {flags && flags.length === 0 && (
          <Alert variant="info">This application has no open items to correct right now.</Alert>
        )}

        {flags && flags.length > 0 && (
          <>
            <Card>
              <Card.Body className="bf-section-body bf-single-col">
                <p className="ec-summary-title">{orgName || "Your Application"}</p>
                <p className="bf-field-hint">{flags.length} item{flags.length !== 1 ? "s" : ""} flagged for correction — highlighted in amber below. Everything else is shown as previously submitted and cannot be changed here.</p>
              </Card.Body>
            </Card>

            {formError && <Alert variant="danger" onClose={() => setFormError("")}>{formError}</Alert>}

            {SECTION_GROUPS.map((section) => (
              <FormSection key={section.title} tag={section.tag} title={section.title}>
                {section.fields.map((key) => (
                  <FieldBlock key={key} fieldKey={key} registration={registration} flagMap={flagMap} values={values} setValue={setValue} />
                ))}
              </FormSection>
            ))}

            <FormSection tag="Documents" title="Uploaded Documents">
              {Object.keys(FLAGGABLE_DOCUMENT_SLOTS).map((slotKey) => (
                <DocBlock key={slotKey} slotKey={slotKey} registration={registration} flagMap={flagMap} values={values} setValue={setValue} />
              ))}
            </FormSection>

            <div className="bf-submit-row">
              <Button variant="primary" size="lg" loading={submitting} onClick={handleSubmit}>{submitting ? "Submitting…" : "Submit Correction"}</Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
