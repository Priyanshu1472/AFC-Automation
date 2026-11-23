// The proposal's Timeline — same card and same accordion (LeadTimeline) as
// the Lead page, so both modules look alike. Data comes from
// get_proposal_timeline(), which merges proposal_activity (documents, value,
// lock, response, people…), fee_note_events (Bid Payment Requisition Note
// stages) and proposal_finance_events (payment, EMD, PBG). `refreshKey`
// changes whenever the page re-fetches, so new steps show without a reload.
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import Card from "../ui/Card";
import LeadTimeline from "../leads/LeadTimeline";

// Short action names, shown upper-case like the Lead timeline's.
const ACTIONS = {
  // proposal_activity
  proposal_opened: "Proposal opened",
  fee_note_drafted: "Fee note drafted",
  document_uploaded: "Document uploaded",
  document_replaced: "Document replaced",
  document_removed: "Document removed",
  bp_doc_requested: "BP document requested",
  bp_doc_uploaded: "BP document uploaded",
  bp_doc_removed: "BP document request removed",
  bp_docs_sent: "Sent to BP",
  bp_docs_reminded: "Reminder sent to BP",
  value_set: "Proposed value entered",
  value_changed: "Proposed value changed",
  value_removed: "Proposed value removed",
  empanelment_on: "Marked empanelment only",
  empanelment_off: "Empanelment only removed",
  responsible_added: "Person responsible added",
  responsible_removed: "Person responsible removed",
  locked: "Proposal locked",
  response_awarded: "Awarded",
  response_rejected: "Not awarded",
  response_next_stage: "Moves to RFP / tender",
  response_empanelled: "Empanelled",
  // fee_note_events
  forwarded_to_ra: "Fee note forwarded to RA",
  returned_by_ra: "Fee note sent back by RA",
  forwarded_to_md: "Fee note RA approve",
  md_approved: "Fee note MD approve",
  md_rejected: "Fee note sent back by MD",
  // proposal_finance_events
  payment_done: "Fee payment done",
  refund_opened: "EMD refund opened",
  chose_refund: "EMD refund chosen",
  chose_pbg: "EMD converted to PBG",
  chose_on_completion: "EMD on completion",
  refund_received: "EMD refund received",
  refund_pending: "EMD refund pending",
  forwarded_to_accounts: "Forwarded to accounts",
  refund_verified: "EMD refund verified",
  pbg_processed: "PBG processed",
  returned_by_accounts: "Clarification by accounts",
  clarification_requested: "Clarification by accounts",
  pbg_note_created: "PBG note created",
  pbg_forwarded: "PBG note forwarded to RA",
  pbg_clarified: "PBG clarification answered",
  pbg_ra_approved: "PBG note RA approve",
  pbg_md_approved: "PBG note MD approve",
  pbg_accounts_approved: "PBG note accounts approve",
  pbg_clarification_requested: "PBG clarification requested",
  pbg_paid: "PBG done",
};

export default function ProposalTimeline({ proposalId, refreshKey }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_proposal_timeline", { p_proposal_id: proposalId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error("proposal timeline:", error.message); return; }
      setLogs((data || []).map((r) => ({
        id: `${r.source}-${r.id}`,
        created_at: r.created_at,
        actor_role: r.actor_role,
        actor: r.actor_name ? { full_name: r.actor_name } : null,
        action: ACTIONS[r.action] || r.action,
        detail: r.detail,
        comment: r.remark,
      })));
    });
    return () => { cancelled = true; };
  }, [proposalId, refreshKey]);

  return (
    <Card>
      <Card.Header title="Timeline" />
      <Card.Body className="ar-timeline-body ar-lead-timeline-body">
        <LeadTimeline logs={logs} />
      </Card.Body>
    </Card>
  );
}
