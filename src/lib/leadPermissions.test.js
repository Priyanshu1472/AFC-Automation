import { describe, expect, it } from "vitest";
import { leadCan, isActionRequiredForViewer, isMyLead, isTeamLead } from "./leadPermissions";

describe("leadCan", () => {
  const user = { id: "user-1" };

  it("create allows any role except MD and Admin", () => {
    expect(leadCan.create({ role: "project_officer" })).toBe(true);
    expect(leadCan.create({ role: "dgm" })).toBe(true);
    expect(leadCan.create({ role: "md" })).toBe(false);
    expect(leadCan.create({ role: "admin" })).toBe(false);
    expect(leadCan.create({})).toBe(false);
  });

  it("poAssign only applies to po_assignment and the exact person the lead was forwarded to", () => {
    const lead = { status: "po_assignment", team: "BPDD", forwarded_to_id: "user-1" };
    expect(leadCan.poAssign({ id: "user-1" }, lead)).toBe(true);
    expect(leadCan.poAssign({ id: "user-2" }, lead)).toBe(false); // not the forwarded person
    expect(leadCan.poAssign({ id: "user-1" }, { ...lead, status: "pa_review" })).toBe(false); // wrong status
  });

  it("accept only applies to pa_review and the assigned Person Responsible", () => {
    const lead = { status: "pa_review", person_responsible_id: "user-1" };
    expect(leadCan.accept(user, lead)).toBe(true);
    expect(leadCan.accept({ id: "someone-else" }, lead)).toBe(false);
    expect(leadCan.accept(user, { ...lead, status: "pmt_review" })).toBe(false);
  });

  it("drop at pa_review is available to the named PR, Reviewer, or Recommending Authority, never the creator alone", () => {
    const lead = { status: "pa_review", created_by: "user-1", person_responsible_id: "pr-1", reviewer_id: "reviewer-1", recommending_authority_id: "ra-1" };
    expect(leadCan.drop(user, lead)).toBe(false); // creator, but not PR/Reviewer/RA
    expect(leadCan.drop({ id: "pr-1" }, lead)).toBe(true);
    expect(leadCan.drop({ id: "reviewer-1" }, lead)).toBe(true);
    expect(leadCan.drop({ id: "ra-1" }, lead)).toBe(true);
    expect(leadCan.drop({ id: "bystander" }, lead)).toBe(false);
  });

  it("drop at po_assignment is available only to the person the lead was forwarded to", () => {
    const lead = { status: "po_assignment", created_by: "user-1", forwarded_to_id: "forwarded-1" };
    expect(leadCan.drop(user, lead)).toBe(false); // creator has no Drop here either
    expect(leadCan.drop({ id: "forwarded-1" }, lead)).toBe(true);
    expect(leadCan.drop({ id: "bystander" }, lead)).toBe(false);
  });

  it("drop past pa_review allows the named PR, Reviewer, or Recommending Authority", () => {
    const inPmtReview = { status: "pmt_review", created_by: "user-1", person_responsible_id: "pr-1", reviewer_id: "reviewer-1", recommending_authority_id: "ra-1" };
    expect(leadCan.drop(user, inPmtReview)).toBe(false); // creator alone
    expect(leadCan.drop({ id: "pr-1" }, inPmtReview)).toBe(true);
    expect(leadCan.drop({ id: "bystander" }, inPmtReview)).toBe(false);
  });

  it("drop is still available once MD has approved the lead — the one action left, for PR/Reviewer/RA", () => {
    const approved = { status: "md_approved", created_by: "user-1", person_responsible_id: "pr-1", reviewer_id: "reviewer-1", recommending_authority_id: "ra-1" };
    expect(leadCan.drop(user, approved)).toBe(false); // creator alone
    expect(leadCan.drop({ id: "pr-1" }, approved)).toBe(true);
    expect(leadCan.drop({ id: "bystander" }, approved)).toBe(false);
  });

  it("drop is unavailable once MD has declined the lead, or it's already dropped — genuinely terminal", () => {
    const declined = { status: "md_declined", created_by: "user-1", person_responsible_id: "user-1" };
    expect(leadCan.drop(user, declined)).toBe(false);
    const dropped = { status: "pa_dropped", created_by: "user-1", person_responsible_id: "user-1" };
    expect(leadCan.drop(user, dropped)).toBe(false);
  });

  it("drop at pa_action_required allows the named PR, Reviewer, or Recommending Authority", () => {
    const lead = { status: "pa_action_required", created_by: "user-1", person_responsible_id: "pr-1", reviewer_id: "reviewer-1", recommending_authority_id: "ra-1" };
    expect(leadCan.drop(user, lead)).toBe(false); // creator alone
    expect(leadCan.drop({ id: "pr-1" }, lead)).toBe(true);
    expect(leadCan.drop({ id: "bystander" }, lead)).toBe(false);
  });

  it("drop at pa_action_required is unavailable when the Recommending Authority sent it back — only Edit & Resubmit", () => {
    const lead = { status: "pa_action_required", created_by: "user-1", person_responsible_id: "user-1", declined_from_status: "recommending_authority_review" };
    expect(leadCan.drop(user, lead)).toBe(false);
  });

  it("rejectReassign applies to the assigned PR at pa_review, whether or not they're also the creator", () => {
    const lead = { status: "pa_review", created_by: "creator-1", person_responsible_id: "user-1" };
    expect(leadCan.rejectReassign(user, lead)).toBe(true);
    expect(leadCan.rejectReassign(user, { ...lead, created_by: "user-1" })).toBe(true); // self-assigned can also reassign now
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

  it("editResubmit also lets any teammate on the new team pick up a just-transferred lead (no PR yet)", () => {
    const lead = { status: "pa_review", created_by: "creator-1", person_responsible_id: null, team: "BPDD" };
    const teammate = { id: "bystander", teams: ["BPDD"] };
    expect(leadCan.editResubmit(teammate, lead)).toBe(true);
    expect(leadCan.editResubmit({ id: "bystander", teams: ["OtherTeam"] }, lead)).toBe(false);
  });

  it("editResubmit is Person-Responsible-only (not the creator) once a lead is overdue, regardless of status", () => {
    const overdueLead = {
      status: "recommending_authority_review",
      created_by: "creator-1",
      person_responsible_id: "user-1",
      submission_deadline: "2000-01-01",
    };
    expect(leadCan.editResubmit(user, overdueLead)).toBe(true); // PR
    expect(leadCan.editResubmit({ id: "creator-1" }, overdueLead)).toBe(false); // creator loses access once overdue
    expect(leadCan.editResubmit({ id: "bystander" }, overdueLead)).toBe(false);
  });

  it("editResubmit falls back to the forwarded-to person on an overdue lead with no Person Responsible yet (po_assignment)", () => {
    const overdueUnassigned = {
      status: "po_assignment",
      created_by: "creator-1",
      person_responsible_id: null,
      forwarded_to_id: "forwarded-1",
      submission_deadline: "2000-01-01",
    };
    expect(leadCan.editResubmit({ id: "forwarded-1" }, overdueUnassigned)).toBe(true);
    expect(leadCan.editResubmit({ id: "creator-1" }, overdueUnassigned)).toBe(false);
    expect(leadCan.editResubmit({ id: "bystander" }, overdueUnassigned)).toBe(false);
  });

  it("claim requires a PA-tier role on one of the caller's assigned teams", () => {
    const profile = { ...user, role: "agm", team: "BPDD", teams: ["BPDD"] };
    const lead = { status: "pa_dropped", team: "BPDD" };
    expect(leadCan.claim(profile, lead)).toBe(true);
    expect(leadCan.claim(profile, { ...lead, team: "OtherTeam" })).toBe(false);
    expect(leadCan.claim(profile, { ...lead, status: "pa_review" })).toBe(false);
    expect(leadCan.claim({ ...user, role: "cfo", team: "BPDD", teams: ["BPDD"] }, lead)).toBe(false);
  });

  it("claim recognizes a multi-team caller's secondary team, not just their primary", () => {
    const profile = { ...user, role: "agm", team: "BPDD", teams: ["BPDD", "HO"] };
    expect(leadCan.claim(profile, { status: "pa_dropped", team: "HO" })).toBe(true);
    expect(leadCan.claim(profile, { status: "pa_dropped", team: "OtherTeam" })).toBe(false);
  });

  it("pmtReview requires committee=PMT — org-wide, no team match needed", () => {
    const lead = { status: "pmt_review", team: "BPDD" };
    expect(leadCan.pmtReview({ ...user, committee: "PMT", team: "BPDD" }, lead)).toBe(true);
    expect(leadCan.pmtReview({ ...user, committee: "PMT", team: "OtherTeam" }, lead)).toBe(true);
    expect(leadCan.pmtReview({ ...user, committee: null }, lead)).toBe(false);
  });

  it("prReviewAccept/prReviewReject apply only while a note is pending PR review, to the assigned Person Responsible", () => {
    const lead = { status: "pa_review", person_responsible_id: "user-1", approval_note_pending_pr_review: true };
    expect(leadCan.prReviewAccept(user, lead)).toBe(true);
    expect(leadCan.prReviewReject(user, lead)).toBe(true);
    expect(leadCan.prReviewAccept({ id: "someone-else" }, lead)).toBe(false);
    expect(leadCan.prReviewReject({ id: "someone-else" }, lead)).toBe(false);
    expect(leadCan.prReviewAccept(user, { ...lead, approval_note_pending_pr_review: false })).toBe(false);
  });

  it("recommendingAuthorityReview is gated on the exact named person, not a role or team match", () => {
    const lead = { status: "recommending_authority_review", team: "BPDD", recommending_authority_id: "user-1" };
    expect(leadCan.recommendingAuthorityReview(user, lead)).toBe(true);
    // Being a DGM on the same team isn't enough by itself — must be the
    // specific person named on this lead (this is what makes the chain
    // work at offices with no DGM at all, e.g. Head Office).
    expect(leadCan.recommendingAuthorityReview({ ...user, id: "some-other-dgm", role: "dgm", teams: ["BPDD"] }, lead)).toBe(false);
    expect(leadCan.recommendingAuthorityReview(user, { ...lead, status: "pmt_review" })).toBe(false);
  });

  it("withdrawSubmission applies at any in-flight stage short of MD's final decision, for creator or PR", () => {
    const lead = { status: "pmt_review", created_by: "creator-1", person_responsible_id: "user-1" };
    expect(leadCan.withdrawSubmission(user, lead)).toBe(true);
    expect(leadCan.withdrawSubmission({ id: "creator-1" }, lead)).toBe(true);
    expect(leadCan.withdrawSubmission({ id: "bystander" }, lead)).toBe(false);
    expect(leadCan.withdrawSubmission(user, { ...lead, status: "recommending_authority_review" })).toBe(true);
    expect(leadCan.withdrawSubmission(user, { ...lead, status: "md_review" })).toBe(true);
    expect(leadCan.withdrawSubmission(user, { ...lead, status: "pa_review" })).toBe(false);
    expect(leadCan.withdrawSubmission(user, { ...lead, status: "md_approved" })).toBe(false);
  });

  it("mdReview requires role='md'", () => {
    const lead = { status: "md_review" };
    expect(leadCan.mdReview({ ...user, role: "md" }, lead)).toBe(true);
    expect(leadCan.mdReview({ ...user, role: "dgm" }, lead)).toBe(false);
  });
});

describe("isActionRequiredForViewer", () => {
  it("matches a PMT member only against pmt_review leads, regardless of team", () => {
    const profile = { id: "user-1", committee: "PMT", team: "BPDD" };
    expect(isActionRequiredForViewer(profile, { status: "pmt_review", team: "OtherTeam" })).toBe(true);
    expect(isActionRequiredForViewer(profile, { status: "md_review", team: "BPDD" })).toBe(false);
  });

  it("matches a PA-tier owner against their own pa_review/pa_action_required leads", () => {
    const profile = { id: "user-1", role: "project_officer", team: "BPDD" };
    expect(isActionRequiredForViewer(profile, { status: "pa_review", person_responsible_id: "user-1" })).toBe(true);
    expect(isActionRequiredForViewer(profile, { status: "pa_review", person_responsible_id: "someone-else" })).toBe(false);
    expect(isActionRequiredForViewer(profile, { status: "pa_action_required", created_by: "user-1", person_responsible_id: "someone-else" })).toBe(true);
  });

  it("matches the Person Responsible against a lead with a note pending their review", () => {
    const profile = { id: "user-1", role: "project_officer", team: "BPDD" };
    expect(isActionRequiredForViewer(profile, { status: "pa_review", person_responsible_id: "user-1", approval_note_pending_pr_review: true })).toBe(true);
    expect(isActionRequiredForViewer(profile, { status: "pa_review", person_responsible_id: "someone-else", approval_note_pending_pr_review: true })).toBe(false);
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

describe("isMyLead", () => {
  it("matches the Person Responsible", () => {
    const profile = { id: "user-1" };
    expect(isMyLead(profile, { created_by: "someone-else", person_responsible_id: "user-1" })).toBe(true);
  });

  it("matches the Reviewer", () => {
    const profile = { id: "user-1" };
    expect(isMyLead(profile, { created_by: "someone-else", person_responsible_id: "someone-else-2", reviewer_id: "user-1" })).toBe(true);
  });

  it("matches the Recommending Authority", () => {
    const profile = { id: "user-1" };
    expect(isMyLead(profile, { created_by: "someone-else", person_responsible_id: "someone-else-2", recommending_authority_id: "user-1" })).toBe(true);
  });

  it("does NOT match a creator who isn't otherwise named — that lead belongs on Team Leads", () => {
    const profile = { id: "user-1" };
    expect(isMyLead(profile, { created_by: "user-1", person_responsible_id: "someone-else", reviewer_id: "someone-else-2", recommending_authority_id: "someone-else-3" })).toBe(false);
  });

  it("does NOT match handled-by-DGM or plain team ownership — those belong on Team Leads instead", () => {
    const profile = { id: "user-1" };
    const base = { created_by: "someone-else", person_responsible_id: "someone-else-2" };
    expect(isMyLead(profile, { ...base, handled_by_dgm_id: "user-1" })).toBe(false);
  });

  it("returns false with no profile", () => {
    expect(isMyLead(null, { person_responsible_id: "user-1" })).toBe(false);
  });
});

describe("isTeamLead", () => {
  it("matches a plain team-scoped role's own team, not another team", () => {
    const profile = { id: "user-1", role: "project_officer", teams: ["BPDD", "HO"] };
    expect(isTeamLead(profile, { team: "BPDD" })).toBe(true);
    expect(isTeamLead(profile, { team: "HO" })).toBe(true);
    expect(isTeamLead(profile, { team: "OtherTeam" })).toBe(false);
  });

  it("always matches org-wide roles (md/cfo/cs/admin), any team — their org-wide browse view", () => {
    for (const role of ["md", "cfo", "cs", "admin"]) {
      expect(isTeamLead({ id: "user-1", role, teams: [] }, { team: "AnyTeam" })).toBe(true);
    }
  });

  it("always matches dgm/agm/srm, any team — org-wide visibility so duplicates get caught across teams", () => {
    for (const role of ["dgm", "agm", "srm"]) {
      expect(isTeamLead({ id: "user-1", role, teams: [] }, { team: "AnyTeam" })).toBe(true);
    }
  });

  it("always matches a PMT committee member, any team", () => {
    expect(isTeamLead({ id: "user-1", role: "project_officer", committee: "PMT", teams: [] }, { team: "AnyTeam" })).toBe(true);
  });

  it("does not match a Business Partner against an unrelated team", () => {
    const profile = { id: "ba-1", role: "business_associate", teams: [] };
    expect(isTeamLead(profile, { team: "BPDD" })).toBe(false);
  });

  it("returns false with no profile", () => {
    expect(isTeamLead(null, { team: "BPDD" })).toBe(false);
  });
});
