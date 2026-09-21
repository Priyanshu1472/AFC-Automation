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
import { withActiveCounts, personOption } from "../../lib/personActivityCounts";
import { ROLE_LABELS } from "../../lib/roles";
import "../../styles/LeadForm.css";

const DELIVERY_TYPE_OPTIONS = Object.entries(DELIVERY_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const PORTAL_OPTIONS = PORTALS.map((p) => ({ value: p.name, label: p.name }));
const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s, label: s }));

// A sentinel, not a real BA id — same wording the Lead Approval Note
// already prints when assigned_ba_id is null (see leadApprovalPdf.ts),
// just now an explicit, selectable choice instead of only ever an implicit
// "leave it blank". Translated back to "" (i.e. no BA) before it's sent —
// create-lead/update-lead already treat an empty assigned_ba_id as unset.
const YET_TO_BE_DECIDED = "yet_to_be_decided";

function toOptions(users) {
  return (users || []).map((u) => ({ value: u.id, label: u.full_name }));
}

// Person Responsible only — Active leads/Active proposals next to each
// candidate's name, same as LeadDetailPage's po_assign panel.
function toPrOptions(users) {
  return (users || []).map(personOption);
}

// mode: "create" | "edit". `lead` is the existing row when editing/resubmitting.
export default function LeadForm({ mode = "create", lead = null, onSuccess }) {
  const navigate = useNavigate();
  const { profile, activeTeam } = useAuth();
  const { showToast } = useToast();
  const isEdit = mode === "edit";
  // Suo Moto has its own field set (Name of the Proposal / Date of
  // Submission / Client-Ministry-Department / Date of Presentation / Date
  // of follow-up) in place of the RFP/EOI-oriented fields (Portal, Bid No.,
  // State, Delivery Type) — lead_type (RFP/EOI) doesn't apply here at all.

  // The lead's working team: fixed to the existing lead's team on edit, or
  // the caller's own currently-active team on create — matches the real
  // form (no Team selector; Person Responsible/Reviewer/Recommending Authority
  // are always picked from this one team).
  const team = mode === "edit" ? lead?.team : (activeTeam ?? profile?.team);

  // An Associate Consultant/Project Assistant isn't allowed to name Person
  // Responsible/Reviewer/Recommending Authority themselves — their lead is
  // routed to the team's Project Officer instead (see create-lead's
  // isPoRouted / advance-lead-stage's "po_assign" action). Only applies on
  // create — an edit is always for an already-assigned lead.
  const isPoRouted = mode === "create" && ["associate_consultant", "project_assistant"].includes(profile?.role);

  // An overdue edit past pa_review/pa_action_required (see EditLeadPage's
  // canEdit / update-lead's allowReassignment) may only touch logistics
  // fields — Person Responsible/Reviewer/Recommending Authority/Business
  // Partner stay locked so a fix-the-date edit can never retroactively
  // change who a committee already acted on behalf of.
  const isLogisticsOnlyEdit = isEdit && !!lead && !["pa_review", "pa_action_required"].includes(lead.status);

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
    presentation_date: lead?.presentation_date || "",
    followup_date: lead?.followup_date || "",
    remark: lead?.remark || "",
    assigned_ba_id: lead?.assigned_ba_id || "",
    forwarded_to_id: "",
    // Not defaulted to the creator's own id — left blank so they have to
    // deliberately pick someone, same as Reviewer/Recommending Authority.
    person_responsible_id: isPoRouted ? "" : (lead?.person_responsible_id || ""),
    reviewer_id: lead?.reviewer_id || "",
    recommending_authority_id: lead?.recommending_authority_id || "",
  }));
  const isSuoMoto = form.source === "suo_moto";
  const [files, setFiles] = useState([]);
  const [personResponsibleOptions, setPersonResponsibleOptions] = useState([]);
  const [reviewerOptions, setReviewerOptions] = useState([]);
  const [recommendingAuthorityOptions, setRecommendingAuthorityOptions] = useState([]);
  const [baOptions, setBaOptions] = useState([]);
  const [forwardToOptions, setForwardToOptions] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const dupTimer = useRef(null);

  function set(field, value) {
    setForm((p) => ({ ...p, [field]: value }));
  }

  // Person Responsible / Reviewer are informational contacts, not the
  // workflow gate — the actual PMT authorization is org-wide committee
  // membership (checked server-side), not tied to this team, so Person
  // Responsible just lists this team's active members — excluding Business
  // Partners, who have a team (for the BP-org-name lookup below) but
  // aren't staff and can't be assigned either role, and excluding
  // AGM/SRM/DGM/General Manager, who are the Recommending
  // Authority/oversight tier, not hands-on PR work. Reviewer additionally
  // excludes Associate Consultant/Project Assistant — that tier is the one
  // that creates leads and needs a Project Officer to review them, not the
  // other way around, so they shouldn't be pickable as Reviewer themselves.
  // Recommending Authority is the one field still role-filtered — and IS
  // the actual workflow gate at the first review stage (see
  // advance-lead-stage's recommending_authority_review case): AGM, SRM
  // (same permissions as AGM throughout Lead Generation), or DGM on the
  // team.
  useEffect(() => {
    // These options only feed the PR/Reviewer/RA fields, which aren't
    // rendered for an isPoRouted creator or a logistics-only overdue edit —
    // nothing to fetch for them either way.
    if (!team || isPoRouted || isLogisticsOnlyEdit) return;
    supabase
      .from("afc_users")
      .select("id, full_name")
      .eq("team", team)
      .eq("is_active", true)
      .not("role", "in", "(business_associate,agm,srm,dgm,general_manager)")
      .order("full_name")
      .then(async ({ data }) => setPersonResponsibleOptions(toPrOptions(await withActiveCounts(data || []))));
    supabase
      .from("afc_users")
      .select("id, full_name")
      .eq("team", team)
      .eq("is_active", true)
      .not("role", "in", "(business_associate,associate_consultant,project_assistant)")
      .order("full_name")
      .then(({ data }) => setReviewerOptions(toOptions(data)));
    supabase
      .from("afc_users")
      .select("id, full_name")
      .eq("team", team)
      .eq("is_active", true)
      .in("role", ["agm", "srm", "dgm", "general_manager"])
      .order("full_name")
      .then(({ data }) => setRecommendingAuthorityOptions(toOptions(data)));
  }, [team, isPoRouted, isLogisticsOnlyEdit]);

  // Each team empanels its own BAs — scoped the same way as Person
  // Responsible/Reviewer above, not org-wide. Sourced via RPC (not a plain
  // afc_users select) so the dropdown shows the organisation name from the
  // Empanelment module's ba_registrations, not the BP account's contact-
  // person full_name — and because regular lead users have no direct RLS
  // access to empanelment_applications/ba_registrations.
  useEffect(() => {
    // Business Partner is also locked for a logistics-only overdue edit —
    // see isLogisticsOnlyEdit above.
    if (!team || isLogisticsOnlyEdit) return;
    supabase
      .rpc("get_team_business_associates", { p_team: team })
      .then(({ data }) => setBaOptions((data || []).map((u) => ({ value: u.id, label: u.org_name }))));
  }, [team, isLogisticsOnlyEdit]);

  // "Forward to:" — every user on the team, any role (see create-lead's
  // isPoRouted), searchable, with their role shown under their name so an
  // Associate Consultant/Project Assistant can tell people with the same
  // name apart.
  useEffect(() => {
    if (!team || !isPoRouted) return;
    supabase
      .rpc("get_team_members", { p_team: team })
      .then(({ data }) =>
        setForwardToOptions((data || []).map((u) => ({ value: u.user_id, label: u.full_name, hint: ROLE_LABELS[u.role] || u.role })))
      );
  }, [team, isPoRouted]);

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
      // Duplicate detection only ever compares one document — with multiple
      // files selected, the first is as good a signal as any for this
      // client-side nudge (the real, exhaustive check is server-side).
      const first = files[0];
      const { data } = await supabase.rpc("find_similar_leads", {
        p_title: form.title.trim(),
        p_team: team,
        p_bid_number: form.bid_number.trim() || null,
        p_document_name: first?.name || null,
        p_document_size: first?.size || null,
      });
      setDuplicates((data || []).filter((d) => d.id !== lead?.id));
    }, 400);
  }, [team, form.title, form.bid_number, files, lead?.id]);

  useEffect(() => {
    checkDuplicates();
    return () => dupTimer.current && clearTimeout(dupTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title, form.bid_number, files]);

  function validate() {
    const errs = {};
    if (!form.title.trim()) errs.title = "Name of Assignment is required.";
    if (!isPoRouted && !isLogisticsOnlyEdit) {
      if (!form.person_responsible_id) errs.person_responsible_id = "Person Responsible is required.";
      if (!form.reviewer_id) errs.reviewer_id = "Reviewer is required.";
      if (!form.recommending_authority_id) errs.recommending_authority_id = "Recommending Authority is required.";
    }
    if (isPoRouted && !form.forwarded_to_id) errs.forwarded_to_id = "Forward to is required.";
    // "Yet to be Decided" doesn't count as a real answer for a source that
    // requires an actually-named BP.
    const isBaUnset = !form.assigned_ba_id || form.assigned_ba_id === YET_TO_BE_DECIDED;
    if (form.source === "ba" && isBaUnset) errs.assigned_ba_id = "Business Partner is required for a BP Source lead.";
    if (isSuoMoto && isBaUnset) errs.assigned_ba_id = "Business Partner is required for a Suo Moto lead.";
    // Only on create — an edit appends to the lead's existing documents
    // rather than replacing them, so an empty picker there just means "no
    // new files this time", not "no documents at all".
    if (mode === "create" && !isSuoMoto && files.length === 0) {
      errs.documents = "At least one document is required.";
    }
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
      fd.set("lead_type", form.lead_type);
      fd.set("source", form.source);
      fd.set("portal_name", form.portal_name);
      fd.set("bid_number", form.bid_number);
      fd.set("client_name", form.client_name);
      fd.set("state", form.state);
      fd.set("submission_deadline", form.submission_deadline);
      fd.set("delivery_type", form.delivery_type);
      fd.set("presentation_date", form.presentation_date);
      fd.set("followup_date", form.followup_date);
      fd.set("remark", form.remark);
      fd.set("assigned_ba_id", form.assigned_ba_id === YET_TO_BE_DECIDED ? "" : form.assigned_ba_id);
      fd.set("person_responsible_id", form.person_responsible_id);
      fd.set("reviewer_id", form.reviewer_id);
      fd.set("recommending_authority_id", form.recommending_authority_id);
      fd.set("forwarded_to_id", form.forwarded_to_id);
      // Only consulted server-side for an isPoRouted creator, who has no
      // Person Responsible to derive a team from otherwise.
      if (mode === "create") fd.set("team", team || "");
      for (const f of files) fd.append("document", f, f.name);

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
              {/* lead_type (RFP/EOI) doesn't apply to a Suo Moto lead — hidden
                  once Suo Moto is selected; form.lead_type just stays at its
                  default "rfp" underneath, unused. */}
              {!isSuoMoto && (
                <div className="lf-toggle-group">
                  <button
                    type="button"
                    className={`lf-toggle${form.lead_type === "rfp" ? " lf-toggle-active" : ""}`}
                    disabled={submitting || isEdit}
                    onClick={() => set("lead_type", "rfp")}
                  >
                    RFP
                  </button>
                  <button
                    type="button"
                    className={`lf-toggle${form.lead_type === "eoi" ? " lf-toggle-active" : ""}`}
                    disabled={submitting || isEdit}
                    onClick={() => set("lead_type", "eoi")}
                  >
                    EOI
                  </button>
                </div>
              )}
              <div className="lf-toggle-group">
                <button
                  type="button"
                  className={`lf-toggle${form.source === "in_house" ? " lf-toggle-active" : ""}`}
                  disabled={submitting || isEdit}
                  onClick={() => set("source", "in_house")}
                >
                  In-House
                </button>
                <button
                  type="button"
                  className={`lf-toggle${form.source === "ba" ? " lf-toggle-active" : ""}`}
                  disabled={submitting || isEdit}
                  onClick={() => set("source", "ba")}
                >
                  BP Source
                </button>
                <button
                  type="button"
                  className={`lf-toggle${form.source === "suo_moto" ? " lf-toggle-active" : ""}`}
                  disabled={submitting || isEdit}
                  onClick={() => set("source", "suo_moto")}
                >
                  Suo Moto
                </button>
              </div>
            </div>
            {isEdit && <span className="field-hint">Locked once a lead is created — cannot be changed.</span>}
          </div>

          <Input
            label={isSuoMoto ? "Name of the Proposal" : "Name of Assignment"}
            required
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder={isSuoMoto ? "e.g. Suo Moto proposal for Smart City Project, Nagpur" : "e.g. Preparation of DPR for Smart City Project, Nagpur"}
            error={errors.title}
            disabled={submitting}
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

          {!isSuoMoto && (
            <>
              <div className="field">
                <label className="field-label">Portal / Source of Information</label>
                <Select
                  options={PORTAL_OPTIONS}
                  value={form.portal_name}
                  onChange={(v) => set("portal_name", v)}
                  placeholder="Select a portal"
                  disabled={submitting}
                  searchable
                />
              </div>

              <Input
                label={bidNumberLabel}
                value={form.bid_number}
                onChange={(e) => set("bid_number", e.target.value)}
                placeholder={`Enter ${bidNumberLabel}`}
                hint="Used for duplicate detection."
                disabled={submitting}
              />
            </>
          )}

          {isSuoMoto ? (
            <>
              <div className="grid-2">
                <Input
                  label="Client / Ministry / Department"
                  value={form.client_name}
                  onChange={(e) => set("client_name", e.target.value)}
                  placeholder="Enter client / ministry / department"
                  disabled={submitting}
                />
                <div className="field">
                  <label className="field-label">Date of Submission</label>
                  <DatePickerCalendar
                    value={form.submission_deadline}
                    onChange={(v) => set("submission_deadline", v)}
                    placeholder="Select submission date"
                  />
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label className="field-label">Date of Presentation</label>
                  <DatePickerCalendar
                    value={form.presentation_date}
                    onChange={(v) => set("presentation_date", v)}
                    placeholder="Select presentation date"
                  />
                </div>
                <div className="field">
                  <label className="field-label">Date of follow-up</label>
                  <DatePickerCalendar
                    value={form.followup_date}
                    onChange={(v) => set("followup_date", v)}
                    placeholder="Select follow-up date"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
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
                    searchable
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
            </>
          )}

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
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Assignment" />
        <Card.Body>
          {isLogisticsOnlyEdit ? (
            <Alert variant="info">
              This lead's submission deadline had passed. You can update the date and other details below — Person
              Responsible, Reviewer, Recommending Authority, and Business Partner are locked once a lead has moved past
              PR review.
            </Alert>
          ) : (
            <>
              <div className="field">
                <label className="field-label">
                  {form.source === "ba" || isSuoMoto ? (
                    <>Business Partner <span className="required">*</span></>
                  ) : (
                    "Business Partner (optional)"
                  )}
                </label>
                <Select
                  options={[{ value: YET_TO_BE_DECIDED, label: "Yet to be Decided" }, ...baOptions]}
                  value={form.assigned_ba_id}
                  onChange={(v) => set("assigned_ba_id", v)}
                  placeholder="— Select BP —"
                  error={errors.assigned_ba_id}
                  disabled={submitting}
                  searchable
                />
                {errors.assigned_ba_id && <span className="field-error">{errors.assigned_ba_id}</span>}
                {baOptions.length === 0 && (
                  <span className="field-hint">No MD-approved (empanelled) Business Partner found on your team yet.</span>
                )}
              </div>

              {isPoRouted ? (
                <>
                  <div className="field">
                    <label className="field-label">
                      Forward to: <span className="required">*</span>
                    </label>
                    <Select
                      options={forwardToOptions}
                      value={form.forwarded_to_id}
                      onChange={(v) => set("forwarded_to_id", v)}
                      placeholder="— Select a person on your team —"
                      error={errors.forwarded_to_id}
                      disabled={submitting}
                      searchable
                    />
                    {errors.forwarded_to_id && <span className="field-error">{errors.forwarded_to_id}</span>}
                  </div>
                  <Alert variant="info">
                    As an Associate Consultant/Project Assistant, you can't assign Person Responsible, Reviewer, or Recommending
                    Authority directly. Once saved, this lead will be forwarded to the person you select above to make these
                    assignments.
                  </Alert>
                </>
              ) : (
                <>
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
                        searchable
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
                        searchable
                      />
                      {errors.reviewer_id && <span className="field-error">{errors.reviewer_id}</span>}
                      {reviewerOptions.length === 0 && <span className="field-hint">No active members found on your team.</span>}
                    </div>
                  </div>

                  <div className="field">
                    <label className="field-label">
                      Recommending Authority <span className="required">*</span>
                    </label>
                    <Select
                      options={recommendingAuthorityOptions}
                      value={form.recommending_authority_id}
                      onChange={(v) => set("recommending_authority_id", v)}
                      placeholder="— Select —"
                      error={errors.recommending_authority_id}
                      disabled={submitting}
                    />
                    {errors.recommending_authority_id && <span className="field-error">{errors.recommending_authority_id}</span>}
                    {recommendingAuthorityOptions.length === 0 && (
                      <span className="field-hint">No AGM, SRM, or DGM found on your team.</span>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Documents" />
        <Card.Body>
          <div className="field">
            <label className="field-label">
              {isSuoMoto ? (
                "Supporting Document(s) (optional)"
              ) : (
                <>RFP / Tender Document(s) {mode === "create" && <span className="required">*</span>}</>
              )}
            </label>
            <label className="lf-file-drop">
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                multiple
                onChange={(e) => {
                  const picked = Array.from(e.target.files || []);
                  // Appends to whatever's already selected rather than
                  // replacing it — picking files from the OS dialog twice
                  // (e.g. one at a time) accumulates instead of losing the
                  // first round. Re-picking the same input value fires
                  // onChange again even for an unchanged selection, so
                  // clear it after reading.
                  if (picked.length) setFiles((prev) => [...prev, ...picked]);
                  e.target.value = "";
                }}
                disabled={submitting}
              />
              {files.length ? `${files.length} file${files.length > 1 ? "s" : ""} selected — click to add more` : "Choose files (PDF / DOC)"}
            </label>
            {files.length > 0 && (
              <ul className="lf-file-list">
                {files.map((f, i) => (
                  <li key={`${f.name}-${f.size}-${i}`} className="lf-file-item">
                    <span className="lf-file-item-name" title={f.name}>{f.name}</span>
                    <button
                      type="button"
                      className="lf-file-remove"
                      aria-label={`Remove ${f.name}`}
                      disabled={submitting}
                      onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {errors.documents && <span className="field-error">{errors.documents}</span>}
            <span className="field-hint">Used for duplicate detection (first file's name + size) — any match shows up under Name of Assignment above.</span>
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
