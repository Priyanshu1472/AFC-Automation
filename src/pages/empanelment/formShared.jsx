import { useState, useRef, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../../images/Logo.png";
import Button from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Card from "../../components/ui/Card";
import "../../styles/BaFormPage.css";

// Shared building blocks for the public BA pages (BaFormPage,
// EmpanelmentCorrectionPage, ApplicationStatusPage) so all three render the
// same widgets/layout instead of drifting apart.

export const ENTITY_TYPES = ["Proprietorship", "Partnership", "Private Ltd.", "Public Ltd.", "LLP", "Others"];
export const COMPANY_STATUS_OPTIONS = ["Active", "Dormant", "Under Liquidation"];
export const COMPANIES_ACT_OPTIONS = ["Compliant", "Not Applicable", "In Process"];
export const CASH_FLOW_OPTIONS = ["Yes", "No"];

export const MAX_FINANCIAL_LAKHS = 99999;

export function validateFinancialValue(v) {
  if (v === "" || v === undefined || v === null) return "";
  const n = Number(v);
  if (isNaN(n)) return "Enter a valid number.";
  if (n < 0) return "Value must be 0 or positive.";
  if (n > MAX_FINANCIAL_LAKHS) return `Maximum is ${MAX_FINANCIAL_LAKHS.toLocaleString("en-IN")}.99 Lakhs.`;
  const str = String(v);
  if (str.includes(".") && str.split(".")[1].length > 2) return "Maximum 2 decimal places allowed.";
  return "";
}

export function validatePdfFile(file) {
  if (!file) return "";
  if (file.type !== "application/pdf") return "Only PDF files are allowed.";
  if (file.size > 10 * 1024 * 1024) return "File size must be under 10 MB.";
  return "";
}

export function sanitize(val) {
  if (typeof val !== "string") return val;
  // eslint-disable-next-line no-control-regex
  return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trimStart();
}

// ── Icons ─────────────────────────────────────────────────────
export function ArrowLeftIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 5-7 7 7 7" /></svg>; }
export function UploadIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>; }
export function CheckCircleIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>; }
export function XSmallIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
export function AlertCircleIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>; }

// ── FormNav ───────────────────────────────────────────────────
export function FormNav({ subtitle, onBack }) {
  const navigate = useNavigate();
  return (
    <nav className="bf-nav" aria-label="Form navigation">
      <div className="bf-nav-brand">
        <img src={logo} height={40} alt="AFC India Limited" className="bf-nav-logo" />
        <div className="bf-nav-brand-text">
          <span className="bf-nav-title">AFC India Limited</span>
          <span className="bf-nav-sub">{subtitle}</span>
        </div>
      </div>
      <div className="bf-nav-actions">
        <Button variant="secondary" size="sm" icon={<ArrowLeftIcon />} onClick={onBack || (() => navigate("/login"))}>Back to Login</Button>
      </div>
    </nav>
  );
}

export function FormSection({ tag, tagVariant = "brand", title, children, singleCol = false }) {
  return (
    <Card>
      <Card.Header title={title} action={<Badge variant={tagVariant}>{tag}</Badge>} />
      <Card.Body className={`bf-section-body${singleCol ? " bf-single-col" : ""}`}>{children}</Card.Body>
    </Card>
  );
}

export const Field = forwardRef(function Field({ label, required, error, hint, children, full = false, className = "" }, ref) {
  return (
    <div ref={ref} className={`bf-field${full ? " bf-field-full" : ""}${className ? ` ${className}` : ""}`}>
      {label && <label className="bf-label">{label}{required && <span className="bf-required" aria-hidden="true"> *</span>}</label>}
      {children}
      {hint && !error && <span className="bf-field-hint">{hint}</span>}
      {error && <span className="bf-field-error" role="alert">{error}</span>}
    </div>
  );
});

export function TextInput({ error, onChange, ...props }) {
  return <input className={`input${error ? " input-error" : ""}`} onChange={(e) => onChange({ target: { name: e.target.name, value: sanitize(e.target.value) } })} {...props} />;
}

export function TextArea({ error, rows = 3, onChange, ...props }) {
  return <textarea className={`input${error ? " input-error" : ""}`} rows={rows} onChange={(e) => onChange({ target: { name: e.target.name, value: sanitize(e.target.value) } })} {...props} />;
}

export function Checkbox({ label, checked, onChange, className = "" }) {
  return <label className={`bf-checkbox ${className}`.trim()}><input type="checkbox" checked={checked} onChange={onChange} /><span>{label}</span></label>;
}

export function DateInput({ name, value, onChange, max, error }) {
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

export function DocUpload({ slotKey, label, required, file, fileError, onChange, onClear }) {
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

export function MultiDocUpload({ slotKey, label, required, files, fileErrors, onChange, onClear }) {
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
