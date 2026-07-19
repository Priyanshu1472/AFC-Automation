import { useState, useRef, useCallback, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../../images/Logo.png";

import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import Badge from "../../components/ui/Badge";
import Card from "../../components/ui/Card";
import Select from "../../components/ui/Select";

import "../../styles/BaFormPage.css";

// ── Constants ─────────────────────────────────────────────────
const SECTORS = ["Agriculture", "Energy", "Livelihood", "Infrastructure", "Monitoring & Evaluation", "Others"];
const ENTITY_TYPES = ["Proprietorship", "Partnership", "Private Ltd.", "Public Ltd.", "LLP", "Others"];
const COMPANY_STATUS_OPTIONS = ["Active", "Dormant", "Under Liquidation"];
const COMPANIES_ACT_OPTIONS = ["Compliant", "Not Applicable", "In Process"];
const CASH_FLOW_OPTIONS = ["Yes", "No"];

const FINANCIAL_ROWS = [
  { key: "netWorth", label: "Net Worth (INR Lakhs)" },
  { key: "turnover", label: "Turnover (INR Lakhs)" },
  { key: "pat", label: "Profit After Tax (INR Lakhs)" },
];

const FY_YEARS = [
  { key: "fy22", label: "FY 2022-23" },
  { key: "fy23", label: "FY 2023-24" },
  { key: "fy24", label: "FY 2024-25" },
];

const EMPTY_ASSIGNMENT = { title: "", client: "", duration: "", value: "", role: "" };

// Must match DOC_SLOT_CONFIG in supabase/functions/submit-ba-form/index.ts.
export const DOC_SLOTS = {
  panCopy: { label: "PAN Card Copy", required: true, multiple: false },
  incorporationCert: { label: "Certificate of Incorporation / MOA / AOA", required: true, multiple: false },
  gstCert: { label: "GST Registration Certificate", required: false, multiple: false, conditional: (f) => !!f.gst?.trim() },
  nonBlacklisting: { label: "Notarized Declaration of Non-Blacklisting", required: true, multiple: false },
  mcaCompliance: { label: "MCA Legal Compliance Printout", required: false, multiple: false },
  financials: { label: "Audited Financial Statements (Last 3 Years)", required: true, multiple: true },
  netWorthCert: { label: "CA Certified Net Worth Statement", required: true, multiple: false },
  isoCert: { label: "ISO / Other Quality Certifications", required: true, multiple: false },
  cancelledCheque: { label: "Cancelled Cheque / Bank Passbook Front Page", required: true, multiple: false },
  workOrders: { label: "Work Orders / Completion Certificates (optional)", required: false, multiple: false },
};

const INITIAL_FILES = Object.fromEntries(Object.entries(DOC_SLOTS).map(([k, cfg]) => [k, cfg.multiple ? [] : null]));

const INITIAL_FORM = {
  orgName: "", entityType: "", entityTypeOther: "", yearEstablished: "",
  cin: "", regAddress: "", branchAddress: "", contactPerson: "",
  designation: "", phone: "", email: "", website: "",
  pan: "", gst: "", msmeNo: "", companiesActStatus: "", companyStatus: "",
  dateOfIncorporation: "", lastBSFiled: "", authorisedCapital: "",
  paidupCapital: "", directorKyc: "",
  netWorth: { fy22: "", fy23: "", fy24: "" },
  turnover: { fy22: "", fy23: "", fy24: "" },
  pat: { fy22: "", fy23: "", fy24: "" },
  cashFlow: { fy22: "", fy23: "", fy24: "" },
  workingCapitalRatio: "", caFirmName: "", caRegNo: "",
  coreExpertise: "", sectors: [], otherSectors: "",
  teamSize: "", yearsExperience: "",
  assignments: [EMPTY_ASSIGNMENT, EMPTY_ASSIGNMENT, EMPTY_ASSIGNMENT],
  certifications: "", govtEmpanelments: "",
  bankName: "", bankBranch: "", accountNumber: "", ifscCode: "",
  declared: false,
};

const MAX_FINANCIAL_LAKHS = 99999;

const VALIDATORS = {
  orgName: (v) => { if (!v.trim()) return "Organisation name is required."; if (v.trim().length < 3) return "Must be at least 3 characters."; if (v.trim().length > 200) return "Must be under 200 characters."; return ""; },
  entityType: (v) => (v ? "" : "Please select the type of entity."),
  yearEstablished: (v) => { if (!v) return "Year of establishment is required."; const yr = parseInt(v, 10); const curr = new Date().getFullYear(); if (isNaN(yr) || yr < 1800 || yr > curr) return `Enter a valid year between 1800 and ${curr}.`; return ""; },
  cin: (v) => { if (!v.trim()) return ""; if (!/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/i.test(v.trim())) return "CIN format: e.g. U12345MH2010PLC123456 (21 characters)."; return ""; },
  regAddress: (v) => { if (!v.trim()) return "Registered office address is required."; if (v.trim().length < 10) return "Please provide a complete address."; return ""; },
  contactPerson: (v) => { if (!v.trim()) return "Contact person name is required."; if (!/^[a-zA-Z\s.'-]+$/.test(v.trim())) return "Name can only contain letters, spaces, and . - '"; return ""; },
  designation: (v) => (v.trim() ? "" : "Designation is required."),
  phone: (v) => { if (!v.trim()) return "Phone number is required."; const digits = v.replace(/\D/g, ""); if (digits.length !== 10) return "Enter a valid 10-digit phone number."; return ""; },
  email: (v) => { if (!v.trim()) return "Email ID is required."; if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "Enter a valid email address."; return ""; },
  website: (v) => { if (!v.trim()) return ""; try { new URL(v.trim()); return ""; } catch { return "Enter a valid URL (e.g. https://www.company.com)."; } },
  pan: (v) => { if (!v.trim()) return "PAN number is required."; if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.trim().toUpperCase())) return "PAN format: ABCDE1234F (5 letters, 4 digits, 1 letter)."; return ""; },
  gst: (v) => { if (!v.trim()) return ""; if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v.trim().toUpperCase())) return "Enter a valid 15-character GST number."; return ""; },
  msmeNo: (v) => { if (!v.trim()) return ""; if (!/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/i.test(v.trim().toUpperCase())) return "MSME format: UDYAM-XX-00-0000000 (e.g. UDYAM-MH-12-0001234)."; return ""; },
  companiesActStatus: (v) => (v ? "" : "Please select compliance status."),
  companyStatus: (v) => (v ? "" : "Please select company status."),
  dateOfIncorporation: (v) => { if (!v) return "Date of incorporation is required."; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Please enter a complete date (DD/MM/YYYY)."; const d = new Date(v); if (isNaN(d.getTime())) return "Enter a valid date."; if (d > new Date()) return "Date cannot be in the future."; return ""; },
  lastBSFiled: (v) => { if (!v) return ""; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Please enter a complete date (DD/MM/YYYY)."; const d = new Date(v); if (isNaN(d.getTime())) return "Enter a valid date."; if (d > new Date()) return "Date cannot be in the future."; return ""; },
  netWorth: () => "", turnover: () => "", pat: () => "",
  authorisedCapital: (v) => { if (!v) return ""; const n = Number(v); if (isNaN(n) || n < 0) return "Enter a valid positive amount."; if (n > 99999) return "Maximum is 99,999 Lakhs."; return ""; },
  paidupCapital: (v) => { if (!v) return ""; const n = Number(v); if (isNaN(n) || n < 0) return "Enter a valid positive amount."; if (n > 99999) return "Maximum is 99,999 Lakhs."; return ""; },
  workingCapitalRatio: (v) => { if (!v.trim()) return ""; if (!/^\d+(\.\d{1,2})?\s*:\s*\d+(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(v.trim())) return "Enter a valid ratio (e.g. 1.5 : 1 or 2.0)."; return ""; },
  caRegNo: (v) => { if (!v.trim()) return ""; if (!/^\d{5,6}[A-Z]?$/i.test(v.trim())) return "CA Reg No. format: 5-6 digits + optional letter (e.g. 001234N)."; return ""; },
  coreExpertise: (v) => { if (!v.trim()) return "Core expertise is required."; if (v.trim().length < 20) return "Please provide at least 20 characters."; return ""; },
  teamSize: (v) => { if (!v) return "Team size is required."; const n = parseInt(v, 10); if (isNaN(n) || n < 1 || n > 999999) return "Enter a valid team size (1–999,999)."; return ""; },
  yearsExperience: (v) => { if (!v) return "Years of experience is required."; const n = parseInt(v, 10); if (isNaN(n) || n < 0 || n > 999) return "Enter a valid number (0–999)."; return ""; },
  bankName: (v) => (v.trim() ? "" : "Bank name is required."),
  bankBranch: (v) => (v.trim() ? "" : "Branch address is required."),
  accountNumber: (v) => { if (!v.trim()) return "Account number is required."; if (!/^\d{9,18}$/.test(v.trim())) return "Account number must be 9–18 digits."; return ""; },
  ifscCode: (v) => { if (!v.trim()) return "IFSC code is required."; if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.trim().toUpperCase())) return "IFSC format: 4 letters + 0 + 6 alphanumeric (e.g. SBIN0001234)."; return ""; },
};

function validateFinancialValue(v) {
  if (v === "" || v === undefined || v === null) return "";
  const n = Number(v);
  if (isNaN(n)) return "Enter a valid number.";
  if (n < 0) return "Value must be 0 or positive.";
  if (n > MAX_FINANCIAL_LAKHS) return `Maximum is ${MAX_FINANCIAL_LAKHS.toLocaleString("en-IN")}.99 Lakhs.`;
  const str = String(v);
  if (str.includes(".") && str.split(".")[1].length > 2) return "Maximum 2 decimal places allowed.";
  return "";
}

function validatePdfFile(file) {
  if (!file) return "";
  if (file.type !== "application/pdf") return "Only PDF files are allowed.";
  if (file.size > 10 * 1024 * 1024) return "File size must be under 10 MB.";
  return "";
}

function sanitize(val) {
  if (typeof val !== "string") return val;
  // eslint-disable-next-line no-control-regex
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trimStart();
}

// ── Icons ─────────────────────────────────────────────────────
function ArrowLeftIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 5-7 7 7 7" /></svg>; }
function UploadIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>; }
function CheckCircleIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>; }
function XSmallIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function AlertCircleIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>; }

// ── FormNav ───────────────────────────────────────────────────
function FormNav({ onBack }) {
  return (
    <nav className="bf-nav" aria-label="Form navigation">
      <div className="bf-nav-brand">
        <img src={logo} height={40} alt="AFC India Limited" className="bf-nav-logo" />
        <div className="bf-nav-brand-text">
          <span className="bf-nav-title">AFC India Limited</span>
          <span className="bf-nav-sub">Business Associate Empanelment</span>
        </div>
      </div>
      <div className="bf-nav-actions">
        <Button variant="secondary" size="sm" icon={<ArrowLeftIcon />} onClick={onBack}>Back to Login</Button>
      </div>
    </nav>
  );
}

function FormSection({ tag, tagVariant = "brand", title, children, singleCol = false }) {
  return (
    <Card>
      <Card.Header title={title} action={<Badge variant={tagVariant}>{tag}</Badge>} />
      <Card.Body className={`bf-section-body${singleCol ? " bf-single-col" : ""}`}>{children}</Card.Body>
    </Card>
  );
}

const Field = forwardRef(function Field({ label, required, error, hint, children, full = false, className = "" }, ref) {
  return (
    <div ref={ref} className={`bf-field${full ? " bf-field-full" : ""}${className ? ` ${className}` : ""}`}>
      {label && <label className="bf-label">{label}{required && <span className="bf-required" aria-hidden="true"> *</span>}</label>}
      {children}
      {hint && !error && <span className="bf-field-hint">{hint}</span>}
      {error && <span className="bf-field-error" role="alert">{error}</span>}
    </div>
  );
});

function TextInput({ error, onChange, ...props }) {
  return <input className={`input${error ? " input-error" : ""}`} onChange={(e) => onChange({ target: { name: e.target.name, value: sanitize(e.target.value) } })} {...props} />;
}

function TextArea({ error, rows = 3, onChange, ...props }) {
  return <textarea className={`input${error ? " input-error" : ""}`} rows={rows} onChange={(e) => onChange({ target: { name: e.target.name, value: sanitize(e.target.value) } })} {...props} />;
}

function Checkbox({ label, checked, onChange, className = "" }) {
  return <label className={`bf-checkbox ${className}`.trim()}><input type="checkbox" checked={checked} onChange={onChange} /><span>{label}</span></label>;
}

function DateInput({ name, value, onChange, max, error }) {
  const today = new Date();
  const maxYear = max ? parseInt(max.split("-")[0], 10) : today.getFullYear();

  function parseParts(v) {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { dd: "", mm: "", yyyy: "" };
    const [yr, mo, dy] = v.split("-");
    return { dd: dy, mm: mo, yyyy: yr };
  }

  const [parts, setParts] = useState(() => parseParts(value));
  const prevExternal = useRef(value);
  if (prevExternal.current !== value) { prevExternal.current = value; setParts(parseParts(value)); }

  function isComplete(d, m, y) {
    const dN = parseInt(d, 10); const mN = parseInt(m, 10); const yN = parseInt(y, 10);
    return y.length === 4 && !isNaN(yN) && d !== "" && !isNaN(dN) && dN >= 1 && dN <= 31 && m !== "" && !isNaN(mN) && mN >= 1 && mN <= 12;
  }

  function update(next) {
    setParts(next);
    const { dd, mm, yyyy } = next;
    if (isComplete(dd, mm, yyyy)) { onChange({ target: { name, value: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}` } }); }
    else if (!dd && !mm && !yyyy) { onChange({ target: { name, value: "" } }); }
  }

  return (
    <div className={`bf-date-input${error ? " bf-date-input--error" : ""}`}>
      <input className="bf-date-part bf-date-dd" type="text" inputMode="numeric" placeholder="DD" maxLength={2} value={parts.dd} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 2); const n = parseInt(v, 10); if (v && (n < 1 || n > 31)) return; update({ ...parts, dd: v }); }} />
      <span className="bf-date-sep">/</span>
      <input className="bf-date-part bf-date-mm" type="text" inputMode="numeric" placeholder="MM" maxLength={2} value={parts.mm} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 2); const n = parseInt(v, 10); if (v && (n < 1 || n > 12)) return; update({ ...parts, mm: v }); }} />
      <span className="bf-date-sep">/</span>
      <input className="bf-date-part bf-date-yyyy" type="text" inputMode="numeric" placeholder="YYYY" maxLength={4} value={parts.yyyy} onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 4); if (v.length === 4) { const n = parseInt(v, 10); if (n < 1800 || n > maxYear) return; } update({ ...parts, yyyy: v }); }} />
    </div>
  );
}

function DocUpload({ slotKey, label, required, file, fileError, onChange, onClear }) {
  const inputRef = useRef(null);
  const hasFile = !!file; const hasError = !!fileError;
  return (
    <div className={`bf-doc-slot${hasError ? " bf-doc-slot--error" : hasFile ? " bf-doc-slot--filled" : ""}`}>
      <div className="bf-doc-slot-header">
        <span className="bf-doc-slot-label">{label}{required && <span className="bf-required" aria-hidden="true"> *</span>}</span>
        <span className="bf-doc-slot-type">PDF only · max 10 MB</span>
      </div>
      {hasFile ? (
        <div className="bf-doc-file-row">
          <span className="bf-doc-file-icon bf-doc-file-icon--ok"><CheckCircleIcon /></span>
          <span className="bf-doc-file-name" title={file.name}>{file.name}</span>
          <button type="button" className="bf-doc-file-clear" onClick={() => { onClear(slotKey); if (inputRef.current) inputRef.current.value = ""; }} aria-label="Remove file"><XSmallIcon /></button>
        </div>
      ) : (
        <button type="button" className={`bf-doc-trigger${hasError ? " bf-doc-trigger--error" : ""}`} onClick={() => inputRef.current?.click()}>
          <UploadIcon /><span>Click to upload</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => onChange(slotKey, e.target.files[0] || null)} />
      {hasError && <span className="bf-field-error" role="alert"><AlertCircleIcon /> {fileError}</span>}
    </div>
  );
}

function MultiDocUpload({ slotKey, label, required, files, fileErrors, onChange, onClear }) {
  const inputRef = useRef(null);
  const fileArr = Array.isArray(files) ? files : [];
  const genErr = fileErrors?.general;
  return (
    <div className={`bf-doc-slot${genErr ? " bf-doc-slot--error" : fileArr.length > 0 ? " bf-doc-slot--filled" : ""}`}>
      <div className="bf-doc-slot-header">
        <span className="bf-doc-slot-label">{label}{required && <span className="bf-required" aria-hidden="true"> *</span>}</span>
        <span className="bf-doc-slot-type">PDF only · max 10 MB each · multiple allowed</span>
      </div>
      {fileArr.length > 0 && (
        <div className="bf-doc-multi-list">
          {fileArr.map((f, i) => {
            const err = fileErrors?.[i];
            return (
              <div key={i} className={`bf-doc-file-row${err ? " bf-doc-file-row--error" : ""}`}>
                <span className={`bf-doc-file-icon${err ? " bf-doc-file-icon--err" : " bf-doc-file-icon--ok"}`}>{err ? <AlertCircleIcon /> : <CheckCircleIcon />}</span>
                <span className="bf-doc-file-name" title={f.name}>{f.name}</span>
                {err && <span className="bf-doc-file-inline-err">{err}</span>}
                <button type="button" className="bf-doc-file-clear" onClick={() => onClear(slotKey, i)} aria-label="Remove file"><XSmallIcon /></button>
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className={`bf-doc-trigger${genErr ? " bf-doc-trigger--error" : ""}`} onClick={() => inputRef.current?.click()}>
        <UploadIcon /><span>{fileArr.length > 0 ? "Add more files" : "Click to upload"}</span>
      </button>
      <input ref={inputRef} type="file" accept="application/pdf" multiple style={{ display: "none" }} onChange={(e) => onChange(slotKey, e.target.files)} />
      {genErr && <span className="bf-field-error" role="alert">{genErr}</span>}
    </div>
  );
}

function AppCodeModal({ appCode, setAppCode, codeError, submitting, onSubmit, onClose }) {
  return (
    <div className="bf-modal-backdrop" onClick={() => !submitting && onClose()}>
      <div className="bf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="bf-modal-title">
        <div className="bf-modal-header">
          <Badge variant="brand">Verification Required</Badge>
          <h3 className="bf-modal-title" id="bf-modal-title">Enter Application Code</h3>
          <p className="bf-modal-desc">Enter the <strong>5-digit application code</strong> sent to you via email by AFC India Limited along with this form link.</p>
        </div>
        <div className="bf-field">
          <label className="bf-label">Application Code<span className="bf-required"> *</span></label>
          <input className={`input bf-code-input${codeError ? " input-error" : ""}`} type="text" inputMode="numeric" maxLength={5} value={appCode} placeholder="·····" autoFocus autoComplete="one-time-code" onChange={(e) => setAppCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && !submitting && onSubmit()} />
          {codeError && <span className="bf-field-error" role="alert">{codeError}</span>}
        </div>
        <div className="bf-modal-actions">
          <Button variant="primary" block loading={submitting} onClick={onSubmit} disabled={appCode.length !== 5}>{submitting ? "Verifying…" : "Verify and Submit"}</Button>
          <Button variant="secondary" block disabled={submitting} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function SuccessScreen() {
  const navigate = useNavigate();
  return (
    <div className="bf-success-page">
      <div className="bf-success-card" role="alert">
        <div className="bf-success-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="32" height="32"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <Badge variant="success">Submitted</Badge>
        <h2>Registration Submitted</h2>
        <p>Thank you for submitting your empanelment application. AFC India Limited will review your details and contact you shortly.</p>
        <Button variant="secondary" onClick={() => navigate("/login")}>Back to Login</Button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function BaFormPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(INITIAL_FORM);
  const [files, setFiles] = useState(INITIAL_FILES);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [fileErrors, setFileErrors] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [appCode, setAppCode] = useState("");
  const [codeError, setCodeError] = useState("");

  const fieldRefs = useRef({});
  const setRef = useCallback((key) => (el) => { if (el) fieldRefs.current[key] = el; }, []);

  function handleFileChange(slotKey, fileOrFileList) {
    const cfg = DOC_SLOTS[slotKey];
    if (!cfg) return;
    if (cfg.multiple) {
      const incoming = fileOrFileList ? Array.from(fileOrFileList) : [];
      setFiles((prev) => ({ ...prev, [slotKey]: [...(prev[slotKey] || []), ...incoming] }));
      const errs = {};
      incoming.forEach((f, idx) => { const e = validatePdfFile(f); const existingLen = (files[slotKey] || []).length; if (e) errs[existingLen + idx] = e; });
      if (Object.keys(errs).length > 0) setFileErrors((prev) => ({ ...prev, [slotKey]: { ...(prev[slotKey] || {}), ...errs } }));
    } else {
      const file = fileOrFileList instanceof File ? fileOrFileList : null;
      setFiles((prev) => ({ ...prev, [slotKey]: file }));
      if (file) { const err = validatePdfFile(file); setFileErrors((prev) => ({ ...prev, [slotKey]: err })); }
      else { setFileErrors((prev) => ({ ...prev, [slotKey]: "" })); }
    }
  }

  function handleFileClear(slotKey, index) {
    const cfg = DOC_SLOTS[slotKey];
    if (!cfg) return;
    if (cfg.multiple && index !== undefined) {
      setFiles((prev) => ({ ...prev, [slotKey]: (prev[slotKey] || []).filter((_, i) => i !== index) }));
      setFileErrors((prev) => { const updated = { ...(prev[slotKey] || {}) }; delete updated[index]; return { ...prev, [slotKey]: updated }; });
    } else { setFiles((prev) => ({ ...prev, [slotKey]: null })); setFileErrors((prev) => ({ ...prev, [slotKey]: "" })); }
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (VALIDATORS[name]) { const err = VALIDATORS[name](value); setFieldErrors((prev) => ({ ...prev, [name]: err })); }
  }

  function handleNested(parent, key, value) {
    setForm((prev) => ({ ...prev, [parent]: { ...prev[parent], [key]: value } }));
    if (["netWorth", "turnover", "pat"].includes(parent)) { const err = validateFinancialValue(value); setFieldErrors((prev) => ({ ...prev, [`${parent}_${key}`]: err })); }
  }

  function handleSector(sector) {
    setForm((prev) => ({ ...prev, sectors: prev.sectors.includes(sector) ? prev.sectors.filter((s) => s !== sector) : [...prev.sectors, sector] }));
    if (fieldErrors.sectors) setFieldErrors((p) => ({ ...p, sectors: "" }));
  }

  function handleAssignment(index, field, value) {
    setForm((prev) => ({ ...prev, assignments: prev.assignments.map((row, i) => (i === index ? { ...row, [field]: sanitize(value) } : row)) }));
  }

  function validateForm() {
    const errors = {}; const fErrors = {}; let firstRef = null;
    for (const [field, validator] of Object.entries(VALIDATORS)) {
      const val = form[field] ?? "";
      const err = validator(String(val));
      if (err) { errors[field] = err; if (!firstRef) firstRef = field; }
    }
    if (form.entityType === "Others" && !form.entityTypeOther?.trim()) { errors.entityTypeOther = "Please specify the entity type."; if (!firstRef) firstRef = "entityTypeOther"; }
    if (form.sectors.length === 0) { errors.sectors = "Please select at least one sector."; if (!firstRef) firstRef = "sectors"; }
    if (form.sectors.includes("Others") && !form.otherSectors?.trim()) { errors.otherSectors = "Please describe the other sectors."; if (!firstRef) firstRef = "otherSectors"; }
    ["netWorth", "turnover", "pat"].forEach((key) => {
      FY_YEARS.forEach((fy) => {
        const val = form[key][fy.key];
        if (val === "" || val === null || val === undefined) { errors[`${key}_${fy.key}`] = "This field is required."; if (!firstRef) firstRef = `${key}_${fy.key}`; return; }
        const err = validateFinancialValue(val);
        if (err) { errors[`${key}_${fy.key}`] = err; if (!firstRef) firstRef = `${key}_${fy.key}`; }
      });
    });
    if (form.pan && !errors.pan) setForm((prev) => ({ ...prev, pan: prev.pan.toUpperCase() }));
    if (form.ifscCode && !errors.ifscCode) setForm((prev) => ({ ...prev, ifscCode: prev.ifscCode.toUpperCase() }));
    if (form.cin && !errors.cin) setForm((prev) => ({ ...prev, cin: prev.cin.toUpperCase() }));
    if (!form.declared) { errors.declared = "You must accept the declaration to proceed."; if (!firstRef) firstRef = "declared"; }
    for (const [slotKey, cfg] of Object.entries(DOC_SLOTS)) {
      const isRequired = cfg.required || (cfg.conditional && cfg.conditional(form));
      if (!isRequired) continue;
      if (cfg.multiple) { if ((files[slotKey] || []).length === 0) { fErrors[slotKey] = { general: "Please upload at least one file." }; if (!firstRef) firstRef = `doc_${slotKey}`; } }
      else { if (!files[slotKey]) { fErrors[slotKey] = "This document is required."; if (!firstRef) firstRef = `doc_${slotKey}`; } }
    }
    for (const [slotKey, cfg] of Object.entries(DOC_SLOTS)) {
      if (cfg.multiple) {
        const slotFiles = files[slotKey] || [];
        for (let fi = 0; fi < slotFiles.length; fi++) {
          const f = slotFiles[fi];
          const err = validatePdfFile(f);
          if (err) {
            if (!fErrors[slotKey]) fErrors[slotKey] = {};
            fErrors[slotKey][fi] = err;
            if (!firstRef) firstRef = `doc_${slotKey}`;
          }
        }
      } else if (files[slotKey]) {
        const err = validatePdfFile(files[slotKey]);
        if (err) { fErrors[slotKey] = err; if (!firstRef) firstRef = `doc_${slotKey}`; }
      }
    }
    setFieldErrors(errors); setFileErrors(fErrors);
    if (firstRef) { const el = fieldRefs.current[firstRef]; if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => { const f = el.querySelector("input, select, textarea, button"); if (f) f.focus(); }, 350); } }
    return Object.keys(errors).length === 0 && Object.keys(fErrors).length === 0;
  }

  function handleSubmitClick() {
    setFormError("");
    if (!validateForm()) { setFormError("Please fix the highlighted errors before submitting."); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setAppCode(""); setCodeError(""); setShowModal(true);
  }

  async function handleFinalSubmit() {
    setCodeError("");
    if (!appCode.trim()) { setCodeError("Please enter your application code."); return; }
    if (!/^\d{5}$/.test(appCode.trim())) { setCodeError("Code must be exactly 5 digits."); return; }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("app_code", appCode.trim());
      const textFields = ["orgName", "entityType", "entityTypeOther", "yearEstablished", "cin", "regAddress", "branchAddress", "contactPerson", "designation", "phone", "email", "website", "pan", "gst", "msmeNo", "companiesActStatus", "companyStatus", "dateOfIncorporation", "lastBSFiled", "authorisedCapital", "paidupCapital", "directorKyc", "workingCapitalRatio", "caFirmName", "caRegNo", "coreExpertise", "otherSectors", "teamSize", "yearsExperience", "certifications", "govtEmpanelments", "bankName", "bankBranch", "accountNumber", "ifscCode"];
      textFields.forEach((key) => { let val = form[key] || ""; if (["pan", "ifscCode", "cin", "gst", "msmeNo", "caRegNo"].includes(key)) val = val.toUpperCase(); fd.append(key, val); });
      fd.append("netWorth", JSON.stringify(form.netWorth)); fd.append("turnover", JSON.stringify(form.turnover));
      fd.append("pat", JSON.stringify(form.pat)); fd.append("cashFlow", JSON.stringify(form.cashFlow));
      fd.append("sectors", JSON.stringify(form.sectors)); fd.append("assignments", JSON.stringify(form.assignments));
      fd.append("declared", String(form.declared));
      ["panCopy", "incorporationCert", "gstCert", "nonBlacklisting", "mcaCompliance", "netWorthCert", "isoCert", "cancelledCheque", "workOrders"].forEach((key) => { if (files[key] instanceof File) fd.append(key, files[key], files[key].name); });
      (Array.isArray(files.financials) ? files.financials : []).forEach((f, i) => { if (f instanceof File) fd.append(`financials_${i}`, f, f.name); });

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) { setFormError("App configuration error: Supabase URL or key missing."); setShowModal(false); return; }

      let res;
      try { res = await fetch(`${supabaseUrl}/functions/v1/submit-ba-form`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }, body: fd }); }
      catch (networkErr) { setFormError(`Network error: ${networkErr.message}.`); setShowModal(false); return; }

      let result;
      try { result = await res.json(); } catch { setFormError(`Server error (HTTP ${res.status}).`); setShowModal(false); return; }

      if (!res.ok) {
        const serverMsg = result?.error || `Unexpected error (HTTP ${res.status})`;
        if (serverMsg.includes("Invalid application code") || serverMsg.includes("already been used") || serverMsg.includes("application code") || res.status === 429) { setCodeError(serverMsg); return; }
        setFormError(`Submission failed: ${serverMsg}`); setShowModal(false); window.scrollTo({ top: 0, behavior: "smooth" }); return;
      }
      setShowModal(false); setSubmitted(true); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { console.error("handleFinalSubmit unexpected error:", err); setFormError(`Unexpected error: ${err.message}`); setShowModal(false); }
    finally { setSubmitting(false); }
  }

  if (submitted) return <SuccessScreen />;

  return (
    <div className="bf-page">
      <FormNav onBack={() => navigate("/login")} />
      <main className="bf-content">
        <div className="bf-hero">
          <h1 className="bf-hero-title">Empanelment Application Form</h1>
          <p className="bf-hero-sub">Fill all sections accurately. Fields and documents marked <span className="bf-required">*</span> are mandatory. All document uploads must be PDF format.</p>
        </div>
        {formError && <Alert variant="danger" onClose={() => setFormError("")}>{formError}</Alert>}

        <FormSection tag="Section A" title="General Information">
          <Field label="Name of the Organization" required error={fieldErrors.orgName} full ref={setRef("orgName")}><TextInput name="orgName" value={form.orgName} onChange={handleChange} placeholder="Full legal name of your organization" error={fieldErrors.orgName} /></Field>
          <Field label="Type of Entity" required error={fieldErrors.entityType} ref={setRef("entityType")}><Select options={ENTITY_TYPES.map((t) => ({ value: t, label: t }))} value={form.entityType} onChange={(val) => handleChange({ target: { name: "entityType", value: val } })} placeholder="Select entity type" />{fieldErrors.entityType && <span className="bf-field-error" role="alert">{fieldErrors.entityType}</span>}</Field>
          {form.entityType === "Others" && <Field label="Specify Entity Type" required error={fieldErrors.entityTypeOther} full ref={setRef("entityTypeOther")}><TextInput name="entityTypeOther" value={form.entityTypeOther} onChange={handleChange} placeholder="Describe the entity type" error={fieldErrors.entityTypeOther} /></Field>}
          <Field label="Year of Establishment" required error={fieldErrors.yearEstablished} ref={setRef("yearEstablished")}><TextInput type="text" inputMode="numeric" name="yearEstablished" value={form.yearEstablished} onChange={(e) => handleChange({ target: { name: "yearEstablished", value: e.target.value.replace(/\D/g, "").slice(0, 4) } })} placeholder="e.g. 2010" maxLength={4} error={fieldErrors.yearEstablished} /></Field>
          <Field label="CIN" error={fieldErrors.cin}><TextInput name="cin" value={form.cin} onChange={(e) => handleChange({ target: { name: "cin", value: e.target.value.toUpperCase() } })} placeholder="U12345MH2010PLC123456" maxLength={21} error={fieldErrors.cin} /></Field>
          <Field label="Registered Office Address" required error={fieldErrors.regAddress} full ref={setRef("regAddress")}><TextArea name="regAddress" value={form.regAddress} onChange={handleChange} placeholder="Full registered office address with PIN code" error={fieldErrors.regAddress} rows={2} /></Field>
          <Field label="Corporate / Branch Office Address" full><TextArea name="branchAddress" value={form.branchAddress} onChange={handleChange} placeholder="Branch office address (if different)" rows={2} /></Field>
          <Field label="Contact Person Name" required error={fieldErrors.contactPerson} ref={setRef("contactPerson")}><TextInput name="contactPerson" value={form.contactPerson} onChange={handleChange} placeholder="Authorized contact person" error={fieldErrors.contactPerson} /></Field>
          <Field label="Designation" required error={fieldErrors.designation} ref={setRef("designation")}><TextInput name="designation" value={form.designation} onChange={handleChange} placeholder="e.g. Director, MD, CEO" error={fieldErrors.designation} /></Field>
          <Field label="Phone Number" required error={fieldErrors.phone} ref={setRef("phone")}><TextInput type="tel" name="phone" value={form.phone} onChange={(e) => handleChange({ target: { name: "phone", value: e.target.value.replace(/\D/g, "").slice(0, 10) } })} placeholder="9XXXXXXXXX" maxLength={10} error={fieldErrors.phone} /></Field>
          <Field label="Official Email ID" required error={fieldErrors.email} ref={setRef("email")}><TextInput type="email" name="email" value={form.email} onChange={handleChange} placeholder="official@company.com" error={fieldErrors.email} autoComplete="off" /></Field>
          <Field label="Website" error={fieldErrors.website} full><TextInput type="url" name="website" value={form.website} onChange={handleChange} placeholder="https://www.yourcompany.com" error={fieldErrors.website} /></Field>
        </FormSection>

        <FormSection tag="Section B" title="Legal and Regulatory Compliance">
          <Field label="PAN Number" required error={fieldErrors.pan} ref={setRef("pan")}><TextInput name="pan" value={form.pan} onChange={(e) => handleChange({ target: { name: "pan", value: e.target.value.toUpperCase() } })} placeholder="ABCDE1234F" maxLength={10} error={fieldErrors.pan} /></Field>
          <Field ref={setRef("doc_panCopy")} full><DocUpload slotKey="panCopy" label={DOC_SLOTS.panCopy.label} required={DOC_SLOTS.panCopy.required} file={files.panCopy} fileError={fileErrors.panCopy} onChange={handleFileChange} onClear={handleFileClear} /></Field>
          <Field label="GST Registration Number" error={fieldErrors.gst}><TextInput name="gst" value={form.gst} onChange={(e) => handleChange({ target: { name: "gst", value: e.target.value.toUpperCase() } })} placeholder="27AAPFU0939F1ZV" maxLength={15} error={fieldErrors.gst} /></Field>
          {form.gst?.trim() && <Field ref={setRef("doc_gstCert")} full><DocUpload slotKey="gstCert" label={DOC_SLOTS.gstCert.label} required file={files.gstCert} fileError={fileErrors.gstCert} onChange={handleFileChange} onClear={handleFileClear} /></Field>}
          <Field ref={setRef("doc_incorporationCert")} full><DocUpload slotKey="incorporationCert" label={DOC_SLOTS.incorporationCert.label} required={DOC_SLOTS.incorporationCert.required} file={files.incorporationCert} fileError={fileErrors.incorporationCert} onChange={handleFileChange} onClear={handleFileClear} /></Field>
          <Field label="MSME Registration No." error={fieldErrors.msmeNo}><TextInput name="msmeNo" value={form.msmeNo} onChange={(e) => handleChange({ target: { name: "msmeNo", value: e.target.value.toUpperCase() } })} placeholder="UDYAM-MH-12-0001234" error={fieldErrors.msmeNo} /></Field>
          <Field label="Compliance under Companies Act" required error={fieldErrors.companiesActStatus} ref={setRef("companiesActStatus")}><Select options={COMPANIES_ACT_OPTIONS.map((o) => ({ value: o, label: o }))} value={form.companiesActStatus} onChange={(val) => handleChange({ target: { name: "companiesActStatus", value: val } })} placeholder="Select" />{fieldErrors.companiesActStatus && <span className="bf-field-error" role="alert">{fieldErrors.companiesActStatus}</span>}</Field>
          <Field label="Status of the Company" required error={fieldErrors.companyStatus} ref={setRef("companyStatus")}><Select options={COMPANY_STATUS_OPTIONS.map((o) => ({ value: o, label: o }))} value={form.companyStatus} onChange={(val) => handleChange({ target: { name: "companyStatus", value: val } })} placeholder="Select" />{fieldErrors.companyStatus && <span className="bf-field-error" role="alert">{fieldErrors.companyStatus}</span>}</Field>
          <Field label="Date of Incorporation" required error={fieldErrors.dateOfIncorporation} ref={setRef("dateOfIncorporation")}><DateInput name="dateOfIncorporation" value={form.dateOfIncorporation} onChange={handleChange} max={new Date().toISOString().split("T")[0]} error={fieldErrors.dateOfIncorporation} /></Field>
          <Field label="Date of Last Balance Sheet Filed" error={fieldErrors.lastBSFiled}><DateInput name="lastBSFiled" value={form.lastBSFiled} onChange={handleChange} max={new Date().toISOString().split("T")[0]} error={fieldErrors.lastBSFiled} /></Field>
          <Field label="Authorised Capital (INR Lakhs)" error={fieldErrors.authorisedCapital}><input className={`input${fieldErrors.authorisedCapital ? " input-error" : ""}`} type="number" name="authorisedCapital" value={form.authorisedCapital} onChange={(e) => handleChange({ target: { name: "authorisedCapital", value: e.target.value } })} placeholder="e.g. 10.00" min="0" max="99999" step="0.01" /></Field>
          <Field label="Paid-up Capital (INR Lakhs)" error={fieldErrors.paidupCapital}><input className={`input${fieldErrors.paidupCapital ? " input-error" : ""}`} type="number" name="paidupCapital" value={form.paidupCapital} onChange={(e) => handleChange({ target: { name: "paidupCapital", value: e.target.value } })} placeholder="e.g. 5.00" min="0" max="99999" step="0.01" /></Field>
          <Field label="Director / Partner Details and KYC" full><TextArea name="directorKyc" value={form.directorKyc} onChange={handleChange} placeholder="Name, DIN, PAN of each Director / Partner (one per line)" rows={3} /></Field>
          <Field ref={setRef("doc_nonBlacklisting")} full><DocUpload slotKey="nonBlacklisting" label={DOC_SLOTS.nonBlacklisting.label} required={DOC_SLOTS.nonBlacklisting.required} file={files.nonBlacklisting} fileError={fileErrors.nonBlacklisting} onChange={handleFileChange} onClear={handleFileClear} /></Field>
          <Field full><DocUpload slotKey="mcaCompliance" label={DOC_SLOTS.mcaCompliance.label} required={DOC_SLOTS.mcaCompliance.required} file={files.mcaCompliance} fileError={fileErrors.mcaCompliance} onChange={handleFileChange} onClear={handleFileClear} /></Field>
        </FormSection>

        <FormSection tag="Section C" title="Financial Information" singleCol>
          <p className="bf-section-note">All financial figures must be in <strong>INR Lakhs</strong> as per audited statements (max 99,999 Lakhs per field). Negative values are not accepted.</p>
          {FINANCIAL_ROWS.map(({ key, label }) => (
            <div key={key} className="bf-fy-block">
              <p className="bf-fy-label">{label}</p>
              <div className="bf-fy-grid">
                {FY_YEARS.map((fy) => (
                  <Field key={fy.key} label={fy.label} error={fieldErrors[`${key}_${fy.key}`]}>
                    <input className={`input${fieldErrors[`${key}_${fy.key}`] ? " input-error" : ""}`} type="number" value={form[key][fy.key]} onChange={(e) => { const raw = e.target.value; if (raw === "" || raw === "-") { handleNested(key, fy.key, raw); return; } const [intPart, decPart] = raw.split("."); if (intPart && intPart.replace("-", "").length > 5) return; if (decPart !== undefined && decPart.length > 2) return; handleNested(key, fy.key, raw); }} placeholder="0.00" min="0" max="99999.99" step="0.01" />
                  </Field>
                ))}
              </div>
            </div>
          ))}
          <div className="bf-fy-block">
            <p className="bf-fy-label">Positive Cash Flow Confirmation</p>
            <div className="bf-fy-grid">
              {FY_YEARS.map((fy) => (
                <Field key={fy.key} label={fy.label}><Select options={CASH_FLOW_OPTIONS.map((o) => ({ value: o, label: o }))} value={form.cashFlow[fy.key]} onChange={(val) => handleNested("cashFlow", fy.key, val)} placeholder="Select" /></Field>
              ))}
            </div>
          </div>
          <Field label="Current Ratio / Working Capital Ratio (Latest Year)" error={fieldErrors.workingCapitalRatio}><TextInput name="workingCapitalRatio" value={form.workingCapitalRatio} onChange={handleChange} placeholder="e.g. 1.5 : 1" error={fieldErrors.workingCapitalRatio} /></Field>
          <Field label="CA Firm Name"><TextInput name="caFirmName" value={form.caFirmName} onChange={handleChange} placeholder="Name of the auditing CA firm" /></Field>
          <Field label="CA Firm Registration Number" error={fieldErrors.caRegNo}><TextInput name="caRegNo" value={form.caRegNo} onChange={(e) => handleChange({ target: { name: "caRegNo", value: e.target.value.toUpperCase() } })} placeholder="001234N" maxLength={7} error={fieldErrors.caRegNo} /></Field>
          <Field ref={setRef("doc_financials")} full><MultiDocUpload slotKey="financials" label={DOC_SLOTS.financials.label} required={DOC_SLOTS.financials.required} files={files.financials} fileErrors={fileErrors.financials} onChange={handleFileChange} onClear={handleFileClear} /></Field>
          <Field ref={setRef("doc_netWorthCert")} full><DocUpload slotKey="netWorthCert" label={DOC_SLOTS.netWorthCert.label} required={DOC_SLOTS.netWorthCert.required} file={files.netWorthCert} fileError={fileErrors.netWorthCert} onChange={handleFileChange} onClear={handleFileClear} /></Field>
        </FormSection>

        <FormSection tag="Section D" title="Technical Capability">
          <Field label="Core Areas of Expertise" required error={fieldErrors.coreExpertise} full ref={setRef("coreExpertise")}><TextArea name="coreExpertise" value={form.coreExpertise} onChange={handleChange} placeholder="Describe your organization's core areas of expertise in detail" error={fieldErrors.coreExpertise} rows={4} /></Field>
          <Field label="Relevant Sectors Served" required error={fieldErrors.sectors} full ref={setRef("sectors")}>
            <div className={`bf-sector-grid${fieldErrors.sectors ? " bf-sector-error" : ""}`}>
              {SECTORS.map((sector) => <Checkbox key={sector} label={sector} checked={form.sectors.includes(sector)} onChange={() => handleSector(sector)} className="bf-sector-item" />)}
            </div>
            {fieldErrors.sectors && <span className="bf-field-error" role="alert">{fieldErrors.sectors}</span>}
          </Field>
          {form.sectors.includes("Others") && <Field label="Specify Other Sectors" required error={fieldErrors.otherSectors} full ref={setRef("otherSectors")}><TextInput name="otherSectors" value={form.otherSectors} onChange={handleChange} placeholder="Describe other sectors served" error={fieldErrors.otherSectors} /></Field>}
          <Field label="Number of Employees / Team Size" required error={fieldErrors.teamSize} ref={setRef("teamSize")}><TextInput type="text" inputMode="numeric" name="teamSize" value={form.teamSize} onChange={(e) => handleChange({ target: { name: "teamSize", value: e.target.value.replace(/\D/g, "").slice(0, 6) } })} placeholder="e.g. 25" maxLength={6} error={fieldErrors.teamSize} /></Field>
          <Field label="Years of Relevant Experience" required error={fieldErrors.yearsExperience} ref={setRef("yearsExperience")}><TextInput type="text" inputMode="numeric" name="yearsExperience" value={form.yearsExperience} onChange={(e) => handleChange({ target: { name: "yearsExperience", value: e.target.value.replace(/\D/g, "").slice(0, 3) } })} placeholder="e.g. 10" maxLength={3} error={fieldErrors.yearsExperience} /></Field>
          <Field label="Major Assignments Completed (Last 5 Years)" full>
            <div className="bf-table-wrapper">
              <table className="bf-table">
                <thead><tr><th>Project Title</th><th>Client</th><th>Duration</th><th>Value (INR Lakhs)</th><th>Role Played</th></tr></thead>
                <tbody>
                  {form.assignments.map((row, i) => (
                    <tr key={i}>
                      <td><input className="bf-table-input" value={row.title} onChange={(e) => handleAssignment(i, "title", e.target.value)} placeholder="Project name" /></td>
                      <td><input className="bf-table-input" value={row.client} onChange={(e) => handleAssignment(i, "client", e.target.value)} placeholder="Client name" /></td>
                      <td><input className="bf-table-input" value={row.duration} onChange={(e) => handleAssignment(i, "duration", e.target.value)} placeholder="e.g. 12 months" /></td>
                      <td><input className="bf-table-input" type="number" value={row.value} onChange={(e) => handleAssignment(i, "value", e.target.value)} placeholder="0" min="0" /></td>
                      <td><input className="bf-table-input" value={row.role} onChange={(e) => handleAssignment(i, "role", e.target.value)} placeholder="Role" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Field>
          <Field full><DocUpload slotKey="workOrders" label={DOC_SLOTS.workOrders.label} required={DOC_SLOTS.workOrders.required} file={files.workOrders} fileError={fileErrors.workOrders} onChange={handleFileChange} onClear={handleFileClear} /></Field>
        </FormSection>

        <FormSection tag="Section E" title="Certifications and Affiliations">
          <Field label="ISO or Other Quality Certifications" full><TextArea name="certifications" value={form.certifications} onChange={handleChange} placeholder="e.g. ISO 9001:2015, Cert. No. XYZ123, Valid until Dec 2026" rows={3} /></Field>
          <Field ref={setRef("doc_isoCert")} full><DocUpload slotKey="isoCert" label={DOC_SLOTS.isoCert.label} required={DOC_SLOTS.isoCert.required} file={files.isoCert} fileError={fileErrors.isoCert} onChange={handleFileChange} onClear={handleFileClear} /></Field>
          <Field label="Empanelment with Other Government / Donor Agencies" full><TextArea name="govtEmpanelments" value={form.govtEmpanelments} onChange={handleChange} placeholder="e.g. NABARD — empanelled since 2020" rows={3} /></Field>
        </FormSection>

        <FormSection tag="Section F" title="Bank Details">
          <Field label="Bank Name" required error={fieldErrors.bankName} ref={setRef("bankName")}><TextInput name="bankName" value={form.bankName} onChange={handleChange} placeholder="e.g. State Bank of India" error={fieldErrors.bankName} /></Field>
          <Field label="Branch Name / Address" required error={fieldErrors.bankBranch} ref={setRef("bankBranch")}><TextInput name="bankBranch" value={form.bankBranch} onChange={handleChange} placeholder="Branch name and city" error={fieldErrors.bankBranch} /></Field>
          <Field label="Account Number" required error={fieldErrors.accountNumber} ref={setRef("accountNumber")}><TextInput name="accountNumber" value={form.accountNumber} onChange={handleChange} placeholder="Bank account number" error={fieldErrors.accountNumber} maxLength={18} /></Field>
          <Field label="IFSC Code" required error={fieldErrors.ifscCode} ref={setRef("ifscCode")}><TextInput name="ifscCode" value={form.ifscCode} onChange={(e) => handleChange({ target: { name: "ifscCode", value: e.target.value.toUpperCase() } })} placeholder="SBIN0001234" maxLength={11} error={fieldErrors.ifscCode} /></Field>
          <Field ref={setRef("doc_cancelledCheque")} full><DocUpload slotKey="cancelledCheque" label={DOC_SLOTS.cancelledCheque.label} required={DOC_SLOTS.cancelledCheque.required} file={files.cancelledCheque} fileError={fileErrors.cancelledCheque} onChange={handleFileChange} onClear={handleFileClear} /></Field>
        </FormSection>

        <FormSection tag="Declaration" tagVariant="warning" title="Declaration and Agreement" singleCol>
          <div className={`bf-declaration${fieldErrors.declared ? " bf-declaration-error" : ""}`} ref={setRef("declared")}>
            <p className="bf-declaration-text">I / We hereby declare that all information submitted in this application form is true and correct to the best of our knowledge and belief. We agree to abide by the terms and conditions of empanelment issued by AFC India Limited from time to time. We understand that any misrepresentation or suppression of facts may lead to disqualification or cancellation of empanelment without notice.</p>
            <Checkbox label="I / We agree to the above declaration and confirm that all information provided is accurate and complete." checked={form.declared} onChange={(e) => { setForm((prev) => ({ ...prev, declared: e.target.checked })); if (fieldErrors.declared) setFieldErrors((p) => ({ ...p, declared: "" })); }} />
            {fieldErrors.declared && <span className="bf-field-error" role="alert">{fieldErrors.declared}</span>}
          </div>
        </FormSection>

        <div className="bf-submit-row">
          {formError && <Alert variant="danger" onClose={() => setFormError("")}>{formError}</Alert>}
          <Button variant="primary" size="lg" onClick={handleSubmitClick} loading={submitting}>{submitting ? "Submitting…" : "Submit Registration Form"}</Button>
        </div>
      </main>

      {showModal && <AppCodeModal appCode={appCode} setAppCode={(code) => { setAppCode(code); setCodeError(""); }} codeError={codeError} submitting={submitting} onSubmit={handleFinalSubmit} onClose={() => setShowModal(false)} />}
    </div>
  );
}
