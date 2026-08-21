import { describe, expect, it } from "vitest";
import { leadCan, isActionRequiredForViewer } from "./leadPermissions";

describe("leadCan", () => {
  const user = { id: "user-1" };

  it("create allows any role except MD and Admin", () => {
    expect(leadCan.create({ role: "project_officer" })).toBe(true);
    expect(leadCan.create({ role: "dgm" })).toBe(true);
    expect(leadCan.create({ role: "md" })).toBe(false);
    expect(leadCan.create({ role: "admin" })).toBe(false);
    expect(leadCan.create({})).toBe(false);
  });

  it("accept only applies to pa_review and the assigned Person Responsible", () => {
    const lead = { status: "pa_review", person_responsible_id: "user-1" };
    expect(leadCan.accept(user, lead)).toBe(true);
    expect(leadCan.accept({ id: "someone-else" }, lead)).toBe(false);
    expect(leadCan.accept(user, { ...lead, status: "pmt_review" })).toBe(false);
  });

  it("drop at pa_review is creator-only — a non-creator PR must Reject, not Drop, until they've accepted", () => {
    const selfAssigned = { status: "pa_review", created_by: "user-1", person_responsible_id: "user-1" };
    expect(leadCan.drop(user, selfAssigned)).toBe(true);
    const assignedToSomeoneElse = { status: "pa_review", created_by: "user-1", person_responsible_id: "someone-else" };
    expect(leadCan.drop(user, assignedToSomeoneElse)).toBe(true); // creator can still drop even when PR differs
    expect(leadCan.drop({ id: "someone-else" }, assignedToSomeoneElse)).toBe(false); // PR (not creator) has no Drop before accepting — only Reject
  });

  it("drop past pa_review allows the creator or the current PR — PR gains it only after accepting", () => {
    const inPmtReview = { status: "pmt_review", created_by: "user-1", person_responsible_id: "someone-else" };
    expect(leadCan.drop(user, inPmtReview)).toBe(true); // creator can still withdraw
    expect(leadCan.drop({ id: "someone-else" }, inPmtReview)).toBe(true); // PR, now that they've accepted, can too
    expect(leadCan.drop({ id: "bystander" }, inPmtReview)).toBe(false);
    expect(leadCan.drop(user, { ...inPmtReview, status: "md_approved" })).toBe(false); // terminal
  });

  it("drop at pa_action_required allows creator or Person Responsible", () => {
    const lead = { status: "pa_action_required", created_by: "user-1", person_responsible_id: "someone-else" };
    expect(leadCan.drop(user, lead)).toBe(true);
    expect(leadCan.drop({ id: "someone-else" }, lead)).toBe(true);
    expect(leadCan.drop({ id: "bystander" }, lead)).toBe(false);
  });

  it("drop at pa_action_required is unavailable when DGM sent it back — only Edit & Resubmit", () => {
    const lead = { status: "pa_action_required", created_by: "user-1", person_responsible_id: "user-1", declined_from_status: "dgm_initial_review" };
    expect(leadCan.drop(user, lead)).toBe(false);
  });

  it("rejectReassign applies only to the PR at pa_review when they aren't the creator", () => {
    const lead = { status: "pa_review", created_by: "creator-1", person_responsible_id: "user-1" };
    expect(leadCan.rejectReassign(user, lead)).toBe(true);
    expect(leadCan.rejectReassign(user, { ...lead, created_by: "user-1" })).toBe(false); // self-assigned uses Drop
    expect(leadCan.rejectReassign({ id: "bystander" }, lead)).toBe(false);
  });

  it("editResubmit applies at pa_review and pa_action_required, for creator or PR, but not while under active review", () => {
    const lead = { status: "pa_review", created_by: "creator-1", person_responsible_id: "user-1" };
    expect(leadCan.editResubmit(user, lead)).toBe(true); // PR
    expect(leadCan.editResubmit({ id: "creator-1" }, lead)).toBe(true); // creator
    expect(leadCan.editResubmit({ id: "bystander" }, lead)).toBe(false);
    expect(leadCan.editResubmit(user, { ...lead, status: "pa_action_required" })).toBe(true);
    expect(leadCan.editResubmit(user, { ...lead, status: "pmt_review" })).toBe(false);
  });

  it("claim requires a PA-tier role on the lead's own team", () => {
    const profile = { ...user, role: "agm", team: "BPDD" };
    const lead = { status: "pa_dropped", team: "BPDD" };
    expect(leadCan.claim(profile, lead)).toBe(true);
    expect(leadCan.claim(profile, { ...lead, team: "OtherTeam" })).toBe(false);
    expect(leadCan.claim(profile, { ...lead, status: "pa_review" })).toBe(false);
    expect(leadCan.claim({ ...user, role: "cfo", team: "BPDD" }, lead)).toBe(false);
  });

  it("pmtReview requires committee=PMT — org-wide, no team match needed", () => {
    const lead = { status: "pmt_review", team: "BPDD" };
    expect(leadCan.pmtReview({ ...user, committee: "PMT", team: "BPDD" }, lead)).toBe(true);
    expect(leadCan.pmtReview({ ...user, committee: "PMT", team: "OtherTeam" }, lead)).toBe(true);
    expect(leadCan.pmtReview({ ...user, committee: "PMT Extended" }, lead)).toBe(false);
  });

  it("pmtExtendedReview requires committee='PMT Extended' — org-wide", () => {
    const lead = { status: "pmt_extended_review", team: "BPDD" };
    expect(leadCan.pmtExtendedReview({ ...user, committee: "PMT Extended", team: "OtherTeam" }, lead)).toBe(true);
    expect(leadCan.pmtExtendedReview({ ...user, committee: "PMT" }, lead)).toBe(false);
  });

  it("dgmInitialReview (G3, ahead of PMT) is org-wide — any team matches", () => {
    const profile = { ...user, committee: "G3", team: "BPDD" };
    const lead = { status: "dgm_initial_review", team: "SomeOtherTeam" };
    expect(leadCan.dgmInitialReview(profile, lead)).toBe(true);
    expect(leadCan.dgmInitialReview({ ...profile, committee: "PMT" }, lead)).toBe(false);
    expect(leadCan.dgmInitialReview(profile, { ...lead, status: "dgm_review" })).toBe(false);
  });

  it("dgmReview (G3) is org-wide — any team matches", () => {
    const profile = { ...user, committee: "G3", team: "BPDD" };
    const lead = { status: "dgm_review", team: "SomeOtherTeam" };
    expect(leadCan.dgmReview(profile, lead)).toBe(true);
    expect(leadCan.dgmReview({ ...profile, committee: "PMT" }, lead)).toBe(false);
  });

  it("mdReview requires role='md'", () => {
    const lead = { status: "md_review" };
    expect(leadCan.mdReview({ ...user, role: "md" }, lead)).toBe(true);
    expect(leadCan.mdReview({ ...user, role: "dgm", committee: "G3" }, lead)).toBe(false);
  });
});

describe("isActionRequiredForViewer", () => {
  it("matches a PMT member only against pmt_review leads, regardless of team", () => {
    const profile = { id: "user-1", committee: "PMT", team: "BPDD" };
    expect(isActionRequiredForViewer(profile, { status: "pmt_review", team: "OtherTeam" })).toBe(true);
    expect(isActionRequiredForViewer(profile, { status: "pmt_extended_review", team: "BPDD" })).toBe(false);
  });

  it("matches a PA-tier owner against their own pa_review/pa_action_required leads", () => {
    const profile = { id: "user-1", role: "project_officer", team: "BPDD" };
    expect(isActionRequiredForViewer(profile, { status: "pa_review", person_responsible_id: "user-1" })).toBe(true);
    expect(isActionRequiredForViewer(profile, { status: "pa_review", person_responsible_id: "someone-else" })).toBe(false);
    expect(isActionRequiredForViewer(profile, { status: "pa_action_required", created_by: "user-1", person_responsible_id: "someone-else" })).toBe(true);
  });

  it("matches MD against md_review leads only", () => {
    const profile = { id: "user-1", role: "md" };
    expect(isActionRequiredForViewer(profile, { status: "md_review" })).toBe(true);
    expect(isActionRequiredForViewer(profile, { status: "md_approved" })).toBe(false);
  });

  it("unions capacities when a user holds both a base role and a committee", () => {
    const profile = { id: "user-1", role: "project_officer", team: "BPDD", committee: "PMT" };
    expect(isActionRequiredForViewer(profile, { status: "pa_review", person_responsible_id: "user-1" })).toBe(true);
    expect(isActionRequiredForViewer(profile, { status: "pmt_review", team: "OtherTeam" })).toBe(true);
  });
});
