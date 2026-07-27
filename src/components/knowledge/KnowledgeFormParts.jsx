import { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabase";
import "../../styles/KnowledgeFormParts.css";

export const DOC_TYPES = ["Work Order", "Completion Certificate", "MoU", "Agreement", "Invoice", "Other"];

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra & Nagar Haveli and Daman & Diu",
  "Delhi", "Jammu & Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
  "Pan India / Multi-State",
];

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ── Custom Select ─────────────────────────────────────────────
export function CustomSelect({ value, onChange, options, placeholder = "Select…" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => (typeof o === "string" ? o : o.value) === value);
  const label = selected ? (typeof selected === "string" ? selected : selected.label) : null;

  return (
    <div ref={ref} className="csl-root">
      <button type="button" className={`csl-trigger${open ? " csl-trigger--open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span className={label ? "csl-value" : "csl-placeholder"}>{label || placeholder}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" className={`csl-chevron${open ? " csl-chevron--open" : ""}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="csl-dropdown">
          {options.map((opt) => {
            const v = typeof opt === "string" ? opt : opt.value;
            const l = typeof opt === "string" ? opt : opt.label;
            const isSelected = v === value;
            return (
              <button type="button" key={v} className={`csl-option${isSelected ? " csl-option--selected" : ""}`} onClick={() => { onChange(v); setOpen(false); }}>
                {l}
                {isSelected && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="13" height="13">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Custom Month Picker ───────────────────────────────────────
export function MonthPicker({ value, onChange, placeholder = "Select month" }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => (value ? parseInt(value.split("-")[0]) : new Date().getFullYear()));
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selYear = value ? parseInt(value.split("-")[0]) : null;
  const selMonth = value ? parseInt(value.split("-")[1]) - 1 : null;
  const displayLabel = value ? `${MONTHS_FULL[selMonth]} ${selYear}` : null;

  function selectMonth(mo) {
    const mm = String(mo + 1).padStart(2, "0");
    onChange(`${year}-${mm}`);
    setOpen(false);
  }

  function clear(e) {
    e.stopPropagation();
    onChange("");
  }

  return (
    <div ref={ref} className="mpc-root">
      <button type="button" className={`mpc-trigger${open ? " mpc-trigger--open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span className={displayLabel ? "mpc-value" : "mpc-placeholder"}>{displayLabel || placeholder}</span>
        <div className="mpc-trigger-right">
          {value && <span className="mpc-clear" onClick={clear} role="button" tabIndex={-1}>×</span>}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" className={`mpc-chevron${open ? " mpc-chevron--open" : ""}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="mpc-panel">
          <div className="mpc-year-row">
            <button type="button" className="mpc-year-btn" onClick={() => setYear((y) => y - 1)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <span className="mpc-year-label">{year}</span>
            <button type="button" className="mpc-year-btn" onClick={() => setYear((y) => y + 1)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="14" height="14"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>

          <div className="mpc-month-grid">
            {MONTHS_SHORT.map((mo, i) => {
              const isSelected = selYear === year && selMonth === i;
              const isToday = new Date().getFullYear() === year && new Date().getMonth() === i;
              return (
                <button type="button" key={mo} className={`mpc-month-btn${isSelected ? " mpc-month-btn--selected" : ""}${isToday && !isSelected ? " mpc-month-btn--today" : ""}`} onClick={() => selectMonth(i)}>
                  {mo}
                </button>
              );
            })}
          </div>

          <div className="mpc-footer">
            <button type="button" className="mpc-footer-btn" onClick={() => { onChange(""); setOpen(false); }}>Clear</button>
            <button type="button" className="mpc-footer-btn mpc-footer-btn--primary" onClick={() => { const now = new Date(); onChange(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`); setOpen(false); }}>
              This month
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Keyword Dropdown ──────────────────────────────────────────
export function KeywordDropdown({ allKeywords, selectedKeywords, onToggle, onAddNew, activeKeyword, onSetActive, onDescChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addingKw, setAddingKw] = useState(false);
  const [kwError, setKwError] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedCount = Object.keys(selectedKeywords).length;
  const filtered = allKeywords.filter((k) => k.name.toLowerCase().includes(search.toLowerCase()));
  const exactMatch = allKeywords.some((k) => k.name.toLowerCase() === search.trim().toLowerCase());
  const canAdd = search.trim().length > 0 && !exactMatch;

  async function handleAddNew() {
    const name = search.trim();
    if (!name || exactMatch) return;
    setAddingKw(true);
    setKwError("");
    const result = await onAddNew(name);
    if (result?.error) setKwError("Could not save keyword. Try again.");
    else setSearch("");
    setAddingKw(false);
  }

  return (
    <div ref={ref} className="efp-kw-root">
      <button type="button" className="efp-kw-trigger" onClick={() => setOpen((o) => !o)}>
        <div className="efp-kw-trigger-left">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
          <span className={selectedCount > 0 ? "efp-kw-trigger-label" : "efp-kw-trigger-placeholder"}>
            {selectedCount > 0 ? `${selectedCount} keyword${selectedCount > 1 ? "s" : ""} selected` : `Choose keywords (${allKeywords.length} available)`}
          </span>
        </div>
        <div className="efp-kw-trigger-right">
          {selectedCount > 0 && <span className="efp-kw-count">{selectedCount}</span>}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" className={`efp-kw-chevron${open ? " efp-kw-chevron--open" : ""}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="efp-kw-panel">
          <div className="efp-kw-search-wrap">
            <div className="efp-kw-search-inner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" className="efp-kw-search-icon"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input value={search} onChange={(e) => { setSearch(e.target.value); setKwError(""); }} onKeyDown={(e) => { if (e.key === "Enter" && canAdd) handleAddNew(); }} placeholder="Search or type to add new keyword…" autoFocus className="efp-kw-search-input" />
              {search && <button type="button" className="efp-kw-search-clear" onClick={() => { setSearch(""); setKwError(""); }}>×</button>}
            </div>
            {kwError && <div className="efp-kw-error">{kwError}</div>}
          </div>

          <div className="efp-kw-list">
            {canAdd && (
              <button type="button" onClick={handleAddNew} disabled={addingKw} className="efp-kw-add-btn">
                <span className="efp-kw-add-icon">+</span>
                <span className="efp-kw-add-label">{addingKw ? "Adding…" : `Add "${search.trim()}" as new keyword`}</span>
              </button>
            )}
            {filtered.length === 0 && !canAdd ? (
              <div className="efp-kw-empty">No keywords found</div>
            ) : (
              filtered.map((k) => {
                const isSelected = selectedKeywords[k.name] !== undefined;
                return (
                  <button type="button" key={k.id} onClick={() => onToggle(k.name)} className={`efp-kw-option${isSelected ? " efp-kw-option--selected" : ""}`}>
                    <div className={`efp-kw-checkbox${isSelected ? " efp-kw-checkbox--checked" : ""}`}>
                      {isSelected && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" width="10" height="10"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                    <span className={`efp-kw-option-label${isSelected ? " efp-kw-option-label--selected" : ""}`}>{k.name}</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="efp-kw-footer">
            {selectedCount === 0 ? "Select keywords that apply to this project" : `${selectedCount} selected — click a keyword below to add description`}
          </div>
        </div>
      )}

      {selectedCount > 0 && (
        <div className="efp-kw-selected-wrap">
          <div className="efp-kw-selected-label">Selected — click to add description</div>
          <div className="efp-kw-chips">
            {Object.keys(selectedKeywords).map((kw) => (
              <span key={kw} onClick={() => onSetActive(activeKeyword === kw ? null : kw)} className={`efp-kw-chip${activeKeyword === kw ? " efp-kw-chip--active" : ""}`}>
                {kw}<span className="efp-kw-chip-icon">{selectedKeywords[kw] ? "✎" : "⚠"}</span>
              </span>
            ))}
          </div>
          {activeKeyword && selectedKeywords[activeKeyword] !== undefined && (
            <div className="efp-kw-desc-box">
              <div className="efp-kw-desc-label">Description for: <span className="efp-kw-desc-name">{activeKeyword}</span></div>
              <textarea rows={3} placeholder={`How was ${activeKeyword} relevant to this project?`} value={selectedKeywords[activeKeyword]} onChange={(e) => onDescChange(activeKeyword, e.target.value)} autoFocus className="efp-kw-desc-textarea" />
              <button type="button" onClick={() => onSetActive(null)} className="efp-kw-desc-done">Done ✓</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const BUCKET = "project-documents";

// Opens a document that lives in the private bucket by generating a
// short-lived signed URL on demand — nothing here is ever a public URL.
export async function openProjectDocument(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) {
    alert("Could not open this document. Please try again.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

// ── Document Upload ───────────────────────────────────────────
// Two modes, since the storage RLS policy requires the object path to be
// prefixed with an EXISTING project's id:
//  - projectId provided (Edit Project): uploads immediately, same as the
//    old project's behavior.
//  - projectId is null (Add Project, before the row exists yet): stages
//    the file in memory; AddProjectPage uploads it right after the new
//    project is created and has an id to prefix the path with.
export function DocumentUpload({ projectId, documents, onAdd, onRemove }) {
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      if (projectId) {
        const path = `${projectId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
        if (upErr) throw upErr;
        const { data: inserted, error: insErr } = await supabase
          .from("project_documents")
          .insert({ project_id: projectId, name: docType, file_name: file.name, storage_path: path })
          .select()
          .single();
        if (insErr) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw insErr;
        }
        onAdd(inserted);
      } else {
        // Deferred — nothing uploaded yet, just held for the parent to
        // persist once the project exists.
        onAdd({ name: docType, file_name: file.name, file, pending: true });
      }
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError("Upload failed. Try again.");
      console.error(err);
    }
    setUploading(false);
  }

  async function handleRemove(i, doc) {
    if (doc.id) {
      await supabase.from("project_documents").delete().eq("id", doc.id);
      if (doc.storage_path) await supabase.storage.from(BUCKET).remove([doc.storage_path]);
    }
    onRemove(i, doc);
  }

  return (
    <div className="efp-doc-root">
      <div className="efp-doc-upload-row">
        <div className="efp-doc-field">
          <label className="efp-doc-label">Document Type</label>
          <CustomSelect value={docType} onChange={setDocType} options={DOC_TYPES} placeholder="Select type" />
        </div>
        <div className="efp-doc-file-wrap">
          <label className="efp-doc-label">Select File</label>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" className="efp-doc-file-input" onChange={(e) => { setFile(e.target.files[0] || null); setError(""); }} />
        </div>
        <button type="button" onClick={handleUpload} disabled={!file || uploading} className="efp-doc-upload-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>

      {error && <div className="efp-doc-error">{error}</div>}

      {documents.length > 0 && (
        <div className="efp-doc-list">
          {documents.map((doc, i) => (
            <div key={doc.id || i} className="efp-doc-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" className="efp-doc-item-icon"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              <div className="efp-doc-item-info">
                <div className="efp-doc-item-name">{doc.name}</div>
                <div className="efp-doc-item-file">{doc.file_name}{doc.pending ? " (will upload on save)" : ""}</div>
              </div>
              <button type="button" onClick={() => handleRemove(i, doc)} className="efp-doc-remove-btn">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
