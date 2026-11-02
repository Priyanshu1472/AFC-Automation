import { describe, expect, it } from "vitest";
import { describeNotification, splitQuoted } from "./notificationDisplay";

const lead = (title, sub_text) => describeNotification({ title, sub_text, link: "/leads/x" });
const emp = (title, sub_text) => describeNotification({ title, sub_text, link: "/empanelment/x" });

describe("describeNotification — leads", () => {
  it("pulls the lead number and title out of the text", () => {
    expect(lead("A lead was forwarded to you", 'AFC/TEAM 2/L/26/022 — "Tenderkart overview: RFP steps" needs a Person Responsible, Reviewer, and Recommending Authority assigned.')).toEqual({
      alert: "A lead was forwarded to you",
      ref: "AFC/TEAM 2/L/26/022",
      subject: "Tenderkart overview: RFP steps",
      detail: "Needs a Person Responsible, Reviewer, and Recommending Authority assigned.",
    });
  });

  it("drops the team in brackets after the lead title", () => {
    const d = lead("Cross-team query raised on a lead", 'AFC/TEAM 1/L/26/023 — "qwertyu" (Team 1): a query was raised. qwerty');
    expect(d.ref).toBe("AFC/TEAM 1/L/26/023");
    expect(d.detail).toBe("A query was raised. qwerty");
  });

  it("takes the lead from the title for chat notifications", () => {
    const d = lead('New message on AFC/TEAM 1/L/26/022 — "QWERTY"', 'Test DGM: "@Test AC hi"');
    expect(d).toEqual({ alert: "New message", ref: "AFC/TEAM 1/L/26/022", subject: "QWERTY", detail: 'Test DGM: "@Test AC hi"' });
  });

  it("replaces a lead mentioned mid-sentence with 'this lead'", () => {
    const d = lead("Lead transfer awaiting your approval", 'PMT requested transferring AFC/TEAM 1/L/26/005 — "Solar" from Team 1 to Team 3.');
    expect(d.subject).toBe("Solar");
    expect(d.detail).toBe("PMT requested transferring this lead from Team 1 to Team 3.");
  });

  it("keeps a title that contains quotes", () => {
    const d = lead("Lead approved", 'AFC/TEAM 1/L/26/007 — "The "Big" one" was approved by the MD.');
    expect(d.subject).toBe('The "Big" one');
    expect(d.detail).toBe("Was approved by the MD.");
  });
});

describe("describeNotification — empanelment", () => {
  it("uses the organisation as the subject", () => {
    expect(emp("Empanelment application awaiting your review", "Green Fields Pvt. Ltd.'s application was forwarded by the Project Officer.")).toEqual({
      alert: "Empanelment application awaiting your review",
      ref: null,
      subject: "Green Fields Pvt. Ltd.",
      detail: "The application was forwarded by the Project Officer.",
    });
  });

  it("handles form submission and chat titles", () => {
    expect(emp("New empanelment form submitted", "Acme has submitted their empanelment application. Please review.").detail).toBe("The BP has submitted their empanelment application. Please review.");
    const chat = emp("Ravi tagged you on Acme's empanelment application", '"please check GST"');
    expect(chat).toMatchObject({ alert: "Ravi tagged you", subject: "Acme", detail: '"please check GST"' });
  });

  it("passes unrecognised text through", () => {
    expect(emp("Correction submitted — review resumed", "The flagged item(s) have been corrected.")).toEqual({
      alert: "Correction submitted — review resumed", ref: null, subject: null, detail: "The flagged item(s) have been corrected.",
    });
  });
});

describe("splitQuoted", () => {
  it("marks quoted parts", () => {
    expect(splitQuoted('Test DGM: "hi there"')).toEqual([{ text: "Test DGM: ", quoted: false }, { text: '"hi there"', quoted: true }]);
  });
});
