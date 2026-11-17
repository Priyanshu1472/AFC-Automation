// Full-page editor for a proposal's PBG Note (proposal_pbg_notes) — opened
// from the PBG Note card once the proposal is awarded. Same shape as the
// Bid Payment Requisition Note editor: the form on the left, a live
// preview of the page on the right.
//
// The PBG amount pre-fills from the Lead Approval Note
// (approval_note_data.financial_requirement.pbg) and the consultancy fee
// from the proposal's proposed value — both stay editable. Every paragraph
// is pre-filled from those amounts and the details below, and stays
// auto-composed until the user types into it; after that their text sticks
// ("Use suggested text" brings the auto version back).
//
// Which wording the note uses is decided by the amounts, not chosen here:
// an EMD adjusted towards the PBG (EMD track "Converted to PBG") gives
// "remaining PBG = PBG − EMD"; otherwise (refunded / on completion / no
// EMD) the full PBG is submitted.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { ROLE_LABELS } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Select from "../../components/ui/Select";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import BackButton from "../../components/ui/BackButton";
import { formatINR } from "../../lib/monitoring";
import {
  INSTRUMENT_OPTIONS, PARAGRAPHS, composePbgDefaults, emdAdjustedFor, emdContextOf, parseAmount, pbgCalculationRows,
} from "../../lib/pbgNoteDraft";
import "../../styles/LeadForm.css";
import "../../styles/ProposalPreparationPage.css";

const EMPTY_FIELDS = { loa_reference: "", loa_date: "", pbg_percent: "", instrument: "FDR", in_favour_of: "", payable_at: "", validity: "" };

function fmtNoteDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function suggestedPercent(pbg, fee) {
  const p = Number(pbg);
  const f = Number(fee);
  if (!(p > 0) || !(f > 0)) return "";
  return String(Math.round((p / f) * 10000) / 100);
}

export default function PbgNoteEditPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState("");
  const [ctx, setCtx] = useState(null); // { proposalId, lead, emdAmount, track }

  const [pbgAmount, setPbgAmount] = useState("");
  const [consultancyFee, setConsultancyFee] = useState("");
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [pctDirty, setPctDirty] = useState(false);
  const [subject, setSubject] = useState("");
  const [paragraphs, setParagraphs] = useState({});
  const [enclosures, setEnclosures] = useState("");
  // Which texts the user has typed into (kept from then on) — anything not
  // dirty follows the auto-composed wording as the amounts/details change.
  const [dirty, setDirty] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setBlocked("");

    const { data: lead } = await supabase
      .from("leads")
      .select(
        "id, lead_number, title, client_name, person_responsible_id, reviewer_id, recommending_authority_id, approval_note_data, " +
        "ba:assigned_ba_id(full_name), pr:person_responsible_id(full_name, role), aa:recommending_authority_id(full_name, role)",
      )
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) { setBlocked("Lead not found."); setLoading(false); return; }

    const { data: proposal } = await supabase
      .from("proposal_preparations")
      .select("id, client_response, proposed_value")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (!proposal) { setBlocked("This proposal hasn't been opened yet."); setLoading(false); return; }
    if (proposal.client_response !== "awarded") { setBlocked("A PBG Note is only raised once the proposal is awarded."); setLoading(false); return; }

    const [{ data: additional }, { data: feeNote }, { data: tracking }, { data: note }] = await Promise.all([
      supabase.from("proposal_additional_responsibles").select("user_id").eq("proposal_id", proposal.id),
      supabase.from("fee_notes").select("emd_amount").eq("proposal_id", proposal.id).eq("status", "approved").maybeSingle(),
      supabase.from("proposal_emd_tracking").select("track").eq("proposal_id", proposal.id).maybeSingle(),
      supabase.from("proposal_pbg_notes").select("*").eq("proposal_id", proposal.id).maybeSingle(),
    ]);

    const canEdit =
      ["md", "admin"].includes(profile?.role) ||
      [lead.person_responsible_id, lead.reviewer_id, lead.recommending_authority_id].includes(profile?.id) ||
      (additional || []).some((a) => a.user_id === profile?.id);
    if (!canEdit) { setBlocked("Only this lead's Person Responsible, Reviewer or Recommending Authority can prepare the PBG Note."); setLoading(false); return; }
    if (note && note.status !== "draft") { setBlocked("The PBG Note has been forwarded and can't be edited right now."); setLoading(false); return; }

    const content = note?.content || {};
    setPbgAmount(note ? String(note.pbg_amount) : parseAmount(lead.approval_note_data?.financial_requirement?.pbg));
    setConsultancyFee(note ? (note.consultancy_fee != null ? String(note.consultancy_fee) : "") : parseAmount(proposal.proposed_value));
    setFields({ ...EMPTY_FIELDS, ...(content.fields || {}) });
    setPctDirty(!!content.fields?.pbg_percent);
    setSubject(content.subject || "");
    setParagraphs(content.paragraphs || {});
    setEnclosures(content.enclosures || "");
    setDirty(content.dirty || {});

    setCtx({
      proposalId: proposal.id,
      lead,
      emdAmount: Number(feeNote?.emd_amount) > 0 ? Number(feeNote.emd_amount) : 0,
      track: tracking?.track || null,
    });
    setLoading(false);
    // profile only gates the page client-side (the edge function re-checks)
    // and is settled before this page is reachable — not a dependency, so a
    // new profile object never refetches over the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const pbgNum = Number(pbgAmount) || 0;
  const feeNum = Number(consultancyFee) || 0;
  const emdAmount = ctx?.emdAmount || 0;
  const emdAdjusted = ctx ? emdAdjustedFor(ctx.track, emdAmount, pbgNum) : 0;
  const emdContext = emdContextOf(ctx?.track, emdAmount, emdAdjusted);

  // PBG % follows PBG ÷ consultancy fee until the user types their own.
  useEffect(() => {
    if (pctDirty) return;
    setFields((f) => ({ ...f, pbg_percent: suggestedPercent(pbgAmount, consultancyFee) }));
  }, [pbgAmount, consultancyFee, pctDirty]);

  const suggested = useMemo(() => {
    if (!ctx) return null;
    return composePbgDefaults({
      lead: ctx.lead,
      bpName: ctx.lead.ba?.full_name || null,
      fields,
      pbgAmount: pbgNum,
      consultancyFee: feeNum || null,
      emdAmount,
      emdAdjusted,
      emdContext,
    });
  }, [ctx, fields, pbgNum, feeNum, emdAmount, emdAdjusted, emdContext]);

  // Keep every untouched text in step with the suggestion.
  useEffect(() => {
    if (!suggested) return;
    if (!dirty.subject) setSubject(suggested.subject);
    if (!dirty.enclosures) setEnclosures(suggested.enclosures);
    setParagraphs((prev) => {
      const next = { ...prev };
      for (const p of PARAGRAPHS) if (!dirty[p.key]) next[p.key] = suggested.paragraphs[p.key];
      return next;
    });
  }, [suggested, dirty]);

  function editText(key, value, setter) {
    setter(value);
    setDirty((d) => ({ ...d, [key]: value.trim() !== "" }));
  }

  function resetText(key) {
    setDirty((d) => ({ ...d, [key]: false }));
  }

  const rows = pbgCalculationRows({
    pbgAmount: pbgNum,
    consultancyFee: feeNum || null,
    pbgPercent: fields.pbg_percent || null,
    emdAmount,
    emdAdjusted,
    emdContext,
  });

  async function handleSave(e) {
    e.preventDefault();
    if (!(pbgNum > 0)) { setError("Enter the PBG amount."); return; }
    if (consultancyFee && !(feeNum > 0)) { setError("Enter a valid consultancy fee, or leave it blank."); return; }
    setSaving(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("proposal-pbg-note", {
        body: {
          proposal_id: ctx.proposalId,
          action: "save",
          pbg_amount: pbgNum,
          consultancy_fee: feeNum || null,
          content: { subject, paragraphs, enclosures, fields, dirty: { ...dirty, pbg_percent: pctDirty } },
        },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to save the PBG Note.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to save the PBG Note."); return; }

      try {
        const { data: pdfData, error: pdfError } = await supabase.functions.invoke("preview-pbg-note", { body: { proposal_id: ctx.proposalId } });
        if (pdfError || !pdfData?.success) {
          showToast(await extractFunctionErrorMessage(pdfError, pdfData?.error || "Saved, but couldn't open the PDF — use View on the proposal."), "warning");
        } else {
          const bytes = Uint8Array.from(atob(pdfData.pdf_base64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          window.open(url, "_blank", "noopener,noreferrer");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      } catch (pdfErr) {
        showToast(pdfErr.message || "Saved, but couldn't open the PDF.", "warning");
      }
      showToast("PBG Note saved. Upload the proof and forward it from the proposal page.", "success");
      navigate(`/proposals/${leadId}`);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoader text="Loading…" />;

  const setField = (key, value) => setFields((f) => ({ ...f, [key]: value }));
  const lead = ctx?.lead;

  // A plain render function, not a nested component — a component defined
  // in here would remount on every keystroke and drop the textarea's focus.
  function renderParagraph(p) {
    return (
      <div className="field" key={p.key}>
        <div className="pp-pbg-para-head">
          <label className="field-label" htmlFor={`pbg-p-${p.key}`}>{p.label}</label>
          {dirty[p.key] && (
            <button type="button" className="pp-link-btn" onClick={() => resetText(p.key)}>Use suggested text</button>
          )}
        </div>
        <textarea
          id={`pbg-p-${p.key}`}
          className="input"
          rows={p.key === "delivery" ? 5 : p.key === "closing" || p.key === "partner" ? 2 : 4}
          value={paragraphs[p.key] || ""}
          onChange={(e) => editText(p.key, e.target.value, (v) => setParagraphs((prev) => ({ ...prev, [p.key]: v })))}
          disabled={saving}
          placeholder={p.key === "partner" ? "Leave blank if no Business Partner is involved" : ""}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <BackButton to={`/proposals/${leadId}`} label="Back to Proposal" />
          <div className="page-title-row">
            <div>
              <h1>PBG Note</h1>
              {lead && <p>{lead.lead_number} — {lead.title}</p>}
            </div>
          </div>
        </div>

        {blocked && <Alert variant="danger">{blocked}</Alert>}

        {!blocked && ctx && (
          <form onSubmit={handleSave} noValidate className="pp-fnp-layout">
            <div className="pp-fnp-form">
              {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

              <Card>
                <Card.Header title="Amounts" />
                <Card.Body>
                  <div className="pp-pbg-grid">
                    <div className="field">
                      <label className="field-label" htmlFor="pbg-amount">PBG amount (₹) <span className="required">*</span></label>
                      <input id="pbg-amount" className="input" type="number" min="0" step="0.01" inputMode="decimal" value={pbgAmount} onChange={(e) => setPbgAmount(e.target.value)} disabled={saving} placeholder="From the Lead Approval Note, if filled there" />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="pbg-fee">Consultancy fees (₹, incl. GST)</label>
                      <input id="pbg-fee" className="input" type="number" min="0" step="0.01" inputMode="decimal" value={consultancyFee} onChange={(e) => setConsultancyFee(e.target.value)} disabled={saving} />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="pbg-pct">PBG % of fees</label>
                      <input id="pbg-pct" className="input" value={fields.pbg_percent} onChange={(e) => { setPctDirty(e.target.value.trim() !== ""); setField("pbg_percent", e.target.value); }} disabled={saving} placeholder="e.g. 10" />
                    </div>
                  </div>
                  <div className="pp-pbg-emd-summary">
                    <span>EMD deposited: <strong>{formatINR(emdAmount)}</strong></span>
                    <span>
                      {emdContext === "converted"
                        ? <>EMD adjusted: <strong>{formatINR(Math.min(emdAdjusted, pbgNum))}</strong> · Remaining PBG to submit: <strong>{formatINR(Math.max(0, pbgNum - emdAdjusted))}</strong></>
                        : <>Nothing adjusted ({emdContext === "refunded" ? "EMD refunded" : emdContext === "on_completion" ? "EMD refunded on completion" : emdContext === "none" ? "no EMD" : "EMD not converted"}) · Full PBG to submit: <strong>{formatINR(pbgNum)}</strong></>}
                    </span>
                  </div>
                </Card.Body>
              </Card>

              <Card>
                <Card.Header title="LoA & instrument" />
                <Card.Body>
                  <div className="pp-pbg-grid pp-pbg-grid-2">
                    <div className="field">
                      <label className="field-label" htmlFor="pbg-loa">LoA reference</label>
                      <input id="pbg-loa" className="input" value={fields.loa_reference} onChange={(e) => setField("loa_reference", e.target.value)} disabled={saving} placeholder="e.g. LoA no. Patrank-245/3-19 Dehradun" />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="pbg-loa-date">LoA date</label>
                      <input id="pbg-loa-date" className="input" type="date" value={fields.loa_date} onChange={(e) => setField("loa_date", e.target.value)} disabled={saving} />
                    </div>
                    <div className="field">
                      <label className="field-label">PBG in the form of</label>
                      <Select value={fields.instrument} onChange={(v) => setField("instrument", v)} options={INSTRUMENT_OPTIONS} disabled={saving} />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="pbg-validity">Validity</label>
                      <input id="pbg-validity" className="input" value={fields.validity} onChange={(e) => setField("validity", e.target.value)} disabled={saving} placeholder="e.g. 6 months" />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="pbg-favour">In favour of</label>
                      <input id="pbg-favour" className="input" value={fields.in_favour_of} onChange={(e) => setField("in_favour_of", e.target.value)} disabled={saving} placeholder="e.g. Divisional Forest Officer, Dehradun" />
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="pbg-payable">Payable at</label>
                      <input id="pbg-payable" className="input" value={fields.payable_at} onChange={(e) => setField("payable_at", e.target.value)} disabled={saving} placeholder="e.g. Dehradun" />
                    </div>
                  </div>
                </Card.Body>
              </Card>

              <Card>
                <Card.Header title="Wording" />
                <Card.Body>
                  <p className="pp-pbg-hint">Every paragraph is filled in for you and updates as you change the details above. Edit any of them freely — your text is kept.</p>
                  <div className="field">
                    <div className="pp-pbg-para-head">
                      <label className="field-label" htmlFor="pbg-subject">Subject</label>
                      {dirty.subject && <button type="button" className="pp-link-btn" onClick={() => resetText("subject")}>Use suggested text</button>}
                    </div>
                    <textarea id="pbg-subject" className="input" rows={2} value={subject} onChange={(e) => editText("subject", e.target.value, setSubject)} disabled={saving} />
                  </div>
                  {PARAGRAPHS.filter((p) => !p.after).map(renderParagraph)}
                  <p className="pp-pbg-hint">The calculation table is built from the amounts and sits here.</p>
                  {PARAGRAPHS.filter((p) => p.after).map(renderParagraph)}
                  <div className="field">
                    <div className="pp-pbg-para-head">
                      <label className="field-label" htmlFor="pbg-encl">Enclosures (one per line)</label>
                      {dirty.enclosures && <button type="button" className="pp-link-btn" onClick={() => resetText("enclosures")}>Use suggested text</button>}
                    </div>
                    <textarea id="pbg-encl" className="input" rows={3} value={enclosures} onChange={(e) => editText("enclosures", e.target.value, setEnclosures)} disabled={saving} />
                  </div>
                </Card.Body>
              </Card>

              <div className="lf-actions">
                <Button type="submit" variant="primary" loading={saving} disabled={saving}>Save &amp; View PDF</Button>
                <Button type="button" variant="secondary" disabled={saving} onClick={() => navigate(`/proposals/${leadId}`)}>Cancel</Button>
              </div>
            </div>

            <div className="pp-fnp-preview-col">
              <div className="pp-fnp-preview-head">
                <span className="pp-fnp-preview-title">As it will print</span>
                <span className="pp-fnp-live-tag"><span className="pp-fnp-live-dot" />Live</span>
              </div>
              <div className="pp-fnp-page">
                <p className="pp-fnp-note-date">{fmtNoteDate(new Date())}</p>
                {subject.trim() && <p className="pp-fnp-body"><b>{subject}</b></p>}
                {PARAGRAPHS.filter((p) => !p.after && (paragraphs[p.key] || "").trim()).map((p) => (
                  <p key={p.key} className="pp-fnp-body">{paragraphs[p.key]}</p>
                ))}
                {pbgNum > 0 ? (
                  <table className="pp-pbg-preview-table">
                    <thead><tr><th>S. No.</th><th>Particulars</th><th>Amount (Rs.)</th></tr></thead>
                    <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td></tr>)}</tbody>
                  </table>
                ) : (
                  <p className="pp-fnp-placeholder">Enter the PBG amount to see the calculation.</p>
                )}
                {PARAGRAPHS.filter((p) => p.after && (paragraphs[p.key] || "").trim()).map((p) => (
                  <p key={p.key} className="pp-fnp-body pp-pbg-preserve">{paragraphs[p.key]}</p>
                ))}
                <div className="pp-fnp-sig">
                  <div className="pp-fnp-sig-name">{lead.pr?.full_name || "—"}</div>
                  <div className="pp-fnp-sig-role">{ROLE_LABELS[lead.pr?.role] || "Person Responsible"}</div>
                </div>
                <div className="pp-fnp-sig">
                  <div className="pp-fnp-sig-name">{lead.aa?.full_name || "—"}</div>
                  <div className="pp-fnp-sig-role">{ROLE_LABELS[lead.aa?.role] || "Recommending Authority"}</div>
                </div>
                <div className="pp-fnp-sig-grid">
                  <span />
                  <div className="pp-fnp-sig pp-fnp-sig-md">
                    <div className="pp-fnp-sig-name">—</div>
                    <div className="pp-fnp-sig-role">Managing Director</div>
                  </div>
                </div>
                {enclosures.trim() && (
                  <div className="pp-fnp-encl">
                    <b>Encl:</b>
                    {enclosures.split("\n").filter((l) => l.trim()).map((l, i) => <div key={i} className="pp-pbg-encl-line">{l.trim()}</div>)}
                  </div>
                )}
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
