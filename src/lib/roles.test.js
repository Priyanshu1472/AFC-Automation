import { describe, expect, it } from "vitest";
import {
  ADMIN_CREATABLE_ROLES, AUDIT_LOG_ROLES, can, EMPANELMENT_ROLES, isAdminLevel, isTeamUser,
  isValidRole, KNOWLEDGE_REPOSITORY_ROLES, LEAD_GENERATION_NAV_ROLES, LEAD_PA_TIER_ROLES,
  ROLES, USERS_PAGE_ROLES, VALID_ROLES,
} from "./roles";

describe("Lead Generation — SRM has the same access as AGM", () => {
  it("SRM can reach the Leads nav/routes, same as AGM", () => {
    expect(LEAD_GENERATION_NAV_ROLES).toContain("agm");
    expect(LEAD_GENERATION_NAV_ROLES).toContain("srm");
  });

  it("SRM is PA-tier, same as AGM", () => {
    expect(LEAD_PA_TIER_ROLES).toContain("agm");
    expect(LEAD_PA_TIER_ROLES).toContain("srm");
  });
});

describe("ROLES / VALID_ROLES", () => {
  it("every role in ROLES is recognized by isValidRole", () => {
    for (const role of Object.keys(ROLES)) expect(isValidRole(role)).toBe(true);
  });

  it("rejects an unknown role", () => {
    expect(isValidRole("hacker")).toBe(false);
    expect(isValidRole("")).toBe(false);
  });

  it("VALID_ROLES matches the keys of ROLES exactly", () => {
    expect([...VALID_ROLES].sort()).toEqual(Object.keys(ROLES).sort());
  });
});

describe("Admin's creatable roles", () => {
  it("never include admin or md (no self-replication, no MD minting)", () => {
    expect(ADMIN_CREATABLE_ROLES).not.toContain("admin");
    expect(ADMIN_CREATABLE_ROLES).not.toContain("md");
  });
});

describe("user management is Admin-only", () => {
  it("can.manageAllUsers is true only for admin", () => {
    expect(can.manageAllUsers("admin")).toBe(true);
    expect(can.manageAllUsers("md")).toBe(false);
    expect(can.manageAllUsers("dgm")).toBe(false);
    expect(can.manageAllUsers("cfo")).toBe(false);
  });

  it("can.createUsers is true only for admin", () => {
    expect(can.createUsers("admin")).toBe(true);
    expect(can.createUsers("md")).toBe(false);
    expect(can.createUsers("dgm")).toBe(false);
    expect(can.createUsers("cfo")).toBe(false);
    expect(can.createUsers("business_associate")).toBe(false);
  });

  it("can.editUsers / editUserRole are true only for admin", () => {
    expect(can.editUsers("admin")).toBe(true);
    expect(can.editUsers("dgm")).toBe(false);
    expect(can.editUsers("md")).toBe(false);
    expect(can.editUserRole("admin")).toBe(true);
    expect(can.editUserRole("md")).toBe(false);
    expect(can.editUserRole("dgm")).toBe(false);
    expect(can.editUserRole("srm")).toBe(false);
  });
});

describe("can.viewAllTeams / filterReportsByTeamOffice", () => {
  it("viewAllTeams includes md/cfo/cs/admin only", () => {
    for (const r of ["md", "cfo", "cs", "admin"]) expect(can.viewAllTeams(r)).toBe(true);
    for (const r of ["dgm", "agm", "srm", "project_officer"]) expect(can.viewAllTeams(r)).toBe(false);
  });

  it("filterReportsByTeamOffice is narrower than viewAllTeams — excludes cfo/cs", () => {
    expect(can.filterReportsByTeamOffice("md")).toBe(true);
    expect(can.filterReportsByTeamOffice("admin")).toBe(true);
    expect(can.filterReportsByTeamOffice("cfo")).toBe(false);
    expect(can.filterReportsByTeamOffice("cs")).toBe(false);
  });
});

describe("isTeamUser / isAdminLevel", () => {
  it("classifies team-scoped roles correctly", () => {
    for (const r of ["dgm", "agm", "srm", "project_officer", "associate_consultant", "project_assistant"]) {
      expect(isTeamUser(r)).toBe(true);
    }
    expect(isTeamUser("cfo")).toBe(false);
    expect(isTeamUser("business_associate")).toBe(false);
  });

  it("classifies admin-level (org-wide, non-team) roles correctly", () => {
    expect(isAdminLevel("md")).toBe(true);
    expect(isAdminLevel("cfo")).toBe(true);
    expect(isAdminLevel("cs")).toBe(true);
    expect(isAdminLevel("admin")).toBe(false);
    expect(isAdminLevel("dgm")).toBe(false);
  });
});

describe("nav-visibility role lists", () => {
  it("USERS_PAGE_ROLES is admin-only", () => {
    expect(USERS_PAGE_ROLES).toEqual(["admin"]);
  });

  it("AUDIT_LOG_ROLES is Admin-only", () => {
    expect(AUDIT_LOG_ROLES).toEqual(["admin"]);
  });

  it("EMPANELMENT_ROLES and KNOWLEDGE_REPOSITORY_ROLES exclude business_associate but include every staff role", () => {
    expect(EMPANELMENT_ROLES).not.toContain("business_associate");
    expect(KNOWLEDGE_REPOSITORY_ROLES).not.toContain("business_associate");
    expect(EMPANELMENT_ROLES).toContain("admin");
    expect(EMPANELMENT_ROLES.length).toBe(Object.keys(ROLES).length - 1);
  });
});
