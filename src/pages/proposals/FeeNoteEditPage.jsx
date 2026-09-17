// Full-page editor for a proposal's one Bid Payment Requisition Note —
// opened from the Fee Notes card on the Proposal Preparation page. A page
// rather than a modal (like the Lead Approval Note form) so a stray click
// outside can't wipe everything the Person Responsible has typed.
//
// Which of EMD / Tender Fee / Processing Fee apply (amount, who bears each,
// and each fee's own payment mode + payee details — one fee might go by
// Bank Guarantee while another goes by Demand Draft), who the requisition
// form is submitted to, the client's contact details, the implementation-
// arrangements narrative, and a justification. Amounts and the client
// address pre-fill from this lead's own Lead Approval Note.
//
// The form is the ONLY place to enter anything — there's no separate note
// text to keep in sync. A live, read-only preview alongside it (feeNoteDraft
// .composeFeeNotePreview) shows exactly what page 1 will say as you fill
// the form in, the same wording preview-fee-note's real PDF prints. An
// earlier version had a free-text "Note Text" box with its own
// "Regenerate" button; that meant two places could disagree (and
// Regenerate could wipe out anything typed) — replaced by this.
//
// "Generate PDF" saves via save-fee-note (keyed by proposal_id — create or
// update), opens the PDF it produced, then returns to the proposal.
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
import { FEE_LINES, FEE_NOTE_TITLE, PAYMENT_MODE_LABELS, needsPayeeDetails } from "../../lib/proposalPrep";
import { composeFeeNotePreview, composeImplementationArrangements, portalRefLabel } from "../../lib/feeNoteDraft";
import "../../styles/LeadForm.css";
import "../../styles/ProposalPreparationPage.css";

const PAYMENT_MODE_OPTIONS = Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => ({ value, label }));

function parseFinancialAmount(raw) {
  if (raw === null || raw === undefined || raw === "") return "";
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : "";
}

function fmtNoteDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// The shape composeFeeNotePreview/composeImplementationArrangements need —
// just the fees actually ticked, with a numeric amount.
function activeComposeLines(lines) {
  return FEE_LINES
    .filter((f) => lines[f.key]?.enabled && Number(lines[f.key].amount) > 0)
    .map((f) => ({
      key: f.key,
      amount: Number(lines[f.key].amount),
      borneBy: lines[f.key].borneBy,
      paymentMode: lines[f.key].paymentMode || null,
      ddInFavourOf: lines[f.key].ddInFavourOf || null,
      ddPayableAt: lines[f.key].ddPayableAt || null,
    }));
}

function Segs({ segs }) {
  return segs.map((s, i) => (s.bold ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>));
}

export default function FeeNoteEditPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState("");
  const [ctx, setCtx] = useState(null); // { proposalId, lead, isNew, hasBa }

  const [lines, setLines] = useState({});
  const [submitTo, setSubmitTo] = useState("");
  const [clientAddress, setClientAddress] = useState("");
  const [clientTelephone, setClientTelephone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [implementation, setImplementation] = useState("");
  // False = keep the field synced to the auto-composed sentence as fees /
  // Business Partner change (see the effect below). Becomes true the
  // moment the user types their own text, so their edit is never silently
  // overwritten; clearing the box back to empty resumes auto-sync.
  const [implementationDirty, setImplementationDirty] = useState(false);
  const [justification, setJustification] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setBlocked("");

    const { data: lead } = await supabase
      .from("leads")
      .select(
        "id, lead_number, title, client_name, portal_name, bid_number, lead_type, assigned_ba_id, submission_deadline, person_responsible_id, reviewer_id, recommending_authority_id, approval_note_data, " +
        "ba:assigned_ba_id(full_name), pr:person_responsible_id(full_name, role), aa:recommending_authority_id(full_name, role)",
      )
      .eq("id", leadId)
      .maybeSingle();
    if (!lead) { setBlocked("Lead not found."); setLoading(false); return; }

    const { data: proposal } = await supabase
      .from("proposal_preparations")
      .select("id, locked")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (!proposal) { setBlocked("This proposal hasn't been opened yet."); setLoading(false); return; }

    const canManage =
      ["md", "admin"].includes(profile?.role) ||
      [lead.person_responsible_id, lead.reviewer_id].includes(profile?.id);
    if (!canManage) { setBlocked("Only the Person Responsible or Reviewer can edit this note."); setLoading(false); return; }

    const pastDeadline = !!lead.submission_deadline && new Date(lead.submission_deadline) < new Date();
    if (proposal.locked || pastDeadline) { setBlocked("This proposal is locked and can no longer be edited."); setLoading(false); return; }

    const { data: note } = await supabase
      .from("fee_notes")
      .select("*")
      .eq("proposal_id", proposal.id)
      .maybeSingle();

    if (note && note.status !== "draft") {
      setBlocked(`This note is "${note.status}" and can't be edited right now.`);
      setLoading(false);
      return;
    }

    const financial = lead.approval_note_data?.financial_requirement || {};
    const initialLines = Object.fromEntries(
      FEE_LINES.map((f) => {
        const existing = note?.[`${f.key}_amount`];
        const prefill = parseFinancialAmount(financial[f.financialKey]);
        return [f.key, {
          enabled: existing != null || (!note && prefill !== ""),
          amount: existing != null ? String(existing) : prefill,
          borneBy: note?.[`${f.key}_borne_by`] || "afc",
          paymentMode: note?.[`${f.key}_payment_mode`] || "",
          ddInFavourOf: note?.[`${f.key}_dd_in_favour_of`] || "",
          ddPayableAt: note?.[`${f.key}_dd_payable_at`] || "",
        }];
      }),
    );
    setLines(initialLines);
    setSubmitTo(note?.submit_to ?? lead.client_name ?? "");
    setClientAddress(note?.client_address ?? lead.approval_note_data?.client_address ?? "");
    setClientTelephone(note?.client_telephone ?? "");
    setClientEmail(note?.client_email ?? "");
    setJustification(note?.justification ?? "");

    // Implementation Arrangements starts from whatever was saved; if
    // nothing was saved yet it starts auto-synced (see the effect below)
    // and only locks to manual text once the user actually types in it.
    setImplementation(note?.implementation_arrangements ?? "");
    setImplementationDirty(!!note?.implementation_arrangements);

    setCtx({
      proposalId: proposal.id,
      lead,
      isNew: !note,
      hasBa: !!lead.assigned_ba_id,
    });
    setLoading(false);
    // profile is read for the client-side permission gate only (the edge
    // function re-checks); it's settled before this page is reachable, so
    // it's deliberately not a dependency — re-running on its identity
    // change would just refetch and stomp the user's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const preview = useMemo(() => {
    if (!ctx) return null;
    const composeLines = activeComposeLines(lines);
    return composeFeeNotePreview({
      lead: ctx.lead,
      feeLines: composeLines,
      bpName: ctx.lead.ba?.full_name || null,
      submitTo,
      refLabel: portalRefLabel(ctx.lead.portal_name),
    });
  }, [ctx, lines, submitTo]);

  // Keeps Implementation Arrangements auto-composed (same sentence as page
  // 1's body) as the fee lines / Business Partner change, right up until
  // the user types their own text into the box — then their text sticks.
  useEffect(() => {
    if (!ctx || implementationDirty) return;
    const composeLines = activeComposeLines(lines);
    setImplementation(composeLines.length
      ? composeImplementationArrangements({ feeLines: composeLines, bpName: ctx.lead.ba?.full_name || null })
      : "");
  }, [ctx, lines, implementationDirty]);

  function setLine(key, patch) {
    setLines((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  }

  async function handleGenerate(e) {
    e.preventDefault();
    const activeLines = FEE_LINES.filter((f) => lines[f.key]?.enabled);
    if (!activeLines.length) { setError("Include at least one of EMD, Tender Fee, or Processing Fee."); return; }
    for (const f of activeLines) {
      const l = lines[f.key];
      const amt = Number(l.amount);
      if (!l.amount || !Number.isFinite(amt) || amt <= 0) { setError(`Enter a valid amount for ${f.label}.`); return; }
      if (needsPayeeDetails(l.paymentMode) && (!l.ddInFavourOf.trim() || !l.ddPayableAt.trim())) {
        setError(`For ${f.label}, fill in "in favour of" and "payable at".`);
        return;
      }
    }
    if (!justification.trim()) { setError("Justification is required."); return; }

    setSaving(true);
    setError("");
    try {
      const feeFields = {};
      for (const f of FEE_LINES) {
        const l = lines[f.key];
        const active = l?.enabled;
        feeFields[`${f.key}_amount`] = active ? Number(l.amount) : null;
        feeFields[`${f.key}_borne_by`] = active ? l.borneBy : "afc";
        feeFields[`${f.key}_payment_mode`] = active ? (l.paymentMode || null) : null;
        feeFields[`${f.key}_dd_in_favour_of`] = active ? (l.ddInFavourOf.trim() || null) : null;
        feeFields[`${f.key}_dd_payable_at`] = active ? (l.ddPayableAt.trim() || null) : null;
      }
      const { data, error: fnError } = await supabase.functions.invoke("save-fee-note", {
        body: {
          proposal_id: ctx.proposalId,
          ...feeFields,
          submit_to: submitTo.trim() || null,
          client_address: clientAddress.trim() || null,
          client_telephone: clientTelephone.trim() || null,
          client_email: clientEmail.trim() || null,
          implementation_arrangements: implementation.trim() || null,
          justification: justification.trim(),
        },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to save this note.")); return; }
      if (!data?.success) { setError(data?.error || "Failed to save this note."); return; }

      try {
        const { data: pdfData, error: pdfError } = await supabase.functions.invoke("preview-fee-note", { body: { fee_note_id: data.fee_note_id } });
        if (pdfError || !pdfData?.success) {
          showToast(await extractFunctionErrorMessage(pdfError, pdfData?.error || "Saved, but couldn't open the PDF — use the eye icon on the proposal to view it."), "warning");
        } else {
          const bytes = Uint8Array.from(atob(pdfData.pdf_base64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          window.open(url, "_blank", "noopener,noreferrer");
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      } catch (pdfErr) {
        showToast(pdfErr.message || "Saved, but couldn't open the PDF.", "warning");
      }

      showToast("Bid Payment Requisition Note saved.", "success");
      navigate(`/proposals/${leadId}`);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoader text="Loading…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="page-header">
          <div className="page-title-row">
            <div>
              <h1>{FEE_NOTE_TITLE}</h1>
              {ctx?.lead && <p>{ctx.lead.lead_number} — {ctx.lead.title}</p>}
            </div>
            <Button variant="secondary" onClick={() => navigate(`/proposals/${leadId}`)}>← Back</Button>
          </div>
        </div>

        {blocked && <Alert variant="danger">{blocked}</Alert>}

        {!blocked && ctx && (
          <form onSubmit={handleGenerate} noValidate className="pp-fnp-layout">
            <div className="pp-fnp-form">
              {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

              <Card>
                <Card.Header title="Fees to Requisition" subtitle="Tick each fee that applies to this bid, and how it's being paid." />
                <Card.Body>
                  {FEE_LINES.map((f) => {
                    const l = lines[f.key] || {};
                    return (
                      <div key={f.key} className="pp-fee-line">
                        <label className="pp-fee-note-check">
                          <input type="checkbox" checked={!!l.enabled} onChange={(ev) => setLine(f.key, { enabled: ev.target.checked })} disabled={saving} />
                          <span>{f.label} <span className="field-hint">({f.refundable ? "Refundable" : "Non-Refundable"})</span></span>
                        </label>
                        {l.enabled && (
                          <>
                            <div className="pp-fee-line-inputs">
                              <div className="field">
                                <label className="field-label">Amount (₹)</label>
                                <input type="number" min="0" step="0.01" className="input" value={l.amount} onChange={(ev) => setLine(f.key, { amount: ev.target.value })} disabled={saving} placeholder="Amount" />
                              </div>
                              <div className="field">
                                <label className="field-label">Borne by</label>
                                <Select
                                  options={[{ value: "afc", label: "AFC" }, { value: "bp", label: "Business Partner" }]}
                                  value={l.borneBy}
                                  onChange={(v) => setLine(f.key, { borneBy: v })}
                                  disabled={saving || !ctx.hasBa}
                                />
                              </div>
                            </div>
                            <div className="pp-fee-line-inputs">
                              <div className="field">
                                <label className="field-label">Payment Mode</label>
                                <Select
                                  options={PAYMENT_MODE_OPTIONS}
                                  value={l.paymentMode}
                                  onChange={(v) => setLine(f.key, { paymentMode: v })}
                                  placeholder="Demand Draft, BG, FDR, Cheque, Online…"
                                  disabled={saving}
                                />
                              </div>
                              {needsPayeeDetails(l.paymentMode) && (
                                <div className="field">
                                  <label className="field-label">In favour of</label>
                                  <input className="input" value={l.ddInFavourOf} onChange={(ev) => setLine(f.key, { ddInFavourOf: ev.target.value })} disabled={saving} placeholder="e.g. Additional PCCF, CAMPA" />
                                </div>
                              )}
                            </div>
                            {needsPayeeDetails(l.paymentMode) && (
                              <div className="pp-fee-line-inputs">
                                <div className="field">
                                  <label className="field-label">Payable at</label>
                                  <input className="input" value={l.ddPayableAt} onChange={(ev) => setLine(f.key, { ddPayableAt: ev.target.value })} disabled={saving} placeholder="e.g. Ranchi" />
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                  {!ctx.hasBa && <span className="field-hint">This lead has no Business Partner, so every fee is borne by AFC.</span>}
                </Card.Body>
              </Card>

              <Card>
                <Card.Header title="Requisition Details" />
                <Card.Body>
                  <div className="field">
                    <label className="field-label">Requisition form to be submitted to</label>
                    <input className="input" value={submitTo} onChange={(e) => setSubmitTo(e.target.value)} disabled={saving} placeholder="Officer / office the requisition is addressed to" />
                  </div>
                </Card.Body>
              </Card>

              <Card>
                <Card.Header title="Client Contact Details" subtitle="Prints on page 2 of the note and shows on the lead." />
                <Card.Body>
                  <div className="field">
                    <label className="field-label">Client Address</label>
                    <textarea className="input" rows={2} value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} disabled={saving} placeholder="Registered / correspondence address of the client" />
                  </div>
                  <div className="field">
                    <label className="field-label">Client Telephone</label>
                    <input className="input" value={clientTelephone} onChange={(e) => setClientTelephone(e.target.value)} disabled={saving} placeholder="e.g. 0651-2410007" />
                  </div>
                  <div className="field">
                    <label className="field-label">Client Email</label>
                    <input className="input" type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} disabled={saving} placeholder="e.g. apccf-campa@gov.in" />
                  </div>
                </Card.Body>
              </Card>

              <Card>
                <Card.Header title="Narrative" />
                <Card.Body>
                  <div className="field">
                    <label className="field-label">Proposed Implementation Arrangements</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={implementation}
                      onChange={(e) => {
                        const val = e.target.value;
                        setImplementation(val);
                        setImplementationDirty(val.trim() !== "");
                      }}
                      disabled={saving}
                      placeholder="Auto-composed from the Business Partner and who bears each fee — edit freely, or clear to resume auto-sync."
                    />
                  </div>
                  <div className="field">
                    <label className="field-label">Justification <span className="required">*</span></label>
                    <textarea className="input" rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} disabled={saving} placeholder="Why this requisition is needed for this project" />
                  </div>
                </Card.Body>
              </Card>

              <div className="lf-actions">
                <Button type="submit" variant="primary" loading={saving} disabled={saving}>Generate PDF</Button>
                <Button type="button" variant="secondary" disabled={saving} onClick={() => navigate(`/proposals/${leadId}`)}>Cancel</Button>
              </div>
            </div>

            <div className="pp-fnp-preview-col">
              <div className="pp-fnp-preview-head">
                <span className="pp-fnp-preview-title">Page 1 — as it will print</span>
                <span className="pp-fnp-live-tag"><span className="pp-fnp-live-dot" />Live</span>
              </div>
              <div className="pp-fnp-page">
                <p className="pp-fnp-note-title">NOTE</p>
                <p className="pp-fnp-note-date">{fmtNoteDate(new Date())}</p>

                {!preview ? (
                  <p className="pp-fnp-placeholder">Tick a fee on the left to see the note take shape here.</p>
                ) : (
                  <>
                    {preview.intro.map((para, i) => <p key={i} className="pp-fnp-body"><Segs segs={para} /></p>)}
                    <ol>{preview.items.map((t, i) => <li key={i}>{t}</li>)}</ol>
                    {preview.tail.map((para, i) => <p key={`t${i}`} className="pp-fnp-body"><Segs segs={para} /></p>)}

                    <p className="pp-fnp-thanks">Submitted for your information and approval, please.<br />Thanks and regards,</p>

                    <div className="pp-fnp-sig">
                      <div className="pp-fnp-sig-name">{ctx.lead.pr?.full_name || "—"}</div>
                      <div className="pp-fnp-sig-role">{ROLE_LABELS[ctx.lead.pr?.role] || "Person Responsible"}</div>
                    </div>
                    <div className="pp-fnp-sig">
                      <div className="pp-fnp-sig-name">{ctx.lead.aa?.full_name || "—"}</div>
                      <div className="pp-fnp-sig-role">{ROLE_LABELS[ctx.lead.aa?.role] || "Recommending Authority"}</div>
                    </div>

                    {/* "Encl. as above" sits left, level with the MD's
                        block on the right — matching the reference note,
                        not stacked below all three signatures. */}
                    <div className="pp-fnp-sig-grid">
                      <p className="pp-fnp-encl">Encl. as above</p>
                      <div className="pp-fnp-sig pp-fnp-sig-md">
                        <div className="pp-fnp-sig-name">—</div>
                        <div className="pp-fnp-sig-role">Managing Director</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
