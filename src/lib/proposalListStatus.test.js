import { describe, it, expect } from "vitest";
import { prepStatusOf, proposalStatusBadges, emdStatusBadges, emdAccountsPendingOf } from "./proposalListStatus";

const FUTURE = "2999-01-01";
const PAST = "2000-01-01";
const labels = (badges) => badges.map((b) => b.label);
const row = (over = {}) => ({ submission_deadline: FUTURE, proposal: null, feeNote: null, emd: null, pbgNote: null, ...over });
const approvedNote = (over = {}) => ({ status: "approved", payment_status: "paid", emd_amount: 50000, ...over });
const awarded = { locked: true, client_response: "awarded", award_kind: "project" };

describe("prepStatusOf / proposalStatusBadges", () => {
  it("is Not Started when nobody opened the proposal, even past the deadline", () => {
    expect(prepStatusOf(row())).toBe("not_started");
    expect(prepStatusOf(row({ submission_deadline: PAST }))).toBe("not_started");
  });

  it("is In Progress while open and before the deadline", () => {
    expect(labels(proposalStatusBadges(row({ proposal: { locked: false } })))).toEqual(["In Progress"]);
  });

  it("is Locked when locked manually", () => {
    expect(labels(proposalStatusBadges(row({ proposal: { locked: true } })))).toEqual(["Locked"]);
  });

  it("is Locked automatically once the submission deadline has passed", () => {
    const badges = proposalStatusBadges(row({ submission_deadline: PAST, proposal: { locked: false } }));
    expect(labels(badges)).toEqual(["Locked"]);
    expect(badges[0].title).toMatch(/automatically/);
    expect(prepStatusOf(row({ submission_deadline: PAST, proposal: { locked: false } }))).toBe("locked");
  });

  it("adds Payment Due while the approved note is unpaid", () => {
    const r = row({ proposal: { locked: false }, feeNote: approvedNote({ payment_status: "pending" }) });
    expect(labels(proposalStatusBadges(r))).toEqual(["In Progress", "Payment Due"]);
  });
});

describe("emdStatusBadges", () => {
  it("shows nothing when the note has no EMD", () => {
    expect(emdStatusBadges(row({ proposal: { locked: false }, feeNote: approvedNote({ emd_amount: 0 }) }))).toEqual([]);
  });

  it("shows nothing before the EMD has been paid", () => {
    expect(emdStatusBadges(row({ proposal: { locked: false }, feeNote: approvedNote({ payment_status: "pending" }) }))).toEqual([]);
  });

  it("shows EMD Deposited once paid, while the outcome is pending", () => {
    expect(labels(emdStatusBadges(row({ proposal: { locked: true, client_response: "pending" }, feeNote: approvedNote() })))).toEqual(["EMD Deposited"]);
  });

  it("asks for an EMD option on a project award with no choice yet", () => {
    expect(labels(emdStatusBadges(row({ proposal: awarded, feeNote: approvedNote() })))).toEqual(["EMD Option Pending"]);
  });

  it("does not ask for an option on an EOI next-stage award", () => {
    expect(emdStatusBadges(row({ proposal: { ...awarded, award_kind: "next_stage" }, feeNote: approvedNote() }))).toEqual([]);
  });

  it.each([
    ["pending", "EMD Refund Pending"],
    ["received", "EMD Received"],
    ["pending_accounts", "EMD with Accounts"],
    ["completed", "EMD Refunded"],
  ])("refund track: %s -> %s", (status, label) => {
    const r = row({ proposal: { locked: true, client_response: "rejected" }, feeNote: approvedNote(), emd: { track: "refund", status, emd_amount: 50000 } });
    expect(labels(emdStatusBadges(r))).toEqual([label]);
  });

  it("on completion track", () => {
    const r = row({ proposal: awarded, feeNote: approvedNote(), emd: { track: "on_completion", status: "awaiting_completion" } });
    expect(labels(emdStatusBadges(r))).toEqual(["EMD on Completion"]);
  });

  it("converted to PBG before the note exists asks for the PBG Note", () => {
    const r = row({ proposal: awarded, feeNote: approvedNote(), emd: { track: "pbg", status: "draft" } });
    expect(labels(emdStatusBadges(r))).toEqual(["PBG Note to Prepare"]);
  });

  it.each([
    ["draft", "PBG Note Draft"],
    ["pending_ra", "PBG Note in Approval"],
    ["pending_md", "PBG Note in Approval"],
    ["pending_accounts", "PBG Note with Accounts"],
    ["pending_payment", "PBG Payment Due"],
    ["completed", "PBG Done"],
  ])("converted to PBG follows the PBG Note: %s -> %s", (status, label) => {
    const emdStatus = status === "completed" ? "completed" : "draft";
    const r = row({ proposal: awarded, feeNote: approvedNote(), emd: { track: "pbg", status: emdStatus }, pbgNote: { status } });
    expect(labels(emdStatusBadges(r))).toEqual([label]);
  });

  it("shows both the EMD refund and the PBG Note when they run separately", () => {
    const r = row({ proposal: awarded, feeNote: approvedNote(), emd: { track: "refund", status: "pending" }, pbgNote: { status: "pending_md" } });
    expect(labels(emdStatusBadges(r))).toEqual(["EMD Refund Pending", "PBG Note in Approval"]);
  });

  it("shows the PBG Note on a project award with no EMD", () => {
    const r = row({ proposal: awarded, feeNote: approvedNote({ emd_amount: 0 }), pbgNote: { status: "completed" } });
    expect(labels(emdStatusBadges(r))).toEqual(["PBG Done"]);
  });
});

describe("emdAccountsPendingOf", () => {
  it("flags EMD / PBG items sitting with Accounts", () => {
    expect(emdAccountsPendingOf(row({ emd: { track: "refund", status: "pending_accounts" } }))).toBe("EMD with Accounts");
    expect(emdAccountsPendingOf(row({ pbgNote: { status: "pending_accounts" } }))).toBe("PBG Note with Accounts");
    expect(emdAccountsPendingOf(row({ pbgNote: { status: "pending_payment" } }))).toBe("PBG Payment Due");
    expect(emdAccountsPendingOf(row({ emd: { track: "refund", status: "pending" } }))).toBeNull();
  });
});
