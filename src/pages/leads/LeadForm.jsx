import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { PORTALS, INDIAN_STATES } from "../../lib/portal_table";
import Card from "../../components/ui/Card";
import Input from "../../components/ui/Input";
import Select from "../../components/ui/Select";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import DatePickerCalendar from "../../components/ui/DatePickerCalendar";
import { DELIVERY_TYPE_LABELS } from "../../components/leads/leadStatus";
import "../../styles/LeadForm.css";

const DELIVERY_TYPE_OPTIONS = Object.entries(DELIVERY_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const PORTAL_OPTIONS = PORTALS.map((p) => ({ value: p.name, label: p.name }));
const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s, label: s }));

function toOptions(users) {
  return (users || []).map((u) => ({ value: u.id, label: u.full_name }));
}

// mode: "create" | "edit". `lead` is the existing row when editing/resubmitting.
export default function LeadForm({ mode = "create", lead = null, onSuccess }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const isEdit = mode === "edit";

  // The lead's working team: fixed to the existing lead's team on edit, or
  // the caller's own team on create — matches the real form (no Team
  // selector; Person Responsible/Reviewer/Approval Authority are always
  // picked from this one team).
  const team = mode === "edit" ? lead?.team : profile?.team;

  const [form, setForm] = useState(() => ({
    lead_type: lead?.lead_type || "rfp",
    source: lead?.source || "in_house",
    title: lead?.title || "",
    portal_name: lead?.portal_name || "",
    bid_number: lead?.bid_number || "",
    client_name: lead?.client_name || "",
    state: lead?.state || "",
    submission_deadline: lead?.submission_deadline || "",
    delivery_type: lead?.delivery_type || "",
    remark: lead?.remark || "",
    assigned_ba_id: lead?.assigned_ba_id || "",
    person_responsible_id: lead?.person_responsible_id || profile?.id || "",
    reviewer_id: lead?.reviewer_id || "",
    approval_authority_id: lead?.approval_authority_id || "",
  }));
  // Only required when resubmitting a lead the MD sent back — explains what
  // changed since the MD's decline. Logged onto the activity timeline only,
  // never onto the lead itself, so it never ends up in the generated PDF.
  const isMdReturn = isEdit && lead?.declined_from_status === "md_review";
  const [resubmitComment, setResubmitComment] = useState("");
  const [file, setFile] = useState(null);
  const [personResponsibleOptions, setPersonResponsibleOptions] = useState([]);
  const [reviewerOptions, setReviewerOptions] = useState([]);
  const [approvalAuthorityOptions, setApprovalAuthorityOptions] = useState([]);
  const [baOptions, setBaOptions] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const dupTimer = useRef(null);

  function set(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  // Person Responsible / Reviewer are informational contacts, not the
  // workflow gate — the actual PMT/PMT Extended authorization is org-wide
  // committee membership (checked server-side), not tied to this team, so
  // both dropdowns just list this team's active members — excluding
  // Business Associates, who have a team (for the BA-org-name lookup below)
  // but aren't staff and can't be assigned either role. Approval Authority
  // is the one field still role-filtered: AGM, SRM (same permissions as AGM
  // throughout Lead Generation), or DGM on the team.
  useEffect(() => {
    if (!team) return;
    supabase
      .from("afc_users")
      .select("id, full_name")
      .eq("team", team)
      .eq("is_active", true)
      .neq("role", "business_associate")
      .order("full_name")
      .then(({ data }) => {
        const options = toOptions(data);
        setPersonResponsibleOptions(options);
        setReviewerOptions(options);
      });
    supabase
      .from("afc_users")
      .select("id, full_name")
      .eq("team", team)
      .eq("is_active", true)
      .in("role", ["agm", "srm", "dgm"])
      .order("full_name")
      .then(({ data }) => setApprovalAuthorityOptions(toOptions(data)));
  }, [team]);

  // Each team empanels its own BAs — scoped the same way as Person
  // Responsible/Reviewer above, not org-wide. Sourced via RPC (not a plain
  // afc_users select) so the dropdown shows the organisation name from the
  // Empanelment module's ba_registrations, not the BA account's contact-
  // person full_name — and because regular lead users have no direct RLS
  // access to empanelment_applications/ba_registrations.
  useEffect(() => {
    if (!team) return;
    supabase
      .rpc("get_team_business_associates", { p_team: team })
      .then(({ data }) => setBaOptions((data || []).map((u) => ({ value: u.id, label: u.org_name }))));
  }, [team]);

  const selectedPortal = PORTALS.find((p) => p.name === form.portal_name);
  const bidNumberLabel = selectedPortal ? selectedPortal.identifier : "Bid / Reference No.";

  // Live duplicate hint — debounced, client-side preview only (the real
  // score is computed server-side by find_similar_leads; this is just a UX
  // nudge near Name of Assignment, never a hard block).
  const checkDuplicates = useCallback(() => {
    if (dupTimer.current) clearTimeout(dupTimer.current);
    dupTimer.current = setTimeout(async () => {
      if (!team || !form.title.trim()) {
        setDuplicates([]);
        return;
      }
      const { data } = await supabase.rpc("find_similar_leads", {
        p_title: form.title.trim(),
        p_team: team,
        p_bid_number: form.bid_number.trim() || null,
        p_document_name: file?.name || null,
        p_document_size: file?.size || null,
      });
      setDuplicates((data || []).filter((d) => d.id !== lead?.id));
    }, 400);
  }, [team, form.title, form.bid_number, file, lead?.id]);

  useEffect(() => {
    checkDuplicates();
    return () => dupTimer.current && clearTimeout(dupTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title, form.bid_number, file]);

  function validate() {
    const errs = {};
    if (!form.title.trim()) errs.title = "Name of Assignment is required.";
    if (!form.person_responsible_id) errs.person_responsible_id = "Person Responsible is required.";
    if (!form.reviewer_id) errs.reviewer_id = "Reviewer is required.";
    if (!form.approval_authority_id) errs.approval_authority_id = "Approval Authority is required.";
    if (isMdReturn && !resubmitComment.trim()) errs.resubmit_comment = "Add a remark explaining the changes before resubmitting to the MD.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      const fd = new FormData();
      if (mode === "edit") fd.set("lead_id", lead.id);
      fd.set("title", form.title.trim());
      fd.set("lead_type", "rfp");
      fd.set("source", "in_house");
      fd.set("portal_name", form.portal_name);
      fd.set("bid_number", form.bid_number);
      fd.set("client_name", form.client_name);
      fd.set("state", form.state);
      fd.set("submission_deadline", form.submission_deadline);
      fd.set("delivery_type", form.delivery_type);
      fd.set("remark", form.remark);
      fd.set("assigned_ba_id", form.assigned_ba_id);
      fd.set("person_responsible_id", form.person_responsible_id);
      fd.set("reviewer_id", form.reviewer_id);
      fd.set("approval_authority_id", form.approval_authority_id);
      if (isMdReturn) fd.set("resubmit_comment", resubmitComment.trim());
      if (file) fd.set("document", file, file.name);

      const { data, error } = await supabase.functions.invoke(mode === "create" ? "create-lead" : "update-lead", { body: fd });
      if (error) {
        showToast(await extractFunctionErrorMessage(error, "Failed to save lead."), "danger");
        return;
      }
      if (!data?.success) {
        showToast(data?.error || "Failed to save lead.", "danger");
        return;
      }
      showToast(isEdit ? "Lead updated." : "Lead created.", "success");
      if (onSuccess) onSuccess(data);
      else navigate(`/leads/${data.id || lead?.id}`);
    } catch (err) {
      showToast(err.message || "Something went wrong.", "danger");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card>
        <Card.Header title="Lead Details" />
        <Card.Body>
          <div className="field">
            <label className="field-label">Lead Type &amp; Source</label>
            <div className="lf-toggle-row">
              <div className="lf-toggle-group">
                <button type="button" className="lf-toggle lf-toggle-active">RFP</button>
                <button type="button" className="lf-toggle" disabled title="EOI leads aren't available yet">EOI</button>
              </div>
              <div className="lf-toggle-group">
                <button type="button" className="lf-toggle lf-toggle-active">In-House</button>
                <button type="button" className="lf-toggle" disabled title="BA Source leads aren't available yet">BA Source</button>
              </div>
            </div>
          </div>

          <Input
            label="Name of Assignment"
            required
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Preparation of DPR for Smart City Project, Nagpur"
            error={errors.title}
            disabled={submitting || isEdit}
            hint={isEdit ? "Locked once a lead is created — cannot be changed." : undefined}
          />

          {duplicates.length > 0 && (
            <Alert variant="warning" title="Possible duplicate lead(s)">
              {duplicates.map((d) => (
                <p key={d.id} className="lf-dup-row">
                  <strong>{d.lead_number}</strong> — {d.title} ({d.status.replace(/_/g, " ")})
                  {d.match_reason && <span className="lf-dup-reason"> · {d.match_reason}</span>}
                </p>
              ))}
            </Alert>
          )}

          <div className="field">
            <label className="field-label">Portal / Source of Information</label>
            <Select
              options={PORTAL_OPTIONS}
              value={form.portal_name}
              onChange={(v) => set("portal_name", v)}
              placeholder="Select a portal"
              disabled={submitting || isEdit}
            />
            {isEdit && <span className="field-hint">Locked once a lead is created — cannot be changed.</span>}
          </div>

          <Input
            label={bidNumberLabel}
            value={form.bid_number}
            onChange={(e) => set("bid_number", e.target.value)}
            placeholder={`Enter ${bidNumberLabel}`}
            hint={isEdit ? "Locked once a lead is created — cannot be changed." : "Used for duplicate detection."}
            disabled={submitting || isEdit}
          />

          <div className="grid-2">
            <Input
              label="Client / Department"
              value={form.client_name}
              onChange={(e) => set("client_name", e.target.value)}
              placeholder="Enter client / department"
              disabled={submitting}
            />
            <div className="field">
              <label className="field-label">State</label>
              <Select
                options={STATE_OPTIONS}
                value={form.state}
                onChange={(v) => set("state", v)}
                placeholder="Select state"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label className="field-label">Last Date of Submission</label>
              <DatePickerCalendar
                value={form.submission_deadline}
                onChange={(v) => set("submission_deadline", v)}
                placeholder="Select submission date"
              />
            </div>
            <div className="field">
              <label className="field-label">Delivery Type</label>
              <Select
                options={DELIVERY_TYPE_OPTIONS}
                value={form.delivery_type}
                onChange={(v) => set("delivery_type", v)}
                placeholder="Select"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="field">
            <label className="field-label">Remark</label>
            <textarea
              className="input"
              rows={3}
              value={form.remark}
              onChange={(e) => set("remark", e.target.value)}
              placeholder="Any additional remarks..."
              disabled={submitting}
            />
          </div>

          {isMdReturn && (
            <div className="field">
              <label className="field-label">
                Remarks for MD <span className="required">*</span>
              </label>
              <textarea
                className="input"
                rows={3}
                value={resubmitComment}
                onChange={(e) => setResubmitComment(e.target.value)}
                placeholder="Explain what changed since the MD's decline..."
                disabled={submitting}
              />
              {errors.resubmit_comment && <span className="field-error">{errors.resubmit_comment}</span>}
              <span className="field-hint">Shown to the MD alongside the resubmitted lead — not included in the generated PDF.</span>
            </div>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Assignment" />
        <Card.Body>
          <div className="field">
            <label className="field-label">Business Associate (optional)</label>
            <Select
              options={baOptions}
              value={form.assigned_ba_id}
              onChange={(v) => set("assigned_ba_id", v)}
              placeholder={baOptions.length ? "— Select BA —" : "No empanelled BA found on your team."}
              disabled={submitting}
            />
            {baOptions.length === 0 && (
              <span className="field-hint">No MD-approved (empanelled) Business Associate found on your team yet.</span>
            )}
          </div>

          <div className="grid-2">
            <div className="field">
              <label className="field-label">
                Person Responsible <span className="required">*</span>
              </label>
              <Select
                options={personResponsibleOptions}
                value={form.person_responsible_id}
                onChange={(v) => set("person_responsible_id", v)}
                placeholder="— Select —"
                error={errors.person_responsible_id}
                disabled={submitting}
              />
              {errors.person_responsible_id && <span className="field-error">{errors.person_responsible_id}</span>}
            </div>
            <div className="field">
              <label className="field-label">
                Reviewer <span className="required">*</span>
              </label>
              <Select
                options={reviewerOptions}
                value={form.reviewer_id}
                onChange={(v) => set("reviewer_id", v)}
                placeholder="— Select —"
                error={errors.reviewer_id}
                disabled={submitting}
              />
              {errors.reviewer_id && <span className="field-error">{errors.reviewer_id}</span>}
              {reviewerOptions.length === 0 && <span className="field-hint">No active members found on your team.</span>}
            </div>
          </div>

          <div className="field">
            <label className="field-label">
              Approval Authority <span className="required">*</span>
            </label>
            <Select
              options={approvalAuthorityOptions}
              value={form.approval_authority_id}
              onChange={(v) => set("approval_authority_id", v)}
              placeholder="— Select —"
              error={errors.approval_authority_id}
              disabled={submitting}
            />
            {errors.approval_authority_id && <span className="field-error">{errors.approval_authority_id}</span>}
            {approvalAuthorityOptions.length === 0 && (
              <span className="field-hint">No AGM, SRM, or DGM found on your team.</span>
            )}
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Documents" />
        <Card.Body>
          <div className="field">
            <label className="field-label">RFP / Tender Document</label>
            <label className="lf-file-drop">
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                disabled={submitting}
              />
              {file ? file.name : "Choose file (PDF / DOC)"}
            </label>
            <span className="field-hint">Used for duplicate detection (file name + size) — any match shows up under Name of Assignment above.</span>
          </div>
        </Card.Body>
      </Card>

      <div className="lf-actions">
        <Button type="submit" variant="primary" loading={submitting} disabled={submitting}>
          Save Lead
        </Button>
        <Button type="button" variant="secondary" disabled={submitting} onClick={() => navigate(-1)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
