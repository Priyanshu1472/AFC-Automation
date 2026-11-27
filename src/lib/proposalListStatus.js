// Badges for the Proposals table (ProposalsListPage). Each row is a lead with
// its proposal pieces merged on: { submission_deadline, proposal, feeNote,
// emd, pbgNote }. Kept out of the page so every stage can be unit-tested.
import { isProposalLocked, isProjectAward } from "./proposalPrep";

// "not_started" | "in_progress" | "locked". A proposal also counts as
// locked once its submission deadline has passed (same rule the DB uses),
// not only when someone pressed Lock. A proposal nobody ever opened stays
// "not_started" even past the deadline.
export function prepStatusOf(l) {
  if (!l.proposal) return "not_started";
  return isProposalLocked(l.proposal, l) ? "locked" : "in_progress";
}

// Proposal Status column: the main badge, plus a "Payment Due" badge while
// the MD-approved Bid Payment Requisition Note hasn't been paid yet.
export function proposalStatusBadges(l) {
  const status = prepStatusOf(l);
  const autoLocked = status === "locked" && !l.proposal?.locked;
  const out = [
    status === "locked"
      ? { label: "Locked", variant: "neutral", title: autoLocked ? "Locked automatically: the submission deadline has passed" : "Locked" }
      : status === "in_progress"
        ? { label: "In Progress", variant: "success" }
        : { label: "Not Started", variant: "neutral" },
  ];
  const payment = feePaymentPendingOf(l);
  if (payment) out.push({ label: payment, variant: "warning", title: "The approved Bid Payment Requisition Note is waiting for payment" });
  return out;
}

export function feePaymentPendingOf(l) {
  if (l.feeNote?.status === "approved" && l.feeNote?.payment_status !== "paid") return "Payment Due";
  return null;
}

// EMD / PBG items sitting with the Accounts Committee (feeds the Accounts
// "Pending with Accounts" card together with feePaymentPendingOf).
export function emdAccountsPendingOf(l) {
  if (l.emd?.status === "pending_accounts") return l.emd.track === "pbg" ? "PBG with Accounts" : "EMD with Accounts";
  if (l.pbgNote?.status === "pending_accounts") return "PBG Note with Accounts";
  if (l.pbgNote?.status === "pending_payment") return "PBG Payment Due";
  return null;
}

function emdAmountOf(l) {
  return Number(l.emd?.emd_amount ?? l.feeNote?.emd_amount ?? 0);
}

// The EMD's own badge (null when there's nothing to say).
function emdBadge(l) {
  const emd = l.emd;
  if (emd) {
    switch (emd.status) {
      case "pending": return { label: "EMD Refund Pending", variant: "warning", title: "Waiting for the client to return the EMD" };
      case "received": return { label: "EMD Received", variant: "info", title: "Refund received: upload proof and forward it to Accounts" };
      case "pending_accounts": return { label: emdAccountsPendingOf(l), variant: "warning", title: "Waiting for Accounts to verify" };
      case "completed": return emd.track === "pbg"
        ? { label: "PBG Done", variant: "success" }
        : { label: "EMD Refunded", variant: "success", title: "Verified by Accounts" };
      case "awaiting_completion": return { label: "EMD on Completion", variant: "neutral", title: "Refunded when the project completes" };
      case "draft": return null; // Converted to PBG: the PBG badge says where it is.
      default: return null;
    }
  }
  if (!(emdAmountOf(l) > 0) || l.feeNote?.status !== "approved") return null;
  // A project award with an EMD: the team still has to pick Refund /
  // Converted to PBG / On Completion.
  if (isProjectAward(l.proposal)) return { label: "EMD Option Pending", variant: "warning", title: "Choose EMD Refund, Converted to PBG or On Completion" };
  // Before the client's answer: the EMD is with the client once paid.
  if ((l.proposal?.client_response || "pending") === "pending" && l.feeNote?.payment_status === "paid") {
    return { label: "EMD Deposited", variant: "neutral", title: "EMD paid to the client; waiting for the outcome" };
  }
  return null;
}

// The PBG Note's badge (awarded projects only).
function pbgBadge(l) {
  const note = l.pbgNote;
  const convertedToPbg = l.emd?.track === "pbg";
  if (!note) {
    return convertedToPbg && l.emd.status !== "completed"
      ? { label: "PBG Note to Prepare", variant: "warning", title: "EMD converted to PBG: prepare the PBG Note" }
      : null;
  }
  switch (note.status) {
    case "draft": return { label: "PBG Note Draft", variant: "neutral", title: "PBG Note being prepared (or answering a clarification)" };
    case "pending_ra":
    case "pending_md": return { label: "PBG Note in Approval", variant: "warning", title: note.status === "pending_ra" ? "With the Recommending Authority" : "With the MD" };
    case "pending_accounts": return { label: "PBG Note with Accounts", variant: "warning" };
    case "pending_payment": return { label: "PBG Payment Due", variant: "info" };
    case "completed": return { label: "PBG Done", variant: "success" };
    default: return null;
  }
}

// EMD Status column: up to two badges, the EMD's and the PBG Note's. When
// the EMD was converted to PBG it travels with the PBG Note, so only the
// PBG badge shows.
export function emdStatusBadges(l) {
  const out = [];
  const pbg = pbgBadge(l);
  const emd = l.emd?.track === "pbg" && pbg ? null : emdBadge(l);
  if (emd) out.push(emd);
  if (pbg && !out.some((b) => b.label === pbg.label)) out.push(pbg);
  return out;
}
