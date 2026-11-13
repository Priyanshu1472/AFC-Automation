import { describe, expect, it } from "vitest";
import { isLeadOverdue, overdueEditorId, TERMINAL_STATUSES } from "./leadStatus";

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("isLeadOverdue", () => {
  it("is false when there's no submission_deadline", () => {
    expect(isLeadOverdue({ status: "pa_review", person_responsible_id: "u1" })).toBe(false);
  });

  it("is false when the deadline is in the future", () => {
    expect(isLeadOverdue({ status: "pa_review", submission_deadline: daysFromNow(3) })).toBe(false);
  });

  it("is true when the deadline is in the past and status isn't terminal", () => {
    expect(isLeadOverdue({ status: "pa_review", submission_deadline: daysFromNow(-3) })).toBe(true);
  });

  it("is true even when there's no Person Responsible yet (e.g. po_assignment)", () => {
    expect(isLeadOverdue({ status: "po_assignment", person_responsible_id: null, submission_deadline: daysFromNow(-1) })).toBe(true);
  });

  it("is false for every terminal status, regardless of the deadline", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(isLeadOverdue({ status, submission_deadline: daysFromNow(-10) })).toBe(false);
    }
  });

  it("is false for a null lead", () => {
    expect(isLeadOverdue(null)).toBe(false);
  });
});

describe("overdueEditorId", () => {
  it("is the Person Responsible when one is assigned", () => {
    expect(overdueEditorId({ person_responsible_id: "pr-1", created_by: "creator-1" })).toBe("pr-1");
  });

  it("falls back to the forwarded-to person when there's no Person Responsible yet (po_assignment)", () => {
    expect(overdueEditorId({ person_responsible_id: null, forwarded_to_id: "forwarded-1", created_by: "creator-1" })).toBe("forwarded-1");
  });

  it("falls back to the creator only if even the forwarded-to person is missing", () => {
    expect(overdueEditorId({ person_responsible_id: null, forwarded_to_id: null, created_by: "creator-1" })).toBe("creator-1");
  });

  it("is null for a null lead", () => {
    expect(overdueEditorId(null)).toBe(null);
  });
});
