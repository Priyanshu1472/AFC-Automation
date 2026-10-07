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
import BusinessPartnerPicker from "../../components/leads/BusinessPartnerPicker";
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

const SOURCE_CHOICES = [
  { value: "in_house", label: "In-House", desc: "Identified by our own team" },
  { value: "ba", label: "BP Source", desc: "Brought in by a Business Partner" },
  { value: "suo_moto", label: "Suo Moto", desc: "Our own unsolicited proposal" },
];
const ACCEPTED_DOC_RE = /\.(pdf|docx?)$/i;

function fmtSize(bytes) {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function fmtSummaryDate(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function UploadIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>;
}
function FileIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
}

function SectionHead({ step, title, subtitle }) {
  return (
    <div className="lf-section-head">
      <span className="lf-step" aria-hidden="true">{step}</span>
      <div>
        <h2 className="lf-section-title">{title}</h2>
        {subtitle && <p className="lf-section-sub">{subtitle}</p>}
      </div>
    </div>
  );
}

function toOptions(users) {
  return (users || []).map((u) => ({ value: u.id, label: u.full_name }));
}

// Person Responsible only — Active leads/Active proposals next to each
// candidate's name, same as LeadDetailPage's po_assign panel.
function toPrOptions(users) {
  return (users || []).map(personOption);
}

// mode: "create" | "edit". `lead` is the existing row when editing/resubmitting.
// header: the page title/back link, rendered at the top of the left column
// (not above both columns) so the summary sidebar starts at the very top and
// never shifts while scrolling.
export default function LeadForm({ mode = "create", lead = null, onSuccess, header = null }) {
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
  const [dragOver, setDragOver] = useState(false);
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

  // Every empanelled BP in the organisation, from any team — whoever adds a
  // lead sees the full list (the lead's own team's BPs first). Sourced via
  // RPC (not a plain afc_users select) so the list shows the organisation
  // name from the Empanelment module's ba_registrations, not the BP
  // account's contact-person full_name — and because regular lead users
  // have no direct RLS access to empanelment_applications/ba_registrations.
  useEffect(() => {
    // Business Partner is also locked for a logistics-only overdue edit —
    // see isLogisticsOnlyEdit above.
    if (isLogisticsOnlyEdit) return;
    supabase
      .rpc("get_empanelled_business_partners")
      .then(({ data }) => setBaOptions((data || []).map((u) => ({ value: u.id, label: u.org_name, team: u.team }))));
  }, [isLogisticsOnlyEdit]);

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

  function addFiles(list) {
    // Appends to whatever's already selected rather than replacing it —
    // picking/dropping files twice accumulates instead of losing the first
    // round. Dropped files are filtered to the same types the picker allows.
    const picked = Array.from(list || []).filter((f) => ACCEPTED_DOC_RE.test(f.name));
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
  }

  const labelOf = (opts, v) => opts.find((o) => o.value === v)?.label;
  const baSummary = form.assigned_ba_id === YET_TO_BE_DECIDED ? "Yet to be Decided" : labelOf(baOptions, form.assigned_ba_id);
  const summaryRows = [
    { label: "Type", value: isSuoMoto ? "Suo Moto" : `${form.lead_type.toUpperCase()} · ${SOURCE_CHOICES.find((s) => s.value === form.source)?.label}` },
    { label: isSuoMoto ? "Proposal" : "Assignment", value: form.title.trim() },
    { label: "Client", value: form.client_name.trim() },
    { label: isSuoMoto ? "Submission" : "Last Date", value: fmtSummaryDate(form.submission_deadline) },
    ...(isLogisticsOnlyEdit ? [] : [{ label: "Business Partner", value: baSummary }]),
    ...(isLogisticsOnlyEdit ? [] : isPoRouted
      ? [{ label: "Forward to", value: labelOf(forwardToOptions, form.forwarded_to_id) }]
      : [
          { label: "Person Responsible", value: labelOf(personResponsibleOptions, form.person_responsible_id) },
          { label: "Reviewer", value: labelOf(reviewerOptions, form.reviewer_id) },
          { label: "Recommending Authority", value: labelOf(recommendingAuthorityOptions, form.recommending_authority_id) },
        ]),
    { label: "Documents", value: files.length ? `${files.length} file${files.length > 1 ? "s" : ""}${isEdit ? " to add" : ""}` : "" },
  ];
  const errorCount = Object.keys(errors).length;
  const baRequired = form.source === "ba" || isSuoMoto;

  return (
    <form onSubmit={handleSubmit} noValidate className="lf-layout">
      <div className="lf-main">
        {header}
        <Card className="lf-section">
          <SectionHead step={1} title="Lead Type & Source" subtitle={isEdit ? "Locked once a lead is created — cannot be changed." : "What kind of opportunity is this, and where did it come from?"} />
          <Card.Body className="lf-body">
            <div className="lf-source-grid" role="radiogroup" aria-label="Lead source">
              {SOURCE_CHOICES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={form.source === s.value}
                  className={`lf-source${form.source === s.value ? " lf-source-active" : ""}`}
                  disabled={submitting || isEdit}
                  onClick={() => set("source", s.value)}
                >
                  <span className="lf-source-radio" aria-hidden="true" />
                  <span className="lf-source-text">
                    <span className="lf-source-label">{s.label}</span>
                    <span className="lf-source-desc">{s.desc}</span>
                  </span>
                </button>
              ))}
            </div>

            {/* lead_type (RFP/EOI) doesn't apply to a Suo Moto lead — hidden
                once Suo Moto is selected; form.lead_type just stays at its
                default "rfp" underneath, unused. */}
            {!isSuoMoto && (
              <div className="field">
                <span className="field-label">Document Type</span>
                <div className="lf-seg" role="radiogroup" aria-label="Lead type">
                  {[["rfp", "RFP", "Request for Proposal"], ["eoi", "EOI", "Expression of Interest"]].map(([v, short, long]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={form.lead_type === v}
                      className={`lf-seg-btn${form.lead_type === v ? " lf-seg-active" : ""}`}
                      disabled={submitting || isEdit}
                      onClick={() => set("lead_type", v)}
                    >
                      <strong>{short}</strong>
                      <span>{long}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card.Body>
        </Card>

        <Card className="lf-section">
          <SectionHead step={2} title={isSuoMoto ? "Proposal Details" : "Assignment Details"} subtitle="The basics — name, client, portal and key dates." />
          <Card.Body className="lf-body">
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
              <div className="grid-2 lf-grid">
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
              </div>
            )}

            {isSuoMoto ? (
              <>
                <div className="grid-2 lf-grid">
                  <Input
                    label="Client / Ministry / Department"
                    value={form.client_name}
                    onChange={(e) => set("client_name", e.target.value)}
                    placeholder="Enter client / ministry / department"
                    disabled={submitting}
                  />
                  <div className="field">
                    <label className="field-label">Date of Submission</label>
                    <DatePickerCalendar value={form.submission_deadline} onChange={(v) => set("submission_deadline", v)} placeholder="Select submission date" />
                  </div>
                </div>
                <div className="grid-2 lf-grid">
                  <div className="field">
                    <label className="field-label">Date of Presentation</label>
                    <DatePickerCalendar value={form.presentation_date} onChange={(v) => set("presentation_date", v)} placeholder="Select presentation date" />
                  </div>
                  <div className="field">
                    <label className="field-label">Date of follow-up</label>
                    <DatePickerCalendar value={form.followup_date} onChange={(v) => set("followup_date", v)} placeholder="Select follow-up date" />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid-2 lf-grid">
                  <Input
                    label="Client / Department"
                    value={form.client_name}
                    onChange={(e) => set("client_name", e.target.value)}
                    placeholder="Enter client / department"
                    disabled={submitting}
                  />
                  <div className="field">
                    <label className="field-label">State</label>
                    <Select options={STATE_OPTIONS} value={form.state} onChange={(v) => set("state", v)} placeholder="Select state" disabled={submitting} searchable />
                  </div>
                </div>
                <div className="grid-2 lf-grid">
                  <div className="field">
                    <label className="field-label">Last Date of Submission</label>
                    <DatePickerCalendar value={form.submission_deadline} onChange={(v) => set("submission_deadline", v)} placeholder="Select submission date" />
                  </div>
                  <div className="field">
                    <label className="field-label">Delivery Type</label>
                    <Select options={DELIVERY_TYPE_OPTIONS} value={form.delivery_type} onChange={(v) => set("delivery_type", v)} placeholder="Select" disabled={submitting} />
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

        <Card className="lf-section">
          <SectionHead step={3} title="Business Partner" subtitle={isLogisticsOnlyEdit ? "Locked once a lead has moved past PR review." : "Every empanelled BP across all teams — search to find one."} />
          <Card.Body className="lf-body">
            {isLogisticsOnlyEdit ? (
              <Alert variant="info">
                This lead's submission deadline had passed. You can update the date and other details — Person Responsible,
                Reviewer, Recommending Authority, and Business Partner are locked once a lead has moved past PR review.
              </Alert>
            ) : (
              <div className="field">
                <span className="field-label">
                  {baRequired ? <>Business Partner <span className="required">*</span></> : "Business Partner (optional)"}
                </span>
                <BusinessPartnerPicker
                  options={baOptions}
                  value={form.assigned_ba_id}
                  onChange={(v) => set("assigned_ba_id", v)}
                  ownTeam={team}
                  tbdValue={YET_TO_BE_DECIDED}
                  error={errors.assigned_ba_id}
                  disabled={submitting}
                />
                {errors.assigned_ba_id && <span className="field-error">{errors.assigned_ba_id}</span>}
              </div>
            )}
          </Card.Body>
        </Card>

        {!isLogisticsOnlyEdit && (
          <Card className="lf-section">
            <SectionHead step={4} title="Assignment" subtitle={isPoRouted ? "Who should assign the team for this lead?" : "Who works on, reviews and recommends this lead."} />
            <Card.Body className="lf-body">
              {isPoRouted ? (
                <>
                  <div className="field">
                    <label className="field-label">
                      Forward to <span className="required">*</span>
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
                  <div className="grid-2 lf-grid">
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
            </Card.Body>
          </Card>
        )}

        <Card className="lf-section">
          <SectionHead
            step={isLogisticsOnlyEdit ? 4 : 5}
            title="Documents"
            subtitle={isSuoMoto ? "Optional supporting documents." : "The RFP / tender documents. The first file is also used to spot duplicates."}
          />
          <Card.Body className="lf-body">
            <div className="field">
              <span className="field-label">
                {isSuoMoto ? "Supporting Document(s) (optional)" : <>RFP / Tender Document(s) {mode === "create" && <span className="required">*</span>}</>}
              </span>
              <label
                className={`lf-drop${dragOver ? " lf-drop-over" : ""}${errors.documents ? " lf-drop-error" : ""}`}
                onDragOver={(e) => { e.preventDefault(); if (!submitting) setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!submitting) addFiles(e.dataTransfer.files); }}
              >
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  multiple
                  onChange={(e) => {
                    addFiles(e.target.files);
                    // Re-picking the same input value fires onChange again
                    // even for an unchanged selection, so clear it after reading.
                    e.target.value = "";
                  }}
                  disabled={submitting}
                />
                <span className="lf-drop-icon" aria-hidden="true"><UploadIcon /></span>
                <span className="lf-drop-title">{files.length ? "Add more files" : "Drop files here or click to browse"}</span>
                <span className="lf-drop-sub">PDF, DOC or DOCX · you can select several at once</span>
              </label>
              {files.length > 0 && (
                <ul className="lf-file-list">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${f.size}-${i}`} className="lf-file-item">
                      <span className="lf-file-icon" aria-hidden="true"><FileIcon /></span>
                      <span className="lf-file-meta">
                        <span className="lf-file-item-name" title={f.name}>{f.name}</span>
                        <span className="lf-file-size">{fmtSize(f.size)}{i === 0 && !isSuoMoto ? " · used for duplicate check" : ""}</span>
                      </span>
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
            </div>
          </Card.Body>
        </Card>
      </div>

      <aside className="lf-side">
        <div className="card lf-summary">
          <div className="lf-summary-head">
            <h2>{isEdit ? "Edit Summary" : "Lead Summary"}</h2>
            <p>Updates as you fill the form.</p>
          </div>
          <dl className="lf-summary-list">
            {summaryRows.map((r) => (
              <div key={r.label} className="lf-summary-row">
                <dt>{r.label}</dt>
                <dd className={r.value ? "" : "lf-summary-empty"} title={r.value || undefined}>{r.value || "Not set"}</dd>
              </div>
            ))}
          </dl>
          {errorCount > 0 && (
            <p className="lf-summary-errors" role="alert">
              {errorCount} field{errorCount > 1 ? "s need" : " needs"} attention — see the highlighted section{errorCount > 1 ? "s" : ""}.
            </p>
          )}
          <div className="lf-summary-actions">
            <Button type="submit" variant="primary" block loading={submitting} disabled={submitting}>
              {isEdit ? "Save Changes" : "Save Lead"}
            </Button>
            <Button type="button" variant="secondary" block disabled={submitting} onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </div>
      </aside>
    </form>
  );
}
