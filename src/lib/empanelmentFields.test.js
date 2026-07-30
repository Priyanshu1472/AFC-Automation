import { describe, expect, it } from "vitest";
import { FLAGGABLE_DOCUMENT_SLOTS, FLAGGABLE_TEXT_FIELDS, labelForFieldKey } from "./empanelmentFields";

describe("labelForFieldKey", () => {
  it("resolves a plain text field key to its human label", () => {
    expect(labelForFieldKey("pan")).toBe("PAN Number");
    expect(labelForFieldKey("org_name")).toBe("Organisation Name");
  });

  it("resolves a doc: prefixed key to its document slot label", () => {
    expect(labelForFieldKey("doc:panCopy")).toBe("PAN Card Copy");
    expect(labelForFieldKey("doc:financials")).toBe("Audited Financial Statements");
  });

  it("falls back to the raw key when it isn't in either registry", () => {
    expect(labelForFieldKey("not_a_real_field")).toBe("not_a_real_field");
    expect(labelForFieldKey("doc:not_a_real_slot")).toBe("doc:not_a_real_slot");
  });

  it("every FLAGGABLE_TEXT_FIELDS key round-trips to a non-empty label", () => {
    for (const key of Object.keys(FLAGGABLE_TEXT_FIELDS)) {
      expect(labelForFieldKey(key)).toBe(FLAGGABLE_TEXT_FIELDS[key]);
    }
  });

  it("every FLAGGABLE_DOCUMENT_SLOTS key round-trips via the doc: prefix", () => {
    for (const key of Object.keys(FLAGGABLE_DOCUMENT_SLOTS)) {
      expect(labelForFieldKey(`doc:${key}`)).toBe(FLAGGABLE_DOCUMENT_SLOTS[key]);
    }
  });
});
