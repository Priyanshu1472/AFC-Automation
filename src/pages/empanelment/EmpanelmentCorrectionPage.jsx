import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Badge from "../../components/ui/Badge";
import Select from "../../components/ui/Select";
import { FLAGGABLE_TEXT_FIELDS, FLAGGABLE_DOCUMENT_SLOTS } from "../../lib/empanelmentFields";
import {
  ENTITY_TYPES, COMPANY_STATUS_OPTIONS, COMPANIES_ACT_OPTIONS,
  FormNav, FormSection, Field, TextInput, TextArea, DateInput,
  UploadIcon, CheckCircleIcon, XSmallIcon,
} from "./formShared";
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

// Which widget a flagged field renders as — mirrors the control type that
// field uses on the real empanelment form (BaFormPage), so editing a flagged
// field here feels the same as filling it out originally. Anything not
// listed falls back to a plain text input.
const FIELD_WIDGETS = {
  entity_type: { type: "select", options: ENTITY_TYPES },
  companies_act_status: { type: "select", options: COMPANIES_ACT_OPTIONS },
  company_status: { type: "select", options: COMPANY_STATUS_OPTIONS },
  date_of_incorporation: { type: "date" },
  last_bs_filed: { type: "date" },
  authorised_capital: { type: "number" },
  paidup_capital: { type: "number" },
  reg_address: { type: "textarea" },
  branch_address: { type: "textarea" },
  director_kyc: { type: "textarea" },
  core_expertise: { type: "textarea" },
  certifications: { type: "textarea" },
  govt_empanelments: { type: "textarea" },
};

const UPPERCASE_FIELDS = new Set(["pan", "ifsc_code", "gst", "cin", "msme_no", "ca_reg_no"]);

// Client-side mirror of the format checks in
// submit-empanelment-correction/index.ts — real validation still happens
// server-side, this is just earlier feedback.
const FIELD_VALIDATORS = {
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? "" : "Enter a valid email address."),
  pan: (v) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase()) ? "" : "PAN format: ABCDE1234F."),
  gst: (v) => (v === "" || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v.toUpperCase()) ? "" : "Enter a valid 15-character GST number."),
  ifsc_code: (v) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase()) ? "" : "IFSC format: 4 letters + 0 + 6 alphanumeric."),
  account_number: (v) => (/^\d{9,18}$/.test(v) ? "" : "Account number must be 9–18 digits."),
  phone: (v) => (/^\d{10}$/.test(v) ? "" : "Enter a valid 10-digit phone number."),
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

function FieldBlock({ fieldKey, registration, flagMap, values, fieldErrors, setValue }) {
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

  const widget = FIELD_WIDGETS[fieldKey] || { type: "text" };
  const value = values[fieldKey] ?? "";
  const error = fieldErrors[fieldKey];

  function handleChange(raw) {
    const next = UPPERCASE_FIELDS.has(fieldKey) ? raw.toUpperCase() : raw;
    setValue(fieldKey, next);
  }

  let control;
  if (widget.type === "select") {
    control = <Select options={widget.options.map((o) => ({ value: o, label: o }))} value={value} onChange={(v) => handleChange(v)} placeholder="Select" />;
  } else if (widget.type === "date") {
    control = <DateInput name={fieldKey} value={value} onChange={(e) => handleChange(e.target.value)} max={new Date().toISOString().split("T")[0]} error={error} />;
  } else if (widget.type === "number") {
    control = <input className={`input${error ? " input-error" : ""}`} type="number" min="0" max="99999" step="0.01" value={value} onChange={(e) => handleChange(e.target.value)} placeholder={`Corrected ${label.toLowerCase()}`} />;
  } else if (widget.type === "textarea") {
    control = <TextArea value={value} onChange={(e) => handleChange(e.target.value)} placeholder={`Corrected ${label.toLowerCase()}`} error={error} rows={3} />;
  } else {
    control = <TextInput value={value} onChange={(e) => handleChange(e.target.value)} placeholder={`Corrected ${label.toLowerCase()}`} error={error} />;
  }

  return (
    <Field label={label} required error={error} full className="ec-field-editable">
      <p className="ec-flag-comment">{flag.comment}</p>
      {control}
    </Field>
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
    <Field label={label} required full className="ec-field-editable">
      <p className="ec-flag-comment">{flag.comment}</p>
      {current && <p className="bf-field-hint">Current file on record: {current.name}</p>}
      <DocReplace file={values[flagKey] || null} onChange={(file) => setValue(flagKey, file)} />
    </Field>
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
  const [fieldErrors, setFieldErrors] = useState({});
  const [clarification, setClarification] = useState("");
  const [clarificationError, setClarificationError] = useState("");
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
      setFieldErrors({});
    } catch (err) {
      setCodeError(err.message || "Network error.");
    } finally {
      setLoadingInfo(false);
    }
  }

  function setValue(fieldKey, val) {
    setValues((prev) => ({ ...prev, [fieldKey]: val }));
    const validator = FIELD_VALIDATORS[fieldKey];
    if (validator && typeof val === "string") {
      setFieldErrors((prev) => ({ ...prev, [fieldKey]: val.trim() ? validator(val.trim()) : "" }));
    }
  }

  async function handleSubmit() {
    setFormError("");
    const keys = flags.map((f) => f.field_key);
    const errors = {};
    for (const key of keys) {
      if (key.startsWith("doc:")) {
        if (!(values[key] instanceof File)) { setFormError("Please upload a replacement file for every flagged document."); return; }
      } else {
        const val = values[key]?.toString().trim();
        if (!val) { setFormError("Please fill in every flagged field."); return; }
        const validator = FIELD_VALIDATORS[key];
        if (validator) { const err = validator(val); if (err) errors[key] = err; }
      }
    }
    if (Object.keys(errors).length > 0) { setFieldErrors((prev) => ({ ...prev, ...errors })); setFormError("Please fix the highlighted errors before submitting."); return; }
    if (!clarification.trim()) { setClarificationError("Please add a clarification explaining your correction."); return; }
    setClarificationError("");

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("app_code", appCode.trim());
      fd.append("field_keys", JSON.stringify(keys));
      fd.append("clarification", clarification.trim());
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
      <FormNav subtitle="Empanelment Correction" onBack={() => navigate("/login")} />
      <main className="bf-content">
        <div className="bf-hero">
          <h1 className="bf-hero-title">Submit a Correction</h1>
          <p className="bf-hero-sub">Enter your 5-digit application code to see your full application. Only the item(s) flagged by AFC India Limited can be edited.</p>
        </div>

        <FormSection tag="Verify" title="Application Code" singleCol>
          <Field label="Application Code" required full>
            <input className={`input bf-code-input${codeError ? " input-error" : ""}`} type="text" inputMode="numeric" maxLength={5} value={appCode} placeholder="·····" onChange={(e) => { setAppCode(e.target.value.replace(/\D/g, "")); setCodeError(""); }} onKeyDown={(e) => e.key === "Enter" && !loadingInfo && handleVerifyCode()} />
            {codeError && <span className="bf-field-error" role="alert">{codeError}</span>}
          </Field>
          <Button variant="primary" loading={loadingInfo} disabled={appCode.length !== 5} onClick={handleVerifyCode}>{loadingInfo ? "Checking…" : "Continue"}</Button>
        </FormSection>

        {flags && flags.length === 0 && (
          <Alert variant="info">This application has no open items to correct right now.</Alert>
        )}

        {flags && flags.length > 0 && (
          <>
            <FormSection tag="Application" title={orgName || "Your Application"} singleCol>
              <p className="bf-field-hint">{flags.length} item{flags.length !== 1 ? "s" : ""} flagged for correction — highlighted below. Everything else is shown as previously submitted and cannot be changed here.</p>
            </FormSection>

            {formError && <Alert variant="danger" onClose={() => setFormError("")}>{formError}</Alert>}

            {SECTION_GROUPS.map((section) => (
              <FormSection key={section.title} tag={section.tag} title={section.title}>
                {section.fields.map((key) => (
                  <FieldBlock key={key} fieldKey={key} registration={registration} flagMap={flagMap} values={values} fieldErrors={fieldErrors} setValue={setValue} />
                ))}
              </FormSection>
            ))}

            <FormSection tag="Documents" title="Uploaded Documents">
              {Object.keys(FLAGGABLE_DOCUMENT_SLOTS).map((slotKey) => (
                <DocBlock key={slotKey} slotKey={slotKey} registration={registration} flagMap={flagMap} values={values} setValue={setValue} />
              ))}
            </FormSection>

            <FormSection tag="Clarification" tagVariant="warning" title="Clarification for AFC India Limited" singleCol>
              <Field label="Clarification" required error={clarificationError} full hint="Briefly explain what you corrected and why — this is shown to the reviewer in the application's activity timeline.">
                <TextArea value={clarification} onChange={(e) => { setClarification(e.target.value); if (clarificationError) setClarificationError(""); }} placeholder="e.g. Updated the registered office address to match our latest incorporation certificate." rows={3} />
              </Field>
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
